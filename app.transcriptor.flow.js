  function isPremiumSessionUnlocked() {
    try {
      const token = sessionStorage.getItem("premiumToken");
      const expiresAt = Number(sessionStorage.getItem("premiumTokenExpiry"));
      if (!token || !Number.isFinite(expiresAt)) return false;
      return Date.now() < expiresAt;
    } catch {
      return false;
    }
  }

  function syncPremiumTierLockedClass() {
    if (tierPaidBtn) {
      tierPaidBtn.classList.toggle("tier-segment__btn--premium-locked", !isPremiumSessionUnlocked());
    }
    if (reviewMode) {
      reviewMode.disabled = !isPremiumSessionUnlocked();
      if (!isPremiumSessionUnlocked()) reviewMode.checked = false;
    }
  }

  function openPremiumPin() {
    const gate = document.getElementById("premiumPinGate");
    const input = document.getElementById("premiumPinInput");
    const errEl = document.getElementById("premiumPinError");
    if (!gate || !input) return;
    gate.classList.remove("hidden");
    if (errEl) errEl.classList.add("hidden");
    input.value = "";
    input.focus();
  }

  function closePremiumPin() {
    const gate = document.getElementById("premiumPinGate");
    const input = document.getElementById("premiumPinInput");
    const errEl = document.getElementById("premiumPinError");
    if (gate) gate.classList.add("hidden");
    if (input) input.value = "";
    if (errEl) errEl.classList.add("hidden");
  }

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

  const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
  if (savedKey) apiKeyInput.value = savedKey;
  // /api/config en URL relative = toujours correct quel que soit le localStorage du client
  // Si le serveur renvoie une backendUrl, elle prime TOUJOURS sur localStorage (évite les URLs périmées)
  fetch("/api/config")
    .then((r) => {
      if (!r.ok) throw new Error(`config ${r.status}`);
      return r.json();
    })
    .then((cfg) => {
      if (cfg.groqApiKey && apiKeyInput && !apiKeyInput.value) apiKeyInput.value = cfg.groqApiKey;
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
  const savedGeminiKey = localStorage.getItem(GEMINI_KEY_STORAGE);
  if (geminiApiKeyInput && savedGeminiKey) geminiApiKeyInput.value = savedGeminiKey;
  const savedLocalMode = localStorage.getItem(LOCAL_MODE_STORAGE_KEY);
  if (localMode) localMode.checked = savedLocalMode === "1";
  const savedReviewMode = localStorage.getItem(REVIEW_MODE_STORAGE_KEY);
  if (reviewMode) reviewMode.checked = savedReviewMode == null ? true : savedReviewMode === "1";
  syncModeUi();
  setInfoStep(1);

  apiKeyInput.oninput = () => {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKeyInput.value.trim());
    refreshRunButton();
  };
  if (geminiApiKeyInput) {
    geminiApiKeyInput.addEventListener("input", () => {
      const t = geminiApiKeyInput.value.trim();
      if (t) localStorage.setItem(GEMINI_KEY_STORAGE, t);
      else localStorage.removeItem(GEMINI_KEY_STORAGE);
    });
  }
  function setLocalBackendMode(enabled) {
    if (!localMode) return;
    localMode.checked = !!enabled;
    localStorage.setItem(LOCAL_MODE_STORAGE_KEY, localMode.checked ? "1" : "0");
    syncModeUi();
    refreshRunButton();
  }
  if (localMode) {
    localMode.onchange = () => {
      localStorage.setItem(LOCAL_MODE_STORAGE_KEY, localMode.checked ? "1" : "0");
      syncModeUi();
      refreshRunButton();
    };
  }
  if (tierFreeBtn) {
    tierFreeBtn.addEventListener("click", () => {
      sessionStorage.removeItem("premiumToken");
      sessionStorage.removeItem("premiumTokenExpiry");
      setLocalBackendMode(false);
    });
  }
  if (tierPaidBtn) {
    tierPaidBtn.addEventListener(
      "click",
      (e) => {
        if (isPremiumSessionUnlocked()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        openPremiumPin();
      },
      { capture: true }
    );
    tierPaidBtn.addEventListener("click", () => setLocalBackendMode(true));
    syncPremiumTierLockedClass();
  }

  const premiumPinGate = document.getElementById("premiumPinGate");
  const premiumPinForm = document.getElementById("premiumPinForm");
  if (premiumPinForm) {
    premiumPinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("premiumPinInput");
      const errEl = document.getElementById("premiumPinError");
      const card = document.querySelector("#premiumPinGate .premium-pin-card");
      const submitBtn = premiumPinForm.querySelector("button[type=submit]");
      const pin = String(input?.value || "").trim();
      if (!pin) return;
      if (submitBtn) submitBtn.disabled = true;
      try {
        let backendUrl = getBackendUrl().replace(/\/$/, "");
        try {
          const h = String(location.hostname || "");
          const saved = String(localStorage.getItem(BACKEND_URL_STORAGE_KEY) || "").trim();
          const localPage = !h || h === "localhost" || h === "127.0.0.1";
          if (localPage && !saved) {
            backendUrl = "http://127.0.0.1:8787";
          }
        } catch {
          /* ignore */
        }
        const res = await fetch(backendUrl + "/api/auth/premium", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.token && data.expiresAt) {
          sessionStorage.setItem("premiumToken", data.token);
          sessionStorage.setItem("premiumTokenExpiry", String(data.expiresAt));
          if (tierPaidBtn) tierPaidBtn.classList.remove("tier-segment__btn--premium-locked");
          syncPremiumTierLockedClass();
          if (reviewMode) {
            reviewMode.checked = true;
            localStorage.setItem(REVIEW_MODE_STORAGE_KEY, "1");
          }
          closePremiumPin();
          tierPaidBtn?.click();
        } else {
          if (card) {
            card.classList.add("premium-pin-card--shake");
            setTimeout(() => card.classList.remove("premium-pin-card--shake"), 400);
          }
          let errMsg = "PIN incorrect.";
          if (typeof data?.error === "string" && data.error.trim()) {
            errMsg = data.error.trim();
          } else if (res.status === 503) {
            errMsg = "Premium non configure sur ce serveur.";
          }
          if (errEl) {
            errEl.textContent = errMsg;
            errEl.classList.remove("hidden");
          }
          if (input) {
            input.value = "";
            input.focus();
          }
        }
      } catch {
        if (errEl) {
          errEl.textContent =
            "Impossible de contacter le serveur. En local, lance le backend (port 8787) ou enregistre l’URL du serveur dans les réglages.";
          errEl.classList.remove("hidden");
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }
  if (premiumPinGate) {
    premiumPinGate.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closePremiumPin();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const gate = document.getElementById("premiumPinGate");
    if (gate && !gate.classList.contains("hidden")) closePremiumPin();
  });
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
      if (!isPremiumSessionUnlocked()) {
        showToast("Cette fonctionnalité est réservée au tier Premium.");
        return;
      }
      generateWordingsFromExcerpt().catch((err) => {
        showToast("Erreur lors de la génération des wordings. Vérifiez votre clé Groq.");
        console.error("[wording]", err);
      });
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
    const fileName = `${reviewState.baseName}_transcription_corrigee_viapremium.srt`;
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
    if (runBtn.disabled) return; // garde anti double-clic
    runBtn.disabled = true;
    setInfoStep(1);
    syncPremiumKeyOnBlur();
    const apiKey = apiKeyInput.value.trim();
    const localBackendMode = isLocalModeEnabled();
    const backendUrl = getBackendUrl();
    if (!selectedFile) { runBtn.disabled = false; return; }
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
        // Mode Gratuit : Groq uniquement dans le navigateur (aucun backend, aucune Gemini).
        formData.append("model", "whisper-large-v3-turbo");
        formData.append("language", "fr");
        formData.append("temperature", "0");
        formData.append("response_format", "verbose_json");
      }

      const backendHeaders = { "x-groq-api-key": apiKey || "" };
      const premiumToken = sessionStorage.getItem("premiumToken");
      if (premiumToken && isPremiumSessionUnlocked()) {
        backendHeaders["x-premium-token"] = premiumToken;
      }
      const gk = geminiApiKeyInput?.value.trim();
      if (gk) backendHeaders["x-gemini-api-key"] = gk;
      else if (!localBackendMode) backendHeaders["x-skip-gemini"] = "1";
      // mode Premium : pas de x-skip-gemini, le serveur utilise sa propre GEMINI_API_KEY

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
            backendHeaders
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
      let segments = Array.isArray(data.segments) ? data.segments : [];
      if (!segments.length) throw new Error("NO_SEGMENTS");

      // Mode Gratuit (Groq dans le navigateur) : pas de diarisation ni align-speakers.
      // Les locuteurs ne sont pas détectés ; le Premium reste sur /api/transcribe (backend) inchangé.

      const reviewEnabled = !!reviewMode?.checked && isLocalModeEnabled() && isPremiumSessionUnlocked();
      let srtFileName = `${baseName}_transcription_viagratuit.srt`;
      if (reviewEnabled) {
        prepareReviewPanel(baseName, segments, selectedFile, localBackendMode ? "backend" : "cloud-premium");
      } else {
        const srtContent = buildSrtFromSegments(segments);
        download(srtContent, srtFileName);
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
      if (pickBtn) pickBtn.disabled = false;
      extractAudio.disabled = false;
      refreshRunButton();
    }
  };
