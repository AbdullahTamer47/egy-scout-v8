"""Team kit separation & goalkeeper side assignment for EGY-SCOUT V5.

Separates outfield players strictly (`role == 'player'` inside calibrated pitch bounds),
keeps referees excluded (`team_id = -1`), and assigns detected goalkeepers to the
nearest defending team's spatial side (roboflow/sports convention).
"""
from __future__ import annotations

import cv2
import numpy as np
from sklearn.cluster import KMeans

# Chrominance + bright-white separation weights over 11-D jersey descriptor
KIT_WEIGHTS = np.array(
    [1.45, 2.20, 1.85, 1.05, 1.05, 1.05, 2.40, 2.40, 2.30, 2.20, 2.65],
    dtype=np.float32,
)


def estimate_grass_hsv(frame_bgr: np.ndarray) -> tuple[float, float, float]:
    """Return (grass_ratio, median_H, median_S) in OpenCV HSV coordinates."""
    small = cv2.resize(frame_bgr, (320, 180), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array((24, 24, 24), np.uint8), np.array((96, 255, 255), np.uint8))
    cnt = int(np.count_nonzero(mask))
    ratio = float(cnt) / float(mask.size)
    if cnt < 100:
        return ratio, 48.0, 95.0
    nz = mask > 0
    return ratio, float(np.median(hsv[:, :, 0][nz])), float(np.median(hsv[:, :, 1][nz]))


def kit_descriptor(
    frame_bgr: np.ndarray,
    box_xyxy: np.ndarray,
    grass_hsv: tuple[float, float] | None = None,
) -> np.ndarray | None:
    """Extract 11-D grass-masked upper-torso kit feature from a bounding box."""
    x1, y1, x2, y2 = [int(round(v)) for v in box_xyxy]
    h, w = y2 - y1, x2 - x1
    if h < 14 or w < 6:
        return None
    H_img, W_img = frame_bgr.shape[:2]
    cy1, cy2 = max(0, y1 + int(0.14 * h)), min(H_img, y1 + int(0.49 * h))
    cx1, cx2 = max(0, x1 + int(0.20 * w)), min(W_img, x2 - int(0.20 * w))
    if cy2 - cy1 < 3 or cx2 - cx1 < 3:
        return None

    crop = frame_bgr[cy1:cy2, cx1:cx2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    h_ch, s_ch, v_ch = hsv[:, :, 0].astype(np.float32), hsv[:, :, 1].astype(np.float32), hsv[:, :, 2].astype(np.float32)

    if grass_hsv is not None:
        gh, gs = grass_hsv
        is_grass = (np.abs(h_ch - gh) <= 17.5) & (s_ch >= max(22.0, gs * 0.45)) & (h_ch >= 22.0) & (h_ch <= 98.0)
    else:
        is_grass = (h_ch >= 25.0) & (h_ch <= 94.0) & (s_ch >= 32.0)

    keep = (~is_grass) & (v_ch >= 20.0)
    if int(np.count_nonzero(keep)) < 5:
        keep = ~is_grass
    if int(np.count_nonzero(keep)) < 4:
        return None

    lab_px = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)[keep].astype(np.float32)
    bgr_px = crop[keep].astype(np.float32)
    l_m, a_m, b_m = np.median(lab_px, axis=0)
    b_c, g_c, r_c = np.median(bgr_px, axis=0)

    kh, ks, kv = h_ch[keep], s_ch[keep], v_ch[keep]
    n_px = float(max(1, len(kh)))
    red_sh = float(np.sum(((kh <= 16.0) | (kh >= 162.0)) & (ks >= 42.0))) / n_px
    blue_sh = float(np.sum((kh >= 88.0) & (kh <= 136.0) & (ks >= 36.0))) / n_px
    white_sh = float(np.sum((ks <= 48.0) & (kv >= 140.0))) / n_px

    return np.array(
        [
            l_m / 255.0,
            a_m / 255.0,
            b_m / 255.0,
            r_c / 255.0,
            g_c / 255.0,
            b_c / 255.0,
            (r_c - g_c) / 255.0,
            (b_c - r_c) / 255.0,
            red_sh,
            blue_sh,
            white_sh,
        ],
        dtype=np.float32,
    )


def describe_kit_rgb(r: float, g: float, b: float, red_sh: float, blue_sh: float, white_sh: float) -> dict:
    """Map median kit RGB + chromaticity shares to clean Arabic name and high-contrast ring hex."""
    if white_sh >= 0.35 and red_sh < 0.16 and blue_sh < 0.25:
        return {"family": "white", "label_ar": "أبيض", "ring": "#f8fafc", "primary": "#cbd5e1"}
    if red_sh >= 0.24 or (r - g >= 20.0 and r - b >= 16.0):
        return {"family": "red", "label_ar": "أحمر", "ring": "#f43f5e", "primary": "#e11d48"}
    if white_sh >= 0.30 or (min(r, g, b) >= 135.0 and max(r, g, b) - min(r, g, b) <= 38.0):
        return {"family": "white", "label_ar": "أبيض", "ring": "#f8fafc", "primary": "#cbd5e1"}
    if blue_sh >= 0.24 or (b - r >= 14.0 and b >= g):
        return {"family": "blue", "label_ar": "أزرق", "ring": "#38bdf8", "primary": "#0284c7"}
    if r >= 120.0 and g >= 100.0 and (r - b) >= 35.0:
        return {"family": "yellow", "label_ar": "أصفر", "ring": "#facc15", "primary": "#eab308"}
    if g >= r + 10.0 and g >= b + 6.0:
        return {"family": "green", "label_ar": "أخضر", "ring": "#10b981", "primary": "#059669"}
    if max(r, g, b) <= 90.0:
        return {"family": "dark", "label_ar": "كحلي/داكن", "ring": "#38bdf8", "primary": "#1e3a8a"}
    return {"family": "amber", "label_ar": "برتقالي/ذهبي", "ring": "#f59e0b", "primary": "#d97706"}


