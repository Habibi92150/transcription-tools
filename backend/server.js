"use strict";
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs        = require("fs/promises");
const path      = require("path");
const os        = require("os");
const crypto    = require("crypto");
const express   = require("express");
const cors      = require("cors");
const multer    = require("multer");
const rateLimit = require("express-rate-limit");

const { authenticateFirebase }              = require("./auth");
const { handleTranscription }              = require("./transcription");
const { getOrCreateUser, getUsageToday, incrementUsage } = require("./db");

const PORT        = Number(process.env.PORT        || 8787);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 600);
const TMP_DIR     = path.join(os.tmpdir(), "transcription-tools");

const DAILY_LIMITS = { free: 3, premium: 50 };

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim());

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

// ── Rate limiters ─────────────────────────────────────────────────────────────
const transcribeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Trop de requêtes. Réessaie dans une minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Santé
app.get("/health", (_req, res) => res.json({ ok: true }));

// Config frontend (rétrocompat)
app.get("/api/config", (_req, res) =>
  res.json({ backendUrl: process.env.BACKEND_URL || "" })
);

// Quota utilisateur (remplace /api/auth/me)
app.get("/api/quota", authenticateFirebase, (req, res) => {
  const user       = getOrCreateUser(req.user.userId, req.user.email);
  const usageToday = getUsageToday(req.user.userId);
  const limit      = DAILY_LIMITS[user.tier] || DAILY_LIMITS.free;
  return res.json({ tier: user.tier, usageToday, limit });
});

// Transcription
app.post("/api/transcribe", authenticateFirebase, transcribeLimiter, upload.single("file"), async (req, res) => {
  const uploadedPath = req.file?.path;
  if (!uploadedPath) return res.status(400).json({ error: "Aucun fichier fourni." });

  try {
    const user       = getOrCreateUser(req.user.userId, req.user.email);
    const limit      = DAILY_LIMITS[user.tier] || DAILY_LIMITS.free;
    const usageToday = getUsageToday(req.user.userId);

    if (usageToday >= limit) {
      return res.status(429).json({
        error: `Quota journalier atteint (${usageToday}/${limit}).${user.tier === "free" ? " Reviens demain ou passe en premium." : " Reviens demain."}`,
        quota: { used: usageToday, limit },
      });
    }

    const result = await handleTranscription(req, uploadedPath);
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
