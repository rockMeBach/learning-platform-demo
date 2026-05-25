# Options Unlocked — Local-video Lesson Module

A Skilling-Academy-styled wrapper around a local MP4 video, sliced into three learning levels (L1 / L2 / L3) with quiz checkpoints in between. Custom-styled captions render from a WebVTT file.

## File structure

```
lesson-module-deploy/
├── lesson.html       ← page shell
├── styles.css        ← visual styling
├── player.js         ← player logic
├── course.json       ← lesson content & segment timestamps
├── video.mp4         ← YOU PROVIDE — your downloaded video
├── subtitles.vtt     ← captions in WebVTT format
├── vercel.json       ← routing & cache headers
└── .gitignore
```

## Quick setup

1. Drop your `video.mp4` next to `lesson.html` (path is `./video.mp4` by default).
2. Replace `subtitles.vtt` with the captions for your video — see below.
3. Serve locally:

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

Or deploy:

```bash
npx vercel --prod
```

Note: `git`/Vercel commits exclude MP4s via `.gitignore`. To deploy with the video, remove the `*.mp4` rule, or host the MP4 on a CDN and update `course.json`'s `video.src` to its URL.

## Getting subtitles for your video

The `subtitles.vtt` file uses standard WebVTT format. Easiest ways to generate it:

**YouTube Studio** (if you uploaded the video there):
- Subtitles → ⋮ menu → Download → `.vtt`

**Whisper** (local, free, very accurate):
```bash
pip install openai-whisper
whisper video.mp4 --output_format vtt --model small
```

**Hand-written** — see the existing `subtitles.vtt` for the format. Each cue is:
```
00:00:04.500 --> 00:00:09.000
The caption text here.
Can span multiple lines.
```

## How content is structured

`course.json` defines the video source and slices it into three lessons:

```jsonc
{
  "video": {
    "src": "./video.mp4",
    "subtitles": "./subtitles.vtt"
  },
  "lessons": [
    {
      "id": 1,
      "title": "Level 1 — Basics & Recall",
      "segments": [
        { "type": "video", "videoStart": 0, "videoEnd": 212, ... },
        { "type": "interaction", "kind": "truefalse", ... }
      ]
    }
  ]
}
```

The player loads the video once, then plays only `[videoStart, videoEnd)` for each segment, pausing precisely at the end to inject the next quiz.

## Player controls

| Button | Function | Keyboard |
|---|---|---|
| ▶ / ⏸ | Play / Pause | Space |
| ⏪ / ⏩ | Skip ±10 seconds | ← / → · J / L |
| ↻ | Restart current lesson | — |
| 🔊 / 🔇 | Mute / Unmute | M |
| CC | Toggle captions | C |
| 1× | Cycle speed: 1× → 1.25× → 1.5× → 2× → 0.5× → 0.75× | — |
| ⛶ | Fullscreen toggle | F |

The progress bar shows the lesson's local timeline (only the current lesson's video parts). Yellow markers indicate quiz checkpoints. Hover for a timestamp preview; drag to scrub.

## About the captions

The browser's default subtitle styling is hidden — captions are rendered into a custom `<div class="caption-bar">` so they get full Skilling-Academy styling (large white text, dark backdrop, centered, scales up in fullscreen). The `<track>` element loads the cues; we listen to its `cuechange` events to push the active cue text into our styled div.

To restyle captions, edit `.caption-bar` in `styles.css`.