(() => {
  "use strict";

  // ========= DOM / state =========
  const $ = (id) => document.getElementById(id);
  const pickBtn = $("pickBtn");
  const runBtn = $("runBtn");
  const fileInput = $("fileInput");
  const apiKeyInput = $("apiKeyInput");
  const localMode = $("localMode");
  const backendUrlInput = $("backendUrlInput");
  const backendUrlRow = $("backendUrlRow");
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
  const reviewStats = $("reviewStats");
  const reviewDownloadBtn = $("reviewDownloadBtn");
  const reviewResetBtn = $("reviewResetBtn");
  const reviewCaptureBtn = $("reviewCaptureBtn");
  const reviewWordingGenerateBtn = $("reviewWordingGenerateBtn");
  const reviewWordingSource = $("reviewWordingSource");
  const reviewWordingStatus = $("reviewWordingStatus");
  const reviewWordingList = $("reviewWordingList");

  const API_KEY_STORAGE_KEY = "groq_api_key_transcription";
  const EXTRACT_AUDIO_PREF_KEY = "groq_extract_audio_pref";
  const LOCAL_MODE_STORAGE_KEY = "local_backend_mode";
  const BACKEND_URL_STORAGE_KEY = "local_backend_url";
  const REVIEW_MODE_STORAGE_KEY = "review_mode_enabled";
  const DEFAULT_BACKEND_URL = "http://localhost:8787";
  const JOB_STATS_KEY = "transcriptor_job_stats_v1";
  const JOB_STATS_MAX = 18;

  const ETA_TRANSCRIBE = "Transcription en cours...";
  const ETA_FINALIZE = "Finalisation du .srt...";
  const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
  const WORDING_MODEL = "llama-3.3-70b-versatile";
  const WORDING_MOODS = ["Humour", "Emotion", "Tension", "Inspiration", "Impact"];
  const WORDING_MAX_CHARS = 150;
  const WORDING_BRIEF_DEFAULTS = Object.freeze({
    platform: "INSTAGRAM",
    tone: "engageant, social-first, premium accessible",
    audience: "18-35 digital natives, French market",
    objective: "ENGAGEMENT",
    language: "FR",
    maxChars: WORDING_MAX_CHARS,
  });
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
    Emotion: "255,118,156",
    Tension: "255,102,102",
    Inspiration: "113,190,255",
    Impact: "146,132,255",
  };

  let selectedFile = null;
  let ffmpegBundlePromise = null;
  let reviewState = null;
  let reviewMediaUrl = null;
  let reviewActiveIndex = -1;
  let wordingState = { loading: false, items: [], source: "" };

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
        ? Math.max(35000, 20000 + mb * 15000)
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
    if (remainCtx.phase === "upload" && remainCtx.uploadStart && remainCtx.lastLoaded > 2048) {
      const dt = now - remainCtx.uploadStart;
      if (dt > 250) {
        const inst = remainCtx.lastLoaded / dt;
        remainCtx.smoothBps = remainCtx.smoothBps == null ? inst : remainCtx.smoothBps * 0.82 + inst * 0.18;
        const leftB = Math.max(0, remainCtx.bytes - remainCtx.lastLoaded);
        const uploadLeft = (leftB / remainCtx.smoothBps) * 1000;
        end = Math.max(end, now + uploadLeft + remainCtx.serverAfterUploadMs * 0.92);
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
    GENERIC: "Quelque chose s'est mal passé. Actualise la page et réessaie.",
  };

  // ========= UI helpers =========
  function showToast(msg) {
    const region = $("toast-region");
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<span class="toast-msg">${msg}</span><button class="toast-close" aria-label="Fermer">✕</button>`;
    t.querySelector(".toast-close").onclick = () => t.remove();
    region.appendChild(t);
    setTimeout(() => t?.remove(), 7000);
  }

  function sr(msg) {
    srStatus.textContent = "";
    requestAnimationFrame(() => {
      srStatus.textContent = msg;
    });
  }

  function setEta(msg) {
    progressEta.textContent = msg;
  }

  function setProgress(pct) {
    const p = Math.min(100, Math.max(0, pct));
    progressFill.style.width = `${p.toFixed(1)}%`;
    progressBar.setAttribute("aria-valuenow", String(Math.round(p)));
  }

  function setStep(name, status) {
    const el = document.querySelector(`.step[data-step="${name}"]`);
    if (!el) return;
    el.dataset.status = status;
    el.querySelector(".s-idle").style.display = status === "idle" || status === "active" ? "" : "none";
    el.querySelector(".s-done").style.display = status === "done" ? "" : "none";
    el.querySelector(".s-err").style.display = status === "error" ? "" : "none";
  }

  function resetStepper() {
    ["prep", "upload", "transcribe", "format"].forEach((s) => setStep(s, "idle"));
  }

  function resetUI() {
    progressPanel.hidden = true;
    exportPanel.hidden = true;
    reviewPanel.hidden = true;
    uploadPanel.hidden = false;
    actionRow.hidden = false;
    pickBtn.disabled = false;
    extractAudio.disabled = false;
    resetStepper();
    setProgress(0);
    setEta(ETA_TRANSCRIBE);
    stopRemainTimer();
    cleanupReviewMedia();
    refreshRunButton();
  }

  function cloneSegmentsForReview(segments) {
    return (Array.isArray(segments) ? segments : []).map((seg) => ({
      start: Number(seg?.start) || 0,
      end: Math.max(Number(seg?.start) || 0, Number(seg?.end) || Number(seg?.start) || 0),
      text: String(seg?.text || "").trim(),
      speaker: seg?.speaker == null ? "" : String(seg.speaker),
    }));
  }

  function getReviewMediaElement() {
    if (!reviewPlayer.classList.contains("hidden")) return reviewPlayer;
    if (!reviewAudioPlayer.classList.contains("hidden")) return reviewAudioPlayer;
    return null;
  }

  function cleanupReviewMedia() {
    reviewState = null;
    reviewActiveIndex = -1;
    reviewList.innerHTML = "";
    reviewMeta.textContent = "";
    reviewStats.textContent = "0 segments";
    reviewOverlay.classList.add("hidden");
    reviewOverlaySpeaker.textContent = "";
    reviewOverlayText.textContent = "";
    reviewOverlayText.style.border = "none";
    reviewCaptionPanel.classList.add("hidden");
    reviewCaptionSpeaker.textContent = "";
    reviewCaptionText.textContent = "";
    reviewCaptionPanel.style.borderColor = "";
    [reviewPlayer, reviewAudioPlayer].forEach((el) => {
      try {
        el.pause();
      } catch {}
      el.removeAttribute("src");
      el.load?.();
      el.classList.add("hidden");
    });
    if (reviewMediaUrl) {
      URL.revokeObjectURL(reviewMediaUrl);
      reviewMediaUrl = null;
    }
  }

  // ========= File helpers =========
  const isVideoFile = (f) => {
    if (!f) return false;
    if ((f.type || "").startsWith("video/")) return true;
    return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name || "");
  };

  const isLikelyMedia = (f) => {
    if (!f) return false;
    if ((f.type || "").startsWith("audio/")) return true;
    if ((f.type || "").startsWith("video/")) return true;
    return /\.(mp3|mp4|m4a|wav|aac|ogg|webm|mov|mkv)$/i.test(f.name || "");
  };
  const isWhisperSupportedAudio = (f) => !!f && /\.(mp3|wav|ogg|flac)$/i.test(f.name || "");

  const isFileProtocol = () => typeof location !== "undefined" && location.protocol === "file:";
  const assetBase = new URL(".", location.href).href;
  const assetUrl = (p) => new URL(p, assetBase).href;
  const canUseFfmpegExtract = () => !isFileProtocol();

  if (isFileProtocol()) fileProtocolBanner.classList.remove("hidden");

  function syncExtractUi(file) {
    if (!file) {
      extractRow.classList.add("hidden");
      return;
    }
    const show = isVideoFile(file);
    extractRow.classList.toggle("hidden", !show);
    if (!show) return;
    extractAudio.disabled = !canUseFfmpegExtract();
    if (!canUseFfmpegExtract()) {
      extractAudio.checked = false;
      return;
    }
    const saved = localStorage.getItem(EXTRACT_AUDIO_PREF_KEY);
    extractAudio.checked = saved === null ? true : saved === "1";
  }

  const isLocalModeEnabled = () => !!localMode?.checked;

  const getBackendUrl = () => {
    const raw = String(backendUrlInput?.value || "").trim();
    return raw || DEFAULT_BACKEND_URL;
  };

  function syncModeUi() {
    if (!localMode || !backendUrlRow || !apiKeyInput) return;
    const local = isLocalModeEnabled();
    backendUrlRow.classList.toggle("hidden", !local);
    apiKeyInput.closest(".field")?.classList.toggle("hidden", local);
  }

  function refreshRunButton() {
    const hasGroqCred = !!apiKeyInput.value.trim();
    const hasBackendCred = !!getBackendUrl();
    const ok = !!selectedFile && (isLocalModeEnabled() ? hasBackendCred : hasGroqCred);
    runBtn.disabled = !ok;
    runBtn.setAttribute("aria-disabled", String(!ok));
  }

  function setSelectedFile(file) {
    selectedFile = file || null;
    if (selectedFile) {
      dropzone.classList.remove("is-error");
      dropzone.classList.add("is-success");
      dzFileName.textContent = selectedFile.name;
      dzFileMeta.textContent = `${(selectedFile.size / (1024 * 1024)).toFixed(1)} Mo`;
    } else {
      dropzone.classList.remove("is-success", "is-error");
      dzFileName.textContent = "";
      dzFileMeta.textContent = "";
    }
    syncExtractUi(selectedFile);
    refreshRunButton();
  }

  // ========= FFmpeg (extraction option) =========
  async function loadFfmpeg() {
    if (!canUseFfmpegExtract()) throw new Error("Extraction impossible en accès local direct.");
    if (ffmpegBundlePromise) return ffmpegBundlePromise;
    ffmpegBundlePromise = (async () => {
      const [{ FFmpeg }, { fetchFile }] = await Promise.all([
        import("https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js"),
        import("https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js"),
      ]);
      const ffmpeg = new FFmpeg();
      ffmpeg.on("log", () => {});
      await ffmpeg.load({
        classWorkerURL: assetUrl("worker.js"),
        coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
        wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
      });
      return { ffmpeg, fetchFile };
    })();
    return ffmpegBundlePromise;
  }

  async function extractAudioTrack(file) {
    const { ffmpeg, fetchFile } = await loadFfmpeg();
    const ext = ((file.name || "").match(/\.([^.]+)$/) || [, "mp4"])[1].toLowerCase();
    const inName = `in.${ext}`;
    const outName = "out.wav";
    await ffmpeg.writeFile(inName, await fetchFile(file));
    await ffmpeg.deleteFile(outName).catch(() => {});
    await ffmpeg.exec(["-i", inName, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outName]);
    const data = await ffmpeg.readFile(outName);
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
    const base = (file.name || "audio").replace(/\.[^/.]+$/, "") || "audio";
    return new File([data], `${base}_audio.wav`, { type: "audio/wav" });
  }

  async function normalizeAudioForWhisper(file) {
    if (isWhisperSupportedAudio(file)) return file;
    const { ffmpeg, fetchFile } = await loadFfmpeg();
    const ext = ((file.name || "").match(/\.([^.]+)$/) || [, "bin"])[1].toLowerCase();
    const inName = `in.${ext}`;
    const outName = "normalized.wav";
    await ffmpeg.writeFile(inName, await fetchFile(file));
    await ffmpeg.deleteFile(outName).catch(() => {});
    await ffmpeg.exec(["-i", inName, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outName]);
    const data = await ffmpeg.readFile(outName);
    await ffmpeg.deleteFile(inName).catch(() => {});
    await ffmpeg.deleteFile(outName).catch(() => {});
    const base = (file.name || "audio").replace(/\.[^/.]+$/, "") || "audio";
    return new File([data], `${base}_normalized.wav`, { type: "audio/wav" });
  }

  // ========= API =========
  function postTranscription(url, apiKey, formData, onProgress, onComplete) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", `Bearer ${apiKey}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.upload.onload = () => onComplete?.();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText || "{}"));
          } catch {
            reject(new Error("GENERIC"));
          }
        } else {
          reject(new Error(xhr.status === 401 || xhr.status === 403 ? "AUTH_ERROR" : "GENERIC"));
        }
      };
      xhr.onerror = () => reject(new Error("NETWORK_ERROR"));
      xhr.send(formData);
    });
  }

  function postBackendTranscription(url, formData, onProgress, onComplete, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      for (const [k, v] of Object.entries(extraHeaders || {})) {
        if (v) xhr.setRequestHeader(k, String(v));
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.upload.onload = () => onComplete?.();
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText || "{}"));
          } catch {
            reject(new Error("GENERIC"));
          }
        } else {
          reject(new Error("BACKEND_ERROR"));
        }
      };
      xhr.onerror = () => reject(new Error("NETWORK_ERROR"));
      xhr.send(formData);
    });
  }

  // ========= SRT logic (unchanged) =========
  const IDEAL_LINE_CHARS = 30, SOFT_LINE_CHARS = 32, HARD_LINE_CHARS = 34;
  const AUTO_WRAP_GUARD_CHARS = 26, PREMIERE_SAFE_LINE_CHARS = 24;
  const IDEAL_CUE_CHARS = 52, HARD_CUE_CHARS = 62;
  const MIN_WORDS_LINE = 2, TARGET_WORDS_LINE = 3, MIN_WORDS_CUE = 4, MAX_WORDS_CUE = 16;
  const CUE_START_TRIM_SEC = 0.012;
  const CUE_END_TRIM_SEC = 0;
  const CUE_END_HOLD_SEC = 0.035;
  const CUE_PAD_START_SEC = 0.078;
  const CUE_PAD_END_SEC = 0.045;
  const MIN_CUE_DURATION_SEC = 0.42;
  const MIN_CUE_GAP_SEC = 0.008;

  const WEAK_ENDS = new Set([
    "de", "du", "des", "le", "la", "les", "un", "une", "a", "au", "aux",
    "en", "et", "ou", "ni", "par", "sur", "sous", "pour", "avec", "dans",
    "vers", "que", "qui", "se", "ne", "y", "mais", "or", "donc", "car",
  ]);

  const isWeakEnd = (w) => !!w && WEAK_ENDS.has(w.toLowerCase().replace(/[,.'!?:;]+$/, ""));

  const ts = (seconds) => {
    const ms = Math.max(0, Math.floor((Number(seconds) || 0) * 1000));
    const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    const cs = String(ms % 1000).padStart(3, "0");
    return `${h}:${m}:${s},${cs}`;
  };

  const cleanText = (text) =>
    String(text || "")
      .replace(/["`«»""„‟]/g, "")
      .replace(/[-–—]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const chunkWords = (text) => {
    const words = cleanText(text).split(/\s+/).filter(Boolean);
    const out = [];
    for (const w of words) {
      if (w.length <= HARD_LINE_CHARS) out.push(w);
      else for (let i = 0; i < w.length; i += HARD_LINE_CHARS) out.push(w.slice(i, i + HARD_LINE_CHARS));
    }
    return out;
  };

  const startsWithBadPunct = (w) => /^[,.;:!?)]/.test(w || "");

  const scoreLineSplit = (left, right) => {
    const lenA = left.join(" ").length;
    const lenB = right.join(" ").length;
    if (!left.length || !right.length) return Infinity;
    if (left.length < MIN_WORDS_LINE || right.length < MIN_WORDS_LINE) return Infinity;
    if (lenA > HARD_LINE_CHARS || lenB > HARD_LINE_CHARS) return Infinity;
    let score = Math.abs(lenA - lenB);
    score += Math.max(0, lenA - IDEAL_LINE_CHARS) * 1.8;
    score += Math.max(0, lenB - IDEAL_LINE_CHARS) * 1.8;
    score += Math.max(0, lenA - PREMIERE_SAFE_LINE_CHARS) * 2.6;
    score += Math.max(0, lenB - PREMIERE_SAFE_LINE_CHARS) * 2.6;
    if (left.length < TARGET_WORDS_LINE) score += 5;
    if (right.length < TARGET_WORDS_LINE) score += 5;
    if (left.length === MIN_WORDS_LINE) score += 3;
    if (right.length === MIN_WORDS_LINE) score += 3;
    if (isWeakEnd(left[left.length - 1])) score += 8;
    if (startsWithBadPunct(right[0])) score += 12;
    return score;
  };

  const formatCueText = (words) => {
    if (!words.length) return "";
    const full = words.join(" ");
    if (full.length <= AUTO_WRAP_GUARD_CHARS || words.length < MIN_WORDS_LINE * 2) return full;
    let bestSplit = -1;
    let bestScore = Infinity;
    for (let i = MIN_WORDS_LINE; i <= words.length - MIN_WORDS_LINE; i++) {
      const score = scoreLineSplit(words.slice(0, i), words.slice(i));
      if (score < bestScore) {
        bestScore = score;
        bestSplit = i;
      }
    }
    if (bestSplit === -1) {
      if (full.length <= SOFT_LINE_CHARS) return full;
      const mid = Math.ceil(words.length / 2);
      return `${words.slice(0, mid).join(" ")}\n${words.slice(mid).join(" ")}`;
    }
    return `${words.slice(0, bestSplit).join(" ")}\n${words.slice(bestSplit).join(" ")}`;
  };

  const canFormatAsOneOrTwoLines = (words) => {
    if (words.join(" ").length <= SOFT_LINE_CHARS) return true;
    for (let i = MIN_WORDS_LINE; i <= words.length - MIN_WORDS_LINE; i++) {
      if (Number.isFinite(scoreLineSplit(words.slice(0, i), words.slice(i)))) return true;
    }
    return false;
  };

  const scoreCueCut = (left, right, nextWord) => {
    const leftText = left.join(" ");
    const rightText = right.join(" ");
    let score = Math.abs(leftText.length - IDEAL_CUE_CHARS);
    score += Math.max(0, leftText.length - HARD_CUE_CHARS) * 3;
    if (left.length < MIN_WORDS_CUE) score += 25;
    if (right.length < MIN_WORDS_CUE) score += 25;
    if (isWeakEnd(left[left.length - 1])) score += 6;
    if (startsWithBadPunct(nextWord)) score += 12;
    if (/[.!?…]$/.test(left[left.length - 1] || "")) score -= 4;
    if (rightText.length > HARD_CUE_CHARS) score += 8;
    return score;
  };

  const splitWordsIntoCueGroups = (words) => {
    if (words.join(" ").length <= HARD_CUE_CHARS && canFormatAsOneOrTwoLines(words)) return [words];
    const groups = [];
    let idx = 0;
    while (idx < words.length) {
      const rest = words.slice(idx);
      if (rest.join(" ").length <= HARD_CUE_CHARS && canFormatAsOneOrTwoLines(rest)) {
        groups.push(rest);
        break;
      }
      let bestEnd = -1;
      let bestScore = Infinity;
      const minEnd = Math.min(words.length - MIN_WORDS_CUE, idx + MIN_WORDS_CUE);
      const maxEnd = Math.min(words.length - MIN_WORDS_CUE, idx + MAX_WORDS_CUE);
      for (let e = minEnd; e <= maxEnd; e++) {
        const score = scoreCueCut(words.slice(idx, e), words.slice(e), words[e]);
        if (score < bestScore) {
          bestScore = score;
          bestEnd = e;
        }
      }
      if (bestEnd === -1) bestEnd = Math.min(words.length, idx + MAX_WORDS_CUE);
      groups.push(words.slice(idx, bestEnd));
      idx = bestEnd;
    }
    if (groups.length > 1) {
      const last = groups[groups.length - 1];
      const prev = groups[groups.length - 2];
      if (last.length < MIN_WORDS_CUE || last.join(" ").length < 18) {
        const merged = [...prev, ...last];
        if (merged.join(" ").length <= HARD_CUE_CHARS + 8) groups.splice(groups.length - 2, 2, merged);
        else if (prev.length > MIN_WORDS_CUE + 1) last.unshift(prev.pop());
      }
    }
    for (let i = 0; i < groups.length; i++) {
      const cur = groups[i];
      if (!cur) continue;
      if (cur.length > 1 && cur.join(" ").length >= 10) continue;
      if (i > 0 && groups[i - 1].length > MIN_WORDS_CUE) {
        cur.unshift(groups[i - 1].pop());
        continue;
      }
      if (i < groups.length - 1 && groups[i + 1].length > MIN_WORDS_CUE) cur.push(groups[i + 1].shift());
    }
    for (let i = groups.length - 1; i >= 0; i--) {
      if (!groups[i] || groups[i].length === 0) groups.splice(i, 1);
    }
    return groups;
  };

  const allocateCueTimes = (start, end, cuesWords) => {
    const duration = Math.max(0.001, end - start);
    const n = cuesWords.length;
    if (n === 1) return [{ start, end }];
    const weights = cuesWords.map((ws) => Math.max(1, ws.join(" ").length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const minCueDur = Math.min(0.9, (duration / n) * 0.75);
    const minTotal = minCueDur * n;
    const durs = [];
    if (minTotal >= duration) {
      const eq = duration / n;
      for (let i = 0; i < n; i++) durs.push(eq);
    } else {
      const raw = weights.map((w) => (duration * w) / totalWeight);
      const base = raw.map((d) => Math.max(minCueDur, d));
      const baseSum = base.reduce((a, b) => a + b, 0);
      if (baseSum <= duration) {
        const extra = duration - baseSum;
        const headroom = raw.map((d, i) => Math.max(0, d - base[i]));
        const hSum = headroom.reduce((a, b) => a + b, 0);
        for (let i = 0; i < n; i++) durs.push(base[i] + (hSum > 0 ? (headroom[i] / hSum) * extra : extra / n));
      } else {
        const flex = base.map((d) => d - minCueDur);
        const fSum = flex.reduce((a, b) => a + b, 0);
        const tf = duration - minTotal;
        for (let i = 0; i < n; i++) durs.push(minCueDur + (fSum > 0 ? (flex[i] / fSum) * tf : tf / n));
      }
    }
    const out = [];
    let t = start;
    for (let i = 0; i < n; i++) {
      const next = i === n - 1 ? end : t + durs[i];
      out.push({ start: t, end: next });
      t = next;
    }
    return out;
  };

  const splitSegmentBalanced = (segment) => {
    const words = chunkWords(segment.text);
    if (!words.length) return [];
    const start = Number(segment.start) || 0;
    const end = Math.max(start, Number(segment.end) || start);
    const cuesWords = splitWordsIntoCueGroups(words);
    const timings = allocateCueTimes(start, end, cuesWords);
    return cuesWords.map((ws, i) => ({
      start: timings[i].start,
      end: timings[i].end,
      text: formatCueText(ws),
      speaker: segment.speaker || null,
    }));
  };

  const refineCueTimeline = (cues) => {
    if (!Array.isArray(cues) || !cues.length) return [];
    const refined = [];
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const rawStart = Math.max(0, Number(cue.start) || 0);
      const rawEnd = Math.max(rawStart, Number(cue.end) || rawStart);
      const rawDur = Math.max(0, rawEnd - rawStart);
      if (rawDur <= 0) {
        refined.push({ ...cue, start: rawStart, end: rawEnd });
        continue;
      }

      const startTrim = Math.min(CUE_START_TRIM_SEC, rawDur * 0.06);
      const endTrim = Math.min(CUE_END_TRIM_SEC, rawDur * 0.02);
      let start = rawStart + startTrim;
      let end = rawEnd - endTrim;

      if (end - start < MIN_CUE_DURATION_SEC) {
        const mid = (rawStart + rawEnd) / 2;
        start = mid - MIN_CUE_DURATION_SEC / 2;
        end = mid + MIN_CUE_DURATION_SEC / 2;
      }

      start = Math.max(rawStart, start);
      end = Math.min(rawEnd, end);

      start = Math.max(0, start - CUE_PAD_START_SEC);
      end = end + CUE_PAD_END_SEC;

      const prev = refined[i - 1];
      if (prev) start = Math.max(start, prev.end + MIN_CUE_GAP_SEC);

      const nextRawStart = i < cues.length - 1 ? Math.max(0, Number(cues[i + 1].start) || 0) : Infinity;
      const maxEndFromNext = nextRawStart - MIN_CUE_GAP_SEC;
      if (Number.isFinite(maxEndFromNext)) end = Math.min(end + CUE_END_HOLD_SEC, maxEndFromNext);
      else end += CUE_END_HOLD_SEC;

      if (end - start < 0.2) {
        start = Math.max(0, rawStart - CUE_PAD_START_SEC * 0.5);
        if (prev) start = Math.max(start, prev.end + MIN_CUE_GAP_SEC);
        end = Math.min(rawEnd + CUE_PAD_END_SEC, Number.isFinite(maxEndFromNext) ? maxEndFromNext : rawEnd + CUE_PAD_END_SEC);
      }
      if (end - start < 0.12) end = Math.max(start + 0.12, end);
      if (prev && start < prev.end) start = prev.end;
      if (end < start) end = start;

      refined.push({ ...cue, start, end });
    }
    return refined;
  };

  // Guardrails: keep the same assertions
  (() => {
    const caseOrphan = splitSegmentBalanced({ text: "Il a fait une passe magnifique pour Matuidi,", start: 0, end: 4.8 });
    console.assert(
      !caseOrphan.some((c) => {
        const l = c.text.split("\n");
        return l.length === 2 && l[1].trim().split(/\s+/).length === 1;
      }),
      "Test orphan failed."
    );
  })();

  const toSrt = (segments) =>
    refineCueTimeline(segments.flatMap(splitSegmentBalanced))
      .map((seg, i) => `${i + 1}\n${ts(seg.start)} --> ${ts(seg.end)}\n${seg.text}\n`)
      .join("\n");

  const normalizeSpeaker = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (/^SPEAKER_\d+$/i.test(raw)) return raw.toUpperCase();
    const digits = raw.match(/\d+/)?.[0];
    if (digits) return `SPEAKER_${digits.padStart(2, "0")}`;
    return raw.toUpperCase().replace(/\s+/g, "_");
  };

  function toSrtWithSpeakers(segments, opts = {}) {
    const cues = refineCueTimeline(segments.flatMap(splitSegmentBalanced));
    const labelEveryCue = Boolean(opts?.labelEveryCue);
    const showSpeakerLabel = opts?.showSpeakerLabel !== false;
    let prevSpeaker = null;
    return cues
      .map((seg, i) => {
        const speaker = normalizeSpeaker(seg?.speaker);
        const line = String(seg.text || "").replace(/^\s*[-–—]\s+/, "");
        const isNewSpeaker = Boolean(speaker) && speaker !== prevSpeaker;
        const shouldPrefixDash = labelEveryCue ? Boolean(speaker) : isNewSpeaker;
        if (speaker) prevSpeaker = speaker;
        const speakerLabel = showSpeakerLabel && speaker && (labelEveryCue || isNewSpeaker) ? `${speaker}: ` : "";
        const outText = `${speakerLabel}${line}`;
        const outLine = shouldPrefixDash ? `- ${outText}` : outText;
        return `${i + 1}\n${ts(seg.start)} --> ${ts(seg.end)}\n${outLine}\n`;
      })
      .join("\n");
  }

  const download = (content, fileName) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  function formatReviewTime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = (s - m * 60).toFixed(2).padStart(5, "0");
    return `${String(m).padStart(2, "0")}:${r}`;
  }

  const SPEAKER_PALETTE = [
    "56,170,255",
    "75,208,130",
    "255,186,64",
    "255,120,120",
    "180,132,255",
    "76,212,220",
    "255,145,82",
    "131,197,101",
  ];

  function speakerColorRgb(speaker) {
    const normalized = normalizeSpeaker(speaker) || "SPEAKER_00";
    const match = normalized.match(/\d+/);
    if (match) return SPEAKER_PALETTE[Number(match[0]) % SPEAKER_PALETTE.length];
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
    return SPEAKER_PALETTE[hash % SPEAKER_PALETTE.length];
  }

  function previewLineFromSegment(seg) {
    if (!seg) return { speaker: "", text: "" };
    const speaker = normalizeSpeaker(seg.speaker) || "";
    const text = String(seg.text || "").trim();
    return { speaker, text };
  }

  function updateSubtitlePreview(activeIndex) {
    const showPanel = !!reviewPanelToggle?.checked;
    const showOverlay = !!reviewOverlayToggle?.checked && !reviewPlayer.classList.contains("hidden");
    const seg =
      reviewState && Array.isArray(reviewState.editedSegments) && activeIndex >= 0
        ? reviewState.editedSegments[activeIndex]
        : null;
    const { speaker, text } = previewLineFromSegment(seg);
    const rgb = speakerColorRgb(speaker);

    if (showOverlay && text) {
      reviewOverlay.classList.remove("hidden");
      reviewOverlaySpeaker.textContent = speaker || " ";
      reviewOverlaySpeaker.style.display = speaker ? "" : "none";
      reviewOverlayText.textContent = text;
      reviewOverlayText.style.border = `1px solid rgba(${rgb},0.72)`;
    } else {
      reviewOverlay.classList.add("hidden");
      reviewOverlaySpeaker.textContent = "";
      reviewOverlayText.textContent = "";
      reviewOverlayText.style.border = "none";
    }

    if (showPanel && text) {
      reviewCaptionPanel.classList.remove("hidden");
      reviewCaptionSpeaker.textContent = speaker || "";
      reviewCaptionText.textContent = text;
      reviewCaptionPanel.style.borderColor = `rgba(${rgb},0.72)`;
    } else {
      reviewCaptionPanel.classList.add("hidden");
      reviewCaptionSpeaker.textContent = "";
      reviewCaptionText.textContent = "";
      reviewCaptionPanel.style.borderColor = "";
    }
  }

  function findActiveSegmentIndexAtTime(timeSec) {
    if (!reviewState?.editedSegments?.length) return -1;
    const t = Number(timeSec || 0);
    for (let i = 0; i < reviewState.editedSegments.length; i++) {
      const seg = reviewState.editedSegments[i];
      if (t >= seg.start && t <= seg.end + 0.05) return i;
    }
    return -1;
  }

  function wrapTextLines(ctx, text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
    return lines.slice(0, 3);
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function parseJsonLoose(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {}
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {}
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {}
    }
    return null;
  }

  function resetWordingState() {
    wordingState = { loading: false, items: [], source: "" };
    if (reviewWordingSource) reviewWordingSource.textContent = "Contexte: toute la transcription";
    if (reviewWordingStatus) reviewWordingStatus.textContent = "En attente de génération.";
    if (reviewWordingList) {
      reviewWordingList.innerHTML = '<div class="wording-empty">Clique sur "Generer 5 wordings" pour creer des variantes (humour, emotion, tension, etc.).</div>';
    }
  }

  function buildWordingExcerpt() {
    if (!reviewState?.editedSegments?.length) return null;
    const segs = reviewState.editedSegments;
    const text = segs
      .map((seg) => String(seg?.text || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return null;
    const first = segs[0] || {};
    const last = segs[segs.length - 1] || {};
    const source = `Transcription complete: ${segs.length} segments (${formatReviewTime(first.start)} -> ${formatReviewTime(last.end)})`;
    return { text, source };
  }

  function renderWordingResults() {
    if (!reviewWordingList || !reviewWordingStatus) return;
    if (wordingState.loading) {
      reviewWordingStatus.textContent = "Generation en cours...";
      reviewWordingList.innerHTML = '<div class="wording-empty">Generation des 5 propositions en cours...</div>';
      return;
    }
    if (!wordingState.items.length) {
      reviewWordingStatus.textContent = "Aucun wording genere.";
      reviewWordingList.innerHTML = '<div class="wording-empty">Aucun resultat pour le moment.</div>';
      return;
    }
    reviewWordingStatus.textContent = "5 variantes generees.";
    reviewWordingList.innerHTML = wordingState.items
      .map((item, i) => {
        const mood = String(item?.mood || "").trim() || `Humeur ${i + 1}`;
        const text = String(item?.text || "").trim();
        const color = WORDING_MOOD_COLORS[mood] || "142,150,175";
        return `
          <article class="wording-card" style="--mood-rgb:${color}">
            <div class="wording-card-head">
              <span class="wording-mood">${escapeHtml(mood)}</span>
              <button type="button" class="wording-copy-btn" data-copy-wording="${i}" title="Copier le wording">Copier</button>
            </div>
            <p class="wording-text">${escapeHtml(text)}</p>
          </article>
        `;
      })
      .join("");
  }

  function normalizeWordingResult(payload) {
    const list = Array.isArray(payload?.wordings) ? payload.wordings : Array.isArray(payload) ? payload : null;
    const options = Array.isArray(payload?.options) ? payload.options : null;
    if (!list && options?.length) {
      return options
        .slice(0, 5)
        .map((item, i) => {
          const angle = String(item?.angle || "").trim();
          const hook = String(item?.hook || "").trim();
          const body = String(item?.body || "").trim();
          const cta = String(item?.cta || "").trim();
          const captionFull = String(item?.caption_full || "").trim();
          const text =
            captionFull ||
            [hook, body, cta]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
          return {
            mood: angle || WORDING_MOODS[i] || `Humeur ${i + 1}`,
            text,
          };
        })
        .filter((item) => item.text.length > 0);
    }
    if (!list || !list.length) return [];
    return list
      .slice(0, 5)
      .map((item, i) => ({
        mood: String(item?.mood || WORDING_MOODS[i] || `Humeur ${i + 1}`).trim(),
        text: String(item?.text || item?.wording || "").trim(),
      }))
      .filter((item) => item.text.length > 0);
  }

  async function generateWordingsFromExcerpt() {
    if (!reviewState?.editedSegments?.length) {
      showToast("Aucun segment disponible pour generer les wordings.");
      return;
    }
    const apiKey = String(apiKeyInput?.value || "").trim();
    if (!apiKey) {
      showToast("Ajoute une cle d'acces equipe pour la generation wording.");
      if (reviewWordingStatus) reviewWordingStatus.textContent = "Cle API requise pour generer.";
      return;
    }
    const excerpt = buildWordingExcerpt();
    if (!excerpt) {
      showToast("Impossible de construire un extrait exploitable.");
      return;
    }

    wordingState.loading = true;
    wordingState.items = [];
    wordingState.source = excerpt.source;
    if (reviewWordingSource) reviewWordingSource.textContent = excerpt.source;
    renderWordingResults();

    const subject = `Teaser social pour "${reviewState?.baseName || "episode"}"`;
    const briefBlock = [
      `Platform: ${WORDING_BRIEF_DEFAULTS.platform}`,
      `Brand voice: ${WORDING_BRIEF_DEFAULTS.tone}`,
      `Subject: ${subject}`,
      `Audience: ${WORDING_BRIEF_DEFAULTS.audience}`,
      `Objective: ${WORDING_BRIEF_DEFAULTS.objective}`,
      `Language: ${WORDING_BRIEF_DEFAULTS.language}`,
      `MaxChars: ${WORDING_BRIEF_DEFAULTS.maxChars}`,
      `Number: ${WORDING_MOODS.length}`,
    ].join("\n");
    const trendPack = WORDING_TREND_PACK;

    const systemPrompt = [
      "You are a senior social media copywriter for entertainment, streaming, and culture brands.",
      "Generate exactly 5 caption options from the brief.",
      "Each option must use a different angle in this exact order: Humour, Emotion, Tension, Inspiration, Impact.",
      "Write concise social-native copy. No generic filler.",
      "Forbidden phrases: \"Decouvrez\", \"Don't miss out\", \"Game-changer\".",
      "caption_full must be <= MaxChars unless brief says otherwise.",
      "Use at least one emoji per option when relevant.",
      "TrendPack is authoritative Q1 2026 guidance: align hooks with top_hook_patterns, respect algorithm_signals_2026 (hook window, saves/shares/replies, caption SEO), favor what_is_winning, avoid what_is_dying.",
      "Set trend_status to trend_used when you meaningfully apply TrendPack; use no_relevant_live_trend_found only if the transcript truly cannot map without forcing. Do not invent extra sources beyond TrendPack.sources labels.",
      "Return ONLY valid JSON with this structure:",
      "{\"trend_status\":\"trend_used|no_relevant_live_trend_found\",\"options\":[{\"angle\":\"...\",\"hook\":\"...\",\"body\":\"...\",\"cta\":\"...\",\"caption_full\":\"...\",\"char_count\":0,\"pattern_note\":\"...\"}],\"wordings\":[{\"mood\":\"Humour\",\"text\":\"...\"},{\"mood\":\"Emotion\",\"text\":\"...\"},{\"mood\":\"Tension\",\"text\":\"...\"},{\"mood\":\"Inspiration\",\"text\":\"...\"},{\"mood\":\"Impact\",\"text\":\"...\"}]}",
      "The wordings array is mandatory and must contain exactly 5 items.",
    ].join(" ");
    const userPrompt = [
      "<brief>",
      briefBlock,
      "</brief>",
      "",
      "<trend_input>",
      `TrendPack: ${JSON.stringify(trendPack)}`,
      "</trend_input>",
      "",
      "Full transcript context (ordered STT segments):",
      excerpt.text,
      "",
      "Output constraints:",
      "- Return exactly 5 options and exactly 5 wordings.",
      "- Each option: hook + body (max 3 short lines) + CTA.",
      "- Each wording text must stay short, catchy, social media friendly.",
      "- Leverage the full transcript context, not only one sentence.",
    ].join("\n");

    try {
      const res = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: WORDING_MODEL,
          temperature: 0.82,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!res.ok) throw new Error("GENERIC");
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "";
      const parsed = parseJsonLoose(content);
      const normalized = normalizeWordingResult(parsed);
      if (!normalized.length) throw new Error("GENERIC");
      while (normalized.length < 5) {
        const idx = normalized.length;
        normalized.push({
          mood: WORDING_MOODS[idx] || `Humeur ${idx + 1}`,
          text: "Version indisponible pour cette humeur.",
        });
      }
      wordingState.items = normalized.slice(0, 5);
      renderWordingResults();
    } catch {
      wordingState.items = [];
      renderWordingResults();
      showToast("Echec de generation wording. Reessaie dans quelques secondes.");
      if (reviewWordingStatus) reviewWordingStatus.textContent = "Erreur de generation.";
    } finally {
      wordingState.loading = false;
      renderWordingResults();
    }
  }

  function captureReviewFrame() {
    if (reviewPlayer.classList.contains("hidden")) {
      showToast("La capture frame est disponible uniquement en mode vidéo.");
      return;
    }
    if (!reviewPlayer.videoWidth || !reviewPlayer.videoHeight) {
      showToast("Vidéo non prête. Lance la lecture puis réessaie.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = reviewPlayer.videoWidth;
    canvas.height = reviewPlayer.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(reviewPlayer, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          showToast("Impossible de capturer cette frame.");
          return;
        }
        const tMs = Math.floor((reviewPlayer.currentTime || 0) * 1000);
        const base = reviewState?.baseName || "cover";
        const name = `${base}_cover_t${tMs}.jpg`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Capture téléchargée: ${name}`);
      },
      "image/jpeg",
      0.94
    );
  }

  function buildSrtFromSegments(segments) {
    const hasSpeakerData = (Array.isArray(segments) ? segments : []).some((seg) => !!normalizeSpeaker(seg?.speaker));
    return hasSpeakerData ? toSrtWithSpeakers(segments, { labelEveryCue: false, showSpeakerLabel: true }) : toSrt(segments);
  }

  function setReviewActiveIndex(index) {
    reviewActiveIndex = Number.isFinite(index) ? index : -1;
    reviewList.querySelectorAll(".review-row").forEach((row, i) => {
      row.classList.toggle("is-active", i === reviewActiveIndex);
      if (i === reviewActiveIndex) {
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    updateSubtitlePreview(reviewActiveIndex);
    const excerpt = buildWordingExcerpt();
    if (reviewWordingSource && excerpt?.source) reviewWordingSource.textContent = excerpt.source;
  }

  function renderReviewList() {
    if (!reviewState || !Array.isArray(reviewState.editedSegments)) {
      reviewList.innerHTML = "";
      reviewStats.textContent = "0 segments";
      return;
    }
    reviewStats.textContent = `${reviewState.editedSegments.length} segments`;
    const rows = reviewState.editedSegments
      .map((seg, idx) => {
        const speaker = String(seg?.speaker || "");
        const text = String(seg?.text || "");
        const rgb = speakerColorRgb(speaker);
        return `
          <div class="review-row" data-idx="${idx}" style="--speaker-rgb:${rgb}">
            <div class="review-time">${formatReviewTime(seg.start)}</div>
            <div class="review-time">${formatReviewTime(seg.end)}</div>
            <input class="review-speaker" data-field="speaker" data-idx="${idx}" value="${speaker.replace(/"/g, "&quot;")}" placeholder="SPEAKER_00" />
            <textarea class="review-text" data-field="text" data-idx="${idx}">${text}</textarea>
            <button type="button" class="review-jump" data-jump="${idx}" title="Aller au segment">▶</button>
          </div>
        `;
      })
      .join("");
    reviewList.innerHTML = rows;
    setReviewActiveIndex(reviewActiveIndex);
  }

  function openReviewPanel(baseName, segments, originalFile) {
    cleanupReviewMedia();
    reviewState = {
      baseName,
      originalSegments: cloneSegmentsForReview(segments),
      editedSegments: cloneSegmentsForReview(segments),
    };
    reviewMeta.textContent = `${baseName}_transcription_corrigee.srt`;
    if (reviewOverlayToggle) reviewOverlayToggle.checked = true;
    if (reviewPanelToggle) reviewPanelToggle.checked = true;

    if (originalFile) {
      const isVideo = (originalFile.type || "").startsWith("video/") || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(originalFile.name || "");
      const isAudio = (originalFile.type || "").startsWith("audio/");
      if (isVideo || isAudio) {
        reviewMediaUrl = URL.createObjectURL(originalFile);
        if (isVideo) {
          reviewPlayer.src = reviewMediaUrl;
          reviewPlayer.classList.remove("hidden");
          reviewAudioPlayer.classList.add("hidden");
        } else {
          reviewAudioPlayer.src = reviewMediaUrl;
          reviewAudioPlayer.classList.remove("hidden");
          reviewPlayer.classList.add("hidden");
        }
      }
    }

    resetWordingState();
    renderReviewList();
    setReviewActiveIndex(0);
    uploadPanel.hidden = true;
    progressPanel.hidden = true;
    exportPanel.hidden = true;
    reviewPanel.hidden = false;
    actionRow.hidden = true;
    sr("Relecture prête. Corrige les segments puis exporte le .srt.");
  }

  // ========= Events =========
  extractAudio.addEventListener("change", () => {
    localStorage.setItem(EXTRACT_AUDIO_PREF_KEY, extractAudio.checked ? "1" : "0");
  });

  pickBtn.onclick = () => fileInput.click();
  changeFileBtn.onclick = (e) => {
    e.stopPropagation();
    fileInput.click();
  };
  fileInput.onchange = () => setSelectedFile(fileInput.files?.[0] || null);

  dropzone.addEventListener("click", (e) => {
    if (e.target === changeFileBtn || dropzone.classList.contains("is-success")) return;
    fileInput.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dropzone.classList.add("is-dragover");
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("is-dragover");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-dragover");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-dragover");
    const file = e.dataTransfer?.files?.[0] || null;
    if (!file) return;
    if (!isLikelyMedia(file)) {
      dropzone.classList.remove("is-success");
      dropzone.classList.add("is-error");
      setTimeout(() => dropzone.classList.remove("is-error"), 3000);
      return;
    }
    setSelectedFile(file);
  });

  const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (savedKey) apiKeyInput.value = savedKey;
  const savedLocalMode = localStorage.getItem(LOCAL_MODE_STORAGE_KEY);
  if (localMode) localMode.checked = savedLocalMode === "1";
  const savedBackendUrl = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
  if (backendUrlInput) backendUrlInput.value = savedBackendUrl || DEFAULT_BACKEND_URL;
  const savedReviewMode = localStorage.getItem(REVIEW_MODE_STORAGE_KEY);
  if (reviewMode) reviewMode.checked = savedReviewMode == null ? true : savedReviewMode === "1";
  syncModeUi();

  apiKeyInput.oninput = () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKeyInput.value.trim());
    refreshRunButton();
  };
  if (localMode) {
    localMode.onchange = () => {
      localStorage.setItem(LOCAL_MODE_STORAGE_KEY, localMode.checked ? "1" : "0");
      syncModeUi();
      refreshRunButton();
    };
  }
  if (backendUrlInput) {
    backendUrlInput.oninput = () => {
      localStorage.setItem(BACKEND_URL_STORAGE_KEY, String(backendUrlInput.value || "").trim());
      refreshRunButton();
    };
  }
  if (reviewMode) {
    reviewMode.onchange = () => {
      localStorage.setItem(REVIEW_MODE_STORAGE_KEY, reviewMode.checked ? "1" : "0");
    };
  }

  newTranscriptionBtn.onclick = () => {
    setSelectedFile(null);
    fileInput.value = "";
    resetUI();
  };

  reviewList.addEventListener("input", (e) => {
    if (!reviewState) return;
    const target = e.target;
    const idx = Number(target?.dataset?.idx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= reviewState.editedSegments.length) return;
    if (target.dataset.field === "text") {
      reviewState.editedSegments[idx].text = String(target.value || "");
    } else if (target.dataset.field === "speaker") {
      reviewState.editedSegments[idx].speaker = String(target.value || "");
      const row = target.closest(".review-row");
      if (row) row.style.setProperty("--speaker-rgb", speakerColorRgb(target.value));
    }
    setReviewActiveIndex(idx);
  });

  reviewList.addEventListener("click", (e) => {
    if (!reviewState) return;
    const row = e.target.closest(".review-row");
    if (row?.dataset?.idx && !e.target.closest("[data-jump]")) {
      setReviewActiveIndex(Number(row.dataset.idx));
    }
    const btn = e.target.closest("[data-jump]");
    if (!btn) return;
    const idx = Number(btn.dataset.jump);
    if (!Number.isFinite(idx) || idx < 0 || idx >= reviewState.editedSegments.length) return;
    const media = getReviewMediaElement();
    if (media) {
      media.currentTime = Math.max(0, Number(reviewState.editedSegments[idx].start) || 0);
      media.play?.().catch(() => {});
    }
    setReviewActiveIndex(idx);
  });

  if (reviewOverlayToggle) {
    reviewOverlayToggle.addEventListener("change", () => updateSubtitlePreview(reviewActiveIndex));
  }
  if (reviewPanelToggle) {
    reviewPanelToggle.addEventListener("change", () => updateSubtitlePreview(reviewActiveIndex));
  }
  if (reviewCaptureBtn) {
    reviewCaptureBtn.addEventListener("click", () => captureReviewFrame());
  }
  if (reviewWordingGenerateBtn) {
    reviewWordingGenerateBtn.addEventListener("click", () => {
      generateWordingsFromExcerpt();
    });
  }
  if (reviewWordingList) {
    reviewWordingList.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-copy-wording]");
      if (!btn) return;
      const idx = Number(btn.dataset.copyWording);
      const item = wordingState.items[idx];
      if (!item?.text) return;
      try {
        await navigator.clipboard.writeText(item.text);
        showToast(`Wording ${idx + 1} copie.`);
      } catch {
        showToast("Impossible de copier automatiquement.");
      }
    });
  }

  [reviewPlayer, reviewAudioPlayer].forEach((media) => {
    media.addEventListener("timeupdate", () => {
      if (!reviewState?.editedSegments?.length) return;
      const active = findActiveSegmentIndexAtTime(media.currentTime);
      if (active !== reviewActiveIndex) setReviewActiveIndex(active);
    });
  });

  reviewResetBtn.onclick = () => {
    if (!reviewState) return;
    reviewState.editedSegments = cloneSegmentsForReview(reviewState.originalSegments);
    renderReviewList();
    resetWordingState();
    sr("Corrections réinitialisées.");
  };

  reviewDownloadBtn.onclick = () => {
    if (!reviewState) return;
    const safeSegments = reviewState.editedSegments
      .map((seg) => ({
        ...seg,
        text: String(seg.text || "").trim(),
      }))
      .filter((seg) => seg.text.length > 0);
    if (!safeSegments.length) {
      showToast("Aucun segment valide à exporter.");
      return;
    }
    const content = buildSrtFromSegments(safeSegments);
    const fileName = `${reviewState.baseName}_transcription_corrigee.srt`;
    download(content, fileName);
    exportMeta.textContent = `${fileName} · ${safeSegments.length} segments`;
    reviewPanel.hidden = true;
    exportPanel.hidden = false;
    sr("SRT corrigé téléchargé.");
  };

  // ========= Navigation =========
  function setActivePage(page) {
    document.querySelectorAll(".nav-item[data-page]").forEach((b) => {
      b.classList.toggle("active", b.dataset.page === page);
      if (b.dataset.page === page) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    const el = document.getElementById(`page-${page}`);
    if (el) el.classList.add("active");
  }

  function initNav() {
    document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("nav-item-soon")) return;
        const page = btn.dataset.page;
        if (!page) return;
        setActivePage(page);
      });
    });
  }

  // ========= Run =========
  runBtn.onclick = async () => {
    const apiKey = apiKeyInput.value.trim();
    const localBackendMode = isLocalModeEnabled();
    const backendUrl = getBackendUrl();
    if (!selectedFile) return;
    if (!localBackendMode && !apiKey) return;

    runBtn.disabled = true;
    pickBtn.disabled = true;
    extractAudio.disabled = true;
    actionRow.hidden = true;
    uploadPanel.hidden = true;
    progressPanel.hidden = false;
    exportPanel.hidden = true;

    resetStepper();
    setProgress(0);
    setEta(ETA_TRANSCRIBE);
    sr("Transcription démarrée.");

    const baseName = selectedFile.name.replace(/\.[^/.]+$/, "") || "audio";
    const modeKey = localBackendMode ? "local" : "cloud";
    const jobT0 = Date.now();

    try {
      // STEP 1 — Préparation
      setStep("prep", "active");
      setProgress(5);

      let fileToSend = selectedFile;
      let heavyPrep = false;
      if (isVideoFile(selectedFile) && extractAudio.checked && canUseFfmpegExtract()) {
        heavyPrep = true;
        setEta(ETA_TRANSCRIBE);
        await loadFfmpeg();
        setEta(ETA_TRANSCRIBE);
        fileToSend = await extractAudioTrack(selectedFile);
      }
      if (localBackendMode && !isWhisperSupportedAudio(fileToSend)) {
        heavyPrep = true;
        setEta("Préparation audio pour le backend...");
        fileToSend = await normalizeAudioForWhisper(fileToSend);
        setEta(ETA_TRANSCRIBE);
      }
      setStep("prep", "done");
      setProgress(15);

      const mb = fileToSend.size / (1024 * 1024);
      const estimatedApiMs = Math.max(20000, mb * (localBackendMode ? 12000 : 3000));
      const learnedTotal = medianLearnedTotalMs(fileToSend.size, modeKey);
      const serverBudgetMs = Math.max(15000, learnedTotal ? Math.round(learnedTotal * 0.52) : estimatedApiMs);
      const predictedTotal = heuristicTotalJobMs(fileToSend.size, modeKey, heavyPrep);

      startRemainTimer({
        predictedEnd: jobT0 + predictedTotal,
        bytes: fileToSend.size,
        phase: "prep",
        uploadStart: 0,
        lastLoaded: 0,
        smoothBps: null,
        serverAfterUploadMs: serverBudgetMs,
        serverStart: 0,
        serverBudgetMs,
        finalizeSlackMs: 5000,
      });

      // STEP 2 — Envoi
      setStep("upload", "active");
      setEta(ETA_TRANSCRIBE);

      const formData = new FormData();
      formData.append("file", fileToSend);
      if (!localBackendMode) {
        formData.append("model", "whisper-large-v3-turbo");
        formData.append("language", "fr");
        formData.append("temperature", "0");
        formData.append("response_format", "verbose_json");
      }

      const data = localBackendMode
        ? await postBackendTranscription(
            `${backendUrl.replace(/\/$/, "")}/api/transcribe`,
            formData,
            (p) => {
              onUploadProgressBytes(p * fileToSend.size);
              setEta(ETA_TRANSCRIBE);
            },
            () => {
              onUploadComplete();
              setStep("upload", "done");
              setProgress(60);
              setStep("transcribe", "active");
              sr("Fichier envoyé. Backend local en cours.");
              tickRemain();
            },
            { "x-groq-api-key": apiKey || "" }
          )
        : await postTranscription(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            apiKey,
            formData,
            (p) => {
              onUploadProgressBytes(p * fileToSend.size);
              setEta(ETA_TRANSCRIBE);
            },
            () => {
              onUploadComplete();
              setStep("upload", "done");
              setProgress(60);
              setStep("transcribe", "active");
              sr("Fichier envoyé. Transcription IA en cours.");
              tickRemain();
            }
          );

      // STEP 3 — Transcription done
      setStep("transcribe", "done");
      setProgress(93);
      setEta(ETA_FINALIZE);

      // STEP 4 — Génération .srt
      setStep("format", "active");
      const segments = Array.isArray(data.segments) ? data.segments : [];
      if (!segments.length) throw new Error("NO_SEGMENTS");

      const reviewEnabled = !!reviewMode?.checked;
      let srtFileName = `${baseName}_transcription.srt`;
      if (reviewEnabled) {
        openReviewPanel(baseName, segments, selectedFile);
      } else {
        const srtContent = buildSrtFromSegments(segments);
        download(srtContent, srtFileName);
      }

      setStep("format", "done");
      setProgress(100);
      recordJobStat(fileToSend.size, modeKey, Date.now() - jobT0);
      stopRemainTimer();
      setEta("Terminé");
      sr(reviewEnabled ? "Transcription terminée. Relecture disponible." : "Transcription terminée. Le fichier .srt a été téléchargé.");

      setTimeout(() => {
        progressPanel.hidden = true;
        if (reviewEnabled) {
          exportPanel.hidden = true;
        } else {
          exportPanel.hidden = false;
          exportMeta.textContent = `${srtFileName} · ${segments.length} segments`;
        }
      }, 900);
    } catch (err) {
      stopRemainTimer();
      const activeStep = document.querySelector(".step[data-status='active']");
      if (activeStep) setStep(activeStep.dataset.step, "error");

      const msg = ERROR_MESSAGES[err.message] || ERROR_MESSAGES.GENERIC;
      showToast(msg);
      sr("Erreur : " + msg);

      setTimeout(() => {
        uploadPanel.hidden = false;
        actionRow.hidden = false;
        progressPanel.hidden = true;
        resetUI();
      }, 1500);
    } finally {
      pickBtn.disabled = false;
      extractAudio.disabled = false;
      refreshRunButton();
    }
  };

  // init
  resetWordingState();
  initNav();
  setEta(ETA_TRANSCRIBE);
  refreshRunButton();
})();

