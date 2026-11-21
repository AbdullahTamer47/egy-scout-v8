"""YOLO11 + Ultralytics BYTETracker + AutoPitchHomography football detection & tracking."""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pandas as pd
from ultralytics import YOLO
from ultralytics.trackers.byte_tracker import BYTETracker

from core.config import get_settings
from engine.homography import AutoPitchHomography, CameraMotionEstimator, KeypointPitchHomography
from engine.team_classifier import JerseyOCR, analyze_frame_grass, is_foot_on_pitch, jersey_crop, kit_feature


def _resolve_weights(weights_path: str) -> str:
    p = Path(weights_path)
    if not p.is_absolute():
        candidate = Path(__file__).resolve().parents[1] / weights_path
        if candidate.exists():
            return str(candidate)
    return weights_path


class _TrackableBoxes:
    """Lightweight adapter satisfying ultralytics BYTETracker `update(results, img)` contract."""

    def __init__(self, xywh: np.ndarray, conf: np.ndarray, cls: np.ndarray):
        self.xywh = xywh.astype(np.float32)
        self.conf = conf.astype(np.float32)
        self.cls = cls.astype(np.float32)

    def __len__(self) -> int:
        return len(self.conf)

    def __getitem__(self, item):  # noqa: ANN001, ANN204
        return _TrackableBoxes(self.xywh[item], self.conf[item], self.cls[item])


class FootballDetector:
    """Detects players, goalkeepers, referees, and footballs via YOLO11."""

    def __init__(self, weights: str | None = None, conf: float = 0.25, imgsz: int = 640):
        settings = get_settings()
        weights_path = weights or settings.detector_weights
        p = Path(weights_path)
        if not p.is_absolute():
            candidate = Path(__file__).resolve().parents[1] / weights_path
            if candidate.exists():
                weights_path = str(candidate)
        self.model = YOLO(weights_path)
        self.conf = conf
        self.imgsz = imgsz

        names = {int(k): str(v).lower() for k, v in (self.model.names or {}).items()}
        self.class_to_role: dict[int, str] = {}
        for cid, cname in names.items():
            if "ball" in cname:
                self.class_to_role[cid] = "ball"
            elif "goal" in cname or cname == "gk":
                self.class_to_role[cid] = "goalkeeper"
            elif "ref" in cname:
                self.class_to_role[cid] = "referee"
            elif "person" in cname or "player" in cname:
                self.class_to_role[cid] = "player"
        if not self.class_to_role:
            self.class_to_role = {0: "player", 32: "ball"}

    def predict(self, frame: np.ndarray):  # noqa: ANN201
        return self.model.predict(
            frame,
            conf=min(0.15, self.conf),
            imgsz=self.imgsz,
            verbose=False,
            classes=list(self.class_to_role.keys()),
        )[0]


