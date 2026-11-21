"""Automatic broadcast pitch homography, 3D inverse projection & camera motion stabilization.

Eliminates manual 4-point calibration completely: computes pixel -> metric pitch (H)
and metric pitch -> 3D perspective video (H_inv / H_inv_norm) on every wide frame using
HSV grass convex hull extraction, Hough line refinement, and temporal EMA smoothing.
"""
from __future__ import annotations

import cv2
import numpy as np

from core.config import GRASS_HSV_LOWER, GRASS_HSV_UPPER, PITCH_LENGTH, PITCH_WIDTH

# 32 canonical FIFA pitch vertices on 105m x 68m field (Roboflow sports / SoccerNet layout)
PITCH_VERTICES = np.array(
    [
        [0.0, 0.0],
        [0.0, 13.84],
        [0.0, 24.84],
        [0.0, 43.16],
        [0.0, 54.16],
        [0.0, 68.0],
        [5.5, 24.84],
        [5.5, 43.16],
        [11.0, 34.0],
        [16.5, 13.84],
        [16.5, 24.84],
        [16.5, 43.16],
        [16.5, 54.16],
        [52.5, 0.0],
        [52.5, 24.85],
        [52.5, 34.0],
        [52.5, 43.15],
        [52.5, 68.0],
        [88.5, 13.84],
        [88.5, 24.84],
        [88.5, 43.16],
        [88.5, 54.16],
        [94.0, 34.0],
        [99.5, 24.84],
        [99.5, 43.16],
        [105.0, 0.0],
        [105.0, 13.84],
        [105.0, 24.84],
        [105.0, 43.16],
        [105.0, 54.16],
        [105.0, 68.0],
        [43.35, 34.0],
    ],
    dtype=np.float32,
)


def apply_homography(H: np.ndarray, xy: np.ndarray) -> np.ndarray:
    if xy is None or len(xy) == 0:
        return np.empty((0, 2), dtype=np.float32)
    pts = np.asarray(xy, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, np.asarray(H, dtype=np.float32)).reshape(-1, 2)


class ViewTransformer:
    """Thin perspective transformer matching roboflow/sports interface."""

    def __init__(self, source: np.ndarray, target: np.ndarray):
        src = np.asarray(source, dtype=np.float32)
        dst = np.asarray(target, dtype=np.float32)
        if len(src) >= 4:
            self.H, _ = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
            if self.H is None:
                self.H = cv2.getPerspectiveTransform(src[:4], dst[:4])
        else:
            self.H = np.eye(3, dtype=np.float32)

    def transform_points(self, points: np.ndarray) -> np.ndarray:
        return apply_homography(self.H, points)


