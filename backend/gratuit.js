"use strict";
const fs      = require("fs/promises");
const path    = require("path");
const os      = require("os");
const { spawn } = require("child_process");
const crypto  = require("crypto");
const WavDecoder = require("wav-decoder");

const DEFAULT_LOCAL_BIN = path.join(__dirname, "bin", "whispercpp", "Release", "whisper-cli.exe");
const DEFAULT_LOCAL_MODEL = path.join(__dirname, "models", "ggml-base.bin");
const resolveMaybeRelative = (p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p));
const WHISPER_CPP_BIN = resolveMaybeRelative(process.env.WHISPER_CPP_BIN || DEFAULT_LOCAL_BIN);
const WHISPER_MODEL_PATH = resolveMaybeRelative(process.env.WHISPER_MODEL_PATH || DEFAULT_LOCAL_MODEL);
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || "fr";
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
const GEMINI_API_BASE = String(process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta")
  .trim()
  .replace(/\/$/, "");
const GEMINI_TIMEOUT_MS = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS || GROQ_TIMEOUT_MS));
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const GEMINI_CLEANUP_MODEL = String(process.env.GEMINI_CLEANUP_MODEL || "gemini-2.5-flash").trim();
const GEMINI_CLEANUP_TEMPERATURE = Number(process.env.GEMINI_CLEANUP_TEMPERATURE ?? 0);
const GEMINI_STT_MAX_OUTPUT_TOKENS = Math.max(2048, Number(process.env.GEMINI_STT_MAX_OUTPUT_TOKENS || 8192));
const TMP_DIR = path.join(os.tmpdir(), "transcription-tools");

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

function applyDeterministicFrenchCleanup(input) {
  let text = String(input || "");
  text = applyFrenchContractionRules(text);
  text = applyFrenchNegationRules(text);
  text = normalizeFrenchTypography(text);
  return text;
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
  text = text.replace(/'/g, "'");
  text = text.replace(/\b([Qq])u['']\s+([aeiouyhàâäéèêëîïôöùûüœ])/g, (_m, q, v) => `${q}u'${v}`);
  text = text.replace(/\b([Qq])ue\s+([aeiouyhàâäéèêëîïôöùûüœ])/g, (_m, q, v) => `${q}u'${v}`);
  text = text.replace(/\b([Dd])e\s+le\b/g, (_m, d) => capitalizeLike(d, "du"));
  text = text.replace(/\b([Dd])e\s+les\b/g, (_m, d) => capitalizeLike(d, "des"));
  return text;
}

function applyFrenchNegationRules(input) {
  let text = String(input || "");
  if (!text) return text;
  text = text.replace(/\b([Cc])['']est\s+pas\b/g, (_m, c) => `${capitalizeLike(c, "ce")} n'est pas`);
  text = text.replace(/\b([Jj])['']ai\s+pas\b/g, (_m, j) => `${capitalizeLike(j, "je")} n'ai pas`);
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

function parseGroqCleanupHints() {
  const raw = String(process.env.GROQ_CLEANUP_HINTS || "");
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 80);
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

async function handleFreeTranscription(req, uploadedPath) {
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
    } catch {
      segments = await transcribeWithWhisperCpp(uploadedPath);
      sttStrategy = "whisper-cpp-fallback-after-groq-stt-failure";
    }
  } else {
    segments = await transcribeWithWhisperCpp(uploadedPath);
  }

  let finalSegments = segments;
  let textCleanupStrategy = "none";
  if (TEXT_CLEANUP_PROVIDER === "groq" && STT_ENGINE !== "gemini") {
    try {
      const cleaned = await cleanSegmentsWithGroq(segments, groqApiKey);
      finalSegments = cleaned.segments;
      textCleanupStrategy = cleaned.strategy;
    } catch {
      finalSegments = segments.map((seg) => ({
        ...seg,
        text: applyDeterministicFrenchCleanup(String(seg?.text || "")),
      }));
      textCleanupStrategy = "groq-failed-deterministic-fallback";
    }
  } else if (TEXT_CLEANUP_PROVIDER === "gemini") {
    try {
      const cleaned = await cleanSegmentsWithGemini(segments, geminiKeyForReq);
      finalSegments = cleaned.segments;
      textCleanupStrategy = cleaned.strategy;
    } catch {
      finalSegments = segments.map((seg) => ({
        ...seg,
        text: applyDeterministicFrenchCleanup(String(seg?.text || "")),
      }));
      textCleanupStrategy = "gemini-failed-deterministic-fallback";
    }
  }

  return {
    segments: finalSegments,
    meta: {
      stt: sttStrategy,
      language: WHISPER_LANGUAGE,
      textCleanup: textCleanupStrategy,
    },
  };
}

module.exports = { handleFreeTranscription, cleanSegmentsWithGemini, transcribeWithGemini };
