(() => {
  "use strict";

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
    const showSpeakerLabel = opts?.showSpeakerLabel === true;
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

  window.SrtCore = {
    toSrt,
    toSrtWithSpeakers,
    normalizeSpeaker,
    speakerColorRgb,
  };
})();
