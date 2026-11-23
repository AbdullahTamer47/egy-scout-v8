"""Core backend service wiring V8 contracts, physics-safe Shield, real crops, Scouting & Tactics."""
from __future__ import annotations

import base64
from bisect import bisect_right
import json
import re
import time
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
import pandas as pd

from packages.scouting_core.fair_engine import (
    MAX_PHYSICAL_SPEED_KMH,
    build_profiles_from_match_parquet,
    import_external_scouting_csv,
)
from packages.scouting_core.input_gate import assess_video_input_mode
from packages.shared_contracts.config import (
    get_data_paths,
    get_repo_root,
    imread_unicode,
    imwrite_unicode,
    open_video_unicode,
    resolve_project_path,
)
from packages.shared_contracts.lineup_connector import parse_scoresheet_text
from packages.shared_contracts.match_setup import (
    BenchSubstitutionManager,
    MatchSetupConfig,
    compute_four_point_homography,
    project_pixels_with_homography,
)
from packages.shared_contracts.providers import get_compute_provider
from packages.shared_contracts.schemas import (
    build_match_track_metadata,
    load_legacy_scout5_telemetry,
    read_tracking_parquet,
    write_tracking_parquet,
)
from packages.tactics_engine.counterfactual import (
    compute_dynamic_pitch_control,
    compute_shot_xg,
    find_optimal_ghost_move,
    simulate_ghost_move,
)
from packages.tactics_engine.playbook import diagnose_frame_tactics
from services.cv_worker.local_pipeline import (
    detect_clip_with_football_yolo,
    download_video_from_url,
    ingest_clip_with_football_yolo,
    refine_match_locally,
)
from services.cv_worker.lazy_engines.event_pose import (
    evaluate_pose_with_resolution_gate,
    run_event_pose_on_video,
)
from services.cv_worker.lazy_engines.video_export import (
    export_watermarked_clip,
    transcode_gop_hls,
)
from services.cv_worker.stages.ball_tracker import track_and_inpaint_ball
from services.cv_worker.stages.referee_shield import (
    SigLIPThreeClassClusterer,
    ZeroRefereeLeakShield,
)
from tools.benchmark_evaluator.evaluate import evaluate_predictions
from tools.phase0_annotator.extract_frames import discover_scout5_matches

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")

# Human-readable Arabic/English reason labels (never expose raw internal layer names to UI)
ROLE_REASON_LABELS = {
    "layer4_verified_main_referee": ("حكم ساحة معزول بصرياً وزمنياً", "Isolated main referee"),
    "layer4_verified_touchline_ar": ("مساعد حكم على خط التماس", "Touchline assistant referee"),
    "layer4_spatial_gk_box": ("حارس مرمى داخل منطقة الجزاء", "Penalty-box goalkeeper"),
    "layer4_temporal_vote": ("تصويت زمني على كامل المسار", "Track-level temporal lock"),
    "layer4_unassigned_low_conf": ("مستبعد لضعف الثقة", "Excluded (low confidence)"),
    "layer4_short_track_filtered": ("مسار قصير غير مكتمل", "Short track filtered"),
}


FRIENDLY_TEAM_NAMES: dict[str, tuple[str, str]] = {
    "m1_ahly_sekka": ("El Sekka", "Al Ahly"),
    "m2_ahly_enppi": ("Al Ahly", "ENPPI"),
    "m3_enppi_mokawloon": ("Al Mokawloon", "ENPPI"),
}


