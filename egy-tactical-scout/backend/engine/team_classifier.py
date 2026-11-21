"""Automatic kit-colour team separation (frame-adaptive grass-masked chrominance LAB/HSV + KMeans) and jersey OCR."""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

from core.config import GRASS_HSV_LOWER, GRASS_HSV_UPPER, MIN_GREEN_RATIO

# Chrominance + bright-white contrast weights over 11-D kit features [L, A, B, R, G, B_c, R-G, B-R, red_sh, blue_sh, white_sh]
KIT_FEATURE_WEIGHTS = np.array(
    [1.45, 2.20, 1.85, 1.05, 1.05, 1.05, 2.40, 2.40, 2.30, 2.20, 2.65],
    dtype=np.float32,
)


def grass_ratio(frame_bgr: np.ndarray) -> float:
    small = cv2.resize(frame_bgr, (320, 180), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array(GRASS_HSV_LOWER), np.array(GRASS_HSV_UPPER))
    return float(np.count_nonzero(mask)) / mask.size


def is_wide_tactical_camera(frame_bgr: np.ndarray, min_green_ratio: float = MIN_GREEN_RATIO) -> bool:
    """Skips close-ups, crowd shots and ad breaks: only wide shots have enough visible grass."""
    return grass_ratio(frame_bgr) >= min_green_ratio


def analyze_frame_grass(frame_bgr: np.ndarray) -> dict:
    """Compute adaptive grass hue/sat baseline, pitch vertical bounds, and dilated grass mask (at 320x180)."""
    small = cv2.resize(frame_bgr, (320, 180), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array((24, 24, 24), dtype=np.uint8), np.array((96, 255, 255), dtype=np.uint8))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask_clean = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask_clean = cv2.morphologyEx(mask_clean, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    dilated = cv2.dilate(mask_clean, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 13)))

    g_cnt = int(np.count_nonzero(mask_clean))
    g_ratio = float(g_cnt) / float(mask_clean.size)

    g_h_med = 48.0
    g_s_med = 95.0
    top_y_norm = 0.14
    bot_y_norm = 0.98

    if g_cnt > 120:
        nz = mask_clean > 0
        g_h_med = float(np.median(hsv[:, :, 0][nz]))
        g_s_med = float(np.median(hsv[:, :, 1][nz]))
        contours, _ = cv2.findContours(mask_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            largest = max(contours, key=cv2.contourArea)
            if cv2.contourArea(largest) > mask_clean.size * 0.08:
                ys = largest[:, 0, 1]
                top_y_norm = float(np.percentile(ys, 2)) / 180.0
                bot_y_norm = float(np.percentile(ys, 98)) / 180.0

    return {
        "grass_ratio": g_ratio,
        "g_h_med": g_h_med,
        "g_s_med": g_s_med,
        "top_y_norm": top_y_norm,
        "bot_y_norm": bot_y_norm,
        "dilated_mask": dilated,
    }


def is_foot_on_pitch(grass_info: dict, u_norm: float, v_norm: float, bh_ratio: float) -> bool:
    """Check if a detection is an on-pitch tactical player rather than a close-up, ad-board, or crowd spectator."""
    if bh_ratio > 0.215 or bh_ratio < 0.030:
        return False
    if v_norm < max(0.08, grass_info["top_y_norm"] - 0.03) or v_norm > min(1.0, grass_info["bot_y_norm"] + 0.05):
        return False
    mask = grass_info["dilated_mask"]
    mx = int(np.clip(round(u_norm * (mask.shape[1] - 1)), 0, mask.shape[1] - 1))
    my = int(np.clip(round(v_norm * (mask.shape[0] - 1)), 0, mask.shape[0] - 1))
    # Check 3x3 window around foot point on dilated grass mask
    y0, y1 = max(0, my - 2), min(mask.shape[0], my + 3)
    x0, x1 = max(0, mx - 2), min(mask.shape[1], mx + 3)
    return bool(np.any(mask[y0:y1, x0:x1] > 0))


def jersey_crop(frame_bgr: np.ndarray, box: np.ndarray) -> np.ndarray | None:
    """Upper-body region (shirt) of a player bounding box."""
    x1, y1, x2, y2 = box.astype(int)
    h, w = y2 - y1, x2 - x1
    if h < 14 or w < 6:
        return None
    cy1, cy2 = y1 + int(0.14 * h), y1 + int(0.49 * h)
    cx1, cx2 = x1 + int(0.20 * w), x2 - int(0.20 * w)
    H, W = frame_bgr.shape[:2]
    cy1, cy2, cx1, cx2 = max(0, cy1), min(H, cy2), max(0, cx1), min(W, cx2)
    if cy2 - cy1 < 3 or cx2 - cx1 < 3:
        return None
    return frame_bgr[cy1:cy2, cx1:cx2]


def kit_feature(crop_bgr: np.ndarray, grass_hsv: tuple[float, float] | None = None) -> np.ndarray | None:
    """11-D chrominance-weighted torso kit descriptor [L,A,B, R,G,B_c, R-G, B-R, red_sh, blue_sh, white_sh]."""
    if crop_bgr is None or crop_bgr.size < 27:
        return None
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    h_ch = hsv[:, :, 0].astype(np.float32)
    s_ch = hsv[:, :, 1].astype(np.float32)
    v_ch = hsv[:, :, 2].astype(np.float32)

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

    lab_px = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2LAB)[keep].astype(np.float32)
    bgr_px = crop_bgr[keep].astype(np.float32)

    l_med, a_med, b_med = np.median(lab_px, axis=0)
    b_c, g_c, r_c = np.median(bgr_px, axis=0)

    kh = h_ch[keep]
    ks = s_ch[keep]
    kv = v_ch[keep]
    n_px = float(max(1, len(kh)))

    red_share = float(np.sum(((kh <= 16.0) | (kh >= 162.0)) & (ks >= 42.0))) / n_px
    blue_share = float(np.sum((kh >= 88.0) & (kh <= 136.0) & (ks >= 36.0))) / n_px
    white_share = float(np.sum((ks <= 48.0) & (kv >= 140.0))) / n_px

    feat = np.array(
        [
            l_med / 255.0,
            a_med / 255.0,
            b_med / 255.0,
            r_c / 255.0,
            g_c / 255.0,
            b_c / 255.0,
            (r_c - g_c) / 255.0,
            (b_c - r_c) / 255.0,
            red_share,
            blue_share,
            white_share,
        ],
        dtype=np.float32,
    )
    return feat


