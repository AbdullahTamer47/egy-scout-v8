"""GOP-Aligned HLS Transcoder (keyint=15) & AR-Baked White-Label MP4 Clip Exporter (Wave 2 & 3)."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

from packages.shared_contracts.config import open_video_unicode


def resolve_ffmpeg_binary() -> Optional[str]:
    """Locate ffmpeg from system PATH or bundled imageio-ffmpeg."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).is_file():
            return exe
    except Exception:
        pass
    return None


def build_hls_ffmpeg_command(
    input_mp4: str | Path,
    output_dir: str | Path,
    keyint: int = 15,
    hls_time_s: int = 4,
    ffmpeg_bin: Optional[str] = None,
) -> list[str]:
    """Return ffmpeg command for instant-scrub GOP-aligned HLS (keyint=15 frames)."""
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    playlist = out_dir / "master.m3u8"
    exe = ffmpeg_bin or resolve_ffmpeg_binary() or "ffmpeg"
    return [
        exe,
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
    exe = resolve_ffmpeg_binary()
    if not exe:
        raise RuntimeError("ffmpeg binary not found in PATH or imageio-ffmpeg.")
    cmd = build_hls_ffmpeg_command(input_mp4, output_dir, ffmpeg_bin=exe)
    subprocess.run(cmd, check=True, capture_output=True)
    return Path(output_dir) / "master.m3u8"


def _hex_to_bgr(hex_str: str, fallback: tuple[int, int, int] = (248, 189, 56)) -> tuple[int, int, int]:
    h = (hex_str or "").lstrip("#").strip()
    if len(h) == 6:
        try:
            return (int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16))
        except ValueError:
            return fallback
    return fallback


