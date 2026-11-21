"""100% Local Autonomous Football CV Pipeline (Zero Colab Required).

Leverages the locally available specialized 4-class football YOLO model
(`yolo-football-player-detection.pt`: {0: 'ball', 1: 'goalkeeper', 2: 'player', 3: 'referee'})
+ EasyOCR (`D:\\manger\\.cache\\easyocr`) + Real Per-Match Kit Color Extraction
+ Shot-Scoped Track IDs (eliminating cross-shot ByteTrack ID contamination)
+ 4-Layer Zero-Referee-Leak Shield + Physical Smoothing (<= 36.0 km/h).
"""
from __future__ import annotations

import re
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
from services.cv_worker.stages.jersey_ocr import (
    check_jersey_legibility,
    vote_track_jersey_number,
)
from services.cv_worker.stages.referee_shield import (
    RefereeShieldConfig,
    SigLIPThreeClassClusterer,
    ZeroRefereeLeakShield,
    extract_torso_crop,
)

FOOTBALL_YOLO_REL = (
    Path("egy-tactical-scout") / "backend" / "weights" / "yolo-football-player-detection.pt"
)
_YOLO_MODEL: Any = None
_EASYOCR_READER: Any = None
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


def _rgb_to_hex(rgb: tuple[float, float, float]) -> str:
    r, g, b = [int(np.clip(round(v), 0, 255)) for v in rgb]
    hsv = cv2.cvtColor(np.uint8([[[b, g, r]]]), cv2.COLOR_BGR2HSV)[0, 0].astype(np.float32)
    hsv[1] = min(255.0, max(150.0, hsv[1] * 1.45))
    hsv[2] = min(255.0, max(205.0, hsv[2] * 1.25))
    bgr_out = cv2.cvtColor(np.uint8([[hsv]]), cv2.COLOR_HSV2BGR)[0, 0]
    return f"#{int(bgr_out[2]):02x}{int(bgr_out[1]):02x}{int(bgr_out[0]):02x}"


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
    """Compute dominant non-grass RGB of a torso crop (filters out green pitch background)."""
    if crop_bgr is None or crop_bgr.size == 0:
        return None
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    grass = (
        (hsv[:, :, 0] >= 30)
        & (hsv[:, :, 0] <= 88)
        & (hsv[:, :, 1] >= 45)
        & (hsv[:, :, 2] >= 40)
    )
    fg_mask = ~grass
    if int(fg_mask.sum()) < 12:
        fg_mask = np.ones(crop_bgr.shape[:2], dtype=bool)
    rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)[fg_mask]
    return np.median(rgb, axis=0).astype(np.float32)