def extract_raw_kit_features_from_video(video_path: str | Path, df_raw: pd.DataFrame) -> pd.DataFrame:
    """Repair or enrich df_raw in place from video frames: fills kf0..kf10, grass_ratio, and on_grass flags."""
    if df_raw.empty:
        return df_raw
    df = df_raw.copy()
    for ki in range(11):
        col = f"kf{ki}"
        if col not in df.columns:
            df[col] = float("nan")
    if "on_grass" not in df.columns:
        df["on_grass"] = True
    if "grass_ratio" not in df.columns:
        df["grass_ratio"] = 0.5

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return df

    needed_fids = set(int(x) for x in df["frame_id"].unique())
    by_fid_idx = df.groupby("frame_id").groups
    max_fid = max(needed_fids) if needed_fids else 0

    try:
        cur_fid = 0
        while cur_fid <= max_fid:
            grabbed = cap.grab()
            if not grabbed:
                break
            if cur_fid in needed_fids:
                ok, frame = cap.retrieve()
                if ok and frame is not None:
                    fh, fw = frame.shape[:2]
                    g_info = analyze_frame_grass(frame)
                    idxs = by_fid_idx[cur_fid]
                    df.loc[idxs, "grass_ratio"] = round(float(g_info["grass_ratio"]), 4)
                    grass_hsv = (g_info["g_h_med"], g_info["g_s_med"])

                    for idx in idxs:
                        role = str(df.at[idx, "role"])
                        if role == "ball":
                            df.at[idx, "on_grass"] = g_info["grass_ratio"] >= 0.12
                            continue
                        x1 = float(df.at[idx, "x1"])
                        y1 = float(df.at[idx, "y1"])
                        x2 = float(df.at[idx, "x2"])
                        y2 = float(df.at[idx, "y2"])
                        u_norm = float(df.at[idx, "u_norm"]) if pd.notna(df.at[idx, "u_norm"]) else ((x1 + x2) * 0.5 / max(1, fw))
                        v_norm = float(df.at[idx, "v_norm"]) if pd.notna(df.at[idx, "v_norm"]) else (y2 / max(1, fh))
                        bh_ratio = (y2 - y1) / max(1.0, float(fh))

                        on_p = is_foot_on_pitch(g_info, u_norm, v_norm, bh_ratio) and (g_info["grass_ratio"] >= 0.16)
                        df.at[idx, "on_grass"] = bool(on_p)

                        crop = jersey_crop(frame, np.array([x1, y1, x2, y2], dtype=np.float32))
                        feat = kit_feature(crop, grass_hsv=grass_hsv) if crop is not None else None
                        if feat is not None and len(feat) == 11:
                            for ki in range(11):
                                df.at[idx, f"kf{ki}"] = float(feat[ki])
            cur_fid += 1
    finally:
        cap.release()
    return df


