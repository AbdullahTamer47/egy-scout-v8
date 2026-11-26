"""100% Real Local Autonomous Football CV Pipeline (Master Plan V8 Full Stack).

Wires ALL real computer vision stages specified in docs/master_plan_v8.md:
  1. Specialized 4-Class Football YOLO (`yolo-football-player-detection.pt`: ball, gk, player, ref)
  2. Real 32-Keypoint FIFA Pitch Calibration Homography (`yolo-football-pitch-detection.pt`)
  3. Real SAHI Overlapping Tile Ball Detection (`generate_sahi_tiles`) for 8-16px broadcast balls
  4. Real SigLIP + UMAP + 3-Class Team/Referee Clustering (with cached HuggingFace weights)
  5. 4-Layer Zero-Referee-Leak Shield + Canonical Official & Goalkeeper Stitching (<= 3 refs, <= 2 GKs)
  6. Real Appearance Re-ID Track Stitching (`merge_fragmented_tracks_reid`)
  7. CLAHE-Enhanced Jersey Number OCR (PARSeq / EasyOCR + Track-Level Voting)
  8. Dual-Lock Scoreboard OCR Goal Spotter (`scan_video_scoreboard_goals`)
  9. Hybrid URL/YouTube Video Importer (`yt-dlp`)
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
import pandas as pd

from packages.shared_contracts.config import (
    get_repo_root,
    open_video_unicode,
    resolve_project_path,
)
from packages.shared_contracts.schemas import load_legacy_scout5_telemetry
from services.cv_worker.stages.ball_tracker import generate_sahi_tiles
from services.cv_worker.stages.events_spotting import scan_video_scoreboard_goals
from services.cv_worker.stages.jersey_ocr import (
    check_jersey_legibility,
    vote_track_jersey_number,
)
from services.cv_worker.stages.pitch_calib import KeypointPitchCalibrator
from services.cv_worker.stages.referee_shield import (
    RefereeShieldConfig,
    SigLIPThreeClassClusterer,
    ZeroRefereeLeakShield,
    extract_torso_crop,
)
from services.cv_worker.stages.reid_embedder import merge_fragmented_tracks_reid

FOOTBALL_YOLO_REL = (
    Path("egy-tactical-scout") / "backend" / "weights" / "yolo-football-player-detection.pt"
)
_YOLO_MODEL: Any = None
_EASYOCR_READER: Any = None
_SIGLIP_SHARED: Optional[SigLIPThreeClassClusterer] = None
_JERSEY_RE = re.compile(r"\b([1-9][0-9]?)\b")


def get_football_yolo() -> Any:
    """Lazy-load specialized 4-class football YOLO model ({0: ball, 1: goalkeeper, 2: player, 3: referee})."""
    global _YOLO_MODEL
    if _YOLO_MODEL is not None:
        return _YOLO_MODEL
    weights = get_repo_root() / FOOTBALL_YOLO_REL
    if not weights.is_file():
        return None
    from ultralytics import YOLO

    _YOLO_MODEL = YOLO(str(weights))
    return _YOLO_MODEL


def get_local_easyocr() -> Any:
    """Lazy-load local EasyOCR using cached weights in .cache/easyocr."""
    global _EASYOCR_READER
    if _EASYOCR_READER is not None:
        return _EASYOCR_READER
    cache_dir = get_repo_root() / ".cache" / "easyocr"
    if not cache_dir.is_dir():
        return None
    try:
        import easyocr

        _EASYOCR_READER = easyocr.Reader(
            ["en"],
            gpu=False,
            model_storage_directory=str(cache_dir),
            download_enabled=False,
            verbose=False,
        )
        return _EASYOCR_READER
    except Exception:
        return None


def get_siglip_clusterer(prefer_siglip: bool = True) -> SigLIPThreeClassClusterer:
    """Return a SigLIP+UMAP clusterer (reusing loaded vision model weights) with safe fallback."""
    global _SIGLIP_SHARED
    if not prefer_siglip:
        return SigLIPThreeClassClusterer(backend="lab_hist")
    hf_cache = get_repo_root() / ".cache" / "hf"
    os.environ.setdefault("HF_HOME", str(hf_cache))
    try:
        if _SIGLIP_SHARED is None:
            probe = SigLIPThreeClassClusterer(device="cpu", batch_size=16, backend="siglip")
            probe._ensure_siglip_loaded()
            _SIGLIP_SHARED = probe
        # Create a fresh unfitted clusterer sharing the loaded SigLIP backbone!
        c = SigLIPThreeClassClusterer(device="cpu", batch_size=16, backend="siglip")
        c._sports_tc = _SIGLIP_SHARED._sports_tc
        c._features_model = _SIGLIP_SHARED._features_model
        c._processor = _SIGLIP_SHARED._processor
        return c
    except Exception:
        return SigLIPThreeClassClusterer(backend="lab_hist")


def _rgb_to_hex(rgb: tuple[float, float, float]) -> str:
    r, g, b = [int(np.clip(round(v), 0, 255)) for v in rgb]
    hsv = cv2.cvtColor(np.uint8([[[b, g, r]]]), cv2.COLOR_BGR2HSV)[0, 0].astype(np.float32)
    hsv[1] = min(255.0, max(150.0, hsv[1] * 1.45))
    hsv[2] = min(255.0, max(205.0, hsv[2] * 1.25))
    bgr_out = cv2.cvtColor(np.uint8([[hsv]]), cv2.COLOR_HSV2BGR)[0, 0]
    return f"#{int(bgr_out[2]):02x}{int(bgr_out[1]):02x}{int(bgr_out[0]):02x}"


# Canonical RGB kit anchors for Egyptian Premier League & color-named clubs (prevents Team A / Team B swaps!)
_CLUB_KIT_ANCHORS_RGB: list[tuple[tuple[str, ...], tuple[float, float, float]]] = [
    (("الأهلي", "الاهلي", "ahly", "custom red", "red", "أحمر"), (215.0, 32.0, 38.0)),
    (("المصري", "masry", "green", "أخضر"), (22.0, 175.0, 85.0)),
    (("إنبي", "انبي", "enppi", "custom blue", "blue", "أزرق"), (25.0, 88.0, 205.0)),
    (("بيراميدز", "pyramids", "sky", "سماوي"), (18.0, 138.0, 220.0)),
    (("المقاولون", "mokawloon", "yellow", "أصفر"), (235.0, 190.0, 24.0)),
    (("الزمالك", "zamalek", "white", "أبيض"), (238.0, 240.0, 244.0)),
    (("السكة", "sekka"), (30.0, 185.0, 95.0)),
    (("طلائع الجيش", "الجيش", "gaish"), (180.0, 35.0, 45.0)),
]


def _match_club_anchor_rgb(team_name: str) -> Optional[np.ndarray]:
    low = (team_name or "").strip().lower()
    if not low:
        return None
    for keywords, rgb in _CLUB_KIT_ANCHORS_RGB:
        if any(kw in low for kw in keywords):
            return np.asarray(rgb, dtype=np.float32)
    return None


def _rgb_to_lab_vec(rgb: np.ndarray) -> np.ndarray:
    bgr = np.uint8([[np.clip(rgb[::-1], 0, 255)]])
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)


def resolve_team_cluster_mapping(
    c0_rgb: np.ndarray,
    c1_rgb: np.ndarray,
    team_a_name: str = "",
    team_b_name: str = "",
    c0_count: int = 1,
    c1_count: int = 1,
) -> dict[int, str]:
    """Deterministically map visual kit clusters {0, 1} to {'team_a', 'team_b'} using real club kit priors."""
    anchor_a = _match_club_anchor_rgb(team_a_name)
    anchor_b = _match_club_anchor_rgb(team_b_name)
    lab0 = _rgb_to_lab_vec(c0_rgb)
    lab1 = _rgb_to_lab_vec(c1_rgb)

    if anchor_a is not None and anchor_b is not None:
        la = _rgb_to_lab_vec(anchor_a)
        lb = _rgb_to_lab_vec(anchor_b)
        # Compare assignment (0->A, 1->B) vs (1->A, 0->B) in perceptual CIE LAB space
        cost_direct = float(np.linalg.norm(lab0 - la) + np.linalg.norm(lab1 - lb))
        cost_swapped = float(np.linalg.norm(lab1 - la) + np.linalg.norm(lab0 - lb))
        if cost_swapped + 1.0 < cost_direct:
            return {0: "team_b", 1: "team_a"}
        return {0: "team_a", 1: "team_b"}

    if anchor_a is not None:
        la = _rgb_to_lab_vec(anchor_a)
        if float(np.linalg.norm(lab1 - la)) + 1.0 < float(np.linalg.norm(lab0 - la)):
            return {0: "team_b", 1: "team_a"}
        return {0: "team_a", 1: "team_b"}

    if anchor_b is not None:
        lb = _rgb_to_lab_vec(anchor_b)
        if float(np.linalg.norm(lab0 - lb)) + 1.0 < float(np.linalg.norm(lab1 - lb)):
            return {0: "team_b", 1: "team_a"}
        return {0: "team_a", 1: "team_b"}

    if c1_count > c0_count:
        return {0: "team_b", 1: "team_a"}
    return {0: "team_a", 1: "team_b"}


def _is_foot_near_pitch_turf(frame_bgr: np.ndarray, x1: float, y1: float, x2: float, y2: float) -> bool:
    """Reject spectator-stand / ad-board detections whose feet sit completely outside green turf."""
    fh, fw = frame_bgr.shape[:2]
    bw = x2 - x1
    bh = y2 - y1
    if bw < 6.0 or bh < 14.0 or bh / max(1.0, bw) < 0.75 or bh > fh * 0.65:
        return False
    px1 = int(max(0, round(x1 - bw * 0.5)))
    px2 = int(min(fw, round(x2 + bw * 0.5)))
    py1 = int(max(0, round(y2 - bh * 0.25)))
    py2 = int(min(fh, round(y2 + bh * 0.20 + 8)))
    patch = frame_bgr[py1:py2, px1:px2]
    if patch.size == 0:
        return True
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    green = (hsv[:, :, 0] >= 24) & (hsv[:, :, 0] <= 96) & (hsv[:, :, 1] >= 22) & (hsv[:, :, 2] >= 25)
    return float(green.mean()) >= 0.12


def _bbox_iou(a: list[float], b: list[float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return 0.0
    aa = max(1.0, (a[2] - a[0]) * (a[3] - a[1]))
    ab = max(1.0, (b[2] - b[0]) * (b[3] - b[1]))
    return inter / max(1.0, aa + ab - inter)


def _extract_jersey_dominant_rgb(crop_bgr: np.ndarray) -> Optional[np.ndarray]:
    """Compute dominant non-grass RGB of a torso crop (strictly filters out green pitch turf in both HSV and RGB)."""
    if crop_bgr is None or crop_bgr.size == 0:
        return None
    h, w = crop_bgr.shape[:2]
    inner = crop_bgr[max(0, int(h * 0.12)) : max(1, int(h * 0.85)), max(0, int(w * 0.15)) : max(1, int(w * 0.85))]
    if inner.size == 0:
        inner = crop_bgr
    hsv = cv2.cvtColor(inner, cv2.COLOR_BGR2HSV)
    rgb_img = cv2.cvtColor(inner, cv2.COLOR_BGR2RGB).astype(np.int32)
    r_ch, g_ch, b_ch = rgb_img[:, :, 0], rgb_img[:, :, 1], rgb_img[:, :, 2]

    # Strict green turf mask: HSV green range OR green channel strictly dominating red & blue
    grass_hsv = (hsv[:, :, 0] >= 22) & (hsv[:, :, 0] <= 98) & (hsv[:, :, 1] >= 20)
    grass_rgb = (g_ch > (r_ch + 5)) & (g_ch > (b_ch + 5))
    # Also exclude very dark shadow/black shorts pixels (V < 28)
    dark_px = hsv[:, :, 2] < 28
    fg_mask = ~(grass_hsv | grass_rgb | dark_px)

    if int(fg_mask.sum()) >= 5:
        pts = rgb_img[fg_mask].astype(np.float32)
        return np.median(pts, axis=0).astype(np.float32)

    non_grass = ~(grass_hsv | grass_rgb)
    if int(non_grass.sum()) >= 3:
        pts = rgb_img[non_grass].astype(np.float32)
        return np.median(pts, axis=0).astype(np.float32)

    # Last fallback: choose the pixels with the lowest (G - max(R, B)) green excess
    flat_rgb = rgb_img.reshape(-1, 3).astype(np.float32)
    green_excess = flat_rgb[:, 1] - np.maximum(flat_rgb[:, 0], flat_rgb[:, 2])
    best_k = max(1, len(flat_rgb) // 4)
    idx_least_green = np.argsort(green_excess)[:best_k]
    return np.median(flat_rgb[idx_least_green], axis=0).astype(np.float32)


def _extract_appearance_vec(crop_bgr: np.ndarray) -> np.ndarray:
    """Fast 24-dim grass-masked HSV+LAB torso appearance signature for Re-ID stitching."""
    resized = cv2.resize(crop_bgr, (32, 48), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(resized, cv2.COLOR_BGR2LAB)
    grass = (hsv[:, :, 0] >= 30) & (hsv[:, :, 0] <= 88) & (hsv[:, :, 1] >= 45) & (hsv[:, :, 2] >= 40)
    mask = (~grass).astype(np.uint8) * 255
    if int((mask > 0).sum()) < 24:
        mask = None
    h_hist = cv2.calcHist([hsv], [0], mask, [12], [0, 180]).flatten()
    l_hist = cv2.calcHist([lab], [0], mask, [6], [0, 256]).flatten()
    a_hist = cv2.calcHist([lab], [1], mask, [3], [0, 256]).flatten()
    b_hist = cv2.calcHist([lab], [2], mask, [3], [0, 256]).flatten()
    vec = np.concatenate([h_hist, l_hist, a_hist, b_hist]).astype(np.float32)
    norm = float(np.linalg.norm(vec))
    return vec / max(norm, 1e-6)


def _enhance_jersey_crop(crop_bgr: np.ndarray) -> np.ndarray:
    """Upscale 3x + CLAHE luminance boost + subtle unsharp mask for crisp jersey digit OCR."""
    h, w = crop_bgr.shape[:2]
    scale = max(2.5, min(4.0, 96.0 / max(1, h)))
    up = cv2.resize(crop_bgr, (int(round(w * scale)), int(round(h * scale))), interpolation=cv2.INTER_CUBIC)
    lab = cv2.cvtColor(up, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.6, tileGridSize=(4, 4))
    l_eq = clahe.apply(l_ch)
    merged = cv2.cvtColor(cv2.merge([l_eq, a_ch, b_ch]), cv2.COLOR_LAB2BGR)
    blur = cv2.GaussianBlur(merged, (0, 0), 1.0)
    return cv2.addWeighted(merged, 1.45, blur, -0.45, 0)


def _detect_ball_with_sahi(
    yolo: Any,
    frame_bgr: np.ndarray,
    conf: float = 0.22,
) -> Optional[tuple[float, float, float, float, float]]:
    """Run SAHI 2x2 overlapping tiles specifically to recover tiny 8-16px broadcast balls."""
    if yolo is None or frame_bgr is None or frame_bgr.size == 0:
        return None
    h, w = frame_bgr.shape[:2]
    tiles = generate_sahi_tiles(w, h, tile_w=int(w * 0.56), tile_h=int(h * 0.56), overlap=0.18)
    best_ball: Optional[tuple[float, float, float, float, float]] = None
    for tx1, ty1, tx2, ty2 in tiles:
        tile = frame_bgr[ty1:ty2, tx1:tx2]
        if tile.size == 0:
            continue
        try:
            res = yolo.predict(tile, imgsz=640, conf=conf, classes=[0], verbose=False)[0]
        except Exception:
            continue
        if res.boxes is None or len(res.boxes) == 0:
            continue
        boxes = res.boxes.xyxy.cpu().numpy()
        confs = res.boxes.conf.cpu().numpy()
        for b, cf in zip(boxes, confs):
            bw = float(b[2] - b[0])
            bh = float(b[3] - b[1])
            # Physical broadcast ball size sanity check (avoid stadium logos / spot lights)
            if bw > 54.0 or bh > 54.0 or max(bw, bh) / max(1.0, min(bw, bh)) > 2.2:
                continue
            cand = (float(b[0]) + tx1, float(b[1]) + ty1, float(b[2]) + tx1, float(b[3]) + ty1, float(cf))
            if best_ball is None or cand[4] > best_ball[4]:
                best_ball = cand
    return best_ball


def _estimate_frame_homography_from_players(sub: pd.DataFrame) -> Optional[np.ndarray]:
    """Recover local pixel->pitch homography H from >=4 calibrated players in a frame."""
    cal = sub[sub["x_m"].notna() & sub["y_m"].notna() & sub["x1"].notna() & sub["y2"].notna()]
    if len(cal) < 4:
        return None
    src = np.column_stack([
        0.5 * (cal["x1"].to_numpy(dtype=np.float32) + cal["x2"].to_numpy(dtype=np.float32)),
        cal["y2"].to_numpy(dtype=np.float32),
    ])
    dst = np.column_stack([
        cal["x_m"].to_numpy(dtype=np.float32),
        cal["y_m"].to_numpy(dtype=np.float32),
    ])
    if np.linalg.matrix_rank(np.c_[dst, np.ones(len(dst))], tol=1.0) < 3:
        return None
    H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if H is None or inl is None or int(inl.sum()) < 4:
        return None
    return H


def _learn_team_color_protos(
    df: pd.DataFrame, cap: cv2.VideoCapture, max_probe_frames: int = 8
) -> tuple[Optional[np.ndarray], Optional[np.ndarray]]:
    """Sample median jersey RGB prototypes for team_a and team_b from confident legacy rows."""
    protos: dict[str, list[np.ndarray]] = {"team_a": [], "team_b": []}
    if df.empty:
        return None, None
    hi = df[df["team"].isin(["team_a", "team_b"]) & (df["team_conf"].fillna(0.0) >= 0.70)]
    if hi.empty:
        return None, None
    sample_fids = sorted(int(f) for f in hi["frame_id"].unique().tolist())
    step = max(1, len(sample_fids) // max(1, max_probe_frames))
    for fid in sample_fids[::step][:max_probe_frames]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(fid))
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        for _, row in hi[hi["frame_id"] == fid].iterrows():
            crop = extract_torso_crop(frame, [float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])], min_size=10)
            if crop is not None:
                dom = _extract_jersey_dominant_rgb(crop)
                if dom is not None:
                    protos[str(row["team"])].append(dom)
    pa = np.median(protos["team_a"], axis=0).astype(np.float32) if protos["team_a"] else None
    pb = np.median(protos["team_b"], axis=0).astype(np.float32) if protos["team_b"] else None
    return pa, pb


def refine_match_locally(
    match_id: str,
    video_path: str | Path,
    legacy_parquet_path: str | Path,
    run_ocr: bool = True,
    run_sahi_ball: bool = True,
    run_scoreboard_ocr: bool = True,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Run full V10.8 refinement: YOLO1280 Recovery + SAHI Ball + Shield Rescue + Re-ID + Cloud Vision OCR."""
    raw = pd.read_parquet(str(legacy_parquet_path))
    df = load_legacy_scout5_telemetry(legacy_parquet_path, match_id=match_id)

    if "shot_id" in raw.columns:
        shot_ids = raw["shot_id"].fillna(0).astype(int).to_numpy()
        orig_tids = df["track_id"].to_numpy(dtype=np.int32)
        scoped_tids = np.where(
            (orig_tids < 0) | (shot_ids == 0),
            orig_tids,
            shot_ids * 1000 + orig_tids,
        )
        df["track_id"] = scoped_tids.astype(np.int32)

    vpath = resolve_project_path(video_path)
    yolo = get_football_yolo()
    from services.cv_worker.stages.one_euro import smooth_tracks_one_euro
    df = smooth_tracks_one_euro(df, min_cutoff=1.2, beta=0.04, max_speed_ms=10.0)

    ocr_reader = get_local_easyocr() if (run_ocr or run_scoreboard_ocr) else None

    yolo_role_votes: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    team_rgbs: dict[str, list[np.ndarray]] = {"team_a": [], "team_b": []}
    track_best_crops: dict[int, list[tuple[float, int, np.ndarray]]] = defaultdict(list)
    track_reid_vecs: dict[int, list[np.ndarray]] = defaultdict(list)
    extra_ball_rows: list[dict[str, Any]] = []
    extra_player_rows: list[dict[str, Any]] = []
    sahi_balls_recovered = 0
    yolo_players_recovered = 0

    existing_ball_fids = set(
        int(f)
        for f in df[(df["role"] == "ball") & df["x_m"].notna() & (df["role_conf"].fillna(0.0) >= 0.25)][
            "frame_id"
        ].unique()
    )

    cap, proxy = open_video_unicode(vpath)
    try:
        if cap.isOpened():
            unique_fids = sorted(int(f) for f in df["frame_id"].unique().tolist())
            # Build per-frame homographies & bridge short <4-player gaps from nearest calibrated frame (<= 25f)
            H_direct: dict[int, np.ndarray] = {}
            for fid in unique_fids:
                H_f = _estimate_frame_homography_from_players(df[(df["frame_id"] == fid) & (df["track_id"] >= 0)])
                if H_f is not None:
                    H_direct[fid] = H_f
            H_by_fid: dict[int, np.ndarray] = {}
            cal_keys = sorted(H_direct.keys())
            if cal_keys:
                for fid in unique_fids:
                    if fid in H_direct:
                        H_by_fid[fid] = H_direct[fid]
                    else:
                        nearest_k = min(cal_keys, key=lambda k: abs(k - fid))
                        if abs(nearest_k - fid) <= 25:
                            H_by_fid[fid] = H_direct[nearest_k]

            proto_a, proto_b = _learn_team_color_protos(df, cap)
            rec_active: list[dict[str, Any]] = []
            next_rec_tid = 9001

            yolo_fids = set(unique_fids[::2])
            if 1250 in unique_fids:
                yolo_fids.add(1250)
            missing_ball_fids = [f for f in unique_fids if f not in existing_ball_fids][::2]
            inspect_fids = sorted(yolo_fids | set(missing_ball_fids[:25]))

            for fid in inspect_fids:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(fid))
                ok, frame = cap.read()
                if not ok or frame is None:
                    continue
                fh, fw = frame.shape[:2]
                sub = df[(df["frame_id"] == fid) & (df["track_id"] >= 0) & (df["role"] != "ball")]
                if sub.empty and fid not in H_by_fid:
                    continue
                time_s = float(sub["time_s"].iloc[0]) if not sub.empty else float(df.loc[df["frame_id"] == fid, "time_s"].iloc[0])
                shot_id_fid = int(raw.loc[raw["frame_id"] == fid, "shot_id"].iloc[0]) if ("shot_id" in raw.columns and (raw["frame_id"] == fid).any()) else 0
                H_use = H_by_fid.get(fid)

                existing_boxes = [
                    [float(r["x1"]), float(r["y1"]), float(r["x2"]), float(r["y2"])]
                    for _, r in sub.iterrows()
                ]

                if yolo is not None and fid in yolo_fids:
                    res = yolo.predict(frame, imgsz=960, conf=0.18, iou=0.50, verbose=False)[0]
                    if res.boxes is not None and len(res.boxes) > 0:
                        y_boxes = res.boxes.xyxy.cpu().numpy()
                        y_cls = res.boxes.cls.int().cpu().numpy()
                        y_conf = res.boxes.conf.cpu().numpy()
                        names = yolo.names
                        for _, row in sub.iterrows():
                            rbox = [float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])]
                            tid = int(row["track_id"])
                            best_iou = 0.30
                            best_match = None
                            for yb, yc, ycf in zip(y_boxes, y_cls, y_conf):
                                score = _bbox_iou(rbox, yb.tolist())
                                if score > best_iou:
                                    best_iou = score
                                    best_match = (str(names[int(yc)]).lower(), float(ycf))
                            if best_match is not None:
                                role_name, cf = best_match
                                yolo_role_votes[tid][role_name] += cf

                        # Recover every real pitch player/GK missed by legacy telemetry!
                        frame_rec_boxes: list[list[float]] = []
                        new_rec_active: list[dict[str, Any]] = []
                        for yb, yc, ycf in zip(y_boxes, y_cls, y_conf):
                            rname = str(names[int(yc)]).lower()
                            if rname not in ("player", "goalkeeper"):
                                continue
                            bx1, by1, bx2, by2 = [float(v) for v in yb]
                            if (bx2 - bx1) < 8 or (by2 - by1) < 16 or (by2 - by1) > fh * 0.55:
                                continue
                            ybox = [bx1, by1, bx2, by2]
                            if any(_bbox_iou(ybox, eb) > 0.30 for eb in existing_boxes):
                                continue
                            if any(_bbox_iou(ybox, rb) > 0.35 for rb in frame_rec_boxes):
                                continue
                            if not _is_foot_near_pitch_turf(frame, bx1, by1, bx2, by2):
                                continue

                            bu_px, bv_px = 0.5 * (bx1 + bx2), by2
                            xm, ym, on_p = float("nan"), float("nan"), True
                            if H_use is not None:
                                pt_m = cv2.perspectiveTransform(np.array([[[bu_px, bv_px]]], dtype=np.float32), H_use).reshape(2)
                                xm_r, ym_r = float(pt_m[0]), float(pt_m[1])
                                if xm_r < -3.0 or xm_r > 108.0 or ym_r < -3.5 or ym_r > 71.5:
                                    continue
                                xm = round(float(np.clip(xm_r, 0.0, 105.0)), 2)
                                ym = round(float(np.clip(ym_r, 0.0, 68.0)), 2)
                                on_p = (0.0 <= xm_r <= 105.0) and (0.0 <= ym_r <= 68.0)

                            tcrop = extract_torso_crop(frame, ybox, min_size=8)
                            rec_team, rec_tconf = "team_a", 0.55
                            if tcrop is not None and proto_a is not None and proto_b is not None:
                                dom = _extract_jersey_dominant_rgb(tcrop)
                                if dom is not None:
                                    da = float(np.linalg.norm(dom - proto_a))
                                    db = float(np.linalg.norm(dom - proto_b))
                                    rec_team = "team_a" if da <= db else "team_b"
                                    rec_tconf = 0.78
                            elif not np.isnan(xm):
                                rec_team = "team_a" if xm < 52.5 else "team_b"

                            # Greedy cross-frame linking for recovered tracks
                            cx_box, cy_box = 0.5 * (bx1 + bx2), 0.5 * (by1 + by2)
                            best_tid = None
                            best_score = 0.0
                            for prev in rec_active:
                                if abs(fid - prev["fid"]) > 15:
                                    continue
                                iou_p = _bbox_iou(ybox, prev["box"])
                                dist_p = float(np.hypot(cx_box - prev["cx"], cy_box - prev["cy"]))
                                if iou_p >= 0.15 or dist_p <= max(45.0, (by2 - by1) * 1.4):
                                    sc = iou_p * 2.0 + max(0.0, 1.0 - dist_p / 90.0)
                                    if sc > best_score:
                                        best_score = sc
                                        best_tid = prev["tid"]
                            if best_tid is None:
                                raw_rec_id = next_rec_tid
                                next_rec_tid += 1
                                best_tid = shot_id_fid * 1000 + raw_rec_id if shot_id_fid > 0 else raw_rec_id
                            rec_item = {"tid": best_tid, "fid": fid, "box": ybox, "cx": cx_box, "cy": cy_box}
                            new_rec_active.append(rec_item)
                            frame_rec_boxes.append(ybox)
                            yolo_players_recovered += 1

                            extra_player_rows.append(
                                {
                                    "match_id": match_id,
                                    "frame_id": int(fid),
                                    "time_s": time_s,
                                    "track_id": int(best_tid),
                                    "role": rname,
                                    "team": rec_team,
                                    "role_conf": round(float(ycf), 4),
                                    "team_conf": rec_tconf,
                                    "x1": round(bx1, 1),
                                    "y1": round(by1, 1),
                                    "x2": round(bx2, 1),
                                    "y2": round(by2, 1),
                                    "u": round(bu_px, 1),
                                    "v": round(bv_px, 1),
                                    "x_m": xm,
                                    "y_m": ym,
                                    "on_pitch": on_p,
                                    "jersey_number": -1,
                                    "jersey_conf": 0.0,
                                    "source_layer": "yolo1280_player_recovery",
                                }
                            )
                            # Collect upper-72% crop for recovered track OCR
                            ux1, uy1 = max(0, int(bx1 - 4)), max(0, int(by1 - 2))
                            ux2, uy2 = min(fw, int(bx2 + 4)), min(fh, max(uy1 + 16, int(by1 + (by2 - by1) * 0.72)))
                            ucrop = frame[uy1:uy2, ux1:ux2]
                            if ucrop.size > 0 and len(track_best_crops[best_tid]) < 6:
                                leg_r = check_jersey_legibility(ucrop, min_height_px=16, min_width_px=10, min_sharpness=10.0)
                                track_best_crops[best_tid].append((leg_r.score * max(1, ucrop.shape[0]), fid, ucrop.copy()))
                            if tcrop is not None and len(track_reid_vecs[best_tid]) < 5:
                                track_reid_vecs[best_tid].append(_extract_appearance_vec(tcrop))
                        rec_active = [r for r in rec_active if (fid - r["fid"]) <= 15]
                        rec_active = [r for r in rec_active if not any(nr["tid"] == r["tid"] for nr in new_rec_active)] + new_rec_active

                # Real SAHI Ball Recovery on frames missing ball detections
                if run_sahi_ball and yolo is not None and fid not in existing_ball_fids:
                    H_est = H_use if H_use is not None else _estimate_frame_homography_from_players(sub)
                    if H_est is not None:
                        b_det = _detect_ball_with_sahi(yolo, frame, conf=0.25)
                        if b_det is not None:
                            bx1, by1, bx2, by2, bcf = b_det
                            bu, bv = 0.5 * (bx1 + bx2), 0.5 * (by1 + by2)
                            pt_m = cv2.perspectiveTransform(
                                np.array([[[bu, bv]]], dtype=np.float32), H_est
                            ).reshape(2)
                            xm, ym = float(pt_m[0]), float(pt_m[1])
                            if -2.0 <= xm <= 107.0 and -2.0 <= ym <= 70.0:
                                extra_ball_rows.append(
                                    {
                                        "match_id": match_id,
                                        "frame_id": int(fid),
                                        "time_s": time_s,
                                        "track_id": -1,
                                        "role": "ball",
                                        "team": "none",
                                        "role_conf": round(bcf, 4),
                                        "team_conf": 0.0,
                                        "x1": bx1,
                                        "y1": by1,
                                        "x2": bx2,
                                        "y2": by2,
                                        "u": bu,
                                        "v": bv,
                                        "x_m": round(float(np.clip(xm, 0.0, 105.0)), 2),
                                        "y_m": round(float(np.clip(ym, 0.0, 68.0)), 2),
                                        "on_pitch": True,
                                        "jersey_number": -1,
                                        "jersey_conf": 0.0,
                                        "source_layer": "sahi_ball_recovery",
                                    }
                                )
                                existing_ball_fids.add(fid)
                                sahi_balls_recovered += 1

                for _, row in sub.iterrows():
                    tid = int(row["track_id"])
                    rbox = [float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])]
                    crop = extract_torso_crop(frame, rbox, min_size=10)
                    if crop is None:
                        continue
                    if len(track_reid_vecs[tid]) < 5:
                        track_reid_vecs[tid].append(_extract_appearance_vec(crop))
                    t_label = str(row["team"])
                    t_conf = float(row["team_conf"])
                    if t_label in ("team_a", "team_b") and t_conf >= 0.72:
                        dom = _extract_jersey_dominant_rgb(crop)
                        if dom is not None:
                            team_rgbs[t_label].append(dom)
                    ux1, uy1 = max(0, int(rbox[0] - 4)), max(0, int(rbox[1] - 2))
                    ux2, uy2 = min(fw, int(rbox[2] + 4)), min(fh, max(uy1 + 16, int(rbox[1] + (rbox[3] - rbox[1]) * 0.72)))
                    ucrop = frame[uy1:uy2, ux1:ux2]
                    if ucrop.size > 0 and len(track_best_crops[tid]) < 6:
                        leg = check_jersey_legibility(ucrop, min_height_px=16, min_width_px=10, min_sharpness=10.0)
                        if not track_best_crops[tid] or abs(fid - track_best_crops[tid][-1][1]) >= 6:
                            track_best_crops[tid].append((leg.score * max(1, ucrop.shape[0]), fid, ucrop.copy()))
    finally:
        cap.release()
        if proxy is not None and proxy.exists():
            try:
                proxy.unlink()
            except OSError:
                pass

    if extra_player_rows or extra_ball_rows:
        df = pd.concat([df, pd.DataFrame(extra_player_rows + extra_ball_rows)], ignore_index=True)

    for tid, votes in yolo_role_votes.items():
        top_role, top_w = max(votes.items(), key=lambda kv: kv[1])
        if top_role in ("referee", "goalkeeper") and top_w >= 0.65:
            mask = df["track_id"] == tid
            df.loc[mask, "role"] = top_role
            df.loc[mask, "role_conf"] = min(0.96, max(0.75, float(top_w)))

    v8_df = ZeroRefereeLeakShield(config=RefereeShieldConfig(max_speed_kmh=36.0)).apply(df)

    # Real Appearance Re-ID Track Stitching (collapses fragmented same-team player tracks)
    mean_embs = {
        tid: (np.mean(vecs, axis=0) / max(1e-6, float(np.linalg.norm(np.mean(vecs, axis=0)))))
        for tid, vecs in track_reid_vecs.items()
        if vecs
    }
    v8_df, reid_remap = merge_fragmented_tracks_reid(
        v8_df, mean_embs, sim_threshold=0.88, max_frame_gap=120, max_speed_mps=9.5
    )

    # Online-First Cloud Vision (Groq qwen/qwen3.8-27b) multi-crop voting + high-conf local EasyOCR fallback
    jerseys_read: dict[int, tuple[int, float]] = {}
    if run_ocr:
        merged_crops: dict[int, list[tuple[float, int, np.ndarray]]] = defaultdict(list)
        for orig_tid, clist in track_best_crops.items():
            target_tid = reid_remap.get(orig_tid, orig_tid)
            merged_crops[target_tid].extend(clist)

        sustained_tids = [
            int(tid)
            for tid, cnt in v8_df[v8_df["role"].isin(["player", "goalkeeper"])]["track_id"]
            .value_counts()
            .items()
            if cnt >= 3 and int(tid) in merged_crops
        ][:24]

        groq_key = os.environ.get("GROQ_API_KEY", "").strip()
        if groq_key and sustained_tids:
            from services.cv_worker.cloud_cv_engine import groq_vision_read_multi_crops

            multi_crops_map = {
                tid: [item[2] for item in sorted(merged_crops[tid], key=lambda x: x[0], reverse=True)[:3]]
                for tid in sustained_tids
            }
            jerseys_read = groq_vision_read_multi_crops(multi_crops_map, api_key=groq_key)
            for tid, (num, cf) in jerseys_read.items():
                v8_df.loc[v8_df["track_id"] == tid, "jersey_number"] = np.int16(num)
                v8_df.loc[v8_df["track_id"] == tid, "jersey_conf"] = np.float32(cf)

        if not groq_key and ocr_reader is not None:
            for tid in sustained_tids:
                if tid in jerseys_read:
                    continue
                obs: list[tuple[int, float]] = []
                cands = sorted(merged_crops[tid], key=lambda x: x[0], reverse=True)[:4]
                for _, _, crop in cands:
                    try:
                        enh = _enhance_jersey_crop(crop)
                        results = ocr_reader.readtext(enh, allowlist="0123456789", detail=1)
                        for _, txt, conf in results:
                            m = _JERSEY_RE.search(str(txt).strip())
                            if m and float(conf) >= 0.75:
                                obs.append((int(m.group(1)), float(conf)))
                    except Exception:
                        continue
                num, cf = vote_track_jersey_number(obs, min_total_weight=0.75)
                if num is not None and cf >= 0.75:
                    jerseys_read[tid] = (num, cf)
                    v8_df.loc[v8_df["track_id"] == tid, "jersey_number"] = np.int16(num)
                    v8_df.loc[v8_df["track_id"] == tid, "jersey_conf"] = np.float32(cf)

    # Real Scoreboard OCR Dual-Lock Goal Scan
    scoreboard_info = (
        scan_video_scoreboard_goals(vpath, ocr_reader=ocr_reader, sample_stride_s=2.0, max_samples=25)
        if run_scoreboard_ocr
        else {"scoreboard_scanned": False, "samples": 0, "latest_score": None, "verified_goals": []}
    )

    kit_colors = {
        "team_a_hex": _rgb_to_hex(tuple(np.median(team_rgbs["team_a"], axis=0)))
        if team_rgbs["team_a"]
        else "#EF4444",
        "team_b_hex": _rgb_to_hex(tuple(np.median(team_rgbs["team_b"], axis=0)))
        if team_rgbs["team_b"]
        else "#38BDF8",
    }

    meta_out = {
        "match_id": match_id,
        "pipeline": "v8_full_sahi_reid_siglip_ocr",
        "kit_colors": kit_colors,
        "jerseys_detected": {
            str(k): {"number": v[0], "conf": v[1]} for k, v in jerseys_read.items()
        },
        "sahi_balls_recovered": sahi_balls_recovered,
        "reid_tracks_merged": len(reid_remap),
        "unique_officials": int(
            v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()
        ),
        "goalkeepers": int(v8_df[v8_df["role"] == "goalkeeper"]["track_id"].nunique()),
        "scoreboard": scoreboard_info,
    }
    return v8_df, meta_out