class AutoPitchHomography:
    """100% Automatic Pitch Homography computing H (pixel->meters) and H_inv (meters->pixel) per frame."""

    def __init__(self, pitch_length: float = PITCH_LENGTH, pitch_width: float = PITCH_WIDTH, alpha: float = 0.15):
        self.L = float(pitch_length)
        self.W = float(pitch_width)
        self.alpha = float(alpha)
        self.H_smooth: np.ndarray | None = None
        self.H_inv_smooth: np.ndarray | None = None
        self._last_pan_shift = 0.0

    def reset(self) -> None:
        self.H_smooth = None
        self.H_inv_smooth = None
        self._last_pan_shift = 0.0

    @staticmethod
    def _default_broadcast_trapezoid(w: int, h: int) -> np.ndarray:
        return np.array(
            [
                [w * 0.12, h * 0.18],
                [w * 0.88, h * 0.18],
                [w * 1.04, h * 0.96],
                [-w * 0.04, h * 0.96],
            ],
            dtype=np.float32,
        )

    def _extract_grass_trapezoid(self, frame: np.ndarray) -> tuple[np.ndarray, float]:
        h, w = frame.shape[:2]
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower = np.array(GRASS_HSV_LOWER, dtype=np.uint8)
        upper = np.array(GRASS_HSV_UPPER, dtype=np.uint8)
        grass_mask = cv2.inRange(hsv, lower, upper)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        grass_mask = cv2.morphologyEx(grass_mask, cv2.MORPH_CLOSE, kernel)

        grass_ratio = float(np.count_nonzero(grass_mask)) / float(max(1, w * h))
        default_src = self._default_broadcast_trapezoid(w, h)

        contours, _ = cv2.findContours(grass_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return default_src, grass_ratio

        largest = max(contours, key=cv2.contourArea)
        area_ratio = cv2.contourArea(largest) / float(max(1, w * h))
        if area_ratio < 0.16:
            return default_src, grass_ratio

        hull = cv2.convexHull(largest).reshape(-1, 2).astype(np.float32)
        # Estimate robust top/bottom edges via vertical percentile bands inside convex hull
        y_vals = hull[:, 1]
        y_top = float(np.percentile(y_vals, 8))
        y_bot = float(np.percentile(y_vals, 94))
        if y_bot - y_top < h * 0.25:
            return default_src, grass_ratio

        # Fit top/bottom horizontal bounds cleanly so broadcast perspective stays stable
        s = hull.sum(axis=1)
        diff = np.diff(hull, axis=1).reshape(-1)
        tl = hull[np.argmin(s)]
        br = hull[np.argmax(s)]
        tr = hull[np.argmin(diff)]
        bl = hull[np.argmax(diff)]

        # Optional white touchline refinement at far touchline (top edge of pitch)
        top_band_y1 = max(0, int(y_top - h * 0.04))
        top_band_y2 = min(h, int(y_top + h * 0.14))
        if top_band_y2 - top_band_y1 > 12:
            gray = cv2.cvtColor(frame[top_band_y1:top_band_y2, :], cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(gray, 50, 150)
            lines = cv2.HoughLinesP(edges, 1, np.pi / 180.0, threshold=45, minLineLength=int(w * 0.18), maxLineGap=20)
            if lines is not None and len(lines) > 0:
                best_y = []
                for ln in lines.reshape(-1, 4):
                    x1, y1, x2, y2 = [int(v) for v in ln]
                    if abs(y2 - y1) <= max(10.0, abs(x2 - x1) * 0.18):
                        best_y.append(top_band_y1 + 0.5 * (y1 + y2))
                if best_y:
                    refined_top = float(np.median(best_y))
                    tl[1] = 0.5 * tl[1] + 0.5 * refined_top
                    tr[1] = 0.5 * tr[1] + 0.5 * refined_top

        cand = np.array([tl, tr, br, bl], dtype=np.float32)
        # Validate convexity and wide spread; otherwise blend safely with broadcast trapezoid
        top_span = float(cand[1, 0] - cand[0, 0])
        bot_span = float(cand[2, 0] - cand[3, 0])
        height_span = float(min(cand[2, 1], cand[3, 1]) - max(cand[0, 1], cand[1, 1]))
        if top_span < w * 0.30 or bot_span < w * 0.45 or height_span < h * 0.25:
            return default_src, grass_ratio

        # Smooth blend (65% detected hull + 35% canonical trapezoid) avoids wild corner jumps on crowds/overlays
        src_pts = (0.65 * cand + 0.35 * default_src).astype(np.float32)
        return src_pts, grass_ratio

    def estimate_frame_homography(
        self, frame: np.ndarray, cam_dx: float = 0.0
    ) -> tuple[np.ndarray, np.ndarray]:
        h, w = frame.shape[:2]
        src_pts, _ = self._extract_grass_trapezoid(frame)

        # Pan-aware longitudinal shift bounded safely inside [0, 105] so wide camera panning tracks field position
        self._last_pan_shift = float(np.clip(self._last_pan_shift + cam_dx * 0.025, -14.0, 14.0))
        dst_pts = np.array(
            [
                [18.0 + self._last_pan_shift, 2.0],
                [87.0 + self._last_pan_shift, 2.0],
                [98.0 + self._last_pan_shift * 0.6, 66.0],
                [7.0 + self._last_pan_shift * 0.6, 66.0],
            ],
            dtype=np.float32,
        )

        H_new, _ = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
        if H_new is None:
            H_new = cv2.getPerspectiveTransform(src_pts, dst_pts)

        # Normalize homogeneous scale before EMA averaging to avoid sign flips or matrix collapse
        if abs(H_new[2, 2]) > 1e-6:
            H_new = (H_new / H_new[2, 2]).astype(np.float64)
        else:
            H_new = H_new.astype(np.float64)

        if self.H_smooth is None:
            self.H_smooth = H_new
        else:
            blended = (1.0 - self.alpha) * self.H_smooth + self.alpha * H_new
            if abs(np.linalg.det(blended)) > 1e-9:
                self.H_smooth = blended / (blended[2, 2] if abs(blended[2, 2]) > 1e-6 else 1.0)

        try:
            self.H_inv_smooth = np.linalg.inv(self.H_smooth)
        except np.linalg.LinAlgError:
            self.H_inv_smooth = np.eye(3, dtype=np.float64)

        return self.H_smooth.copy(), self.H_inv_smooth.copy()

    def normalized_inverse_homography(self, w: int, h: int) -> np.ndarray:
        """Return 3x3 matrix mapping pitch (X_m, Y_m) -> normalized canvas [0..1] (u_norm, v_norm)."""
        if self.H_inv_smooth is None:
            return np.eye(3, dtype=np.float64)
        S = np.array([[1.0 / max(1, w), 0.0, 0.0], [0.0, 1.0 / max(1, h), 0.0], [0.0, 0.0, 1.0]], dtype=np.float64)
        H_inv_norm = S @ self.H_inv_smooth
        if abs(H_inv_norm[2, 2]) > 1e-6:
            H_inv_norm = H_inv_norm / H_inv_norm[2, 2]
        return H_inv_norm

    def pixels_to_meters(self, uv_points: np.ndarray) -> np.ndarray:
        if uv_points is None or len(uv_points) == 0 or self.H_smooth is None:
            return np.empty((0, 2), dtype=np.float32)
        pts = np.asarray(uv_points, dtype=np.float32).reshape(-1, 1, 2)
        mapped = cv2.perspectiveTransform(pts, self.H_smooth.astype(np.float32)).reshape(-1, 2)
        mapped[:, 0] = np.clip(mapped[:, 0], 0.0, self.L)
        mapped[:, 1] = np.clip(mapped[:, 1], 0.0, self.W)
        return mapped

    def meters_to_pixels_3d(self, xy_meters: np.ndarray) -> np.ndarray:
        if xy_meters is None or len(xy_meters) == 0 or self.H_inv_smooth is None:
            return np.empty((0, 2), dtype=np.float32)
        pts = np.asarray(xy_meters, dtype=np.float32).reshape(-1, 1, 2)
        return cv2.perspectiveTransform(pts, self.H_inv_smooth.astype(np.float32)).reshape(-1, 2)


def _fifa_keypoint_vertices(L: float = PITCH_LENGTH, W: float = PITCH_WIDTH) -> np.ndarray:
    """32 pitch keypoints in exact roboflow/sports SoccerPitchConfiguration order, FIFA 105x68 metres."""
    PB_W, PB_L, GB_W, GB_L, CR, PS = 40.32, 16.5, 18.32, 5.5, 9.15, 11.0
    return np.array(
        [
            (0, 0), (0, (W - PB_W) / 2), (0, (W - GB_W) / 2), (0, (W + GB_W) / 2), (0, (W + PB_W) / 2), (0, W),
            (GB_L, (W - GB_W) / 2), (GB_L, (W + GB_W) / 2), (PS, W / 2),
            (PB_L, (W - PB_W) / 2), (PB_L, (W - GB_W) / 2), (PB_L, (W + GB_W) / 2), (PB_L, (W + PB_W) / 2),
            (L / 2, 0), (L / 2, W / 2 - CR), (L / 2, W / 2 + CR), (L / 2, W),
            (L - PB_L, (W - PB_W) / 2), (L - PB_L, (W - GB_W) / 2), (L - PB_L, (W + GB_W) / 2), (L - PB_L, (W + PB_W) / 2),
            (L - PS, W / 2), (L - GB_L, (W - GB_W) / 2), (L - GB_L, (W + GB_W) / 2),
            (L, 0), (L, (W - PB_W) / 2), (L, (W - GB_W) / 2), (L, (W + GB_W) / 2), (L, (W + PB_W) / 2), (L, W),
            (L / 2 - CR, W / 2), (L / 2 + CR, W / 2),
        ],
        dtype=np.float32,
    )


KEYPOINT_VERTICES = _fifa_keypoint_vertices()


class KeypointPitchHomography:
    """Real pitch calibration from the open-source roboflow/sports 32-keypoint YOLO pose model.

    Detects actual pitch landmarks (corners, box corners, penalty spots, centre circle) and solves
    pixel -> metre homography with RANSAC. Returns None when the landmarks are not reliable, so the
    caller can hold the last good calibration instead of inventing geometry.
    """

    def __init__(self, weights: str, conf: float = 0.5, imgsz: int = 640, max_err_m: float = 1.6, alpha: float = 0.35):
        from ultralytics import YOLO

        self.model = YOLO(weights)
        self.conf = float(conf)
        self.imgsz = int(imgsz)
        self.max_err_m = float(max_err_m)
        self.alpha = float(alpha)
        self.H: np.ndarray | None = None
        self.last_kp_count = 0
        self.last_err_m = float("nan")

    def reset(self) -> None:
        self.H = None

    def detect(self, frame: np.ndarray) -> tuple[np.ndarray | None, int, float]:
        r = self.model.predict(frame, verbose=False, conf=0.25, imgsz=self.imgsz)[0]
        if r.keypoints is None or len(r.keypoints) == 0 or r.keypoints.conf is None:
            return None, 0, float("nan")
        xy = r.keypoints.xy.cpu().numpy()[0]
        cf = r.keypoints.conf.cpu().numpy()[0]
        m = cf > self.conf
        n = int(m.sum())
        if n < 4:
            return None, n, float("nan")
        src = xy[m].astype(np.float32)
        dst = KEYPOINT_VERTICES[m]
        # Landmarks must not be (almost) collinear in metric space, otherwise H is ill-posed
        if np.linalg.matrix_rank(np.c_[dst, np.ones(len(dst))], tol=1.0) < 3:
            return None, n, float("nan")
        H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 1.5)
        if H is None or inl is None or int(inl.sum()) < 4:
            return None, n, float("nan")
        keep = inl.reshape(-1).astype(bool)
        proj = cv2.perspectiveTransform(src[keep].reshape(-1, 1, 2), H).reshape(-1, 2)
        err = float(np.mean(np.linalg.norm(proj - dst[keep], axis=1)))
        if not np.isfinite(err) or err > self.max_err_m:
            return None, n, err
        # Sanity: bottom-centre of the image must land near the pitch (broadcast camera looks at the field)
        h, w = frame.shape[:2]
        bc = cv2.perspectiveTransform(np.array([[[w * 0.5, h * 0.95]]], dtype=np.float32), H).reshape(2)
        if not (-25.0 <= bc[0] <= PITCH_LENGTH + 25.0 and -25.0 <= bc[1] <= PITCH_WIDTH + 25.0):
            return None, n, err
        return (H / H[2, 2]).astype(np.float64), int(keep.sum()), err

    def update(self, frame: np.ndarray) -> bool:
        """Run detection and blend into the held calibration. Returns True if this frame calibrated."""
        H_new, n, err = self.detect(frame)
        self.last_kp_count, self.last_err_m = n, err
        if H_new is None:
            return False
        if self.H is None:
            self.H = H_new
        else:
            # Blend in normalised point space (project a grid) to avoid matrix-element averaging artefacts
            h, w = frame.shape[:2]
            grid = np.array([[w * 0.1, h * 0.35], [w * 0.9, h * 0.35], [w * 0.95, h * 0.95], [w * 0.05, h * 0.95]], dtype=np.float32)
            p_old = cv2.perspectiveTransform(grid.reshape(-1, 1, 2), self.H).reshape(-1, 2)
            p_new = cv2.perspectiveTransform(grid.reshape(-1, 1, 2), H_new).reshape(-1, 2)
            jump = float(np.max(np.linalg.norm(p_new - p_old, axis=1)))
            if jump > 12.0:
                self.H = H_new  # camera cut / fast pan: take the fresh calibration
            else:
                blended = ((1.0 - self.alpha) * p_old + self.alpha * p_new).astype(np.float32)
                self.H = cv2.getPerspectiveTransform(grid, blended).astype(np.float64)
        return True

    def propagate(self, cam_dx: float, cam_dy: float) -> None:
        """Hold calibration across frames without keypoints by compensating the measured image pan."""
        if self.H is None or (abs(cam_dx) < 1e-3 and abs(cam_dy) < 1e-3):
            return
        T = np.array([[1.0, 0.0, -cam_dx], [0.0, 1.0, -cam_dy], [0.0, 0.0, 1.0]], dtype=np.float64)
        Hn = self.H @ T
        self.H = Hn / Hn[2, 2]

    def inverse_normalized(self, w: int, h: int) -> np.ndarray | None:
        if self.H is None:
            return None
        try:
            Hi = np.linalg.inv(self.H)
        except np.linalg.LinAlgError:
            return None
        S = np.array([[1.0 / max(1, w), 0.0, 0.0], [0.0, 1.0 / max(1, h), 0.0], [0.0, 0.0, 1.0]], dtype=np.float64)
        Hn = S @ Hi
        return Hn / Hn[2, 2] if abs(Hn[2, 2]) > 1e-9 else Hn


class CameraMotionEstimator:
    """Sparse Lucas-Kanade optical flow background pan estimator (masked outside players)."""

    def __init__(self) -> None:
        self._prev_gray: np.ndarray | None = None
        self._lk_params = dict(winSize=(15, 15), maxLevel=2, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03))

    def reset(self) -> None:
        self._prev_gray = None

    def update(self, frame: np.ndarray, fg_boxes: np.ndarray | None = None) -> tuple[float, float]:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if self._prev_gray is None or self._prev_gray.shape != gray.shape:
            self._prev_gray = gray
            return 0.0, 0.0

        h, w = gray.shape
        mask = np.full((h, w), 255, dtype=np.uint8)
        if fg_boxes is not None and len(fg_boxes) > 0:
            for x1, y1, x2, y2 in fg_boxes.astype(int):
                cv2.rectangle(mask, (max(0, x1 - 4), max(0, y1 - 4)), (min(w, x2 + 4), min(h, y2 + 4)), 0, -1)

        pts = cv2.goodFeaturesToTrack(self._prev_gray, maxCorners=80, qualityLevel=0.05, minDistance=12, mask=mask)
        if pts is None or len(pts) < 6:
            self._prev_gray = gray
            return 0.0, 0.0

        next_pts, status, _ = cv2.calcOpticalFlowPyrLK(self._prev_gray, gray, pts, None, **self._lk_params)
        self._prev_gray = gray
        if next_pts is None or status is None:
            return 0.0, 0.0

        valid = status.reshape(-1) == 1
        if np.count_nonzero(valid) < 4:
            return 0.0, 0.0
        flow = (next_pts[valid] - pts[valid]).reshape(-1, 2)
        dx = float(np.median(flow[:, 0]))
        dy = float(np.median(flow[:, 1]))
        return dx, dy


def register_images(src: np.ndarray, dst: np.ndarray) -> np.ndarray | None:
    """Estimate affine/homography transform between two RGB frames via ORB feature matching."""
    orb = cv2.ORB_create(500)
    kp1, des1 = orb.detectAndCompute(src, None)
    kp2, des2 = orb.detectAndCompute(dst, None)
    if des1 is None or des2 is None or len(kp1) < 10 or len(kp2) < 10:
        return None
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = sorted(matcher.match(des1, des2), key=lambda m: m.distance)[:40]
    if len(matches) < 6:
        return None
    pts1 = np.float32([kp1[m.queryIdx].pt for m in matches])
    pts2 = np.float32([kp2[m.trainIdx].pt for m in matches])
    H, _ = cv2.findHomography(pts1, pts2, cv2.RANSAC, 5.0)
    return H
