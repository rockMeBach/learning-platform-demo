/* =====================================================================
 *  OPTIONS UNLOCKED — Skilling Academy lesson player
 *
 *  Plays a single local MP4 in L1/L2/L3 segments with quiz checkpoints
 *  between them. Captions rendered from a WebVTT file with full custom
 *  styling.
 * ===================================================================== */

const $ = (id) => document.getElementById(id);

/* =====================================================================
 *  STATE
 * ===================================================================== */
let COURSE = null;
let video = null;          // The <video> element
let currentVideoEnd = null;
let ccOn = true;
const state = {
  currentLessonId: 1,
  currentSegmentIdx: 0,
  playing: false
};
const RATES = [1, 1.25, 1.5, 2, 0.5, 0.75];
let rateIdx = 0;

/* =====================================================================
 *  DOM REFS
 * ===================================================================== */
let stage;
let playBtn, skipBackBtn, skipFwdBtn, restartBtn, ccBtn, speedBtn, muteBtn, fullscreenBtn;
let progressFillBar, progressBuffered, progressHandle, progressHoverTime, progressTrack;
let timeDisplay, captionBar;
let interactionOverlay, lessonList, completeOverlay;
let lessonTitleEl, lessonSubtitleEl, courseProgressEl;
let player, segmentBanner;

function bindDom() {
  stage              = $('stage');
  video              = $('video');
  playBtn            = $('playBtn');
  skipBackBtn        = $('skipBackBtn');
  skipFwdBtn         = $('skipFwdBtn');
  restartBtn         = $('restartBtn');
  ccBtn              = $('ccBtn');
  muteBtn            = $('muteBtn');
  speedBtn           = $('speedBtn');
  fullscreenBtn      = $('fullscreenBtn');
  progressFillBar    = $('progressFillBar');
  progressBuffered   = $('progressBuffered');
  progressHandle     = $('progressHandle');
  progressHoverTime  = $('progressHoverTime');
  progressTrack      = $('progressTrack');
  timeDisplay        = $('timeDisplay');
  captionBar         = $('captionBar');
  interactionOverlay = $('interactionOverlay');
  lessonList         = $('lessonList');
  completeOverlay    = $('completeOverlay');
  lessonTitleEl      = $('lessonTitle');
  lessonSubtitleEl   = $('lessonSubtitle');
  courseProgressEl   = $('courseProgress');
  player             = $('player');
  segmentBanner      = $('segmentBanner');
}

/* =====================================================================
 *  HELPERS
 * ===================================================================== */
function currentLesson()  { return COURSE.lessons.find(l => l.id === state.currentLessonId); }
function currentSegment() { return currentLesson().segments[state.currentSegmentIdx]; }

function formatTime(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function segDuration(seg) {
  return seg.type === 'video' ? Math.max(0, seg.videoEnd - seg.videoStart) : 0;
}

function totalLessonDuration() {
  return currentLesson().segments.reduce((s, seg) => s + segDuration(seg), 0);
}

/* Where are we in the lesson's combined timeline? */
function currentTimeSec() {
  let cur = 0;
  const segs = currentLesson().segments;
  for (let i = 0; i < state.currentSegmentIdx && i < segs.length; i++) {
    cur += segDuration(segs[i]);
  }
  const seg = segs[state.currentSegmentIdx];
  if (seg && seg.type === 'video' && video && !isNaN(video.currentTime)) {
    if (video.currentTime >= seg.videoStart) {
      cur += Math.min(segDuration(seg), video.currentTime - seg.videoStart);
    }
  }
  return cur;
}

/* Absolute lesson time → {segmentIdx, offsetSec into that segment} */
function timeToSegment(t) {
  const segs = currentLesson().segments;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const d = segDuration(segs[i]);
    if (t < acc + d || i === segs.length - 1) {
      return { idx: i, offsetSec: Math.max(0, Math.min(d, t - acc)) };
    }
    acc += d;
  }
  return { idx: 0, offsetSec: 0 };
}

/* =====================================================================
 *  VIDEO LIFECYCLE
 * ===================================================================== */