def export_watermarked_clip(
    input_mp4: str | Path,
    output_mp4: str | Path,
    start_s: float,
    end_s: float,
    club_watermark: str = "EGY-SCOUT PRIVATE",
    auto_face_blur: bool = False,
    face_boxes_by_frame: Optional[dict[int, list[list[float]]]] = None,
    ar_tracks_by_frame: Optional[dict[int, list[dict[str, Any]]]] = None,
    ar_ball_by_frame: Optional[dict[int, tuple[float, float]]] = None,
    kit_colors: Optional[dict[str, str]] = None,
    sequential_reveal: bool = True,
) -> Path:
    """Export a trimmed MP4 broadcast clip with Open-Base AR rings, Sequential Reveal, ball trail, DRM watermark & face-blur."""
    out_p = Path(output_mp4)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    cap, proxy = open_video_unicode(input_mp4)
    team_a_bgr = _hex_to_bgr((kit_colors or {}).get("team_a_hex", "#EF4444"), (68, 68, 239))
    team_b_bgr = _hex_to_bgr((kit_colors or {}).get("team_b_hex", "#38BDF8"), (248, 189, 56))
    ball_trail: list[tuple[int, int]] = []
    ar_fids = sorted(ar_tracks_by_frame.keys()) if ar_tracks_by_frame else []

    def _nearest_fid(target_f: int) -> Optional[int]:
        if not ar_fids:
            return None
        best = min(ar_fids, key=lambda x: abs(x - target_f))
        return best if abs(best - target_f) <= 5 else None

    try:
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {input_mp4}")
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        f_start = max(0, int(round(start_s * fps)))
        f_end = max(f_start + 1, int(round(end_s * fps)))
        total_f = max(1, f_end - f_start)

        writer = cv2.VideoWriter(str(out_p), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_start)
        for fid in range(f_start, f_end):
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            progress = (fid - f_start) / float(total_f)
            show_rings = True
            show_ball = (not sequential_reveal) or (progress >= 0.25)
            show_chain = (not sequential_reveal) or (progress >= 0.55)

            # Burn Broadcast AR Open-Base Ground Rings + Turf Chroma Occlusion (Phase 1+)
            nfid = _nearest_fid(fid)
            if show_rings and nfid is not None and ar_tracks_by_frame:
                overlay = np.zeros_like(frame)
                def_pts: list[tuple[int, int]] = []
                for p in ar_tracks_by_frame.get(nfid, []):
                    role = str(p.get("role", "player"))
                    if role not in ("player", "goalkeeper"):
                        continue
                    x1, y1, x2, y2 = [float(v) for v in p["bbox"]]
                    cx, cy = int((x1 + x2) * 0.5), int(y2)
                    bh = max(20.0, y2 - y1)
                    rx = int(max(13, min(34, bh * 0.32)))
                    ry = max(5, int(rx * 0.31))
                    col = (238, 211, 34) if role == "goalkeeper" else (team_a_bgr if p.get("team") == "team_a" else team_b_bgr)
                    # Open Base 270° arc behind player's boots
                    cv2.ellipse(overlay, (cx, cy), (rx, ry), 0, 130, 410, col, 2, cv2.LINE_AA)
                    if p.get("team") == "team_b" and role == "player":
                        def_pts.append((cx, cy))
                # Sequential Reveal Phase 3: connect defensive backline chain
                if show_chain and len(def_pts) >= 2:
                    def_pts.sort(key=lambda pt: pt[0])
                    for a_pt, b_pt in zip(def_pts[:4], def_pts[1:4]):
                        cv2.line(overlay, a_pt, b_pt, (129, 185, 16), 2, cv2.LINE_AA)
                # Green-turf occlusion mask so rings stay underneath players' boots/socks
                hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                turf = (hsv[:, :, 0] >= 28) & (hsv[:, :, 0] <= 90) & (hsv[:, :, 1] >= 42) & (hsv[:, :, 2] >= 35)
                has_ar = (overlay.sum(axis=2) > 0) & turf
                frame[has_ar] = cv2.addWeighted(frame, 0.35, overlay, 0.65, 0)[has_ar]

            # Sequential Reveal Phase 2: Burn Kalman Ball Comet Trail
            if show_ball and ar_ball_by_frame and nfid is not None and nfid in ar_ball_by_frame:
                bu, bv = ar_ball_by_frame[nfid]
                ball_trail.append((int(bu), int(bv)))
                if len(ball_trail) > 10:
                    ball_trail.pop(0)
                for i in range(1, len(ball_trail)):
                    cv2.line(frame, ball_trail[i - 1], ball_trail[i], (129, 185, 16), max(1, i // 2), cv2.LINE_AA)
                cv2.circle(frame, ball_trail[-1], 6, (255, 255, 255), 2, cv2.LINE_AA)

            # Optional Youth GDPR Auto Face-Blur
            if auto_face_blur and face_boxes_by_frame:
                bfid = fid if fid in face_boxes_by_frame else nfid
                if bfid is not None and bfid in face_boxes_by_frame:
                    for x1, y1, x2, y2 in face_boxes_by_frame[bfid]:
                        fh = max(8, int((y2 - y1) * 0.24))
                        ix1, iy1 = max(0, int(x1)), max(0, int(y1))
                        ix2, iy2 = min(w, int(x2)), min(h, iy1 + fh)
                        roi = frame[iy1:iy2, ix1:ix2]
                        if roi.size > 0:
                            frame[iy1:iy2, ix1:ix2] = cv2.GaussianBlur(roi, (15, 15), 0)

            # Broadcast DRM Watermark Pill
            if club_watermark:
                cv2.rectangle(frame, (14, h - 38), (min(w - 14, 14 + len(club_watermark) * 10 + 18), h - 10), (12, 18, 32), -1)
                cv2.putText(
                    frame,
                    club_watermark,
                    (22, h - 19),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.52,
                    (165, 243, 210),
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


def mux_audio_into_mp4(video_mp4: str | Path, audio_path: str | Path, output_mp4: str | Path) -> Path:
    """Mux coach voiceover audio (.webm/.wav/.mp3) directly into H.264 MP4 via free local ffmpeg."""
    exe = resolve_ffmpeg_binary()
    if not exe:
        raise RuntimeError("ffmpeg binary not found")
    out_p = Path(output_mp4)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        exe, "-y",
        "-i", str(video_mp4),
        "-i", str(audio_path),
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-map", "0:v:0", "-map", "1:a:0",
        "-shortest",
        str(out_p),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_p


def convert_webm_to_mp4_or_gif(input_webm: str | Path, output_path: str | Path, target_format: str = "mp4") -> Path:
    """Convert animated tactical board WebM recording into WhatsApp-ready H.264 MP4 or high-quality GIF via free ffmpeg."""
    exe = resolve_ffmpeg_binary()
    if not exe:
        raise RuntimeError("ffmpeg binary not found")
    out_p = Path(output_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    fmt = target_format.lower().strip()
    if fmt == "gif":
        cmd = [
            exe, "-y",
            "-i", str(input_webm),
            "-vf", "fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
            "-loop", "0",
            str(out_p),
        ]
    else:
        cmd = [
            exe, "-y",
            "-i", str(input_webm),
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(out_p),
        ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_p


def export_playlist_merged_mp4(
    input_mp4: str | Path,
    segments: list[tuple[float, float, str]],
    output_mp4: str | Path,
    slide_png_paths: Optional[list[Path]] = None,
) -> Path:
    """Concatenate multiple tagged match clips + optional Tactical Board PNG slides into ONE Locker-Room Lecture MP4."""
    exe = resolve_ffmpeg_binary()
    if not exe:
        raise RuntimeError("ffmpeg binary not found")
    out_p = Path(output_mp4)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    tmp_dir = out_p.parent / f"pl_tmp_{out_p.stem}"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    parts: list[Path] = []
    try:
        # 1. Optional Tactical Board PNG slide intro/interlude (4s H.264 clip)
        for s_idx, sp in enumerate(slide_png_paths or []):
            if not sp.is_file():
                continue
            slide_mp4 = tmp_dir / f"slide_{s_idx}.mp4"
            subprocess.run(
                [
                    exe, "-y", "-loop", "1", "-t", "3.5", "-i", str(sp),
                    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#090D16",
                    "-r", "25", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    str(slide_mp4),
                ],
                check=True,
                capture_output=True,
            )
            parts.append(slide_mp4)

        # 2. Trim each playlist segment consistently at 1280x720 25fps H.264
        for idx, (s0, s1, _lbl) in enumerate(segments[:12]):
            dur = max(1.0, min(15.0, float(s1) - float(s0)))
            seg_mp4 = tmp_dir / f"seg_{idx}.mp4"
            subprocess.run(
                [
                    exe, "-y", "-ss", f"{max(0.0, float(s0)):.2f}", "-t", f"{dur:.2f}",
                    "-i", str(input_mp4),
                    "-an",
                    "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=#090D16",
                    "-r", "25", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                    str(seg_mp4),
                ],
                check=True,
                capture_output=True,
            )
            parts.append(seg_mp4)

        if not parts:
            raise ValueError("No playlist segments or slides to merge")

        concat_txt = tmp_dir / "concat.txt"
        concat_txt.write_text(
            "\n".join(f"file '{str(p.resolve()).replace(chr(39), '')}'" for p in parts),
            encoding="utf-8",
        )
        subprocess.run(
            [
                exe, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
                "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                str(out_p),
            ],
            check=True,
            capture_output=True,
        )
        return out_p
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
