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
    """Temporal RANSAC homography estimator with centered collinearity check & smooth blending."""

    def __init__(
        self,
        pitch_length_m: float = PITCH_LENGTH_M,
        pitch_width_m: float = PITCH_WIDTH_M,
        conf: float = 0.30,
        imgsz: int = 960,
        max_err_m: float = 3.2,
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
        self._prev_gray: Optional[np.ndarray] = None

    @property
    def available(self) -> bool:
        return self.model is not None

    def reset(self) -> None:
        self.H = None
        self.frames_since_calib = 999
        self._prev_gray = None

    def solve_homography_from_correspondences(
        self,
        src_px: np.ndarray,
        dst_m: np.ndarray,
        frame_shape: tuple[int, int] = (720, 1280),
    ) -> Optional[np.ndarray]:
        """Solve RANSAC pixel->meter homography with centered 2D non-collinearity validation."""
        if len(src_px) < 4 or len(dst_m) < 4:
            return None
        # Centered 2D SVD avoids the uncentered [x, y, 1] singular-value collapse near x=0 penalty boxes
        centered = dst_m.astype(np.float64) - np.mean(dst_m, axis=0, keepdims=True)
        sv = np.linalg.svd(centered, compute_uv=False)
        if len(sv) < 2 or float(sv[1]) < 1.2:
            return None

        H, inl = cv2.findHomography(
            src_px.astype(np.float32),
            dst_m.astype(np.float32),
            cv2.RANSAC,
            3.0,
        )
        if H is None or inl is None or int(inl.sum()) < 4 or abs(float(H[2, 2])) < 1e-9:
            return None
        keep = inl.reshape(-1).astype(bool)
        proj = cv2.perspectiveTransform(src_px[keep].reshape(-1, 1, 2).astype(np.float32), H).reshape(-1, 2)
        err = float(np.mean(np.linalg.norm(proj - dst_m[keep], axis=1)))
        if not np.isfinite(err) or err > self.max_err_m:
            return None
        h, w = int(frame_shape[0]), int(frame_shape[1])
        bc = cv2.perspectiveTransform(np.array([[[w * 0.5, h * 0.88]]], dtype=np.float32), H).reshape(2)
        if not (-35.0 <= bc[0] <= self.pitch_length_m + 35.0 and -35.0 <= bc[1] <= self.pitch_width_m + 35.0):
            return None
        self.last_err_m = err
        return (H / H[2, 2]).astype(np.float64)

    def detect(self, frame_bgr: np.ndarray) -> tuple[Optional[np.ndarray], int, float]:
        if self.model is None or frame_bgr is None or frame_bgr.size == 0:
            return None, 0, float("nan")
        try:
            res = self.model.predict(frame_bgr, verbose=False, conf=0.20, imgsz=self.imgsz)[0]
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
            # Try slightly softer keypoint confidence (0.22) if 3 strong + 1 moderate keypoint exist
            mask = cf > max(0.20, self.conf * 0.72)
            n = int(mask.sum())
            if n < 4:
                return None, n, float("nan")
        src = xy[mask].astype(np.float32)
        dst = self.vertices[mask]
        h, w = frame_bgr.shape[:2]
        H_solved = self.solve_homography_from_correspondences(src, dst, frame_shape=(h, w))
        if H_solved is None:
            return None, n, self.last_err_m
        return H_solved, n, self.last_err_m

    def _propagate_with_camera_motion(self, gray: np.ndarray) -> bool:
        """Propagate previous homography across brief camera pans using sparse Lucas-Kanade turf features."""
        if self.H is None or self._prev_gray is None or self._prev_gray.shape != gray.shape:
            return False
        pts0 = cv2.goodFeaturesToTrack(self._prev_gray, maxCorners=120, qualityLevel=0.02, minDistance=14)
        if pts0 is None or len(pts0) < 8:
            return False
        pts1, st, _ = cv2.calcOpticalFlowPyrLK(self._prev_gray, gray, pts0, None, winSize=(21, 21), maxLevel=3)
        if pts1 is None or st is None:
            return False
        good = st.reshape(-1) == 1
        if int(good.sum()) < 8:
            return False
        M_pix, inl = cv2.findHomography(pts1[good], pts0[good], cv2.RANSAC, 3.0)
        if M_pix is None or inl is None or int(inl.sum()) < 6:
            return False
        H_prop = self.H @ M_pix
        if abs(float(H_prop[2, 2])) < 1e-9:
            return False
        self.H = (H_prop / H_prop[2, 2]).astype(np.float64)
        return True

    def update(self, frame_bgr: np.ndarray, max_hold_frames: int = 12) -> bool:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
        H_new, n, err = self.detect(frame_bgr)
        self.last_kp_count = n
        self.last_err_m = err
        if H_new is None:
            self.frames_since_calib += 1
            if self.frames_since_calib <= max_hold_frames and self._propagate_with_camera_motion(gray):
                self._prev_gray = gray
                return True
            if self.frames_since_calib > max_hold_frames:
                self.H = None
            self._prev_gray = gray
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
            if float(np.max(np.linalg.norm(p_new - p_old, axis=1))) > 15.0:
                self.H = H_new
            else:
                blended = ((1.0 - self.alpha) * p_old + self.alpha * p_new).astype(np.float32)
                self.H = cv2.getPerspectiveTransform(grid, blended).astype(np.float64)
        self._prev_gray = gray
        return True

    def project_point(self, u: float, v: float) -> Optional[tuple[float, float]]:
        if self.H is None:
            return None
        pt = np.array([[[float(u), float(v)]]], dtype=np.float32)
        out = cv2.perspectiveTransform(pt, self.H)[0, 0]
        if not np.all(np.isfinite(out)):
            return None
        return round(float(out[0]), 2), round(float(out[1]), 2)