function bindVideoEvents() {
  video.addEventListener('play',  () => { state.playing = true;  setPlayButtonIcon(); });
  video.addEventListener('pause', () => { state.playing = false; setPlayButtonIcon(); });

  // The playhead progress tick + auto-stop at segment end
  video.addEventListener('timeupdate', () => {
    updateTimelineUI();
    // Only auto-advance to the next segment when the video is actually
    // playing past the segment's end — not when the user scrubbed there.
    if (
      currentVideoEnd !== null &&
      !video.paused &&
      !video.seeking &&
      video.currentTime >= currentVideoEnd - 0.05
    ) {
      handleSegmentEnd();
    }
  });

  video.addEventListener('ended', () => {
    handleSegmentEnd();
  });

  video.addEventListener('error', (e) => {
    console.warn('[video] error', video.error);
    showVideoError();
  });

  // Reset rate to current setting (browsers sometimes drop it on source change)
  video.addEventListener('loadedmetadata', () => {
    video.playbackRate = RATES[rateIdx];
  });
}

function showVideoError() {
  if (document.getElementById('videoErr')) return;
  const banner = document.createElement('div');
  banner.id = 'videoErr';
  banner.style.cssText = `
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: rgba(26,63,146,0.95); color: white;
    font-family: var(--display); text-align: center;
    padding: 2rem; z-index: 40;
  `;
  banner.innerHTML = `
    <div style="font-size: 2rem; margin-bottom: 0.5rem;">🎞️</div>
    <h3 style="margin-bottom: 0.4rem;">Couldn't load video.mp4</h3>
    <p style="opacity: 0.85; font-size: 0.9rem; max-width: 420px;">
      Make sure <code style="background:rgba(0,0,0,0.25);padding:1px 6px;border-radius:4px">video.mp4</code>
      sits next to <code style="background:rgba(0,0,0,0.25);padding:1px 6px;border-radius:4px">lesson.html</code>.
    </p>
  `;
  stage.appendChild(banner);
}

function handleSegmentEnd() {
  if (!video.paused) video.pause();
  state.currentSegmentIdx++;
  const next = currentSegment();
  if (!next) { showCompleteOverlay(); return; }
  if (next.type === 'interaction') {
    showInteraction(next);
  } else if (next.type === 'video') {
    presentVideoSegment(next);
  }
  updateLessonList();
}

function presentVideoSegment(seg) {
  interactionOverlay.classList.remove('show');
  showSegmentBanner(seg);
  currentVideoEnd = seg.videoEnd;
  seekVideoTo(seg.videoStart);
  updateTimelineUI();
}

/* Safely seek the underlying <video>. Common failure modes handled:
 *   - metadata not yet loaded (readyState < 1)  → wait for loadedmetadata
 *   - target outside the video duration         → clamp
 *   - target equal to current time              → no-op (would not trigger seeked)
 *   - server doesn't support Range requests     → warn after a short timeout
 */
function seekVideoTo(targetSec) {
  if (!video) return;
  const doSeek = () => {
    if (isNaN(video.duration)) return;
    const clamped = Math.max(0, Math.min(video.duration, targetSec));
    if (Math.abs(video.currentTime - clamped) < 0.05) return;

    // Set up a watchdog: if no 'seeked' event arrives within 3 s, the server
    // most likely doesn't support Range requests and the browser is stuck.
    let warned = false;
    const onSeeked = () => {
      clearTimeout(watchdog);
      video.removeEventListener('seeked', onSeeked);
    };
    const watchdog = setTimeout(() => {
      if (warned) return;
      warned = true;
      video.removeEventListener('seeked', onSeeked);
      console.warn(`[video] seek to ${clamped.toFixed(1)}s did not complete in 3s. ` +
                   `The server may not support HTTP Range requests, which video seeking needs. ` +
                   `Try serving with "npx serve ." instead.`);
      showSeekError();
    }, 3000);
    video.addEventListener('seeked', onSeeked, { once: true });

    video.currentTime = clamped;
  };

  if (video.readyState >= 1) {
    doSeek();
  } else {
    video.addEventListener('loadedmetadata', doSeek, { once: true });
  }
}

