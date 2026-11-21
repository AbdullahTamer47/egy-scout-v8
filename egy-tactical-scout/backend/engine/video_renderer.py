"""Piero-3D Broadcast AR Video Exporter using Inverse Homography (H_inv) + FFmpeg."""
from __future__ import annotations

import math
import subprocess
from collections.abc import Callable
from pathlib import Path

import cv2
import imageio_ffmpeg
import numpy as np
import pandas as pd

from core.config import PITCH_LENGTH, PITCH_WIDTH, find_ffmpeg

FFMPEG_BIN = find_ffmpeg() or imageio_ffmpeg.get_ffmpeg_exe()


def _project_m_to_px(xy_m: np.ndarray, h_inv_norm: np.ndarray, fw: int, fh: int) -> np.ndarray:
    if xy_m is None or len(xy_m) == 0 or h_inv_norm is None:
        return np.empty((0, 2), dtype=np.float32)
    pts = np.asarray(xy_m, dtype=np.float32).reshape(-1, 1, 2)
    norm_pts = cv2.perspectiveTransform(pts, np.asarray(h_inv_norm, dtype=np.float32)).reshape(-1, 2)
    px = np.empty_like(norm_pts)
    px[:, 0] = norm_pts[:, 0] * fw
    px[:, 1] = norm_pts[:, 1] * fh
    return px


