"""4-Layer Zero-Referee-Leak Shield with Physical Smoothing & Realistic Cardinality Caps.

Rules enforced:
  - Layer 1: Detector role prior (player / goalkeeper / referee / ball)
  - Layer 2: SigLIP + UMAP + 3-Class Clustering + calibrated margin/softmax confidence (< 0.65 rejected)
  - Layer 3: Touchline geometric rule (y_m < 1.2m or y_m > 66.8m -> assistant_referee)
  - Layer 4: Track-Level Temporal Voting + Spatial Penalty-Box Goalkeeper Separation
  - Physical Realism Guardrails:
      * Short noisy tracks (< min_track_frames in real clips) -> 'unassigned' (never inflate referee count)
      * Realistic match referee cap: max 1 main referee track + max 2 assistant referee tracks
        (<= 4 total official tracks even across tracker splits); all other low-confidence outliers -> 'unassigned'
      * Coordinate median smoothing + strict physical speed cap (<= 36.0 km/h)
"""
from __future__ import annotations

import sys
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

from packages.shared_contracts.config import get_repo_root


def _try_import_sports_team_classifier() -> Optional[type]:
    sports_root = get_repo_root() / "open_source_engines" / "sports"
    if sports_root.is_dir() and str(sports_root) not in sys.path:
        sys.path.insert(0, str(sports_root))
    try:
        from sports.common.team import TeamClassifier  # type: ignore

        return TeamClassifier
    except Exception:
        return None


@dataclass
class RefereeShieldConfig:
    pitch_length_m: float = 105.0
    pitch_width_m: float = 68.0
    touchline_margin_m: float = 1.2
    touchline_outer_m: float = 5.0
    penalty_box_length_m: float = 16.5
    penalty_box_y_min_m: float = 13.84
    penalty_box_y_max_m: float = 54.16
    gk_box_track_ratio: float = 0.55
    gk_max_x_span_m: float = 28.0
    min_team_conf: float = 0.65
    detector_ref_conf: float = 0.60
    detector_gk_conf: float = 0.65
    touchline_track_ratio: float = 0.40
    min_track_frames: int = 25  # applied automatically when clip has >= 50 unique frames
    max_main_referees: int = 1
    max_assistant_referees: int = 2
    max_speed_kmh: float = 36.0
    n_clusters: int = 3
    umap_n_components: int = 3
    siglip_model_name: str = "google/siglip-base-patch16-224"
    random_state: int = 42


def extract_torso_crop(
    frame_bgr: np.ndarray,
    bbox: tuple[float, float, float, float] | list[float],
    min_size: int = 4,
) -> Optional[np.ndarray]:
    if frame_bgr is None or frame_bgr.size == 0:
        return None
    h, w = frame_bgr.shape[:2]
    x1, y1, x2, y2 = [float(v) for v in bbox]
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)

    pad_x = 0.18 if bw >= 16.0 else 0.05
    tx1 = int(max(0, min(w - 1, round(x1 + pad_x * bw))))
    tx2 = int(max(tx1 + 1, min(w, round(x1 + (1.0 - pad_x) * bw))))
    ty1 = int(max(0, min(h - 1, round(y1 + 0.12 * bh))))
    ty2 = int(max(ty1 + 1, min(h, round(y1 + 0.62 * bh))))

    crop = frame_bgr[ty1:ty2, tx1:tx2]
    if crop.shape[0] < min_size or crop.shape[1] < min_size:
        return None
    return crop