function showSeekError() {
  if (document.getElementById('seekErr')) return;
  const banner = document.createElement('div');
  banner.id = 'seekErr';
  banner.style.cssText = `
    position: absolute; top: 1rem; left: 50%; transform: translateX(-50%);
    background: rgba(230, 35, 129, 0.95); color: white;
    padding: 0.6rem 1rem; border-radius: 10px;
    font-family: var(--body); font-size: 0.82rem; font-weight: 600;
    max-width: 90%; z-index: 35; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  `;
  banner.innerHTML = `
    ⚠ Seeking isn't working — your local server doesn't support HTTP Range requests.<br>
    <span style="opacity:.85;font-weight:500;font-size:.78rem">
      Try: <code style="background:rgba(0,0,0,.25);padding:1px 5px;border-radius:3px">npx serve .</code>
      &nbsp;or&nbsp;
      <code style="background:rgba(0,0,0,.25);padding:1px 5px;border-radius:3px">python -m http.server</code>
      (Python 3.7+).
    </span>
  `;
  stage.appendChild(banner);
  setTimeout(() => banner.remove(), 8000);
}

function showSegmentBanner(seg) {
  segmentBanner.innerHTML = `
    <span class="banner-tag">${seg.label || ''}</span>
    <span class="banner-heading">${seg.heading || ''}</span>
  `;
  segmentBanner.classList.add('show');
  clearTimeout(showSegmentBanner._timer);
  showSegmentBanner._timer = setTimeout(() => segmentBanner.classList.remove('show'), 4000);
}

/* =====================================================================
 *  CUSTOM SUBTITLE RENDERING
 *
 *  We hide the native <track> rendering and listen to its cuechange
 *  events to draw captions in our own styled container. This gives us
 *  full control over typography, position, and theming — and respects
 *  our CC on/off toggle.
 * ===================================================================== */
function bindSubtitles() {
  if (!video.textTracks || video.textTracks.length === 0) {
    // Track may attach asynchronously after the <track> loads
    video.addEventListener('loadedmetadata', attachSubtitleListener);
    setTimeout(attachSubtitleListener, 400);  // fallback in case event missed
    return;
  }
  attachSubtitleListener();
}

function attachSubtitleListener() {
  const track = video.textTracks && video.textTracks[0];
  if (!track || track._bound) return;
  track._bound = true;

  // Hide the browser's native rendering — we'll draw our own
  track.mode = ccOn ? 'hidden' : 'disabled';

  track.addEventListener('cuechange', renderActiveCues);
}

function setCC(on) {
  ccOn = on;
  const track = video.textTracks && video.textTracks[0];
  if (track) track.mode = on ? 'hidden' : 'disabled';
  if (!on) {
    captionBar.classList.remove('show');
    captionBar.textContent = '';
  } else {
    // When turning CC back on, manually push whatever cue is active now —
    // 'cuechange' won't fire again until the next time boundary.
    renderActiveCues();
  }
  ccBtn.classList.toggle('active-state', on);
  ccBtn.setAttribute('data-tooltip', on ? 'Hide captions' : 'Show captions');
}

function renderActiveCues() {
  const track = video.textTracks && video.textTracks[0];
  if (!ccOn || !track) {
    captionBar.classList.remove('show');
    return;
  }
  const active = track.activeCues;
  if (!active || active.length === 0) {
    captionBar.classList.remove('show');
    captionBar.textContent = '';
    return;
  }
  const text = Array.from(active).map(c => c.text).join('\n').trim();
  if (text) {
    captionBar.textContent = text;
    captionBar.classList.add('show');
  } else {
    captionBar.classList.remove('show');
  }
}

/* =====================================================================
 *  INTERACTIONS
 * ===================================================================== */
