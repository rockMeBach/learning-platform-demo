"""
download_pexels_videos.py
─────────────────────────────────────────────────────────────────────────
Download the six Pexels stock-market videos via the Pexels API.

Setup:
    pip install requests
    export PEXELS_API_KEY="your-key-here"      # or pass --key

Run:
    python download_pexels_videos.py
    python download_pexels_videos.py --quality sd     # sd | hd | best
    python download_pexels_videos.py --out ./videos
─────────────────────────────────────────────────────────────────────────
API docs: https://www.pexels.com/api/documentation/#videos-show
"""

import argparse
import os
import sys
from pathlib import Path

import requests

VIDEO_IDS = ["7579577", "7578613", "7579561", "14003933", "30289541", "34433115"]

# Largest width allowed for each quality preference. We pick the biggest
# variant that fits under the cap; if none fit, we take the smallest available.
QUALITY_CAP = {"sd": 960, "hd": 1920, "best": 10_000}

PEXELS_API_KEY = "25m2AYiH54Z9SDKIQbGfHYNkp87MqvWAmP4CkhmWvF3BE9l2ZyVykNYv"

def pick_file(video_files: list[dict], quality: str) -> dict:
    """Pick the best .mp4 variant within the quality cap."""
    mp4s = [f for f in video_files if f.get("file_type") == "video/mp4"]
    cap = QUALITY_CAP[quality]
    fitting = [f for f in mp4s if (f.get("width") or 0) <= cap]
    pool = fitting if fitting else mp4s
    return max(pool, key=lambda f: f.get("width") or 0)


def download_one(video_id: str, api_key: str, out_dir: Path, quality: str) -> bool:
    out_path = out_dir / f"{video_id}.mp4"
    if out_path.exists():
        size_mb = out_path.stat().st_size / 1e6
        print(f"↺ {video_id}.mp4 already exists ({size_mb:.1f} MB) — skipping")
        return True

    print(f"▶ {video_id}")

    # 1. Get metadata for the video — returns all available file variants.
    meta = requests.get(
        f"https://api.pexels.com/videos/videos/{video_id}",
        headers={"Authorization": api_key},
        timeout=30,
    )
    if meta.status_code != 200:
        print(f"  ✗ API returned HTTP {meta.status_code}: {meta.text[:120]}")
        return False

    data = meta.json()
    chosen = pick_file(data["video_files"], quality)
    print(f"  variant: {chosen['width']}×{chosen['height']} @ {chosen.get('fps', '?')}fps")

    # 2. Stream the file to disk.
    with requests.get(chosen["link"], stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(out_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 16):
                f.write(chunk)

    size_mb = out_path.stat().st_size / 1e6
    print(f"  ✓ saved {out_path.name} ({size_mb:.1f} MB)")
    return True


def main():
    parser = argparse.ArgumentParser(description="Download Pexels videos via the API.")
    parser.add_argument("--key", default=PEXELS_API_KEY,
                        help="Pexels API key (or set PEXELS_API_KEY env var).")
    parser.add_argument("--out", default="./videos", help="Output folder.")
    parser.add_argument("--quality", choices=["sd", "hd", "best"], default="hd")
    parser.add_argument("--only", nargs="+", metavar="ID", default=None,
                        help="Only download these specific Pexels video IDs.")
    args = parser.parse_args()

    if not args.key:
        sys.exit("ERROR: Pexels API key not provided. Use --key or set PEXELS_API_KEY.")

    out_dir = Path(args.out).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    targets = args.only or VIDEO_IDS

    print(f"Output : {out_dir}")
    print(f"Quality: {args.quality}")
    print(f"Videos : {len(targets)}\n")

    ok = sum(download_one(v, args.key, out_dir, args.quality) for v in targets)
    print(f"\nDone — {ok}/{len(targets)} saved to {out_dir}")
    sys.exit(0 if ok == len(targets) else 1)


if __name__ == "__main__":
    main()