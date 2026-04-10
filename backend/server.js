"use strict";
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs      = require("fs/promises");
const path    = require("path");
const os      = require("os");
const crypto  = require("crypto");
const express = require("express");
const cors    = require("cors");
const multer  = require("multer");

const { handleFreeTranscription } = require("./gratuit");
const { validatePremiumToken, handlePremiumTranscription, handlePremiumAuth } = require("./premium");

const PORT       = Number(process.env.PORT || 8787);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 600);
const TMP_DIR    = path.join(os.tmpdir(), "transcription-tools");

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

const app = express();
app.use(cors());

app.get("/health", (_req, res) => res.json({ ok: true, sttEngine: process.env.STT_ENGINE || "whisper-cpp" }));

app.get("/api/config", (_req, res) =>
  res.json({ groqApiKey: process.env.GROQ_API_KEY || "", backendUrl: process.env.BACKEND_URL || "" })
);

app.post("/api/auth/premium", express.json(), handlePremiumAuth);

app.post("/api/transcribe", upload.single("file"), async (req, res) => {
  const uploadedPath = req.file?.path;
  if (!uploadedPath) return res.status(400).json({ error: "No file provided" });
  try {
    const isPremium = validatePremiumToken(String(req.headers["x-premium-token"] || "").trim());
    const result = isPremium
      ? await handlePremiumTranscription(req, uploadedPath)
      : await handleFreeTranscription(req, uploadedPath);
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