function showInteraction(seg) {
  if (video && !video.paused) video.pause();
  state.playing = false;
  setPlayButtonIcon();
  captionBar.classList.remove('show');

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
 *  CONTROLS
 * ===================================================================== */
function setPlayButtonIcon() {
  playBtn.textContent = state.playing ? '⏸' : '▶';
  playBtn.setAttribute('data-tooltip', state.playing ? 'Pause' : 'Play');
}

function attachControls() {
  /* Floating tooltip */
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
    const seg = currentSegment();
    if (!seg || seg.type === 'interaction' || !video) return;
    if (state.playing) {
      video.pause();
    } else {
      // Snap back if we drifted outside the segment window
      if (video.currentTime < seg.videoStart || video.currentTime >= seg.videoEnd) {
        seekVideoTo(seg.videoStart);
      }
      video.play().catch(e => console.warn('play() rejected:', e));
    }
  };

  /* SKIP ±10s — across segment boundaries, like a real video.
     Forward skip past a segment end → jumps into the next video segment.
     Backward skip past a segment start → jumps into the previous video segment. */
  const skipBy = (delta) => {
    if (!video) return;
    const total = totalLessonDuration();
    const targetLessonTime = Math.max(0, Math.min(total, currentTimeSec() + delta));
    const { idx, offsetSec } = timeToSegment(targetLessonTime);
    const segs = currentLesson().segments;
    const seg = segs[idx];
    if (!seg) return;

    if (seg.type === 'interaction') {
      // Skipping landed on an interaction — show it (forward) or skip past it (backward)
      if (delta > 0) {
        state.currentSegmentIdx = idx;
        currentVideoEnd = null;
        showInteraction(seg);
      } else {
        // Going backward, hop one more step to the previous video segment
        let i = idx - 1;
        while (i >= 0 && segs[i].type !== 'video') i--;
        if (i < 0) return;
        state.currentSegmentIdx = i;
        currentVideoEnd = segs[i].videoEnd;
        seekVideoTo(segs[i].videoEnd - 0.5);
        showSegmentBanner(segs[i]);
      }
      updateLessonList();
      return;
    }

    // Landing inside a video segment
    if (idx !== state.currentSegmentIdx) {
      state.currentSegmentIdx = idx;
      currentVideoEnd = seg.videoEnd;
      showSegmentBanner(seg);
      interactionOverlay.classList.remove('show');
      updateLessonList();
    }
    seekVideoTo(seg.videoStart + offsetSec);
  };
  skipBackBtn.onclick = () => skipBy(-10);
  skipFwdBtn.onclick  = () => skipBy(10);

  /* RESTART current lesson */
  restartBtn.onclick = () => {
    state.currentSegmentIdx = 0;
    state.playing = false;
    setPlayButtonIcon();
    completeOverlay.classList.remove('show');
    interactionOverlay.classList.remove('show');
    const first = currentSegment();
    if (first && first.type === 'video') presentVideoSegment(first);
    updateTimelineUI();
    updateLessonList();
    restartBtn.classList.add('active-state');
    setTimeout(() => restartBtn.classList.remove('active-state'), 250);
  };

  /* CC TOGGLE */
  ccBtn.onclick = () => setCC(!ccOn);

  /* MUTE */
  muteBtn.onclick = () => {
    if (!video) return;
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('data-tooltip', video.muted ? 'Unmute' : 'Mute');
    muteBtn.classList.toggle('active-state', video.muted);
  };

  /* SPEED */
  speedBtn.onclick = () => {
    if (!video) return;
    rateIdx = (rateIdx + 1) % RATES.length;
    const r = RATES[rateIdx];
    video.playbackRate = r;
    speedBtn.textContent = r + '×';
    speedBtn.setAttribute('data-tooltip', `Speed: ${r}×`);
    speedBtn.classList.toggle('active-state', r !== 1);
  };

  /* FULLSCREEN */
  fullscreenBtn.onclick = () => {
    const target = player;
    const isFull = document.fullscreenElement || document.webkitFullscreenElement;
    if (!isFull) (target.requestFullscreen || target.webkitRequestFullscreen)?.call(target);
    else (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  };
  document.addEventListener('fullscreenchange', () => {
    const isFull = !!document.fullscreenElement;
    fullscreenBtn.textContent = isFull ? '⤡' : '⛶';
    fullscreenBtn.setAttribute('data-tooltip', isFull ? 'Exit fullscreen' : 'Fullscreen');
    fullscreenBtn.classList.toggle('active-state', isFull);
  });

  /* CONTINUE after interaction */
  $('iContinue').onclick = () => {
    state.currentSegmentIdx++;
    const next = currentSegment();
    interactionOverlay.classList.remove('show');
    if (!next) { showCompleteOverlay(); return; }
    if (next.type === 'interaction') {
      showInteraction(next);
    } else if (next.type === 'video') {
      presentVideoSegment(next);
      setTimeout(() => video?.play().catch(()=>{}), 100);
    }
  };

  /* PROGRESS BAR — hover, click, drag */
  let isDragging = false;
  let wasPlayingBeforeDrag = false;

  const pctFromEvent = (e) => {
    const rect = progressTrack.getBoundingClientRect();
    const x = (e.clientX !== undefined ? e.clientX : e.touches?.[0]?.clientX) - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  };

  const seekToLessonTime = (lessonT) => {
    const { idx, offsetSec } = timeToSegment(lessonT);
    const seg = currentLesson().segments[idx];
    if (!seg) return;
    if (seg.type === 'interaction') {
      state.currentSegmentIdx = idx;
      currentVideoEnd = null;
      showInteraction(seg);
      return;
    }
    state.currentSegmentIdx = idx;
    currentVideoEnd = seg.videoEnd;
    showSegmentBanner(seg);
    if (video) seekVideoTo(seg.videoStart + offsetSec);
    interactionOverlay.classList.remove('show');
    updateLessonList();
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
    if (state.playing && video) video.pause();
    const pct = pctFromEvent(e);
    seekToLessonTime(pct * totalLessonDuration());
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const pct = pctFromEvent(e);
    const total = totalLessonDuration();
    progressHoverTime.style.left = (pct * 100) + '%';
    progressHoverTime.textContent = formatTime(pct * total);
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
    seekToLessonTime(pct * totalLessonDuration());
    if (wasPlayingBeforeDrag && video) setTimeout(() => video.play().catch(()=>{}), 80);
  });

  /* Keyboard shortcuts */
  document.addEventListener('keydown', e => {
    if (e.target.matches('textarea, input, select')) return;
    if (e.code === 'Space')      { e.preventDefault(); playBtn.click(); }
    if (e.key === 'ArrowRight')  { e.preventDefault(); skipFwdBtn.click(); }
    if (e.key === 'ArrowLeft')   { e.preventDefault(); skipBackBtn.click(); }
    if (e.key === 'j' || e.key === 'J') skipBackBtn.click();
    if (e.key === 'l' || e.key === 'L') skipFwdBtn.click();
    if (e.key === 'c' || e.key === 'C') ccBtn.click();
    if (e.key === 'm' || e.key === 'M') muteBtn.click();
    if (e.key === 'f' || e.key === 'F') fullscreenBtn.click();
  });
}

