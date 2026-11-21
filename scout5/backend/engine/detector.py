"""Football-specific YOLO detection + BYTETracker + BallTracker + shot-aware PnLCalib calibration."""
from __future__ import annotations

from collections import deque
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pandas as pd
from ultralytics import YOLO
from ultralytics.trackers.byte_tracker import BYTETracker

from engine.camera import CameraMotion
from engine.pitch import PITCH_L, PITCH_W, PnLPitchCalibrator, to_metres
from engine.teams import estimate_grass_hsv, kit_descriptor

DEFAULT_PLAYER_WEIGHTS = Path(r"D:\مدرب\egy-tactical-scout\backend\weights\yolo-football-player-detection.pt")


class _TrackableBoxes:
    """Adapter for ultralytics BYTETracker.update(results, img)."""

    def __init__(self, xywh: np.ndarray, conf: np.ndarray, cls: np.ndarray) -> None:
        self.xywh = xywh.astype(np.float32)
        self.conf = conf.astype(np.float32)
        self.cls = cls.astype(np.float32)

    def __len__(self) -> int:
        return len(self.conf)

    def __getitem__(self, item):  # noqa: ANN001, ANN204
        return _TrackableBoxes(self.xywh[item], self.conf[item], self.cls[item])


class BallFilter:
    """Roboflow/sports centroid-proximity ball candidate selector."""

    def __init__(self, maxlen: int = 10, max_jump_norm: float = 0.14) -> None:
        self.history: deque[np.ndarray] = deque(maxlen=maxlen)
        self.max_jump_norm = max_jump_norm

    def reset(self) -> None:
        self.history.clear()

    def pick(self, candidates_xyxy: np.ndarray, confs: np.ndarray, fw: int, fh: int) -> tuple[np.ndarray, float] | None:
        if len(candidates_xyxy) == 0:
            return None
        centers = np.column_stack([
            0.5 * (candidates_xyxy[:, 0] + candidates_xyxy[:, 2]),
            0.5 * (candidates_xyxy[:, 1] + candidates_xyxy[:, 3]),
        ])
        if not self.history:
            best = int(np.argmax(confs))
            self.history.append(centers[best])
            return candidates_xyxy[best], float(confs[best])

        centroid = np.mean(np.stack(list(self.history), axis=0), axis=0)
        dists = np.linalg.norm(centers - centroid, axis=1)
        diag = float(np.hypot(fw, fh))
        valid = np.where(dists <= self.max_jump_norm * diag)[0]
        if len(valid) > 0:
            best = int(valid[np.argmin(dists[valid])])
        elif float(np.max(confs)) >= 0.35:
            # High-confidence reset after occlusion / kick
            best = int(np.argmax(confs))
            self.history.clear()
        else:
            return None
        self.history.append(centers[best])
        return candidates_xyxy[best], float(confs[best])


def _new_bytetracker(fps: float, stride: int) -> BYTETracker:
    args = SimpleNamespace(
        track_high_thresh=0.32,
        track_low_thresh=0.10,
        new_track_thresh=0.40,
        track_buffer=max(15, int(round(2.2 * fps / max(1, stride)))),
        match_thresh=0.80,
        fuse_score=True,
    )
    return BYTETracker(args)