def _compute_cluster_confidences(
    points: np.ndarray, centroids: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    dists = np.linalg.norm(points[:, None, :] - centroids[None, :, :], axis=2)
    order = np.argsort(dists, axis=1)
    labels = order[:, 0]

    if len(centroids) >= 2:
        pair_dists = [
            float(np.linalg.norm(centroids[i] - centroids[j]))
            for i in range(len(centroids))
            for j in range(i + 1, len(centroids))
        ]
        scale = max(float(np.median(pair_dists)) * 0.45, 1e-4)
        d1 = dists[np.arange(len(points)), order[:, 0]]
        d2 = dists[np.arange(len(points)), order[:, 1]]
        margin = np.clip((d2 - d1) / np.clip(d2, 1e-6, None), 0.0, 1.0)
    else:
        scale = 1.0
        margin = np.ones(len(points), dtype=np.float32)

    logits = -(dists / scale)
    logits -= logits.max(axis=1, keepdims=True)
    probs = np.exp(logits)
    probs /= np.clip(probs.sum(axis=1, keepdims=True), 1e-8, None)
    p_top = probs[np.arange(len(points)), labels]
    confs = np.clip(0.5 * p_top + 0.5 * margin, 0.0, 1.0)
    return labels.astype(int), confs.astype(np.float32)


def smooth_track_coordinates(
    df: pd.DataFrame, max_speed_kmh: float = 36.0
) -> pd.DataFrame:
    """Apply median filter + physical jump rejection (<= 36.0 km/h) per track."""
    if df.empty or "x_m" not in df.columns or "y_m" not in df.columns:
        return df

    out = df.copy()
    max_mps = max_speed_kmh / 3.6

    for tid, idxs in out.groupby("track_id").groups.items():
        if int(tid) < 0 or len(idxs) < 3:
            continue
        grp = out.loc[idxs].sort_values("frame_id")
        ordered_idx = grp.index.to_numpy()
        xs = grp["x_m"].to_numpy(dtype=np.float64)
        ys = grp["y_m"].to_numpy(dtype=np.float64)
        ts = grp["time_s"].to_numpy(dtype=np.float64) if "time_s" in grp.columns else np.arange(len(grp), dtype=np.float64) * 0.16

        valid = np.isfinite(xs) & np.isfinite(ys)
        if valid.sum() < 3:
            continue

        # 5-point rolling median filter to remove homography jitter
        xs_s = pd.Series(xs).rolling(window=5, min_periods=1, center=True).median().to_numpy(copy=True)
        ys_s = pd.Series(ys).rolling(window=5, min_periods=1, center=True).median().to_numpy(copy=True)

        # Clamp any physically impossible single-step jump (> max_speed_kmh)
        for i in range(1, len(xs_s)):
            if not (np.isfinite(xs_s[i]) and np.isfinite(xs_s[i - 1])):
                continue
            dt = max(float(ts[i] - ts[i - 1]), 0.04)
            dx = xs_s[i] - xs_s[i - 1]
            dy = ys_s[i] - ys_s[i - 1]
            dist = float(np.hypot(dx, dy))
            max_step = max_mps * dt
            if dist > max_step and dist > 1e-6:
                ratio = max_step / dist
                xs_s[i] = xs_s[i - 1] + dx * ratio
                ys_s[i] = ys_s[i - 1] + dy * ratio

        out.loc[ordered_idx, "x_m"] = xs_s.astype(np.float32)
        out.loc[ordered_idx, "y_m"] = ys_s.astype(np.float32)

    return out


class SigLIPThreeClassClusterer:
    """Layer 2 visual separator: SigLIP + UMAP + 3-Class KMeans (team_a / team_b / outlier)."""

    def __init__(
        self,
        device: str = "cpu",
        batch_size: int = 32,
        config: Optional[RefereeShieldConfig] = None,
        backend: str = "siglip",
    ):
        self.device = device
        self.batch_size = batch_size
        self.config = config or RefereeShieldConfig()
        self.backend = backend

        self._sports_tc: Any = None
        self._features_model: Any = None
        self._processor: Any = None
        self._reducer: Any = None
        self._kmeans: Optional[KMeans] = None
        self._cluster_to_label: dict[int, tuple[str, str]] = {}
        self._fitted = False

    def _ensure_siglip_loaded(self) -> None:
        if self._sports_tc is not None or self._features_model is not None:
            return
        import os

        hf_cache = get_repo_root() / ".cache" / "hf"
        hf_cache.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(hf_cache))

        import torch
        from transformers import AutoImageProcessor, SiglipVisionModel

        self._features_model = SiglipVisionModel.from_pretrained(
            self.config.siglip_model_name
        ).to(self.device)
        self._features_model.eval()
        self._processor = AutoImageProcessor.from_pretrained(self.config.siglip_model_name)

    def extract_embeddings(self, crops: list[np.ndarray]) -> np.ndarray:
        if not crops:
            return np.empty((0, 3), dtype=np.float32)

        if self.backend == "lab_hist":
            feats = []
            for crop in crops:
                resized = cv2.resize(crop, (32, 32), interpolation=cv2.INTER_AREA)
                lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB).astype(np.float32)
                hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV).astype(np.float32)
                bgr_i = resized.astype(np.int32)
                grass = ((hsv[:, :, 0] >= 24) & (hsv[:, :, 0] <= 98) & (hsv[:, :, 1] >= 25)) | (
                    (bgr_i[:, :, 1] > bgr_i[:, :, 2] + 6) & (bgr_i[:, :, 1] > bgr_i[:, :, 0] + 6)
                )
                fg = ~grass
                if int(fg.sum()) >= 16:
                    mean = lab[fg].mean(axis=0) / 255.0
                    std = lab[fg].std(axis=0) / 255.0
                    h_mean = hsv[:, :, 0][fg].mean() / 180.0
                    s_mean = hsv[:, :, 1][fg].mean() / 255.0
                    v_mean = hsv[:, :, 2][fg].mean() / 255.0
                else:
                    mean = lab.mean(axis=(0, 1)) / 255.0
                    std = lab.std(axis=(0, 1)) / 255.0
                    h_mean = hsv[:, :, 0].mean() / 180.0
                    s_mean = hsv[:, :, 1].mean() / 255.0
                    v_mean = hsv[:, :, 2].mean() / 255.0
                feats.append(np.concatenate([mean, std, [h_mean, s_mean, v_mean]]))
            return np.asarray(feats, dtype=np.float32)

        self._ensure_siglip_loaded()
        if self._sports_tc is not None:
            return np.asarray(self._sports_tc.extract_features(crops), dtype=np.float32)

        import torch
        from PIL import Image

        pil_crops = [Image.fromarray(cv2.cvtColor(c, cv2.COLOR_BGR2RGB)) for c in crops]
        outputs_list = []
        with torch.no_grad():
            for i in range(0, len(pil_crops), self.batch_size):
                batch = pil_crops[i : i + self.batch_size]
                inputs = self._processor(images=batch, return_tensors="pt").to(self.device)
                out = self._features_model(**inputs)
                emb = torch.mean(out.last_hidden_state, dim=1).cpu().numpy()
                outputs_list.append(emb)
        return np.concatenate(outputs_list, axis=0).astype(np.float32)

    def _fit_reduce(self, embeddings: np.ndarray) -> np.ndarray:
        n_samples = len(embeddings)
        if self.backend == "siglip" and n_samples >= 10:
            try:
                import umap

                n_neighbors = min(15, max(3, n_samples - 1))
                n_comp = min(self.config.umap_n_components, max(2, n_samples - 2))
                self._reducer = umap.UMAP(
                    n_components=n_comp,
                    n_neighbors=n_neighbors,
                    random_state=self.config.random_state,
                )
                return np.asarray(self._reducer.fit_transform(embeddings), dtype=np.float32)
            except Exception:
                self._reducer = None
        return embeddings.astype(np.float32)

    def _transform_reduce(self, embeddings: np.ndarray) -> np.ndarray:
        if self._reducer is not None:
            return np.asarray(self._reducer.transform(embeddings), dtype=np.float32)
        return embeddings.astype(np.float32)

    def fit_embeddings(self, embeddings: np.ndarray) -> "SigLIPThreeClassClusterer":
        if len(embeddings) < 3:
            raise ValueError("Need at least 3 samples to fit 3-class clusterer.")

        proj = self._fit_reduce(embeddings)
        k = min(self.config.n_clusters, len(proj))
        self._kmeans = KMeans(n_clusters=k, n_init=10, random_state=self.config.random_state)
        raw_labels = self._kmeans.fit_predict(proj)

        counts = [(int((raw_labels == cid).sum()), cid) for cid in range(k)]
        counts.sort(reverse=True)
        total_pts = max(1, len(proj))

        self._cluster_to_label = {}
        if k >= 3:
            team_cids = sorted([counts[0][1], counts[1][1]])
            self._cluster_to_label[team_cids[0]] = ("player", "team_a")
            self._cluster_to_label[team_cids[1]] = ("player", "team_b")
            c0_center = self._kmeans.cluster_centers_[team_cids[0]]
            c1_center = self._kmeans.cluster_centers_[team_cids[1]]
            for cnt_val, cid in counts[2:]:
                # Only treat the 3rd cluster as referee outlier if its cardinality is realistically small (<= 18% of crops)
                if cnt_val <= max(4, int(0.18 * total_pts)):
                    self._cluster_to_label[cid] = ("referee", "none")
                else:
                    c_center = self._kmeans.cluster_centers_[cid]
                    d0 = float(np.linalg.norm(c_center - c0_center))
                    d1 = float(np.linalg.norm(c_center - c1_center))
                    self._cluster_to_label[cid] = ("player", "team_a" if d0 <= d1 else "team_b")
        elif k == 2:
            self._cluster_to_label[0] = ("player", "team_a")
            self._cluster_to_label[1] = ("player", "team_b")
        else:
            self._cluster_to_label[0] = ("player", "team_a")

        self._fitted = True
        return self

    def fit(self, crops: list[np.ndarray]) -> "SigLIPThreeClassClusterer":
        return self.fit_embeddings(self.extract_embeddings(crops))

    def predict_embeddings(
        self, embeddings: np.ndarray
    ) -> list[tuple[str, str, float, str]]:
        if not self._fitted or self._kmeans is None:
            raise RuntimeError("SigLIPThreeClassClusterer must be fitted before predict.")
        if len(embeddings) == 0:
            return []

        proj = self._transform_reduce(embeddings)
        cluster_ids, confs = _compute_cluster_confidences(proj, self._kmeans.cluster_centers_)
        results: list[tuple[str, str, float, str]] = []
        for cid, conf in zip(cluster_ids, confs):
            role, team = self._cluster_to_label[int(cid)]
            conf_f = float(conf)
            if role == "player" and conf_f < self.config.min_team_conf:
                results.append(("referee", "none", 1.0 - conf_f, "layer2_low_conf_reject"))
            elif role == "referee":
                results.append(("referee", "none", conf_f, "layer2_3class_outlier"))
            else:
                results.append((role, team, conf_f, "layer2_siglip_3class"))
        return results

    def predict(self, crops: list[np.ndarray]) -> list[tuple[str, str, float, str]]:
        return self.predict_embeddings(self.extract_embeddings(crops))


