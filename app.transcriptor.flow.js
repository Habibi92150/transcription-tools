  function setInfoStep(activeNum) {
    document.querySelectorAll("#page-transcriptor .info-step").forEach((el, i) => {
      const num = i + 1;
      el.classList.toggle("info-step--active", num === activeNum);
      el.classList.toggle("info-step--done", num < activeNum);
      el.classList.toggle("info-step--inactive", num > activeNum);
    });
  }

  // ========= Events =========
  extractAudio.addEventListener("change", () => {
    localStorage.setItem(EXTRACT_AUDIO_PREF_KEY, extractAudio.checked ? "1" : "0");
  });

  if (pickBtn) pickBtn.onclick = () => fileInput.click();
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

  // Récupérer la backendUrl depuis /api/config si disponible
  fetch("/api/config")
    .then((r) => {
      if (!r.ok) throw new Error(`config ${r.status}`);
      return r.json();
    })
    .then((cfg) => {
      if (cfg.backendUrl && backendUrlInput) {
        // Serveur connaît la bonne URL → on force et on met à jour localStorage
        backendUrlInput.value = cfg.backendUrl;
        localStorage.setItem(BACKEND_URL_STORAGE_KEY, cfg.backendUrl);
      } else if (backendUrlInput) {
        // Pas d'URL serveur (dev local) → localStorage puis défaut
        const savedBackendUrl = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
        backendUrlInput.value = savedBackendUrl || DEFAULT_BACKEND_URL;
      }
      refreshRunButton();
    })
    .catch(() => {
      // /api/config inaccessible (dev local hors ligne) → fallback localStorage
      if (backendUrlInput) {
        const savedBackendUrl = localStorage.getItem(BACKEND_URL_STORAGE_KEY);
        backendUrlInput.value = savedBackendUrl || DEFAULT_BACKEND_URL;
      }
    });
  const savedReviewMode = localStorage.getItem(REVIEW_MODE_STORAGE_KEY);
  if (reviewMode) reviewMode.checked = savedReviewMode == null ? true : savedReviewMode === "1";
  // localMode toujours actif (Gemini pour tous)
  if (localMode) localMode.checked = true;
  syncModeUi();
  setInfoStep(1);

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
    setInfoStep(1);
    setSelectedFile(null);
    fileInput.value = "";
    resetUI();
  };

  reviewList.addEventListener("focusout", (e) => {
    if (!reviewState) return;
    const target = e.target;
    const field = target?.dataset?.field;
    if (field !== "start" && field !== "end") return;
    const idx = Number(target.dataset.idx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= reviewState.editedSegments.length) return;
    const seg = reviewState.editedSegments[idx];
    const parsed = parseReviewTimecode(String(target.value || "").trim());
    if (!Number.isFinite(parsed)) {
      target.value = formatReviewTimecode(field === "start" ? seg.start : seg.end);
      return;
    }
    if (field === "start") {
      if (parsed >= seg.end) {
        target.value = formatReviewTimecode(seg.start);
        return;
      }
      seg.start = parsed;
      target.value = formatReviewTimecode(seg.start);
    } else {
      if (parsed <= seg.start) {
        target.value = formatReviewTimecode(seg.end);
        return;
      }
      seg.end = parsed;
      target.value = formatReviewTimecode(seg.end);
    }
  });

  reviewList.addEventListener("input", (e) => {
    if (!reviewState) return;
    const target = e.target;
    const idx = Number(target?.dataset?.idx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= reviewState.editedSegments.length) return;
    if (target.dataset.field === "text") {
      const raw =
        target.tagName === "TEXTAREA"
          ? String(target.value || "")
          : String(target.textContent || "").replace(/\u00a0/g, " ");
      reviewState.editedSegments[idx].text = raw;
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
    setInfoStep(3);
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

  if (reviewCancelBtn) {
    reviewCancelBtn.onclick = () => {
      cleanupReviewMedia();
      reviewPanel.hidden = true;
      uploadPanel.hidden = false;
      actionRow.hidden = false;
      exportPanel.hidden = true;
      progressPanel.hidden = true;
      sr("Relecture annulée.");
      refreshRunButton();
    };
  }

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
    if (!selectedFile) return;
    if (!currentUser) { showAuthModal("login"); return; }

    setInfoStep(1);
    const backendUrl = getBackendUrl();
    const modeKey    = "local";
    const jobT0      = Date.now();

    runBtn.disabled = true;
    if (pickBtn) pickBtn.disabled = true;
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

    try {
      // STEP 1 — Préparation
      setStep("prep", "active");
      setProgress(5);

      let fileToSend = selectedFile;
      let heavyPrep  = false;
      if (isVideoFile(selectedFile) && extractAudio.checked && canUseFfmpegExtract()) {
        heavyPrep = true;
        await loadFfmpeg();
        fileToSend = await extractAudioTrack(selectedFile);
      }
      setStep("prep", "done");
      setProgress(15);

      const mb             = fileToSend.size / (1024 * 1024);
      const estimatedApiMs = Math.max(20000, mb * 12000);
      const learnedTotal   = medianLearnedTotalMs(fileToSend.size, modeKey);
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

      const token = getAuthToken();
      const backendHeaders = {};
      if (token) backendHeaders["Authorization"] = `Bearer ${token}`;

      const data = await postBackendTranscription(
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
          sr("Fichier envoyé. Transcription Gemini en cours.");
          tickRemain();
        },
        backendHeaders
      );

      // STEP 3 — Transcription done
      setStep("transcribe", "done");
      setProgress(93);
      setEta(ETA_FINALIZE);

      // STEP 4 — Génération .srt
      setStep("format", "active");
      let segments = Array.isArray(data.segments) ? data.segments : [];
      if (!segments.length) throw new Error("NO_SEGMENTS");

      // Mettre à jour le quota affiché dans la bannière
      if (currentUser) {
        currentUser.usageToday = (currentUser.usageToday || 0) + 1;
        updateUserBanner();
      }

      const reviewEnabled = !!reviewMode?.checked;
      const srtFileName   = `${baseName}_transcription.srt`;
      if (reviewEnabled) {
        prepareReviewPanel(baseName, segments, selectedFile, "backend");
      } else {
        download(buildSrtFromSegments(segments), srtFileName);
      }

      setStep("format", "done");
      setProgress(100);
      recordJobStat(fileToSend.size, modeKey, Date.now() - jobT0);
      stopRemainTimer();
      setEta("Terminé");
      sr(reviewEnabled ? "Transcription terminée. Ouverture de la relecture…" : "Transcription terminée. Le fichier .srt a été téléchargé.");

      setTimeout(() => {
        progressPanel.hidden = true;
        if (reviewEnabled) {
          exportPanel.hidden = true;
          revealReviewPanel();
          setInfoStep(2);
        } else {
          exportPanel.hidden = false;
          exportMeta.textContent = `${srtFileName} · ${segments.length} segments`;
        }
      }, 900);
    } catch (err) {
      stopRemainTimer();
      const activeStep = document.querySelector(".step[data-status='active']");
      if (activeStep) setStep(activeStep.dataset.step, "error");

      // 429 : quota journalier dépassé → toaster rouge dédié
      if (err.status === 429 || err.quotaExceeded) {
        showToastError(err.message || "Quota journalier atteint. Reviens demain.");
      } else {
        const msg = ERROR_MESSAGES[err.message] || err.message || ERROR_MESSAGES.GENERIC;
        showToast(msg);
      }
      sr("Erreur : transcription échouée.");

      setTimeout(() => {
        uploadPanel.hidden = false;
        actionRow.hidden = false;
        progressPanel.hidden = true;
        resetUI();
      }, 1500);
    } finally {
      if (pickBtn) pickBtn.disabled = false;
      extractAudio.disabled = false;
      refreshRunButton();
    }
  };
