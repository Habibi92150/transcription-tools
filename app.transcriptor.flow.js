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
        showToast(`Wording ${idx + 1} copié.`);
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
        setEta("Préparation audio pour le backend…");
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

      const retryLabel = extractRateLimitRetryLabel(err?.detail || "");
      const msg = retryLabel
        ? `Quota Groq atteint. Réessaie dans ${retryLabel}.`
        : ERROR_MESSAGES[err.message] || ERROR_MESSAGES.GENERIC;
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
