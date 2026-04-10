"use strict";
const crypto = require("crypto");

const PREMIUM_SECRET = String(process.env.PREMIUM_SECRET || "").trim();
const PREMIUM_PIN    = String(process.env.PREMIUM_PIN    || "").trim();
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL   = String(process.env.GEMINI_MODEL   || "gemini-2.5-flash").trim();

const { transcribeWithGemini, cleanSegmentsWithGemini, splitLongSegmentsBackend } = require("./gratuit");

// ── Auth ──────────────────────────────────────────────────────────────────────

function validatePremiumToken(token) {
  if (!PREMIUM_SECRET || !token || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const expiresAt = Number(token.slice(0, dot));
  const hmac = token.slice(dot + 1);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const payload = "premium:" + expiresAt;
  const expected = crypto.createHmac("sha256", PREMIUM_SECRET).update(payload).digest("hex");
  if (expected.length !== hmac.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"));
  } catch { return false; }
}

function handlePremiumAuth(req, res) {
  if (!PREMIUM_PIN || !PREMIUM_SECRET)
    return res.status(503).json({ error: "Premium non configure sur ce serveur." });
  const pin = String(req.body?.pin || "").trim();
  if (!pin || pin !== PREMIUM_PIN)
    return res.status(401).json({ error: "PIN incorrect." });
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000;
  const payload = "premium:" + expiresAt;
  const hmac = crypto.createHmac("sha256", PREMIUM_SECRET).update(payload).digest("hex");
  return res.json({ token: expiresAt + "." + hmac, expiresAt });
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const PREMIUM_STT_SYSTEM_PROMPT =
  "Tu es un moteur de transcription audio professionnel spécialisé en français.\n" +
  "\n" +
  "SORTIE : JSON brut uniquement. Aucun texte avant ou après. Aucun markdown. Aucun backtick.\n" +
  "Format exact — tableau d'objets :\n" +
  '[{"start": 0.00, "end": 2.35, "text": "Bonjour tout le monde.", "speaker": "Speaker 1"}]\n' +
  "\n" +
  "TIMESTAMPS\n" +
  "- Précision : 0.05 s\n" +
  "- start = première milliseconde de voix audible\n" +
  "- end = dernière milliseconde de voix audible (ne jamais arrondir)\n" +
  "- Segment max : 5 secondes STRICT — si un passage dépasse 5 s, couper à la pause ou respiration la plus proche avant la limite\n" +
  "- Pause ≥ 0.3 s = nouvelle frontière de segment obligatoire\n" +
  "\n" +
  "LOCUTEURS\n" +
  "- Un seul speaker par segment — couper immédiatement au changement de voix\n" +
  "- Speaker 1 = première voix entendue ; incrémenter pour chaque timbre distinct\n" +
  "- Voix ambiguë ou hors champ = nouveau speaker séparé, ne jamais deviner\n" +
  "\n" +
  "TEXTE\n" +
  "- Transcription mot pour mot, sans résumé ni paraphrase\n" +
  '- Corriger orthographe et grammaire : "c\'est pas" → "ce n\'est pas", "j\'suis" → "je suis", etc.\n' +
  '- Chiffres en numériques : "22" et non "vingt-deux"\n' +
  '- Bégaiement ou faux départ : "je vou... Je voudrais" (suspension + majuscule à la reprise)\n' +
  "- Filler words (euh, hmm, ah) seuls : rattacher au segment suivant, ne pas supprimer\n" +
  "- Aucun segment avec text vide ou uniquement des espaces";

// ── Handler ───────────────────────────────────────────────────────────────────

async function handlePremiumTranscription(req, uploadedPath) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY manquant dans .env");

  let segments = splitLongSegmentsBackend(
    await transcribeWithGemini(uploadedPath, GEMINI_API_KEY, null, {
      systemPrompt: PREMIUM_STT_SYSTEM_PROMPT,
    })
  );

  if (GEMINI_API_KEY) {
    try {
      const cleaned = await cleanSegmentsWithGemini(segments, GEMINI_API_KEY);
      segments = cleaned.segments;
    } catch (err) {
      console.warn("[premium] Gemini cleanup failed, using raw segments:", String(err?.message || err));
    }
  }

  return {
    segments,
    meta: { stt: `gemini:${GEMINI_MODEL}`, premium: true },
  };
}

module.exports = { validatePremiumToken, handlePremiumTranscription, handlePremiumAuth };