/* =====================================================================
 *  TIMELINE UI
 * ===================================================================== */
function updateTimelineUI() {
  const total = totalLessonDuration();
  const cur = currentTimeSec();
  const pct = total > 0 ? Math.min(100, (cur / total) * 100) : 0;
  progressFillBar.style.width = pct + '%';
  progressHandle.style.left = pct + '%';
  timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(total)}`;

  // Buffered up to current segment's end
  let buf = 0;
  const segs = currentLesson().segments;
  for (let i = 0; i <= state.currentSegmentIdx && i < segs.length; i++) {
    buf += segDuration(segs[i]);
  }
  buf = Math.max(cur, Math.min(total, buf));
  progressBuffered.style.width = (total > 0 ? (buf / total) * 100 : 0) + '%';

  // Markers for interaction stops
  const markers = $('progressMarkers');
  if (markers.dataset.lessonId !== String(state.currentLessonId)) {
    markers.innerHTML = '';
    markers.dataset.lessonId = String(state.currentLessonId);
    let acc = 0;
    segs.forEach(seg => {
      if (seg.type === 'interaction' && total > 0) {
        const m = document.createElement('div');
        m.className = 'progress-marker interaction';
        m.style.left = (acc / total) * 100 + '%';
        m.title = 'Interaction checkpoint';
        markers.appendChild(m);
      }
      acc += segDuration(seg);
    });
  }

  // Lesson completion
  const lesson = currentLesson();
  lesson.complete = total > 0 ? Math.min(1, cur / total) : 0;
  const courseAvg = COURSE.lessons.reduce((s, l) => s + (l.complete || 0), 0) / COURSE.lessons.length;
  courseProgressEl.textContent = Math.round(courseAvg * 100) + '%';
}

/* =====================================================================
 *  SIDEBAR
 * ===================================================================== */
function updateLessonList() {
  lessonList.innerHTML = '';
  COURSE.lessons.forEach(lesson => {
    const li = document.createElement('li');
    li.className = 'lesson-item' + (lesson.id === state.currentLessonId ? ' current' : '');
    const pct = Math.round((lesson.complete || 0) * 100);
    let statusClass = 'locked';
    let progressText = 'Not started';
    if (pct === 100) { statusClass = 'done'; progressText = 'Completed | 100%'; }
    else if (pct > 0) { statusClass = 'in-progress'; progressText = `In progress | ${pct}%`; }

    li.innerHTML = `
      <div class="lesson-item-head">
        <div class="lesson-status ${statusClass}"></div>
        <div class="lesson-name">${lesson.title}</div>
      </div>
      <div class="lesson-sublabel">${lesson.subtitle || ''}</div>
      <div class="lesson-progress ${pct === 100 ? 'complete' : ''}">${progressText}</div>
    `;
    li.onclick = () => switchLesson(lesson.id);
    lessonList.appendChild(li);
  });
}

function switchLesson(id) {
  state.currentLessonId = id;
  state.currentSegmentIdx = 0;
  state.playing = false;
  setPlayButtonIcon();
  completeOverlay.classList.remove('show');
  interactionOverlay.classList.remove('show');

  const lesson = currentLesson();
  lessonTitleEl.textContent = lesson.title;
  lessonSubtitleEl.textContent = lesson.subtitle || '';

  // Reset markers for the new lesson
  const markers = $('progressMarkers');
  markers.innerHTML = '';
  markers.dataset.lessonId = '';

  const first = currentSegment();
  if (first && first.type === 'video') {
    presentVideoSegment(first);
    if (video && !video.paused) video.pause();
  } else if (first && first.type === 'interaction') {
    showInteraction(first);
  }

  updateTimelineUI();
  updateLessonList();
}

function goToLesson(delta) {
  const idx = COURSE.lessons.findIndex(l => l.id === state.currentLessonId);
  const next = COURSE.lessons[idx + delta];
  if (next) switchLesson(next.id);
}
window.goToLesson = goToLesson;

function restartLesson() {
  state.currentSegmentIdx = 0;
  state.playing = false;
  setPlayButtonIcon();
  completeOverlay.classList.remove('show');
  const first = currentSegment();
  if (first && first.type === 'video') presentVideoSegment(first);
  updateTimelineUI();
}
window.restartLesson = restartLesson;

function showCompleteOverlay() {
  state.playing = false;
  setPlayButtonIcon();
  completeOverlay.classList.add('show');
  currentLesson().complete = 1.0;
  updateTimelineUI();
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
      <p style="color:#666;font-size:0.9rem">Browsers block fetch() from file:// — serve over HTTP:</p>
      <pre style="background:#f4f4f4;padding:1rem;display:inline-block;text-align:left;border-radius:8px">python3 -m http.server 8000</pre>
    </div>`;
    return;
  }

  $('headerSubtitle').textContent = COURSE.subtitle || '';

  // Set the video source and the subtitle track
  video.src = COURSE.video.src || './video.mp4';
  const trackEl = document.querySelector('track[kind="subtitles"]');
  if (trackEl && COURSE.video.subtitles) {
    trackEl.src = COURSE.video.subtitles;
  }

  bindVideoEvents();
  bindSubtitles();
  attachControls();

  switchLesson(1);
}

document.addEventListener('DOMContentLoaded', init);