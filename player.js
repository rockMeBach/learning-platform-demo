/* =====================================================================
 *  STOCK MARKET ESSENTIALS — Narrated Lesson Player
 *  Loads course content from course.json
 * ===================================================================== */

const $ = (id) => document.getElementById(id);

/* =====================================================================
 *  PEXELS VIDEO FALLBACK CHAIN
 *  Order of attempts depends on environment:
 *    - file:// or localhost dev → tries ./videos/{id}.mp4 first
 *      (lets you work fully offline with downloaded MP4s)
 *    - deployed site (https://) → tries Pexels CDN first
 *      (Pexels honours the Referer header on real domains, no need to ship MP4s)
 * ===================================================================== */
const IS_LOCAL =
  location.protocol === 'file:' ||
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1';

const PEXELS_CDN_VARIANTS = {
  "7579577": [
    "https://videos.pexels.com/video-files/7579577/7579577-uhd_2732_1440_25fps.mp4",
    "https://videos.pexels.com/video-files/7579577/7579577-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/7579577/7579577-hd_1920_1080_25fps.mp4",
    "https://videos.pexels.com/video-files/7579577/7579577-sd_960_506_30fps.mp4"
  ],
  "7578613": [
    "https://videos.pexels.com/video-files/7578613/7578613-uhd_2732_1440_30fps.mp4",
    "https://videos.pexels.com/video-files/7578613/7578613-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/7578613/7578613-sd_960_506_30fps.mp4"
  ],
  "7579561": [
    "https://videos.pexels.com/video-files/7579561/7579561-hd_1080_1920_30fps.mp4",
    "https://videos.pexels.com/video-files/7579561/7579561-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/7579561/7579561-sd_540_960_30fps.mp4"
  ],
  "14003933": [
    "https://videos.pexels.com/video-files/14003933/14003933-uhd_2732_1440_25fps.mp4",
    "https://videos.pexels.com/video-files/14003933/14003933-hd_1920_1080_25fps.mp4",
    "https://videos.pexels.com/video-files/14003933/14003933-sd_960_540_25fps.mp4"
  ],
  "30289541": [
    "https://videos.pexels.com/video-files/30289541/30289541-uhd_2732_1440_30fps.mp4",
    "https://videos.pexels.com/video-files/30289541/30289541-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/30289541/30289541-sd_960_540_30fps.mp4"
  ],
  "34433115": [
    "https://videos.pexels.com/video-files/34433115/34433115-uhd_2732_1440_30fps.mp4",
    "https://videos.pexels.com/video-files/34433115/34433115-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/34433115/34433115-sd_960_540_30fps.mp4"
  ]
};

const VIDEO_VARIANTS = {};
Object.keys(PEXELS_CDN_VARIANTS).forEach(id => {
  const local = `./videos/${id}.mp4`;
  const cdn = PEXELS_CDN_VARIANTS[id];
  // Local dev: local file first, then CDN as backup
  // Deployed: CDN first, local as last-resort backup (in case you uploaded MP4s)
  VIDEO_VARIANTS[id] = IS_LOCAL ? [local, ...cdn] : [...cdn, local];
});

/* =====================================================================
 *  STATE
 * ===================================================================== */
let COURSE = null;
const state = {
  currentLessonId: 1,
  currentSegmentIdx: 0,
  // Word offset within the current segment where playback should start
  // when next speakNarration() runs. Set by seeking.
  startWordIdx: 0,
  playing: false,
  muted: false,
  rate: 1.0,
  completedSegments: new Set(),
  currentUtterance: null,
  currentVideoId: null,
  videoAttemptIdx: 0,
  suppressEndAdvance: false,
  // Continuous timeline state
  segmentStartedAt: 0,         // performance.now() when current segment narration began
  segmentElapsedBeforePause: 0, // ms accumulated in this segment before last pause
  rafId: null                  // requestAnimationFrame id for the progress tick
};
const RATES = [1.0, 1.25, 1.5, 0.75];
let rateIdx = 0;

/* =====================================================================
 *  TIMELINE MODEL
 *  We treat the whole lesson as a continuous timeline. Each segment has an
 *  estimated duration in seconds; the cumulative starts form the timeline.
 *  Interactions are zero-duration "stops" on the line.
 * ===================================================================== */
const WORDS_PER_MINUTE = 160;  // typical English TTS speaking rate

