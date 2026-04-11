"use strict";

// ─── Utilitaires Gemini (depuis gratuit.js) ───────────────────────────────────
const {
  transcribeWithGeminiChunked,
  resolveSegmentOverlaps,
  splitLongSegmentsBackend,
  preCapLongSegments,
  redistributeCompressedClusters,
} = require("./gratuit");

// ─── Configuration ─────────────────────────────────────────────────────────────
const GEMINI_API_KEY        = String(process.env.GEMINI_API_KEY        || "").trim();
const GEMINI_MODEL          = String(process.env.GEMINI_MODEL          || "gemini-2.5-pro").trim();
const GEMINI_FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash").trim();

const MAX_ATTEMPTS_PER_MODEL = 4;      // tentatives par modèle sur erreur 503
const RETRY_DELAY_MS         = 10_000; // délai entre chaque retry

// ─── Prompt système STT ────────────────────────────────────────────────────────
// Instructions précises pour une transcription FR professionnelle :
// timestamps précis, diarisation des locuteurs, orthographe experte,
// ponctuation française, rétablissement de la négation, traduction de l'anglais.
const STT_SYSTEM_PROMPT =
  "Tu es un moteur de transcription audio professionnel spécialisé en français.\n" +
  "RÈGLE ABSOLUE : tu dois transcrire et traduire la TOTALITÉ de l'audio du début à la toute dernière seconde, sans exception.\n" +
  "Maintiens exactement le même niveau de détail, la même granularité et la même qualité de timestamps sur toute la durée — ne réduis jamais l'effort à partir de 30 s, 1 min ou à tout autre moment.\n" +
  "Ne saute aucun passage parlé, même bref, même en fond sonore, même après une longue pause ou un changement de scène.\n" +
  "\n" +
  "SORTIE : JSON brut uniquement. Aucun texte avant ou après. Aucun markdown. Aucun backtick.\n" +
  "Format exact — tableau d'objets :\n" +
  '[{"start": 0.00, "end": 2.35, "text": "Bonjour tout le monde.", "speaker": "Speaker 1"}]\n' +
  "Timestamps en secondes décimales, jamais en format SRT/WebVTT (pas de 00:00:00,000 --> ...).\n" +
  "\n" +
  "TIMESTAMPS\n" +
  "- Précision cible : 0.05 s — utilise la milliseconde réelle de l'audio autant que possible\n" +
  "- start = première milliseconde de voix audible | end = dernière milliseconde de voix audible\n" +
  "- Durée minimale par segment : 1.0 s\n" +
  "- Segment max : 5 secondes STRICT — couper à la pause ou respiration la plus proche\n" +
  "- Pause ≥ 0.5 s = nouvelle frontière de segment\n" +
  "- Pas de segment pour musique, silence ou bruits ambiants — laisser le trou tel quel\n" +
  "\n" +
  "LOCUTEURS\n" +
  "- Un seul speaker par segment — couper immédiatement au changement de voix\n" +
  "- Speaker 1 = première voix entendue ; incrémenter pour chaque timbre distinct\n" +
  "\n" +
  "LISIBILITE\n" +
  "- Vitesse de lecture cible : 17 caractères/seconde\n" +
  "- Longueur max par segment : 80 caractères\n" +
  "\n" +
  "TEXTE\n" +
  "- Transcription mot pour mot, sans résumé ni paraphrase\n" +
  "- Corriger orthographe, accents, accords et apostrophes\n" +
  "- Traduire tout passage en anglais ou autre langue en français naturel (sauf noms propres)\n" +
  "- Rétablir systématiquement la négation supprimée à l'oral :\n" +
  '  · "c\'est pas" → "ce n\'est pas" | "j\'ai pas" → "je n\'ai pas" | "y\'a pas" → "il n\'y a pas"\n' +
  "- Chiffres en numériques : \"22\" et non \"vingt-deux\"\n" +
  "- Ponctuation française : espace insécable avant ! ? : ; — guillemets « texte »\n" +
  "- Traits d'union obligatoires à l'impératif : \"parle-lui\", \"dis-moi\", \"va-t'en\"\n" +
  "- Aucun segment avec text vide ou uniquement des espaces";

// ─── Pipeline de post-traitement ───────────────────────────────────────────────
// Corrige les anomalies courantes produites par Gemini :
//  - clusters de segments artificiellement compressés (timestamps de 120ms)
//  - end absurdes (segment de 3 mots étalé sur 40s)
//  - segments trop longs (> 8s)
//  - chevauchements entre segments consécutifs
function postProcess(segments) {
  return resolveSegmentOverlaps(
    splitLongSegmentsBackend(
      preCapLongSegments(
        redistributeCompressedClusters(segments)
      )
    )
  );
}

// ─── Handler principal ────────────────────────────────────────────────────────
/**
 * Transcrit un fichier audio/vidéo via l'API Gemini.
 *
 * Flux complet :
 *   1. Conversion en MP3 si nécessaire (ffmpeg)
 *   2. Découpe en chunks de ~50 s pour les fichiers longs
 *   3. Envoi parallèle à Gemini avec le prompt STT expert
 *   4. Retry automatique sur 503 (jusqu'à 4 tentatives par modèle)
 *   5. Fallback vers GEMINI_FALLBACK_MODEL si le modèle principal échoue
 *   6. Post-traitement : résolution des chevauchements, capping, redistribution
 *
 * @param {object} _req          - Requête Express (non utilisée, conservée pour compatibilité)
 * @param {string} uploadedPath  - Chemin du fichier temporaire uploadé
 * @returns {{ segments: Array, meta: object }}
 */
async function handleTranscription(_req, uploadedPath) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY manquant dans .env");

  const sleep        = (ms) => new Promise((r) => setTimeout(r, ms));
  const modelsToTry  = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  let segments, usedModel, lastErr;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        if (attempt > 1) {
          console.warn(
            `[transcription] 503 sur ${model} — retry ${attempt}/${MAX_ATTEMPTS_PER_MODEL} dans ${RETRY_DELAY_MS / 1000}s`
          );
          await sleep(RETRY_DELAY_MS);
        }

        const raw = await transcribeWithGeminiChunked(uploadedPath, GEMINI_API_KEY, model, {
          systemPrompt: STT_SYSTEM_PROMPT,
        });

        segments  = postProcess(raw);
        usedModel = model;
        lastErr   = null;
        break; // succès → sortir de la boucle retry
      } catch (err) {
        lastErr = err;
        const msg   = String(err?.message || "");
        const is503 = msg.includes("503");
        const is404 = msg.includes("404"); // modèle inexistant → ne pas retenter
        if (!is503 || is404) break;        // erreur définitive → passer au modèle suivant
      }
    }

    if (!lastErr) break; // succès → sortir de la boucle de modèles
    console.warn(`[transcription] ${model} indisponible — passage au modèle suivant`);
  }

  if (lastErr) throw lastErr;

  return {
    segments,
    meta: { stt: `gemini:${usedModel}` },
  };
}

module.exports = { handleTranscription };