def _draw_radar_inset(
    canvas: np.ndarray,
    frame_df: pd.DataFrame,
    ftac: dict | None,
    highlight_identity: str | None = None,
    team_kits: dict | None = None,
) -> None:
    fh, fw = canvas.shape[:2]
    rw, rh = min(290, int(fw * 0.24)), min(188, int(fh * 0.26))
    rx0, ry0 = (fw - rw) // 2, fh - rh - 14
    overlay = canvas.copy()
    cv2.rectangle(overlay, (rx0, ry0), (rx0 + rw, ry0 + rh), (18, 28, 22), -1)
    cv2.addWeighted(overlay, 0.82, canvas, 0.18, 0, canvas)
    cv2.rectangle(canvas, (rx0, ry0), (rx0 + rw, ry0 + rh), (95, 160, 120), 1)

    sx, sy = rw / PITCH_LENGTH, rh / PITCH_WIDTH
    mx = rx0 + rw // 2
    cv2.line(canvas, (mx, ry0), (mx, ry0 + rh), (85, 130, 100), 1)
    cv2.circle(canvas, (mx, ry0 + rh // 2), int(9.15 * sx), (85, 130, 100), 1)
    pbw, pbh = int(16.5 * sx), int(40.32 * sy)
    pby = ry0 + (rh - pbh) // 2
    cv2.rectangle(canvas, (rx0, pby), (rx0 + pbw, pby + pbh), (85, 130, 100), 1)
    cv2.rectangle(canvas, (rx0 + rw - pbw, pby), (rx0 + rw, pby + pbh), (85, 130, 100), 1)

    col0_bgr = _hex_to_bgr(((team_kits or {}).get("0") or {}).get("ring"), (68, 68, 239))
    col1_bgr = _hex_to_bgr(((team_kits or {}).get("1") or {}).get("ring"), (248, 189, 56))

    if ftac:
        for tc, col in (("0", col0_bgr), ("1", col1_bgr)):
            for chain in ftac.get("formations", {}).get(tc, {}).get("lines", []):
                if len(chain) >= 2:
                    pts = np.array([(rx0 + int(p[0] * sx), ry0 + int(p[1] * sy)) for p in chain], dtype=np.int32)
                    cv2.polylines(canvas, [pts], False, col, 1, cv2.LINE_AA)

    for _, r in frame_df.iterrows():
        role = str(r.get("role", "player"))
        if role == "referee":
            continue
        xm, ym = float(r.get("x_smooth", 52.5)), float(r.get("y_smooth", 34.0))
        px, py = rx0 + int(xm * sx), ry0 + int(ym * sy)
        if role == "ball":
            cv2.circle(canvas, (px, py), 4, (0, 230, 255), -1)
            continue
        tc = int(r.get("team_cluster", -1))
        col = col0_bgr if tc == 0 else (col1_bgr if tc == 1 else (180, 180, 180))
        rad = 6 if highlight_identity and str(r.get("identity_key")) == highlight_identity else 4
        cv2.circle(canvas, (px, py), rad, col, -1)
        if highlight_identity and str(r.get("identity_key")) == highlight_identity:
            cv2.circle(canvas, (px, py), rad + 3, (0, 255, 255), 1)


def _hex_to_bgr(hex_str: str | None, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
    if not hex_str or not isinstance(hex_str, str):
        return fallback
    s = hex_str.strip().lstrip("#")
    if len(s) != 6:
        return fallback
    try:
        r = int(s[0:2], 16)
        g = int(s[2:4], 16)
        b = int(s[4:6], 16)
        return (b, g, r)
    except ValueError:
        return fallback


def draw_tactical_frame(
    frame: np.ndarray,
    fdf: pd.DataFrame,
    ftac: dict | None,
    fw: int,
    fh: int,
    team_kits: dict | None = None,
    highlight_identity: str | None = None,
    show_voronoi: bool = False,
) -> np.ndarray:
    """Draw zero-drift V4.5 broadcast AR overlays respecting close-up cutscenes & real team kit colors."""
    is_wide = bool(ftac.get("is_tactical_wide", not fdf.empty)) if ftac else (not fdf.empty)
    if not is_wide:
        cv2.rectangle(frame, (14, 14), (225, 42), (18, 24, 38), -1)
        cv2.rectangle(frame, (14, 14), (225, 42), (100, 116, 139), 1)
        cv2.putText(frame, "CLOSE-UP CUTSCENE", (24, 33), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (226, 232, 240), 1, cv2.LINE_AA)
        _draw_radar_inset(frame, fdf, ftac, highlight_identity=highlight_identity, team_kits=team_kits)
        return frame

    col0_bgr = _hex_to_bgr(((team_kits or {}).get("0") or {}).get("ring"), (68, 68, 239))
    col1_bgr = _hex_to_bgr(((team_kits or {}).get("1") or {}).get("ring"), (248, 189, 56))
    h_inv = np.array(ftac["h_inv"], dtype=np.float32).reshape(3, 3) if (ftac and ftac.get("h_inv")) else None

    # 1. 3D Projected Voronoi Polygons on Grass (optional, off by default for clean broadcast turf)
    if show_voronoi and h_inv is not None and ftac and ftac.get("voronoi_polys"):
        vor_layer = frame.copy()
        for vp in ftac["voronoi_polys"]:
            pts_m = np.array(vp["points_m"], dtype=np.float32)
            if len(pts_m) < 3:
                continue
            px = _project_m_to_px(pts_m, h_inv, fw, fh).astype(np.int32)
            tc = vp.get("team_cluster", 0)
            col = col0_bgr if tc == 0 else col1_bgr
            cv2.fillPoly(vor_layer, [px], col)
        cv2.addWeighted(vor_layer, 0.14, frame, 0.86, 0, frame)

    # 2. Cover Shadows + Zero-Drift 3D Passing Lanes
    if ftac:
        if h_inv is not None and ftac.get("cover_shadows"):
            sh_layer = frame.copy()
            for sh in ftac["cover_shadows"]:
                poly_m = np.array(sh["polygon_m"], dtype=np.float32)
                px = _project_m_to_px(poly_m, h_inv, fw, fh).astype(np.int32)
                cv2.fillPoly(sh_layer, [px], (20, 20, 45))
            cv2.addWeighted(sh_layer, 0.32, frame, 0.68, 0, frame)

        for lane in ftac.get("passing_lanes", [])[:3]:
            if lane.get("from_uv") and lane.get("to_uv"):
                p0 = np.array([lane["from_uv"][0] * fw, lane["from_uv"][1] * fh], dtype=np.float32)
                p1 = np.array([lane["to_uv"][0] * fw, lane["to_uv"][1] * fh], dtype=np.float32)
            elif h_inv is not None:
                p0 = _project_m_to_px(np.array([lane["from_m"]], dtype=np.float32), h_inv, fw, fh)[0]
                p1 = _project_m_to_px(np.array([lane["to_m"]], dtype=np.float32), h_inv, fw, fh)[0]
            else:
                continue
            ctrl = 0.5 * (p0 + p1) + np.array([0.0, -26.0], dtype=np.float32)
            t_vals = np.linspace(0.0, 1.0, 16)[:, None]
            arc = ((1 - t_vals) ** 2) * p0 + 2 * (1 - t_vals) * t_vals * ctrl + (t_vals ** 2) * p1
            arc_i = arc.astype(np.int32)
            st = lane.get("status", "safe_open")
            col = (60, 220, 90) if st == "line_breaking" else ((0, 195, 255) if st == "safe_open" else (70, 70, 235))
            cv2.polylines(frame, [arc_i], False, col, 2, cv2.LINE_AA)
            mid = arc_i[len(arc_i) // 2]
            cv2.putText(
                frame,
                f"{int(round(lane.get('xpass_pct', 0)))}%",
                (int(mid[0]), int(mid[1]) - 4),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.42,
                col,
                1,
                cv2.LINE_AA,
            )

        # 3. Zero-Drift Pixel-Locked Dynamic Tactical Mesh Chains + Red >16m Gap Warning
        for tc, col in (("0", col0_bgr), ("1", col1_bgr)):
            form_obj = ftac.get("formations", {}).get(tc, {})
            chains_uv = form_obj.get("lines_uv", [])
            chains_m = form_obj.get("lines", [])
            if chains_uv:
                for ch_idx, uv_chain in enumerate(chains_uv):
                    if len(uv_chain) < 2:
                        continue
                    m_chain = chains_m[ch_idx] if ch_idx < len(chains_m) else []
                    for idx_c in range(len(uv_chain) - 1):
                        pa = (int(round(uv_chain[idx_c][0] * fw)), int(round(uv_chain[idx_c][1] * fh)))
                        pb = (int(round(uv_chain[idx_c + 1][0] * fw)), int(round(uv_chain[idx_c + 1][1] * fh)))
                        dist_m = float(np.linalg.norm(np.array(m_chain[idx_c + 1]) - np.array(m_chain[idx_c]))) if idx_c + 1 < len(m_chain) else 0.0
                        is_gap = dist_m > 16.0
                        line_col = (50, 50, 245) if is_gap else col
                        cv2.line(frame, pa, pb, line_col, 3 if is_gap else 2, cv2.LINE_AA)
                        if dist_m > 0.5:
                            mid = ((pa[0] + pb[0]) // 2, (pa[1] + pb[1]) // 2)
                            cv2.putText(frame, f"{dist_m:.1f}m", (mid[0] - 16, mid[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.40, line_col, 1, cv2.LINE_AA)
            elif h_inv is not None and chains_m:
                for chain in chains_m:
                    if len(chain) < 2:
                        continue
                    px_chain = _project_m_to_px(np.array(chain, dtype=np.float32), h_inv, fw, fh)
                    for idx_c in range(len(chain) - 1):
                        dist_m = float(np.linalg.norm(np.array(chain[idx_c + 1]) - np.array(chain[idx_c])))
                        pa, pb = tuple(px_chain[idx_c].astype(int)), tuple(px_chain[idx_c + 1].astype(int))
                        is_gap = dist_m > 16.0
                        line_col = (50, 50, 245) if is_gap else col
                        cv2.line(frame, pa, pb, line_col, 3 if is_gap else 2, cv2.LINE_AA)
                        mid = ((pa[0] + pb[0]) // 2, (pa[1] + pb[1]) // 2)
                        cv2.putText(frame, f"{dist_m:.1f}m", (mid[0] - 16, mid[1] - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.40, line_col, 1, cv2.LINE_AA)

    # 4. Dual Concentric 3D Foot Ellipses + Velocity Vector + Spotlight Beam + Labels
    carrier_tid = ftac.get("ball_carrier_track_id", -1) if ftac else -1
    if not fdf.empty:
        for _, r in fdf.iterrows():
            role = str(r.get("role", "player"))
            if role == "referee":
                continue
            u = float(r.get("u_norm") * fw) if pd.notna(r.get("u_norm")) else float(r.get("u", 0))
            v = float(r.get("v_norm") * fh) if pd.notna(r.get("v_norm")) else float(r.get("v", 0))
            if role == "ball":
                cv2.circle(frame, (int(u), int(v)), 7, (0, 235, 255), 2, cv2.LINE_AA)
                continue
            tc = int(r.get("team_cluster", -1))
            if tc not in (0, 1):
                continue
            col = col0_bgr if tc == 0 else col1_bgr
            bw_px = float(r.get("x2", u + 12)) - float(r.get("x1", u - 12))
            box_w = max(13, int(bw_px * 0.65))
            axes = (box_w, max(5, int(box_w * 0.32)))
            is_hl = (highlight_identity and str(r.get("identity_key")) == highlight_identity) or (
                carrier_tid > 0 and int(r.get("track_id", -2)) == carrier_tid
            )
            ring_col = (0, 235, 255) if is_hl else col
            if is_hl:
                beam = frame.copy()
                bh = max(40, int(float(r.get("y2", v)) - float(r.get("y1", v - 45))) + 28)
                pts_b = np.array(
                    [[u - axes[0] * 0.7, v], [u + axes[0] * 0.7, v], [u + axes[0] * 0.3, v - bh], [u - axes[0] * 0.3, v - bh]],
                    dtype=np.int32,
                )
                cv2.fillPoly(beam, [pts_b], (0, 235, 255))
                cv2.addWeighted(beam, 0.22, frame, 0.78, 0, frame)
            cv2.ellipse(frame, (int(u), int(v)), (axes[0] + 4, axes[1] + 2), 0, -25, 205, ring_col, 1, cv2.LINE_AA)
            cv2.ellipse(frame, (int(u), int(v)), axes, 0, -25, 205, ring_col, 2, cv2.LINE_AA)

            vx = float(r.get("vx", 0.0) or 0.0)
            vy = float(r.get("vy", 0.0) or 0.0)
            spd = float(r.get("speed_kmh", 0.0) or 0.0)
            if spd >= 9.0:
                vmag = max(0.01, math.hypot(vx, vy))
                arrow_end = (int(u + (vx / vmag) * min(32.0, spd * 1.15)), int(v + (vy / vmag) * min(16.0, spd * 0.55)))
                cv2.arrowedLine(frame, (int(u), int(v)), arrow_end, ring_col, 1, cv2.LINE_AA, tipLength=0.32)

            jn = r.get("jersey_number")
            num_txt = f"#{int(jn)}" if pd.notna(jn) and int(jn) > 0 else f"#{int(r.get('track_id', 0))}"
            if is_hl or spd >= 15.0:
                tag = f"{num_txt} {spd:.0f}k"
                cv2.rectangle(frame, (int(u) - 22, int(v) + 6), (int(u) + 26, int(v) + 20), (15, 23, 42), -1)
                cv2.putText(frame, tag, (int(u) - 20, int(v) + 17), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (240, 245, 255), 1, cv2.LINE_AA)
            else:
                cv2.putText(frame, num_txt, (int(u) - 10, int(v) + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.34, (235, 240, 250), 1, cv2.LINE_AA)

    _draw_radar_inset(frame, fdf, ftac, highlight_identity=highlight_identity, team_kits=team_kits)
    return frame


def render_clip(
    video_path: str | Path,
    telemetry: pd.DataFrame,
    out_path: str | Path,
    start_s: float = 0.0,
    end_s: float | None = None,
    frame_tactics: dict | None = None,
    team_kits: dict | None = None,
    highlight_identity: str | None = None,
    progress_cb: Callable[[float, str], None] | None = None,
) -> Path:
    """Render MP4 highlight clip with Piero-3D Perspective AR graphics & synced 2D tactical radar."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_raw = out_path.with_suffix(".raw.mp4")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open source video: {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    if fps <= 1.0 or fps > 120.0:
        fps = 25.0
    fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    start_f = max(0, int(round(start_s * fps)))
    end_f = min(total, int(round(end_s * fps))) if end_s is not None else total
    if end_f <= start_f:
        end_f = max(start_f + int(fps * 5), total)

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_f)
    writer = cv2.VideoWriter(str(tmp_raw), cv2.VideoWriter_fourcc(*"mp4v"), fps, (fw, fh))
    if not writer.isOpened():
        cap.release()
        raise RuntimeError(f"Unable to open OpenCV VideoWriter for {tmp_raw}")

    by_frame = {int(fid): g for fid, g in telemetry.groupby("frame_id")} if not telemetry.empty else {}
    tac_keys = sorted(int(k) for k in (frame_tactics or {}).keys()) if frame_tactics else []

    def _nearest_frame_df(fid: int) -> pd.DataFrame:
        if fid in by_frame:
            return by_frame[fid]
        for off in range(1, 5):
            if (fid - off) in by_frame:
                return by_frame[fid - off]
            if (fid + off) in by_frame:
                return by_frame[fid + off]
        return pd.DataFrame()

    def _nearest_tac(fid: int) -> dict | None:
        if not frame_tactics:
            return None
        s = str(fid)
        if s in frame_tactics:
            return frame_tactics[s]
        for off in range(1, 5):
            if str(fid - off) in frame_tactics:
                return frame_tactics[str(fid - off)]
            if str(fid + off) in frame_tactics:
                return frame_tactics[str(fid + off)]
        return frame_tactics[str(tac_keys[0])] if tac_keys else None

    fid = start_f
    total_clip = max(1, end_f - start_f)

    try:
        while fid < end_f:
            ok, frame = cap.read()
            if not ok or frame is None:
                break

            fdf = _nearest_frame_df(fid)
            ftac = _nearest_tac(fid)
            draw_tactical_frame(frame, fdf, ftac, fw, fh, team_kits=team_kits, highlight_identity=highlight_identity)

            writer.write(frame)
            fid += 1
            if progress_cb and (fid - start_f) % 25 == 0:
                progress_cb(min(0.85, (fid - start_f) / total_clip * 0.85), f"تصدير فيديو الـ 3D AR ({fid - start_f}/{total_clip})")
    finally:
        cap.release()
        writer.release()

    if progress_cb:
        progress_cb(0.90, "ضغط المقطع بصيغة H.264 عبر FFmpeg...")
    cmd = [
        FFMPEG_BIN,
        "-y",
        "-i",
        str(tmp_raw),
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
        str(out_path),
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if tmp_raw.exists():
        tmp_raw.unlink(missing_ok=True)
    if proc.returncode != 0 or not out_path.exists():
        raise RuntimeError(f"FFmpeg encode error: {(proc.stderr or '')[-300:]}")
    if progress_cb:
        progress_cb(1.0, "تم تجهيز المقطع الاحترافي ثلاثي الأبعاد بنجاح")
    return out_path