function estimateSegmentDuration(seg, rate = 1) {
  if (seg.type === 'interaction') return 0;
  const wpm = WORDS_PER_MINUTE * rate;
  const words = (seg.narration || '').split(/\s+/).filter(Boolean).length;
  return Math.max(2, (words / wpm) * 60);   // seconds
}

function lessonTimeline() {
  // Recomputed any time the rate changes, but rate change just stretches/squashes.
  const segs = currentLesson().segments;
  let acc = 0;
  return segs.map((seg, i) => {
    const dur = estimateSegmentDuration(seg, state.rate);
    const entry = { idx: i, type: seg.type, duration: dur, start: acc, end: acc + dur };
    acc += dur;
    return entry;
  });
}

function totalLessonDuration() {
  return lessonTimeline().reduce((s, e) => s + e.duration, 0);
}

function timeToSegment(t) {
  // Given an absolute time in seconds, find which segment it falls in,
  // and the offset (in seconds) within that segment.
  const tl = lessonTimeline();
  for (const e of tl) {
    if (t < e.end || e.idx === tl.length - 1) {
      return { idx: e.idx, offsetSec: Math.max(0, t - e.start), entry: e };
    }
  }
  const last = tl[tl.length - 1];
  return { idx: last.idx, offsetSec: last.duration, entry: last };
}

function currentTimeSec() {
  // Where are we in the absolute lesson timeline?
  const tl = lessonTimeline();
  const entry = tl[state.currentSegmentIdx];
  if (!entry) return 0;
  let elapsedInSeg = state.segmentElapsedBeforePause / 1000;
  if (state.playing && state.segmentStartedAt) {
    elapsedInSeg += (performance.now() - state.segmentStartedAt) / 1000;
  }
  elapsedInSeg = Math.min(elapsedInSeg, entry.duration);
  return entry.start + elapsedInSeg;
}

