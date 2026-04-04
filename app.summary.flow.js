  // ========= Episode summary (Transcription 2) =========
  function setStep2(name, status) {
    const el = document.querySelector(`.step[data-step2="${name}"]`);
    if (!el) return;
    el.dataset.status = status;
    el.querySelector(".s-idle").style.display = status === "idle" || status === "active" ? "" : "none";
    el.querySelector(".s-done").style.display = status === "done" ? "" : "none";
    el.querySelector(".s-err").style.display = status === "error" ? "" : "none";
  }

  function resetStepper2() {
    ["prep", "upload", "transcribe", "summary"].forEach((s) => setStep2(s, "idle"));
  }

  function setProgress2(pct) {
    if (!progressFill2 || !progressBar2) return;
    const p = Math.min(100, Math.max(0, Number(pct) || 0));
    progressFill2.style.width = `${p.toFixed(1)}%`;
    progressBar2.setAttribute("aria-valuenow", String(Math.round(p)));
  }

  function setEta2(msg) {
    if (progressEta2) progressEta2.textContent = msg;
  }

  function setRemain2(msg) {
    if (progressRemain2) progressRemain2.textContent = msg;
  }

  function stopSummaryPulse2() {
    if (summaryPulseTimer2) {
      clearInterval(summaryPulseTimer2);
      summaryPulseTimer2 = null;
    }
  }

  function startSummaryPulse2(from = 60, to = 92) {
    stopSummaryPulse2();
    let p = from;
    summaryPulseTimer2 = setInterval(() => {
      p = Math.min(to, p + (p < 80 ? 1.2 : 0.55));
      setProgress2(p);
    }, 550);
  }

  function syncExtractUi2(file) {
    if (!extractRow2 || !extractAudio2) return;
    if (!file) {
      extractRow2.classList.add("hidden");
      return;
    }
    const show = isVideoFile(file);
    extractRow2.classList.toggle("hidden", !show);
    if (!show) return;
    extractAudio2.disabled = !canUseFfmpegExtract();
    if (!canUseFfmpegExtract()) {
      extractAudio2.checked = false;
      return;
    }
    const saved = localStorage.getItem(EPISODE_SUMMARY_EXTRACT_PREF_KEY);
    extractAudio2.checked = saved == null ? true : saved === "1";
  }

  function refreshRunButton2() {
    if (!runBtn2) return;
    const ok = !!selectedFile2;
    runBtn2.disabled = !ok;
    runBtn2.setAttribute("aria-disabled", String(!ok));
  }

  function setSelectedFile2(file) {
    selectedFile2 = file || null;
    if (!dropzone2 || !dzFileName2 || !dzFileMeta2) {
      refreshRunButton2();
      return;
    }
    if (selectedFile2) {
      dropzone2.classList.remove("is-error");
      dropzone2.classList.add("is-success");
      dzFileName2.textContent = selectedFile2.name;
      dzFileMeta2.textContent = `${(selectedFile2.size / (1024 * 1024)).toFixed(1)} Mo`;
    } else {
      dropzone2.classList.remove("is-success", "is-error");
      dzFileName2.textContent = "";
      dzFileMeta2.textContent = "";
    }
    syncExtractUi2(selectedFile2);
    refreshRunButton2();
  }

  function resetEpisodeSummaryUi() {
    stopSummaryPulse2();
    if (summaryUploadPanel) summaryUploadPanel.hidden = false;
    if (summaryProgressPanel) summaryProgressPanel.hidden = true;
    if (summaryResultPanel) summaryResultPanel.hidden = true;
    if (actionRow2) actionRow2.hidden = false;
    if (progressRemain2) progressRemain2.textContent = "";
    setEta2("Analyse de l'épisode en cours…");
    setProgress2(0);
    resetStepper2();
    refreshRunButton2();
  }

  function renderEpisodeSummaryResult(payload, baseName) {
    const short = String(payload?.summary?.short || "").trim();
    const long = String(payload?.summary?.long || "").trim();
    const points = Array.isArray(payload?.summary?.keyPoints) ? payload.summary.keyPoints : [];
    const durationSec = Number(payload?.meta?.durationSec || 0);
    const mins = Math.max(0, Math.round(durationSec / 60));
    if (summaryMeta2) summaryMeta2.textContent = `${baseName} · ${mins} min analysées`;
    if (summaryShort2) summaryShort2.textContent = short || "Résumé court indisponible.";
    if (summaryLong2) summaryLong2.textContent = long || "Résumé détaillé indisponible.";
    if (summaryPoints2) {
      summaryPoints2.innerHTML = points
        .slice(0, 8)
        .map((point) => `<li>${escapeHtml(String(point || "").trim())}</li>`)
        .join("");
      if (!summaryPoints2.innerHTML) {
        summaryPoints2.innerHTML = "<li>Aucun point clé détecté.</li>";
      }
    }
  }

  async function copyEpisodeSummaryToClipboard() {
    const short = String(summaryShort2?.textContent || "").trim();
    const long = String(summaryLong2?.textContent || "").trim();
    const points = Array.from(summaryPoints2?.querySelectorAll("li") || [])
      .map((li) => String(li.textContent || "").trim())
      .filter(Boolean);
    const text = [
      "Résumé court",
      short,
      "",
      "Résumé détaillé",
      long,
      "",
      "Points clés",
      ...points.map((p, i) => `${i + 1}. ${p}`),
    ]
      .filter(Boolean)
      .join("\n");
    if (!text.trim()) {
      showToast("Aucun résumé à copier.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("Résumé épisode copié.");
    } catch {
      showToast("Impossible de copier automatiquement.");
    }
  }

  if (extractAudio2) {
    extractAudio2.addEventListener("change", () => {
      localStorage.setItem(EPISODE_SUMMARY_EXTRACT_PREF_KEY, extractAudio2.checked ? "1" : "0");
    });
  }
  if (pickBtn2 && fileInput2) {
    pickBtn2.onclick = () => fileInput2.click();
  }
  if (changeFileBtn2 && fileInput2) {
    changeFileBtn2.onclick = (e) => {
      e.stopPropagation();
      fileInput2.click();
    };
  }
  if (fileInput2) {
    fileInput2.onchange = () => setSelectedFile2(fileInput2.files?.[0] || null);
  }
  if (dropzone2 && fileInput2) {
    dropzone2.addEventListener("click", (e) => {
      if (e.target === changeFileBtn2 || dropzone2.classList.contains("is-success")) return;
      fileInput2.click();
    });
    dropzone2.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fileInput2.click();
      }
    });
    dropzone2.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dropzone2.classList.add("is-dragover");
    });
    dropzone2.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone2.classList.add("is-dragover");
    });
    dropzone2.addEventListener("dragleave", () => {
      dropzone2.classList.remove("is-dragover");
    });
    dropzone2.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone2.classList.remove("is-dragover");
      const file = e.dataTransfer?.files?.[0] || null;
      if (!file) return;
      if (!isLikelyMedia(file)) {
        dropzone2.classList.remove("is-success");
        dropzone2.classList.add("is-error");
        setTimeout(() => dropzone2.classList.remove("is-error"), 3000);
        return;
      }
      setSelectedFile2(file);
    });
  }

  function syncSummaryProviderUi() {
    const v = summaryProviderSelect?.value || "groq";
    if (geminiKeyRow2) geminiKeyRow2.classList.toggle("hidden", v !== "gemini");
  }

  if (summaryProviderSelect) {
    const saved = localStorage.getItem(EPISODE_SUMMARY_PROVIDER_KEY);
    if (saved === "gemini" || saved === "groq") summaryProviderSelect.value = saved;
    syncSummaryProviderUi();
    summaryProviderSelect.addEventListener("change", () => {
      localStorage.setItem(EPISODE_SUMMARY_PROVIDER_KEY, summaryProviderSelect.value);
      syncSummaryProviderUi();
    });
  }
  if (geminiApiKeyInput2) {
    const gk = localStorage.getItem(EPISODE_SUMMARY_GEMINI_KEY);
    if (gk) geminiApiKeyInput2.value = gk;
    geminiApiKeyInput2.addEventListener("change", () => {
      const t = geminiApiKeyInput2.value.trim();
      if (t) localStorage.setItem(EPISODE_SUMMARY_GEMINI_KEY, t);
      else localStorage.removeItem(EPISODE_SUMMARY_GEMINI_KEY);
    });
  }

  if (summaryCopyBtn2) summaryCopyBtn2.onclick = () => copyEpisodeSummaryToClipboard();
  if (summaryNewBtn2) {
    summaryNewBtn2.onclick = () => {
      setSelectedFile2(null);
      if (fileInput2) fileInput2.value = "";
      resetEpisodeSummaryUi();
    };
  }

  if (runBtn2) {
    runBtn2.onclick = async () => {
      const backendUrl = getBackendUrl();
      if (!selectedFile2) return;

      runBtn2.disabled = true;
      if (pickBtn2) pickBtn2.disabled = true;
      if (extractAudio2) extractAudio2.disabled = true;
      if (actionRow2) actionRow2.hidden = true;
      if (summaryUploadPanel) summaryUploadPanel.hidden = true;
      if (summaryProgressPanel) summaryProgressPanel.hidden = false;
      if (summaryResultPanel) summaryResultPanel.hidden = true;

      resetStepper2();
      setProgress2(0);
      setEta2("Préparation de l'épisode…");
      setRemain2("");
      sr("Analyse épisode démarrée.");

      const baseName = selectedFile2.name.replace(/\.[^/.]+$/, "") || "episode";

      try {
        setStep2("prep", "active");
        setProgress2(8);
        let fileToSend = selectedFile2;
        if (isVideoFile(selectedFile2) && extractAudio2?.checked && canUseFfmpegExtract()) {
          setEta2("Extraction audio en cours…");
          await loadFfmpeg();
          fileToSend = await extractAudioTrack(selectedFile2);
        }
        setStep2("prep", "done");
        setProgress2(15);

        setStep2("upload", "active");
        setEta2("Envoi de l'épisode…");
        const formData = new FormData();
        formData.append("file", fileToSend);

        const provider = String(summaryProviderSelect?.value || "groq").trim().toLowerCase();
        const extraHeaders = { "x-summary-provider": provider === "gemini" ? "gemini" : "groq" };
        const gkEp =
          String(geminiApiKeyInput2?.value || "").trim() ||
          String(localStorage.getItem(GEMINI_KEY_STORAGE) || "").trim();
        if (gkEp) extraHeaders["x-gemini-api-key"] = gkEp;

        const data = await postBackendTranscription(
          `${backendUrl.replace(/\/$/, "")}/api/episode-summary`,
          formData,
          (p) => {
            setProgress2(15 + p * 45);
            setRemain2(p > 0.96 ? "Traitement serveur…" : "Envoi en cours…");
          },
          () => {
            setStep2("upload", "done");
            setStep2("transcribe", "active");
            setProgress2(60);
            setEta2("Transcription IA de l'épisode…");
            setRemain2("Analyse du contenu…");
            startSummaryPulse2(60, 90);
          },
          extraHeaders
        );

        stopSummaryPulse2();
        setStep2("transcribe", "done");
        setStep2("summary", "active");
        setProgress2(94);
        setEta2("Génération du résumé final…");
        setRemain2("Finalisation…");

        if (!data?.summary?.short && !data?.summary?.long) throw new Error("GENERIC");

        renderEpisodeSummaryResult(data, baseName);
        setStep2("summary", "done");
        setProgress2(100);
        setEta2("Résumé terminé");
        setRemain2("");

        setTimeout(() => {
          if (summaryProgressPanel) summaryProgressPanel.hidden = true;
          if (summaryResultPanel) summaryResultPanel.hidden = false;
        }, 400);
      } catch (err) {
        stopSummaryPulse2();
        const active = document.querySelector('.step[data-step2][data-status="active"]');
        if (active) setStep2(active.dataset.step2, "error");
        const retryLabel = extractRateLimitRetryLabel(err?.detail || "");
        const apiLabel = String(summaryProviderSelect?.value || "groq") === "gemini" ? "API (Gemini)" : "Groq";
        const msg = retryLabel
          ? `Quota ${apiLabel} atteint. Réessaie dans ${retryLabel}.`
          : err?.message === "NETWORK_ERROR"
            ? "Connexion interrompue pendant le résumé."
            : "Erreur pendant la génération du résumé d'épisode.";
        showToast(msg);
        sr("Erreur : " + msg);
        setTimeout(() => {
          resetEpisodeSummaryUi();
        }, 900);
      } finally {
        if (pickBtn2) pickBtn2.disabled = false;
        if (extractAudio2) extractAudio2.disabled = false;
        refreshRunButton2();
      }
    };
  }

  // init
  resetWordingState();
  initPinGate();
  initNav();
  setEta(ETA_TRANSCRIBE);
  refreshRunButton();
  resetEpisodeSummaryUi();
