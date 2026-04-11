"use strict";
const crypto = require("crypto");

const PREMIUM_SECRET = String(process.env.PREMIUM_SECRET || "").trim();
const PREMIUM_PIN    = String(process.env.PREMIUM_PIN    || "").trim();
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL          = String(process.env.GEMINI_MODEL          || "gemini-2.5-pro").trim();
const GEMINI_FALLBACK_MODEL = String(process.env.GEMINI_FALLBACK_MODEL  || "gemini-2.5-flash").trim();

const { transcribeWithGeminiChunked, cleanSegmentsWithGemini, redistributeCompressedClusters, preCapLongSegments, splitLongSegmentsBackend, resolveSegmentOverlaps } = require("./gratuit");

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
  "RÈGLE ABSOLUE : tu dois transcrire et traduire la TOTALITÉ de l'audio du début à la toute dernière seconde, sans exception.\n" +
  "Maintiens exactement le même niveau de détail, la même granularité et la même qualité de timestamps sur toute la durée — ne réduis jamais l'effort à partir de 30 s, 1 min ou à tout autre moment.\n" +
  "Ne saute aucun passage parlé, même bref, même en fond sonore, même après une longue pause ou un changement de scène.\n" +
  "Cette règle s'applique à CHAQUE portion de l'audio sans exception : début, milieu, fin de fichier, peu importe la langue parlée ou la qualité du son.\n" +
  "Si tu reçois un extrait audio court (moins de 30 s), il contient quand même de la parole — transcris et traduis tout jusqu'à la dernière syllabe audible.\n" +
  "\n" +
  "\n" +
  "SORTIE : JSON brut uniquement. Aucun texte avant ou après. Aucun markdown. Aucun backtick.\n" +
  "Format exact — tableau d'objets :\n" +
  '[{"start": 0.00, "end": 2.35, "text": "Bonjour tout le monde.", "speaker": "Speaker 1"}]\n' +
  "Timestamps en secondes décimales, jamais en format SRT/WebVTT (pas de 00:00:00,000 --> ...).\n" +
  "\n" +
  "TIMESTAMPS\n" +
  "- Précision cible : 0.05 s — utilise la milliseconde réelle de l'audio autant que possible\n" +
  "- start = première milliseconde de voix audible dans l'audio original\n" +
  "- end = dernière milliseconde de voix audible dans l'audio original\n" +
  "- Si tu n'es pas certain du timestamp exact (passage traduit, voix faible, montage rapide) : estime au mieux plutôt que d'omettre le segment — un timestamp approximatif vaut mieux qu'un segment manquant\n" +
  "- Traduction : quand tu traduis une langue étrangère en français, aligne start et end sur la durée réelle de la parole étrangère dans l'audio\n" +
  "- Durée minimale par segment : 1.0 s — si la parole est plus courte, étendre end jusqu'à 1.0 s après start\n" +
  "- Durée vraisemblable : ~0.07 s par mot prononcé — un segment de 6 mots ne peut pas durer moins de 0.4 s ; corriger end si nécessaire\n" +
  "- Segment max : 5 secondes STRICT — si un passage dépasse 5 s, couper à la pause ou respiration la plus proche avant la limite\n" +
  "- Pause ≥ 0.5 s = nouvelle frontière de segment, sauf si le segment résultant ferait moins de 1.0 s — dans ce cas, fusionner avec le segment suivant\n" +
  "- Continuité : si un passage est non-verbal (musique, silence, bruit ambiant), ne pas insérer de segment — laisser le trou tel quel, ne jamais écrire [musique], [silence], [rires], [exclamation] ou tout autre marqueur entre crochets\n" +
  "\n" +
  "LOCUTEURS\n" +
  "- Un seul speaker par segment — couper immédiatement au changement de voix\n" +
  "- Speaker 1 = première voix entendue ; incrémenter pour chaque timbre distinct\n" +
  "- Voix ambiguë ou hors champ = nouveau speaker séparé, ne jamais deviner\n" +
  "\n" +
  "LISIBILITE\n" +
  "- Vitesse de lecture cible : 17 caractères/seconde — ex : un segment de 34 caractères doit durer ≥ 2.0 s\n" +
  "- Si le texte dépasse cette vitesse, étendre end (dans la limite de la pause suivante) ou couper le segment en deux\n" +
  "- Longueur max par segment : 80 caractères\n" +
  "\n" +
  "TEXTE\n" +
  "- Transcription mot pour mot, sans résumé ni paraphrase\n" +
  "- Corriger orthographe, accents, accords et apostrophes\n" +
  "- Langue : tout texte prononcé en anglais ou dans une autre langue doit être traduit en français naturel dans le champ text — ne jamais laisser de mots étrangers non traduits, sauf les noms propres et les titres\n" +
  "  · Exemples : \"How are you?\" → \"Comment vas-tu ?\", \"Nice to meet you\" → \"Ravi de te rencontrer\", \"Welcome\" → \"Bienvenue\"\n" +
  '- Chiffres en numériques : "22" et non "vingt-deux"\n' +
  '- Bégaiement ou faux départ : "je vou... Je voudrais" (suspension + majuscule à la reprise)\n' +
  "- Filler words (euh, hmm, ah) seuls : rattacher au segment suivant, ne pas supprimer\n" +
  "- Aucun segment avec text vide ou uniquement des espaces\n" +
  "- Négation : rétablir systématiquement le 'ne/n\\'' supprimé à l'oral :\n" +
  "  · \"c'est pas\" → \"ce n'est pas\" | \"c'est rien\" → \"ce n'est rien\" | \"c'est jamais\" → \"ce n'est jamais\"\n" +
  "  · \"j'ai pas\" → \"je n'ai pas\" | \"j'ai rien\" → \"je n'ai rien\" | \"j'ai jamais\" → \"je n'ai jamais\"\n" +
  "  · \"je suis pas\" / \"j'suis pas\" → \"je ne suis pas\"\n" +
  "  · \"je veux pas\" / \"j'veux pas\" → \"je ne veux pas\"\n" +
  "  · \"je peux pas\" / \"j'peux pas\" → \"je ne peux pas\"\n" +
  "  · \"je sais pas\" / \"j'sais pas\" → \"je ne sais pas\"\n" +
  "  · \"je comprends pas\" / \"j'comprends pas\" → \"je ne comprends pas\"\n" +
  "  · \"je vais pas\" / \"j'vais pas\" → \"je ne vais pas\"\n" +
  "  · \"tu as pas\" / \"t'as pas\" → \"tu n'as pas\"\n" +
  "  · \"tu es pas\" / \"t'es pas\" → \"tu n'es pas\"\n" +
  "  · \"tu fais pas\" → \"tu ne fais pas\"\n" +
  "  · \"il est pas\" → \"il n'est pas\" | \"elle est pas\" → \"elle n'est pas\"\n" +
  "  · \"il fait pas\" → \"il ne fait pas\" | \"elle fait pas\" → \"elle ne fait pas\"\n" +
  "  · \"on a pas\" → \"on n'a pas\" | \"on est pas\" → \"on n'est pas\"\n" +
  "  · \"il y a pas\" / \"y'a pas\" → \"il n'y a pas\"\n" +
  "  · \"ça va pas\" → \"ça ne va pas\" | \"ça marche pas\" → \"ça ne marche pas\"\n" +
  "  · \"ils font pas\" → \"ils ne font pas\" | \"elles font pas\" → \"elles ne font pas\"\n" +
  "  · Règle générale : [sujet] + [verbe] + pas/rien/jamais/plus/personne sans 'ne' → insérer 'ne/n\\'' avant le verbe\n" +
  "\n" +
  "ORTHOGRAPHE EXPERTE\n" +
  "- Traits d'union obligatoires :\n" +
  "  · Impératif + pronom : \"parle-lui\", \"dis-moi\", \"donne-le\", \"écoute-la\", \"regarde-les\", \"arrête-toi\", \"lève-toi\", \"assieds-toi\", \"va-t'en\", \"dépêche-toi\"\n" +
  "  · Règle générale : tout verbe à l'impératif suivi d'un pronom personnel (moi, toi, lui, elle, nous, vous, leur, le, la, les, y, en) prend un trait d'union\n" +
  "  · Adverbes et locutions : \"peut-être\", \"c'est-à-dire\", \"vis-à-vis\", \"au-dessus\", \"au-dessous\", \"au-delà\", \"ci-dessus\", \"ci-dessous\"\n" +
  "  · Noms composés courants : \"rendez-vous\", \"laissez-passer\", \"savoir-faire\", \"faire-part\"\n" +
  "- Apostrophes et élisions :\n" +
  "  · \"ce que\" → \"ce qu'\" devant voyelle | \"de le\" → \"du\" | \"de les\" → \"des\" | \"à le\" → \"au\" | \"à les\" → \"aux\"\n" +
  "  · \"jusque à\" → \"jusqu'à\" | \"lorsque il/elle\" → \"lorsqu'il/elle\" | \"puisque il\" → \"puisqu'il\"\n" +
  "- Majuscules :\n" +
  "  · Majuscule après point, point d'exclamation, point d'interrogation et début de segment avec nouveau locuteur\n" +
  "  · Pas de majuscule après virgule, point-virgule ou deux-points en milieu de phrase\n" +
  "- Ponctuation française :\n" +
  "  · Espace insécable avant : ! ? : ; (ex: \"Quoi ?\", \"Voilà !\")\n" +
  "  · Guillemets français : « texte » avec espaces insécables intérieures\n" +
  "  · Points de suspension : \"…\" (caractère unique) et non \"...\" (trois points)\n" +
  "- Accords fréquemment fautifs à l'oral :\n" +
  "  · \"tout\" adverbe est invariable devant adjectif féminin commençant par consonne : \"elle est tout heureuse\" → \"toute heureuse\"\n" +
  "  · Participe passé avec avoir : accord avec COD placé avant (\"la chanson qu'il a chantée\")\n" +
  "  · \"même\" : adverbe invariable (\"même les grands\") vs adjectif variable (\"les mêmes erreurs\")\n" +
  "- Anglicismes oraux à corriger :\n" +
  "  · \"checker\" → \"vérifier\" | \"booker\" → \"réserver\" | \"fixer\" → \"organiser\" si contexte le permet\n" +
  "  · Conserver les anglicismes propres à l'univers médiatique/culturel (\"le buzz\", \"un clash\", \"le game\") qui font partie du registre";