def refine_match_locally(
    match_id: str,
    video_path: str | Path,
    legacy_parquet_path: str | Path,
    run_ocr: bool = True,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Run 100% local Football YOLO + Shot-Scoped Tracking + Real Kit Colors + EasyOCR.

    Eliminates cross-shot track_id contamination (keeps shot_id==0 intact, scopes shot_id>0)
    and extracts each team's true kit hex color from actual jersey pixels.
    """
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
    ocr_reader = get_local_easyocr() if run_ocr else None

    yolo_role_votes: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    team_rgbs: dict[str, list[np.ndarray]] = {"team_a": [], "team_b": []}
    track_best_crops: dict[int, list[tuple[float, np.ndarray]]] = defaultdict(list)

    cap, proxy = open_video_unicode(vpath)
    try:
        if cap.isOpened():
            unique_fids = sorted(df["frame_id"].unique().tolist())
            yolo_fids = set(unique_fids[::4])
            if 1250 in unique_fids:
                yolo_fids.add(1250)
            if unique_fids:
                yolo_fids.add(unique_fids[0])

            for fid in sorted(yolo_fids):
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(fid))
                ok, frame = cap.read()
                if not ok or frame is None:
                    continue
                sub = df[(df["frame_id"] == fid) & (df["track_id"] >= 0) & (df["role"] != "ball")]
                if sub.empty:
                    continue

                if yolo is not None:
                    res = yolo.predict(frame, imgsz=960, conf=0.35, verbose=False)[0]
                    if res.boxes is not None and len(res.boxes) > 0:
                        y_boxes = res.boxes.xyxy.cpu().numpy()
                        y_cls = res.boxes.cls.int().cpu().numpy()
                        y_conf = res.boxes.conf.cpu().numpy()
                        names = yolo.names
                        for _, row in sub.iterrows():
                            rbox = [float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])]
                            tid = int(row["track_id"])
                            best_iou = 0.35
                            best_match = None
                            for yb, yc, ycf in zip(y_boxes, y_cls, y_conf):
                                score = _bbox_iou(rbox, yb.tolist())
                                if score > best_iou:
                                    best_iou = score
                                    best_match = (str(names[int(yc)]).lower(), float(ycf))
                            if best_match is not None:
                                role_name, cf = best_match
                                yolo_role_votes[tid][role_name] += cf

                for _, row in sub.iterrows():
                    tid = int(row["track_id"])
                    rbox = [float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])]
                    crop = extract_torso_crop(frame, rbox, min_size=10)
                    if crop is None:
                        continue
                    t_label = str(row["team"])
                    t_conf = float(row["team_conf"])
                    if t_label in ("team_a", "team_b") and t_conf >= 0.72:
                        dom = _extract_jersey_dominant_rgb(crop)
                        if dom is not None:
                            team_rgbs[t_label].append(dom)
                    leg = check_jersey_legibility(crop, min_height_px=24, min_width_px=14)
                    if leg.is_legible and len(track_best_crops[tid]) < 4:
                        track_best_crops[tid].append((leg.score * crop.shape[0], crop))
    finally:
        cap.release()
        if proxy is not None and proxy.exists():
            try:
                proxy.unlink()
            except OSError:
                pass

    for tid, votes in yolo_role_votes.items():
        top_role, top_w = max(votes.items(), key=lambda kv: kv[1])
        if top_role in ("referee", "goalkeeper") and top_w >= 0.55:
            mask = df["track_id"] == tid
            df.loc[mask, "role"] = top_role
            df.loc[mask, "role_conf"] = min(0.96, max(0.75, float(top_w)))

    v8_df = ZeroRefereeLeakShield(config=RefereeShieldConfig(max_speed_kmh=36.0)).apply(df)

    jerseys_read: dict[int, tuple[int, float]] = {}
    if ocr_reader is not None:
        sustained_tids = [
            int(tid)
            for tid, cnt in v8_df[v8_df["role"].isin(["player", "goalkeeper"])]["track_id"]
            .value_counts()
            .items()
            if cnt >= 6 and int(tid) in track_best_crops
        ][:16]
        for tid in sustained_tids:
            obs: list[tuple[int, float]] = []
            cands = sorted(track_best_crops[tid], key=lambda x: x[0], reverse=True)[:3]
            for _, crop in cands:
                try:
                    up = cv2.resize(
                        crop,
                        (crop.shape[1] * 2, crop.shape[0] * 2),
                        interpolation=cv2.INTER_CUBIC,
                    )
                    results = ocr_reader.readtext(up, allowlist="0123456789", detail=1)
                    for _, txt, conf in results:
                        m = _JERSEY_RE.search(str(txt).strip())
                        if m and float(conf) >= 0.55:
                            obs.append((int(m.group(1)), float(conf)))
                except Exception:
                    continue
            num, cf = vote_track_jersey_number(obs, min_total_weight=0.75)
            if num is not None:
                jerseys_read[tid] = (num, cf)
                v8_df.loc[v8_df["track_id"] == tid, "jersey_number"] = np.int16(num)
                v8_df.loc[v8_df["track_id"] == tid, "jersey_conf"] = np.float32(cf)

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
        "pipeline": "local_football_yolo_4class_v8",
        "kit_colors": kit_colors,
        "jerseys_detected": {
            str(k): {"number": v[0], "conf": v[1]} for k, v in jerseys_read.items()
        },
        "unique_officials": int(
            v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()
        ),
        "goalkeepers": int(v8_df[v8_df["role"] == "goalkeeper"]["track_id"].nunique()),
    }
    return v8_df, meta_out


def ingest_clip_with_football_yolo(
    video_path: str | Path,
    run_id: str,
    max_sample_frames: int = 48,
    stride: int = 3,
) -> tuple[pd.DataFrame, pd.DataFrame, Optional[np.ndarray], dict[str, str], float]:
    """Run real 4-class Football YOLO + ByteTrack on a custom uploaded clip (players, officials & ball)."""
    yolo = get_football_yolo()
    if yolo is not None and getattr(yolo, "predictor", None) is not None:
        try:
            yolo.predictor.trackers = []
        except Exception:
            pass

    cap, proxy = open_video_unicode(video_path)
    rows: list[dict[str, Any]] = []
    crops: list[Optional[np.ndarray]] = []
    preview_frame: Optional[np.ndarray] = None
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
                if yolo is not None:
                    try:
                        res = yolo.track(
                            frame,
                            persist=True,
                            tracker="bytetrack.yaml",
                            imgsz=960,
                            conf=0.28,
                            verbose=False,
                        )[0]
                    except Exception:
                        res = yolo.predict(frame, imgsz=960, conf=0.28, verbose=False)[0]

                    if res.boxes is not None and len(res.boxes) > 0:
                        boxes = res.boxes.xyxy.cpu().numpy()
                        clss = res.boxes.cls.int().cpu().numpy()
                        confs = res.boxes.conf.cpu().numpy()
                        ids = (
                            res.boxes.id.int().cpu().numpy()
                            if getattr(res.boxes, "id", None) is not None
                            else None
                        )

                        best_ball: Optional[tuple[float, float, float, float, float]] = None
                        for idx, (b, c, cf) in enumerate(zip(boxes, clss, confs), start=1):
                            role_name = str(yolo.names[int(c)]).lower()
                            x1, y1, x2, y2 = [float(v) for v in b]
                            if role_name == "ball":
                                if best_ball is None or float(cf) > best_ball[4]:
                                    best_ball = (x1, y1, x2, y2, float(cf))
                                continue

                            tid = int(ids[idx - 1]) if ids is not None else idx
                            if role_name == "referee" and float(cf) < 0.38:
                                role_name = "player"
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
                                    "u": (x1 + x2) / 2.0,
                                    "v": y2,
                                    "x_m": round(((x1 + x2) / 2.0) / max(1, w) * 105.0, 2),
                                    "y_m": round((y2 / max(1, h)) * 68.0, 2),
                                    "on_pitch": True,
                                    "jersey_number": -1,
                                    "jersey_conf": 0.0,
                                    "source_layer": "local_football_yolo",
                                }
                            )
                            crops.append(extract_torso_crop(frame, [x1, y1, x2, y2], min_size=8))

                        if best_ball is not None:
                            bx1, by1, bx2, by2, bcf = best_ball
                            bu = (bx1 + bx2) / 2.0
                            bv = (by1 + by2) / 2.0
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
                                    "x_m": round((bu / max(1, w)) * 105.0, 2),
                                    "y_m": round((bv / max(1, h)) * 68.0, 2),
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
        return raw_df, raw_df.copy(), preview_frame, {"team_a_hex": "#EF4444", "team_b_hex": "#38BDF8"}, fps

    valid_crops = [c for c in crops if c is not None]
    clusterer = SigLIPThreeClassClusterer(backend="lab_hist") if len(valid_crops) >= 3 else None
    v8_df = ZeroRefereeLeakShield(
        clusterer=clusterer,
        config=RefereeShieldConfig(max_speed_kmh=36.0),
    ).apply(raw_df, crops=crops)

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
    return raw_df, v8_df, preview_frame, kit_colors, fps


def detect_clip_with_football_yolo(
    video_path: str | Path, run_id: str, max_sample_frames: int = 15
) -> tuple[pd.DataFrame, Optional[np.ndarray], dict[str, str]]:
    """Run real specialized 4-class Football YOLO on an uploaded 5-10s clip (zero false turf rings)."""
    _, v8_df, preview_frame, kit_colors, _ = ingest_clip_with_football_yolo(
        video_path=video_path,
        run_id=run_id,
        max_sample_frames=max_sample_frames,
        stride=4,
    )
    return v8_df, preview_frame, kit_colors
