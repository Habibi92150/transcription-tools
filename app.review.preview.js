  // ========= SRT core =========
  const srtCore = window.SrtCore || {};
  const toSrt = srtCore.toSrt;
  const toSrtWithSpeakers = srtCore.toSrtWithSpeakers;
  const normalizeSpeaker = srtCore.normalizeSpeaker;
  const speakerColorRgb = srtCore.speakerColorRgb;
  if (!toSrt || !toSrtWithSpeakers || !normalizeSpeaker || !speakerColorRgb) {
    throw new Error("srt-core.js non chargé");
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
    const prevSeg =
      reviewState && Array.isArray(reviewState.editedSegments) && activeIndex > 0
        ? reviewState.editedSegments[activeIndex - 1]
        : null;
    const curSp = normalizeSpeaker(speaker);
    const prevSp = normalizeSpeaker(prevSeg?.speaker);
    const isNewSpeaker = Boolean(curSp) && curSp !== prevSp;
    const lineForDisplay = String(text || "").trim().replace(/^\s*[-–—]\s+/, "");
    const overlayText = isNewSpeaker && lineForDisplay ? `- ${lineForDisplay}` : lineForDisplay;

    if (showOverlay && text) {
      reviewOverlay.classList.remove("hidden");
      reviewOverlaySpeaker.textContent = "";
      reviewOverlaySpeaker.style.display = "none";
      reviewOverlayText.textContent = overlayText;
      reviewOverlayText.style.border = `1px solid rgba(${rgb},0.72)`;
    } else {
      reviewOverlay.classList.add("hidden");
      reviewOverlaySpeaker.textContent = "";
      reviewOverlayText.textContent = "";
      reviewOverlayText.style.border = "none";
    }

    if (showPanel && text) {
      reviewCaptionPanel.classList.remove("hidden");
      reviewCaptionSpeaker.textContent = "";
      reviewCaptionText.textContent = overlayText;
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
