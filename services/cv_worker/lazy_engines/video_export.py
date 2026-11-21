"""GOP-Aligned HLS Transcoder (keyint=15) & White-Label MP4 Clip Exporter (Wave 2 & 3)."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Optional

import cv2

from packages.shared_contracts.config import open_video_unicode


def build_hls_ffmpeg_command(
    input_mp4: str | Path,
    output_dir: str | Path,
    keyint: int = 15,
    hls_time_s: int = 4,
) -> list[str]:
    """Return ffmpeg command for instant-scrub GOP-aligned HLS (keyint=15 frames)."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    playlist = out_dir / "master.m3u8"
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_mp4),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-g",
        str(keyint),
        "-keyint_min",
        str(keyint),
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-hls_time",
        str(hls_time_s),
        "-hls_playlist_type",
        "vod",
        str(playlist),
    ]


def transcode_gop_hls(input_mp4: str | Path, output_dir: str | Path) -> Path:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg binary not found in PATH.")
    cmd = build_hls_ffmpeg_command(input_mp4, output_dir)
    subprocess.run(cmd, check=True, capture_output=True)
    return Path(output_dir) / "master.m3u8"


def export_watermarked_clip(
    input_mp4: str | Path,
    output_mp4: str | Path,
    start_s: float,
    end_s: float,
    club_watermark: str = "EGY-SCOUT PRIVATE",
    auto_face_blur: bool = False,
    face_boxes_by_frame: Optional[dict[int, list[list[float]]]] = None,
) -> Path:
    """Export a trimmed MP4 evidence clip with club DRM watermark & optional youth face-blur."""
    out_p = Path(output_mp4)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    cap, proxy = open_video_unicode(input_mp4)
    try:
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {input_mp4}")
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        f_start = max(0, int(round(start_s * fps)))
        f_end = max(f_start + 1, int(round(end_s * fps)))

        writer = cv2.VideoWriter(str(out_p), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_start)
        for fid in range(f_start, f_end):
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if auto_face_blur and face_boxes_by_frame and fid in face_boxes_by_frame:
                for x1, y1, x2, y2 in face_boxes_by_frame[fid]:
                    fh = max(8, int((y2 - y1) * 0.24))
                    ix1, iy1 = max(0, int(x1)), max(0, int(y1))
                    ix2, iy2 = min(w, int(x2)), min(h, iy1 + fh)
                    roi = frame[iy1:iy2, ix1:ix2]
                    if roi.size > 0:
                        frame[iy1:iy2, ix1:ix2] = cv2.GaussianBlur(roi, (15, 15), 0)
            if club_watermark:
                cv2.putText(
                    frame,
                    club_watermark,
                    (18, h - 18),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (230, 230, 230),
                    1,
                    cv2.LINE_AA,
                )
            writer.write(frame)
        writer.release()
    finally:
        cap.release()
        if proxy is not None and proxy.exists():
            try:
                proxy.unlink()
            except OSError:
                pass
    return out_p