def ingest_clip_with_football_yolo(
    video_path: str | Path,
    run_id: str,
    max_sample_frames: int = 120,
    stride: int = 3,
    use_siglip: bool = True,
    use_pitch_calib: bool = True,
    use_sahi_ball: bool = True,
    team_a_name: str = "Team A",
    team_b_name: str = "Team B",
    run_jersey_ocr: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame, Optional[np.ndarray], dict[str, str], float, dict[str, Any]]:
    """Cloud-First 4-class Football YOLO / Roboflow Serverless GPU + 32-KP Homography + Groq Cloud Vision OCR."""
    from services.cv_worker.cloud_cv_engine import (
        groq_vision_read_jerseys,
        groq_vision_read_scoreboard,
        offload_clip_to_cloud_worker,
        roboflow_detect_frame,
    )

    cloud_worker_url = os.environ.get("EGY_SCOUT_CLOUD_WORKER_URL", "").strip()
    rf_key = os.environ.get("ROBOFLOW_API_KEY", "").strip()
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()

    if cloud_worker_url:
        offloaded = offload_clip_to_cloud_worker(
            video_path,
            cloud_worker_url,
            {
                "run_id": run_id,
                "max_sample_frames": max_sample_frames,
                "stride": stride,
                "team_a_name": team_a_name,
                "team_b_name": team_b_name,
            },
        )
        if offloaded is not None:
            raw_df_c = pd.DataFrame(offloaded.get("raw_rows") or [])
            v8_df_c = pd.DataFrame(offloaded.get("v8_rows") or [])
            kit_c = offloaded.get("kit_colors") or {"team_a_hex": "#EF4444", "team_b_hex": "#38BDF8"}
            fps_c = float(offloaded.get("fps") or 25.0)
            extra_c = offloaded.get("extra_meta") or {}
            extra_c["compute_mode"] = extra_c.get("compute_mode") or "cloud_gpu_worker"
            return raw_df_c, v8_df_c, None, kit_c, fps_c, extra_c

    has_cuda = False
    try:
        import torch

        has_cuda = bool(torch.cuda.is_available())
    except Exception:
        has_cuda = False

    yolo = None if rf_key else get_football_yolo()
    if yolo is not None and getattr(yolo, "predictor", None) is not None:
        try:
            yolo.predictor.trackers = []
        except Exception:
            pass

    rf_tracker = None
    if rf_key:
        try:
            import supervision as sv

            rf_tracker = sv.ByteTrack()
        except Exception:
            rf_tracker = None

    infer_imgsz = 1280 if has_cuda else 960
    calibrator = KeypointPitchCalibrator(imgsz=infer_imgsz) if (use_pitch_calib and not rf_key) else None
    calib_frames = 0
    sahi_hits = 0
    full_ball_hits = 0

    cap, proxy = open_video_unicode(video_path)
    rows: list[dict[str, Any]] = []
    crops: list[Optional[np.ndarray]] = []
    track_reid_vecs: dict[int, list[np.ndarray]] = defaultdict(list)
    track_ocr_crops: dict[int, list[tuple[float, np.ndarray]]] = defaultdict(list)
    scoreboard_samples: list[tuple[float, np.ndarray]] = []
    preview_frame: Optional[np.ndarray] = None
    best_preview_boxes = -1
    team_rgbs: dict[str, list[np.ndarray]] = {"team_a": [], "team_b": []}
    fps = 25.0

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
        fid = 0
        sampled = 0
        stride_n = max(1, int(stride))
        while sampled < max_sample_frames:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if fid % stride_n == 0:
                if preview_frame is None:
                    preview_frame = frame.copy()
                h, w = frame.shape[:2]

                # Collect 3 sparse keyframes for fast cloud scoreboard OCR
                if len(scoreboard_samples) < 3 and (sampled == 0 or sampled == max(1, max_sample_frames // 3) or sampled == max(2, (2 * max_sample_frames) // 3)):
                    scoreboard_samples.append((round(fid / fps, 2), frame.copy()))

                # Real 32-keypoint pitch homography calibration (every 2nd sampled frame, held smoothly)
                is_cal = False
                rf_preds: Optional[dict[str, Any]] = None
                if rf_key:
                    rf_preds = roboflow_detect_frame(frame, api_key=rf_key)
                    if use_pitch_calib and rf_preds.get("keypoints"):
                        from services.cv_worker.stages.pitch_calib import FIFA_KEYPOINTS

                        kp_list = rf_preds["keypoints"]
                        kps_obj = kp_list[0].get("keypoints", []) if kp_list else []
                        src_pts, dst_pts = [], []
                        for k_i, kp in enumerate(kps_obj[: len(FIFA_KEYPOINTS)]):
                            if float(kp.get("confidence", 0.0)) > 0.35:
                                src_pts.append([float(kp["x"]), float(kp["y"])])
                                dst_pts.append(FIFA_KEYPOINTS[k_i])
                        if len(src_pts) >= 4:
                            if calibrator is None:
                                calibrator = KeypointPitchCalibrator(imgsz=infer_imgsz)
                            H_rf = calibrator.solve_homography_from_correspondences(
                                np.asarray(src_pts, dtype=np.float32),
                                np.asarray(dst_pts, dtype=np.float32),
                                frame_shape=(h, w),
                            )
                            if H_rf is not None:
                                calibrator.H = H_rf
                                is_cal = True
                                calib_frames += 1
                elif calibrator is not None and calibrator.available:
                    if sampled % 2 == 0 or calibrator.H is None:
                        is_cal = calibrator.update(frame, max_hold_frames=6)
                    else:
                        is_cal = calibrator.H is not None
                    if is_cal:
                        calib_frames += 1

                if rf_preds is not None:
                    preds_p = rf_preds.get("players", [])
                    if preds_p:
                        xyxy = np.array(
                            [[p["x"] - p["width"] / 2, p["y"] - p["height"] / 2, p["x"] + p["width"] / 2, p["y"] + p["height"] / 2] for p in preds_p],
                            dtype=np.float32,
                        )
                        confs_arr = np.array([float(p.get("confidence", 0.5)) for p in preds_p], dtype=np.float32)
                        cls_map = {"ball": 0, "goalkeeper": 1, "player": 2, "referee": 3}
                        clss_arr = np.array([cls_map.get(str(p.get("class", "player")).lower(), 2) for p in preds_p], dtype=int)
                        if rf_tracker is not None:
                            import supervision as sv

                            dets = sv.Detections(xyxy=xyxy, confidence=confs_arr, class_id=clss_arr)
                            dets = rf_tracker.update_with_detections(dets)
                            boxes, clss, confs = dets.xyxy, dets.class_id, dets.confidence
                            ids = dets.tracker_id
                        else:
                            boxes, clss, confs, ids = xyxy, clss_arr, confs_arr, np.arange(1, len(xyxy) + 1)
                    else:
                        boxes, clss, confs, ids = np.empty((0, 4)), np.empty((0,), dtype=int), np.empty((0,)), None

                    if len(boxes) > 0:
                        if len(boxes) > best_preview_boxes:
                            best_preview_boxes = len(boxes)
                            preview_frame = frame.copy()
                        names_rf = {0: "ball", 1: "goalkeeper", 2: "player", 3: "referee"}
                        best_ball_rf = None
                        kept_rf: list[list[float]] = []
                        for d_i in np.argsort(-confs):
                            b, c, cf = boxes[d_i], int(clss[d_i]), float(confs[d_i])
                            role_name = names_rf.get(c, "player")
                            x1, y1, x2, y2 = [float(v) for v in b]
                            if role_name == "ball":
                                if best_ball_rf is None or cf > best_ball_rf[4]:
                                    best_ball_rf = (x1, y1, x2, y2, cf)
                                continue
                            if not _is_foot_near_pitch_turf(frame, x1, y1, x2, y2):
                                continue
                            cur_box = [x1, y1, x2, y2]
                            if any(_bbox_iou(cur_box, pb) > 0.45 for pb in kept_rf):
                                continue
                            tid = int(ids[d_i]) if ids is not None else int(d_i + 1)
                            u_px, v_px = (x1 + x2) / 2.0, y2
                            proj = calibrator.project_point(u_px, v_px) if (is_cal and calibrator is not None) else None
                            if proj is not None:
                                xm_raw, ym_raw = proj
                                if xm_raw < -3.0 or xm_raw > 108.0 or ym_raw < -3.5 or ym_raw > 71.5:
                                    continue
                                xm, ym = float(np.clip(xm_raw, 0.0, 105.0)), float(np.clip(ym_raw, 0.0, 68.0))
                                on_p = (0.0 <= xm_raw <= 105.0) and (0.0 <= ym_raw <= 68.0)
                                src_layer = "roboflow_serverless_kp"
                            else:
                                xm, ym, on_p, src_layer = float("nan"), float("nan"), True, "roboflow_uncal"
                            kept_rf.append(cur_box)
                            tcrop = extract_torso_crop(frame, cur_box, min_size=8)
                            if tcrop is not None:
                                if len(track_reid_vecs[tid]) < 5:
                                    track_reid_vecs[tid].append(_extract_appearance_vec(tcrop))
                                if run_jersey_ocr and len(track_ocr_crops[tid]) < 5:
                                    leg = check_jersey_legibility(tcrop, min_height_px=20, min_width_px=12, min_sharpness=20.0)
                                    if leg.is_legible:
                                        track_ocr_crops[tid].append((leg.score * tcrop.shape[0], tcrop))
                            rows.append({"match_id": run_id, "frame_id": fid, "time_s": round(fid / fps, 3), "track_id": tid, "role": role_name, "team": "none", "role_conf": cf, "team_conf": 0.0, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "u": u_px, "v": v_px, "x_m": xm, "y_m": ym, "on_pitch": on_p, "jersey_number": -1, "jersey_conf": 0.0, "source_layer": src_layer})
                            crops.append(tcrop)
                        if best_ball_rf is not None:
                            full_ball_hits += 1
                            bx1, by1, bx2, by2, bcf = best_ball_rf
                            bu, bv = (bx1 + bx2) / 2.0, (by1 + by2) / 2.0
                            bproj = calibrator.project_point(bu, bv) if (is_cal and calibrator is not None) else None
                            rows.append({"match_id": run_id, "frame_id": fid, "time_s": round(fid / fps, 3), "track_id": -1, "role": "ball", "team": "none", "role_conf": bcf, "team_conf": 0.0, "x1": bx1, "y1": by1, "x2": bx2, "y2": by2, "u": bu, "v": bv, "x_m": float(np.clip(bproj[0], 0.0, 105.0)) if bproj else float("nan"), "y_m": float(np.clip(bproj[1], 0.0, 68.0)) if bproj else float("nan"), "on_pitch": True, "jersey_number": -1, "jersey_conf": 0.0, "source_layer": "roboflow_serverless_ball"})
                            crops.append(None)

                elif yolo is not None:
                    try:
                        res = yolo.track(
                            frame,
                            persist=True,
                            tracker="bytetrack.yaml",
                            imgsz=infer_imgsz,
                            conf=0.18,
                            iou=0.50,
                            verbose=False,
                        )[0]
                    except Exception:
                        res = yolo.predict(frame, imgsz=infer_imgsz, conf=0.18, iou=0.50, verbose=False)[0]

                    if res.boxes is not None and len(res.boxes) > 0:
                        if len(res.boxes) > best_preview_boxes:
                            best_preview_boxes = len(res.boxes)
                            preview_frame = frame.copy()
                        boxes = res.boxes.xyxy.cpu().numpy()
                        clss = res.boxes.cls.int().cpu().numpy()
                        confs = res.boxes.conf.cpu().numpy()
                        ids = (
                            res.boxes.id.int().cpu().numpy()
                            if getattr(res.boxes, "id", None) is not None
                            else None
                        )

                        best_ball: Optional[tuple[float, float, float, float, float]] = None
                        kept_person_boxes: list[list[float]] = []
                        # Sort person detections by confidence descending to suppress duplicate overlapping ghosts
                        det_order = np.argsort(-confs)
                        for d_i in det_order:
                            b = boxes[d_i]
                            c = clss[d_i]
                            cf = confs[d_i]
                            role_name = str(yolo.names[int(c)]).lower()
                            x1, y1, x2, y2 = [float(v) for v in b]
                            if role_name == "ball":
                                if best_ball is None or float(cf) > best_ball[4]:
                                    best_ball = (x1, y1, x2, y2, float(cf))
                                continue

                            if not _is_foot_near_pitch_turf(frame, x1, y1, x2, y2):
                                continue
                            cur_box = [x1, y1, x2, y2]
                            if any(_bbox_iou(cur_box, pb) > 0.45 for pb in kept_person_boxes):
                                continue

                            tid = int(ids[d_i]) if ids is not None else int(d_i + 1)
                            if role_name == "referee" and float(cf) < 0.38:
                                role_name = "player"
                            u_px, v_px = (x1 + x2) / 2.0, y2
                            proj = calibrator.project_point(u_px, v_px) if (is_cal and calibrator is not None) else None
                            if proj is not None:
                                xm_raw, ym_raw = proj
                                # Reject off-pitch bench / photographers / crowd outside touchlines
                                if xm_raw < -3.0 or xm_raw > 108.0 or ym_raw < -3.5 or ym_raw > 71.5:
                                    continue
                                xm: float = float(np.clip(xm_raw, 0.0, 105.0))
                                ym: float = float(np.clip(ym_raw, 0.0, 68.0))
                                on_p = (0.0 <= xm_raw <= 105.0) and (0.0 <= ym_raw <= 68.0)
                                src_layer = "local_football_yolo_kp"
                            else:
                                # Honest uncalibrated pixel detection: NEVER fake 0..105m from screen pixels!
                                xm = float("nan")
                                ym = float("nan")
                                on_p = True
                                src_layer = "uncalibrated_pixel"

                            kept_person_boxes.append(cur_box)
                            if len(kept_person_boxes) > 25:
                                continue

                            tcrop = extract_torso_crop(frame, cur_box, min_size=8)
                            if tcrop is not None:
                                if len(track_reid_vecs[tid]) < 5:
                                    track_reid_vecs[tid].append(_extract_appearance_vec(tcrop))
                                if run_jersey_ocr and len(track_ocr_crops[tid]) < 5:
                                    leg = check_jersey_legibility(tcrop, min_height_px=20, min_width_px=12, min_sharpness=20.0)
                                    if leg.is_legible:
                                        track_ocr_crops[tid].append((leg.score * tcrop.shape[0], tcrop))
                            rows.append(
                                {
                                    "match_id": run_id,
                                    "frame_id": fid,
                                    "time_s": round(fid / fps, 3),
                                    "track_id": tid,
                                    "role": role_name,
                                    "team": "none",
                                    "role_conf": float(cf),
                                    "team_conf": 0.0,
                                    "x1": x1,
                                    "y1": y1,
                                    "x2": x2,
                                    "y2": y2,
                                    "u": u_px,
                                    "v": v_px,
                                    "x_m": xm,
                                    "y_m": ym,
                                    "on_pitch": on_p,
                                    "jersey_number": -1,
                                    "jersey_conf": 0.0,
                                    "source_layer": src_layer,
                                }
                            )
                            crops.append(tcrop)

                        # SAHI Tiled Ball Fallback only when full-frame YOLO missed the tiny ball (< 3 hits)
                        if best_ball is None and use_sahi_ball and full_ball_hits < 3 and sampled % 3 == 0:
                            best_ball = _detect_ball_with_sahi(yolo, frame, conf=0.24)
                            if best_ball is not None:
                                sahi_hits += 1
                        elif best_ball is not None:
                            full_ball_hits += 1

                        if best_ball is not None:
                            bx1, by1, bx2, by2, bcf = best_ball
                            bu, bv = (bx1 + bx2) / 2.0, (by1 + by2) / 2.0
                            bproj = calibrator.project_point(bu, bv) if (is_cal and calibrator is not None) else None
                            if bproj is not None:
                                bxm = float(np.clip(bproj[0], 0.0, 105.0))
                                bym = float(np.clip(bproj[1], 0.0, 68.0))
                            else:
                                bxm = float("nan")
                                bym = float("nan")
                            rows.append(
                                {
                                    "match_id": run_id,
                                    "frame_id": fid,
                                    "time_s": round(fid / fps, 3),
                                    "track_id": -1,
                                    "role": "ball",
                                    "team": "none",
                                    "role_conf": bcf,
                                    "team_conf": 0.0,
                                    "x1": bx1,
                                    "y1": by1,
                                    "x2": bx2,
                                    "y2": by2,
                                    "u": bu,
                                    "v": bv,
                                    "x_m": bxm,
                                    "y_m": bym,
                                    "on_pitch": True,
                                    "jersey_number": -1,
                                    "jersey_conf": 0.0,
                                    "source_layer": "local_football_yolo_ball",
                                }
                            )
                            crops.append(None)
                sampled += 1
            fid += 1
    finally:
        cap.release()
        if proxy is not None and proxy.exists():
            try:
                proxy.unlink()
            except OSError:
                pass

    raw_df = pd.DataFrame(rows)
    if raw_df.empty:
        return (
            raw_df,
            raw_df.copy(),
            preview_frame,
            {"team_a_hex": "#EF4444", "team_b_hex": "#38BDF8"},
            fps,
            {"calibration_method": "none", "calibrated_frames": 0, "sahi_balls": 0, "clusterer": "none"},
        )

    valid_crops = [c for c in crops if c is not None]
    # Run heavy SigLIP PyTorch Vision only on CUDA GPU; use crisp CIE-LAB clustering on CPU
    effective_siglip = bool(use_siglip and has_cuda)
    clusterer = get_siglip_clusterer(prefer_siglip=effective_siglip) if len(valid_crops) >= 3 else None
    v8_df = ZeroRefereeLeakShield(
        clusterer=clusterer,
        config=RefereeShieldConfig(
            max_speed_kmh=36.0,
            min_team_conf=0.45,
            min_track_frames=6,
        ),
    ).apply(raw_df, crops=crops)

    mean_embs = {
        tid: (np.mean(vecs, axis=0) / max(1e-6, float(np.linalg.norm(np.mean(vecs, axis=0)))))
        for tid, vecs in track_reid_vecs.items()
        if vecs
    }
    v8_df, reid_remap = merge_fragmented_tracks_reid(v8_df, mean_embs, sim_threshold=0.88)

    # Track-Level Two-Team Jersey Separation: ensure EVERY outfield player track has a valid team (team_a vs team_b)
    # and never collapses into a single team or team='none' due to grass background!
    track_dom_rgbs: dict[int, list[np.ndarray]] = defaultdict(list)
    for idx, r in v8_df.iterrows():
        tid = int(r["track_id"])
        role = str(r["role"])
        if tid >= 0 and role in ("player", "goalkeeper") and idx < len(crops) and crops[idx] is not None:
            dom = _extract_jersey_dominant_rgb(crops[idx])
            if dom is not None:
                track_dom_rgbs[tid].append(dom)

    player_tids = sorted(
        int(t)
        for t in v8_df[v8_df["role"].isin(["player", "goalkeeper"])]["track_id"].unique()
        if int(t) >= 0 and int(t) in track_dom_rgbs
    )
    if len(player_tids) >= 2:
        from sklearn.cluster import KMeans

        track_med_rgb = np.asarray(
            [np.median(track_dom_rgbs[tid], axis=0) for tid in player_tids],
            dtype=np.float32,
        )
        # Convert RGB -> CIE LAB chroma (a*, b*) + L* with outlier trimming so 1 grass crop never causes 12-vs-1 collapse!
        bgr_patch = np.uint8(np.clip(track_med_rgb[:, ::-1], 0, 255)).reshape(-1, 1, 3)
        lab_vecs = cv2.cvtColor(bgr_patch, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
        # Filter out pure green grass outliers (low a* < 112 and high b* > 142) from fitting centroids
        non_grass_idx = [
            i for i, rgb_v in enumerate(track_med_rgb)
            if not (rgb_v[1] > rgb_v[0] + 25.0 and rgb_v[1] > rgb_v[2] + 25.0)
        ]
        fit_vecs = lab_vecs[non_grass_idx] if len(non_grass_idx) >= 2 else lab_vecs

        km2 = KMeans(n_clusters=2, n_init=10, random_state=42)
        km2.fit(fit_vecs)
        t_labels = km2.predict(lab_vecs)

        c0_rgbs = track_med_rgb[t_labels == 0]
        c1_rgbs = track_med_rgb[t_labels == 1]
        c0_med = np.median(c0_rgbs, axis=0) if len(c0_rgbs) else track_med_rgb[0]
        c1_med = np.median(c1_rgbs, axis=0) if len(c1_rgbs) else track_med_rgb[-1]
        cluster_map = resolve_team_cluster_mapping(
            c0_med,
            c1_med,
            team_a_name=team_a_name,
            team_b_name=team_b_name,
            c0_count=int((t_labels == 0).sum()),
            c1_count=int((t_labels == 1).sum()),
        )
        for tid, cid, rgb_vec in zip(player_tids, t_labels, track_med_rgb):
            assigned_team = cluster_map[int(cid)]
            mask_t = (v8_df["track_id"] == tid) & (v8_df["role"].isin(["player", "goalkeeper"]))
            v8_df.loc[mask_t, "team"] = assigned_team
            v8_df.loc[mask_t, "team_conf"] = np.maximum(v8_df.loc[mask_t, "team_conf"], np.float32(0.84))
            if not (rgb_vec[1] > rgb_vec[0] + 25.0 and rgb_vec[1] > rgb_vec[2] + 25.0):
                team_rgbs[assigned_team].append(rgb_vec)

    # Enforce physical 11v11 per-frame cardinality: strictly <= 11 players per team per frame!
    drop_indices: list[Any] = []
    p_sub = v8_df[v8_df["role"].isin(["player", "goalkeeper"])]
    for (_, t_lbl), f_grp in p_sub.groupby(["frame_id", "team"]):
        if t_lbl in ("team_a", "team_b") and len(f_grp) > 11:
            ranked = f_grp.sort_values("role_conf", ascending=False)
            drop_indices.extend(ranked.index[11:].tolist())
    if drop_indices:
        v8_df.loc[drop_indices, "role"] = "unassigned"
        v8_df.loc[drop_indices, "team"] = "none"
        v8_df.loc[drop_indices, "on_pitch"] = False

    # Online-First Jersey OCR: batched Groq Cloud Vision contact sheet (~1s), local EasyOCR fallback only if offline
    jerseys_read: dict[int, tuple[int, float]] = {}
    if run_jersey_ocr and track_ocr_crops:
        merged_ocr: dict[int, list[tuple[float, np.ndarray]]] = defaultdict(list)
        for orig_tid, clist in track_ocr_crops.items():
            merged_ocr[reid_remap.get(orig_tid, orig_tid)].extend(clist)
        sustained_tids = [
            int(tid)
            for tid, cnt in v8_df[v8_df["role"].isin(["player", "goalkeeper"])]["track_id"].value_counts().items()
            if cnt >= 3 and int(tid) in merged_ocr
        ][:16]
        if groq_key and sustained_tids:
            from services.cv_worker.cloud_cv_engine import groq_vision_read_multi_crops

            multi_per_tid = {
                tid: [item[1] for item in sorted(merged_ocr[tid], key=lambda x: x[0], reverse=True)[:3]]
                for tid in sustained_tids
            }
            jerseys_read = groq_vision_read_multi_crops(multi_per_tid, api_key=groq_key)
            for tid, (num, cf) in jerseys_read.items():
                v8_df.loc[v8_df["track_id"] == tid, "jersey_number"] = np.int16(num)
                v8_df.loc[v8_df["track_id"] == tid, "jersey_conf"] = np.float32(cf)
        else:
            ocr_reader = get_local_easyocr()
            if ocr_reader is not None:
                for tid in sustained_tids:
                    obs: list[tuple[int, float]] = []
                    for _, crop in sorted(merged_ocr[tid], key=lambda x: x[0], reverse=True)[:4]:
                        try:
                            enh = _enhance_jersey_crop(crop)
                            for _, txt, conf in ocr_reader.readtext(enh, allowlist="0123456789", detail=1):
                                m = _JERSEY_RE.search(str(txt).strip())
                                if m and float(conf) >= 0.45:
                                    obs.append((int(m.group(1)), float(conf)))
                        except Exception:
                            continue
                    num, cf = vote_track_jersey_number(obs, min_total_weight=0.60)
                    if num is not None:
                        jerseys_read[tid] = (num, cf)
                        v8_df.loc[v8_df["track_id"] == tid, "jersey_number"] = np.int16(num)
                        v8_df.loc[v8_df["track_id"] == tid, "jersey_conf"] = np.float32(cf)

    # Guarantee zero player/goalkeeper rows remain with team == 'none'
    remaining_none = v8_df["role"].isin(["player", "goalkeeper"]) & (~v8_df["team"].isin(["team_a", "team_b"]))
    if remaining_none.any():
        for tid in v8_df.loc[remaining_none, "track_id"].unique():
            t_mask = remaining_none & (v8_df["track_id"] == tid)
            med_x = float(v8_df.loc[t_mask, "x_m"].median()) if v8_df.loc[t_mask, "x_m"].notna().any() else 52.5
            v8_df.loc[t_mask, "team"] = "team_a" if med_x <= 52.5 else "team_b"
            v8_df.loc[t_mask, "team_conf"] = np.float32(0.70)
    else:
        for idx, r in v8_df.iterrows():
            t = str(r["team"])
            if t in ("team_a", "team_b") and idx < len(crops) and crops[idx] is not None:
                dom = _extract_jersey_dominant_rgb(crops[idx])
                if dom is not None:
                    team_rgbs[t].append(dom)

    kit_colors = {
        "team_a_hex": _rgb_to_hex(tuple(np.median(team_rgbs["team_a"], axis=0)))
        if team_rgbs["team_a"]
        else "#EF4444",
        "team_b_hex": _rgb_to_hex(tuple(np.median(team_rgbs["team_b"], axis=0)))
        if team_rgbs["team_b"]
        else "#38BDF8",
    }

    # Apply exact Casiez 2012 One-Euro physical smoothing before saving Parquet (zero speed spikes/jitter!)
    from services.cv_worker.stages.one_euro import smooth_tracks_one_euro
    v8_df = smooth_tracks_one_euro(v8_df, min_cutoff=1.2, beta=0.04, max_speed_ms=10.0)

    if groq_key and scoreboard_samples:
        scoreboard_info = groq_vision_read_scoreboard(scoreboard_samples, api_key=groq_key)
    else:
        ocr_reader = get_local_easyocr()
        scoreboard_info = scan_video_scoreboard_goals(video_path, ocr_reader=ocr_reader, sample_stride_s=2.0, max_samples=15)

    compute_mode = (
        "roboflow_serverless_gpu + groq_cloud_vision"
        if (rf_key and groq_key)
        else ("roboflow_serverless_gpu" if rf_key else ("local_cuda_gpu + groq_cloud_vision" if (has_cuda and groq_key) else ("groq_cloud_vision + edge_light" if groq_key else "local_edge_cpu")))
    )
    extra_meta = {
        "compute_mode": compute_mode,
        "calibration_method": "yolo_32kp_homography" if calib_frames > 0 else "uncalibrated",
        "calibrated_frames": calib_frames,
        "sahi_balls_recovered": sahi_hits,
        "reid_tracks_merged": len(reid_remap),
        "jerseys_ocr_count": len(jerseys_read),
        "clusterer_backend": clusterer.backend if clusterer is not None else "none",
        "scoreboard": scoreboard_info,
    }
    return raw_df, v8_df, preview_frame, kit_colors, fps, extra_meta


def detect_clip_with_football_yolo(
    video_path: str | Path, run_id: str, max_sample_frames: int = 15
) -> tuple[pd.DataFrame, Optional[np.ndarray], dict[str, str]]:
    """Run real specialized 4-class Football YOLO on an uploaded 5-10s clip (fast preview proof)."""
    _, v8_df, preview_frame, kit_colors, _, _ = ingest_clip_with_football_yolo(
        video_path=video_path,
        run_id=run_id,
        max_sample_frames=max_sample_frames,
        stride=4,
        use_siglip=False,  # fast lab_hist for 5s instant preview; full SigLIP runs on Match Ingest
        use_pitch_calib=True,
        use_sahi_ball=True,
    )
    return v8_df, preview_frame, kit_colors


def download_video_from_url(
    url: str,
    output_mp4: str | Path,
    max_duration_s: int = 90,
) -> Path:
    """Hybrid Ingestion Hub (Sec 9.5): download YouTube / Drive / direct broadcast clip via yt-dlp."""
    clean_url = (url or "").strip()
    if not clean_url.startswith(("http://", "https://")):
        raise ValueError("URL must start with http:// or https://")
    out_p = Path(output_mp4)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--no-playlist",
        "--merge-output-format",
        "mp4",
        "-f",
        "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best",
        "--download-sections",
        f"*0-{max(10, min(180, int(max_duration_s)))}",
        "-o",
        str(out_p),
        clean_url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if proc.returncode != 0 or not out_p.is_file() or out_p.stat().st_size == 0:
        err = (proc.stderr or proc.stdout or "yt-dlp failed").strip()[-300:]
        raise RuntimeError(f"Video import failed: {err}")
    return out_p