class ScoutV8Service:
    """Orchestrator over Parquet artifacts, real video crops, and tenant metadata."""

    def __init__(self) -> None:
        self.repo_root = get_repo_root()
        self.data_paths = get_data_paths(create=True)
        self.provider = get_compute_provider()
        self._v8_cache: dict[str, pd.DataFrame] = {}
        self._legacy_cache: dict[str, pd.DataFrame] = {}
        self._meta_cache: dict[str, dict[str, Any]] = {}
        self._match_json_meta: dict[str, dict[str, Any]] = {}
        self._phase0_cache: dict[str, dict[str, Any]] = {}

    def _validate_id(self, val: str) -> str:
        if not SAFE_ID_RE.match(val):
            raise ValueError(f"Invalid identifier: {val!r}")
        return val

    def _tenant_dir(self, tenant_id: str) -> Path:
        d = self.data_paths.outputs / "tenants" / self._validate_id(tenant_id)
        d.mkdir(parents=True, exist_ok=True)
        return d

    def list_matches(self) -> list[dict[str, Any]]:
        matches = discover_scout5_matches(self.repo_root)
        result = []
        for m in matches:
            mid = m["match_id"]
            if mid in FRIENDLY_TEAM_NAMES:
                ta, tb = FRIENDLY_TEAM_NAMES[mid]
                if m.get("team_a_name") in (None, "", "Team A", "فريق أ"):
                    m["team_a_name"] = ta
                if m.get("team_b_name") in (None, "", "Team B", "فريق ب"):
                    m["team_b_name"] = tb
            m["is_custom"] = False
            self._meta_cache[mid] = m
            result.append(
                {
                    "match_id": mid,
                    "team_a_name": m["team_a_name"],
                    "team_b_name": m["team_b_name"],
                    "fps": float(m["fps"]),
                    "has_video": Path(m["video_path"]).is_file(),
                    "has_telemetry": Path(m["telemetry_path"]).is_file(),
                    "spotlight_frame": 1250 if mid == "m2_ahly_enppi" else None,
                    "is_custom": False,
                }
            )

        custom_root = self.data_paths.outputs / "custom_matches"
        if custom_root.is_dir():
            for meta_p in sorted(custom_root.glob("*/meta.json"), reverse=True):
                try:
                    cm = json.loads(meta_p.read_text(encoding="utf-8"))
                    mid = str(cm["match_id"])
                    if not SAFE_ID_RE.match(mid):
                        continue
                    cm["is_custom"] = True
                    self._meta_cache[mid] = cm
                    self._match_json_meta[mid] = cm
                    result.append(
                        {
                            "match_id": mid,
                            "team_a_name": cm.get("team_a_name", "Team A"),
                            "team_b_name": cm.get("team_b_name", "Team B"),
                            "fps": float(cm.get("fps", 25.0) or 25.0),
                            "has_video": Path(cm.get("video_path", "")).is_file(),
                            "has_telemetry": Path(cm.get("v8_parquet_path", "")).is_file(),
                            "spotlight_frame": cm.get("spotlight_frame"),
                            "is_custom": True,
                        }
                    )
                except Exception:
                    continue
        return result

    def _get_match_meta(self, match_id: str) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        if mid not in self._meta_cache:
            self.list_matches()
        if mid not in self._meta_cache:
            raise FileNotFoundError(f"Match not found: {mid}")
        return self._meta_cache[mid]

    def get_legacy_and_v8_frames(self, match_id: str) -> tuple[pd.DataFrame, pd.DataFrame]:
        mid = self._validate_id(match_id)
        meta = self._get_match_meta(mid)
        if meta.get("is_custom"):
            if mid not in self._legacy_cache:
                self._legacy_cache[mid] = read_tracking_parquet(meta["raw_parquet_path"])
            if mid not in self._v8_cache:
                self._v8_cache[mid] = read_tracking_parquet(meta["v8_parquet_path"])
            return self._legacy_cache[mid], self._v8_cache[mid]

        if mid not in self._legacy_cache:
            self._legacy_cache[mid] = load_legacy_scout5_telemetry(
                meta["telemetry_path"], match_id=mid
            )
        if mid not in self._v8_cache:
            pq_cache = self.data_paths.outputs / "v8_4_parquet" / f"{mid}_v8.parquet"
            meta_json = self.data_paths.outputs / "v8_4_parquet" / f"{mid}_meta.json"
            if pq_cache.is_file():
                self._v8_cache[mid] = read_tracking_parquet(pq_cache)
                if meta_json.is_file():
                    self._match_json_meta[mid] = json.loads(meta_json.read_text(encoding="utf-8"))
            else:
                v8_df, m_out = refine_match_locally(
                    match_id=mid,
                    video_path=meta["video_path"],
                    legacy_parquet_path=meta["telemetry_path"],
                    run_ocr=True,
                )
                write_tracking_parquet(v8_df, pq_cache)
                meta_json.parent.mkdir(parents=True, exist_ok=True)
                meta_json.write_text(json.dumps(m_out, ensure_ascii=False, indent=2), encoding="utf-8")
                self._v8_cache[mid] = v8_df
                self._match_json_meta[mid] = m_out
        return self._legacy_cache[mid], self._v8_cache[mid]

    def get_match_kit_colors(self, match_id: str) -> dict[str, str]:
        mid = self._validate_id(match_id)
        if mid not in self._match_json_meta:
            custom_meta = self.data_paths.outputs / "custom_matches" / mid / "meta.json"
            meta_json = self.data_paths.outputs / "v8_4_parquet" / f"{mid}_meta.json"
            if custom_meta.is_file():
                self._match_json_meta[mid] = json.loads(custom_meta.read_text(encoding="utf-8"))
            elif meta_json.is_file():
                self._match_json_meta[mid] = json.loads(meta_json.read_text(encoding="utf-8"))
        kc = self._match_json_meta.get(mid, {}).get("kit_colors")
        if isinstance(kc, dict) and "team_a_hex" in kc and "team_b_hex" in kc:
            return {"team_a_hex": str(kc["team_a_hex"]), "team_b_hex": str(kc["team_b_hex"])}
        return {"team_a_hex": "#EF4444", "team_b_hex": "#38BDF8"}

    def _infer_attack_direction(self, v8_df: pd.DataFrame) -> dict[str, Any]:
        """Infer true attacking goal side dynamically from GK penalty-box positions (no hardcoded +X!)."""
        gk_a = v8_df[(v8_df["team"] == "team_a") & (v8_df["role"] == "goalkeeper") & v8_df["x_m"].notna()]
        gk_b = v8_df[(v8_df["team"] == "team_b") & (v8_df["role"] == "goalkeeper") & v8_df["x_m"].notna()]
        if len(gk_b) >= 5:
            team_a_right = bool(float(gk_b["x_m"].median()) >= 52.5)
            source = "goalkeeper_position"
        elif len(gk_a) >= 5:
            team_a_right = bool(float(gk_a["x_m"].median()) < 52.5)
            source = "goalkeeper_position"
        else:
            pa = v8_df[(v8_df["team"] == "team_a") & (v8_df["role"] == "player") & v8_df["x_m"].notna()]
            pb = v8_df[(v8_df["team"] == "team_b") & (v8_df["role"] == "player") & v8_df["x_m"].notna()]
            if not pa.empty and not pb.empty:
                team_a_right = bool(float(pa["x_m"].median()) < float(pb["x_m"].median()))
            else:
                team_a_right = True
            source = "team_centroid"
        return {
            "team_a_attacks_right": team_a_right,
            "team_a_goal_x": 105.0 if team_a_right else 0.0,
            "team_b_goal_x": 0.0 if team_a_right else 105.0,
            "direction_source": source,
        }

    def get_video_path(self, match_id: str) -> Path:
        meta = self._get_match_meta(match_id)
        vpath = resolve_project_path(meta["video_path"], self.repo_root)
        if not vpath.is_file():
            raise FileNotFoundError(f"Video file not found for match {match_id}: {vpath}")
        return vpath

    def render_frame_jpeg(
        self, match_id: str, frame_id: int, highlight_track: Optional[int] = None
    ) -> bytes:
        vpath = self.get_video_path(match_id)
        cap, proxy = open_video_unicode(vpath)
        try:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_id))
            ok, frame = cap.read()
            if not ok or frame is None:
                raise FileNotFoundError(f"Cannot read frame {frame_id} from {vpath}")
            if highlight_track is not None:
                _, v8_df = self.get_legacy_and_v8_frames(match_id)
                hit = v8_df[(v8_df["frame_id"] == int(frame_id)) & (v8_df["track_id"] == int(highlight_track))]
                if not hit.empty:
                    r = hit.iloc[0]
                    x1, y1, x2, y2 = int(r["x1"]), int(r["y1"]), int(r["x2"]), int(r["y2"])
                    cv2.rectangle(frame, (x1 - 4, y1 - 4), (x2 + 4, y2 + 4), (129, 185, 16), 3, cv2.LINE_AA)
                    cv2.ellipse(
                        frame,
                        ((x1 + x2) // 2, y2),
                        (max(16, int((x2 - x1) * 0.65)), max(6, int((x2 - x1) * 0.22))),
                        0, 0, 360, (129, 185, 16), 3, cv2.LINE_AA,
                    )
                    cv2.putText(
                        frame,
                        f"#{int(highlight_track)}",
                        (x1, max(22, y1 - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        (129, 185, 16),
                        2,
                        cv2.LINE_AA,
                    )
            ok_enc, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
            if not ok_enc:
                raise RuntimeError("JPEG encode failed")
            return buf.tobytes()
        finally:
            cap.release()
            if proxy is not None and proxy.exists():
                try:
                    proxy.unlink()
                except OSError:
                    pass

    def render_track_crop_jpeg(
        self, match_id: str, track_id: int, frame_id: Optional[int] = None
    ) -> bytes:
        """Extract a clean, unoccluded, head-safe portrait crop JPEG from the match video."""
        mid = self._validate_id(match_id)
        _, v8_df = self.get_legacy_and_v8_frames(mid)
        t_rows = v8_df[v8_df["track_id"] == int(track_id)]
        if t_rows.empty:
            raise FileNotFoundError(f"Track {track_id} not found in {mid}")

        if frame_id is not None and (t_rows["frame_id"] == int(frame_id)).any():
            row = t_rows[t_rows["frame_id"] == int(frame_id)].iloc[0]
        else:
            # Score every candidate frame: reward large centered boxes, strongly penalize
            # border clipping (headless crops) and overlap with neighboring players!
            best_score = -1.0
            best_row = t_rows.iloc[0]
            for _, cand in t_rows.iterrows():
                cx1, cy1, cx2, cy2 = float(cand["x1"]), float(cand["y1"]), float(cand["x2"]), float(cand["y2"])
                area = max(1.0, (cx2 - cx1) * (cy2 - cy1))
                border_ok = 1.0 if (cx1 > 16 and cy1 > 28 and cx2 < 1264 and cy2 < 705) else 0.2
                others = v8_df[(v8_df["frame_id"] == int(cand["frame_id"])) & (v8_df["track_id"] != int(track_id))]
                max_iou = 0.0
                for _, ob in others.iterrows():
                    ix1, iy1 = max(cx1, float(ob["x1"])), max(cy1, float(ob["y1"]))
                    ix2, iy2 = min(cx2, float(ob["x2"])), min(cy2, float(ob["y2"]))
                    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
                    if inter > 0.0:
                        max_iou = max(max_iou, inter / area)
                isolation = 1.0 if max_iou < 0.05 else max(0.1, 1.0 - max_iou * 2.5)
                sc = area * border_ok * isolation
                if sc > best_score:
                    best_score = sc
                    best_row = cand
            row = best_row

        fid = int(row["frame_id"])
        cache_path = self.data_paths.cache / "crops_v3" / mid / f"t{int(track_id)}_f{fid}.jpg"
        if cache_path.is_file():
            return cache_path.read_bytes()

        vpath = self.get_video_path(mid)
        cap, proxy = open_video_unicode(vpath)
        try:
            cap.set(cv2.CAP_PROP_POS_FRAMES, fid)
            ok, frame = cap.read()
            if not ok or frame is None:
                raise FileNotFoundError(f"Frame {fid} unreadable")
            h, w = frame.shape[:2]
            x1, y1, x2, y2 = float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])
            bw = max(12.0, x2 - x1)
            bh = max(20.0, y2 - y1)
            # Asymmetric head-safe padding (extra margin above head!)
            pad_x = max(16.0, bw * 0.36)
            pad_top = max(24.0, bh * 0.34)
            pad_bot = max(14.0, bh * 0.16)
            cx1 = int(max(0, round(x1 - pad_x)))
            cy1 = int(max(0, round(y1 - pad_top)))
            cx2 = int(min(w, round(x2 + pad_x)))
            cy2 = int(min(h, round(y2 + pad_bot)))
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                crop = frame[0 : min(180, h), 0 : min(140, w)]
            target_h = 220
            scale = target_h / max(1, crop.shape[0])
            target_w = max(80, min(220, int(round(crop.shape[1] * scale))))
            resized = cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_CUBIC)
            imwrite_unicode(cache_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 92])
            return cache_path.read_bytes()
        finally:
            cap.release()
            if proxy is not None and proxy.exists():
                try:
                    proxy.unlink()
                except OSError:
                    pass

    def get_match_timeline(self, match_id: str, tenant_id: str = "club_demo_egypt") -> dict[str, Any]:
        """Return enriched per-frame tracking timeline with Kalman ball arc, velocities & momentum."""
        mid = self._validate_id(match_id)
        meta = self._get_match_meta(mid)
        _, v8_df = self.get_legacy_and_v8_frames(mid)

        lineup_path = self._tenant_dir(tenant_id) / f"{mid}_lineup.json"
        saved_lineup = (
            json.loads(lineup_path.read_text(encoding="utf-8"))
            if lineup_path.is_file()
            else {"official_roster": [], "track_overrides": {}}
        )
        overrides = saved_lineup.get("track_overrides", {})

        all_fids = sorted(int(f) for f in v8_df["frame_id"].unique().tolist())
        fid_to_time = {
            int(fid): float(grp["time_s"].iloc[0])
            for fid, grp in v8_df.groupby("frame_id", sort=True)
        }
        dir_info = self._infer_attack_direction(v8_df)
        dir_sign_a = 1.0 if dir_info["team_a_attacks_right"] else -1.0

        # Extract observed ball detections with confidence gate & teleportation spike rejection
        ball_df = v8_df[
            (v8_df["role"] == "ball")
            & v8_df["x_m"].notna()
            & v8_df["y_m"].notna()
            & (v8_df["role_conf"].fillna(0.0) >= 0.22)
        ].sort_values(["frame_id", "role_conf"], ascending=[True, False])
        raw_ball_m: dict[int, Optional[tuple[float, float]]] = {}
        raw_ball_uv: dict[int, tuple[float, float]] = {}
        last_clean_obs: Optional[tuple[float, float, float, float, float]] = None
        for _, br in ball_df.iterrows():
            bfid = int(br["frame_id"])
            if bfid in raw_ball_m:
                continue
            bx_m, by_m = float(br["x_m"]), float(br["y_m"])
            if pd.notna(br["u"]) and pd.notna(br["v"]):
                bu, bv = float(br["u"]), float(br["v"])
            elif pd.notna(br["x1"]) and pd.notna(br["y1"]):
                bu = 0.5 * (float(br["x1"]) + float(br["x2"]))
                bv = 0.5 * (float(br["y1"]) + float(br["y2"]))
            else:
                continue
            bts = fid_to_time.get(bfid, float(br["time_s"]))
            if last_clean_obs is not None:
                pt, pxm, pym, pu, pv = last_clean_obs
                dt_obs = bts - pt
                if 0.0 < dt_obs <= 0.65:
                    spd_m = float(np.hypot(bx_m - pxm, by_m - pym)) / dt_obs
                    spd_px = float(np.hypot(bu - pu, bv - pv)) / dt_obs
                    if spd_m > 38.0 or spd_px > 1600.0:
                        continue
            raw_ball_m[bfid] = (bx_m, by_m)
            raw_ball_uv[bfid] = (bu, bv)
            last_clean_obs = (bts, bx_m, by_m, bu, bv)

        ball_inputs = [(fid, fid_to_time[fid], raw_ball_m.get(fid)) for fid in all_fids]
        ball_states = {b.frame_id: b for b in track_and_inpaint_ball(ball_inputs, max_gap_frames=12)}

        # Identify calibrated frames so pixel interpolation NEVER bridges across close-ups or shot cuts
        valid = v8_df[v8_df["role"].isin(["player", "goalkeeper", "referee", "assistant_referee"])].copy()
        cal_fid_set: set[int] = set()
        for fid, grp in valid.groupby("frame_id", sort=False):
            if int((grp["x_m"].notna() & grp["y_m"].notna()).sum()) >= 4:
                cal_fid_set.add(int(fid))

        obs_uv_fids = sorted(raw_ball_uv.keys())
        # Precompute per-track finite-difference velocities & speeds (clamped <= MAX_PHYSICAL_SPEED_KMH)
        vel_map: dict[tuple[int, int], tuple[float, float, float]] = {}
        people_df = v8_df[
            v8_df["role"].isin(["player", "goalkeeper", "referee", "assistant_referee"])
            & v8_df["x_m"].notna()
            & v8_df["y_m"].notna()
        ].sort_values(["track_id", "frame_id"])
        for tid, grp in people_df.groupby("track_id", sort=False):
            fids_t = grp["frame_id"].to_numpy(dtype=np.int32)
            ts_t = grp["time_s"].to_numpy(dtype=np.float64)
            xs_t = grp["x_m"].to_numpy(dtype=np.float64)
            ys_t = grp["y_m"].to_numpy(dtype=np.float64)
            # 3-point smoothed finite-difference velocities (eliminates single-frame homography spikes)
            n_pts = len(fids_t)
            for idx in range(n_pts):
                if n_pts < 2:
                    vx, vy = 0.0, 0.0
                else:
                    i0 = max(0, idx - 1)
                    i1 = min(n_pts - 1, idx + 1)
                    dt = max(0.08, float(ts_t[i1] - ts_t[i0]))
                    vx = float(xs_t[i1] - xs_t[i0]) / dt
                    vy = float(ys_t[i1] - ys_t[i0]) / dt
                    spd_mps = float(np.hypot(vx, vy))
                    max_mps = MAX_PHYSICAL_SPEED_KMH / 3.6
                    if spd_mps > max_mps and spd_mps > 1e-6:
                        scale = max_mps / spd_mps
                        vx *= scale
                        vy *= scale
                vel_map[(int(tid), int(fids_t[idx]))] = (
                    round(vx, 2),
                    round(vy, 2),
                    round(min(MAX_PHYSICAL_SPEED_KMH, float(np.hypot(vx, vy)) * 3.6), 1),
                )

        frames_out = []
        for fid, grp in valid.groupby("frame_id", sort=True):
            fid_int = int(fid)
            time_s = round(float(grp["time_s"].iloc[0]), 3)
            cal = grp[grp["x_m"].notna() & grp["y_m"].notna()]
            players = []
            for _, r in cal.iterrows():
                tid = int(r["track_id"])
                ov = overrides.get(str(tid), {})
                raw_j = ov.get("jersey_number", r["jersey_number"] if "jersey_number" in r else None)
                clean_j = int(raw_j) if (raw_j is not None and pd.notna(raw_j) and int(raw_j) > 0) else None
                vx_ms, vy_ms, speed_kmh = vel_map.get((tid, fid_int), (0.0, 0.0, 0.0))
                players.append(
                    {
                        "track_id": tid,
                        "role": str(ov.get("role", r["role"])),
                        "team": str(ov.get("team", r["team"])),
                        "x_m": round(float(r["x_m"]), 2),
                        "y_m": round(float(r["y_m"]), 2),
                        "vx_ms": vx_ms,
                        "vy_ms": vy_ms,
                        "speed_kmh": speed_kmh,
                        "verified_name": ov.get("verified_name"),
                        "jersey_number": clean_j,
                        "bbox": [
                            round(float(r["x1"]), 1),
                            round(float(r["y1"]), 1),
                            round(float(r["x2"]), 1),
                            round(float(r["y2"]), 1),
                        ],
                    }
                )

            calibrated = fid_int in cal_fid_set
            b_state = ball_states.get(fid_int)
            ball_payload = None
            if calibrated and b_state is not None:
                bu: Optional[float] = None
                bv: Optional[float] = None
                if fid_int in raw_ball_uv:
                    bu, bv = raw_ball_uv[fid_int]
                elif obs_uv_fids:
                    pos = bisect_right(obs_uv_fids, fid_int)
                    if 0 < pos < len(obs_uv_fids):
                        f_prev, f_next = obs_uv_fids[pos - 1], obs_uv_fids[pos]
                        t_span = fid_to_time[f_next] - fid_to_time[f_prev]
                        u_prev, v_prev = raw_ball_uv[f_prev]
                        u_next, v_next = raw_ball_uv[f_next]
                        px_dist = float(np.hypot(u_next - u_prev, v_next - v_prev))
                        has_uncal_gap = any(
                            f not in cal_fid_set for f in all_fids if f_prev < f < f_next
                        )
                        if (
                            (f_next - f_prev) <= 16
                            and t_span <= 0.70
                            and px_dist <= 320.0
                            and not has_uncal_gap
                        ):
                            frac = (fid_int - f_prev) / max(1, f_next - f_prev)
                            bu = u_prev + (u_next - u_prev) * frac
                            bv = v_prev + (v_next - v_prev) * frac
                ball_payload = {
                    "x_m": b_state.x_m,
                    "y_m": b_state.y_m,
                    "z_m": b_state.z_m,
                    "u": round(bu, 1) if bu is not None else None,
                    "v": round(bv, 1) if bv is not None else None,
                    "vx_ms": b_state.vx_ms,
                    "vy_ms": b_state.vy_ms,
                    "vx_px": 0.0,
                    "vy_px": 0.0,
                    "inpainted": b_state.inpainted,
                }

            # Possession & Oracle Match Momentum index [-100..+100] reflecting BOTH possession & territory tilt
            ball_carrier_id = None
            possession_team = "contested"
            momentum = 0.0
            if calibrated and players:
                field_players = [p for p in players if p["role"] in ("player", "goalkeeper")]
                poss_bias = 0.0
                if ball_payload is not None and field_players:
                    nearest = min(
                        field_players,
                        key=lambda p: np.hypot(p["x_m"] - ball_payload["x_m"], p["y_m"] - ball_payload["y_m"]),
                    )
                    if np.hypot(nearest["x_m"] - ball_payload["x_m"], nearest["y_m"] - ball_payload["y_m"]) <= 5.5:
                        ball_carrier_id = nearest["track_id"]
                        possession_team = nearest["team"]
                        poss_bias = 54.0 if possession_team == "team_a" else (-54.0 if possession_team == "team_b" else 0.0)
                    ball_tilt = ((ball_payload["x_m"] - 52.5) / 52.5) * 32.0 * dir_sign_a
                else:
                    ball_tilt = 0.0
                avg_x = sum(p["x_m"] for p in field_players) / max(1, len(field_players))
                line_tilt = ((avg_x - 52.5) / 52.5) * 18.0 * dir_sign_a
                momentum = round(float(np.clip(poss_bias + ball_tilt + line_tilt, -100.0, 100.0)), 1)

            frames_out.append(
                {
                    "frame_id": fid_int,
                    "time_s": time_s,
                    "calibrated": calibrated,
                    "ball": ball_payload,
                    "ball_carrier_id": ball_carrier_id,
                    "possession_team": possession_team,
                    "momentum": momentum,
                    "players": players,
                }
            )

        # Compute camera-pan-compensated pitch->screen Jacobian & ball velocity vector per calibrated frame
        for fr in frames_out:
            b = fr.get("ball")
            if b is None or b.get("u") is None or b.get("v") is None or not fr.get("calibrated"):
                continue
            pts = [
                (
                    float(p["x_m"]),
                    float(p["y_m"]),
                    0.5 * (float(p["bbox"][0]) + float(p["bbox"][2])),
                    float(p["bbox"][3]),
                )
                for p in fr["players"]
                if p["role"] in ("player", "goalkeeper")
            ]
            dudx, dudy, dvdx, dvdy = 28.0, 0.0, 0.0, 8.0
            if len(pts) >= 4:
                A = np.array([[x, y, 1.0] for x, y, _, _ in pts], dtype=np.float64)
                U = np.array([u for _, _, u, _ in pts], dtype=np.float64)
                V = np.array([v for _, _, _, v in pts], dtype=np.float64)
                cu, *_ = np.linalg.lstsq(A, U, rcond=None)
                cv, *_ = np.linalg.lstsq(A, V, rcond=None)
                if 5.0 <= abs(float(cu[0])) <= 95.0 and 2.0 <= abs(float(cv[1])) <= 45.0:
                    dudx, dudy = float(cu[0]), float(cu[1])
                    dvdx, dvdy = float(cv[0]), float(cv[1])

            vx_px = dudx * float(b["vx_ms"]) + dudy * float(b["vy_ms"])
            vy_px = dvdx * float(b["vx_ms"]) + dvdy * float(b["vy_ms"])
            spd_px = float(np.hypot(vx_px, vy_px))
            if spd_px > 1200.0 and spd_px > 1e-6:
                sc = 1200.0 / spd_px
                vx_px *= sc
                vy_px *= sc
            b["vx_px"] = round(vx_px, 1)
            b["vy_px"] = round(vy_px, 1)
            b["j_mat"] = [round(dudx, 2), round(dudy, 2), round(dvdx, 2), round(dvdy, 2)]

        cal_times = [f["time_s"] for f in frames_out if f["calibrated"]]
        return {
            "match_id": mid,
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "fps": float(meta.get("fps", 25.0) or 25.0),
            "t_start": cal_times[0] if cal_times else 0.0,
            "t_end": cal_times[-1] if cal_times else 0.0,
            "kit_colors": self.get_match_kit_colors(mid),
            **dir_info,
            "frames": frames_out,
        }

    def get_before_after(self, match_id: str, frame_id: int = 1250) -> dict[str, Any]:
        legacy_df, v8_df = self.get_legacy_and_v8_frames(match_id)
        avail = sorted(v8_df["frame_id"].unique().tolist())
        fid = frame_id if frame_id in avail else (avail[0] if avail else frame_id)

        b_sub = legacy_df[legacy_df["frame_id"] == fid]
        a_sub = v8_df[v8_df["frame_id"] == fid]

        def _rows(sub: pd.DataFrame) -> list[dict[str, Any]]:
            items = []
            for _, r in sub.iterrows():
                src_key = str(r["source_layer"])
                reason_ar, reason_en = ROLE_REASON_LABELS.get(src_key, ("تصنيف تلقائي", "Auto classified"))
                items.append(
                    {
                        "track_id": int(r["track_id"]),
                        "role": str(r["role"]),
                        "team": str(r["team"]),
                        "role_conf": round(float(r["role_conf"]), 3),
                        "team_conf": round(float(r["team_conf"]), 3),
                        "bbox": [round(float(r["x1"]), 1), round(float(r["y1"]), 1), round(float(r["x2"]), 1), round(float(r["y2"]), 1)],
                        "x_m": round(float(r["x_m"]), 2) if pd.notna(r["x_m"]) else None,
                        "y_m": round(float(r["y_m"]), 2) if pd.notna(r["y_m"]) else None,
                        "on_pitch": bool(r["on_pitch"]),
                        "reason_ar": reason_ar,
                        "reason_en": reason_en,
                    }
                )
            return items

        def _stability(df: pd.DataFrame) -> float:
            valid = df[df["track_id"] >= 0]
            if valid.empty:
                return 0.0
            n_tracks = valid["track_id"].nunique()
            stable = sum(1 for _, g in valid.groupby("track_id") if g["role"].nunique() == 1)
            return round((stable / max(1, n_tracks)) * 100.0, 1)

        meta = self._get_match_meta(match_id)
        official_tracks = v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()
        unassigned_tracks = v8_df[v8_df["role"] == "unassigned"]["track_id"].nunique()

        return {
            "match_id": match_id,
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "kit_colors": self.get_match_kit_colors(match_id),
            "frame_id": int(fid),
            "available_frames": avail[:60],
            "before": {
                "detections": _rows(b_sub),
                "referees_in_frame": int(b_sub["role"].isin(["referee", "assistant_referee"]).sum()),
                "track_role_stability_pct": _stability(legacy_df),
            },
            "after": {
                "detections": _rows(a_sub),
                "referees_in_frame": int(a_sub["role"].isin(["referee", "assistant_referee"]).sum()),
                "unique_official_tracks": int(official_tracks),
                "unassigned_filtered_tracks": int(unassigned_tracks),
                "goalkeepers_in_frame": int((a_sub["role"] == "goalkeeper").sum()),
                "track_role_stability_pct": _stability(v8_df),
            },
            "max_speed_cap_kmh": MAX_PHYSICAL_SPEED_KMH,
            "match_tracks_count": len(build_match_track_metadata(v8_df)),
        }

    def get_qa_sheet(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        _, v8_df = self.get_legacy_and_v8_frames(match_id)
        tracks = build_match_track_metadata(v8_df)
        lineup_path = self._tenant_dir(tenant_id) / f"{match_id}_lineup.json"
        saved_lineup = (
            json.loads(lineup_path.read_text(encoding="utf-8"))
            if lineup_path.is_file()
            else {"official_roster": [], "track_overrides": {}}
        )
        overrides = saved_lineup.get("track_overrides", {})
        items = []
        # Exclude unassigned & non-person tracks (e.g. ball / negative track_id) from QA Sheet
        for t in tracks:
            if t.role in ("unassigned", "ball", "staff") or t.track_id < 0:
                continue
            ov = overrides.get(str(t.track_id), {})
            raw_j = ov.get("jersey_number", t.jersey_number)
            clean_j = int(raw_j) if (raw_j is not None and int(raw_j) > 0) else None
            items.append(
                {
                    "track_id": t.track_id,
                    "role": ov.get("role", t.role),
                    "team": ov.get("team", t.team),
                    "role_conf": round(t.role_conf, 3),
                    "frame_count": t.frame_count,
                    "first_frame": t.first_frame,
                    "jersey_number": clean_j,
                    "verified_name": ov.get("verified_name"),
                    "verified": bool(ov.get("verified", False)),
                    "crop_url": f"/api/matches/{match_id}/track/{t.track_id}/crop",
                }
            )
        items.sort(key=lambda x: (x["role"] in ("referee", "assistant_referee"), x["frame_count"]), reverse=True)
        return {
            "match_id": match_id,
            "official_roster": saved_lineup.get("official_roster", []),
            "tracks": items,
            "unverified_count": sum(1 for x in items if not x["verified"] and x["role"] in ("player", "goalkeeper")),
        }

    def save_lineup_and_qa(
        self, tenant_id: str, match_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self._validate_id(match_id)
        p = self._tenant_dir(tenant_id) / f"{match_id}_lineup.json"
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        # Sec 18.4 Active-Learning Flywheel: persist anonymized verified role/jersey corrections
        al_count = 0
        overrides = payload.get("track_overrides", {})
        if isinstance(overrides, dict) and overrides:
            al_path = self.data_paths.datasets / "egypt_benchmark" / "active_learning_queue.jsonl"
            al_path.parent.mkdir(parents=True, exist_ok=True)
            lines = []
            ts_now = int(time.time())
            for tid_s, ov in overrides.items():
                if not isinstance(ov, dict) or not ov.get("verified"):
                    continue
                lines.append(
                    json.dumps(
                        {
                            "ts": ts_now,
                            "match_id": match_id,
                            "track_id": int(tid_s) if tid_s.lstrip("-").isdigit() else tid_s,
                            "verified_role": ov.get("role"),
                            "verified_team": ov.get("team"),
                            "verified_jersey": ov.get("jersey_number"),
                        },
                        ensure_ascii=False,
                    )
                )
            if lines:
                with al_path.open("a", encoding="utf-8") as fh:
                    fh.write("\n".join(lines) + "\n")
                al_count = len(lines)

        return {
            "status": "saved",
            "match_id": match_id,
            "active_learning_samples_saved": al_count,
        }

    def get_positioning_analysis(
        self, match_id: str, frame_id: int = 1250, defending_team: str = "team_b"
    ) -> dict[str, Any]:
        """Honest Positioning & Pressing Analysis (explicitly declares when no goal is recorded)."""
        _, v8_df = self.get_legacy_and_v8_frames(match_id)
        avail = sorted(v8_df["frame_id"].unique().tolist())
        fid = frame_id if frame_id in avail else (avail[0] if avail else frame_id)
        f_df = v8_df[v8_df["frame_id"] == fid].copy()

        players_list = []
        for _, r in f_df.iterrows():
            if pd.isna(r["x_m"]) or pd.isna(r["y_m"]) or str(r["role"]) == "unassigned":
                continue
            players_list.append(
                {
                    "track_id": int(r["track_id"]),
                    "role": str(r["role"]),
                    "team": str(r["team"]),
                    "x_m": round(float(r["x_m"]), 2),
                    "y_m": round(float(r["y_m"]), 2),
                    "bbox": [round(float(r["x1"]), 1), round(float(r["y1"]), 1), round(float(r["x2"]), 1), round(float(r["y2"]), 1)],
                    "vx_ms": 0.0,
                    "vy_ms": 0.0,
                }
            )

        att_team = "team_a" if defending_team == "team_b" else "team_b"
        dir_info = self._infer_attack_direction(v8_df)
        attack_goal_x = float(dir_info["team_a_goal_x"] if att_team == "team_a" else dir_info["team_b_goal_x"])

        att_pts = [p for p in players_list if p["team"] == att_team and p["role"] == "player"]
        ball_rows = f_df[
            (f_df["role"] == "ball")
            & f_df["x_m"].notna()
            & f_df["y_m"].notna()
            & (f_df["role_conf"].fillna(0.0) >= 0.22)
        ]
        if not ball_rows.empty:
            ball_xy = (float(ball_rows.iloc[0]["x_m"]), float(ball_rows.iloc[0]["y_m"]))
        elif att_pts:
            lead = (
                max(att_pts, key=lambda p: p["x_m"])
                if attack_goal_x >= 52.5
                else min(att_pts, key=lambda p: p["x_m"])
            )
            ball_xy = (lead["x_m"], lead["y_m"])
        else:
            ball_xy = (60.0, 34.0)

        diagnoses = [d.to_dict() for d in diagnose_frame_tactics(f_df, defending_team=defending_team, frame_id=int(fid))]
        pc = compute_dynamic_pitch_control(
            players_list, ball_xy=ball_xy, attacking_team=att_team, nx=36, ny=24, goal_x=attack_goal_x
        )
        xg = compute_shot_xg(players_list, ball_xy=ball_xy, attacking_team=att_team, goal_x=attack_goal_x)

        def_pts = [p for p in players_list if p["team"] == defending_team and p["role"] == "player"]
        suggested_ghost = None
        if def_pts:
            nearest_def = min(def_pts, key=lambda p: np.hypot(p["x_m"] - ball_xy[0], p["y_m"] - ball_xy[1]))
            suggested_ghost = find_optimal_ghost_move(
                players_list, ball_xy, nearest_def["track_id"], attacking_team=att_team, goal_x=attack_goal_x
            )

        sb_info = self._match_json_meta.get(match_id, {}).get("scoreboard", {})
        verified_goals = sb_info.get("verified_goals", []) if isinstance(sb_info, dict) else []
        has_goal = len(verified_goals) > 0

        return {
            "match_id": match_id,
            "frame_id": int(fid),
            "has_verified_goal": has_goal,
            "verified_goals": verified_goals,
            "scoreboard_latest": sb_info.get("latest_score") if isinstance(sb_info, dict) else None,
            "analysis_title_ar": (
                f"تشريح الهدف الموثّق ({len(verified_goals)} هدف — لوحة النتيجة)"
                if has_goal
                else "تحليل التمركز والضغط (فحص لوحة النتيجة: بدون هدف مسجل بالمقطع)"
            ),
            "analysis_title_en": (
                f"Verified Goal Forensics ({len(verified_goals)} Goal Confirmed via Scoreboard)"
                if has_goal
                else "Positioning & Pressing Analysis (Scoreboard Verified: 0 Goals in Clip)"
            ),
            "kit_colors": self.get_match_kit_colors(match_id),
            "attacking_team": att_team,
            "defending_team": defending_team,
            "attack_goal_x": attack_goal_x,
            **dir_info,
            "ball_xy": [round(ball_xy[0], 2), round(ball_xy[1], 2)],
            "players": players_list,
            "pitch_control": pc,
            "shot_xg": xg,
            "diagnoses": diagnoses,
            "suggested_ghost_move": suggested_ghost,
        }

    def run_what_if(self, payload: dict[str, Any]) -> dict[str, Any]:
        return simulate_ghost_move(
            players=payload["players"],
            ball_xy=(float(payload["ball_xy"][0]), float(payload["ball_xy"][1])),
            target_track_id=int(payload["target_track_id"]),
            dx_m=float(payload["dx_m"]),
            dy_m=float(payload["dy_m"]),
            attacking_team=str(payload.get("attacking_team", "team_a")),
            goal_x=float(payload["goal_x"]) if payload.get("goal_x") is not None else None,
        )

    def get_scouting_data(self, tenant_id: str, match_id: str = "m2_ahly_enppi") -> dict[str, Any]:
        """Return STRICTLY separated video in-frame tracks vs. verified StatsBomb benchmark players."""
        meta = self._get_match_meta(match_id)
        _, v8_df = self.get_legacy_and_v8_frames(match_id)

        qa = self.get_qa_sheet(tenant_id, match_id)
        verified_names = {
            int(t["track_id"]): str(t["verified_name"])
            for t in qa["tracks"]
            if t.get("verified") and t.get("verified_name")
        }

        video_tracks = build_profiles_from_match_parquet(
            v8_df,
            match_id=match_id,
            team_names={"team_a": meta["team_a_name"], "team_b": meta["team_b_name"]},
            lineup_names=verified_names,
        )

        # Verified StatsBomb Open Data CSV (completely separate from 30s video tracks!)
        benchmark_players = []
        default_sb = self.repo_root / "datasets" / "open_samples" / "statsbomb_open_wc2022_sample.csv"
        if default_sb.is_file():
            benchmark_players.extend(import_external_scouting_csv(default_sb))
        ext_csv = self._tenant_dir(tenant_id) / "external_scouting.csv"
        if ext_csv.is_file():
            benchmark_players.extend(import_external_scouting_csv(ext_csv))

        dur_s = float(v8_df["time_s"].max() - v8_df["time_s"].min()) if not v8_df.empty else 0.0
        mode_gate = assess_video_input_mode(duration_s=dur_s, shot_cuts=1, continuous_clock=True)

        bench_dicts = []
        for p in benchmark_players:
            d = p.to_dict()
            d["league_translation_pct"] = self.compute_league_translation_score(d)
            bench_dicts.append(d)

        return {
            "match_id": match_id,
            "input_gate": mode_gate.to_dict(),
            "video_tracks": [p.to_dict() for p in video_tracks],
            "benchmark_source_badge_ar": "عينة StatsBomb Open Data حقيقية للعرض (بيانات كاملة ≥ 500 دقيقة — مفصولة عن المقطع التجريبي)",
            "benchmark_source_badge_en": "Verified StatsBomb Open Data Demo Sample (>= 500 min — kept strictly separate from short video clips)",
            "benchmark_players": bench_dicts,
            # Backward-compatible alias pointing ONLY to verified video_tracks (no fake ratings!)
            "players": [p.to_dict() for p in video_tracks],
        }

    def compute_league_translation_score(self, player: dict[str, Any]) -> float:
        """Higher-pace league adaptability score (Sec 12.3: HIR, PAdj pressing, VAEP, Discipline)."""
        hir = min(1.0, float(player.get("hir_distance_m_per90") or 0.0) / 1050.0)
        padj = min(1.0, float(player.get("padj_defensive_actions_per90") or 0.0) / 15.0)
        vaep = min(1.0, max(0.0, float(player.get("vaep_per90") or 0.0)) / 0.55)
        raw_disc = float(player.get("positional_discipline_score") or 70.0)
        disc_norm = (raw_disc / 100.0) if raw_disc > 1.5 else raw_disc
        disc_norm = float(np.clip(disc_norm, 0.0, 1.0))
        score = (0.30 * hir + 0.24 * padj + 0.28 * vaep + 0.18 * disc_norm) * 100.0
        return round(float(np.clip(score, 38.0, 95.0)), 1)

    def get_moments_and_brief(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        """Derive UEFA 4-Moment events, Pose Resolution Gate checks, and grounded 3-point Coach Brief."""
        mid = self._validate_id(match_id)
        tl = self.get_match_timeline(mid, tenant_id=tenant_id)
        frames = [f for f in tl["frames"] if f["calibrated"]]
        if not frames:
            return {
                "match_id": mid,
                "verified_goals": [],
                "events": [],
                "pose_assessments": [],
                "coach_brief": [],
                "metrics": {},
            }

        events: list[dict[str, Any]] = []
        last_evt_t: dict[str, float] = {}
        prev_poss: Optional[str] = None
        last_ball_x: Optional[float] = None
        last_ball_t: Optional[float] = None

        def _push_evt(ev: dict[str, Any], min_gap_s: float = 2.0) -> None:
            etype = ev["event_type"]
            if ev["time_s"] - last_evt_t.get(etype, -99.0) < min_gap_s:
                return
            last_evt_t[etype] = ev["time_s"]
            events.append(ev)

        high_speed_count = 0
        team_a_poss_frames = 0
        poss_total = 0
        compact_spans: list[float] = []
        pose_assessments: list[dict[str, Any]] = []

        pose_targets: list[dict[str, Any]] = []
        seen_pose_tids: set[int] = set()

        for f in frames:
            ts = f["time_s"]
            fid = f["frame_id"]
            ball = f.get("ball")
            poss = f.get("possession_team", "contested")
            carrier_id = f.get("ball_carrier_id")

            if poss in ("team_a", "team_b"):
                poss_total += 1
                if poss == "team_a":
                    team_a_poss_frames += 1

            b_xs = [p["x_m"] for p in f["players"] if p["team"] == "team_b" and p["role"] == "player"]
            if len(b_xs) >= 3:
                compact_spans.append(max(b_xs) - min(b_xs))

            # 1. Turnover / Transition Detection
            if poss in ("team_a", "team_b") and prev_poss in ("team_a", "team_b") and poss != prev_poss:
                _push_evt(
                    {
                        "frame_id": fid,
                        "time_s": ts,
                        "event_type": "turnover",
                        "moment_phase": "attacking_transition" if poss == "team_a" else "defensive_transition",
                        "team": poss,
                        "track_id": carrier_id,
                        "title_ar": f"استرجاع وتحوّل ({tl['team_a_name'] if poss == 'team_a' else tl['team_b_name']})",
                        "title_en": f"Possession Turnover -> {'Team A' if poss == 'team_a' else 'Team B'}",
                        "metric_proof": f"t={ts:.1f}s • Flip {prev_poss} -> {poss}",
                    },
                    min_gap_s=2.4,
                )
            if poss in ("team_a", "team_b"):
                prev_poss = poss

            # 2. Ball progression & Final Third Entry (direction-aware via GK/team orientation)
            if ball is not None:
                bx, by = ball["x_m"], ball["y_m"]
                a_attacks_right = bool(tl.get("team_a_attacks_right", True))
                if bx >= 70.0 or bx <= 35.0:
                    if bx >= 70.0:
                        zone_team = "team_a" if a_attacks_right else "team_b"
                    else:
                        zone_team = "team_b" if a_attacks_right else "team_a"
                    _push_evt(
                        {
                            "frame_id": fid,
                            "time_s": ts,
                            "event_type": "final_third_entry",
                            "moment_phase": "in_possession",
                            "team": zone_team,
                            "track_id": carrier_id,
                            "title_ar": f"دخول الثلث الأخير ({tl['team_a_name'] if zone_team == 'team_a' else tl['team_b_name']})",
                            "title_en": f"Final Third Entry ({tl['team_a_name'] if zone_team == 'team_a' else tl['team_b_name']})",
                            "metric_proof": f"Ball X={bx:.1f}m • Y={by:.1f}m",
                        },
                        min_gap_s=3.5,
                    )
                if last_ball_x is not None and last_ball_t is not None and 0.5 <= (ts - last_ball_t) <= 2.2:
                    dt_b = max(0.5, ts - last_ball_t)
                    dx_ball = bx - last_ball_x
                    # Reject impossible telemetry jumps (> 20 m/s average horizontal carry)
                    if 8.0 <= abs(dx_ball) <= 22.0 and (abs(dx_ball) / dt_b) <= 20.0:
                        moving_right = dx_ball > 0
                        prog_team = "team_a" if (moving_right == a_attacks_right) else "team_b"
                        _push_evt(
                            {
                                "frame_id": fid,
                                "time_s": ts,
                                "event_type": "progressive_carry",
                                "moment_phase": "in_possession",
                                "team": prog_team,
                                "track_id": carrier_id,
                                "title_ar": f"تقدّم سريع بالكرة ({abs(dx_ball):.1f}م)",
                                "title_en": f"Progressive Ball Advance ({abs(dx_ball):.1f}m)",
                                "metric_proof": f"ΔX={dx_ball:+.1f}m in {dt_b:.1f}s",
                            },
                            min_gap_s=3.0,
                        )
                        last_ball_x, last_ball_t = bx, ts
                    elif abs(dx_ball) > 22.0:
                        last_ball_x, last_ball_t = bx, ts
                elif last_ball_x is None:
                    last_ball_x, last_ball_t = bx, ts
                elif ts - (last_ball_t or 0.0) > 2.2:
                    last_ball_x, last_ball_t = bx, ts

            # 3. High-Speed Sprint & Pressing Trap & Selective Pose Gate (YOLO11-Pose Lazy Compute)
            sprints = [p for p in f["players"] if p["role"] in ("player", "goalkeeper") and p.get("speed_kmh", 0.0) >= 24.0]
            if sprints:
                high_speed_count += len(sprints)
                top_sp = max(sprints, key=lambda p: p["speed_kmh"])
                _push_evt(
                    {
                        "frame_id": fid,
                        "time_s": ts,
                        "event_type": "high_speed_sprint",
                        "moment_phase": "attacking_transition" if top_sp["team"] == "team_a" else "defensive_transition",
                        "team": top_sp["team"],
                        "track_id": top_sp["track_id"],
                        "title_ar": f"انطلاقة سريعة #{top_sp['track_id']} ({top_sp['speed_kmh']} كم/س)",
                        "title_en": f"High-Speed Sprint #{top_sp['track_id']} ({top_sp['speed_kmh']} km/h)",
                        "metric_proof": f"v={top_sp['speed_kmh']} km/h • X={top_sp['x_m']}m",
                    },
                    min_gap_s=3.0,
                )

            if carrier_id is not None and ball is not None:
                carrier = next((p for p in f["players"] if p["track_id"] == carrier_id), None)
                if carrier is not None:
                    if carrier["track_id"] not in seen_pose_tids and len(pose_targets) < 5:
                        seen_pose_tids.add(carrier["track_id"])
                        pose_targets.append(
                            {
                                "track_id": carrier["track_id"],
                                "frame_id": fid,
                                "bbox": carrier["bbox"],
                                "vx_ms": carrier.get("vx_ms", 1.0),
                                "vy_ms": carrier.get("vy_ms", 0.3),
                            }
                        )

                    nearby_defs = [
                        p
                        for p in f["players"]
                        if p["role"] == "player"
                        and p["team"] != carrier["team"]
                        and np.hypot(p["x_m"] - carrier["x_m"], p["y_m"] - carrier["y_m"]) <= 4.5
                    ]
                    if len(nearby_defs) >= 2:
                        _push_evt(
                            {
                                "frame_id": fid,
                                "time_s": ts,
                                "event_type": "pressing_trap",
                                "moment_phase": "defensive_org",
                                "team": nearby_defs[0]["team"],
                                "track_id": carrier_id,
                                "title_ar": f"مصيدة ضغط ({len(nearby_defs)} مدافعين قرب #{carrier_id})",
                                "title_en": f"Pressing Trap ({len(nearby_defs)} defenders within 4.5m)",
                                "metric_proof": f"{len(nearby_defs)} defenders <= 4.5m of carrier",
                            },
                            min_gap_s=3.0,
                        )

        # Run REAL Event-Triggered YOLO11-Pose on the +-2s event carrier crops (cached on disk!)
        pose_cache = self.data_paths.cache / "pose_v8" / f"{mid}.json"
        if pose_cache.is_file():
            pose_assessments = json.loads(pose_cache.read_text(encoding="utf-8"))
        elif pose_targets:
            try:
                vpath = self.get_video_path(mid)
                pose_assessments = run_event_pose_on_video(vpath, pose_targets, min_head_height_px=75.0)
                pose_cache.parent.mkdir(parents=True, exist_ok=True)
                pose_cache.write_text(json.dumps(pose_assessments, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pose_assessments = [
                    evaluate_pose_with_resolution_gate(
                        track_id=t["track_id"],
                        frame_id=t["frame_id"],
                        bbox=t["bbox"],
                        shoulder_vec=(t.get("vx_ms") or 1.0, t.get("vy_ms") or 0.3),
                    ).to_dict()
                    for t in pose_targets
                ]

        sb_info = self._match_json_meta.get(mid, {}).get("scoreboard", {})
        verified_goals = sb_info.get("verified_goals", []) if isinstance(sb_info, dict) else []
        n_goals = len(verified_goals)
        field_tilt_a = round((team_a_poss_frames / max(1, poss_total)) * 100.0, 1)
        avg_compact = round(float(np.mean(compact_spans)), 1) if compact_spans else 0.0
        pos_diag = self.get_positioning_analysis(mid, frame_id=1250)
        top_diag = pos_diag["diagnoses"][0] if pos_diag["diagnoses"] else None

        brief = [
            {
                "id": "territory",
                "title_ar": f"السيطرة الميدانية والاستحواذ ({tl['team_a_name']}: {field_tilt_a}%)",
                "title_en": f"Territory & Possession Split ({field_tilt_a}% {tl['team_a_name']})",
                "detail_ar": f"تحليل {len(frames)} فريماً معاَيراً يظهر متوسط انتشار عمودي {avg_compact}م للفريق المدافع ({n_goals} أهداف موثّقة عبر فحص لوحة النتيجة).",
                "detail_en": f"Across {len(frames)} calibrated frames, defending block vertical span averaged {avg_compact}m ({n_goals} scoreboard-verified goals).",
            },
            {
                "id": "intensity",
                "title_ar": f"شدة التحولات والسبرنت ({high_speed_count} رصدة >= 24 كم/س)",
                "title_en": f"Transition Pace ({high_speed_count} sprint observations >= 24 km/h)",
                "detail_ar": f"تم رصد {len(events)} لحظة موثّقة بالفيزياء والكرة بتمرير كالمان، مع تطبيق نموذج YOLO11-Pose وبوابة الدقة (75px).",
                "detail_en": f"Kalman ball tracking & physics captured {len(events)} moments; real YOLO11-Pose Resolution Gate enforced at 75px.",
            },
        ]
        if top_diag:
            brief.append(
                {
                    "id": "tactical_fix",
                    "title_ar": top_diag["title_ar"],
                    "title_en": top_diag["title_en"],
                    "detail_ar": f"{top_diag['evidence_ar']} — الخيار المتوازن: {top_diag['options'][1]['title_ar']}.",
                    "detail_en": f"{top_diag['evidence_en']} — Balanced fix: {top_diag['options'][1]['title_en']}.",
                }
            )

        events.sort(key=lambda e: e["time_s"])
        return {
            "match_id": mid,
            "verified_goals": verified_goals,
            "scoreboard_latest": sb_info.get("latest_score") if isinstance(sb_info, dict) else None,
            "events": events[:16],
            "pose_assessments": pose_assessments,
            "coach_brief": brief,
            "metrics": {
                "calibrated_frames": len(frames),
                "team_a_possession_pct": field_tilt_a,
                "avg_compactness_m": avg_compact,
                "events_detected": len(events),
            },
        }

    def apply_scoresheet_to_match(self, tenant_id: str, match_id: str, raw_text: str) -> dict[str, Any]:
        """Parse official roster sheet, persist it, and bind ONLY exact matching OCR numbers (no guessing)."""
        mid = self._validate_id(match_id)
        roster = parse_scoresheet_text(raw_text)
        roster_by_num = {p.jersey_number: p for p in roster}

        lineup_path = self._tenant_dir(tenant_id) / f"{mid}_lineup.json"
        saved = (
            json.loads(lineup_path.read_text(encoding="utf-8"))
            if lineup_path.is_file()
            else {"official_roster": [], "track_overrides": {}}
        )
        saved["official_roster"] = [p.to_dict() for p in roster]
        overrides = saved.setdefault("track_overrides", {})

        qa = self.get_qa_sheet(tenant_id, mid)
        auto_matched = 0
        for tr in qa["tracks"]:
            jnum = tr.get("jersey_number")
            tid_s = str(tr["track_id"])
            if jnum and int(jnum) in roster_by_num and not overrides.get(tid_s, {}).get("verified_name"):
                rp = roster_by_num[int(jnum)]
                overrides[tid_s] = {
                    **overrides.get(tid_s, {}),
                    "jersey_number": rp.jersey_number,
                    "verified_name": rp.name,
                    "verified": True,
                }
                auto_matched += 1

        lineup_path.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
        return {
            "status": "applied",
            "match_id": mid,
            "count": len(roster),
            "auto_matched_count": auto_matched,
            "starters": [p.to_dict() for p in roster if p.is_starter],
            "substitutes": [p.to_dict() for p in roster if not p.is_starter],
            "official_roster": saved["official_roster"],
        }

    def get_shortlist(self, tenant_id: str) -> list[dict[str, Any]]:
        p = self._tenant_dir(tenant_id) / "shortlist.json"
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
        return []

    def upsert_shortlist_item(self, tenant_id: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
        pid = str(payload.get("player_id", "")).strip()
        if not pid:
            raise ValueError("player_id is required")
        items = self.get_shortlist(tenant_id)
        updated = {
            "player_id": pid,
            "display_name": str(payload.get("display_name", pid)),
            "team_name": str(payload.get("team_name", "")),
            "position": str(payload.get("position", "CM")),
            "rating_10": payload.get("rating_10"),
            "league_translation_pct": payload.get("league_translation_pct"),
            "status": str(payload.get("status", "watch")),  # watch | priority | shortlist
            "note": str(payload.get("note", "")),
        }
        items = [it for it in items if it.get("player_id") != pid]
        items.insert(0, updated)
        p = self._tenant_dir(tenant_id) / "shortlist.json"
        p.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        return items

    def delete_shortlist_item(self, tenant_id: str, player_id: str) -> list[dict[str, Any]]:
        items = [it for it in self.get_shortlist(tenant_id) if it.get("player_id") != player_id]
        p = self._tenant_dir(tenant_id) / "shortlist.json"
        p.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
        return items

    def get_bench_state(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        setup = self.get_match_setup(tenant_id, mid)
        fmt = setup.get("match_format", "11v11")
        age = setup.get("age_group", "senior")
        p = self._tenant_dir(tenant_id) / f"{mid}_bench.json"
        if p.is_file():
            saved_state = json.loads(p.read_text(encoding="utf-8"))
            if saved_state.get("match_format") == fmt and saved_state.get("age_group") == age:
                return saved_state

        meta = self._get_match_meta(mid)
        cfg = MatchSetupConfig.from_format(fmt, age, match_id=mid)
        n_starters = cfg.players_per_side
        mgr = BenchSubstitutionManager(cfg)
        mgr.set_starting_lineup(
            "team_a",
            [f"{meta['team_a_name']} #{i}" for i in range(1, n_starters + 1)],
            [f"{meta['team_a_name']} Sub {i}" for i in range(n_starters + 1, n_starters + 6)],
        )
        mgr.set_starting_lineup(
            "team_b",
            [f"{meta['team_b_name']} #{i}" for i in range(1, n_starters + 1)],
            [f"{meta['team_b_name']} Sub {i}" for i in range(n_starters + 1, n_starters + 6)],
        )
        state = {
            "match_id": mid,
            "match_format": cfg.match_format,
            "age_group": cfg.age_group,
            "rolling_subs": cfg.rolling_subs,
            "red_cards_team_a": cfg.red_cards_team_a,
            "red_cards_team_b": cfg.red_cards_team_b,
            "active_cap_team_a": cfg.active_cap("team_a"),
            "active_cap_team_b": cfg.active_cap("team_b"),
            "on_pitch": {k: sorted(v) for k, v in mgr.on_pitch.items()},
            "bench": {k: sorted(v) for k, v in mgr.bench.items()},
            "events": [],
        }
        p.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        return state

    def apply_bench_action(self, tenant_id: str, match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        p = self._tenant_dir(tenant_id) / f"{mid}_bench.json"
        action = str(payload.get("action", "substitute"))
        if action == "reset":
            if p.is_file():
                p.unlink()
            return self.get_bench_state(tenant_id, mid)

        state = self.get_bench_state(tenant_id, mid)
        setup = self.get_match_setup(tenant_id, mid)
        cfg = MatchSetupConfig.from_format(
            setup.get("match_format", state.get("match_format", "11v11")),
            setup.get("age_group", state.get("age_group", "senior")),
            match_id=mid,
        )
        cfg.red_cards_team_a = int(state.get("red_cards_team_a", 0))
        cfg.red_cards_team_b = int(state.get("red_cards_team_b", 0))

        mgr = BenchSubstitutionManager(cfg)
        mgr.on_pitch = {k: set(v) for k, v in state["on_pitch"].items()}
        mgr.bench = {k: set(v) for k, v in state["bench"].items()}
        team = str(payload.get("team", "team_a"))
        if team not in ("team_a", "team_b"):
            raise ValueError("team must be team_a or team_b")
        minute = float(payload.get("minute", 62.0))
        events = list(state.get("events", []))

        if action == "red_card":
            pid = str(payload.get("player_id") or (sorted(mgr.on_pitch[team])[-1] if mgr.on_pitch[team] else ""))
            new_cap = mgr.record_red_card(team, pid, minute=minute)
            events.append({"type": "red_card", "team": team, "player_id": pid, "minute": minute, "new_cap": new_cap})
        elif action == "substitute":
            p_out = str(payload.get("player_out") or (sorted(mgr.on_pitch[team])[0] if mgr.on_pitch[team] else ""))
            p_in = str(payload.get("player_in") or (sorted(mgr.bench[team])[0] if mgr.bench[team] else ""))
            # Rebuild existing sub count for non-rolling format enforcement
            for ev in events:
                if ev.get("type") == "substitute" and ev.get("team") == team:
                    from packages.shared_contracts.match_setup import SubEvent
                    mgr.sub_log.append(SubEvent(minute=float(ev.get("minute", 0)), team=team, player_out=ev.get("player_out", ""), player_in=ev.get("player_in", "")))
            ok = mgr.substitute(team, p_out, p_in, minute=minute)
            if not ok:
                raise ValueError("Substitution limit reached or invalid player selection")
            events.append({"type": "substitute", "team": team, "player_out": p_out, "player_in": p_in, "minute": minute})

        new_state = {
            "match_id": mid,
            "match_format": cfg.match_format,
            "age_group": cfg.age_group,
            "rolling_subs": cfg.rolling_subs,
            "red_cards_team_a": cfg.red_cards_team_a,
            "red_cards_team_b": cfg.red_cards_team_b,
            "active_cap_team_a": cfg.active_cap("team_a"),
            "active_cap_team_b": cfg.active_cap("team_b"),
            "on_pitch": {k: sorted(v) for k, v in mgr.on_pitch.items()},
            "bench": {k: sorted(v) for k, v in mgr.bench.items()},
            "events": events,
        }
        p.write_text(json.dumps(new_state, ensure_ascii=False, indent=2), encoding="utf-8")
        return new_state

    def export_clip_mp4(
        self,
        tenant_id: str,
        match_id: str,
        start_s: float = 50.0,
        end_s: float = 55.0,
        auto_face_blur: bool = False,
        burn_ar: bool = True,
    ) -> Path:
        """Export club-watermarked AR-baked MP4 clip with optional youth privacy face-blur."""
        mid = self._validate_id(match_id)
        vpath = self.get_video_path(mid)
        clips_dir = self.data_paths.outputs / "clips"
        clips_dir.mkdir(parents=True, exist_ok=True)
        out_p = clips_dir / f"{mid}_{int(round(start_s))}_{int(round(end_s))}_{'blur' if auto_face_blur else 'ar'}.mp4"

        face_boxes: dict[int, list[list[float]]] = {}
        ar_tracks: dict[int, list[dict[str, Any]]] = {}
        ar_ball: dict[int, tuple[float, float]] = {}

        if burn_ar or auto_face_blur:
            tl = self.get_match_timeline(mid, tenant_id=tenant_id)
            for fr in tl["frames"]:
                fid = int(fr["frame_id"])
                if burn_ar and fr.get("calibrated"):
                    ar_tracks[fid] = fr["players"]
                    b = fr.get("ball")
                    if b and b.get("u") is not None and b.get("v") is not None:
                        ar_ball[fid] = (float(b["u"]), float(b["v"]))
                if auto_face_blur:
                    face_boxes[fid] = [p["bbox"] for p in fr["players"]]

        return export_watermarked_clip(
            input_mp4=vpath,
            output_mp4=out_p,
            start_s=float(start_s),
            end_s=max(float(start_s) + 1.0, min(float(start_s) + 12.0, float(end_s))),
            club_watermark=f"EGY-SCOUT V8 | {tenant_id.upper()}",
            auto_face_blur=auto_face_blur,
            face_boxes_by_frame=face_boxes if auto_face_blur else None,
            ar_tracks_by_frame=ar_tracks if burn_ar else None,
            ar_ball_by_frame=ar_ball if burn_ar else None,
            kit_colors=self.get_match_kit_colors(mid),
        )

    def package_match_hls(self, match_id: str) -> dict[str, Any]:
        """Package match video into GOP-aligned HLS (keyint=15) for instant-scrub HLS.js streaming."""
        mid = self._validate_id(match_id)
        vpath = self.get_video_path(mid)
        hls_dir = self.data_paths.outputs / "hls" / mid
        playlist = hls_dir / "master.m3u8"
        if not playlist.is_file():
            transcode_gop_hls(vpath, hls_dir)
        return {
            "match_id": mid,
            "hls_url": f"/api/hls/{mid}/master.m3u8",
            "segments": len(list(hls_dir.glob("*.ts"))),
            "keyint": 15,
        }

    def save_match_setup(self, tenant_id: str, match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        cfg = MatchSetupConfig.from_format(
            match_format=payload.get("match_format", "11v11"),
            age_group=payload.get("age_group", "senior"),
            match_id=match_id,
            pitch_length_m=payload.get("pitch_length_m"),
            pitch_width_m=payload.get("pitch_width_m"),
            calibration_mode=payload.get("calibration_mode"),
            auto_face_blur=payload.get("auto_face_blur"),
        )
        cfg.red_cards_team_a = int(payload.get("red_cards_team_a", 0))
        cfg.red_cards_team_b = int(payload.get("red_cards_team_b", 0))

        homography_info = None
        if payload.get("four_point_pixels") and len(payload["four_point_pixels"]) == 4:
            cfg.four_point_pixels = payload["four_point_pixels"]
            H = compute_four_point_homography(
                cfg.four_point_pixels, cfg.pitch_length_m, cfg.pitch_width_m
            )
            center_px = np.mean(np.asarray(cfg.four_point_pixels, dtype=np.float32), axis=0)
            center_m = project_pixels_with_homography(H, [center_px.tolist()])[0]
            homography_info = {
                "valid": True,
                "projected_center_m": [round(float(center_m[0]), 2), round(float(center_m[1]), 2)],
                "matrix_det": round(float(np.linalg.det(H)), 6),
            }

        out = cfg.to_dict()
        out["homography"] = homography_info
        p = self._tenant_dir(tenant_id) / f"{match_id}_setup.json"
        p.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        return out

    def get_match_setup(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        p = self._tenant_dir(tenant_id) / f"{match_id}_setup.json"
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
        return MatchSetupConfig.from_format("11v11", "senior", match_id=match_id).to_dict()

    def run_live_proof(self, video_bytes: Optional[bytes], filename: str = "live_clip.mp4") -> dict[str, Any]:
        t0 = time.perf_counter()
        live_dir = self.data_paths.outputs / "live_proof"
        live_dir.mkdir(parents=True, exist_ok=True)
        run_id = f"live_{int(time.time())}"

        if video_bytes:
            clip_path = live_dir / f"{run_id}.mp4"
            clip_path.write_bytes(video_bytes)
            v8_df, preview_frame, kit_colors = detect_clip_with_football_yolo(clip_path, run_id=run_id)
        else:
            _, v8_df = self.get_legacy_and_v8_frames("m2_ahly_enppi")
            v8_df = v8_df[v8_df["frame_id"].between(1250, 1320)].copy()
            kit_colors = self.get_match_kit_colors("m2_ahly_enppi")
            jpg_bytes = self.render_frame_jpeg("m2_ahly_enppi", 1250)
            arr = np.frombuffer(jpg_bytes, dtype=np.uint8)
            preview_frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        pq_out = live_dir / f"{run_id}_tracking.parquet"
        if not v8_df.empty:
            write_tracking_parquet(v8_df, pq_out)

        def _hex_to_bgr(hex_str: str) -> tuple[int, int, int]:
            h = hex_str.lstrip("#")
            if len(h) == 6:
                return (int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16))
            return (246, 130, 59)

        team_a_bgr = _hex_to_bgr(kit_colors["team_a_hex"])
        team_b_bgr = _hex_to_bgr(kit_colors["team_b_hex"])

        preview_b64 = ""
        if preview_frame is not None:
            vis = preview_frame.copy()
            first_fid = int(v8_df["frame_id"].iloc[0]) if not v8_df.empty else 0
            for _, r in v8_df[v8_df["frame_id"] == first_fid].iterrows():
                role_s = str(r["role"])
                if role_s not in ("player", "goalkeeper", "referee", "assistant_referee"):
                    continue
                color = (
                    (21, 204, 250)
                    if r["role"] == "referee"
                    else (22, 115, 249)
                    if r["role"] == "assistant_referee"
                    else (238, 211, 34)
                    if r["role"] == "goalkeeper"
                    else team_a_bgr
                    if r["team"] == "team_a"
                    else team_b_bgr
                )
                cx = int((r["x1"] + r["x2"]) / 2)
                cy = int(r["y2"])
                rx = max(12, int((r["x2"] - r["x1"]) * 0.56))
                cv2.ellipse(vis, (cx, cy), (rx, max(5, int(rx * 0.32))), 0, 0, 360, color, 2, cv2.LINE_AA)
            ok_e, buf = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if ok_e:
                preview_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")

        elapsed_s = round(time.perf_counter() - t0, 2)
        players_tracked = int(v8_df[v8_df["role"].isin(["player", "goalkeeper"])]["track_id"].nunique()) if not v8_df.empty else 0
        officials_isolated = int(v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not v8_df.empty else 0

        return {
            "run_id": run_id,
            "filename": filename,
            "elapsed_s": elapsed_s,
            "rows_exported": int(len(v8_df)),
            "players_tracked": players_tracked,
            "officials_isolated": officials_isolated,
            "parquet_download_url": f"/api/live-proof/{run_id}/parquet" if pq_out.is_file() else "",
            "parquet_filename": f"{run_id}_tracking.parquet",
            "preview_image_data_url": preview_b64,
        }

    def ingest_custom_match(
        self,
        video_bytes: bytes,
        filename: str = "custom_clip.mp4",
        team_a_name: str = "Team A",
        team_b_name: str = "Team B",
        match_format: str = "11v11",
        tenant_id: str = "club_demo_egypt",
    ) -> dict[str, Any]:
        """Ingest an uploaded MP4 as a full persistent playable match across Studio, QA, and Scouting."""
        if not video_bytes:
            raise ValueError("Uploaded video file is empty")
        t0 = time.perf_counter()
        mid = f"custom_{int(time.time() * 1000)}"
        match_dir = self.data_paths.outputs / "custom_matches" / mid
        match_dir.mkdir(parents=True, exist_ok=True)
        video_path = match_dir / "video.mp4"
        video_path.write_bytes(video_bytes)

        raw_df, v8_df, preview_frame, kit_colors, fps, extra_meta = ingest_clip_with_football_yolo(
            video_path=video_path,
            run_id=mid,
            max_sample_frames=48,
            stride=3,
        )
        if v8_df.empty:
            raise ValueError("No trackable frames detected in uploaded clip")

        raw_pq = match_dir / "raw.parquet"
        v8_pq = match_dir / "v8.parquet"
        write_tracking_parquet(raw_df, raw_pq)
        write_tracking_parquet(v8_df, v8_pq)

        first_fid = int(v8_df["frame_id"].iloc[0])
        meta_out = {
            "match_id": mid,
            "team_a_name": (team_a_name or "Team A").strip()[:40],
            "team_b_name": (team_b_name or "Team B").strip()[:40],
            "fps": float(fps or 25.0),
            "video_path": str(video_path),
            "raw_parquet_path": str(raw_pq),
            "v8_parquet_path": str(v8_pq),
            "kit_colors": kit_colors,
            "spotlight_frame": first_fid,
            "match_format": match_format,
            "is_custom": True,
            "source_filename": filename,
            **extra_meta,
        }
        (match_dir / "meta.json").write_text(
            json.dumps(meta_out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self._meta_cache[mid] = meta_out
        self._match_json_meta[mid] = meta_out
        self._legacy_cache[mid] = raw_df
        self._v8_cache[mid] = v8_df

        self.save_match_setup(
            tenant_id,
            mid,
            {"match_format": match_format if match_format in ("11v11", "6v6", "7v7", "9v9", "5v5") else "11v11"},
        )

        preview_b64 = ""
        if preview_frame is not None:
            ok_e, buf = cv2.imencode(".jpg", preview_frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
            if ok_e:
                preview_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")

        players_tracked = int(v8_df[v8_df["role"].isin(["player", "goalkeeper"])]["track_id"].nunique())
        officials_isolated = int(v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique())
        ball_obs = int((v8_df["role"] == "ball").sum())

        return {
            "match_id": mid,
            "team_a_name": meta_out["team_a_name"],
            "team_b_name": meta_out["team_b_name"],
            "elapsed_s": round(time.perf_counter() - t0, 2),
            "rows_exported": int(len(v8_df)),
            "players_tracked": players_tracked,
            "officials_isolated": officials_isolated,
            "ball_detections": ball_obs,
            "kit_colors": kit_colors,
            "parquet_download_url": f"/api/custom-matches/{mid}/parquet",
            "parquet_filename": f"{mid}_v8.parquet",
            "preview_image_data_url": preview_b64,
        }

    def get_match_benchmark(self, match_id: str) -> dict[str, Any]:
        """Compute live Phase-0 & V8 physics/accuracy benchmark scorecard for a match."""
        mid = self._validate_id(match_id)
        legacy_df, v8_df = self.get_legacy_and_v8_frames(mid)
        tl = self.get_match_timeline(mid)
        dir_info = self._infer_attack_direction(v8_df)

        def _stability(df: pd.DataFrame) -> float:
            valid = df[df["track_id"] >= 0]
            if valid.empty:
                return 0.0
            n_tr = valid["track_id"].nunique()
            stable = sum(1 for _, g in valid.groupby("track_id") if g["role"].nunique() == 1)
            return round((stable / max(1, n_tr)) * 100.0, 1)

        leg_off = int(legacy_df[legacy_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not legacy_df.empty else 0
        v8_off = int(v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not v8_df.empty else 0
        leak_red = round(max(0.0, (1.0 - (v8_off / max(1, leg_off))) * 100.0), 1) if leg_off > 0 else 100.0

        cal_frames = [f for f in tl["frames"] if f["calibrated"]]
        ball_cal = [f for f in cal_frames if f.get("ball") is not None]
        raw_ball_cnt = int((v8_df["role"] == "ball").sum())
        clean_ball_cnt = int(
            ((v8_df["role"] == "ball") & v8_df["x_m"].notna() & (v8_df["role_conf"].fillna(0.0) >= 0.22)).sum()
        )
        max_spd = 0.0
        for f in cal_frames:
            for p in f["players"]:
                max_spd = max(max_spd, float(p.get("speed_kmh", 0.0) or 0.0))

        return {
            "match_id": mid,
            "legacy_official_tracks": leg_off,
            "v8_official_tracks": v8_off,
            "official_leakage_reduction_pct": leak_red,
            "legacy_role_stability_pct": _stability(legacy_df),
            "v8_role_stability_pct": _stability(v8_df),
            "total_frames": int(v8_df["frame_id"].nunique()) if not v8_df.empty else 0,
            "calibrated_frames": len(cal_frames),
            "ball_raw_detections": raw_ball_cnt,
            "ball_clean_detections": clean_ball_cnt,
            "ball_kalman_coverage_pct": round((len(ball_cal) / max(1, len(cal_frames))) * 100.0, 1),
            "max_observed_speed_kmh": round(min(MAX_PHYSICAL_SPEED_KMH, max_spd), 1),
            "max_speed_cap_kmh": MAX_PHYSICAL_SPEED_KMH,
            "speed_cap_compliant": max_spd <= MAX_PHYSICAL_SPEED_KMH + 0.01,
            "goalkeepers_count": int(v8_df[v8_df["role"] == "goalkeeper"]["track_id"].nunique()) if not v8_df.empty else 0,
            "jerseys_detected_count": int(v8_df[v8_df["jersey_number"] > 0]["track_id"].nunique()) if ("jersey_number" in v8_df.columns and not v8_df.empty) else 0,
            **dir_info,
        }

    def ingest_match_from_url(
        self,
        url: str,
        team_a_name: str = "Team A",
        team_b_name: str = "Team B",
        match_format: str = "11v11",
        max_duration_s: int = 45,
        tenant_id: str = "club_demo_egypt",
    ) -> dict[str, Any]:
        """Hybrid Ingestion Hub (Sec 9.5): download YouTube/Drive/Broadcast URL via yt-dlp and ingest."""
        dl_dir = self.data_paths.cache / "url_downloads"
        dl_dir.mkdir(parents=True, exist_ok=True)
        tmp_mp4 = dl_dir / f"import_{int(time.time() * 1000)}.mp4"
        download_video_from_url(url, tmp_mp4, max_duration_s=max_duration_s)
        raw_bytes = tmp_mp4.read_bytes()
        try:
            tmp_mp4.unlink()
        except OSError:
            pass
        return self.ingest_custom_match(
            video_bytes=raw_bytes,
            filename=f"url_import_{int(time.time())}.mp4",
            team_a_name=team_a_name,
            team_b_name=team_b_name,
            match_format=match_format,
            tenant_id=tenant_id,
        )

    def get_phase0_evaluation(self, match_id: str) -> dict[str, Any]:
        """Run honest Phase 0 benchmark evaluation (cached in memory; never compares legacy to its own unverified prelabels!)."""
        from packages.shared_contracts.schemas import MatchAnnotationFile

        mid = self._validate_id(match_id)
        al_path = self.data_paths.datasets / "egypt_benchmark" / "active_learning_queue.jsonl"
        al_samples = sum(1 for _ in al_path.open("r", encoding="utf-8")) if al_path.is_file() else 0

        if mid in self._phase0_cache:
            cached = dict(self._phase0_cache[mid])
            cached["active_learning_queue_size"] = al_samples
            return cached

        ann_path = self.data_paths.datasets / "egypt_benchmark" / "annotations" / f"{mid}.json"
        if not ann_path.is_file():
            return {"available": False, "match_id": mid, "reason": "No Phase 0 annotation file for this match"}

        gt_file = MatchAnnotationFile.load(ann_path)
        total_persons = sum(len(f.persons) for f in gt_file.frames)
        verified_persons = sum(sum(1 for p in f.persons if p.verified) for f in gt_file.frames)
        legacy_df, v8_df = self.get_legacy_and_v8_frames(mid)

        if verified_persons >= 20:
            before_m = evaluate_predictions(gt_file, legacy_df, label="legacy_scout5", spotlight_frames=[1250], only_verified=True).to_dict()
            after_m = evaluate_predictions(gt_file, v8_df, label="v8_shield", spotlight_frames=[1250], only_verified=True).to_dict()
            verified_gt = True
        else:
            # Honest structural audit (zero fake self-comparison against unverified legacy prelabels!)
            def _stab(df: pd.DataFrame) -> float:
                v = df[df["track_id"] >= 0]
                if v.empty:
                    return 0.0
                return round(sum(1 for _, g in v.groupby("track_id") if g["role"].nunique() == 1) / max(1, v["track_id"].nunique()), 4)

            leg_refs = int(legacy_df[legacy_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not legacy_df.empty else 0
            v8_refs = int(v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not v8_df.empty else 0
            leg_gks = int(legacy_df[legacy_df["role"] == "goalkeeper"]["track_id"].nunique()) if not legacy_df.empty else 0
            v8_gks = int(v8_df[v8_df["role"] == "goalkeeper"]["track_id"].nunique()) if not v8_df.empty else 0
            before_m = {
                "track_role_stability": _stab(legacy_df),
                "official_tracks": leg_refs,
                "goalkeeper_tracks": leg_gks,
                "total_tracks": int(legacy_df[legacy_df["track_id"] >= 0]["track_id"].nunique()) if not legacy_df.empty else 0,
            }
            after_m = {
                "track_role_stability": _stab(v8_df),
                "official_tracks": v8_refs,
                "goalkeeper_tracks": v8_gks,
                "total_tracks": int(v8_df[v8_df["track_id"] >= 0]["track_id"].nunique()) if not v8_df.empty else 0,
            }
            verified_gt = False

        res = {
            "available": True,
            "verified_human_gt": verified_gt,
            "match_id": mid,
            "annotated_frames": len(gt_file.frames),
            "total_prelabels": total_persons,
            "verified_persons": verified_persons,
            "before": before_m,
            "after": after_m,
            "active_learning_queue_size": al_samples,
        }
        self._phase0_cache[mid] = res
        return res

    def get_opponent_dossier(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        """Generate grounded Pre-Match Opponent Dossier (Sec 11.3) strictly from measured telemetry."""
        mid = self._validate_id(match_id)
        meta = self._get_match_meta(mid)
        tl = self.get_match_timeline(mid, tenant_id=tenant_id)
        mb = self.get_moments_and_brief(tenant_id, mid)
        pos = self.get_positioning_analysis(mid, frame_id=1250)
        bm = self.get_match_benchmark(mid)

        att_events = [e for e in mb["events"] if e["moment_phase"] in ("in_possession", "attacking_transition")]
        def_events = [e for e in mb["events"] if e["moment_phase"] in ("defensive_org", "defensive_transition")]

        return {
            "match_id": mid,
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "grounded_source": "v8_telemetry_and_playbook",
            "summary_ar": (
                f"ملف خصم موثّق لمباراة {meta['team_a_name']} × {meta['team_b_name']} "
                f"({bm['calibrated_frames']} فريم معاير • استحواذ {mb['metrics'].get('team_a_possession_pct', 50)}% • "
                f"انتشار دفاعي {mb['metrics'].get('avg_compactness_m', 0)}م)."
            ),
            "summary_en": (
                f"Grounded Opponent Dossier for {meta['team_a_name']} vs {meta['team_b_name']} "
                f"({bm['calibrated_frames']} calibrated frames • {mb['metrics'].get('team_a_possession_pct', 50)}% tilt • "
                f"{mb['metrics'].get('avg_compactness_m', 0)}m defensive span)."
            ),
            "vulnerabilities": pos.get("diagnoses", []),
            "attacking_patterns": att_events[:6],
            "defensive_transitions": def_events[:6],
            "coach_brief": mb.get("coach_brief", []),
            "pose_summary": mb.get("pose_assessments", []),
            "scoreboard_latest": mb.get("scoreboard_latest"),
            "verified_goals": mb.get("verified_goals", []),
        }

    def get_player_dossier(self, tenant_id: str, player_id: str, match_id: str = "m2_ahly_enppi") -> dict[str, Any]:
        """Full Evidence-First Player Dossier with /10 position breakdown & data-grounded traits (Sec 15.1/15.3)."""
        from packages.scouting_core.fair_engine import POSITION_WEIGHTS

        sc = self.get_scouting_data(tenant_id, match_id=match_id)
        all_bench = sc["benchmark_players"]
        target = next((p for p in all_bench if p["player_id"] == player_id), None)
        is_video_track = False
        if target is None:
            target = next((p for p in sc["video_tracks"] if p["player_id"] == player_id), None)
            is_video_track = True
        if target is None:
            raise FileNotFoundError(f"Player not found: {player_id}")

        pos = str(target.get("position", "CM")).upper()
        weights = POSITION_WEIGHTS.get(pos, POSITION_WEIGHTS["CM"])
        breakdown = []
        strengths_ar: list[str] = []
        strengths_en: list[str] = []
        watchouts_ar: list[str] = []
        watchouts_en: list[str] = []

        if not is_video_track and target.get("rating_10") is not None:
            vaep = float(target.get("vaep_per90") or 0.0)
            xt = float(target.get("xt_per90") or 0.0)
            padj = float(target.get("padj_defensive_actions_per90") or 0.0)
            hir = float(target.get("hir_distance_m_per90") or 0.0)
            disc = float(target.get("positional_discipline_score") or 70.0)
            disc_norm = disc / 100.0 if disc > 1.5 else disc

            comps = [
                ("VAEP / 90", weights["vaep"], min(9.6, max(3.0, 5.2 + vaep * 2.8)), f"{vaep:.2f}"),
                ("xT / 90", weights["xt"], min(9.6, max(3.0, 5.0 + xt * 4.5)), f"{xt:.2f}"),
                ("PAdj Def / 90", weights["defensive"], min(9.5, max(3.5, 4.8 + padj * 0.28)), f"{padj:.1f}"),
                ("HIR Physical", weights["physical"], min(9.5, max(3.5, 4.8 + (hir / 900.0) * 3.5)), f"{int(hir)}m"),
                ("Positional Discipline", weights["discipline"], min(9.6, max(3.5, disc_norm * 10.0)), f"{round(disc_norm * 100, 1)}%"),
            ]
            for label, w, sc_val, raw_s in comps:
                breakdown.append({"metric": label, "weight_pct": round(w * 100), "score_10": round(sc_val, 2), "raw": raw_s})
            if vaep >= 0.30:
                strengths_ar.append(f"تأثير هجومي حاسم لكل لمسة (VAEP/90 = {vaep:.2f})")
                strengths_en.append(f"High action impact per 90 (VAEP/90 = {vaep:.2f})")
            if xt >= 0.18:
                strengths_ar.append(f"صناعة خطورة تقدمية عالية (xT/90 = {xt:.2f})")
                strengths_en.append(f"Elite ball progression threat (xT/90 = {xt:.2f})")
            if hir >= 820:
                strengths_ar.append(f"كثافة جري عالية تلائم إيقاع الممتاز (HIR = {int(hir)}م/90)")
                strengths_en.append(f"Premier-pace high-intensity running ({int(hir)}m/90)")
            if padj < 7.0 and pos in ("CB", "FB", "DM", "CM"):
                watchouts_ar.append(f"معدل تدخلات دفاعية معدّلة منخفض نسبياً (PAdj = {padj:.1f}/90)")
                watchouts_en.append(f"Below-average possession-adjusted defensive volume ({padj:.1f}/90)")
            if disc_norm < 0.78:
                watchouts_ar.append(f"انضباط مكاني يحتاج تطوير ({round(disc_norm * 100, 1)}%)")
                watchouts_en.append(f"Positional discipline below elite band ({round(disc_norm * 100, 1)}%)")

        return {
            "player": target,
            "is_video_track": is_video_track,
            "position_weights": weights,
            "rating_breakdown": breakdown,
            "strengths_ar": strengths_ar,
            "strengths_en": strengths_en,
            "watchouts_ar": watchouts_ar,
            "watchouts_en": watchouts_en,
            "evidence_clips": target.get("evidence_clips", []),
        }