class ZeroRefereeLeakShield:
    """Orchestrates all 4 layers + physical smoothing + realistic match referee caps."""

    def __init__(
        self,
        config: Optional[RefereeShieldConfig] = None,
        clusterer: Optional[SigLIPThreeClassClusterer] = None,
    ):
        self.config = config or RefereeShieldConfig()
        self.clusterer = clusterer
        if self.clusterer is not None:
            self.clusterer.config.min_team_conf = self.config.min_team_conf

    def _apply_layer3_touchline(
        self, x_m: Optional[float], y_m: Optional[float]
    ) -> Optional[tuple[str, str, float, bool, str]]:
        if x_m is None or y_m is None or np.isnan(x_m) or np.isnan(y_m):
            return None
        cfg = self.config
        in_x_touchline = -5.0 <= x_m <= (cfg.pitch_length_m + 5.0)
        on_top_touchline = -cfg.touchline_outer_m <= y_m < cfg.touchline_margin_m
        on_bot_touchline = (
            (cfg.pitch_width_m - cfg.touchline_margin_m)
            < y_m
            <= (cfg.pitch_width_m + cfg.touchline_outer_m)
        )
        if in_x_touchline and (on_top_touchline or on_bot_touchline):
            return ("assistant_referee", "none", 0.96, False, "layer3_touchline_rule")

        far_outside = (
            x_m < -5.0
            or x_m > (cfg.pitch_length_m + 5.0)
            or y_m < -cfg.touchline_outer_m
            or y_m > (cfg.pitch_width_m + cfg.touchline_outer_m)
        )
        if far_outside:
            return ("staff", "none", 0.92, False, "layer3_off_pitch_staff")
        return None

    def apply(
        self,
        df: pd.DataFrame,
        embeddings: Optional[np.ndarray] = None,
        crops: Optional[list[Optional[np.ndarray]]] = None,
    ) -> pd.DataFrame:
        if df.empty:
            return df.copy()

        out = smooth_track_coordinates(
            df.copy().reset_index(drop=True),
            max_speed_kmh=self.config.max_speed_kmh,
        )
        n = len(out)

        l2_preds: dict[int, tuple[str, str, float, str]] = {}
        if self.clusterer is not None:
            if embeddings is not None and len(embeddings) == n:
                if not self.clusterer._fitted:
                    self.clusterer.fit_embeddings(embeddings)
                preds = self.clusterer.predict_embeddings(embeddings)
                l2_preds = {i: preds[i] for i in range(n)}
            elif crops is not None and len(crops) == n:
                valid_idx = [i for i, c in enumerate(crops) if c is not None]
                valid_crops = [crops[i] for i in valid_idx if crops[i] is not None]
                if valid_crops:
                    if not self.clusterer._fitted and len(valid_crops) >= 3:
                        self.clusterer.fit(valid_crops)
                    if self.clusterer._fitted:
                        preds = self.clusterer.predict(valid_crops)
                        for idx, p in zip(valid_idx, preds):
                            l2_preds[idx] = p

        frame_roles: list[str] = []
        frame_teams: list[str] = []
        frame_role_confs: list[float] = []
        frame_team_confs: list[float] = []
        frame_on_pitch: list[bool] = []
        frame_layers: list[str] = []
        touchline_flags: list[bool] = []

        for i, row in out.iterrows():
            det_role = str(row.get("role", "player")).lower()
            det_conf = float(row.get("role_conf", row.get("conf", 0.5)) or 0.5)
            cur_team = str(row.get("team", "none"))
            cur_team_conf = float(row.get("team_conf", 0.0) or 0.0)
            x_m = row.get("x_m", np.nan)
            y_m = row.get("y_m", np.nan)
            on_pitch = bool(row.get("on_pitch", True))

            if det_role == "ball":
                frame_roles.append("ball")
                frame_teams.append("none")
                frame_role_confs.append(det_conf)
                frame_team_confs.append(0.0)
                frame_on_pitch.append(on_pitch)
                frame_layers.append("layer1_ball")
                touchline_flags.append(False)
                continue

            l3 = self._apply_layer3_touchline(
                float(x_m) if pd.notna(x_m) else None,
                float(y_m) if pd.notna(y_m) else None,
            )
            if l3 is not None:
                r3, t3, c3, op3, src3 = l3
                frame_roles.append(r3)
                frame_teams.append(t3)
                frame_role_confs.append(c3)
                frame_team_confs.append(0.0)
                frame_on_pitch.append(op3)
                frame_layers.append(src3)
                touchline_flags.append(r3 == "assistant_referee")
                continue

            touchline_flags.append(False)

            if det_role == "referee" and det_conf >= self.config.detector_ref_conf:
                frame_roles.append("referee")
                frame_teams.append("none")
                frame_role_confs.append(det_conf)
                frame_team_confs.append(0.0)
                frame_on_pitch.append(on_pitch)
                frame_layers.append("layer1_detector_referee")
                continue

            if det_role == "goalkeeper" and det_conf >= self.config.detector_gk_conf:
                gk_team = cur_team
                gk_tconf = cur_team_conf
                if i in l2_preds and l2_preds[i][1] in ("team_a", "team_b"):
                    gk_team = l2_preds[i][1]
                    gk_tconf = l2_preds[i][2]
                frame_roles.append("goalkeeper")
                frame_teams.append(gk_team)
                frame_role_confs.append(det_conf)
                frame_team_confs.append(gk_tconf)
                frame_on_pitch.append(on_pitch)
                frame_layers.append("layer1_detector_gk")
                continue

            if i in l2_preds:
                r2, t2, c2, src2 = l2_preds[i]
                frame_roles.append(r2)
                frame_teams.append(t2)
                frame_role_confs.append(c2)
                frame_team_confs.append(c2 if t2 in ("team_a", "team_b") else 0.0)
                frame_on_pitch.append(on_pitch)
                frame_layers.append(src2)
                continue

            if cur_team in ("team_a", "team_b") and cur_team_conf < self.config.min_team_conf:
                frame_roles.append("referee")
                frame_teams.append("none")
                frame_role_confs.append(1.0 - cur_team_conf)
                frame_team_confs.append(0.0)
                frame_on_pitch.append(on_pitch)
                frame_layers.append("layer2_low_conf_reject")
            else:
                frame_roles.append(det_role)
                frame_teams.append(cur_team)
                frame_role_confs.append(det_conf)
                frame_team_confs.append(cur_team_conf)
                frame_on_pitch.append(on_pitch)
                frame_layers.append("layer1_passthrough")

        out["role"] = frame_roles
        out["team"] = frame_teams
        out["role_conf"] = np.asarray(frame_role_confs, dtype=np.float32)
        out["team_conf"] = np.asarray(frame_team_confs, dtype=np.float32)
        out["on_pitch"] = frame_on_pitch
        out["source_layer"] = frame_layers
        out["_touchline"] = touchline_flags

        out = self._apply_layer4_temporal_voting_and_caps(out)
        return out.drop(columns=["_touchline"])

    def _infer_team_sides_x(self, df: pd.DataFrame) -> dict[str, float]:
        sides: dict[str, float] = {}
        for team in ("team_a", "team_b"):
            sub = df[(df["role"] == "player") & (df["team"] == team) & df["x_m"].notna()]
            if not sub.empty:
                sides[team] = float(sub["x_m"].median())
        return sides

    def _is_goalkeeper_track(self, grp: pd.DataFrame) -> Optional[str]:
        cfg = self.config
        cal = grp[grp["x_m"].notna() & grp["y_m"].notna()]
        if cal.empty:
            return None
        xs = cal["x_m"].to_numpy(dtype=np.float32)
        ys = cal["y_m"].to_numpy(dtype=np.float32)
        if float(xs.max() - xs.min()) > cfg.gk_max_x_span_m:
            return None
        in_y = (ys >= cfg.penalty_box_y_min_m) & (ys <= cfg.penalty_box_y_max_m)
        in_left = (xs >= -1.0) & (xs <= cfg.penalty_box_length_m) & in_y
        in_right = (xs >= cfg.pitch_length_m - cfg.penalty_box_length_m) & (xs <= cfg.pitch_length_m + 1.0) & in_y
        if float(in_left.mean()) >= cfg.gk_box_track_ratio:
            return "left"
        if float(in_right.mean()) >= cfg.gk_box_track_ratio:
            return "right"
        return None

    def _apply_layer4_temporal_voting_and_caps(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        layer_weights = {
            "layer3_touchline_rule": 2.5,
            "layer3_off_pitch_staff": 2.0,
            "layer1_detector_referee": 1.8,
            "layer1_detector_gk": 1.6,
            "layer2_3class_outlier": 1.5,
            "layer2_low_conf_reject": 1.3,
            "layer2_siglip_3class": 1.2,
            "layer1_passthrough": 1.0,
            "layer1_ball": 2.0,
        }
        team_x_medians = self._infer_team_sides_x(out)
        n_clip_frames = int(out["frame_id"].nunique()) if "frame_id" in out.columns else 0
        uniq_fids = np.sort(out["frame_id"].unique()) if "frame_id" in out.columns else np.array([])
        est_stride = int(max(1, round(float(np.median(np.diff(uniq_fids)))))) if len(uniq_fids) >= 2 else 1
        enforce_min_frames = (n_clip_frames * est_stride) >= 120
        # Equivalent sampled rows for >= min_track_frames raw video frames
        min_sampled_rows = max(4, int(np.ceil(self.config.min_track_frames / est_stride)))

        main_ref_candidates: list[tuple[float, int, Any]] = []
        top_ar_candidates: list[tuple[float, int, Any]] = []
        bot_ar_candidates: list[tuple[float, int, Any]] = []
        left_gk_candidates: list[tuple[float, int, Any, str]] = []
        right_gk_candidates: list[tuple[float, int, Any, str]] = []

        for track_id, idxs in out.groupby("track_id").groups.items():
            tid = int(track_id)
            if tid < 0:
                continue
            grp = out.loc[idxs]
            if (grp["role"] == "ball").all():
                continue

            # Touchline persistence -> assistant referee candidate
            cal_mask = grp["y_m"].notna()
            if cal_mask.any():
                touch_ratio = float(grp.loc[cal_mask, "_touchline"].mean())
                if touch_ratio >= self.config.touchline_track_ratio:
                    med_y = float(grp.loc[cal_mask, "y_m"].median())
                    dist_to_line = abs(med_y) if med_y < (self.config.pitch_width_m / 2.0) else abs(self.config.pitch_width_m - med_y)
                    line_proximity = 1.0 / (0.3 + dist_to_line)
                    score = touch_ratio * line_proximity * float(np.sqrt(len(grp)))
                    if med_y < (self.config.pitch_width_m / 2.0):
                        top_ar_candidates.append((score, tid, idxs))
                    else:
                        bot_ar_candidates.append((score, tid, idxs))
                    out.loc[idxs, "role"] = "unassigned"
                    out.loc[idxs, "team"] = "none"
                    out.loc[idxs, "on_pitch"] = False
                    out.loc[idxs, "role_conf"] = round(touch_ratio, 4)
                    out.loc[idxs, "team_conf"] = 0.0
                    out.loc[idxs, "source_layer"] = "layer4_touchline_candidate"
                    continue

            role_scores: dict[str, float] = defaultdict(float)
            team_scores: dict[str, float] = defaultdict(float)
            for _, r in grp.iterrows():
                w = layer_weights.get(str(r["source_layer"]), 1.0)
                conf = max(0.1, float(r["role_conf"]))
                role_scores[str(r["role"])] += w * conf
                if str(r["team"]) in ("team_a", "team_b"):
                    team_scores[str(r["team"])] += w * max(0.1, float(r["team_conf"]))

            best_role = max(role_scores.items(), key=lambda kv: kv[1])[0]
            total_role_w = sum(role_scores.values()) or 1.0
            locked_role_conf = round(role_scores[best_role] / total_role_w, 4)

            # Spatial penalty-box GK candidate (strictly stitched & capped to max 1 per goal end!)
            gk_end = self._is_goalkeeper_track(grp)
            has_detector_gk = bool((grp["source_layer"] == "layer1_detector_gk").any())
            if gk_end is not None and (
                best_role in ("referee", "goalkeeper")
                or has_detector_gk
                or float(grp["team_conf"].mean()) < self.config.min_team_conf
            ):
                goal_x = 0.0 if gk_end == "left" else self.config.pitch_length_m
                gk_team = (
                    min(team_x_medians.items(), key=lambda kv: abs(kv[1] - goal_x))[0]
                    if team_x_medians
                    else ("team_a" if gk_end == "left" else "team_b")
                )
                med_x = float(grp["x_m"].dropna().median()) if grp["x_m"].notna().any() else goal_x
                goal_prox = 1.0 / (1.5 + abs(med_x - goal_x))
                det_gk_boost = 2.6 if has_detector_gk else (1.5 if best_role == "goalkeeper" else 0.8)
                gk_score = float(np.sqrt(max(1, len(grp)))) * goal_prox * det_gk_boost
                if gk_end == "left":
                    left_gk_candidates.append((gk_score, tid, idxs, gk_team))
                else:
                    right_gk_candidates.append((gk_score, tid, idxs, gk_team))
                # Temporarily mark as normal player (or unassigned if no team) until canonical GK winner is picked
                fallback_team = (
                    max(team_scores.items(), key=lambda kv: kv[1])[0] if team_scores else gk_team
                )
                out.loc[idxs, "role"] = "player" if fallback_team in ("team_a", "team_b") else "unassigned"
                out.loc[idxs, "team"] = fallback_team if fallback_team in ("team_a", "team_b") else "none"
                out.loc[idxs, "on_pitch"] = True
                out.loc[idxs, "role_conf"] = float(locked_role_conf)
                out.loc[idxs, "team_conf"] = float(grp["team_conf"].mean()) if team_scores else 0.5
                out.loc[idxs, "source_layer"] = "layer4_temporal_vote"
                continue
            elif best_role == "goalkeeper":
                # Detector predicted goalkeeper outside penalty box -> downgrade to outfield player unless strong
                if team_scores:
                    best_role = "player"
                else:
                    out.loc[idxs, "role"] = "unassigned"
                    out.loc[idxs, "team"] = "none"
                    out.loc[idxs, "role_conf"] = float(locked_role_conf)
                    out.loc[idxs, "team_conf"] = 0.0
                    out.loc[idxs, "source_layer"] = "layer4_unassigned_low_conf"
                    continue

            if best_role == "referee":
                has_detector_ref = bool((grp["source_layer"] == "layer1_detector_referee").any())
                is_strong_duration = (
                    (not enforce_min_frames)
                    or (len(grp) >= min_sampled_rows)
                    or ((has_detector_ref or locked_role_conf >= 0.95) and len(grp) >= 4)
                )
                if is_strong_duration:
                    med_y = float(grp["y_m"].median()) if cal_mask.any() else 34.0
                    centrality = max(0.2, 1.0 - abs(med_y - 34.0) / 40.0)
                    f_span = max(float(len(grp) * est_stride), float(grp["frame_id"].max() - grp["frame_id"].min() + 1))
                    det_boost = 2.4 if has_detector_ref else (1.35 if locked_role_conf >= 0.95 else 1.0)
                    # Reward strongest referee evidence (YOLO-confirmed / high role_conf) + central field persistence
                    score = float(np.sqrt(f_span)) * float(grp["role_conf"].mean()) * centrality * det_boost
                    main_ref_candidates.append((score, tid, idxs))
                out.loc[idxs, "role"] = "unassigned"
                out.loc[idxs, "team"] = "none"
                out.loc[idxs, "role_conf"] = float(locked_role_conf)
                out.loc[idxs, "team_conf"] = 0.0
                out.loc[idxs, "source_layer"] = "layer4_unassigned_low_conf"
                continue

            if best_role in ("staff", "ball"):
                out.loc[idxs, "role"] = best_role
                out.loc[idxs, "team"] = "none"
                out.loc[idxs, "role_conf"] = float(locked_role_conf)
                out.loc[idxs, "team_conf"] = 0.0
                out.loc[idxs, "source_layer"] = "layer4_temporal_vote"
                continue

            if enforce_min_frames and len(grp) < min_sampled_rows and float(grp["team_conf"].mean()) < 0.72:
                out.loc[idxs, "role"] = "unassigned"
                out.loc[idxs, "team"] = "none"
                out.loc[idxs, "role_conf"] = float(locked_role_conf)
                out.loc[idxs, "team_conf"] = 0.0
                out.loc[idxs, "source_layer"] = "layer4_short_track_filtered"
                continue

            if team_scores:
                best_team = max(team_scores.items(), key=lambda kv: kv[1])[0]
                total_team_w = sum(team_scores.values()) or 1.0
                locked_team = best_team
                locked_team_conf = round(team_scores[best_team] / total_team_w, 4)
            else:
                locked_team = "none"
                locked_team_conf = 0.0

            out.loc[idxs, "role"] = best_role
            out.loc[idxs, "team"] = locked_team
            out.loc[idxs, "role_conf"] = float(locked_role_conf)
            out.loc[idxs, "team_conf"] = float(locked_team_conf)
            out.loc[idxs, "source_layer"] = "layer4_temporal_vote"

        # Canonical stitching of disjoint non-overlapping official segments per physical official:
        # 1 main referee + 1 top assistant referee + 1 bottom assistant referee (<= 3 unique official tracks)
        def _promote_and_stitch(
            cands: list[tuple[float, int, Any]],
            role_name: str,
            source_layer: str,
            is_ar: bool = False,
            max_segments: Optional[int] = None,
        ) -> None:
            cands.sort(key=lambda x: x[0], reverse=True)
            used_frames: set[int] = set()
            promoted: list[tuple[int, int, Any, set[int]]] = []
            for _, tid, idxs in cands:
                if max_segments is not None and len(promoted) >= max_segments:
                    break
                fids = set(int(f) for f in out.loc[idxs, "frame_id"].tolist())
                if fids & used_frames:
                    continue  # Strictly <= 1 active official per physical role per frame
                promoted.append((min(fids), tid, idxs, fids))
                used_frames.update(fids)

            if not promoted:
                return

            canonical_tid = min(promoted, key=lambda x: (x[0], x[1]))[1]
            for _, _, idxs, _ in promoted:
                out.loc[idxs, "role"] = role_name
                out.loc[idxs, "team"] = "none"
                out.loc[idxs, "source_layer"] = source_layer
                if is_ar:
                    out.loc[idxs, "on_pitch"] = False
                    out.loc[idxs, "role_conf"] = 0.96

            for _, tid, idxs, fids in promoted:
                if tid == canonical_tid:
                    continue
                existing = out.loc[out["track_id"] == canonical_tid]
                if not existing["frame_id"].isin(fids).any() and bool((existing["role"] == role_name).all()):
                    out.loc[idxs, "track_id"] = np.int32(canonical_tid)

        _promote_and_stitch(
            main_ref_candidates,
            role_name="referee",
            source_layer="layer4_verified_main_referee",
            is_ar=False,
        )
        _promote_and_stitch(
            top_ar_candidates,
            role_name="assistant_referee",
            source_layer="layer4_verified_touchline_ar",
            is_ar=True,
        )
        _promote_and_stitch(
            bot_ar_candidates,
            role_name="assistant_referee",
            source_layer="layer4_verified_touchline_ar",
            is_ar=True,
        )

        # Canonical stitching of Goalkeepers: strictly max 1 left-end GK + max 1 right-end GK (<= 2 per match!)
        def _promote_and_stitch_gk(cands: list[tuple[float, int, Any, str]]) -> None:
            if not cands:
                return
            cands.sort(key=lambda x: x[0], reverse=True)
            used_frames: set[int] = set()
            promoted: list[tuple[int, int, Any, set[int], str]] = []
            for _, tid, idxs, gk_team in cands:
                fids = set(int(f) for f in out.loc[idxs, "frame_id"].tolist())
                if fids & used_frames:
                    continue  # Strictly <= 1 goalkeeper at this goal end per frame
                promoted.append((min(fids), tid, idxs, fids, gk_team))
                used_frames.update(fids)
            if not promoted:
                return
            canonical_tid = min(promoted, key=lambda x: (x[0], x[1]))[1]
            canonical_team = promoted[0][4]
            for _, _, idxs, _, _ in promoted:
                out.loc[idxs, "role"] = "goalkeeper"
                out.loc[idxs, "team"] = canonical_team
                out.loc[idxs, "on_pitch"] = True
                out.loc[idxs, "role_conf"] = 0.94
                out.loc[idxs, "team_conf"] = 0.92
                out.loc[idxs, "source_layer"] = "layer4_spatial_gk_box"
            for _, tid, idxs, fids, _ in promoted:
                if tid == canonical_tid:
                    continue
                existing = out.loc[out["track_id"] == canonical_tid]
                if not existing["frame_id"].isin(fids).any() and bool((existing["role"] == "goalkeeper").all()):
                    out.loc[idxs, "track_id"] = np.int32(canonical_tid)

        _promote_and_stitch_gk(left_gk_candidates)
        _promote_and_stitch_gk(right_gk_candidates)

        return out
