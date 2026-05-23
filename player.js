/* =====================================================================
 *  STOCK MARKET ESSENTIALS — Narrated Lesson Player
 *  Loads course content from course.json
 * ===================================================================== */

const $ = (id) => document.getElementById(id);

/* =====================================================================
 *  PEXELS VIDEO FALLBACK CHAIN
 *  Tries local ./videos/{id}.mp4 first, then several Pexels CDN
 *  variants. Pexels often blocks hotlinking, so the local copy is the
 *  reliable path — use download_pexels_videos.py to populate it.
 * ===================================================================== */
const VIDEO_VARIANTS = {
  "7579577": [
    "./videos/7579577.mp4",
    "https://videos.pexels.com/video-files/7579577/7579577-uhd_2732_1440_25fps.mp4",
    "https://videos.pexels.com/video-files/7579577/7579577-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/7579577/7579577-hd_1920_1080_25fps.mp4",
    "https://videos.pexels.com/video-files/7579577/7579577-sd_960_506_30fps.mp4"
  ],
  "7578613": [
    "./videos/7578613.mp4",
    "https://videos.pexels.com/video-files/7578613/7578613-uhd_2732_1440_30fps.mp4",
    "https://videos.pexels.com/video-files/7578613/7578613-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/7578613/7578613-sd_960_506_30fps.mp4"
  ],
  "7579561": [
    "./videos/7579561.mp4",
    "https://videos.pexels.com/video-files/7579561/7579561-hd_1080_1920_30fps.mp4",
    "https://videos.pexels.com/video-files/7579561/7579561-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/7579561/7579561-sd_540_960_30fps.mp4"
  ],
  "14003933": [
    "./videos/14003933.mp4",
    "https://videos.pexels.com/video-files/14003933/14003933-uhd_2732_1440_25fps.mp4",
    "https://videos.pexels.com/video-files/14003933/14003933-hd_1920_1080_25fps.mp4",
    "https://videos.pexels.com/video-files/14003933/14003933-sd_960_540_25fps.mp4"
  ],
  "30289541": [
    "./videos/30289541.mp4",
    "https://videos.pexels.com/video-files/30289541/30289541-uhd_2732_1440_30fps.mp4",
    "https://videos.pexels.com/video-files/30289541/30289541-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/30289541/30289541-sd_960_540_30fps.mp4"
  ],
  "34433115": [
    "./videos/34433115.mp4",
    "https://videos.pexels.com/video-files/34433115/34433115-uhd_2732_1440_30fps.mp4",
    "https://videos.pexels.com/video-files/34433115/34433115-hd_1920_1080_30fps.mp4",
    "https://videos.pexels.com/video-files/34433115/34433115-sd_960_540_30fps.mp4"
  ]
};

/* =====================================================================
 *  STATE
 * ===================================================================== */
let COURSE = null;
const state = {
  currentLessonId: 1,
  currentSegmentIdx: 0,
  playing: false,
  muted: false,
  rate: 1.0,
  completedSegments: new Set(),
  currentUtterance: null,
  currentVideoId: null,
  videoAttemptIdx: 0,
  // When true, the next speechSynthesis.cancel() should NOT cause the
  // current segment to advance via onend. Used by mute/speed/etc. that
  // re-start the same segment with new settings.
  suppressEndAdvance: false
};
const RATES = [1.0, 1.25, 1.5, 0.75];
let rateIdx = 0;

/* =====================================================================
 *  DOM REFS (populated after DOMContentLoaded)
 * ===================================================================== */
let stage, stageVideo, stageVideoTint, videoCredit;
let slideArea, subtitles;
let playBtn, prevBtn, nextBtn, restartBtn, muteBtn, speedBtn, fullscreenBtn;
let progressFillBar, progressMarkers, progressTrack;
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
  prevBtn         = $('prevSlideBtn');
  nextBtn         = $('nextSlideBtn');
  restartBtn      = $('restartBtn');
  muteBtn         = $('muteBtn');
  speedBtn        = $('speedBtn');
  fullscreenBtn   = $('fullscreenBtn');
  progressFillBar = $('progressFillBar');
  progressMarkers = $('progressMarkers');
  progressTrack   = $('progressTrack');
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
 * ===================================================================== */