def run_tracking(
    video_path: str | Path,
    keyframes_dir: Path | None = None,
    progress_cb: Callable[[float, str], None] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Track all wide-camera frames with YOLO11 + BYTETracker + AutoPitchHomography."""
    settings = get_settings()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video for tracking: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or settings.target_fps or 25.0
    if fps <= 1.0 or fps > 120.0:
        fps = 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
    stride = max(1, int(settings.frame_stride))

    detector = FootballDetector(settings.detector_weights, settings.detector_conf, settings.detector_imgsz)
    bt_args = SimpleNamespace(
        track_high_thresh=0.32,
        track_low_thresh=0.10,
        new_track_thresh=0.40,
        track_buffer=max(15, int(round(2.5 * fps / stride))),
        match_thresh=0.80,
        fuse_score=True,
    )
    tracker = BYTETracker(bt_args)

    auto_homog = AutoPitchHomography()
    cam_motion = CameraMotionEstimator()
    kp_homog = None
    kp_path = _resolve_weights(settings.pitch_keypoint_weights) if settings.pitch_keypoint_weights else None
    if kp_path and Path(kp_path).exists():
        kp_homog = KeypointPitchHomography(kp_path, conf=settings.keypoint_conf)
    kp_every = max(1, int(settings.keypoint_every_n))
    kp_hold = max(kp_every * 4, int(round(3.0 * fps / stride)))
    last_kp_frame = -10**9
    ocr = JerseyOCR(gpu=False) if settings.ocr_enabled else None

    detections_rows: list[dict] = []
    camera_rows: list[dict] = []

    frame_idx = 0
    cut_id = 0
    prev_wide = False
    processed = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            if frame_idx % stride == 0:
                fh, fw = frame.shape[:2]
                width, height = fw, fh
                time_s = frame_idx / fps

                g_info = analyze_frame_grass(frame)
                g_ratio = g_info["grass_ratio"]
                # Accept wide stadium broadcast + close tactical shots seamlessly; treat extreme non-pitch closeups as non-wide
                is_wide = g_ratio >= 0.16
                if not is_wide and prev_wide:
                    cut_id += 1
                    auto_homog.reset()
                    cam_motion.reset()
                prev_wide = is_wide

                res = detector.predict(frame)
                boxes_xyxy = np.empty((0, 4), dtype=np.float32)
                confs = np.empty((0,), dtype=np.float32)
                clss = np.empty((0,), dtype=np.int32)
                if res.boxes is not None and len(res.boxes) > 0:
                    boxes_xyxy = res.boxes.xyxy.cpu().numpy().astype(np.float32)
                    confs = res.boxes.conf.cpu().numpy().astype(np.float32)
                    clss = res.boxes.cls.cpu().numpy().astype(np.int32)

                roles = [detector.class_to_role.get(int(c), "player") for c in clss]
                person_idx = [i for i, r in enumerate(roles) if r != "ball" and confs[i] >= settings.detector_conf]
                ball_idx = [i for i, r in enumerate(roles) if r == "ball" and confs[i] >= 0.06]

                person_boxes = boxes_xyxy[person_idx] if person_idx else np.empty((0, 4), dtype=np.float32)
                dx, dy = cam_motion.update(frame, person_boxes if len(person_boxes) > 0 else None)

                # Real pitch calibration (open-source 32-keypoint model) with trapezoid only as last resort
                h_src = "trapezoid"
                if kp_homog is not None:
                    if not is_wide:
                        kp_homog.reset()
                    else:
                        kp_homog.propagate(dx, dy)
                        if processed % kp_every == 0 and kp_homog.update(frame):
                            last_kp_frame = processed
                        if kp_homog.H is not None and processed - last_kp_frame > kp_hold:
                            kp_homog.reset()
                if kp_homog is not None and kp_homog.H is not None:
                    H_mat = kp_homog.H.copy()
                    H_inv_norm = kp_homog.inverse_normalized(fw, fh)
                    h_src = "keypoints"
                    auto_homog.estimate_frame_homography(frame, cam_dx=dx)
                else:
                    H_mat, _ = auto_homog.estimate_frame_homography(frame, cam_dx=dx)
                    H_inv_norm = auto_homog.normalized_inverse_homography(fw, fh)

                cam_row = {
                    "frame_id": frame_idx,
                    "time_s": round(time_s, 3),
                    "is_wide": bool(is_wide),
                    "grass_ratio": round(g_ratio, 4),
                    "cut_id": cut_id,
                    "cam_dx": round(dx, 3),
                    "cam_dy": round(dy, 3),
                    "h_src": h_src,
                    "kp_count": int(kp_homog.last_kp_count) if kp_homog is not None else 0,
                }
                for i, val in enumerate(H_mat.reshape(-1)):
                    cam_row[f"ah{i}"] = float(val)
                for i, val in enumerate(H_inv_norm.reshape(-1)):
                    cam_row[f"hi{i}"] = float(val)
                camera_rows.append(cam_row)

                if keyframes_dir is not None and (frame_idx % max(stride, int(round(fps * 5))) == 0 or processed == 0):
                    kf_path = keyframes_dir / f"frame_{frame_idx:06d}.jpg"
                    if not kf_path.exists():
                        cv2.imwrite(str(kf_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])

                # Track persons with BYTETracker
                if len(person_idx) > 0:
                    p_xyxy = boxes_xyxy[person_idx]
                    p_conf = confs[person_idx]
                    p_cls = clss[person_idx]
                    cx = 0.5 * (p_xyxy[:, 0] + p_xyxy[:, 2])
                    cy = 0.5 * (p_xyxy[:, 1] + p_xyxy[:, 3])
                    bw = p_xyxy[:, 2] - p_xyxy[:, 0]
                    bh = p_xyxy[:, 3] - p_xyxy[:, 1]
                    p_xywh = np.stack([cx, cy, bw, bh], axis=1)

                    tracked = tracker.update(_TrackableBoxes(p_xywh, p_conf, p_cls), frame)
                    if tracked is not None and len(tracked) > 0:
                        do_ocr = ocr is not None and (frame_idx % max(1, settings.ocr_every_n_frames) == 0)
                        for row in tracked:
                            x1, y1, x2, y2, tid, score, cid = row[:7]
                            x1_i = float(max(0.0, x1))
                            y1_i = float(max(0.0, y1))
                            x2_i = float(min(float(fw), x2))
                            y2_i = float(min(float(fh), y2))
                            if x2_i - x1_i < 6 or y2_i - y1_i < 12:
                                continue

                            u = 0.5 * (x1_i + x2_i)
                            v = y2_i
                            role = detector.class_to_role.get(int(cid), "player")
                            box_arr = np.array([x1_i, y1_i, x2_i, y2_i], dtype=np.float32)
                            u_n = u / max(1, fw)
                            v_n = v / max(1, fh)
                            bh_r = (y2_i - y1_i) / max(1, fh)
                            on_g = is_foot_on_pitch(g_info, u_n, v_n, bh_r) and (g_ratio >= 0.16)
                            crop = jersey_crop(frame, box_arr)
                            feat = kit_feature(crop, grass_hsv=(g_info["g_h_med"], g_info["g_s_med"])) if crop is not None else None
                            if feat is None or len(feat) != 11:
                                feat = np.full(11, np.nan, dtype=np.float32)

                            jersey_num = None
                            jersey_conf = 0.0
                            if do_ocr and role in ("player", "goalkeeper"):
                                try:
                                    ocr_res = ocr.read(frame, box_arr)
                                    if ocr_res is not None:
                                        jersey_num, jersey_conf = ocr_res
                                except Exception:
                                    jersey_num, jersey_conf = None, 0.0

                            det_row = {
                                "frame_id": frame_idx,
                                "time_s": round(time_s, 3),
                                "track_id": int(tid),
                                "role": role,
                                "x1": round(x1_i, 2),
                                "y1": round(y1_i, 2),
                                "x2": round(x2_i, 2),
                                "y2": round(y2_i, 2),
                                "u": round(u, 2),
                                "v": round(v, 2),
                                "u_norm": round(u_n, 5),
                                "v_norm": round(v_n, 5),
                                "conf": round(float(score), 4),
                                "on_grass": bool(on_g),
                                "grass_ratio": round(g_ratio, 4),
                                "ocr_jersey": int(jersey_num) if jersey_num is not None else -1,
                                "ocr_conf": round(float(jersey_conf), 3),
                            }
                            for ki in range(11):
                                det_row[f"kf{ki}"] = float(feat[ki]) if np.isfinite(feat[ki]) else float("nan")
                            detections_rows.append(det_row)

                # Highest-confidence ball detection per frame
                if ball_idx:
                    b_best = max(ball_idx, key=lambda idx: float(confs[idx]))
                    bx1, by1, bx2, by2 = boxes_xyxy[b_best]
                    bu = 0.5 * float(bx1 + bx2)
                    bv = 0.5 * float(by1 + by2)
                    ball_row = {
                        "frame_id": frame_idx,
                        "time_s": round(time_s, 3),
                        "track_id": -1,
                        "role": "ball",
                        "x1": round(float(bx1), 2),
                        "y1": round(float(by1), 2),
                        "x2": round(float(bx2), 2),
                        "y2": round(float(by2), 2),
                        "u": round(bu, 2),
                        "v": round(bv, 2),
                        "u_norm": round(bu / max(1, fw), 5),
                        "v_norm": round(bv / max(1, fh), 5),
                        "conf": round(float(confs[b_best]), 4),
                        "ocr_jersey": -1,
                        "ocr_conf": 0.0,
                    }
                    for ki in range(11):
                        ball_row[f"kf{ki}"] = float("nan")
                    detections_rows.append(ball_row)

                processed += 1
                if progress_cb and (processed % 15 == 0):
                    pct = (frame_idx / max(1, total_frames)) if total_frames > 0 else min(0.95, processed / 1000.0)
                    progress_cb(min(0.98, pct), f"تتبع الأجسام وحساب الإسقاط الآلي للملعب: فريم {frame_idx}/{total_frames or '?'}")

            frame_idx += 1
    finally:
        cap.release()

    df_raw = pd.DataFrame(detections_rows)
    df_cam = pd.DataFrame(camera_rows)
    meta = {
        "fps": float(fps),
        "width": int(width),
        "height": int(height),
        "frame_count": int(frame_idx),
        "duration_s": round(frame_idx / float(fps), 2),
        "processed_frames": int(processed),
        "stride": int(stride),
    }
    if progress_cb:
        progress_cb(1.0, "اكتمل التتبع الآلي والإسقاط الهندسي بنجاح")
    return df_raw, df_cam, meta