function formatTime(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

/* =====================================================================
 *  DOM REFS (populated after DOMContentLoaded)
 * ===================================================================== */
let stage, stageVideo, stageVideoTint, videoCredit;
let slideArea, subtitles;
let playBtn, skipBackBtn, skipFwdBtn, restartBtn, muteBtn, speedBtn, fullscreenBtn;
let progressFillBar, progressBuffered, progressMarkers, progressHandle, progressHoverTime, progressTrack;
let timeDisplay;
let interactionOverlay, lessonList, completeOverlay;
let lessonTitleEl, lessonSubtitleEl, courseProgressEl;
let player;

function bindDom() {
  stage           = $('stage');
  stageVideo      = $('stageVideo');
  stageVideoTint  = $('stageVideoTint');
  videoCredit     = $('videoCredit');
  slideArea       = $('slideArea');
  subtitles       = $('subtitles');
  playBtn         = $('playBtn');
  skipBackBtn     = $('skipBackBtn');
  skipFwdBtn      = $('skipFwdBtn');
  restartBtn      = $('restartBtn');
  muteBtn         = $('muteBtn');
  speedBtn        = $('speedBtn');
  fullscreenBtn   = $('fullscreenBtn');
  progressFillBar = $('progressFillBar');
  progressBuffered = $('progressBuffered');
  progressMarkers = $('progressMarkers');
  progressHandle  = $('progressHandle');
  progressHoverTime = $('progressHoverTime');
  progressTrack   = $('progressTrack');
  timeDisplay     = $('timeDisplay');
  interactionOverlay = $('interactionOverlay');
  lessonList      = $('lessonList');
  completeOverlay = $('completeOverlay');
  lessonTitleEl   = $('lessonTitle');
  lessonSubtitleEl = $('lessonSubtitle');
  courseProgressEl = $('courseProgress');
  player          = $('player');
}

/* =====================================================================
 *  HELPERS
 * ===================================================================== */
function currentLesson() {
  return COURSE.lessons.find(l => l.id === state.currentLessonId);
}
function currentSegment() {
  return currentLesson().segments[state.currentSegmentIdx];
}

/* Cancel any in-flight narration WITHOUT triggering the segment auto-advance.
   Call this whenever the caller intends to navigate or restart manually. */
function cancelNarration() {
  if (!('speechSynthesis' in window)) return;
  if (state.currentUtterance) state.suppressEndAdvance = true;
  speechSynthesis.cancel();
}

/* =====================================================================
 *  VIDEO LOADER (with fallback chain)
 * ===================================================================== */
function clearStageVideo() {
  state.currentVideoId = null;
  stageVideo.classList.remove('active');
  stageVideoTint.classList.remove('active');
  videoCredit.classList.remove('active');
  stage.classList.remove('has-video');
  stageVideo.removeAttribute('src');
  stageVideo.load();
}

function loadStageVideo(media) {
  if (!media || !media.videoId) { clearStageVideo(); return; }
  if (state.currentVideoId === media.videoId && stageVideo.classList.contains('active')) return;

  state.currentVideoId = media.videoId;
  state.videoAttemptIdx = 0;

  videoCredit.innerHTML = `${media.label} · <a href="${media.url}" target="_blank" rel="noopener">Pexels / ${media.credit}</a>`;

  const variants = VIDEO_VARIANTS[media.videoId] || [];

  const tryNext = () => {
    if (state.videoAttemptIdx >= variants.length) { clearStageVideo(); return; }
    const url = variants[state.videoAttemptIdx++];
    stageVideo.src = url;
    stageVideo.load();
  };
  const onLoaded = () => {
    stageVideo.removeEventListener('loadeddata', onLoaded);
    stageVideo.removeEventListener('error', onError);
    stageVideo.classList.add('active');
    stageVideoTint.classList.add('active');
    videoCredit.classList.add('active');
    stage.classList.add('has-video');
    stageVideo.play().catch(() => {});
  };
  const onError = () => {
    stageVideo.removeEventListener('loadeddata', onLoaded);
    stageVideo.removeEventListener('error', onError);
    setTimeout(() => {
      stageVideo.addEventListener('loadeddata', onLoaded, { once: true });
      stageVideo.addEventListener('error', onError, { once: true });
      tryNext();
    }, 0);
  };
  stageVideo.addEventListener('loadeddata', onLoaded, { once: true });
  stageVideo.addEventListener('error', onError, { once: true });
  tryNext();
}

/* =====================================================================
 *  SLIDE RENDERING
 * ===================================================================== */
function renderSlide(seg) {
  let html = `<div class="slide active">`;
  if (seg.eyebrow) html += `<div class="slide-eyebrow">${seg.eyebrow}</div>`;
  if (seg.heading) html += `<h2 class="slide-heading">${seg.heading}</h2>`;

  if (seg.layout === 'definition' && seg.definition) {
    html += `<div class="slide-def">
      <div class="term">${seg.definition.term}</div>
      <div class="meaning">${seg.definition.meaning}</div>
    </div>`;
  }
  if (seg.bullets) {
    html += `<ul class="slide-bullets">`;
    seg.bullets.forEach((b, i) => {
      html += `<li><div class="bullet-marker">${i + 1}</div><div>${b}</div></li>`;
    });
    html += `</ul>`;
  }
  if (seg.stats) {
    html += `<div class="slide-stats">`;
    seg.stats.forEach(s => {
      html += `<div class="slide-stat"><div class="stat-num">${s.num}</div><div class="stat-lbl">${s.lbl}</div></div>`;
    });
    html += `</div>`;
  }
  if (seg.body) html += `<div class="slide-body">${seg.body}</div>`;
  html += `</div>`;
  slideArea.innerHTML = html;
}

function renderSubtitles(text) {
  const words = text.split(/\s+/);
  subtitles.innerHTML = words.map((w, i) => `<span class="word" data-word="${i}">${w}</span>`).join(' ');
}

/* =====================================================================
 *  TEXT-TO-SPEECH
 *  Accepts an optional startWordIdx so we can resume after a scrub.
 * ===================================================================== */
function speakNarration(text, onEnd) {
  const startIdx = state.startWordIdx || 0;
  state.startWordIdx = 0;  // consume

  // Slice the text to start at the requested word
  const allWords = text.split(/\s+/);
  const startCharIdx = startIdx > 0
    ? allWords.slice(0, startIdx).join(' ').length + 1
    : 0;
  const textToSpeak = startIdx > 0 ? text.slice(startCharIdx) : text;

  // Pre-mark all already-spoken words as revealed/spoken so the subtitle
  // shows "where we resumed from" rather than empty.
  const wordSpans = subtitles.querySelectorAll('.word');
  for (let i = 0; i < startIdx && i < wordSpans.length; i++) {
    wordSpans[i].classList.add('revealed', 'spoken');
  }

  if (!('speechSynthesis' in window)) {
    const estMs = Math.max(2500, textToSpeak.length * 55);
    state.currentUtterance = null;
    state.segmentStartedAt = performance.now();
    setTimeout(() => {
      state.segmentElapsedBeforePause = 0;
      state.segmentStartedAt = 0;
      onEnd();
    }, estMs);
    return;
  }
  speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(textToSpeak);
  utter.rate = state.rate;
  utter.pitch = 1.0;
  utter.volume = state.muted ? 0 : 1;

  const voices = speechSynthesis.getVoices();
  if (voices.length) {
    const preferred =
      voices.find(v => /en-IN/i.test(v.lang)) ||
      voices.find(v => /en-GB/i.test(v.lang)) ||
      voices.find(v => /en-US/i.test(v.lang) && /female|samantha|google/i.test(v.name)) ||
      voices.find(v => /^en/i.test(v.lang));
    if (preferred) utter.voice = preferred;
  }

  const wordCount = wordSpans.length;
  let lastIdx = startIdx - 1;
  let fallbackTimer = null;
  let boundaryFired = false;

  const revealWord = (idx) => {
    if (idx < 0 || idx >= wordCount || idx === lastIdx) return;
    if (lastIdx >= 0 && wordSpans[lastIdx]) {
      wordSpans[lastIdx].classList.remove('speaking');
      wordSpans[lastIdx].classList.add('spoken');
    }
    const w = wordSpans[idx];
    if (w) w.classList.add('revealed', 'speaking');
    lastIdx = idx;
  };

  utter.onboundary = (e) => {
    if (e.name && e.name !== 'word') return;
    boundaryFired = true;
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
    const upto = textToSpeak.slice(0, e.charIndex + 1);
    const wordsStartedInSlice = upto.trim().length ? upto.trim().split(/\s+/).length : 1;
    revealWord(startIdx + wordsStartedInSlice - 1);
  };
  utter.onstart = () => {
    subtitles.classList.remove('hidden');
    stage.classList.add('has-subtitles');
    state.segmentStartedAt = performance.now();
    startProgressTick();
    setTimeout(() => {
      if (boundaryFired) return;
      const msPerWord = 375 / state.rate;
      let idx = startIdx;
      revealWord(idx);
      fallbackTimer = setInterval(() => {
        idx++;
        if (idx >= wordCount) { clearInterval(fallbackTimer); fallbackTimer = null; return; }
        revealWord(idx);
      }, msPerWord);
    }, 600);
  };
  utter.onend = () => {
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
    wordSpans.forEach(w => { w.classList.add('revealed', 'spoken'); w.classList.remove('speaking'); });
    subtitles.classList.add('hidden');
    stage.classList.remove('has-subtitles');
    state.currentUtterance = null;
    if (state.suppressEndAdvance) {
      state.suppressEndAdvance = false;
      return;
    }
    state.segmentElapsedBeforePause = 0;
    state.segmentStartedAt = 0;
    if (state.playing) onEnd();
  };
  utter.onerror = () => {
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
    subtitles.classList.add('hidden');
    stage.classList.remove('has-subtitles');
    state.currentUtterance = null;
    if (state.suppressEndAdvance) {
      state.suppressEndAdvance = false;
      return;
    }
    if (state.playing) onEnd();
  };

  state.currentUtterance = utter;
  speechSynthesis.speak(utter);
}

/* =====================================================================
 *  PROGRESS TICK — drives the playhead at 60fps while playing
 * ===================================================================== */
function startProgressTick() {
  cancelAnimationFrame(state.rafId);
  const tick = () => {
    updateTimelineUI();
    if (state.playing && state.segmentStartedAt) {
      state.rafId = requestAnimationFrame(tick);
    }
  };
  state.rafId = requestAnimationFrame(tick);
}
function stopProgressTick() {
  cancelAnimationFrame(state.rafId);
  state.rafId = null;
}

/* =====================================================================
 *  SEGMENT PLAYBACK
 * ===================================================================== */
function playSegment() {
  const seg = currentSegment();
  if (!seg) { showCompleteOverlay(); return; }
  updateProgress();
  updateLessonList();

  if (seg.type === 'slide') {
    interactionOverlay.classList.remove('show');
    loadStageVideo(seg.media);
    renderSlide(seg);
    renderSubtitles(seg.narration);
    if (state.playing) {
      speakNarration(seg.narration, () => {
        // Segment naturally ended → advance to next, reset timing
        state.completedSegments.add(`${state.currentLessonId}:${state.currentSegmentIdx}`);
        state.currentSegmentIdx++;
        state.startWordIdx = 0;
        state.segmentElapsedBeforePause = 0;
        state.segmentStartedAt = 0;
        playSegment();
      });
    }
  } else if (seg.type === 'interaction') {
    clearStageVideo();
    showInteraction(seg);
  }
}

function renderStaticSegment() {
  const seg = currentSegment();
  if (!seg) { showCompleteOverlay(); return; }
  if (seg.type === 'slide') {
    interactionOverlay.classList.remove('show');
    loadStageVideo(seg.media);
    renderSlide(seg);
    renderSubtitles(seg.narration);
    subtitles.classList.add('hidden');
    stage.classList.remove('has-subtitles');
  } else {
    clearStageVideo();
    showInteraction(seg);
  }
  updateProgress();
  updateLessonList();
}

/* =====================================================================
 *  INTERACTIONS
 * ===================================================================== */
function showInteraction(seg) {
  cancelNarration();
  state.playing = false;
  setPlayButtonIcon();

  $('iLabel').textContent = seg.kind === 'truefalse' ? '◆ True or False' : '◆ Quick Check';
  $('iQuestion').textContent = seg.question;

  const opts = $('iOptions');
  opts.innerHTML = '';
  seg.options.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.className = 'iopt';
    btn.innerHTML = `<span class="ltr">${String.fromCharCode(65 + i)}</span>${text}`;
    btn.onclick = () => handleAnswer(seg, i, btn);
    opts.appendChild(btn);
  });
  $('iFeedback').className = 'ifb';
  $('iFeedback').textContent = '';
  $('iContinue').classList.remove('show');
  interactionOverlay.classList.add('show');
  subtitles.innerHTML = '';
  subtitles.classList.add('hidden');
  stage.classList.remove('has-subtitles');
}

