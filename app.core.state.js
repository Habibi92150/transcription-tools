  "use strict";

  // ========= DOM / state =========
  const $ = (id) => document.getElementById(id);
  const pickBtn = $("pickBtn");
  const runBtn = $("runBtn");
  const fileInput = $("fileInput");
  const apiKeyInput = $("apiKeyInput");
  const localMode = $("localMode");
  const tierFreeBtn = $("tierFreeBtn");
  const tierPaidBtn = $("tierPaidBtn");
  const backendUrlInput = $("backendUrlInput");
  const backendUrlRow = $("backendUrlRow");
  const geminiKeyField = $("geminiKeyField");
  const geminiApiKeyInput = $("geminiApiKeyInput");
  const dropzone = $("dropzone");
  const extractRow = $("extractRow");
  const extractAudio = $("extractAudio");
  const fileProtocolBanner = $("fileProtocolBanner");
  const uploadPanel = $("upload-panel");
  const progressPanel = $("progress-panel");
  const exportPanel = $("export-panel");
  const progressFill = $("progressFill");
  const progressBar = $("progressBar");
  const progressEta = $("progressEta");
  const progressRemain = $("progressRemain");
  const actionRow = $("actionRow");
  const dzFileName = $("dzFileName");
  const dzFileMeta = $("dzFileMeta");
  const changeFileBtn = $("changeFileBtn");
  const newTranscriptionBtn = $("newTranscriptionBtn");
  const exportMeta = $("exportMeta");
  const srStatus = $("sr-status");
  const reviewMode = $("reviewMode");
  const reviewPanel = $("review-panel");
  const reviewPlayer = $("reviewPlayer");
  const reviewAudioPlayer = $("reviewAudioPlayer");
  const reviewOverlay = $("reviewOverlay");
  const reviewOverlaySpeaker = $("reviewOverlaySpeaker");
  const reviewOverlayText = $("reviewOverlayText");
  const reviewCaptionPanel = $("reviewCaptionPanel");
  const reviewCaptionSpeaker = $("reviewCaptionSpeaker");
  const reviewCaptionText = $("reviewCaptionText");
  const reviewOverlayToggle = $("reviewOverlayToggle");
  const reviewPanelToggle = $("reviewPanelToggle");
  const reviewList = $("reviewList");
  const reviewMeta = $("reviewMeta");
  const reviewDownloadBtn = $("reviewDownloadBtn");
  const reviewResetBtn = $("reviewResetBtn");
  const reviewCaptureBtn = $("reviewCaptureBtn");
  const reviewWordingGenerateBtn = $("reviewWordingGenerateBtn");
  const reviewWordingSource = $("reviewWordingSource");
  const reviewWordingStatus = $("reviewWordingStatus");
  const reviewWordingList = $("reviewWordingList");
  const dropzone2 = $("dropzone2");
  const pickBtn2 = $("pickBtn2");
  const runBtn2 = $("runBtn2");
  const fileInput2 = $("fileInput2");
  const changeFileBtn2 = $("changeFileBtn2");
  const dzFileName2 = $("dzFileName2");
  const dzFileMeta2 = $("dzFileMeta2");
  const extractRow2 = $("extractRow2");
  const extractAudio2 = $("extractAudio2");
  const summaryProviderSelect = $("summaryProviderSelect");
  const geminiApiKeyInput2 = $("geminiApiKeyInput2");
  const geminiKeyRow2 = $("geminiKeyRow2");
  const actionRow2 = $("actionRow2");
  const summaryUploadPanel = $("summary-upload-panel");
  const summaryProgressPanel = $("summary-progress-panel");
  const summaryResultPanel = $("summary-result-panel");
  const progressFill2 = $("progressFill2");
  const progressBar2 = $("progressBar2");
  const progressEta2 = $("progressEta2");
  const progressRemain2 = $("progressRemain2");
  const summaryMeta2 = $("summaryMeta2");
  const summaryShort2 = $("summaryShort2");
  const summaryLong2 = $("summaryLong2");
  const summaryPoints2 = $("summaryPoints2");
  const summaryCopyBtn2 = $("summaryCopyBtn2");
  const summaryNewBtn2 = $("summaryNewBtn2");
  const appPinGate = $("appPinGate");
  const appPinForm = $("appPinForm");
  const appPinTitle = $("appPinTitle");
  const appPinHint = $("appPinHint");
  const appPinInput = $("appPinInput");
  const appPinConfirmWrap = $("appPinConfirmWrap");
  const appPinConfirmInput = $("appPinConfirmInput");
  const appPinError = $("appPinError");

  const API_KEY_STORAGE_KEY = "groq_api_key_transcription";
  const GEMINI_KEY_STORAGE = "transcriptor_gemini_key";
  const EXTRACT_AUDIO_PREF_KEY = "groq_extract_audio_pref";
  const LOCAL_MODE_STORAGE_KEY = "local_backend_mode";
  const BACKEND_URL_STORAGE_KEY = "local_backend_url";
  const REVIEW_MODE_STORAGE_KEY = "review_mode_enabled";
  const EPISODE_SUMMARY_EXTRACT_PREF_KEY = "episode_summary_extract_audio_pref";
  const EPISODE_SUMMARY_PROVIDER_KEY = "episode_summary_llm_provider";
  const EPISODE_SUMMARY_GEMINI_KEY = "episode_summary_gemini_api_key";
  const APP_PIN_CODE_STORAGE_KEY = "app_pin_code";
  const APP_PIN_UNLOCKED_STORAGE_KEY = "app_pin_unlocked";
  const APP_PIN_FIXED_CODE = "2912";
  const DEFAULT_BACKEND_URL = "https://adamstudio.duckdns.org";
  const JOB_STATS_KEY = "transcriptor_job_stats_v1";
  const JOB_STATS_MAX = 18;

  const ETA_TRANSCRIBE = "Transcription en cours…";
  const ETA_FINALIZE = "Finalisation du .srt…";
  const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
  const WORDING_MODEL = "llama-3.3-70b-versatile";
  const WORDING_MOODS = ["Humour", "Émotion", "Tension", "Inspiration", "Impact"];
  const WORDING_MAX_CHARS = 150;
  const WORDING_BRIEF_DEFAULTS = Object.freeze({
    platform: "INSTAGRAM",
    tone: "engageant, social-first, premium accessible",
    audience: "18-35 digital natives, French market",
    objective: "ENGAGEMENT",
    language: "FR",
    maxChars: WORDING_MAX_CHARS,
  });
  /** Fenêtre max envoyée à Groq pour les wordings (transcription concaténée, puis début+milieu+fin si trop long). */
  const WORDING_TRANSCRIPT_MAX_CHARS = 14000;
  const WORDING_TRANSCRIPT_OMIT_MARKER =
    "\n\n[… passage omis — limite fenêtre wording ; le texte complet reste dans la relecture …]\n\n";

  function buildCompressedTranscriptForWordings(fullText) {
    const raw = String(fullText || "").trim();
    const n = raw.length;
    if (!n) return { excerpt: "", truncated: false, originalChars: 0, excerptChars: 0 };
    if (n <= WORDING_TRANSCRIPT_MAX_CHARS) {
      return { excerpt: raw, truncated: false, originalChars: n, excerptChars: n };
    }
    const marker = WORDING_TRANSCRIPT_OMIT_MARKER;
    const budget = WORDING_TRANSCRIPT_MAX_CHARS - marker.length * 2;
    const headLen = Math.floor(budget * 0.48);
    const midLen = Math.floor(budget * 0.24);
    const tailLen = Math.max(0, budget - headLen - midLen);
    const midStart = Math.max(headLen, Math.floor((n - midLen) / 2));
    const excerpt =
      raw.slice(0, headLen) + marker + raw.slice(midStart, midStart + midLen) + marker + raw.slice(-tailLen);
    return { excerpt, truncated: true, originalChars: n, excerptChars: excerpt.length };
  }
  /** Q1 2026 hook / algo guidance injected into wording generation (TrendPack). */
  const WORDING_TREND_PACK = Object.freeze({
    trendpack_date: "Q1 2026",
    sources: ["Instagram algorithm data", "TikTok creator insights", "X engagement reports"],
    top_hook_patterns: [
      {
        format: "Fragment universel",
        structure: "[Situation relatable sans explication]",
        example: "Faire les courses en étant affamé",
        why: "Pas besoin de contexte — l'audience complète mentalement, arrêt du scroll garanti",
      },
      {
        format: "POV",
        structure: "POV : [situation immédiatement reconnaissable]",
        example: "POV : les parents à 10h du mat' le dimanche",
        why: "Format natif TikTok / Reels, crée identification instantanée",
      },
      {
        format: "Question rhétorique courte",
        structure: "[Question qui crée un doute ou un débat] ?",
        example: "Vous pensez qu'il l'a vraiment inventé sur le moment ?",
        why: "Déclenche les commentaires, signal fort pour l'algorithme en 2026",
      },
      {
        format: "Contrarian / ironie",
        structure: "[Affirmation qui va à l'encontre de l'évidence]",
        example: "Point faible : être trop fort",
        why: "Crée friction cognitive, force la relecture",
      },
      {
        format: "Two words max",
        structure: "[Adjectif ou nom] + [intensificateur ou rien]",
        example: "Trahison max",
        why: "Micro-format dominant sur X et Stories — dit tout sans rien expliquer",
      },
    ],
    algorithm_signals_2026: {
      priority_metrics: ["saves", "shares", "comment replies"],
      hook_window: "first 1.7 seconds / first 125 characters",
      optimal_reel_length: "30-90 seconds",
      hashtags: "3-5 max, keyword-first strategy over hashtag volume",
      caption_seo:
        "Keywords in first 2 sentences — Instagram AI reads captions for ranking",
    },
    what_is_dying: [
      "Generic action verbs in hooks (Découvrez, Ne manquez pas, Game-changer)",
      "30+ hashtags",
      "Production quality as differentiator",
      "Chasing virality over community",
    ],
    what_is_winning: [
      "Unpolished authenticity + strong structure",
      "Recurring formats / signature series",
      "Micro clips as entry points to longer content",
      "Community identity hooks (inside jokes, shared references)",
      "Saves-driven CTAs (Save this, Revenez-y)",
    ],
  });
  const WORDING_MOOD_COLORS = {
    Humour: "255,184,92",
    Émotion: "255,118,156",
    Emotion: "255,118,156",
    Tension: "255,102,102",
    Inspiration: "113,190,255",
    Impact: "146,132,255",
  };

  let selectedFile = null;
  let selectedFile2 = null;
  let ffmpegBundlePromise = null;
  let reviewState = null;
  let reviewMediaUrl = null;
  let reviewActiveIndex = -1;
  let wordingState = { loading: false, items: [], source: "" };
  let summaryPulseTimer2 = null;
  let appUnlocked = false;

  function showPinError(msg) {
    if (!appPinError) return;
    appPinError.textContent = msg;
    appPinError.classList.remove("hidden");
  }

  function clearPinError() {
    if (!appPinError) return;
    appPinError.textContent = "";
    appPinError.classList.add("hidden");
  }

  function normalizePin(value) {
    return String(value || "").replace(/\D+/g, "").slice(0, 8);
  }

  function applyAppLockState(unlocked) {
    appUnlocked = Boolean(unlocked);
    document.body.classList.toggle("app-locked", !appUnlocked);
    if (appPinGate) appPinGate.classList.toggle("hidden", appUnlocked);
  }

  function unlockApp() {
    localStorage.setItem(APP_PIN_UNLOCKED_STORAGE_KEY, "1");
    applyAppLockState(true);
  }

  function initPinGate() {
    if (!appPinGate || !appPinForm || !appPinInput) return;
    // PIN fixe demandé par le projet.
    localStorage.setItem(APP_PIN_CODE_STORAGE_KEY, APP_PIN_FIXED_CODE);
    applyAppLockState(false);

    const stopIfLocked = (e) => {
      if (appUnlocked) return;
      if (appPinGate.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", stopIfLocked, true);
    document.addEventListener("click", stopIfLocked, true);
    document.addEventListener(
      "keydown",
      (e) => {
        if (appUnlocked) return;
        if (appPinGate.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        appPinInput.focus();
      },
      true
    );

    const alreadyUnlocked = localStorage.getItem(APP_PIN_UNLOCKED_STORAGE_KEY) === "1";
    if (alreadyUnlocked) {
      applyAppLockState(true);
      return;
    }
    if (appPinTitle) appPinTitle.textContent = "Accès à l'application";
    if (appPinHint) appPinHint.textContent = "Saisis ton code PIN pour continuer.";
    if (appPinConfirmWrap) appPinConfirmWrap.classList.add("hidden");
    appPinInput.focus();

    appPinForm.addEventListener("submit", (e) => {
      e.preventDefault();
      clearPinError();
      const pin = normalizePin(appPinInput.value);
      if (!/^\d{4}$/.test(pin)) {
        showPinError("Le PIN doit contenir exactement 4 chiffres.");
        return;
      }
      if (pin !== APP_PIN_FIXED_CODE) {
        showPinError("Code PIN incorrect.");
        return;
      }
      unlockApp();
    });
  }

  function loadJobStats() {
    try {
      const raw = localStorage.getItem(JOB_STATS_KEY);
      const arr = JSON.parse(raw || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function saveJobStats(arr) {
    localStorage.setItem(JOB_STATS_KEY, JSON.stringify(arr.slice(-JOB_STATS_MAX)));
  }

  function recordJobStat(bytes, mode, totalMs) {
    const arr = loadJobStats();
    arr.push({
      bytes: Math.max(1, bytes),
      mode,
      ms: Math.max(800, totalMs),
      at: Date.now(),
    });
    saveJobStats(arr);
  }

  function medianLearnedTotalMs(bytes, mode) {
    const all = loadJobStats().filter((s) => s.mode === mode);
    if (!all.length) return null;
    const nearby = all.filter((s) => s.bytes >= bytes * 0.3 && s.bytes <= bytes * 3.5);
    const pool = nearby.length >= 2 ? nearby : all;
    const sorted = [...pool].map((s) => s.ms).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function heuristicTotalJobMs(bytes, mode, heavyPrep) {
    const learned = medianLearnedTotalMs(bytes, mode);
    if (learned) return Math.round(learned * 1.06);
    const mb = bytes / (1024 * 1024);
    const prep = heavyPrep ? 18000 : 4500;
    const upload = Math.min(200000, 2500 + mb * 4000);
    const server =
      mode === "local"
        ? Math.max(43000, 24000 + mb * 18500)
        : Math.max(25000, 12000 + mb * 3500);
    return Math.round(prep + upload + server);
  }

  function formatRemainMs(ms) {
    if (ms == null || !Number.isFinite(ms)) return "";
    const s = Math.ceil(ms / 1000);
    if (s <= 0) return "Bientôt terminé…";
    if (s < 8) return "Quelques secondes…";
    if (s < 60) return `≈ ${s} s restantes`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `≈ ${m} min ${String(r).padStart(2, "0")} s`;
  }

  let remainTimerId = null;
  let remainCtx = null;

  function stopRemainTimer() {
    if (remainTimerId) {
      clearInterval(remainTimerId);
      remainTimerId = null;
    }
    remainCtx = null;
    if (progressRemain) progressRemain.textContent = "";
  }

  function computePredictedEnd(remainCtx, now) {
    let end = remainCtx.predictedEnd;
    // Ne pas extrapoler l'upload une fois 100 % chargé : sinon uploadLeft=0 et
    // end = now + serverAfterUploadMs*1.02 → temps restant constant (bug si un
    // onprogress tardif remet phase "upload" après upload.onload).
    if (
      remainCtx.phase === "upload" &&
      remainCtx.uploadStart &&
      remainCtx.lastLoaded > 2048 &&
      remainCtx.lastLoaded < remainCtx.bytes
    ) {
      const dt = now - remainCtx.uploadStart;
      if (dt > 250) {
        const inst = remainCtx.lastLoaded / dt;
        remainCtx.smoothBps = remainCtx.smoothBps == null ? inst : remainCtx.smoothBps * 0.82 + inst * 0.18;
        const leftB = Math.max(0, remainCtx.bytes - remainCtx.lastLoaded);
        const uploadLeft = (leftB / remainCtx.smoothBps) * 1000;
        end = Math.max(end, now + uploadLeft + remainCtx.serverAfterUploadMs * 1.02);
      }
    }
    if (remainCtx.phase === "server" && remainCtx.serverStart) {
      const spent = now - remainCtx.serverStart;
      const left = Math.max(0, remainCtx.serverBudgetMs - spent);
      end = Math.max(end, now + left + remainCtx.finalizeSlackMs);
    }
    return end;
  }

  function tickRemain() {
    if (!remainCtx || !progressRemain) return;
    const now = Date.now();
    const end = computePredictedEnd(remainCtx, now);
    progressRemain.textContent = formatRemainMs(end - now);
    syncProgressFromRemainCtx(now, end);
  }

  /** Barre alignée sur le même modèle que le temps restant (upload réel + ETA serveur). */
  function syncProgressFromRemainCtx(now = Date.now(), predictedEnd) {
    if (!remainCtx) return;
    if (remainCtx.phase === "upload" && remainCtx.bytes > 0) {
      const u = Math.min(1, remainCtx.lastLoaded / remainCtx.bytes);
      setProgress(15 + 45 * u);
      return;
    }
    if (remainCtx.phase === "server" && remainCtx.serverStart) {
      const end = predictedEnd != null ? predictedEnd : computePredictedEnd(remainCtx, now);
      const span = Math.max(4000, end - remainCtx.serverStart);
      const raw = (now - remainCtx.serverStart) / span;
      if (raw <= 1) {
        setProgress(60 + 33 * raw);
      } else {
        setProgress(Math.min(93, 90 + Math.min(3, (raw - 1) * 5)));
      }
    }
  }

  function startRemainTimer(ctx) {
    stopRemainTimer();
    remainCtx = ctx;
    tickRemain();
    remainTimerId = setInterval(tickRemain, 180);
  }

  function onUploadProgressBytes(loaded) {
    if (!remainCtx) return;
    if (remainCtx.phase === "server") return;
    const now = Date.now();
    if (!remainCtx.uploadStart) remainCtx.uploadStart = now;
    remainCtx.phase = "upload";
    remainCtx.lastLoaded = loaded;
    syncProgressFromRemainCtx(now, computePredictedEnd(remainCtx, now));
  }

  function onUploadComplete() {
    if (!remainCtx) return;
    const now = Date.now();
    remainCtx.phase = "server";
    remainCtx.serverStart = now;
    remainCtx.predictedEnd = Math.max(remainCtx.predictedEnd, now + remainCtx.serverBudgetMs + remainCtx.finalizeSlackMs);
  }

  const ERROR_MESSAGES = {
    NO_SEGMENTS: "Aucun contenu vocal détecté. Vérifie que le fichier contient bien de l'audio.",
    AUTH_ERROR: "L'accès équipe est incorrect. Vérifie-le et relance.",
    NETWORK_ERROR: "La connexion a été interrompue. Vérifie ta connexion et réessaie.",
    BACKEND_ERROR: "Le backend local a répondu avec une erreur. Vérifie les logs serveur.",
    LOCKED: "Accès verrouillé. Saisis le code PIN.",
    GENERIC: "Quelque chose s'est mal passé. Actualise la page et réessaie.",
  };
