  function resetWordingState() {
    wordingState = { loading: false, items: [], source: "" };
    if (reviewWordingSource) reviewWordingSource.textContent = "Contexte : extrait Instagram (début · milieu · fin si long)";
    if (reviewWordingStatus) reviewWordingStatus.textContent = "En attente de génération.";
    if (reviewWordingList) {
      reviewWordingList.innerHTML =
        '<div class="wording-empty">Clique sur « Générer 5 wordings » pour créer des variantes (humour, émotion, tension, etc.).</div>';
    }
  }

  function buildWordingExcerpt() {
    if (!reviewState?.editedSegments?.length) return null;
    const segs = reviewState.editedSegments;
    const fullText = segs
      .map((seg) => String(seg?.text || "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!fullText) return null;
    const compressed = buildCompressedTranscriptForWordings(fullText);
    const first = segs[0] || {};
    const last = segs[segs.length - 1] || {};
    const timeRange = `${formatReviewTime(first.start)} -> ${formatReviewTime(last.end)}`;
    const source = compressed.truncated
      ? `Instagram · extrait wording ${compressed.excerptChars.toLocaleString("fr-FR")}/${compressed.originalChars.toLocaleString("fr-FR")} car. (début + milieu + fin) · ${segs.length} segments (${timeRange})`
      : `Instagram · transcription complète dans la fenêtre wording (${compressed.excerptChars.toLocaleString("fr-FR")} car.) · ${segs.length} segments (${timeRange})`;
    return { text: compressed.excerpt, source, fullChars: compressed.originalChars, truncated: compressed.truncated };
  }

  function renderWordingResults() {
    if (!reviewWordingList || !reviewWordingStatus) return;
    if (wordingState.loading) {
      reviewWordingStatus.textContent = "Génération en cours…";
      reviewWordingList.innerHTML = '<div class="wording-empty">Génération des 5 propositions en cours…</div>';
      return;
    }
    if (!wordingState.items.length) {
      reviewWordingStatus.textContent = "Aucun wording généré.";
      reviewWordingList.innerHTML = '<div class="wording-empty">Aucun résultat pour le moment.</div>';
      return;
    }
    reviewWordingStatus.textContent = "5 variantes générées.";
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

  function normalizeWordingMoodLabel(mood) {
    const s = String(mood || "").trim();
    if (/^emotion$/i.test(s)) return "Émotion";
    return s;
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
            mood: normalizeWordingMoodLabel(angle || WORDING_MOODS[i] || `Humeur ${i + 1}`),
            text,
          };
        })
        .filter((item) => item.text.length > 0);
    }
    if (!list || !list.length) return [];
    return list
      .slice(0, 5)
      .map((item, i) => ({
        mood: normalizeWordingMoodLabel(String(item?.mood || WORDING_MOODS[i] || `Humeur ${i + 1}`).trim()),
        text: String(item?.text || item?.wording || "").trim(),
      }))
      .filter((item) => item.text.length > 0);
  }

  async function generateWordingsFromExcerpt() {
    if (!reviewState?.editedSegments?.length) {
      showToast("Aucun segment disponible pour générer les wordings.");
      return;
    }
    if (!currentUser) { showAuthModal?.("login"); return; }
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
      `Platform: ${WORDING_BRIEF_DEFAULTS.platform} only (Feed / Reels captions — no other network).`,
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
      "Output is always for Instagram captions (Reels/Feed) only.",
      "Generate exactly 5 caption options from the brief.",
      "Each option must use a different angle in this exact order: Humour, Émotion, Tension, Inspiration, Impact.",
      "Write concise social-native copy. No generic filler.",
      "Forbidden phrases: \"Decouvrez\", \"Don't miss out\", \"Game-changer\".",
      "caption_full must be <= MaxChars unless brief says otherwise.",
      "Use at least one emoji per option when relevant.",
      "TrendPack is authoritative Q1 2026 guidance: align hooks with top_hook_patterns, respect algorithm_signals_2026 (hook window, saves/shares/replies, caption SEO), favor what_is_winning, avoid what_is_dying.",
      "Set trend_status to trend_used when you meaningfully apply TrendPack; use no_relevant_live_trend_found only if the transcript truly cannot map without forcing. Do not invent extra sources beyond TrendPack.sources labels.",
      "Return ONLY valid JSON with this structure:",
      "{\"trend_status\":\"trend_used|no_relevant_live_trend_found\",\"options\":[{\"angle\":\"...\",\"hook\":\"...\",\"body\":\"...\",\"cta\":\"...\",\"caption_full\":\"...\",\"char_count\":0,\"pattern_note\":\"...\"}],\"wordings\":[{\"mood\":\"Humour\",\"text\":\"...\"},{\"mood\":\"Émotion\",\"text\":\"...\"},{\"mood\":\"Tension\",\"text\":\"...\"},{\"mood\":\"Inspiration\",\"text\":\"...\"},{\"mood\":\"Impact\",\"text\":\"...\"}]}",
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
      "Transcript excerpt for this job (ordered STT text; if markers [… passage omis …] appear, the full episode exists in the editor — use every concrete phrase you see, across beginning/middle/end slices):",
      excerpt.text,
      "",
      "Output constraints:",
      "- Return exactly 5 options and exactly 5 wordings.",
      "- Each option: hook + body (max 3 short lines) + CTA.",
      "- Each wording text must stay short, catchy, social media friendly.",
      "- Anchor hooks in real lines from the excerpt; do not invent facts absent from the excerpt.",
    ].join("\n");

    try {
      const backendUrl = (localStorage.getItem(BACKEND_URL_STORAGE_KEY) || DEFAULT_BACKEND_URL).replace(/\/$/, "");
      const token      = await getFreshAuthToken();
      const res = await fetch(`${backendUrl}/api/wording`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model:       WORDING_MODEL,
          temperature: 0.82,
          systemPrompt,
          userPrompt,
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
      showToast("Échec de génération des wordings. Réessaie dans quelques secondes.");
      if (reviewWordingStatus) reviewWordingStatus.textContent = "Erreur de génération.";
    } finally {
      wordingState.loading = false;
      renderWordingResults();
    }
  }

  function captureReviewFrame() {
    if (reviewPlayer.classList.contains("hidden")) {
      showToast("La capture d'image n'est disponible qu'en mode vidéo.");
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
          showToast("Impossible de capturer cette image.");
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
        showToast(`Capture téléchargée : ${name}`);
      },
      "image/jpeg",
      0.94
    );
  }

  function buildSrtFromSegments(segments) {
    const hasSpeakerData = (Array.isArray(segments) ? segments : []).some((seg) => !!normalizeSpeaker(seg?.speaker));
    return hasSpeakerData ? toSrtWithSpeakers(segments, { labelEveryCue: false }) : toSrt(segments);
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

  function setReviewListHeader() {
    if (!reviewListHead || !reviewState) return;
    const compact = reviewState.reviewFlow === "cloud-premium";
    reviewListHead.classList.toggle("review-list-head--cloud", compact);
    if (compact) {
      reviewListHead.innerHTML =
        '<span class="review-h-num">#</span><span>Début</span><span>Fin</span><span>Texte</span><span>Sync</span>';
    } else {
      reviewListHead.innerHTML =
        '<span>Start</span><span>End</span><span>Speaker</span><span>Texte</span><span>Sync</span>';
    }
  }

  function renderReviewList() {
    if (!reviewState || !Array.isArray(reviewState.editedSegments)) {
      reviewList.innerHTML = "";
      return;
    }
    setReviewListHeader();
    const compact = reviewState.reviewFlow === "cloud-premium";
    const rows = reviewState.editedSegments
      .map((seg, idx) => {
        const speaker = String(seg?.speaker || "");
        const text = String(seg?.text || "");
        const rgb = speakerColorRgb(speaker);
        if (compact) {
          return `
          <div class="review-row review-row--cloud-premium" data-idx="${idx}" style="--speaker-rgb:${rgb}">
            <span class="review-num" aria-hidden="true">${idx + 1}</span>
            <input type="text" class="review-time-input" data-field="start" data-idx="${idx}" value="${formatReviewTimecode(
            seg.start
          )}" aria-label="Début segment ${idx + 1}" />
            <input type="text" class="review-time-input" data-field="end" data-idx="${idx}" value="${formatReviewTimecode(
            seg.end
          )}" aria-label="Fin segment ${idx + 1}" />
            <div class="review-text review-text--editable" contenteditable="true" spellcheck="true" data-field="text" data-idx="${idx}" tabindex="0">${escapeHtml(
              text
            )}</div>
            <button type="button" class="review-jump" data-jump="${idx}" title="Aller au segment">▶</button>
          </div>
        `;
        }
        return `
          <div class="review-row" data-idx="${idx}" style="--speaker-rgb:${rgb}">
            <div class="review-time">${formatReviewTime(seg.start)}</div>
            <div class="review-time">${formatReviewTime(seg.end)}</div>
            <input class="review-speaker" data-field="speaker" data-idx="${idx}" value="${speaker.replace(/"/g, "&quot;")}" placeholder="SPEAKER_00" />
            <textarea class="review-text" data-field="text" data-idx="${idx}">${escapeHtml(text)}</textarea>
            <button type="button" class="review-jump" data-jump="${idx}" title="Aller au segment">▶</button>
          </div>
        `;
      })
      .join("");
    reviewList.innerHTML = rows;
    setReviewActiveIndex(reviewActiveIndex);
  }

  /** Prépare l’éditeur (données + média) sans changer les panneaux — la progression reste visible. */
  function prepareReviewPanel(baseName, segments, originalFile, reviewFlow) {
    cleanupReviewMedia();
    const flowKind = reviewFlow === "cloud-premium" ? "cloud-premium" : "backend";
    if (reviewPanel) reviewPanel.dataset.flow = flowKind;
    reviewState = {
      baseName,
      originalSegments: cloneSegmentsForReview(segments),
      editedSegments: cloneSegmentsForReview(segments),
      reviewFlow: flowKind,
    };
    reviewMeta.textContent = `${baseName}_transcription_corrigee.srt`;
    if (reviewOverlayToggle) reviewOverlayToggle.checked = true;
    if (reviewPanelToggle) reviewPanelToggle.checked = true;

    if (originalFile) {
      const isVideo = isVideoFile(originalFile);
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
    reviewPanel.hidden = true;
  }

  /** Affiche l’éditeur après la phase progression (stepper terminé). */
  function revealReviewPanel() {
    if (!reviewState) return;
    uploadPanel.hidden = true;
    progressPanel.hidden = true;
    exportPanel.hidden = true;
    reviewPanel.hidden = false;
    actionRow.hidden = true;
    sr("Relecture prête. Corrige les segments puis exporte le .srt.");
  }