function handleAnswer(seg, chosenIdx, btn) {
  const correct = chosenIdx === seg.correctIndex;
  document.querySelectorAll('.iopt').forEach((b, i) => {
    b.classList.add('locked');
    b.onclick = null;
    if (i === seg.correctIndex) b.classList.add('correct');
    else if (i === chosenIdx) b.classList.add('wrong');
  });
  const fb = $('iFeedback');
  fb.textContent = (correct ? '✓ ' : '✗ ') + seg.feedback;
  fb.classList.add('show', correct ? 'correct' : 'wrong');
  $('iContinue').classList.add('show');
}

/* =====================================================================
 *  CONTROLS — all four broken buttons fixed
 * ===================================================================== */
function setPlayButtonIcon() {
  playBtn.textContent = state.playing ? '⏸' : '▶';
  playBtn.setAttribute('data-tooltip', state.playing ? 'Pause' : 'Play');
}

function attachControls() {
  /* ----------------------------------------------------------------
   * Floating tooltip — single element, repositioned on hover so it
   * sits above any button regardless of overflow clipping.
   * ---------------------------------------------------------------- */
  const tooltip = document.createElement('div');
  tooltip.className = 'ctrl-tooltip';
  document.body.appendChild(tooltip);
  document.querySelectorAll('.ctrl-btn[data-tooltip]').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const label = btn.getAttribute('data-tooltip');
      if (!label) return;
      tooltip.textContent = label;
      const r = btn.getBoundingClientRect();
      tooltip.style.left = (r.left + r.width / 2) + 'px';
      tooltip.style.top  = r.top + 'px';
      tooltip.classList.add('show');
    });
    btn.addEventListener('mouseleave', () => tooltip.classList.remove('show'));
    btn.addEventListener('click', () => tooltip.classList.remove('show'));
  });

  /* PLAY / PAUSE */
  playBtn.onclick = () => {
    if (state.playing) {
      // Pausing — save accumulated elapsed so we can resume
      if (state.segmentStartedAt) {
        state.segmentElapsedBeforePause += performance.now() - state.segmentStartedAt;
        state.segmentStartedAt = 0;
      }
      state.playing = false;
      setPlayButtonIcon();
      stopProgressTick();
      subtitles.classList.add('hidden');
      stage.classList.remove('has-subtitles');
      if ('speechSynthesis' in window) speechSynthesis.pause();
    } else {
      state.playing = true;
      setPlayButtonIcon();
      $('ttsWarn').classList.remove('show');
      if ('speechSynthesis' in window && speechSynthesis.paused && state.currentUtterance) {
        subtitles.classList.remove('hidden');
        stage.classList.add('has-subtitles');
        state.segmentStartedAt = performance.now();
        startProgressTick();
        speechSynthesis.resume();
      } else {
        playSegment();
      }
    }
  };

  /* SKIP -10s */
  skipBackBtn.onclick = () => skipBy(-10);
  /* SKIP +10s */
  skipFwdBtn.onclick = () => skipBy(10);

  /* RESTART LESSON */
  restartBtn.onclick = () => {
    cancelNarration();
    state.currentSegmentIdx = 0;
    state.startWordIdx = 0;
    state.segmentElapsedBeforePause = 0;
    state.segmentStartedAt = 0;
    state.playing = false;
    setPlayButtonIcon();
    completeOverlay.classList.remove('show');
    renderStaticSegment();
    restartBtn.classList.add('active-state');
    setTimeout(() => restartBtn.classList.remove('active-state'), 250);
  };

  /* MUTE */
  muteBtn.onclick = () => {
    state.muted = !state.muted;
    muteBtn.textContent = state.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('data-tooltip', state.muted ? 'Unmute' : 'Mute');
    muteBtn.classList.toggle('active-state', state.muted);
    const speaking = state.playing && state.currentUtterance && 'speechSynthesis' in window;
    if (state.currentUtterance) state.currentUtterance.volume = state.muted ? 0 : 1;
    if (speaking) {
      // Preserve position when restarting under new volume
      const tNow = currentTimeSec();
      cancelNarration();
      seekTo(tNow);
      if (!state.playing) {
        state.playing = true;
        setPlayButtonIcon();
        playSegment();
      }
    }
  };

  /* SPEED */
  speedBtn.onclick = () => {
    rateIdx = (rateIdx + 1) % RATES.length;
    state.rate = RATES[rateIdx];
    speedBtn.textContent = state.rate + '×';
    speedBtn.setAttribute('data-tooltip', `Speed: ${state.rate}×`);
    speedBtn.classList.toggle('active-state', state.rate !== 1.0);
    const speaking = state.playing && state.currentUtterance && 'speechSynthesis' in window;
    if (speaking) {
      // Preserve position when restarting under new rate
      const tNow = currentTimeSec();
      cancelNarration();
      seekTo(tNow);
      if (!state.playing) {
        state.playing = true;
        setPlayButtonIcon();
        playSegment();
      }
    }
  };

  /* FULLSCREEN */
  fullscreenBtn.onclick = () => {
    const target = player;
    const isFull = document.fullscreenElement || document.webkitFullscreenElement;
    if (!isFull) {
      (target.requestFullscreen || target.webkitRequestFullscreen)?.call(target);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
  };
  document.addEventListener('fullscreenchange', () => {
    const isFull = !!document.fullscreenElement;
    fullscreenBtn.textContent = isFull ? '⤡' : '⛶';
    fullscreenBtn.setAttribute('data-tooltip', isFull ? 'Exit fullscreen' : 'Fullscreen');
    fullscreenBtn.classList.toggle('active-state', isFull);
  });

  /* CONTINUE after interaction */
  $('iContinue').onclick = () => {
    state.completedSegments.add(`${state.currentLessonId}:${state.currentSegmentIdx}`);
    state.currentSegmentIdx++;
    state.startWordIdx = 0;
    state.segmentElapsedBeforePause = 0;
    state.segmentStartedAt = 0;
    interactionOverlay.classList.remove('show');
    state.playing = true;
    setPlayButtonIcon();
    playSegment();
  };

  /* PROGRESS BAR — hover preview, click, drag */
  let isDragging = false;
  let wasPlayingBeforeDrag = false;

  const pctFromEvent = (e) => {
    const rect = progressTrack.getBoundingClientRect();
    const x = (e.clientX !== undefined ? e.clientX : e.touches?.[0]?.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  };

  progressTrack.addEventListener('mousemove', (e) => {
    const total = totalLessonDuration();
    const pct = pctFromEvent(e);
    progressHoverTime.style.left = (pct * 100) + '%';
    progressHoverTime.textContent = formatTime(pct * total);
    progressHoverTime.classList.add('show');
  });
  progressTrack.addEventListener('mouseleave', () => {
    if (!isDragging) progressHoverTime.classList.remove('show');
  });

  progressTrack.addEventListener('mousedown', (e) => {
    isDragging = true;
    wasPlayingBeforeDrag = state.playing;
    progressTrack.classList.add('dragging');
    if (state.playing) {
      // Pause during drag
      state.playing = false;
      setPlayButtonIcon();
      if ('speechSynthesis' in window) {
        state.suppressEndAdvance = true;
        speechSynthesis.cancel();
      }
      stopProgressTick();
    }
    const pct = pctFromEvent(e);
    seekTo(pct * totalLessonDuration());
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const pct = pctFromEvent(e);
    const total = totalLessonDuration();
    progressHoverTime.style.left = (pct * 100) + '%';
    progressHoverTime.textContent = formatTime(pct * total);
    // Live update fill while dragging for instant feedback
    progressFillBar.style.width = (pct * 100) + '%';
    progressHandle.style.left = (pct * 100) + '%';
    timeDisplay.textContent = `${formatTime(pct * total)} / ${formatTime(total)}`;
  });
  document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    progressTrack.classList.remove('dragging');
    progressHoverTime.classList.remove('show');
    const pct = pctFromEvent(e);
    seekTo(pct * totalLessonDuration());
    if (wasPlayingBeforeDrag) {
      state.playing = true;
      setPlayButtonIcon();
      playSegment();
    }
  });
}

