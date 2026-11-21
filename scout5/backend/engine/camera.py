"""Background camera motion (RANSAC homography + cut detection) with foreground players masked out."""
from __future__ import annotations

import cv2
import numpy as np


class CameraMotion:
    def __init__(self) -> None:
        self.prev_gray: np.ndarray | None = None
        self.prev_hist: np.ndarray | None = None
        self.lk = dict(
            winSize=(21, 21),
            maxLevel=3,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03),
        )

    def reset(self) -> None:
        self.prev_gray = None
        self.prev_hist = None

    @staticmethod
    def _frame_hist(frame: np.ndarray) -> np.ndarray:
        small = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        return hist

    def update(self, frame: np.ndarray, boxes: np.ndarray | None = None) -> dict:
        """Estimate `H_curr_to_prev` (pixel_prev ~ H @ pixel_curr) and shot-cut / reliability flags."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        hist = self._frame_hist(frame)
        if self.prev_gray is None or self.prev_gray.shape != gray.shape or self.prev_hist is None:
            self.prev_gray = gray
            self.prev_hist = hist
            return {"H_step": None, "inliers": 0, "err_px": 0.0, "is_cut": True, "reliable": False}

        hist_dist = float(cv2.compareHist(self.prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA))
        self.prev_hist = hist
        if hist_dist > 0.34:
            self.prev_gray = gray
            return {"H_step": None, "inliers": 0, "err_px": 99.0, "is_cut": True, "reliable": False}

        h, w = gray.shape
        mask = np.full((h, w), 255, np.uint8)
        mask[: int(h * 0.14)] = 0  # scoreboard & clock banner
        if boxes is not None and len(boxes) > 0:
            for x1, y1, x2, y2 in boxes.astype(int):
                cv2.rectangle(mask, (max(0, x1 - 6), max(0, y1 - 6)), (min(w, x2 + 6), min(h, y2 + 6)), 0, -1)

        pts = cv2.goodFeaturesToTrack(self.prev_gray, maxCorners=240, qualityLevel=0.01, minDistance=14, mask=mask)
        prev = self.prev_gray
        self.prev_gray = gray
        if pts is None or len(pts) < 16:
            return {"H_step": None, "inliers": 0, "err_px": 99.0, "is_cut": False, "reliable": False}

        nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, gray, pts, None, **self.lk)
        if nxt is None or st is None:
            return {"H_step": None, "inliers": 0, "err_px": 99.0, "is_cut": False, "reliable": False}

        ok = st.reshape(-1) == 1
        if int(ok.sum()) < 14:
            return {"H_step": None, "inliers": 0, "err_px": 99.0, "is_cut": False, "reliable": False}

        p_prev = pts[ok].reshape(-1, 2).astype(np.float32)
        p_curr = nxt[ok].reshape(-1, 2).astype(np.float32)
        H_step, inl = cv2.findHomography(p_curr, p_prev, cv2.RANSAC, 2.0)
        if H_step is None or inl is None:
            return {"H_step": None, "inliers": 0, "err_px": 99.0, "is_cut": True, "reliable": False}

        inl_mask = inl.reshape(-1).astype(bool)
        n_inl = int(inl_mask.sum())
        if n_inl < 12 or abs(H_step[2, 2]) < 1e-6:
            return {"H_step": None, "inliers": n_inl, "err_px": 99.0, "is_cut": True, "reliable": False}

        H_step = (H_step / H_step[2, 2]).astype(np.float64)
        proj = cv2.perspectiveTransform(p_curr[inl_mask].reshape(-1, 1, 2), H_step).reshape(-1, 2)
        err_px = float(np.median(np.linalg.norm(proj - p_prev[inl_mask], axis=1)))
        reliable = n_inl >= 14 and err_px <= 2.2
        return {"H_step": H_step, "inliers": n_inl, "err_px": round(err_px, 3), "is_cut": (not reliable) and hist_dist > 0.22, "reliable": reliable}