def _classify_rgb_palette(r: float, g: float, b: float, red_sh: float, blue_sh: float, white_sh: float) -> dict:
    """Map median jersey RGB + hue shares to high-contrast broadcast colors & Arabic label."""
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


class TeamClassifier:
    """Chrominance-weighted KMeans(2) over 11-D kit features with referee outlier rejection & RGB kit palette."""

    def __init__(self) -> None:
        self.kmeans: KMeans | None = None
        self.referee_center: np.ndarray | None = None
        self.outlier_threshold: float = np.inf
        self.cluster_palettes: dict[str, dict] = {}

    @property
    def fitted(self) -> bool:
        return self.kmeans is not None

    @staticmethod
    def _weight(X: np.ndarray) -> np.ndarray:
        arr = np.asarray(X, dtype=np.float32)
        if arr.ndim == 1:
            arr = arr[None, :]
        return arr * KIT_FEATURE_WEIGHTS[None, :]

    def fit(self, features: list[np.ndarray]) -> None:
        X = np.vstack(features).astype(np.float32)
        if len(X) < 10:
            raise ValueError("Not enough player crops to fit the team classifier")
        Xw = self._weight(X)
        km2 = KMeans(n_clusters=2, n_init=20, random_state=42).fit(Xw)
        min_share = min(float(np.mean(km2.labels_ == 0)), float(np.mean(km2.labels_ == 1)))

        use_km2 = True
        if len(Xw) >= 24:
            km3 = KMeans(n_clusters=3, n_init=20, random_state=42).fit(Xw)
            counts3 = np.bincount(km3.labels_, minlength=3)
            c_ref = int(np.argmin(counts3))
            others = [i for i in range(3) if i != c_ref]
            c3 = km3.cluster_centers_
            ratio_inertia = float(km3.inertia_) / max(1e-6, float(km2.inertia_))
            d_min_to_other = min(float(np.linalg.norm(c3[c_ref] - c3[o])) for o in others)
            d_between_teams = float(np.linalg.norm(c3[others[0]] - c3[others[1]]))
            ref_share = float(counts3[c_ref]) / float(len(Xw))
            split_out_ref = (min_share < 0.25) or (
                ratio_inertia < 0.40
                and ref_share < 0.22
                and d_min_to_other > d_between_teams * 1.15
            )
            keep_mask = km3.labels_ != c_ref
            if split_out_ref and int(np.sum(keep_mask)) >= 12:
                self.referee_center = c3[c_ref].copy()
                X_fit = X[keep_mask]
                Xw_fit = Xw[keep_mask]
                self.kmeans = KMeans(n_clusters=2, n_init=20, random_state=42).fit(Xw_fit)
                use_km2 = False

        if use_km2:
            self.referee_center = None
            X_fit, Xw_fit = X, Xw
            self.kmeans = km2

        d = self.kmeans.transform(Xw_fit).min(axis=1)
        self.outlier_threshold = float(np.percentile(d, 95) * 1.35)

        # Build authentic kit palettes from raw (unweighted) median torso features per cluster
        labels = self.kmeans.labels_
        self.cluster_palettes = {}
        for c in (0, 1):
            sub = X_fit[labels == c]
            if len(sub) > 0:
                med = np.median(sub, axis=0)
                r, g, b = float(med[3] * 255.0), float(med[4] * 255.0), float(med[5] * 255.0)
                pal = _classify_rgb_palette(r, g, b, float(med[8]), float(med[9]), float(med[10]))
                pal["rgb"] = [int(np.clip(round(r), 0, 255)), int(np.clip(round(g), 0, 255)), int(np.clip(round(b), 0, 255))]
                pal["hex"] = f"#{pal['rgb'][0]:02x}{pal['rgb'][1]:02x}{pal['rgb'][2]:02x}"
                self.cluster_palettes[str(c)] = pal
            else:
                self.cluster_palettes[str(c)] = {
                    "family": "amber" if c == 0 else "blue",
                    "label_ar": "فريق 1" if c == 0 else "فريق 2",
                    "ring": "#f59e0b" if c == 0 else "#38bdf8",
                    "primary": "#d97706" if c == 0 else "#0284c7",
                    "rgb": [245, 158, 11] if c == 0 else [56, 189, 248],
                    "hex": "#f59e0b" if c == 0 else "#38bdf8",
                }

        # Ensure high visual contrast between Cluster 0 and Cluster 1 rings
        p0 = self.cluster_palettes.get("0", {})
        p1 = self.cluster_palettes.get("1", {})
        if p0.get("ring") == p1.get("ring"):
            self.cluster_palettes["1"] = {**p1, "ring": "#facc15" if p0.get("ring") != "#facc15" else "#38bdf8"}

    def predict(self, features: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Returns (labels in {0,1,-1}, [0..1] separation margin confidence)."""
        if self.kmeans is None or len(features) == 0:
            return np.full(len(features), -1, dtype=int), np.zeros(len(features), dtype=np.float32)
        Xw = self._weight(features)
        dist = self.kmeans.transform(Xw)
        labels = dist.argmin(axis=1).astype(int)
        dmin = dist.min(axis=1)
        dmax = dist.max(axis=1)
        confs = np.clip(1.0 - (dmin / np.maximum(dmax, 1e-5)), 0.0, 1.0).astype(np.float32)

        if self.referee_center is not None:
            d_ref = np.linalg.norm(Xw - self.referee_center[None, :], axis=1)
            is_ref = d_ref < (dmin * 0.92)
            labels = np.where(is_ref, -1, labels)
            confs = np.where(is_ref, 0.0, confs)
        else:
            is_out = dmin > self.outlier_threshold
            labels = np.where(is_out, -1, labels)
            confs = np.where(is_out, 0.0, confs)

        return labels.astype(int), confs

    def team_kit_palette(self) -> dict[str, dict]:
        return dict(self.cluster_palettes)

    def centroid_colors_bgr(self) -> list[tuple[int, int, int]]:
        if not self.cluster_palettes:
            return []
        out = []
        for c in ("0", "1"):
            rgb = self.cluster_palettes.get(c, {}).get("rgb", [245, 158, 11])
            out.append((int(rgb[2]), int(rgb[1]), int(rgb[0])))
        return out


class JerseyOCR:
    """EasyOCR digit reader for shirt numbers, caching models on Drive D."""

    def __init__(self, gpu: bool = False, model_dir: str | None = None):
        import easyocr
        from core.config import get_settings

        cache_path = model_dir or str(get_settings().cache_dir / "easyocr")
        self.reader = easyocr.Reader(
            ["en"],
            gpu=gpu,
            verbose=False,
            model_storage_directory=cache_path,
        )

    def read(self, frame_bgr: np.ndarray, box: np.ndarray) -> tuple[int, float] | None:
        x1, y1, x2, y2 = box.astype(int)
        h, w = y2 - y1, x2 - x1
        if h < 55 or w < 18:
            return None
        H, W = frame_bgr.shape[:2]
        ty1, ty2 = max(0, y1 + int(0.12 * h)), min(H, y1 + int(0.55 * h))
        tx1, tx2 = max(0, x1), min(W, x2)
        crop = frame_bgr[ty1:ty2, tx1:tx2]
        if crop.size == 0:
            return None
        scale = 96.0 / max(1, crop.shape[0])
        crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        results = self.reader.readtext(gray, allowlist="0123456789", detail=1, paragraph=False)
        best: tuple[int, float] | None = None
        for _bbox, text, conf in results:
            text = text.strip()
            if not text or len(text) > 2:
                continue
            num = int(text)
            if 1 <= num <= 99 and conf >= 0.40 and (best is None or conf > best[1]):
                best = (num, float(conf))
        return best


class JerseyVoter:
    """Majority vote per track: a track locks to a number once it dominates its readings."""

    def __init__(self, min_votes: int = 3, min_share: float = 0.6):
        self.votes: dict[int, Counter] = defaultdict(Counter)
        self.min_votes = min_votes
        self.min_share = min_share

    def add(self, track_id: int, number: int) -> None:
        self.votes[track_id][number] += 1

    def resolve(self, track_id: int) -> int | None:
        c = self.votes.get(track_id)
        if not c:
            return None
        num, n = c.most_common(1)[0]
        total = sum(c.values())
        if n >= self.min_votes and n / total >= self.min_share:
            return int(num)
        return None

    def all_resolved(self) -> dict[int, int]:
        out = {}
        for tid in self.votes:
            r = self.resolve(tid)
            if r is not None:
                out[tid] = r
        return out
