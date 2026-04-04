const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const WavDecoder = require("wav-decoder");
const express = require("express");
const cors = require("cors");
const multer = require("multer");

const DEFAULT_LOCAL_BIN = path.join(__dirname, "bin", "whispercpp", "Release", "whisper-cli.exe");
const DEFAULT_LOCAL_MODEL = path.join(__dirname, "models", "ggml-base.bin");
const resolveMaybeRelative = (p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p));
const PORT = Number(process.env.PORT || 8787);
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 600);
const WHISPER_CPP_BIN = resolveMaybeRelative(process.env.WHISPER_CPP_BIN || DEFAULT_LOCAL_BIN);
const WHISPER_MODEL_PATH = resolveMaybeRelative(process.env.WHISPER_MODEL_PATH || DEFAULT_LOCAL_MODEL);
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || "fr";
const DIARIZATION_MAX_SPEAKERS = Math.max(1, Number(process.env.DIARIZATION_MAX_SPEAKERS || 2));
const DIARIZATION_MIN_GAP_SEC = Math.max(0.1, Number(process.env.DIARIZATION_MIN_GAP_SEC || 1.8));
const DIARIZATION_MIN_TURN_SEC = Math.max(0.5, Number(process.env.DIARIZATION_MIN_TURN_SEC || 10));
const DIARIZATION_MIN_TURN_SEGMENTS = Math.max(1, Number(process.env.DIARIZATION_MIN_TURN_SEGMENTS || 4));
const DIARIZATION_SWITCH_COOLDOWN_SEC = Math.max(0, Number(process.env.DIARIZATION_SWITCH_COOLDOWN_SEC || 6));
const DIARIZATION_MIN_FEATURE_SEC = Math.max(0.4, Number(process.env.DIARIZATION_MIN_FEATURE_SEC || 0.7));
const DIARIZATION_MIN_CLUSTER_SEGMENTS = Math.max(2, Number(process.env.DIARIZATION_MIN_CLUSTER_SEGMENTS || 3));
const DIARIZATION_VOICE_DISTANCE_THRESHOLD = Math.max(0.2, Number(process.env.DIARIZATION_VOICE_DISTANCE_THRESHOLD || 0.85));
const DIARIZATION_FRAME_SEC = Math.max(0.3, Number(process.env.DIARIZATION_FRAME_SEC || 0.9));
const DIARIZATION_HOP_SEC = Math.max(0.1, Number(process.env.DIARIZATION_HOP_SEC || 0.35));
const DIARIZATION_CONTINUITY_BONUS = Math.max(0, Number(process.env.DIARIZATION_CONTINUITY_BONUS || 0.2));
const WHISPER_BEAM_SIZE = Math.max(1, Number(process.env.WHISPER_BEAM_SIZE || 8));
const WHISPER_BEST_OF = Math.max(1, Number(process.env.WHISPER_BEST_OF || 8));
const STT_ENGINE = String(process.env.STT_ENGINE || "whisper-cpp").trim().toLowerCase();
const GROQ_STT_MODEL = String(process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo").trim();
const GROQ_STT_TEMPERATURE = String(process.env.GROQ_STT_TEMPERATURE ?? "0");
const GROQ_STT_TIMEOUT_MS = Math.max(30000, Number(process.env.GROQ_STT_TIMEOUT_MS || 600000));
const TEXT_CLEANUP_PROVIDER = String(process.env.TEXT_CLEANUP_PROVIDER || "none").trim().toLowerCase();
const GROQ_BASE_URL = String(process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").trim().replace(/\/$/, "");
const GROQ_CLEANUP_MODEL = String(process.env.GROQ_CLEANUP_MODEL || "llama-3.1-8b-instant").trim();
const GROQ_TIMEOUT_MS = Math.max(5000, Number(process.env.GROQ_TIMEOUT_MS || 60000));
const GROQ_CONTEXT_WINDOW = Math.max(0, Number(process.env.GROQ_CONTEXT_WINDOW || 5));
const GROQ_GLOBAL_CONTEXT_CHARS = Math.max(0, Number(process.env.GROQ_GLOBAL_CONTEXT_CHARS || 1800));
const GROQ_SUMMARY_MODEL = String(process.env.GROQ_SUMMARY_MODEL || "llama-3.3-70b-versatile").trim();
const GROQ_SUMMARY_TEMPERATURE = Number(process.env.GROQ_SUMMARY_TEMPERATURE || 0.2);
const GEMINI_API_BASE = String(process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta")
  .trim()
  .replace(/\/$/, "");
const GEMINI_SUMMARY_MODEL = String(process.env.GEMINI_SUMMARY_MODEL || "gemini-2.5-flash").trim();
const GEMINI_SUMMARY_TEMPERATURE = Number(process.env.GEMINI_SUMMARY_TEMPERATURE ?? 0.2);
const GEMINI_TIMEOUT_MS = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS || GROQ_TIMEOUT_MS));
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
/** Modèle Gemini pour la passe audio de l'overlay interlocuteurs uniquement (défaut = GEMINI_MODEL). */
const GEMINI_DIARIZATION_MODEL = String(process.env.GEMINI_DIARIZATION_MODEL || GEMINI_MODEL).trim();
const GEMINI_CLEANUP_MODEL = String(process.env.GEMINI_CLEANUP_MODEL || GEMINI_SUMMARY_MODEL).trim();
const GEMINI_CLEANUP_TEMPERATURE = Number(process.env.GEMINI_CLEANUP_TEMPERATURE ?? 0);
const GEMINI_DIARIZATION_OVERLAY = /^(1|true|yes|on)$/i.test(
  String(process.env.GEMINI_DIARIZATION_OVERLAY || "").trim()
);
const GEMINI_OVERLAY_MIN_SPEAKER_SEC = Math.max(
  0,
  Number(process.env.GEMINI_OVERLAY_MIN_SPEAKER_SEC || 0.7)
);
const GEMINI_OVERLAY_MIN_SPEAKER_SEGMENTS = Math.max(
  1,
  Number(process.env.GEMINI_OVERLAY_MIN_SPEAKER_SEGMENTS || 1)
);
const GEMINI_OVERLAY_SMOOTHING_CONFIDENCE = Math.min(
  0.95,
  Math.max(0, Number(process.env.GEMINI_OVERLAY_SMOOTHING_CONFIDENCE || 0.4))
);
/** Seuil de confiance moyenne (overlap segment STT / segment ref) pour garder un locuteur rare ou discret sans le lisser. */
const GEMINI_OVERLAY_MIN_SPEAKER_MEAN_CONF = Math.min(
  1,
  Math.max(0, Number(process.env.GEMINI_OVERLAY_MIN_SPEAKER_MEAN_CONF ?? 0.18))
);
/** Limite de tokens de sortie pour la transcription Gemini (JSON segments) — évite la coupure sur les fichiers longs. */
const GEMINI_STT_MAX_OUTPUT_TOKENS = Math.max(2048, Number(process.env.GEMINI_STT_MAX_OUTPUT_TOKENS || 8192));
const SUMMARY_CHUNK_TARGET_CHARS = Math.max(2000, Number(process.env.SUMMARY_CHUNK_TARGET_CHARS || 12000));
const SUMMARY_MAX_CHUNKS = Math.max(2, Number(process.env.SUMMARY_MAX_CHUNKS || 24));
function parseGroqCleanupHints() {
  const raw = String(process.env.GROQ_CLEANUP_HINTS || "");
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 80);
}
const TMP_DIR = path.join(os.tmpdir(), "transcription-tools");

const app = express();
app.use(cors());

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await fs.mkdir(TMP_DIR, { recursive: true });
      cb(null, TMP_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".bin";
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
});

