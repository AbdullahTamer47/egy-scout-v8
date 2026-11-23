"""Real 32-Keypoint Pitch Homography Calibrator using yolo-football-pitch-detection.pt (FIFA 105x68m).

Replaces pixel-ratio heuristics on uploaded/custom videos with genuine RANSAC pitch landmark
homography using the exact Roboflow/Sports 32-keypoint SoccerPitchConfiguration geometry.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

from packages.shared_contracts.config import get_repo_root

PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0
PITCH_YOLO_REL = Path("egy-tactical-scout") / "backend" / "weights" / "yolo-football-pitch-detection.pt"

_PITCH_MODEL: Any = None


def _fifa_32_keypoints(length: float = PITCH_LENGTH_M, width: float = PITCH_WIDTH_M) -> np.ndarray:
    """32 pitch keypoints in exact roboflow/sports SoccerPitchConfiguration order (105x68m)."""
    pb_w, pb_l, gb_w, gb_l, cr, ps = 40.32, 16.5, 18.32, 5.5, 9.15, 11.0
    l_half, w_half = length / 2.0, width / 2.0
    return np.array(
        [
            (0.0, 0.0),
            (0.0, (width - pb_w) / 2.0),
            (0.0, (width - gb_w) / 2.0),
            (0.0, (width + gb_w) / 2.0),
            (0.0, (width + pb_w) / 2.0),
            (0.0, width),
            (gb_l, (width - gb_w) / 2.0),
            (gb_l, (width + gb_w) / 2.0),
            (ps, w_half),
            (pb_l, (width - pb_w) / 2.0),
            (pb_l, (width - gb_w) / 2.0),
            (pb_l, (width + gb_w) / 2.0),
            (pb_l, (width + pb_w) / 2.0),
            (l_half, 0.0),
            (l_half, w_half - cr),
            (l_half, w_half + cr),
            (l_half, width),
            (length - pb_l, (width - pb_w) / 2.0),
            (length - pb_l, (width - gb_w) / 2.0),
            (length - pb_l, (width + gb_w) / 2.0),
            (length - pb_l, (width + pb_w) / 2.0),
            (length - ps, w_half),
            (length - gb_l, (width - gb_w) / 2.0),
            (length - gb_l, (width + gb_w) / 2.0),
            (length, 0.0),
            (length, (width - pb_w) / 2.0),
            (length, (width - gb_w) / 2.0),
            (length, (width + gb_w) / 2.0),
            (length, (width + pb_w) / 2.0),
            (length, width),
            (l_half - cr, w_half),
            (l_half + cr, w_half),
        ],
        dtype=np.float32,
    )


FIFA_KEYPOINTS = _fifa_32_keypoints()


def get_pitch_keypoint_model() -> Any:
    """Lazy-load the 32-keypoint football pitch pose model."""
    global _PITCH_MODEL
    if _PITCH_MODEL is not None:
        return _PITCH_MODEL
    weights = get_repo_root() / PITCH_YOLO_REL
    if not weights.is_file():
        return None
    from ultralytics import YOLO

    _PITCH_MODEL = YOLO(str(weights))
    return _PITCH_MODEL


class KeypointPitchCalibrator:
    """Temporal RANSAC homography estimator with smooth blending & shot-cut reset."""

    def __init__(
        self,
        pitch_length_m: float = PITCH_LENGTH_M,
        pitch_width_m: float = PITCH_WIDTH_M,
        conf: float = 0.45,
        imgsz: int = 640,
        max_err_m: float = 2.4,
        alpha: float = 0.4,
    ):
        self.pitch_length_m = float(pitch_length_m)
        self.pitch_width_m = float(pitch_width_m)
        self.vertices = _fifa_32_keypoints(self.pitch_length_m, self.pitch_width_m)
        self.conf = float(conf)
        self.imgsz = int(imgsz)
        self.max_err_m = float(max_err_m)
        self.alpha = float(alpha)
        self.model = get_pitch_keypoint_model()
        self.H: Optional[np.ndarray] = None
        self.last_kp_count: int = 0
        self.last_err_m: float = float("nan")
        self.frames_since_calib: int = 999

    @property
    def available(self) -> bool:
        return self.model is not None

    def reset(self) -> None:
        self.H = None
        self.frames_since_calib = 999

    def detect(self, frame_bgr: np.ndarray) -> tuple[Optional[np.ndarray], int, float]:
        if self.model is None or frame_bgr is None or frame_bgr.size == 0:
            return None, 0, float("nan")
        try:
            res = self.model.predict(frame_bgr, verbose=False, conf=0.25, imgsz=self.imgsz)[0]
        except Exception:
            return None, 0, float("nan")
        if res.keypoints is None or len(res.keypoints) == 0 or res.keypoints.conf is None:
            return None, 0, float("nan")
        xy = res.keypoints.xy.cpu().numpy()[0]
        cf = res.keypoints.conf.cpu().numpy()[0]
        if len(xy) != len(self.vertices):
            return None, 0, float("nan")
        mask = cf > self.conf
        n = int(mask.sum())
        if n < 4:
            return None, n, float("nan")
        src = xy[mask].astype(np.float32)
        dst = self.vertices[mask]
        if np.linalg.matrix_rank(np.c_[dst, np.ones(len(dst))], tol=1.0) < 3:
            return None, n, float("nan")
        H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 2.0)
        if H is None or inl is None or int(inl.sum()) < 4:
            return None, n, float("nan")
        keep = inl.reshape(-1).astype(bool)
        proj = cv2.perspectiveTransform(src[keep].reshape(-1, 1, 2), H).reshape(-1, 2)
        err = float(np.mean(np.linalg.norm(proj - dst[keep], axis=1)))
        if not np.isfinite(err) or err > self.max_err_m:
            return None, n, err
        h, w = frame_bgr.shape[:2]
        bc = cv2.perspectiveTransform(np.array([[[w * 0.5, h * 0.92]]], dtype=np.float32), H).reshape(2)
        if not (-28.0 <= bc[0] <= self.pitch_length_m + 28.0 and -28.0 <= bc[1] <= self.pitch_width_m + 28.0):
            return None, n, err
        return (H / H[2, 2]).astype(np.float64), int(keep.sum()), err

    def update(self, frame_bgr: np.ndarray, max_hold_frames: int = 8) -> bool:
        H_new, n, err = self.detect(frame_bgr)
        self.last_kp_count = n
        self.last_err_m = err
        if H_new is None:
            self.frames_since_calib += 1
            if self.frames_since_calib > max_hold_frames:
                self.H = None
            return self.H is not None
        self.frames_since_calib = 0
        if self.H is None:
            self.H = H_new
        else:
            h, w = frame_bgr.shape[:2]
            grid = np.array(
                [[w * 0.1, h * 0.35], [w * 0.9, h * 0.35], [w * 0.95, h * 0.95], [w * 0.05, h * 0.95]],
                dtype=np.float32,
            )
            p_old = cv2.perspectiveTransform(grid.reshape(-1, 1, 2), self.H).reshape(-1, 2)
            p_new = cv2.perspectiveTransform(grid.reshape(-1, 1, 2), H_new).reshape(-1, 2)
            if float(np.max(np.linalg.norm(p_new - p_old, axis=1))) > 12.0:
                self.H = H_new
            else:
                blended = ((1.0 - self.alpha) * p_old + self.alpha * p_new).astype(np.float32)
                self.H = cv2.getPerspectiveTransform(grid, blended).astype(np.float64)
        return True

    def project_point(self, u: float, v: float) -> Optional[tuple[float, float]]:
        if self.H is None:
            return None
        pt = np.array([[[float(u), float(v)]]], dtype=np.float32)
        out = cv2.perspectiveTransform(pt, self.H).reshape(2)
        x_m, y_m = float(out[0]), float(out[1])
        if not (np.isfinite(x_m) and np.isfinite(y_m)):
            return None
        if -12.0 <= x_m <= self.pitch_length_m + 12.0 and -12.0 <= y_m <= self.pitch_width_m + 12.0:
            return round(x_m, 2), round(y_m, 2)
        return None
