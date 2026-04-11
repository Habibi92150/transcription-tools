"use strict";
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs      = require("fs/promises");
const path    = require("path");
const os      = require("os");
const crypto  = require("crypto");
const express = require("express");
const cors    = require("cors");
const multer  = require("multer");

const { handleRegister, handleLogin, handleMe, authenticateJWT } = require("./auth");
const { handleTranscription } = require("./transcription");
const { getUsageToday, incrementUsage } = require("./db");

const PORT        = Number(process.env.PORT        || 8787);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 600);
const TMP_DIR     = path.join(os.tmpdir(), "transcription-tools");

const DAILY_LIMITS = { free: 3, premium: 50 };

// ── Upload ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try { await fs.mkdir(TMP_DIR, { recursive: true }); cb(null, TMP_DIR); }
    catch (err) { cb(err); }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".bin";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_MB * 1024 * 1024 } });

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Santé
app.get("/health", (_req, res) => res.json({ ok: true }));

// Config frontend (rétrocompat)
app.get("/api/config", (_req, res) =>
  res.json({ backendUrl: process.env.BACKEND_URL || "" })
);

// Auth
app.post("/api/auth/register", handleRegister);
app.post("/api/auth/login",    handleLogin);
app.get("/api/auth/me",        authenticateJWT, handleMe);

// Transcription
app.post("/api/transcribe", authenticateJWT, upload.single("file"), async (req, res) => {
  const uploadedPath = req.file?.path;
  if (!uploadedPath) return res.status(400).json({ error: "Aucun fichier fourni." });

  try {
    // Vérification du quota journalier avant toute opération coûteuse
    const limit      = DAILY_LIMITS[req.user.tier] || DAILY_LIMITS.free;
    const usageToday = getUsageToday(req.user.userId);

    if (usageToday >= limit) {
      return res.status(429).json({
        error: `Quota journalier atteint (${usageToday}/${limit}).${req.user.tier === "free" ? " Reviens demain ou passe en premium." : " Reviens demain."}`,
        quota: { used: usageToday, limit },
      });
    }

    // Transcription Gemini
    const result = await handleTranscription(req, uploadedPath);

    // Incrémenter le compteur uniquement après succès
    incrementUsage(req.user.userId);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    await fs.unlink(uploadedPath).catch(() => {});
  }
});

app.listen(PORT, async () => {
  await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});
  console.log(`Backend listening on http://localhost:${PORT}`);
});