def _solve_shot_calibrations(
    video_path: Path,
    frame_meta: list[dict],
    calibrator: PnLPitchCalibrator,
    pnl_interval: int = 12,
    progress_cb: Callable[[float, str], None] | None = None,
) -> None:
    """Run PnLCalib on wide-shot keyframes and propagate H forward/backward within each shot."""
    n = len(frame_meta)
    if n == 0:
        return

    # Group continuous wide frames by shot_id
    shots: dict[int, list[int]] = {}
    for pos, row in enumerate(frame_meta):
        if row["is_wide"] and row["person_count"] >= 4:
            shots.setdefault(row["shot_id"], []).append(pos)

    # Plan primary keyframes inside each wide shot
    planned_targets: set[int] = set()
    shot_anchors: dict[int, list[int]] = {}
    for sid, positions in shots.items():
        if len(positions) < 2:
            continue
        anchors: list[int] = []
        offset = min(2, len(positions) // 3)
        for p_idx in range(offset, len(positions), max(4, pnl_interval)):
            pos = positions[p_idx]
            anchors.append(pos)
            planned_targets.add(frame_meta[pos]["frame_id"])
            # Also schedule an immediate +3 fallback fid in case primary keyframe hits motion blur
            fb_p = min(len(positions) - 1, p_idx + 3)
            planned_targets.add(frame_meta[positions[fb_p]]["frame_id"])
        shot_anchors[sid] = anchors

    if not planned_targets:
        return

    # Sequential exact frame grab pass (zero RAM bloat, no H.264 seek jitter)
    needed_fids = set(planned_targets)
    grabbed_frames: dict[int, np.ndarray] = {}
    max_fid = max(needed_fids)
    cap = cv2.VideoCapture(str(video_path))
    try:
        cur = 0
        while cur <= max_fid:
            if not cap.grab():
                break
            if cur in needed_fids:
                ok, fr = cap.retrieve()
                if ok and fr is not None:
                    grabbed_frames[cur] = fr
            cur += 1
    finally:
        cap.release()

    # Solve PnLCalib per shot on planned anchors (with immediate +3 fallback only if primary fails)
    solved_pos: dict[int, dict] = {}
    total_kfs = max(1, sum(len(v) for v in shot_anchors.values()))
    done_kfs = 0
    for sid, positions in shot_anchors.items():
        pos_to_list_idx = {p: i for i, p in enumerate(positions)}
        for anchor in shot_anchors[sid]:
            fid = frame_meta[anchor]["frame_id"]
            fr = grabbed_frames.get(fid)
            res = calibrator.solve_frame(fr) if fr is not None else {"H": None}
            used_pos = anchor
            if res["H"] is None:
                l_idx = pos_to_list_idx[anchor]
                fb_pos = positions[min(len(positions) - 1, l_idx + 3)]
                if fb_pos != anchor:
                    fb_fr = grabbed_frames.get(frame_meta[fb_pos]["frame_id"])
                    if fb_fr is not None:
                        res_fb = calibrator.solve_frame(fb_fr)
                        if res_fb["H"] is not None:
                            res = res_fb
                            used_pos = fb_pos
            if res["H"] is not None:
                solved_pos[used_pos] = res
                frame_meta[used_pos]["H"] = res["H"]
                frame_meta[used_pos]["P"] = res["P"]
                frame_meta[used_pos]["cal_src"] = "keypoints"
                frame_meta[used_pos]["cal_err_px"] = res["rep_err"]
                frame_meta[used_pos]["kp_count"] = res["kp_count"]
                frame_meta[used_pos]["line_count"] = res["line_count"]
                frame_meta[used_pos]["kf_dist"] = 0
            done_kfs += 1
            if progress_cb:
                progress_cb(0.55 + 0.40 * (done_kfs / total_kfs), f"معايرة خطوط ونقاط الملعب (PnLCalib): {done_kfs}/{total_kfs}")

    # Bidirectional LK homography propagation within each shot from nearest solved keyframe
    max_prop_steps = max(8, pnl_interval + 4)
    for sid, positions in shots.items():
        # Forward pass
        H_cur = None
        dist = 10**9
        for pos in positions:
            row = frame_meta[pos]
            if row["cal_src"] == "keypoints":
                H_cur = row["H"]
                dist = 0
                continue
            if H_cur is not None and dist < max_prop_steps and row["cam_reliable"] and row["H_step"] is not None:
                H_next = calibrator.propagate(H_cur, row["H_step"], row["width"], row["height"])
                if H_next is not None:
                    H_cur = H_next
                    dist += 1
                    row["H"] = H_cur
                    row["cal_src"] = "propagated"
                    row["kf_dist"] = dist
                else:
                    H_cur = None
            else:
                H_cur = None

        # Backward pass (recovers frames near shot start, keeping closer keyframe)
        H_cur = None
        dist = 10**9
        for idx_rev in range(len(positions) - 1, -1, -1):
            pos = positions[idx_rev]
            row = frame_meta[pos]
            if row["cal_src"] == "keypoints":
                H_cur = row["H"]
                dist = 0
                continue
            if H_cur is None or dist >= max_prop_steps:
                H_cur = None
                continue
            # Move backwards from pos+1 (if adjacent inside same shot) using inv(H_step of pos+1)
            next_pos = positions[idx_rev + 1]
            if next_pos != pos + 1:
                H_cur = None
                continue
            next_row = frame_meta[next_pos]
            if not next_row["cam_reliable"] or next_row["H_step"] is None:
                H_cur = None
                continue
            try:
                H_inv_step = np.linalg.inv(next_row["H_step"])
            except np.linalg.LinAlgError:
                H_cur = None
                continue
            H_prev = calibrator.propagate(H_cur, H_inv_step, row["width"], row["height"])
            if H_prev is None:
                H_cur = None
                continue
            H_cur = H_prev
            dist += 1
            if row["cal_src"] == "none" or dist < row["kf_dist"]:
                row["H"] = H_cur
                row["cal_src"] = "propagated"
                row["kf_dist"] = dist


def track_and_calibrate_video(
    video_path: str | Path,
    stride: int = 2,
    imgsz: int = 960,
    pnl_interval: int = 12,
    max_frames: int | None = None,
    start_frame: int = 0,
    weights_path: Path = DEFAULT_PLAYER_WEIGHTS,
    progress_cb: Callable[[float, str], None] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Run football detection + ByteTrack + PnLCalib calibration cleanly without fake geometry."""
    vp = Path(video_path)
    cap = cv2.VideoCapture(str(vp))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {vp}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    if fps <= 1.0 or fps > 120.0:
        fps = 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if max_frames and max_frames > 0:
        total_frames = min(total_frames, max_frames) if total_frames > 0 else max_frames
    fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)

    model = YOLO(str(weights_path))
    names = {int(k): str(v).lower() for k, v in (model.names or {}).items()}
    ball_cids = {k for k, v in names.items() if "ball" in v}

    tracker = _new_bytetracker(fps, stride)
    ball_filter = BallFilter()
    cam_motion = CameraMotion()

    frame_meta: list[dict] = []
    det_rows: list[dict] = []

    frame_idx = 0
    shot_id = 0
    prev_wide = False

    try:
        while frame_idx < start_frame:
            if not cap.grab():
                break
            frame_idx += 1

        while True:
            if max_frames and frame_idx >= max_frames:
                break
            ok, frame = cap.read()
            if not ok or frame is None:
                break

            if (frame_idx - start_frame) % stride == 0:
                fh, fw = frame.shape[:2]
                time_s = frame_idx / fps
                g_ratio, g_h, g_s = estimate_grass_hsv(frame)
                is_wide = g_ratio >= 0.16

                res = model.predict(frame, verbose=False, conf=0.08, imgsz=imgsz)[0]
                xyxy = np.empty((0, 4), np.float32)
                confs = np.empty((0,), np.float32)
                clss = np.empty((0,), np.int32)
                if res.boxes is not None and len(res.boxes) > 0:
                    xyxy = res.boxes.xyxy.cpu().numpy().astype(np.float32)
                    confs = res.boxes.conf.cpu().numpy().astype(np.float32)
                    clss = res.boxes.cls.cpu().numpy().astype(np.int32)

                p_mask = np.array([(c not in ball_cids) and (cf >= 0.25) for c, cf in zip(clss, confs)], dtype=bool)
                b_mask = np.array([(c in ball_cids) and (cf >= 0.08) for c, cf in zip(clss, confs)], dtype=bool)
                p_boxes = xyxy[p_mask]

                cam_info = cam_motion.update(frame, p_boxes if len(p_boxes) > 0 else None)
                if len(frame_meta) > 0 and (cam_info["is_cut"] or is_wide != prev_wide):
                    shot_id += 1
                    tracker = _new_bytetracker(fps, stride)
                    ball_filter.reset()
                prev_wide = is_wide

                # Track persons with BYTETracker
                if len(p_boxes) > 0:
                    p_conf = confs[p_mask]
                    p_cls = clss[p_mask]
                    cx = 0.5 * (p_boxes[:, 0] + p_boxes[:, 2])
                    cy = 0.5 * (p_boxes[:, 1] + p_boxes[:, 3])
                    bw = p_boxes[:, 2] - p_boxes[:, 0]
                    bh = p_boxes[:, 3] - p_boxes[:, 1]
                    tracked = tracker.update(_TrackableBoxes(np.stack([cx, cy, bw, bh], axis=1), p_conf, p_cls), frame)
                    if tracked is not None and len(tracked) > 0:
                        for row in tracked:
                            x1, y1, x2, y2, tid, score, cid = row[:7]
                            x1_i = float(max(0.0, x1))
                            y1_i = float(max(0.0, y1))
                            x2_i = float(min(float(fw), x2))
                            y2_i = float(min(float(fh), y2))
                            if x2_i - x1_i < 5 or y2_i - y1_i < 10:
                                continue
                            role = names.get(int(cid), "player")
                            u_px, v_px = 0.5 * (x1_i + x2_i), y2_i
                            feat = (
                                kit_descriptor(frame, np.array([x1_i, y1_i, x2_i, y2_i]), (g_h, g_s))
                                if (is_wide and role == "player")
                                else None
                            )
                            det = {
                                "frame_id": frame_idx,
                                "time_s": round(time_s, 3),
                                "shot_id": shot_id,
                                "track_id": int(tid),
                                "role": role,
                                "x1": round(x1_i, 2),
                                "y1": round(y1_i, 2),
                                "x2": round(x2_i, 2),
                                "y2": round(y2_i, 2),
                                "u": round(u_px, 2),
                                "v": round(v_px, 2),
                                "u_norm": round(u_px / max(1, fw), 5),
                                "v_norm": round(v_px / max(1, fh), 5),
                                "bh_norm": round((y2_i - y1_i) / max(1, fh), 5),
                                "conf": round(float(score), 4),
                            }
                            for ki in range(11):
                                det[f"kf{ki}"] = float(feat[ki]) if (feat is not None and np.isfinite(feat[ki])) else float("nan")
                            det_rows.append(det)

                # Track ball with BallFilter
                if np.any(b_mask):
                    picked = ball_filter.pick(xyxy[b_mask], confs[b_mask], fw, fh)
                    if picked is not None:
                        b_box, b_conf = picked
                        bx1, by1, bx2, by2 = [float(v) for v in b_box]
                        bu, bv = 0.5 * (bx1 + bx2), 0.5 * (by1 + by2)
                        bdet = {
                            "frame_id": frame_idx,
                            "time_s": round(time_s, 3),
                            "shot_id": shot_id,
                            "track_id": -1,
                            "role": "ball",
                            "x1": round(bx1, 2),
                            "y1": round(by1, 2),
                            "x2": round(bx2, 2),
                            "y2": round(by2, 2),
                            "u": round(bu, 2),
                            "v": round(bv, 2),
                            "u_norm": round(bu / max(1, fw), 5),
                            "v_norm": round(bv / max(1, fh), 5),
                            "bh_norm": round((by2 - by1) / max(1, fh), 5),
                            "conf": round(b_conf, 4),
                        }
                        for ki in range(11):
                            bdet[f"kf{ki}"] = float("nan")
                        det_rows.append(bdet)

                frame_meta.append(
                    {
                        "frame_id": frame_idx,
                        "time_s": round(time_s, 3),
                        "shot_id": shot_id,
                        "width": fw,
                        "height": fh,
                        "is_wide": bool(is_wide),
                        "grass_ratio": round(g_ratio, 4),
                        "person_count": int(len(p_boxes)),
                        "cam_reliable": bool(cam_info["reliable"]),
                        "cam_inliers": int(cam_info["inliers"]),
                        "H_step": cam_info["H_step"],
                        "H": None,
                        "P": None,
                        "cal_src": "none",
                        "cal_err_px": float("nan"),
                        "kp_count": 0,
                        "line_count": 0,
                        "kf_dist": 10**9,
                    }
                )
                if progress_cb and len(frame_meta) % 15 == 0:
                    pct = (frame_idx / max(1, total_frames)) if total_frames > 0 else 0.5
                    progress_cb(0.05 + 0.50 * min(1.0, pct), f"تتبع اللاعبين والكرة: فريم {frame_idx}/{total_frames or '?'}")

            frame_idx += 1
    finally:
        cap.release()

    # Phase B: Shot-aware PnLCalib calibration + LK propagation
    calibrator = PnLPitchCalibrator()
    _solve_shot_calibrations(vp, frame_meta, calibrator, pnl_interval=pnl_interval, progress_cb=progress_cb)

    # Project detections into FIFA metres ONLY on calibrated frames
    H_by_fid = {r["frame_id"]: r["H"] for r in frame_meta}
    cal_by_fid = {r["frame_id"]: (r["cal_src"], r["cal_err_px"], r["kp_count"]) for r in frame_meta}

    df_dets = pd.DataFrame(det_rows)
    if not df_dets.empty:
        x_m = np.full(len(df_dets), np.nan, dtype=np.float64)
        y_m = np.full(len(df_dets), np.nan, dtype=np.float64)
        cal_srcs = []
        for idx, fid in enumerate(df_dets["frame_id"].tolist()):
            c_src = cal_by_fid.get(int(fid), ("none", float("nan"), 0))[0]
            cal_srcs.append(c_src)
        df_dets["cal_src"] = cal_srcs

        for fid, idxs in df_dets.groupby("frame_id").groups.items():
            H = H_by_fid.get(int(fid))
            if H is None:
                continue
            pos_idxs = list(idxs)
            uv = df_dets.loc[pos_idxs, ["u", "v"]].to_numpy(dtype=np.float32)
            xy_m = to_metres(H, uv)
            loc = df_dets.index.get_indexer(pos_idxs)
            x_m[loc] = xy_m[:, 0]
            y_m[loc] = xy_m[:, 1]
        df_dets["x_m"] = x_m
        df_dets["y_m"] = y_m

    # Flatten H into h0..h8 for compact parquet storage
    frame_rows = []
    for r in frame_meta:
        out_r = {
            "frame_id": r["frame_id"],
            "time_s": r["time_s"],
            "shot_id": r["shot_id"],
            "width": r["width"],
            "height": r["height"],
            "is_wide": r["is_wide"],
            "grass_ratio": r["grass_ratio"],
            "person_count": r["person_count"],
            "cam_reliable": r["cam_reliable"],
            "cal_src": r["cal_src"],
            "cal_err_px": r["cal_err_px"],
            "kp_count": r["kp_count"],
            "line_count": r["line_count"],
        }
        H = r["H"]
        for i in range(9):
            out_r[f"h{i}"] = float(H.reshape(-1)[i]) if H is not None else float("nan")
        frame_rows.append(out_r)

    df_frames = pd.DataFrame(frame_rows)
    meta = {
        "fps": fps,
        "width": fw,
        "height": fh,
        "total_video_frames": frame_idx,
        "processed_frames": len(df_frames),
        "stride": stride,
    }
    return df_frames, df_dets, meta