/* =====================================================================
 *  TIMELINE UI
 * ===================================================================== */
function updateTimelineUI() {
  const total = totalLessonDuration();
  const cur = currentTimeSec();
  const pct = total > 0 ? (cur / total) * 100 : 0;

  progressFillBar.style.width = pct + '%';
  progressHandle.style.left = pct + '%';
  timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(total)}`;

  // Buffered = furthest segment we've played to (visual hint of progress)
  const buffered = Math.max(cur, (lessonTimeline()[state.currentSegmentIdx] || {}).end || 0);
  const bufPct = total > 0 ? Math.min(100, (buffered / total) * 100) : 0;
  progressBuffered.style.width = bufPct + '%';

  // Markers — one per interaction stop
  if (progressMarkers.childElementCount === 0 || progressMarkers.dataset.lessonId !== String(state.currentLessonId)) {
    progressMarkers.innerHTML = '';
    progressMarkers.dataset.lessonId = String(state.currentLessonId);
    const tl = lessonTimeline();
    tl.forEach(entry => {
      if (entry.type !== 'interaction') return;
      const m = document.createElement('div');
      m.className = 'progress-marker interaction';
      m.style.left = (entry.start / total) * 100 + '%';
      m.title = 'Interaction checkpoint';
      progressMarkers.appendChild(m);
    });
  }

  // Lesson completion (used by sidebar)
  const lesson = currentLesson();
  lesson.complete = total > 0 ? Math.min(1, cur / total) : 0;
  const courseAvg = COURSE.lessons.reduce((s, l) => s + (l.complete || 0), 0) / COURSE.lessons.length;
  courseProgressEl.textContent = Math.round(courseAvg * 100) + '%';
}

// Backwards-compat alias used elsewhere
function updateProgress() { updateTimelineUI(); }

/* =====================================================================
 *  SEEK — the heart of the "real video" feel
 *  Given an absolute lesson-time in seconds, jump to the right segment and
 *  resume narration at the right word offset.
 * ===================================================================== */
function seekTo(targetSec) {
  const total = totalLessonDuration();
  targetSec = Math.max(0, Math.min(total, targetSec));
  const { idx, offsetSec, entry } = timeToSegment(targetSec);
  const segs = currentLesson().segments;
  const seg = segs[idx];

  // If we're seeking into an interaction segment, jump TO it but don't auto-advance
  if (seg.type === 'interaction') {
    cancelNarration();
    state.currentSegmentIdx = idx;
    state.segmentElapsedBeforePause = 0;
    state.segmentStartedAt = 0;
    state.startWordIdx = 0;
    renderStaticSegment(); // shows the interaction
    return;
  }

  // For slide segments: figure out which word the offsetSec lands on
  const words = (seg.narration || '').split(/\s+/).filter(Boolean);
  const wordIdx = entry.duration > 0
    ? Math.min(words.length - 1, Math.floor((offsetSec / entry.duration) * words.length))
    : 0;

  cancelNarration();
  state.currentSegmentIdx = idx;
  state.startWordIdx = wordIdx;
  state.segmentElapsedBeforePause = offsetSec * 1000;
  state.segmentStartedAt = 0;

  if (state.playing) playSegment();
  else renderStaticSegment();
  updateTimelineUI();
}

function skipBy(deltaSec) {
  seekTo(currentTimeSec() + deltaSec);
}

function updateLessonList() {
  lessonList.innerHTML = '';
  COURSE.lessons.forEach(lesson => {
    const li = document.createElement('li');
    li.className = 'lesson-item' + (lesson.id === state.currentLessonId ? ' current' : '');
    const pct = Math.round((lesson.complete || 0) * 100);
    let statusClass = 'locked';
    let progressText = `Not started`;
    if (pct === 100) { statusClass = 'done'; progressText = 'Completed | 100%'; }
    else if (pct > 0) { statusClass = 'in-progress'; progressText = `In progress | ${pct}%`; }

    li.innerHTML = `
      <div class="lesson-item-head">
        <div class="lesson-status ${statusClass}"></div>
        <div class="lesson-name">${lesson.id}. ${lesson.title}</div>
      </div>
      <div class="lesson-progress ${pct === 100 ? 'complete' : ''}">${progressText}</div>
    `;
    li.onclick = () => switchLesson(lesson.id);
    lessonList.appendChild(li);
  });
}

function switchLesson(id) {
  cancelNarration();
  clearStageVideo();
  state.currentLessonId = id;
  state.currentSegmentIdx = 0;
  state.startWordIdx = 0;
  state.segmentElapsedBeforePause = 0;
  state.segmentStartedAt = 0;
  state.playing = false;
  setPlayButtonIcon();
  completeOverlay.classList.remove('show');
  const lesson = currentLesson();
  lessonTitleEl.textContent = `${lesson.id}. ${lesson.title}`;
  lessonSubtitleEl.textContent = `Module ${lesson.id}: ${lesson.title}`;
  // Force re-render of timeline markers for the new lesson
  progressMarkers.innerHTML = '';
  progressMarkers.dataset.lessonId = '';
  if (lesson.segments.length === 0) {
    slideArea.innerHTML = `<div class="slide active">
      <div class="slide-eyebrow">Coming soon</div>
      <h2 class="slide-heading">This lesson is being prepared</h2>
      <div class="slide-body">Content for this module has not been authored yet.</div>
    </div>`;
    subtitles.innerHTML = '';
    subtitles.classList.add('hidden');
  } else {
    renderStaticSegment();
  }
  updateProgress();
  updateLessonList();
}

function goToLesson(delta) {
  const idx = COURSE.lessons.findIndex(l => l.id === state.currentLessonId);
  const next = COURSE.lessons[idx + delta];
  if (next) switchLesson(next.id);
}
window.goToLesson = goToLesson;

function restartLesson() {
  cancelNarration();
  state.currentSegmentIdx = 0;
  state.startWordIdx = 0;
  state.segmentElapsedBeforePause = 0;
  state.segmentStartedAt = 0;
  state.playing = false;
  setPlayButtonIcon();
  completeOverlay.classList.remove('show');
  renderStaticSegment();
}
window.restartLesson = restartLesson;

function showCompleteOverlay() {
  state.playing = false;
  setPlayButtonIcon();
  completeOverlay.classList.add('show');
  currentLesson().complete = 1.0;
  updateProgress();
  updateLessonList();
}

/* =====================================================================
 *  INIT
 * ===================================================================== */
async function init() {
  bindDom();

  try {
    const res = await fetch('./course.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    COURSE = await res.json();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:3rem;text-align:center;font-family:system-ui">
      <h2>Could not load course.json</h2>
      <p style="color:#666">${e.message}</p>
      <p style="color:#666;font-size:0.9rem">If you opened this file directly, browsers block fetch() from <code>file://</code> URLs. Serve the folder with a local web server:</p>
      <pre style="background:#f4f4f4;padding:1rem;display:inline-block;text-align:left;border-radius:8px">python3 -m http.server 8000</pre>
      <p style="color:#666;font-size:0.9rem">Then open <a href="http://localhost:8000/lesson.html">http://localhost:8000/lesson.html</a></p>
    </div>`;
    return;
  }

  attachControls();

  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = () => {};
  } else {
    $('ttsWarn').textContent = '⚠ Your browser does not support speech synthesis — subtitles will still appear.';
    $('ttsWarn').classList.add('show');
  }

  // Start on lesson 2 to show the most-developed module first
  state.currentLessonId = 2;
  switchLesson(2);

  $('ttsWarn').classList.add('show');
  setTimeout(() => $('ttsWarn').classList.remove('show'), 6000);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.matches('textarea, input, select')) return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); skipFwdBtn.click(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); skipBackBtn.click(); }
    if (e.key === 'j' || e.key === 'J') skipBackBtn.click();
    if (e.key === 'l' || e.key === 'L') skipFwdBtn.click();
    if (e.key === 'm' || e.key === 'M') muteBtn.click();
    if (e.key === 'f' || e.key === 'F') fullscreenBtn.click();
  });
}

document.addEventListener('DOMContentLoaded', init);