function speakNarration(text, onEnd) {
  if (!('speechSynthesis' in window)) {
    const estMs = Math.max(2500, text.length * 55);
    state.currentUtterance = null;
    setTimeout(onEnd, estMs);
    return;
  }
  speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
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

  const wordSpans = subtitles.querySelectorAll('.word');
  const wordCount = wordSpans.length;
  let lastIdx = -1;
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
    const upto = text.slice(0, e.charIndex + 1);
    const wordsStarted = upto.trim().length ? upto.trim().split(/\s+/).length : 1;
    revealWord(wordsStarted - 1);
  };
  utter.onstart = () => {
    subtitles.classList.remove('hidden');
    stage.classList.add('has-subtitles');
    setTimeout(() => {
      if (boundaryFired) return;
      const msPerWord = 375 / state.rate;
      let idx = 0;
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
    // If we were intentionally cancelled (e.g. mute toggled), the caller
    // will handle what comes next — don't auto-advance the segment.
    if (state.suppressEndAdvance) {
      state.suppressEndAdvance = false;
      return;
    }
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
        state.completedSegments.add(`${state.currentLessonId}:${state.currentSegmentIdx}`);
        state.currentSegmentIdx++;
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
      state.playing = false;
      setPlayButtonIcon();
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
        speechSynthesis.resume();
      } else {
        playSegment();
      }
    }
  };

  /* PREV SEGMENT */
  prevBtn.onclick = () => {
    cancelNarration();
    state.currentSegmentIdx = Math.max(0, state.currentSegmentIdx - 1);
    if (state.playing) playSegment();
    else renderStaticSegment();
  };

  /* NEXT SEGMENT */
  nextBtn.onclick = () => {
    cancelNarration();
    const seg = currentSegment();
    if (seg && seg.type === 'interaction') return; // must answer
    state.completedSegments.add(`${state.currentLessonId}:${state.currentSegmentIdx}`);
    state.currentSegmentIdx++;
    if (state.playing) playSegment();
    else renderStaticSegment();
  };

  /* RESTART LESSON — fully reset */
  restartBtn.onclick = () => {
    cancelNarration();
    state.currentSegmentIdx = 0;
    state.playing = false;
    setPlayButtonIcon();
    completeOverlay.classList.remove('show');
    renderStaticSegment();
    // Visual ping so user knows it worked
    restartBtn.classList.add('active-state');
    setTimeout(() => restartBtn.classList.remove('active-state'), 250);
  };

  /* MUTE — instant, no segment skipping */
  muteBtn.onclick = () => {
    state.muted = !state.muted;
    muteBtn.textContent = state.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('data-tooltip', state.muted ? 'Unmute' : 'Mute');
    muteBtn.classList.toggle('active-state', state.muted);
    // Update live where supported. If we're currently speaking, restart
    // the SAME segment with the new volume — but suppress the auto-advance
    // that would otherwise happen when cancel() fires onend.
    const speaking = state.playing && state.currentUtterance && 'speechSynthesis' in window;
    if (state.currentUtterance) state.currentUtterance.volume = state.muted ? 0 : 1;
    if (speaking) {
      cancelNarration();
      // Re-play the SAME segment, not the next one.
      playSegment();
    }
  };

  /* SPEED — cycles 1× → 1.25× → 1.5× → 0.75× → 1×, no segment skipping */
  speedBtn.onclick = () => {
    rateIdx = (rateIdx + 1) % RATES.length;
    state.rate = RATES[rateIdx];
    speedBtn.textContent = state.rate + '×';
    speedBtn.setAttribute('data-tooltip', `Speed: ${state.rate}×`);
    speedBtn.classList.toggle('active-state', state.rate !== 1.0);
    const speaking = state.playing && state.currentUtterance && 'speechSynthesis' in window;
    if (speaking) {
      cancelNarration();
      playSegment();
    }
  };

  /* FULLSCREEN — toggles on the whole player (not just stage) */
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
    interactionOverlay.classList.remove('show');
    state.playing = true;
    setPlayButtonIcon();
    playSegment();
  };

  /* PROGRESS BAR — click to jump */
  progressTrack.onclick = (e) => {
    const segs = currentLesson().segments;
    if (!segs.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const idx = Math.min(segs.length - 1, Math.max(0, Math.floor(pct * segs.length)));
    cancelNarration();
    state.currentSegmentIdx = idx;
    if (state.playing) playSegment();
    else renderStaticSegment();
  };
}

/* =====================================================================
 *  PROGRESS / SIDEBAR
 * ===================================================================== */
function updateProgress() {
  const segs = currentLesson().segments;
  const total = segs.length;
  const done = state.currentSegmentIdx;
  const pct = total ? (done / total) * 100 : 0;
  progressFillBar.style.width = pct + '%';

  progressMarkers.innerHTML = '';
  segs.forEach((s, i) => {
    const m = document.createElement('div');
    m.className = 'progress-marker' + (s.type === 'interaction' ? ' interaction' : '');
    if (i < state.currentSegmentIdx) m.classList.add('passed');
    m.style.left = ((i + 0.5) / total) * 100 + '%';
    progressMarkers.appendChild(m);
  });

  const lesson = currentLesson();
  lesson.complete = total ? done / total : 0;

  const courseAvg = COURSE.lessons.reduce((sum, l) => sum + (l.complete || 0), 0) / COURSE.lessons.length;
  courseProgressEl.textContent = Math.round(courseAvg * 100) + '%';
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
  state.playing = false;
  setPlayButtonIcon();
  completeOverlay.classList.remove('show');
  const lesson = currentLesson();
  lessonTitleEl.textContent = `${lesson.id}. ${lesson.title}`;
  lessonSubtitleEl.textContent = `Module ${lesson.id}: ${lesson.title}`;
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
window.goToLesson = goToLesson; // exposed for onclick attribute

function restartLesson() {
  cancelNarration();
  state.currentSegmentIdx = 0;
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

  // Start on lesson 1 to show the most-developed module first
  state.currentLessonId = 1;
  switchLesson(1);

  $('ttsWarn').classList.add('show');
  setTimeout(() => $('ttsWarn').classList.remove('show'), 6000);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.matches('textarea, input, select')) return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
    if (e.key === 'ArrowRight') nextBtn.click();
    if (e.key === 'ArrowLeft') prevBtn.click();
    if (e.key === 'm' || e.key === 'M') muteBtn.click();
    if (e.key === 'f' || e.key === 'F') fullscreenBtn.click();
  });
}

document.addEventListener('DOMContentLoaded', init);