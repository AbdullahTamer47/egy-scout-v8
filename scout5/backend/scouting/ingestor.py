"""Offline MP4 ingest & optional YouTube clip downloader with imageio_ffmpeg normalization."""
from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from collections.abc import Callable
from pathlib import Path

import cv2
import imageio_ffmpeg
import yt_dlp

from scouting.database import DATA_ROOT

VIDEOS_DIR = DATA_ROOT / "videos"
RAW_DIR = DATA_ROOT / "raw"
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR.mkdir(parents=True, exist_ok=True)

FFMPEG_BIN = shutil.which("ffmpeg") or imageio_ffmpeg.get_ffmpeg_exe()


def probe_video(path: Path) -> dict | None:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    ok, frame = cap.read()
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or (frame.shape[1] if ok and frame is not None else 0))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or (frame.shape[0] if ok and frame is not None else 0))
    fc = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    if not ok or frame is None or w <= 0 or h <= 0:
        return None
    if fps <= 1.0 or fps > 120.0:
        fps = 25.0
    return {"fps": fps, "width": w, "height": h, "frame_count": fc, "duration_s": round(fc / fps, 2) if fc > 0 else 0.0}


def normalize_mp4(src: Path, dst: Path, max_height: int = 720, target_fps: int = 25, max_sec: int = 0) -> dict:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".norm.mp4")
    cmd = [FFMPEG_BIN, "-y", "-err_detect", "ignore_err", "-fflags", "+genpts", "-i", str(src)]
    if max_sec and max_sec > 0:
        cmd.extend(["-t", str(int(max_sec))])
    cmd.extend([
        "-vf", f"scale=-2:'min({int(max_height)},ih)'",
        "-r", str(int(target_fps)),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
        str(tmp),
    ])
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 1024:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg failed: {(proc.stderr or '')[-300:]}")
    tmp.replace(dst)
    meta = probe_video(dst)
    if not meta:
        raise RuntimeError(f"Unreadable normalized MP4: {dst}")
    return meta


def download_youtube_clip(url_or_query: str, max_sec: int = 45, progress_cb: Callable[[float, str], None] | None = None) -> dict:
    target = url_or_query.strip()
    if not target.startswith("http"):
        target = f"ytsearch1:{target}"

    ff_dir = str(Path(FFMPEG_BIN).parent)
    if ff_dir.lower() not in os.environ.get("PATH", "").lower():
        os.environ["PATH"] = f"{ff_dir}{os.pathsep}{os.environ.get('PATH', '')}"

    def _hook(d: dict) -> None:
        if progress_cb and d.get("status") == "downloading":
            tot = float(d.get("total_bytes") or d.get("total_bytes_estimate") or 0.0)
            done = float(d.get("downloaded_bytes") or 0.0)
            progress_cb(min(0.25, (done / tot) * 0.25) if tot > 0 else 0.1, "جاري سحب المقطع عبر yt-dlp...")

    opts = {
        "format": "best[ext=mp4][height<=720]/18/bestvideo[ext=mp4][height<=720]/best",
        "ffmpeg_location": FFMPEG_BIN,
        "outtmpl": str(RAW_DIR / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "overwrites": True,
        "socket_timeout": 25,
        "retries": 3,
        "progress_hooks": [_hook],
    }
    if max_sec and max_sec > 0:
        opts["download_ranges"] = yt_dlp.utils.download_range_func(None, [(0, int(max_sec))])
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(target, download=True)
    entry = info["entries"][0] if (info and info.get("entries")) else info
    if not entry:
        raise RuntimeError("لم يتم العثور على الفيديو المطلوب")
    vid_id = entry.get("id") or uuid.uuid4().hex[:8]
    raw_matches = sorted(RAW_DIR.glob(f"{vid_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not raw_matches:
        raise RuntimeError("فشل حفظ ملف الفيديو المحمّل")
    slug = f"yt_{vid_id}"
    dst = VIDEOS_DIR / f"{slug}.mp4"
    meta = normalize_mp4(raw_matches[0], dst, max_sec=max_sec or 45)
    return {"slug": slug, "title": entry.get("title") or slug, "source_url": entry.get("webpage_url") or url_or_query, "video_path": str(dst), "meta": meta}
