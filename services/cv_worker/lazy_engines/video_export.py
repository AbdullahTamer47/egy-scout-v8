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

    def _draw_radar_minimap(
        img: np.ndarray,
        players_list: list[dict[str, Any]],
        ball_xy_m: Optional[tuple[float, float]] = None,
    ) -> None:
        mw, mh = min(168, max(120, w // 6)), min(108, max(76, h // 6))
        mx = (w - mw) // 2
        my = h - mh - 12
        sub = img[my : my + mh, mx : mx + mw].copy()
        bg = np.full_like(sub, (18, 28, 20))
        cv2.addWeighted(bg, 0.78, sub, 0.22, 0, dst=sub)
        img[my : my + mh, mx : mx + mw] = sub
        cv2.rectangle(img, (mx, my), (mx + mw - 1, my + mh - 1), (110, 231, 183), 1, cv2.LINE_AA)
        cv2.line(img, (mx + mw // 2, my + 4), (mx + mw // 2, my + mh - 5), (160, 200, 175), 1, cv2.LINE_AA)
        cv2.circle(img, (mx + mw // 2, my + mh // 2), max(8, mh // 6), (160, 200, 175), 1, cv2.LINE_AA)
        for pl in players_list:
            xm = pl.get("x_m")
            ym = pl.get("y_m")
            if xm is None or ym is None:
                continue
            px = mx + int(np.clip(float(xm) / 105.0, 0.02, 0.98) * (mw - 8)) + 4
            py = my + int(np.clip(float(ym) / 68.0, 0.03, 0.97) * (mh - 8)) + 4
            role_p = str(pl.get("role") or "player")
            col_p = (238, 211, 34) if role_p == "goalkeeper" else (team_a_bgr if pl.get("team") == "team_a" else team_b_bgr)
            cv2.circle(img, (px, py), 4, col_p, -1, cv2.LINE_AA)
            cv2.circle(img, (px, py), 4, (255, 255, 255), 1, cv2.LINE_AA)
        if ball_xy_m is not None:
            bx = mx + int(np.clip(ball_xy_m[0] / 105.0, 0.02, 0.98) * (mw - 8)) + 4
            by = my + int(np.clip(ball_xy_m[1] / 68.0, 0.03, 0.97) * (mh - 8)) + 4
            cv2.circle(img, (bx, by), 4, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(img, (bx, by), 5, (16, 185, 129), 1, cv2.LINE_AA)

    tmp_raw_mp4 = out_p.with_name(f"{out_p.stem}.raw_tmp.mp4")
    try:
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {input_mp4}")
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        f_start = max(0, int(round(start_s * fps)))
        f_end = max(f_start + 1, int(round(end_s * fps)))
        total_f = max(1, f_end - f_start)

        writer = cv2.VideoWriter(str(tmp_raw_mp4), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        cap.set(cv2.CAP_PROP_POS_FRAMES, f_start)
        for fid in range(f_start, f_end):
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            progress = (fid - f_start) / float(total_f)
            show_rings = True
            show_ball = (not sequential_reveal) or (progress >= 0.08)
            show_chain = (not sequential_reveal) or (progress >= 0.16)

            nfid = _nearest_fid(fid)
            frame_players = ar_tracks_by_frame.get(nfid, []) if (nfid is not None and ar_tracks_by_frame) else []
            ball_pt = ar_ball_by_frame.get(nfid) if (ar_ball_by_frame and nfid is not None) else None

            # Identify ball carrier in pitch coordinates or pixel proximity
            carrier_p: Optional[dict[str, Any]] = None
            best_c_dist = 9999.0
            if ball_pt is not None and frame_players:
                bu, bv = float(ball_pt[0]), float(ball_pt[1])
                for p in frame_players:
                    if str(p.get("role")) not in ("player", "goalkeeper"):
                        continue
                    x1, y1, x2, y2 = [float(v) for v in p["bbox"]]
                    d_px = float(np.hypot(((x1 + x2) * 0.5) - bu, y2 - bv))
                    if d_px < best_c_dist and d_px < max(42.0, (y2 - y1) * 1.15):
                        best_c_dist = d_px
                        carrier_p = p

            # Burn Broadcast AR Double-Rings + Chain + Passing Lanes (Turf Occluded)
            if show_rings and frame_players:
                overlay = np.zeros_like(frame)
                def_pts: list[tuple[int, int, float]] = []
                for p in frame_players:
                    role = str(p.get("role", "player"))
                    if role not in ("player", "goalkeeper"):
                        continue
                    x1, y1, x2, y2 = [float(v) for v in p["bbox"]]
                    cx, cy = int((x1 + x2) * 0.5), int(y2)
                    bh = max(20.0, y2 - y1)
                    rx = int(max(14, min(36, bh * 0.34)))
                    ry = max(6, int(rx * 0.32))
                    is_carrier = carrier_p is not None and p.get("track_id") == carrier_p.get("track_id")
                    col = (
                        (129, 231, 16)
                        if is_carrier
                        else ((238, 211, 34) if role == "goalkeeper" else (team_a_bgr if p.get("team") == "team_a" else team_b_bgr))
                    )
                    # Outer glow ellipse + inner open 270 deg ring
                    cv2.ellipse(overlay, (cx, cy), (rx + 4, ry + 2), 0, 0, 360, col, 1, cv2.LINE_AA)
                    cv2.ellipse(overlay, (cx, cy), (rx, ry), 0, 125, 415, col, 3 if is_carrier else 2, cv2.LINE_AA)
                    if p.get("team") == "team_b" and role == "player":
                        def_pts.append((cx, cy, float(p.get("x_m") or 50.0)))

                # Connected Defending Backline Chain (sorted left-to-right on screen)
                if show_chain and len(def_pts) >= 2:
                    def_pts.sort(key=lambda pt: pt[0])
                    chain = def_pts[:4]
                    for a_pt, b_pt in zip(chain, chain[1:]):
                        cv2.line(overlay, (a_pt[0], a_pt[1]), (b_pt[0], b_pt[1]), (160, 245, 70), 2, cv2.LINE_AA)

                # Passing option lanes from ball carrier to 2 nearest teammates
                if carrier_p is not None:
                    cx1, cy1, cx2, cy2 = [float(v) for v in carrier_p["bbox"]]
                    c_pt = (int((cx1 + cx2) * 0.5), int(cy2))
                    mates: list[tuple[float, tuple[int, int]]] = []
                    for p in frame_players:
                        if p.get("team") != carrier_p.get("team") or p.get("track_id") == carrier_p.get("track_id"):
                            continue
                        px1, py1, px2, py2 = [float(v) for v in p["bbox"]]
                        pt_m = (int((px1 + px2) * 0.5), int(py2))
                        d = float(np.hypot(pt_m[0] - c_pt[0], pt_m[1] - c_pt[1]))
                        if 45.0 < d < w * 0.45:
                            mates.append((d, pt_m))
                    mates.sort(key=lambda item: item[0])
                    for _, m_pt in mates[:2]:
                        cv2.line(overlay, c_pt, m_pt, (250, 200, 60), 2, cv2.LINE_AA)

                hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
                turf = (hsv[:, :, 0] >= 26) & (hsv[:, :, 0] <= 94) & (hsv[:, :, 1] >= 36) & (hsv[:, :, 2] >= 30)
                has_ar = (overlay.sum(axis=2) > 0) & turf
                blended = cv2.addWeighted(frame, 0.28, overlay, 0.72, 0)
                frame[has_ar] = blended[has_ar]

            # Ball Carrier Spotlight Beam & Clean Name/Speed Tag (ASCII safe in cv2)
            if carrier_p is not None:
                x1, y1, x2, y2 = [float(v) for v in carrier_p["bbox"]]
                cx = int((x1 + x2) * 0.5)
                ty = max(24, int(y1) - 10)
                cv2.line(frame, (cx, int(y1)), (cx, max(6, ty - 14)), (16, 220, 140), 2, cv2.LINE_AA)
                j_num = carrier_p.get("jersey_number")
                spd = float(carrier_p.get("speed_kmh") or 0.0)
                raw_name = str(carrier_p.get("verified_name_en") or carrier_p.get("verified_name") or f"T{int(carrier_p['track_id']) % 100}")
                ascii_name = raw_name.encode("ascii", errors="ignore").decode("ascii").strip() or f"T{int(carrier_p['track_id']) % 100}"
                tag_txt = f"#{j_num} {ascii_name[:16]} {spd:.0f}km/h" if j_num else f"{ascii_name[:16]} {spd:.0f}km/h"
                tw = min(220, max(96, len(tag_txt) * 8 + 16))
                bx1 = max(8, min(w - tw - 8, cx - tw // 2))
                by1 = max(8, ty - 22)
                cv2.rectangle(frame, (bx1, by1), (bx1 + tw, by1 + 20), (12, 18, 32), -1)
                cv2.rectangle(frame, (bx1, by1), (bx1 + tw, by1 + 20), (16, 220, 140), 1, cv2.LINE_AA)
                cv2.putText(frame, tag_txt, (bx1 + 6, by1 + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.43, (236, 253, 245), 1, cv2.LINE_AA)

            # Burn Kalman Ball Comet Trail
            if show_ball and ball_pt is not None:
                bu, bv = ball_pt
                ball_trail.append((int(bu), int(bv)))
                if len(ball_trail) > 12:
                    ball_trail.pop(0)
                for i in range(1, len(ball_trail)):
                    cv2.line(frame, ball_trail[i - 1], ball_trail[i], (129, 231, 16), max(2, i // 2), cv2.LINE_AA)
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

            # Bottom-Center 2D Pitch Radar Minimap
            if frame_players:
                _draw_radar_minimap(frame, frame_players)

            # Broadcast DRM Watermark Pill (Bottom Left)
            if club_watermark:
                cv2.rectangle(frame, (14, h - 38), (min(w // 2 - 20, 14 + len(club_watermark) * 9 + 16), h - 10), (12, 18, 32), -1)
                cv2.putText(
                    frame,
                    club_watermark[:28],
                    (22, h - 19),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (165, 243, 210),
                    1,
                    cv2.LINE_AA,
                )
            writer.write(frame)
        writer.release()

        # Transcode to universal browser-playable H.264 + faststart MP4
        ffmpeg_exe = resolve_ffmpeg_binary()
        if ffmpeg_exe:
            subprocess.run(
                [
                    ffmpeg_exe,
                    "-y",
                    "-i",
                    str(tmp_raw_mp4),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "22",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(out_p),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                tmp_raw_mp4.unlink(missing_ok=True)
            except OSError:
                pass
        else:
            tmp_raw_mp4.replace(out_p)
    finally:
        cap.release()
        if tmp_raw_mp4.exists() and out_p.exists():
            try:
                tmp_raw_mp4.unlink(missing_ok=True)
            except OSError:
                pass
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