class KitTeamSeparator:
    """Cluster clean outfield player jerseys into 2 teams while isolating leaked non-player outliers."""

    def __init__(self) -> None:
        self.kmeans: KMeans | None = None
        self.outlier_center: np.ndarray | None = None
        self.outlier_dist: float = np.inf
        self.palettes: dict[str, dict] = {}

    @staticmethod
    def _weight(X: np.ndarray) -> np.ndarray:
        arr = np.asarray(X, dtype=np.float32)
        if arr.ndim == 1:
            arr = arr[None, :]
        return arr * KIT_WEIGHTS[None, :]

    def fit(self, feats: np.ndarray) -> None:
        X = np.asarray(feats, dtype=np.float32)
        if len(X) < 10:
            raise ValueError(f"Need >=10 outfield player kit crops, got {len(X)}")
        Xw = self._weight(X)
        km2 = KMeans(n_clusters=2, n_init=20, random_state=42).fit(Xw)
        min_share = min(float(np.mean(km2.labels_ == 0)), float(np.mean(km2.labels_ == 1)))

        use_km2 = True
        if len(Xw) >= 24:
            km3 = KMeans(n_clusters=3, n_init=20, random_state=42).fit(Xw)
            counts3 = np.bincount(km3.labels_, minlength=3)
            c_min = int(np.argmin(counts3))
            others = [i for i in range(3) if i != c_min]
            c3 = km3.cluster_centers_
            ratio_inertia = float(km3.inertia_) / max(1e-6, float(km2.inertia_))
            d_min_other = min(float(np.linalg.norm(c3[c_min] - c3[o])) for o in others)
            d_between = float(np.linalg.norm(c3[others[0]] - c3[others[1]]))
            split_minority = (min_share < 0.25) or (
                ratio_inertia < 0.40 and (counts3[c_min] / len(Xw)) < 0.22 and d_min_other > d_between * 1.15
            )
            keep = km3.labels_ != c_min
            if split_minority and int(np.sum(keep)) >= 12:
                self.outlier_center = c3[c_min].copy()
                X_fit, Xw_fit = X[keep], Xw[keep]
                self.kmeans = KMeans(n_clusters=2, n_init=20, random_state=42).fit(Xw_fit)
                use_km2 = False

        if use_km2:
            self.outlier_center = None
            X_fit, Xw_fit = X, Xw
            self.kmeans = km2

        d = self.kmeans.transform(Xw_fit).min(axis=1)
        self.outlier_dist = float(np.percentile(d, 96) * 1.4)

        self.palettes = {}
        labels = self.kmeans.labels_
        for c in (0, 1):
            sub = X_fit[labels == c]
            if len(sub) > 0:
                med = np.median(sub, axis=0)
                r, g, b = float(med[3] * 255.0), float(med[4] * 255.0), float(med[5] * 255.0)
                pal = describe_kit_rgb(r, g, b, float(med[8]), float(med[9]), float(med[10]))
                pal["rgb"] = [int(np.clip(round(r), 0, 255)), int(np.clip(round(g), 0, 255)), int(np.clip(round(b), 0, 255))]
                pal["hex"] = f"#{pal['rgb'][0]:02x}{pal['rgb'][1]:02x}{pal['rgb'][2]:02x}"
                self.palettes[str(c)] = pal

    def predict(self, feats: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if self.kmeans is None or len(feats) == 0:
            return np.full(len(feats), -1, dtype=int), np.zeros(len(feats), dtype=np.float32)
        Xw = self._weight(feats)
        dist = self.kmeans.transform(Xw)
        labels = dist.argmin(axis=1).astype(int)
        dmin, dmax = dist.min(axis=1), dist.max(axis=1)
        confs = np.clip(1.0 - dmin / np.maximum(dmax, 1e-5), 0.0, 1.0).astype(np.float32)
        if self.outlier_center is not None:
            d_out = np.linalg.norm(Xw - self.outlier_center[None, :], axis=1)
            is_out = d_out < dmin * 0.90
            labels = np.where(is_out, -1, labels)
            confs = np.where(is_out, 0.0, confs)
        else:
            is_out = dmin > self.outlier_dist
            labels = np.where(is_out, -1, labels)
            confs = np.where(is_out, 0.0, confs)
        return labels, confs


def assign_goalkeeper_team(
    gk_xy_m: np.ndarray,
    team0_xy_m: np.ndarray,
    team1_xy_m: np.ndarray,
) -> int:
    """Roboflow/sports spatial team resolution: assign goalkeeper to whichever team's centroid is closer."""
    if len(team0_xy_m) == 0 or len(team1_xy_m) == 0:
        return -1
    c0 = np.mean(team0_xy_m, axis=0)
    c1 = np.mean(team1_xy_m, axis=0)
    d0 = float(np.linalg.norm(gk_xy_m - c0))
    d1 = float(np.linalg.norm(gk_xy_m - c1))
    return 0 if d0 < d1 else 1
