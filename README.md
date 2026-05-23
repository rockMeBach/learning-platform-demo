# Stock Market Essentials - Narrated Lesson Module

## File structure

```
lesson-module/
├── lesson.html       ← the page (open this in browser)
├── styles.css        ← all visual styling
├── player.js         ← player logic (TTS, controls, sidebar, etc.)
├── course.json       ← all course content (lessons, slides, narration)
└── videos/           ← (optional) local Pexels MP4s named {id}.mp4
```

## Running

Because the page loads `course.json` via `fetch()`, it must be served over HTTP — opening with `file://` will fail with a CORS error.

The easiest way:

```bash
cd lesson-module
python -m http.server 8000
```

Then open: <http://localhost:8000/lesson.html>

(If you don't have Python: `npx serve .` works too.)

## Editing content

Everything you write — slide text, narration, interactions, video IDs — lives in `course.json`. No code changes needed to add new lessons, swap videos, or rewrite narration. The schema:

```jsonc
{
  "lessons": [
    {
      "id": 1,
      "title": "...",
      "segments": [
        {
          "type": "slide",
          "layout": "title|bullets|stats|definition|split",
          "eyebrow": "section label",
          "heading": "Main heading <em>can use HTML</em>",
          "body": "Optional body text",
          "bullets": ["Optional list", "of bullets"],
          "stats": [{"num": "₹2,847", "lbl": "Label"}],
          "definition": {"term": "Word", "meaning": "Definition"},
          "media": {
            "videoId": "7579577",
            "label": "Title",
            "credit": "Photographer",
            "url": "https://www.pexels.com/video/.../"
          },
          "narration": "What the TTS voice will read."
        },
        {
          "type": "interaction",
          "kind": "truefalse|mcq",
          "question": "...",
          "options": ["A", "B", "C"],
          "correctIndex": 1,
          "feedback": "Explanation after answering."
        }
      ]
    }
  ]
}
```

## Videos

Pexels CDN often blocks direct embedding. Use `download_pexels_videos.py` (provided separately) to populate a `videos/` folder:

```bash
export PEXELS_API_KEY="..."
python download_pexels_videos.py --out lesson-module/videos
```

Files save as `{video_id}.mp4` — the player tries the local copy first, then falls back to Pexels CDN URLs.

## Player controls

| Button | Function | Keyboard |
|---|---|---|
| ▶ / ⏸ | Play / Pause narration | Space |
| ⏮ / ⏭ | Previous / Next segment | ← / → |
| ↻ | Restart current lesson | — |
| 🔊 / 🔇 | Mute / Unmute | M |
| 1× | Cycle speed: 1× → 1.25× → 1.5× → 0.75× | — |
| ⛶ | Fullscreen toggle | F |