// ── Handler ───────────────────────────────────────────────────────────────────

async function handlePremiumTranscription(req, uploadedPath) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY manquant dans .env");

  const sttOptions = { systemPrompt: PREMIUM_STT_SYSTEM_PROMPT };
  const pipeline = (segs) => resolveSegmentOverlaps(splitLongSegmentsBackend(preCapLongSegments(redistributeCompressedClusters(segs))));
  const sleep    = (ms) => new Promise((r) => setTimeout(r, ms));

  const modelsToTry  = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];
  const MAX_ATTEMPTS = 4;   // tentatives par modèle sur 503
  const RETRY_DELAY  = 10000; // 10s entre chaque retry
  let usedModel = GEMINI_MODEL;
  let segments;
  let lastErr;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          console.warn(`[premium] 503 sur ${model} — retry dans ${RETRY_DELAY / 1000}s (tentative ${attempt}/${MAX_ATTEMPTS})`);
          await sleep(RETRY_DELAY);
        }
        segments = pipeline(await transcribeWithGeminiChunked(uploadedPath, GEMINI_API_KEY, model, sttOptions));
        usedModel = model;
        lastErr   = null;
        break;
      } catch (err) {
        lastErr = err;
        const msg   = String(err?.message || "");
        const is503 = msg.includes("503");
        const is404 = msg.includes("404");
        if (!is503 || is404) break; // 404 = modèle inexistant, autres = erreur définitive
      }
    }
    if (!lastErr) break;
    console.warn(`[premium] ${model} indisponible (${String(lastErr?.message || lastErr).slice(0, 100)})`);
  }

  if (lastErr) throw lastErr;

  return {
    segments,
    meta: { stt: `gemini:${usedModel}`, premium: true },
  };
}

module.exports = { validatePremiumToken, handlePremiumTranscription, handlePremiumAuth };