function runCommand(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (buf) => {
      stderr += String(buf || "");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${bin} exited with ${code}`));
    });
  });
}

function msToSec(ms) {
  return Math.max(0, Number(ms || 0) / 1000);
}

function parseWhisperJson(payload) {
  const transcription =
    payload?.result?.transcription ||
    payload?.transcription ||
    payload?.segments ||
    [];

  if (!Array.isArray(transcription)) return [];

  const out = [];
  for (const seg of transcription) {
    const text = String(seg?.text || "").trim();
    if (!text) continue;

    let start = Number(seg?.start);
    let end = Number(seg?.end);

    if (!Number.isFinite(start) && Number.isFinite(seg?.offsets?.from)) {
      start = msToSec(seg.offsets.from);
    }
    if (!Number.isFinite(end) && Number.isFinite(seg?.offsets?.to)) {
      end = msToSec(seg.offsets.to);
    }
    if (!Number.isFinite(start) && Number.isFinite(seg?.timestamps?.from)) {
      start = msToSec(seg.timestamps.from);
    }
    if (!Number.isFinite(end) && Number.isFinite(seg?.timestamps?.to)) {
      end = msToSec(seg.timestamps.to);
    }

    start = Number.isFinite(start) ? start : 0;
    end = Number.isFinite(end) ? Math.max(start, end) : start + 2;

    out.push({ start, end, text });
  }
  return out;
}

function applyGapHeuristicDiarization(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  if (DIARIZATION_MAX_SPEAKERS <= 1) {
    return segments.map((seg) => ({ ...seg, speaker: "SPEAKER_00" }));
  }

  let currentSpeaker = 0;
  let turnDuration = 0;
  let turnSegments = 0;
  let prevEnd = 0;
  let lastSwitchAt = Number.NEGATIVE_INFINITY;

  return segments.map((seg, idx) => {
    const gap = Math.max(0, seg.start - prevEnd);
    const segDuration = Math.max(0, seg.end - seg.start);
    turnDuration += segDuration;
    turnSegments += 1;

    // Stabilized turn logic: switch only on sufficiently long silence after a real turn.
    const canSwitchAfterTurn = turnDuration >= DIARIZATION_MIN_TURN_SEC && turnSegments >= DIARIZATION_MIN_TURN_SEGMENTS;
    const cooldownElapsed = seg.start - lastSwitchAt >= DIARIZATION_SWITCH_COOLDOWN_SEC;
    const shouldSwitch = idx > 0 && gap >= DIARIZATION_MIN_GAP_SEC && canSwitchAfterTurn && cooldownElapsed;

    if (shouldSwitch) {
      currentSpeaker = (currentSpeaker + 1) % DIARIZATION_MAX_SPEAKERS;
      turnDuration = segDuration;
      turnSegments = 1;
      lastSwitchAt = seg.start;
    }
    prevEnd = seg.end;

    return { ...seg, speaker: `SPEAKER_${String(currentSpeaker).padStart(2, "0")}` };
  });
}

function estimatePitchHz(samples, sampleRate) {
  if (!samples || samples.length < 128) return 0;
  const size = Math.min(samples.length, 4096);
  const offset = Math.max(0, Math.floor((samples.length - size) / 2));
  const frame = samples.subarray(offset, offset + size);
  let bestLag = -1;
  let best = 0;
  const minLag = Math.max(20, Math.floor(sampleRate / 350));
  const maxLag = Math.min(size - 2, Math.floor(sampleRate / 70));
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < size - lag; i++) sum += frame[i] * frame[i + lag];
    if (sum > best) {
      best = sum;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return 0;
  return sampleRate / bestLag;
}

function computeSegmentVoiceFeatures(samples, sampleRate, seg) {
  const start = Math.max(0, Math.floor(seg.start * sampleRate));
  const end = Math.min(samples.length, Math.ceil(seg.end * sampleRate));
  if (end <= start) return null;
  const duration = (end - start) / sampleRate;
  if (duration < DIARIZATION_MIN_FEATURE_SEC) return null;

  const slice = samples.subarray(start, end);
  const step = Math.max(1, Math.floor(slice.length / 5000));

  let energy = 0;
  let zc = 0;
  let prev = slice[0] || 0;
  let count = 0;
  for (let i = 0; i < slice.length; i += step) {
    const v = slice[i];
    energy += v * v;
    if ((v >= 0 && prev < 0) || (v < 0 && prev >= 0)) zc += 1;
    prev = v;
    count += 1;
  }
  if (!count) return null;
  const rms = Math.sqrt(energy / count);
  const zcr = zc / count;
  const pitch = estimatePitchHz(slice, sampleRate);

  return {
    rms: Math.log10(Math.max(1e-8, rms)),
    zcr,
    pitch: pitch > 0 ? Math.log2(pitch) : 0,
  };
}

function computeFrameVoiceFeatures(frame, sampleRate) {
  if (!frame || frame.length < 128) return null;
  let energy = 0;
  let absMax = 1e-9;
  let zc = 0;
  let prev = frame[0] || 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    const av = Math.abs(v);
    energy += v * v;
    sum += v;
    sumSq += v * v;
    absMax = Math.max(absMax, av);
    if ((v >= 0 && prev < 0) || (v < 0 && prev >= 0)) zc += 1;
    prev = v;
  }
  const n = frame.length;
  const rms = Math.sqrt(energy / n);
  const mean = sum / n;
  const variance = Math.max(1e-12, sumSq / n - mean * mean);
  const std = Math.sqrt(variance);
  let skewNum = 0;
  for (let i = 0; i < n; i++) skewNum += ((frame[i] - mean) / std) ** 3;
  const skew = skewNum / n;
  const pitch = estimatePitchHz(frame, sampleRate);
  return {
    rms: Math.log10(Math.max(1e-8, rms)),
    zcr: zc / n,
    pitch: pitch > 0 ? Math.log2(pitch) : 0,
    crest: absMax / Math.max(1e-8, rms),
    skew,
  };
}

function normalizeFeatures(features) {
  const keys = ["rms", "zcr", "pitch", "crest", "skew"];
  const stats = {};
  for (const key of keys) {
    const vals = features.map((f) => f[key]);
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, vals.length);
    const std = Math.sqrt(variance) || 1;
    stats[key] = { mean, std };
  }
  return features.map((f) => ({
    rms: (f.rms - stats.rms.mean) / stats.rms.std,
    zcr: (f.zcr - stats.zcr.mean) / stats.zcr.std,
    pitch: (f.pitch - stats.pitch.mean) / stats.pitch.std,
    crest: (f.crest - stats.crest.mean) / stats.crest.std,
    skew: (f.skew - stats.skew.mean) / stats.skew.std,
  }));
}

function squaredDistance(a, b) {
  const dr = a.rms - b.rms;
  const dz = a.zcr - b.zcr;
  const dp = a.pitch - b.pitch;
  const dc = a.crest - b.crest;
  const ds = a.skew - b.skew;
  return dr * dr + dz * dz + dp * dp + 0.5 * dc * dc + 0.25 * ds * ds;
}

function runKmeans2(points) {
  if (points.length < DIARIZATION_MIN_CLUSTER_SEGMENTS * 2) return null;
  let c0 = { ...points[0] };
  let c1 = { ...points[Math.floor(points.length / 2)] };
  let labels = new Array(points.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < points.length; i++) {
      const d0 = squaredDistance(points[i], c0);
      const d1 = squaredDistance(points[i], c1);
      labels[i] = d0 <= d1 ? 0 : 1;
    }
    const sums = [
      { rms: 0, zcr: 0, pitch: 0, n: 0 },
      { rms: 0, zcr: 0, pitch: 0, n: 0 },
    ];
    for (let i = 0; i < points.length; i++) {
      const l = labels[i];
      sums[l].rms += points[i].rms;
      sums[l].zcr += points[i].zcr;
      sums[l].pitch += points[i].pitch;
      sums[l].n += 1;
    }
    if (!sums[0].n || !sums[1].n) return null;
    c0 = { rms: sums[0].rms / sums[0].n, zcr: sums[0].zcr / sums[0].n, pitch: sums[0].pitch / sums[0].n };
    c1 = { rms: sums[1].rms / sums[1].n, zcr: sums[1].zcr / sums[1].n, pitch: sums[1].pitch / sums[1].n };
  }

  const count0 = labels.filter((l) => l === 0).length;
  const count1 = labels.length - count0;
  if (count0 < DIARIZATION_MIN_CLUSTER_SEGMENTS || count1 < DIARIZATION_MIN_CLUSTER_SEGMENTS) return null;
  const centerDistance = Math.sqrt(squaredDistance(c0, c1));
  if (centerDistance < DIARIZATION_VOICE_DISTANCE_THRESHOLD) return null;
  return { labels, c0, c1, centerDistance };
}

function smoothLabels(labels) {
  if (!Array.isArray(labels) || labels.length < 3) return labels;
  const out = [...labels];
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i - 1] === out[i + 1] && out[i] !== out[i - 1]) out[i] = out[i - 1];
  }
  return out;
}

function isRiffWaveBuffer(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WAVE"
  );
}

async function bufferLooksLikeDecodableWav(buf) {
  if (!isRiffWaveBuffer(buf)) return false;
  try {
    const decoded = await WavDecoder.decode(buf);
    const samples = decoded?.channelData?.[0];
    const sr = Number(decoded?.sampleRate || 0);
    return Boolean(samples?.length && sr > 0);
  } catch {
    return false;
  }
}

/**
 * Diarisation locale (wav-decoder) attend du PCM WAV 16 kHz mono.
 * Les uploads MP3/MP4/M4A échouaient silencieusement → fallback gaps seulement.
 */
async function ensureWavForDiarization(srcPath) {
  const buf = await fs.readFile(srcPath);
  if (await bufferLooksLikeDecodableWav(buf)) {
    return { path: srcPath, cleanup: null };
  }

  const ffmpegRaw = String(process.env.FFMPEG_BIN || "ffmpeg").trim() || "ffmpeg";
  const ffmpegBin = ffmpegRaw.includes(path.sep) ? resolveMaybeRelative(ffmpegRaw) : ffmpegRaw;
  const outPath = path.join(TMP_DIR, `diar-${Date.now()}-${crypto.randomUUID()}.wav`);
  await fs.mkdir(TMP_DIR, { recursive: true });
  try {
    await runCommand(ffmpegBin, ["-y", "-i", srcPath, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outPath]);
    return {
      path: outPath,
      cleanup: async () => {
        await fs.unlink(outPath).catch(() => {});
      },
    };
  } catch (err) {
    console.warn(
      "[diarization] ffmpeg conversion to WAV failed — install ffmpeg in PATH or set FFMPEG_BIN. Error:",
      String(err?.message || err)
    );
    return { path: srcPath, cleanup: null };
  }
}

function splitSegmentFrames(seg, frameSec, hopSec) {
  const out = [];
  const start = Math.max(0, Number(seg.start || 0));
  const end = Math.max(start, Number(seg.end || start));
  if (end - start <= 0) return out;
  if (end - start <= frameSec) {
    out.push({ start, end });
    return out;
  }
  let t = start;
  while (t < end) {
    const fEnd = Math.min(end, t + frameSec);
    out.push({ start: t, end: fEnd });
    if (fEnd >= end) break;
    t += hopSec;
  }
  return out;
}

function majorityLabel(labels) {
  const count = new Map();
  for (const l of labels) count.set(l, (count.get(l) || 0) + 1);
  let best = labels[0] || 0;
  let bestN = -1;
  for (const [k, v] of count.entries()) {
    if (v > bestN) {
      bestN = v;
      best = k;
    }
  }
  return best;
}

async function applyVoiceAwareDiarization(filePath, segments) {
  if (!Array.isArray(segments) || !segments.length) return { segments: [], strategy: "none" };
  if (DIARIZATION_MAX_SPEAKERS <= 1) {
    return { segments: segments.map((seg) => ({ ...seg, speaker: "SPEAKER_00" })), strategy: "single-speaker" };
  }

  try {
    const wavBuffer = await fs.readFile(filePath);
    const decoded = await WavDecoder.decode(wavBuffer);
    const samples = decoded?.channelData?.[0];
    const sampleRate = Number(decoded?.sampleRate || 0);
    if (!samples || !sampleRate) {
      return { segments: applyGapHeuristicDiarization(segments), strategy: "gap-fallback" };
    }

    const frameItems = [];
    for (let i = 0; i < segments.length; i++) {
      const frames = splitSegmentFrames(segments[i], DIARIZATION_FRAME_SEC, DIARIZATION_HOP_SEC);
      for (const fr of frames) {
        const start = Math.max(0, Math.floor(fr.start * sampleRate));
        const end = Math.min(samples.length, Math.ceil(fr.end * sampleRate));
        if (end <= start) continue;
        const feat = computeFrameVoiceFeatures(samples.subarray(start, end), sampleRate);
        if (!feat) continue;
        frameItems.push({ segIndex: i, feat });
      }
    }

    if (frameItems.length < DIARIZATION_MIN_CLUSTER_SEGMENTS * 4) {
      return { segments: applyGapHeuristicDiarization(segments), strategy: "gap-fallback" };
    }

    const norm = normalizeFeatures(frameItems.map((x) => x.feat));
    const clustered = runKmeans2(norm);
    if (!clustered) {
      return { segments: applyGapHeuristicDiarization(segments), strategy: "gap-fallback" };
    }

    const smoothed = smoothLabels(clustered.labels);
    const perSegLabels = new Map();
    for (let i = 0; i < frameItems.length; i++) {
      const segIndex = frameItems[i].segIndex;
      const arr = perSegLabels.get(segIndex) || [];
      arr.push(smoothed[i]);
      perSegLabels.set(segIndex, arr);
    }

    const fullLabels = new Array(segments.length).fill(0);
    for (let i = 0; i < fullLabels.length; i++) {
      const votes = perSegLabels.get(i);
      if (votes && votes.length) fullLabels[i] = majorityLabel(votes);
      else if (i > 0) fullLabels[i] = fullLabels[i - 1];
    }

    // Continuity smoothing: keep previous speaker on near-tie boundaries.
    for (let i = 1; i < fullLabels.length; i++) {
      const votes = perSegLabels.get(i);
      if (!votes || votes.length < 2) continue;
      const c0 = votes.filter((x) => x === 0).length;
      const c1 = votes.length - c0;
      const winner = c0 >= c1 ? 0 : 1;
      const loser = winner === 0 ? 1 : 0;
      const margin = Math.abs(c0 - c1) / votes.length;
      if (margin < DIARIZATION_CONTINUITY_BONUS && fullLabels[i - 1] === loser) {
        fullLabels[i] = fullLabels[i - 1];
      }
    }

    // Keep stable speaker ids: lower-pitch centroid is SPEAKER_00.
    const swap = clustered.c0.pitch > clustered.c1.pitch;
    const diarized = segments.map((seg, i) => {
      const raw = fullLabels[i] || 0;
      const label = swap ? (raw === 0 ? 1 : 0) : raw;
      return { ...seg, speaker: `SPEAKER_${String(label).padStart(2, "0")}` };
    });
    return { segments: diarized, strategy: "voice-features-v2" };
  } catch {
    return { segments: applyGapHeuristicDiarization(segments), strategy: "gap-fallback" };
  }
}

function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty JSON payload");
  try {
    return JSON.parse(raw);
  } catch {
    const block = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (block) return JSON.parse(block);
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
    throw new Error("Invalid JSON payload");
  }
}

function capitalizeLike(source, target) {
  if (!source) return target;
  return source[0] === source[0].toUpperCase()
    ? target[0].toUpperCase() + target.slice(1)
    : target;
}

function applyFrenchContractionRules(input) {
  let text = String(input || "");
  if (!text) return text;
  text = text.replace(/’/g, "'");
  text = text.replace(/\b([Qq])u['’]\s+([aeiouyhàâäéèêëîïôöùûüœ])/g, (_m, q, v) => `${q}u'${v}`);
  text = text.replace(/\b([Qq])ue\s+([aeiouyhàâäéèêëîïôöùûüœ])/g, (_m, q, v) => `${q}u'${v}`);
  text = text.replace(/\b([Dd])e\s+le\b/g, (_m, d) => capitalizeLike(d, "du"));
  text = text.replace(/\b([Dd])e\s+les\b/g, (_m, d) => capitalizeLike(d, "des"));
  return text;
}

function applyFrenchNegationRules(input) {
  let text = String(input || "");
  if (!text) return text;
  text = text.replace(/\b([Cc])['’]est\s+pas\b/g, (_m, c) => `${capitalizeLike(c, "ce")} n'est pas`);
  text = text.replace(/\b([Jj])['’]ai\s+pas\b/g, (_m, j) => `${capitalizeLike(j, "je")} n'ai pas`);
  text = text.replace(/\b([Oo])n\s+a\s+pas\b/g, (_m, o) => `${capitalizeLike(o, "on")} n'a pas`);
  text = text.replace(/\b([Ii])l\s+y\s+a\s+pas\b/g, (_m, i) => `${capitalizeLike(i, "il")} n'y a pas`);
  text = text.replace(/\b([Ii])l\s+est\s+pas\b/g, (_m, i) => `${capitalizeLike(i, "il")} n'est pas`);
  text = text.replace(/\b([Ee])lle\s+est\s+pas\b/g, (_m, e) => `${capitalizeLike(e, "elle")} n'est pas`);
  return text;
}

function normalizeFrenchTypography(input) {
  let text = String(input || "");
  if (!text) return text;
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/'(?=\s)/g, "");
  text = text.replace(/\s+([,.;!?])/g, "$1");
  return text;
}

function applyDeterministicFrenchCleanup(input) {
  let text = String(input || "");
  text = applyFrenchContractionRules(text);
  text = applyFrenchNegationRules(text);
  text = normalizeFrenchTypography(text);
  return text;
}

function buildTranscriptPreviewForCleanup(segments, maxChars) {
  if (!maxChars || !Array.isArray(segments) || !segments.length) return "";
  const full = segments.map((s) => String(s?.text || "").trim()).filter(Boolean).join(" ");
  if (full.length <= maxChars) return full;
  const headLen = Math.floor(maxChars * 0.62);
  const tailLen = Math.floor(maxChars * 0.32);
  const head = full.slice(0, headLen);
  const tail = full.slice(-tailLen);
  return `${head} … ${tail}`;
}

async function cleanSegmentsWithGroq(segments, groqApiKey) {
  if (!groqApiKey) return { segments, strategy: "none-no-key" };
  if (!Array.isArray(segments) || !segments.length) return { segments, strategy: "none-empty" };

  const hints = parseGroqCleanupHints();
  const transcriptPreview = buildTranscriptPreviewForCleanup(segments, GROQ_GLOBAL_CONTEXT_CHARS);

  const payload = {
    transcriptPreview,
    hints,
    segments: segments.map((seg, i) => {
      const from = Math.max(0, i - GROQ_CONTEXT_WINDOW);
      const to = Math.min(segments.length, i + GROQ_CONTEXT_WINDOW + 1);
      return {
        i,
        text: String(seg?.text || ""),
        contextBefore: segments.slice(from, i).map((s) => String(s?.text || "")),
        contextAfter: segments.slice(i + 1, to).map((s) => String(s?.text || "")),
      };
    }),
  };

  const hintsBlock =
    hints.length > 0
      ? ` Indices fournis pour cette émission (priorité si une forme proche apparaît dans le texte): ${hints.join(" | ")}.`
      : "";

  const systemPrompt =
    "Tu corriges des segments de transcription FR (sous-titres). Corrige orthographe, accents, accords, apostrophes, contractions et ponctuation. " +
    "Rétablis la négation (ne/n') uniquement quand c'est évident et non ambigu (ex: c'est pas -> ce n'est pas). " +
    "Noms propres et personnalités: quand le STT produit une forme phonétiquement proche d'un nom connu (sport, médias, politique) et que transcriptPreview ou le contexte local le rend plausible, corrige vers l'orthographe standard (ex: prénom/nom confondus par homophonie, Matuidi vs Matfidi, Blaise vs Isabelle dans un contexte foot/conjoint). " +
    "Si le contexte reste ambigu, ne invente pas de nom: garde la forme la plus sûre. " +
    "Ne paraphrase pas. Ne résume pas. Ne change pas le sens. Ne supprime aucun segment. Ne ajoute pas de tirets de locuteur. " +
    hintsBlock +
    " Réponds uniquement en JSON valide avec la clé segments: tableau {i, text} pour chaque index.";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  try {
    const baseBody = {
      model: GROQ_CLEANUP_MODEL,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content:
            "Corrige ces segments et garde exactement les mêmes index (0..n-1). " +
            "N'ajoute pas de labels speaker. N'ajoute pas de timestamp. " +
            "Le champ transcriptPreview sert uniquement au contexte thématique; ne le recopie pas dans les segments. " +
            "JSON schema: {\"segments\":[{\"i\":number,\"text\":string},...]}\n" +
            JSON.stringify(payload),
        },
      ],
    };

    let res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({ ...baseBody, response_format: { type: "json_object" } }),
    });

    if (!res.ok && res.status === 400) {
      res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify(baseBody),
      });
    }

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Groq cleanup HTTP ${res.status} ${msg}`.trim());
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonLoose(content);
    const fixed = Array.isArray(parsed?.segments) ? parsed.segments : [];
    if (fixed.length !== segments.length) throw new Error("Groq cleanup segment count mismatch");

    const out = segments.map((seg, i) => {
      const row = fixed.find((r) => Number(r?.i) === i);
      const text = applyDeterministicFrenchCleanup(String(row?.text || seg.text || ""));
      return { ...seg, text: text || String(seg.text || "") };
    });
    return { segments: out, strategy: `groq-cleanup-context-${GROQ_CONTEXT_WINDOW}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function cleanSegmentsWithGemini(segments, geminiApiKey) {
  if (!geminiApiKey) return { segments, strategy: "none-no-key" };
  if (!Array.isArray(segments) || !segments.length) return { segments, strategy: "none-empty" };

  const hints = parseGroqCleanupHints();
  const transcriptPreview = buildTranscriptPreviewForCleanup(segments, GROQ_GLOBAL_CONTEXT_CHARS);
  const payload = {
    transcriptPreview,
    hints,
    segments: segments.map((seg, i) => {
      const from = Math.max(0, i - GROQ_CONTEXT_WINDOW);
      const to = Math.min(segments.length, i + GROQ_CONTEXT_WINDOW + 1);
      return {
        i,
        text: String(seg?.text || ""),
        contextBefore: segments.slice(from, i).map((s) => String(s?.text || "")),
        contextAfter: segments.slice(i + 1, to).map((s) => String(s?.text || "")),
      };
    }),
  };

  const hintsBlock =
    hints.length > 0
      ? `Indices fournis pour cette émission (priorité si une forme proche apparaît): ${hints.join(" | ")}.`
      : "";
  const systemPrompt =
    "Tu corriges des segments de transcription FR (sous-titres). Corrige uniquement orthographe, accents, accords, apostrophes, contractions et ponctuation. " +
    "Rétablis la négation (ne/n') seulement quand c'est évident et sans ambiguïté. " +
    "Noms propres: corrige uniquement quand le contexte local + transcriptPreview le rendent plausible. " +
    "Ne paraphrase pas, ne résume pas, ne change pas le sens. Ne modifie jamais l'ordre des segments. " +
    "Réponds uniquement en JSON valide: {\"segments\":[{\"i\":number,\"text\":string},...]} " +
    hintsBlock;
  const userPrompt =
    "Corrige ces segments et conserve strictement les mêmes index. " +
    "N'ajoute pas de speaker ni de timestamps.\n" +
    JSON.stringify(payload);

  const model = GEMINI_CLEANUP_MODEL;
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    async function doFetch(jsonMode) {
      const generationConfig = mergeGeminiGenerationConfig(
        jsonMode
          ? { temperature: GEMINI_CLEANUP_TEMPERATURE, responseMimeType: "application/json" }
          : { temperature: GEMINI_CLEANUP_TEMPERATURE },
        model
      );
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          generationConfig,
        }),
        signal: controller.signal,
      });
    }

    let res = await doFetch(true);
    if (!res.ok && res.status === 400) {
      res = await doFetch(false);
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Gemini cleanup HTTP ${res.status} ${msg}`.trim());
    }
    const data = await res.json();
    const block = data?.promptFeedback?.blockReason;
    if (block) throw new Error(`Gemini cleanup blocked: ${block}`);
    const text = extractGeminiCandidateText(data);
    if (!text) throw new Error(`Gemini cleanup empty response (${geminiResponseErrorHint(data) || "no text"})`);

    const parsed = parseJsonLoose(text);
    const fixed = Array.isArray(parsed?.segments) ? parsed.segments : [];
    if (fixed.length !== segments.length) throw new Error("Gemini cleanup segment count mismatch");

    const out = segments.map((seg, i) => {
      const row = fixed.find((r) => Number(r?.i) === i);
      const t = applyDeterministicFrenchCleanup(String(row?.text || seg.text || ""));
      return { ...seg, text: t || String(seg.text || "") };
    });
    return { segments: out, strategy: "gemini-cleanup-context" };
  } finally {
    clearTimeout(timeout);
  }
}

function chunkSegmentsForSummary(segments, targetChars = SUMMARY_CHUNK_TARGET_CHARS) {
  const out = [];
  let cur = [];
  let curChars = 0;
  for (const seg of Array.isArray(segments) ? segments : []) {
    const text = String(seg?.text || "").trim();
    if (!text) continue;
    const rowChars = text.length + 24;
    if (cur.length && curChars + rowChars > targetChars) {
      out.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(seg);
    curChars += rowChars;
  }
  if (cur.length) out.push(cur);
  return out.slice(0, SUMMARY_MAX_CHUNKS);
}

function normalizeEpisodeSummaryPayload(payload, fallbackText = "") {
  const short = String(payload?.short || payload?.summary_short || "").trim();
  const long = String(payload?.long || payload?.summary_long || "").trim();
  const keyPoints = Array.isArray(payload?.key_points)
    ? payload.key_points
    : Array.isArray(payload?.keyPoints)
      ? payload.keyPoints
      : [];
  const characters = Array.isArray(payload?.characters) ? payload.characters : [];
  const fallback = String(fallbackText || "").trim();
  return {
    short: short || fallback.slice(0, 280),
    long: long || fallback,
    keyPoints: keyPoints.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12),
    characters: characters.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 24),
  };
}

/** Gemini 3 : thinking par défaut = lent / parts atypiques ; `minimal` limite latence et stabilise la sortie texte. */
function mergeGeminiGenerationConfig(base, modelId) {
  const m = String(modelId || "").toLowerCase();
  if (!m.includes("gemini-3")) return base;
  return {
    ...base,
    thinkingConfig: { thinkingLevel: "minimal" },
  };
}

function extractGeminiCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => typeof p?.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
}

function geminiResponseErrorHint(data) {
  if (data?.error?.message) return String(data.error.message);
  if (data?.promptFeedback?.blockReason) return `blocked: ${data.promptFeedback.blockReason}`;
  if (!Array.isArray(data?.candidates) || data.candidates.length === 0) return "no candidates";
  return "";
}

async function geminiGenerateSummaryJson(apiKey, systemPrompt, userPrompt, errorCtx) {
  const model = GEMINI_SUMMARY_MODEL;
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  const base = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
  };
  async function doFetch(jsonMode) {
    const generationConfig = mergeGeminiGenerationConfig(
      jsonMode
        ? { temperature: GEMINI_SUMMARY_TEMPERATURE, responseMimeType: "application/json" }
        : { temperature: GEMINI_SUMMARY_TEMPERATURE },
      model
    );
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, generationConfig }),
      signal: controller.signal,
    });
  }
  try {
    let res = await doFetch(true);
    if (!res.ok && res.status === 400) {
      res = await doFetch(false);
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Gemini ${errorCtx} HTTP ${res.status} ${msg}`.trim());
    }
    const data = await res.json();
    const block = data?.promptFeedback?.blockReason;
    if (block) throw new Error(`Gemini ${errorCtx} blocked: ${block}`);
    const finish = data?.candidates?.[0]?.finishReason;
    if (finish === "SAFETY" || finish === "RECITATION") {
      throw new Error(`Gemini ${errorCtx} finish: ${finish}`);
    }
    const text = extractGeminiCandidateText(data);
    if (!text) {
      const hint = geminiResponseErrorHint(data);
      throw new Error(`Gemini ${errorCtx} empty response${hint ? ` (${hint})` : ""}`);
    }
    return parseJsonLoose(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeEpisodeWithGemini(segments, geminiApiKey, titleHint = "episode") {
  if (!geminiApiKey) throw new Error("Episode summary (Gemini) requires GEMINI_API_KEY or x-gemini-api-key");
  const chunks = chunkSegmentsForSummary(segments);
  if (!chunks.length) throw new Error("No transcript chunks available");

  const chunkSummaries = [];
  for (let i = 0; i < chunks.length; i++) {
    const rows = chunks[i];
    const transcript = rows.map((s) => String(s?.text || "").trim()).filter(Boolean).join(" ");
    const start = Number(rows[0]?.start || 0);
    const end = Number(rows[rows.length - 1]?.end || start);
    const systemPrompt =
      "Tu es un analyste éditorial de séries. Tu résumes un extrait de transcription sans inventer de faits. " +
      "Réponds uniquement en JSON valide: {\"short\":\"...\",\"long\":\"...\",\"key_points\":[...],\"characters\":[...]}.";
    const userPrompt =
      `Titre: ${titleHint}\n` +
      `Chunk ${i + 1}/${chunks.length} (${start.toFixed(1)}s -> ${end.toFixed(1)}s)\n` +
      "Instructions:\n" +
      "- Français naturel\n" +
      "- Conserver les faits et enjeux narratifs\n" +
      "- 3 à 6 points clés max\n\n" +
      transcript;

    const parsed = await geminiGenerateSummaryJson(
      geminiApiKey,
      systemPrompt,
      userPrompt,
      `summary chunk ${i + 1}/${chunks.length}`
    );
    chunkSummaries.push(normalizeEpisodeSummaryPayload(parsed, transcript.slice(0, 500)));
  }

  const reduceInput = chunkSummaries
    .map(
      (c, i) =>
        `Chunk ${i + 1}\nshort: ${c.short}\nlong: ${c.long}\nkey_points: ${JSON.stringify(c.keyPoints)}\ncharacters: ${JSON.stringify(c.characters)}`
    )
    .join("\n\n");
  const systemPrompt =
    "Tu fusionnes des résumés de chunks en un résumé d'épisode. Ne pas inventer. " +
    "Réponds uniquement en JSON: {\"short\":\"...\",\"long\":\"...\",\"key_points\":[...],\"characters\":[...]}.";
  const userPrompt =
    `Titre: ${titleHint}\n` +
    "Produit:\n" +
    "- short: 3 à 5 phrases max\n" +
    "- long: 1 à 3 paragraphes\n" +
    "- key_points: 5 à 10 points\n" +
    "- characters: noms pertinents\n\n" +
    reduceInput;

  const parsed = await geminiGenerateSummaryJson(geminiApiKey, systemPrompt, userPrompt, "summary reduce");
  const normalized = normalizeEpisodeSummaryPayload(parsed, chunkSummaries.map((c) => c.short).join(" "));
  return { ...normalized, chunkCount: chunkSummaries.length };
}

async function summarizeEpisodeWithGroq(segments, groqApiKey, titleHint = "episode") {
  if (!groqApiKey) throw new Error("Episode summary requires API key (header x-groq-api-key or GROQ_API_KEY)");
  const chunks = chunkSegmentsForSummary(segments);
  if (!chunks.length) throw new Error("No transcript chunks available");

  const chunkSummaries = [];
  for (let i = 0; i < chunks.length; i++) {
    const rows = chunks[i];
    const transcript = rows.map((s) => String(s?.text || "").trim()).filter(Boolean).join(" ");
    const start = Number(rows[0]?.start || 0);
    const end = Number(rows[rows.length - 1]?.end || start);
    const systemPrompt =
      "Tu es un analyste éditorial de séries. Tu résumes un extrait de transcription sans inventer de faits. " +
      "Réponds uniquement en JSON valide: {\"short\":\"...\",\"long\":\"...\",\"key_points\":[...],\"characters\":[...]}.";
    const userPrompt =
      `Titre: ${titleHint}\n` +
      `Chunk ${i + 1}/${chunks.length} (${start.toFixed(1)}s -> ${end.toFixed(1)}s)\n` +
      "Instructions:\n" +
      "- Français naturel\n" +
      "- Conserver les faits et enjeux narratifs\n" +
      "- 3 à 6 points clés max\n\n" +
      transcript;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
    try {
      let res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: GROQ_SUMMARY_MODEL,
          temperature: GROQ_SUMMARY_TEMPERATURE,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!res.ok && res.status === 400) {
        res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqApiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: GROQ_SUMMARY_MODEL,
            temperature: GROQ_SUMMARY_TEMPERATURE,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });
      }
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(`Groq summary chunk HTTP ${res.status} ${msg}`.trim());
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "";
      const parsed = parseJsonLoose(content);
      chunkSummaries.push(
        normalizeEpisodeSummaryPayload(parsed, transcript.slice(0, 500))
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  const reduceInput = chunkSummaries
    .map(
      (c, i) =>
        `Chunk ${i + 1}\nshort: ${c.short}\nlong: ${c.long}\nkey_points: ${JSON.stringify(c.keyPoints)}\ncharacters: ${JSON.stringify(c.characters)}`
    )
    .join("\n\n");
  const systemPrompt =
    "Tu fusionnes des résumés de chunks en un résumé d'épisode. Ne pas inventer. " +
    "Réponds uniquement en JSON: {\"short\":\"...\",\"long\":\"...\",\"key_points\":[...],\"characters\":[...]}.";
  const userPrompt =
    `Titre: ${titleHint}\n` +
    "Produit:\n" +
    "- short: 3 à 5 phrases max\n" +
    "- long: 1 à 3 paragraphes\n" +
    "- key_points: 5 à 10 points\n" +
    "- characters: noms pertinents\n\n" +
    reduceInput;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  try {
    let res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_SUMMARY_MODEL,
        temperature: GROQ_SUMMARY_TEMPERATURE,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok && res.status === 400) {
      res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${groqApiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: GROQ_SUMMARY_MODEL,
          temperature: GROQ_SUMMARY_TEMPERATURE,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Groq summary reduce HTTP ${res.status} ${msg}`.trim());
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonLoose(content);
    const normalized = normalizeEpisodeSummaryPayload(parsed, chunkSummaries.map((c) => c.short).join(" "));
    return { ...normalized, chunkCount: chunkSummaries.length };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGeminiSttSegmentsFromPayload(parsed) {
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.segments)
      ? parsed.segments
      : null;
  if (!arr) throw new Error("Gemini STT: la réponse JSON doit être un tableau de segments");

  const out = [];
  for (const row of arr) {
    const text = String(row?.text || "").trim();
    if (!text) continue;
    const start = Number(row?.start);
    const end = Number(row?.end);
    const speakerRaw = String(row?.speaker || "Speaker 1").trim() || "Speaker 1";
    out.push({
      start: Number.isFinite(start) ? Math.max(0, start) : 0,
      end: Number.isFinite(end) ? Math.max(0, end) : 0,
      text,
      speaker: speakerRaw,
    });
  }
  if (!out.length) throw new Error("Gemini STT: aucun segment texte exploitable");
  out.sort((a, b) => a.start - b.start);
  return out;
}

function normalizeSpeakerToken(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^SPEAKER_\d+$/i.test(raw)) {
    const n = Number(raw.match(/\d+/)?.[0] || 0);
    return `SPEAKER_${String(Math.max(0, n)).padStart(2, "0")}`;
  }
  const m = raw.match(/speaker\D*(\d+)/i);
  if (m) {
    const n = Math.max(0, Number(m[1]) - 1);
    return `SPEAKER_${String(n).padStart(2, "0")}`;
  }
  return raw.toUpperCase().replace(/\s+/g, "_");
}

function applyGeminiSpeakerOverlay(baseSegments, geminiSegments) {
  const base = Array.isArray(baseSegments) ? baseSegments : [];
  const ref = Array.isArray(geminiSegments) ? geminiSegments : [];
  if (!base.length || !ref.length) return base;

  const aliasMap = new Map();
  let aliasIdx = 0;
  const canonical = (label) => {
    const token = normalizeSpeakerToken(label) || "SPEAKER_00";
    if (/^SPEAKER_\d+$/i.test(token)) return token;
    if (!aliasMap.has(token)) {
      aliasMap.set(token, `SPEAKER_${String(aliasIdx).padStart(2, "0")}`);
      aliasIdx += 1;
    }
    return aliasMap.get(token);
  };

  const labels = [];
  const confidence = [];
  const assignedDuration = new Map();
  const assignedCount = new Map();
  const assignedConfidenceSum = new Map();
  for (let i = 0; i < base.length; i++) {
    const b = base[i];
    const bs = Math.max(0, Number(b?.start || 0));
    const be = Math.max(bs, Number(b?.end || bs));
    const dur = Math.max(0.01, be - bs);
    const score = new Map();
    for (const g of ref) {
      const gs = Math.max(0, Number(g?.start || 0));
      const ge = Math.max(gs, Number(g?.end || gs));
      const overlap = Math.max(0, Math.min(be, ge) - Math.max(bs, gs));
      if (overlap <= 0) continue;
      const spk = canonical(g?.speaker || "SPEAKER_00");
      score.set(spk, (score.get(spk) || 0) + overlap);
    }
    let best = "";
    let bestN = -1;
    for (const [k, v] of score.entries()) {
      if (v > bestN) {
        bestN = v;
        best = k;
      }
    }
    if (!best) best = normalizeSpeakerToken(b?.speaker) || "SPEAKER_00";
    const conf = bestN > 0 ? Math.min(1, bestN / dur) : 0;
    labels.push(best);
    confidence.push(conf);
    assignedDuration.set(best, (assignedDuration.get(best) || 0) + Math.max(0, bestN));
    assignedCount.set(best, (assignedCount.get(best) || 0) + 1);
    assignedConfidenceSum.set(best, (assignedConfidenceSum.get(best) || 0) + conf);
  }

  const protectedSpeakers = new Set();
  for (const [spk, totalDur] of assignedDuration.entries()) {
    const count = assignedCount.get(spk) || 0;
    const meanConf = (assignedConfidenceSum.get(spk) || 0) / Math.max(1, count);
    if (
      totalDur >= GEMINI_OVERLAY_MIN_SPEAKER_SEC ||
      (count >= GEMINI_OVERLAY_MIN_SPEAKER_SEGMENTS && meanConf >= GEMINI_OVERLAY_MIN_SPEAKER_MEAN_CONF)
    ) {
      protectedSpeakers.add(spk);
    }
  }

  // Smooth single-segment speaker flips when surrounding context is stable.
  for (let i = 1; i < labels.length - 1; i++) {
    if (
      labels[i - 1] === labels[i + 1] &&
      labels[i] !== labels[i - 1] &&
      confidence[i] < GEMINI_OVERLAY_SMOOTHING_CONFIDENCE &&
      !protectedSpeakers.has(labels[i])
    ) {
      labels[i] = labels[i - 1];
    }
  }

  return base.map((seg, i) => ({ ...seg, speaker: labels[i] || "SPEAKER_00" }));
}

async function transcribeWithGemini(filePath, apiKey, modelId, options = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw new Error("Gemini STT requires API key (header x-gemini-api-key or GEMINI_API_KEY)");
  const model = String(modelId || GEMINI_MODEL).trim() || GEMINI_MODEL;
  const speakerDiarizationPass = Boolean(options?.speakerDiarizationPass);

  const wavForGemini = await ensureWavForDiarization(filePath);
  let cleanupWav = wavForGemini.cleanup;
  try {
    const buf = await fs.readFile(wavForGemini.path);
    const b64 = buf.toString("base64");
    const systemPrompt = speakerDiarizationPass
      ? "Tu transcris l'intégralité de l'audio en français : chaque parole audible de chaque personne, " +
        "y compris les longs monologues et les voix fortes ou proches du micro — rien ne doit être omis ni résumé.\n" +
        "En parallèle, indique qui parle (Speaker 1, Speaker 2, etc.) : un nouveau segment à chaque changement de locuteur.\n" +
        "Si une autre voix est clairement distincte mais plus faible ou brève, donne-lui un speaker séparé ; " +
        "sans pour autant négliger ou raccourcir ce que disent les locuteurs principaux.\n" +
        "Ne te focalise pas uniquement sur la voix la plus discrète : la transcription complète de tous les intervenants prime.\n" +
        "Retourne UNIQUEMENT un JSON valide, sans markdown, sous ce format exact :\n" +
        '[{"start": 0.0, "end": 3.5, "text": "Bonjour tout le monde", "speaker": "Speaker 1"}, ...]\n' +
        "Les timestamps sont en secondes. Sois précis à 0.1 seconde près."
      : "Tu es un assistant de transcription audio professionnel.\n" +
        "Transcris l'intégralité de l'audio en français, mot à mot pour chaque intervenant : " +
        "tours de parole longs, voix dominantes et proches du micro inclus — ne saute aucun passage parlé substantiel.\n" +
        "Identifie les interlocuteurs (Speaker 1, Speaker 2, etc.) et découpe un segment à chaque changement de locuteur.\n" +
        "Lorsqu'une autre personne est audible avec un timbre distinct, même plus bas ou plus loin, attribue-lui un speaker séparé ; " +
        "cela ne doit jamais se faire au prix d'omettre ou de minimiser ce que disent les autres.\n" +
        "Retourne UNIQUEMENT un JSON valide, sans markdown, sous ce format exact :\n" +
        '[{"start": 0.0, "end": 3.5, "text": "Bonjour tout le monde", "speaker": "Speaker 1"}, ...]\n' +
        "Les timestamps sont en secondes. Sois précis à 0.1 seconde près.";
    const userHint = speakerDiarizationPass
      ? "Audio WAV mono 16 kHz : transcris tout le monde sur toute la durée, avec locuteurs et timestamps ; JSON uniquement."
      : "Analyse l'audio ci-joint (WAV mono 16 kHz) et produis le tableau JSON des segments, rien d'autre.";

    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const baseParts = [
      {
        inlineData: {
          mimeType: "audio/wav",
          data: b64,
        },
      },
      { text: userHint },
    ];
    const baseBody = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: baseParts }],
      generationConfig: mergeGeminiGenerationConfig(
        {
          temperature: 0.2,
          responseMimeType: "application/json",
          maxOutputTokens: GEMINI_STT_MAX_OUTPUT_TOKENS,
        },
        model
      ),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROQ_STT_TIMEOUT_MS);
    try {
      async function doFetch(body) {
        return fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }

      let res = await doFetch(baseBody);
      if (!res.ok && res.status === 400) {
        const fallbackBody = {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: baseParts }],
          generationConfig: mergeGeminiGenerationConfig(
            { temperature: 0.2, maxOutputTokens: GEMINI_STT_MAX_OUTPUT_TOKENS },
            model
          ),
        };
        res = await doFetch(fallbackBody);
      }
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(`Gemini STT HTTP ${res.status} ${msg}`.trim());
      }
      const data = await res.json();
      const block = data?.promptFeedback?.blockReason;
      if (block) throw new Error(`Gemini STT blocked: ${block}`);
      const text = extractGeminiCandidateText(data);
      if (!text) {
        const hint = geminiResponseErrorHint(data);
        throw new Error(`Gemini STT empty response${hint ? ` (${hint})` : ""}`);
      }
      const parsed = parseJsonLoose(text);
      return normalizeGeminiSttSegmentsFromPayload(parsed);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (cleanupWav) await cleanupWav();
  }
}

async function transcribeWithGroqAudio(filePath, groqApiKey) {
  if (!groqApiKey) throw new Error("Groq STT requires API key (header x-groq-api-key or GROQ_API_KEY)");

  const buf = await fs.readFile(filePath);
  const filename = path.basename(filePath) || "audio.wav";
  const form = new FormData();
  form.append("file", new Blob([buf]), filename);
  form.append("model", GROQ_STT_MODEL);
  form.append("language", WHISPER_LANGUAGE);
  form.append("temperature", GROQ_STT_TEMPERATURE);
  form.append("response_format", "verbose_json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GROQ_STT_TIMEOUT_MS);
  try {
    const res = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Groq STT HTTP ${res.status} ${errText}`.trim());
    }
    const payload = await res.json();
    const segments = parseWhisperJson(payload);
    if (!segments.length) throw new Error("No transcription segments from Groq");
    return segments;
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeWithWhisperCpp(filePath) {
  if (!WHISPER_MODEL_PATH) {
    throw new Error("WHISPER_MODEL_PATH is required");
  }

  const outBase = path.join(TMP_DIR, `${Date.now()}-${crypto.randomUUID()}`);
  const args = [
    "-m",
    WHISPER_MODEL_PATH,
    "-f",
    filePath,
    "-l",
    WHISPER_LANGUAGE,
    "-bs",
    String(WHISPER_BEAM_SIZE),
    "-bo",
    String(WHISPER_BEST_OF),
    "-tp",
    "0",
    "--output-json",
    "-of",
    outBase,
  ];

  await runCommand(WHISPER_CPP_BIN, args);
  const jsonPath = `${outBase}.json`;
  const raw = await fs.readFile(jsonPath, "utf8");
  const parsed = JSON.parse(raw);
  const segments = parseWhisperJson(parsed);

  await fs.unlink(jsonPath).catch(() => {});
  if (!segments.length) throw new Error("No transcription segments produced");
  return segments;
}

app.get("/health", (_req, res) => {
  const sttIsGroq = STT_ENGINE === "groq";
  const sttIsGemini = STT_ENGINE === "gemini";
  res.json({
    ok: true,
    sttEngine: STT_ENGINE,
    groqSttModel: sttIsGroq ? GROQ_STT_MODEL : null,
    geminiSttModel: sttIsGemini ? GEMINI_MODEL : null,
    engine: sttIsGemini ? "gemini-audio" : sttIsGroq ? "groq-audio" : "whisper.cpp",
    modelConfigured: sttIsGemini ? true : sttIsGroq ? true : Boolean(WHISPER_MODEL_PATH),
    maxSpeakers: DIARIZATION_MAX_SPEAKERS,
    diarizationProvider: "local",
    textCleanupProvider: TEXT_CLEANUP_PROVIDER,
    groqCleanupModel: TEXT_CLEANUP_PROVIDER === "groq" ? GROQ_CLEANUP_MODEL : null,
    geminiCleanupModel: TEXT_CLEANUP_PROVIDER === "gemini" ? GEMINI_CLEANUP_MODEL : null,
    groqContextWindow: TEXT_CLEANUP_PROVIDER === "groq" ? GROQ_CONTEXT_WINDOW : null,
    groqCleanupHintsConfigured: TEXT_CLEANUP_PROVIDER === "groq" ? parseGroqCleanupHints().length > 0 : null,
    groqSummaryModel: GROQ_SUMMARY_MODEL,
    summaryProviderDefault: String(process.env.SUMMARY_PROVIDER || "groq").trim().toLowerCase() || "groq",
    geminiSummaryModel: GEMINI_SUMMARY_MODEL,
    geminiDiarizationOverlay: GEMINI_DIARIZATION_OVERLAY,
    geminiDiarizationModel: GEMINI_DIARIZATION_MODEL,
    geminiOverlayMinSpeakerSec: GEMINI_OVERLAY_MIN_SPEAKER_SEC,
    geminiOverlayMinSpeakerSegments: GEMINI_OVERLAY_MIN_SPEAKER_SEGMENTS,
    geminiOverlaySmoothingConfidence: GEMINI_OVERLAY_SMOOTHING_CONFIDENCE,
    geminiOverlayMinSpeakerMeanConf: GEMINI_OVERLAY_MIN_SPEAKER_MEAN_CONF,
    geminiSttMaxOutputTokens: GEMINI_STT_MAX_OUTPUT_TOKENS,
  });
});

app.post("/api/transcribe", upload.single("file"), async (req, res) => {
  const uploadedPath = req.file?.path;
  if (!uploadedPath) {
    return res.status(400).json({ error: "No file provided" });
  }

  try {
    const groqApiKey = String(req.headers["x-groq-api-key"] || process.env.GROQ_API_KEY || "").trim();
    const userGeminiHeader = String(req.headers["x-gemini-api-key"] || "").trim();
    const skipGemini = /^(1|true|yes|on)$/i.test(String(req.headers["x-skip-gemini"] || "").trim());
    const geminiKeyForReq = userGeminiHeader || (skipGemini ? "" : GEMINI_API_KEY);

    let segments;
    let sttStrategy = "whisper-cpp";
    if (STT_ENGINE === "gemini") {
      segments = await transcribeWithGemini(uploadedPath, geminiKeyForReq);
      sttStrategy = `gemini:${GEMINI_MODEL}`;
    } else if (STT_ENGINE === "groq") {
      try {
        segments = await transcribeWithGroqAudio(uploadedPath, groqApiKey);
        sttStrategy = `groq:${GROQ_STT_MODEL}`;
      } catch (groqErr) {
        segments = await transcribeWithWhisperCpp(uploadedPath);
        sttStrategy = "whisper-cpp-fallback-after-groq-stt-failure";
      }
    } else {
      segments = await transcribeWithWhisperCpp(uploadedPath);
    }

    let geminiOverlaySegments = null;
    if (GEMINI_DIARIZATION_OVERLAY && geminiKeyForReq) {
      try {
        geminiOverlaySegments = await transcribeWithGemini(uploadedPath, geminiKeyForReq, GEMINI_DIARIZATION_MODEL, {
          speakerDiarizationPass: true,
        });
      } catch (err) {
        console.warn("[diarization] gemini-overlay:", String(err?.message || err));
      }
    }

    const wavForDiar = await ensureWavForDiarization(uploadedPath);
    let diarizedSegments = null;
    let diarizationStrategy = "none";
    try {
      if (STT_ENGINE === "gemini") {
        if (Array.isArray(geminiOverlaySegments) && geminiOverlaySegments.length) {
          diarizedSegments = applyGeminiSpeakerOverlay(segments, geminiOverlaySegments);
          diarizationStrategy = "gemini-inline+speaker-overlay";
        } else {
          diarizedSegments = segments;
          diarizationStrategy = "gemini-inline";
        }
      } else if (Array.isArray(geminiOverlaySegments) && geminiOverlaySegments.length) {
        diarizedSegments = applyGeminiSpeakerOverlay(segments, geminiOverlaySegments);
        diarizationStrategy = "gemini-speaker-overlay";
      } else {
        const local = await applyVoiceAwareDiarization(wavForDiar.path, segments);
        diarizedSegments = local.segments;
        diarizationStrategy = local.strategy;
      }
    } finally {
      if (wavForDiar.cleanup) await wavForDiar.cleanup();
    }

    let finalSegments = diarizedSegments;
    let textCleanupStrategy = "none";
    if (TEXT_CLEANUP_PROVIDER === "groq" && STT_ENGINE !== "gemini") {
      try {
        const cleaned = await cleanSegmentsWithGroq(diarizedSegments, groqApiKey);
        finalSegments = cleaned.segments;
        textCleanupStrategy = cleaned.strategy;
      } catch {
        finalSegments = diarizedSegments.map((seg) => ({
          ...seg,
          text: applyDeterministicFrenchCleanup(String(seg?.text || "")),
        }));
        textCleanupStrategy = "groq-failed-deterministic-fallback";
      }
    } else if (TEXT_CLEANUP_PROVIDER === "gemini") {
      try {
        const cleaned = await cleanSegmentsWithGemini(diarizedSegments, geminiKeyForReq);
        finalSegments = cleaned.segments;
        textCleanupStrategy = cleaned.strategy;
      } catch {
        finalSegments = diarizedSegments.map((seg) => ({
          ...seg,
          text: applyDeterministicFrenchCleanup(String(seg?.text || "")),
        }));
        textCleanupStrategy = "gemini-failed-deterministic-fallback";
      }
    }

    return res.json({
      segments: finalSegments,
      meta: {
        engine:
          STT_ENGINE === "gemini"
            ? Array.isArray(geminiOverlaySegments) && geminiOverlaySegments.length
              ? "gemini-audio+inline-diarization+overlay"
              : "gemini-audio+inline-diarization"
            : STT_ENGINE === "groq"
              ? "groq-audio+diarization"
              : "whisper.cpp",
        stt: sttStrategy,
        diarization: diarizationStrategy,
        ...(Array.isArray(geminiOverlaySegments) && geminiOverlaySegments.length
          ? { geminiSpeakerModel: GEMINI_DIARIZATION_MODEL }
          : {}),
        language: WHISPER_LANGUAGE,
        textCleanup: textCleanupStrategy,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    await fs.unlink(uploadedPath).catch(() => {});
  }
});

/** Diarisation locale sur segments existants (sans STT). */
app.post("/api/align-speakers", upload.single("file"), async (req, res) => {
  const uploadedPath = req.file?.path;
  if (!uploadedPath) {
    return res.status(400).json({ error: "No file provided" });
  }

  let segmentsIn;
  try {
    segmentsIn = JSON.parse(String(req.body?.segments || "[]"));
  } catch {
    await fs.unlink(uploadedPath).catch(() => {});
    return res.status(400).json({ error: "Invalid segments JSON" });
  }
  if (!Array.isArray(segmentsIn) || !segmentsIn.length) {
    await fs.unlink(uploadedPath).catch(() => {});
    return res.status(400).json({ error: "segments must be a non-empty array" });
  }

  const segments = segmentsIn.map((seg) => ({
    start: Number(seg?.start) || 0,
    end: Math.max(Number(seg?.start) || 0, Number(seg?.end) || Number(seg?.start) || 0),
    text: String(seg?.text ?? ""),
  }));

  try {
    const wavForDiar = await ensureWavForDiarization(uploadedPath);
    let diarizedSegments = null;
    let diarizationStrategy = "none";
    try {
      const local = await applyVoiceAwareDiarization(wavForDiar.path, segments);
      diarizedSegments = local.segments;
      diarizationStrategy = local.strategy;
    } finally {
      if (wavForDiar.cleanup) await wavForDiar.cleanup();
    }

    return res.json({
      segments: diarizedSegments,
      meta: {
        diarization: diarizationStrategy,
        diarizationProvider: "local",
      },
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    await fs.unlink(uploadedPath).catch(() => {});
  }
});

app.post("/api/episode-summary", upload.single("file"), async (req, res) => {
  const uploadedPath = req.file?.path;
  if (!uploadedPath) {
    return res.status(400).json({ error: "No file provided" });
  }

  try {
    const groqApiKey = String(req.headers["x-groq-api-key"] || process.env.GROQ_API_KEY || "").trim();
    const geminiKeyForReq = String(req.headers["x-gemini-api-key"] || GEMINI_API_KEY || "").trim();
    let segments;
    let sttStrategy = "whisper-cpp";
    if (STT_ENGINE === "gemini") {
      segments = await transcribeWithGemini(uploadedPath, geminiKeyForReq);
      sttStrategy = `gemini:${GEMINI_MODEL}`;
    } else if (STT_ENGINE === "groq") {
      try {
        segments = await transcribeWithGroqAudio(uploadedPath, groqApiKey);
        sttStrategy = `groq:${GROQ_STT_MODEL}`;
      } catch {
        segments = await transcribeWithWhisperCpp(uploadedPath);
        sttStrategy = "whisper-cpp-fallback-after-groq-stt-failure";
      }
    } else {
      segments = await transcribeWithWhisperCpp(uploadedPath);
    }

    if (!Array.isArray(segments) || !segments.length) {
      return res.status(422).json({ error: "No transcription segments for summary" });
    }

    const titleHint = String(req.file?.originalname || "episode").replace(/\.[^/.]+$/, "");
    const summaryProvider = String(
      req.headers["x-summary-provider"] || process.env.SUMMARY_PROVIDER || "groq"
    )
      .trim()
      .toLowerCase();
    const geminiApiKey = geminiKeyForReq;

    let summary;
    let summaryEngine;
    let summaryModelName;
    if (summaryProvider === "gemini") {
      if (!geminiApiKey) {
        return res.status(400).json({
          error: "Résumé Gemini: définir GEMINI_API_KEY (serveur) ou en-tête x-gemini-api-key",
        });
      }
      summary = await summarizeEpisodeWithGemini(segments, geminiApiKey, titleHint);
      summaryEngine = "gemini";
      summaryModelName = GEMINI_SUMMARY_MODEL;
    } else {
      summary = await summarizeEpisodeWithGroq(segments, groqApiKey, titleHint);
      summaryEngine = "groq";
      summaryModelName = GROQ_SUMMARY_MODEL;
    }
    const durationSec = Math.max(0, Number(segments[segments.length - 1]?.end || 0));

    return res.json({
      summary: {
        short: summary.short,
        long: summary.long,
        keyPoints: summary.keyPoints,
        characters: summary.characters,
      },
      meta: {
        stt: sttStrategy,
        summaryProvider: summaryEngine,
        summaryModel: summaryModelName,
        segmentCount: segments.length,
        durationSec,
        chunkCount: summary.chunkCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  } finally {
    await fs.unlink(uploadedPath).catch(() => {});
  }
});


// Config publique pour le frontend
app.get('/api/config', (_req, res) => {
  res.json({ groqApiKey: process.env.GROQ_API_KEY || '', backendUrl: '' });
});

app.listen(PORT, async () => {
  await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});
  console.log(`Backend listening on http://localhost:${PORT}`);
});
