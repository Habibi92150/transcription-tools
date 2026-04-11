  // ========= UI helpers =========
  function showToast(msg, variant = "") {
    const region = $("toast-region");
    const t = document.createElement("div");
    t.className = variant ? `toast toast--${variant}` : "toast";
    t.innerHTML = `<span class="toast-msg">${msg}</span><button class="toast-close" aria-label="Fermer">✕</button>`;
    t.querySelector(".toast-close").onclick = () => t.remove();
    region.appendChild(t);
    setTimeout(() => t?.remove(), 8000);
  }

  function showToastError(msg) {
    showToast(msg, "error");
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

  function extractRateLimitRetryLabel(rawText) {
    const text = String(rawText || "");
    const m = text.match(/try again in\s+([0-9hms.]+)/i);
    if (!m) return null;
    const token = String(m[1] || "").trim().toLowerCase();
    const p = token.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
    if (!p) return token;
    const h = Number(p[1] || 0);
    const min = Number(p[2] || 0);
    const sec = Math.max(0, Math.ceil(Number(p[3] || 0)));
    if (h > 0) return `${h} h ${String(min).padStart(2, "0")} min`;
    if (min > 0) return `${min} min ${sec} s`;
    return `${sec} s`;
  }

  function resetUI() {
    progressPanel.hidden = true;
    exportPanel.hidden = true;
    reviewPanel.hidden = true;
    uploadPanel.hidden = false;
    actionRow.hidden = false;
    if (pickBtn) pickBtn.disabled = false;
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

  // Toujours en mode backend local (Gemini pour tous les utilisateurs)
  const isLocalModeEnabled = () => true;

  const getBackendUrl = () => {
    const raw = String(backendUrlInput?.value || "").trim();
    return raw || DEFAULT_BACKEND_URL;
  };

  function syncModeUi() {
    // Masquer les champs legacy (clé API Groq, etc.)
    if (apiKeyFieldWrap) { apiKeyFieldWrap.classList.add("hidden"); apiKeyFieldWrap.setAttribute("aria-hidden", "true"); }
    const apiKeyField = apiKeyInput?.closest(".field") || apiKeyInput?.parentElement;
    if (apiKeyField) apiKeyField.style.display = "none";
    // Review mode toujours visible
    if (reviewModeRow) { reviewModeRow.classList.remove("hidden"); reviewModeRow.setAttribute("aria-hidden", "false"); }
  }

  function refreshRunButton() {
    const ok = !!selectedFile && !!currentUser;
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
    syncUploadKeyFields();
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
  /** Une seule fois quand le corps de la requête est envoyé (progress 100 %, upload.onload, ou repli xhr.onload). */
  function wireXhrUploadComplete(xhr, onProgress, onComplete) {
    let notified = false;
    function notifyOnce() {
      if (notified) return;
      notified = true;
      onComplete?.();
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress?.(e.loaded / e.total);
        if (e.loaded >= e.total) notifyOnce();
      }
    };
    xhr.upload.onload = () => notifyOnce();
    return notifyOnce;
  }

  function postTranscription(url, apiKey, formData, onProgress, onComplete) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", `Bearer ${apiKey}`);
      const notifyUploadDone = wireXhrUploadComplete(xhr, onProgress, onComplete);
      xhr.onload = () => {
        notifyUploadDone();
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
      const notifyUploadDone = wireXhrUploadComplete(xhr, onProgress, onComplete);
      xhr.onload = () => {
        notifyUploadDone();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText || "{}"));
          } catch {
            reject(new Error("GENERIC"));
          }
        } else {
          let detail = "";
          let parsed = {};
          try {
            parsed = JSON.parse(xhr.responseText || "{}");
            detail = String(parsed?.error || parsed?.message || "").trim();
          } catch {
            detail = String(xhr.responseText || "").trim();
          }
          // 429 : quota dépassé → erreur dédiée avec message du serveur
          if (xhr.status === 429) {
            const err = new Error(detail || "Quota journalier atteint.");
            err.status = 429;
            err.quotaExceeded = true;
            return reject(err);
          }
          // 401 : session expirée → forcer reconnexion
          if (xhr.status === 401) {
            clearAuthUser?.();
            const err = new Error("Session expirée. Reconnecte-toi.");
            err.status = 401;
            return reject(err);
          }
          const err = new Error("BACKEND_ERROR");
          err.status = xhr.status;
          err.detail = detail;
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error("NETWORK_ERROR"));
      xhr.send(formData);
    });
  }
