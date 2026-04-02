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

  const API_KEY_STORAGE_KEY = "groq_api_key_transcription";
  const EXTRACT_AUDIO_PREF_KEY = "groq_extract_audio_pref";
  const LOCAL_MODE_STORAGE_KEY = "local_backend_mode";
  const BACKEND_URL_STORAGE_KEY = "local_backend_url";
  const DEFAULT_BACKEND_URL = "http://localhost:8787";
  const JOB_STATS_KEY = "transcriptor_job_stats_v1";
  const JOB_STATS_MAX = 18;

  const ETA_TRANSCRIBE = "Transcription en cours...";
  const ETA_FINALIZE = "Finalisation du .srt...";

  let selectedFile = null;
  let ffmpegBundlePromise = null;
  let fakeRaf = null;

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

  function tickRemain() {
    if (!remainCtx || !progressRemain) return;
    const now = Date.now();
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

    progressRemain.textContent = formatRemainMs(end - now);
  }

  function startRemainTimer(ctx) {
    stopRemainTimer();
    remainCtx = ctx;
    tickRemain();
    remainTimerId = setInterval(tickRemain, 280);
  }

  function onUploadProgressBytes(loaded) {
    if (!remainCtx) return;
    const now = Date.now();
    if (!remainCtx.uploadStart) remainCtx.uploadStart = now;
    remainCtx.phase = "upload";
    remainCtx.lastLoaded = loaded;
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

  function stopFakeProgress() {
    if (fakeRaf) {
      cancelAnimationFrame(fakeRaf);
      fakeRaf = null;
    }
  }

  function startFakeProgress(from, to, ms) {
    stopFakeProgress();
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const eased = 1 - Math.exp(-3 * Math.min(1, elapsed / ms));
      setProgress(from + (to - from) * eased);
      const rem = Math.max(0, ms - elapsed);
      setEta(rem > 0 ? ETA_TRANSCRIBE : ETA_FINALIZE);
      fakeRaf = requestAnimationFrame(tick);
    };
    fakeRaf = requestAnimationFrame(tick);
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
    stopFakeProgress();
    progressPanel.hidden = true;
    exportPanel.hidden = true;
    uploadPanel.hidden = false;
    actionRow.hidden = false;
    pickBtn.disabled = false;
    extractAudio.disabled = false;
    resetStepper();
    setProgress(0);
    setEta(ETA_TRANSCRIBE);
    stopRemainTimer();
    refreshRunButton();
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
    const { labelEveryCue = false } = opts;
    const cues = refineCueTimeline(segments.flatMap(splitSegmentBalanced));
    let lastSpeaker = null;
    return cues
      .map((seg, i) => {
        const speaker = normalizeSpeaker(seg.speaker);
        const shouldLabel = !!speaker && (labelEveryCue || speaker !== lastSpeaker);
        const line = shouldLabel ? `- ${seg.text}` : seg.text;
        lastSpeaker = speaker || lastSpeaker;
        return `${i + 1}\n${ts(seg.start)} --> ${ts(seg.end)}\n${line}\n`;
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

  newTranscriptionBtn.onclick = () => {
    setSelectedFile(null);
    fileInput.value = "";
    resetUI();
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
              setProgress(15 + p * 45);
              setEta(ETA_TRANSCRIBE);
            },
            () => {
              onUploadComplete();
              setStep("upload", "done");
              setProgress(60);
              setStep("transcribe", "active");
              sr("Fichier envoyé. Backend local en cours.");
              startFakeProgress(60, 90, estimatedApiMs);
            },
            { "x-groq-api-key": apiKey || "" }
          )
        : await postTranscription(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            apiKey,
            formData,
            (p) => {
              onUploadProgressBytes(p * fileToSend.size);
              setProgress(15 + p * 45);
              setEta(ETA_TRANSCRIBE);
            },
            () => {
              onUploadComplete();
              setStep("upload", "done");
              setProgress(60);
              setStep("transcribe", "active");
              sr("Fichier envoyé. Transcription IA en cours.");
              startFakeProgress(60, 90, estimatedApiMs);
            }
          );

      // STEP 3 — Transcription done
      stopFakeProgress();
      setStep("transcribe", "done");
      setProgress(93);
      setEta(ETA_FINALIZE);

      // STEP 4 — Génération .srt
      setStep("format", "active");
      const segments = Array.isArray(data.segments) ? data.segments : [];
      if (!segments.length) throw new Error("NO_SEGMENTS");

      const hasSpeakerData = segments.some((seg) => !!normalizeSpeaker(seg?.speaker));
      const srtContent = hasSpeakerData ? toSrtWithSpeakers(segments) : toSrt(segments);
      const srtFileName = `${baseName}_transcription.srt`;
      download(srtContent, srtFileName);

      setStep("format", "done");
      setProgress(100);
      recordJobStat(fileToSend.size, modeKey, Date.now() - jobT0);
      stopRemainTimer();
      setEta("Terminé");
      sr("Transcription terminée. Le fichier .srt a été téléchargé.");

      setTimeout(() => {
        progressPanel.hidden = true;
        exportPanel.hidden = false;
        exportMeta.textContent = `${srtFileName} · ${segments.length} segments`;
      }, 900);
    } catch (err) {
      stopFakeProgress();
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
  initNav();
  setEta(ETA_TRANSCRIBE);
  refreshRunButton();
})();

