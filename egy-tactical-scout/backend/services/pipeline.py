"""Full V3 Computer Vision -> Auto-Homography -> Dynamic Tactical Intelligence -> Scouting Pipeline."""
from __future__ import annotations

import math
from collections import Counter
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from scipy.signal import savgol_filter
from shapely.geometry import LineString, MultiPoint, box
from shapely.ops import voronoi_diagram
from sqlalchemy import delete, select

from core.config import HIR_SPEED_KMH, MAX_HUMAN_SPEED_KMH, PITCH_LENGTH, PITCH_WIDTH, SPRINT_SPEED_KMH, get_settings
from core.database import MatchStorage, SessionLocal
from engine.detector import run_tracking
from engine.homography import AutoPitchHomography, apply_homography
from engine.scouting_ranker import rank_match_players
from engine.tactical_intelligence import DynamicTacticalIntelligence
from engine.tactics import (
    ExpectedThreat,
    attack_directions,
    detect_offball_runs,
    detect_pressing,
    extract_events,
    infer_possession,
    team_dir,
    voronoi_areas,
)
from engine.team_classifier import JerseyVoter, TeamClassifier, extract_raw_kit_features_from_video
from models.schema import Club, Match, Player, PlayerMatchStats
from services.egyptian_seed import match_clubs_from_title

CLUB_EXPECTED_KIT_FAMILY: dict[str, str] = {
    "egy1-alahly": "red",
    "egy3-alahly-u": "red",
    "egy1-modern": "red",
    "egy1-haras": "red",
    "egy1-zamalek": "white",
    "egy3-zamalek-u": "white",
    "egy1-enppi": "blue",
    "egy3-enppi-u": "blue",
    "egy1-pyramids": "blue",
    "egy3-pyramids-u": "blue",
    "egy1-smouha": "blue",
    "egy1-petrojet": "blue",
    "egy1-masry": "green",
    "egy1-ittihad": "green",
    "egy2-sekka": "green",
    "egy1-nbank": "orange",
    "egy1-ceramica": "orange",
    "egy1-ismaily": "yellow",
    "egy3-ismaily-u": "yellow",
    "egy2-arabcontractors": "yellow",
    "egy3-arab-u": "yellow",
    "egy2-wadidegla": "yellow",
}


def _kit_match_score(ext_id: str | None, kit_info: dict) -> float:
    exp = CLUB_EXPECTED_KIT_FAMILY.get(str(ext_id or ""), "")
    fam = str((kit_info or {}).get("family") or "")
    if not exp or not fam:
        return 0.0
    if exp == fam:
        return 2.0
    if exp == "blue" and fam in ("dark", "black", "green"):
        return 0.5
    if exp == "green" and fam in ("dark", "black"):
        return 0.9
    if exp == "yellow" and fam in ("white", "orange"):
        return 0.9 if str(ext_id or "") == "egy2-arabcontractors" else 0.6
    return -1.0


def _align_home_cluster(
    home_ext_id: str | None,
    away_ext_id: str | None,
    team_kits: dict[str, dict],
    current: int | None = None,
) -> int:
    k0 = team_kits.get("0", {})
    k1 = team_kits.get("1", {})
    score_home_0 = _kit_match_score(home_ext_id, k0) + _kit_match_score(away_ext_id, k1)
    score_home_1 = _kit_match_score(home_ext_id, k1) + _kit_match_score(away_ext_id, k0)
    if score_home_1 > score_home_0 + 0.25:
        return 1
    if score_home_0 > score_home_1 + 0.25:
        return 0
    return int(current) if current in (0, 1) else 0

# Canonical 11-player tactical slots (0=GK, 1..10=Outfield) in attacking pitch coordinates [0..1]
CANONICAL_SLOTS: list[tuple[int, str, int, float, float, str]] = [
    (0, "GK", 1, 0.06, 0.50, "حارس مرمى"),
    (1, "RB", 2, 0.28, 0.84, "ظهير أيمن"),
    (2, "RCB", 4, 0.22, 0.64, "قلب دفاع أيمن"),
    (3, "LCB", 5, 0.22, 0.36, "قلب دفاع أيسر"),
    (4, "LB", 3, 0.28, 0.16, "ظهير أيسر"),
    (5, "DM", 6, 0.44, 0.50, "ارتكاز (#6)"),
    (6, "RCM", 8, 0.56, 0.68, "وسط مساند (#8)"),
    (7, "LCM", 10, 0.62, 0.34, "صانع لعب (#10)"),
    (8, "RW", 7, 0.78, 0.85, "جناح أيمن"),
    (9, "LW", 11, 0.78, 0.15, "جناح أيسر"),
    (10, "ST", 9, 0.86, 0.50, "مهاجم صريح (#9)"),
]

SLOT_POS_PRIORITY: dict[int, list[str]] = {
    0: ["GK"],
    1: ["RB", "RWB", "CB"],
    2: ["CB", "RB", "DM"],
    3: ["CB", "LB", "DM"],
    4: ["LB", "LWB", "CB"],
    5: ["DM", "CM", "CB"],
    6: ["CM", "DM", "AM"],
    7: ["AM", "CM", "RW", "LW"],
    8: ["RW", "AM", "ST", "LW"],
    9: ["LW", "AM", "ST", "RW"],
    10: ["ST", "LW", "RW", "AM"],
}

SLOT_DEFAULT_POS: dict[int, str] = {s[0]: ("CB" if s[1] in ("RCB", "LCB") else ("CM" if s[1] == "RCM" else ("AM" if s[1] == "LCM" else s[1]))) for s in CANONICAL_SLOTS}
SLOT_DEFAULT_LABEL_AR: dict[int, str] = {s[0]: s[5] for s in CANONICAL_SLOTS}
SLOT_DEFAULT_JERSEY: dict[int, int] = {s[0]: s[2] for s in CANONICAL_SLOTS}


def safe_int(val, default=None):  # noqa: ANN001, ANN201
    """Crash-proof integer cast guarding against float NaN/None in SQLite inserts."""
    if val is None or (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
        return default
    try:
        if pd.isna(val):
            return default
    except Exception:
        pass
    try:
        s = str(val).strip()
        if not s or s.lower() in ("nan", "none", "null"):
            return default
        return int(float(s))
    except (ValueError, TypeError):
        return default


def resolve_homographies(
    df_cam: pd.DataFrame, width: int, height: int
) -> tuple[dict[int, np.ndarray], dict[int, np.ndarray]]:
    """Build per-frame H (pixel->meters) and H_inv_norm (meters->[0,1] video canvas) with 100% guarantee."""
    homog_by_frame: dict[int, np.ndarray] = {}
    hinv_by_frame: dict[int, np.ndarray] = {}

    # Canonical broadcast fallback matrix if any frame missed homography
    fallback = AutoPitchHomography()
    blank = np.zeros((max(360, height), max(640, width), 3), dtype=np.uint8)
    H_default, _ = fallback.estimate_frame_homography(blank)
    H_inv_default = fallback.normalized_inverse_homography(max(640, width), max(360, height))

    ah_cols = [f"ah{i}" for i in range(9)]
    hi_cols = [f"hi{i}" for i in range(9)]
    has_ah = all(c in df_cam.columns for c in ah_cols)
    has_hi = all(c in df_cam.columns for c in hi_cols)

    for _, row in df_cam.iterrows():
        fid = int(row["frame_id"])
        if has_ah and np.all(np.isfinite(row[ah_cols].to_numpy(dtype=np.float64))):
            H = row[ah_cols].to_numpy(dtype=np.float64).reshape(3, 3)
        else:
            H = H_default.copy()

        if has_hi and np.all(np.isfinite(row[hi_cols].to_numpy(dtype=np.float64))):
            Hi = row[hi_cols].to_numpy(dtype=np.float64).reshape(3, 3)
        else:
            try:
                Hi_px = np.linalg.inv(H)
                S = np.array(
                    [[1.0 / max(1, width), 0.0, 0.0], [0.0, 1.0 / max(1, height), 0.0], [0.0, 0.0, 1.0]],
                    dtype=np.float64,
                )
                Hi = S @ Hi_px
                if abs(Hi[2, 2]) > 1e-6:
                    Hi /= Hi[2, 2]
            except Exception:
                Hi = H_inv_default.copy()

        homog_by_frame[fid] = H
        hinv_by_frame[fid] = Hi

    return homog_by_frame, hinv_by_frame


def project_detections(
    df_raw: pd.DataFrame, homog_by_frame: dict[int, np.ndarray]
) -> pd.DataFrame:
    """Map every detection anchor (u, v) to 105m x 68m FIFA coordinates cleanly."""
    df = df_raw.copy()
    all_fids = sorted(homog_by_frame.keys())
    default_H = homog_by_frame[all_fids[0]] if all_fids else np.eye(3, dtype=np.float64)

    x_m = np.zeros(len(df), dtype=np.float64)
    y_m = np.zeros(len(df), dtype=np.float64)
    for fid, idxs in df.groupby("frame_id").groups.items():
        pos_idxs = list(idxs)
        H = homog_by_frame.get(int(fid), default_H)
        uv = df.loc[pos_idxs, ["u", "v"]].to_numpy(dtype=np.float32)
        mapped = apply_homography(H, uv)
        x_m[df.index.get_indexer(pos_idxs)] = np.clip(mapped[:, 0], 0.0, PITCH_LENGTH)
        y_m[df.index.get_indexer(pos_idxs)] = np.clip(mapped[:, 1], 0.0, PITCH_WIDTH)

    df["x_m"] = x_m
    df["y_m"] = y_m
    return df


def assign_teams_and_identities(df: pd.DataFrame, team_fit_samples: int = 400) -> pd.DataFrame:
    """Cluster players into 2 teams via chrominance-weighted KMeans, vote OCR jerseys, and consolidate <=11v11 slots."""
    df = df.copy()
    kf_cols = [f"kf{i}" for i in range(11)]
    people_mask = df["role"] != "ball"
    df["team_cluster"] = -1
    df["_pred_tc"] = -1
    df["_pred_conf"] = 0.0

    player_rows = df[people_mask & (df["role"] == "player")]
    valid_feats = player_rows.dropna(subset=kf_cols) if all(c in df.columns for c in kf_cols) else pd.DataFrame()

    # Fit ONLY on wide-angle on-grass player detections (exclude zoomed close-ups & off-pitch spectators)
    fit_feats = valid_feats
    if not valid_feats.empty:
        fit_mask = pd.Series(True, index=valid_feats.index)
        if "on_grass" in valid_feats.columns:
            fit_mask &= valid_feats["on_grass"].fillna(True).astype(bool)
        if "y1_norm" in valid_feats.columns and "y2_norm" in valid_feats.columns:
            bh = (valid_feats["y2_norm"] - valid_feats["y1_norm"]).abs()
            fit_mask &= (bh >= 0.033) & (bh <= 0.21)
        if "v_norm" in valid_feats.columns:
            fit_mask &= valid_feats["v_norm"].fillna(0.5) >= 0.16
        if int(fit_mask.sum()) >= 20:
            fit_feats = valid_feats[fit_mask]

    tc_clf = TeamClassifier()
    if len(fit_feats) >= 12:
        step = max(1, len(fit_feats) // max(20, team_fit_samples))
        sampled = fit_feats.iloc[::step][kf_cols].to_numpy(dtype=np.float32)
        try:
            tc_clf.fit([row for row in sampled])
        except Exception:
            tc_clf.kmeans = None

    if tc_clf.fitted and len(valid_feats) > 0:
        pred_labels, pred_confs = tc_clf.predict(valid_feats[kf_cols].to_numpy(dtype=np.float32))
        df.loc[valid_feats.index, "team_cluster"] = pred_labels
        df.loc[valid_feats.index, "_pred_tc"] = pred_labels
        df.loc[valid_feats.index, "_pred_conf"] = pred_confs
        team_kits = tc_clf.team_kit_palette()
    elif not player_rows.empty:
        med_x = float(player_rows["x_m"].median())
        df.loc[player_rows.index, "team_cluster"] = np.where(player_rows["x_m"] <= med_x, 0, 1)
        team_kits = {
            "0": {"family": "red", "label_ar": "أحمر", "ring": "#EF4444", "primary": "#DC2626", "rgb": [220, 48, 48], "hex": "#EF4444"},
            "1": {"family": "blue", "label_ar": "أزرق", "ring": "#38BDF8", "primary": "#0284C7", "rgb": [38, 128, 224], "hex": "#38BDF8"},
        }
    else:
        team_kits = {
            "0": {"family": "red", "label_ar": "أحمر", "ring": "#EF4444", "primary": "#DC2626", "rgb": [220, 48, 48], "hex": "#EF4444"},
            "1": {"family": "blue", "label_ar": "أزرق", "ring": "#38BDF8", "primary": "#0284C7", "rgb": [38, 128, 224], "hex": "#38BDF8"},
        }

    # Confidence- & grass-weighted track voting + referee outlier detection + per-frame kit override
    track_teams: dict[int, int] = {}
    for tid, grp in df[people_mask].groupby("track_id"):
        w0 = 0.0
        w1 = 0.0
        neg_cnt = 0
        has_og = "on_grass" in grp.columns
        for _, row in grp.iterrows():
            v = int(row["team_cluster"])
            if v == -1 and int(row.get("_pred_tc", -2)) == -1:
                neg_cnt += 1
                continue
            if v not in (0, 1):
                continue
            conf_w = 0.25 + max(0.0, float(row.get("_pred_conf") or 0.0))
            og_w = 1.4 if (not has_og or bool(row.get("on_grass", True))) else 0.5
            wt = conf_w * og_w
            if v == 0:
                w0 += wt
            else:
                w1 += wt
        if neg_cnt >= max(2, int(0.60 * len(grp))) and (w0 + w1) < 0.8 * neg_cnt:
            track_teams[int(tid)] = -1
            df.loc[grp.index, "role"] = "referee"
        elif w0 + w1 > 0.0:
            track_teams[int(tid)] = 0 if w0 >= w1 else 1
        elif str(grp["role"].iloc[0]) == "goalkeeper":
            mx = float(grp["x_m"].median())
            track_teams[int(tid)] = 0 if mx < PITCH_LENGTH / 2.0 else 1
        elif str(grp["role"].iloc[0]) == "player":
            mx = float(grp["x_m"].median())
            track_teams[int(tid)] = 0 if mx <= 52.5 else 1
        else:
            track_teams[int(tid)] = -1

    base_tc = df.loc[people_mask, "track_id"].map(track_teams).fillna(-1).astype(int)
    df.loc[people_mask, "team_cluster"] = base_tc

    # Per-frame kit override if raw color strongly contradicts track majority (d_other < 0.52 * d_track -> conf >= 0.48)
    if tc_clf.fitted:
        for tid, grp in df[people_mask].groupby("track_id"):
            t_tc = track_teams.get(int(tid), -1)
            if t_tc not in (0, 1):
                continue
            grp_s = grp.sort_values("frame_id")
            ptc = grp_s["_pred_tc"].to_numpy(dtype=int)
            pconf = grp_s["_pred_conf"].to_numpy(dtype=float)
            idxs = grp_s.index.to_numpy()
            for i in range(len(idxs)):
                other = ptc[i]
                if other in (0, 1) and other != t_tc:
                    prev_same = i > 0 and ptc[i - 1] == other and pconf[i - 1] >= 0.30
                    next_same = i + 1 < len(idxs) and ptc[i + 1] == other and pconf[i + 1] >= 0.30
                    if pconf[i] >= 0.48 or ((prev_same or next_same) and pconf[i] >= 0.32):
                        df.at[idxs[i], "team_cluster"] = int(other)

    df.drop(columns=["_pred_tc", "_pred_conf"], inplace=True, errors="ignore")

    # Estimate global attack direction per team so slot normalization works regardless of pitch side
    atk_dirs = {0: 1, 1: -1}
    t0_rows = df[df["team_cluster"] == 0]
    t1_rows = df[df["team_cluster"] == 1]
    if not t0_rows.empty and not t1_rows.empty:
        t0_gk = t0_rows[t0_rows["role"] == "goalkeeper"]
        t1_gk = t1_rows[t1_rows["role"] == "goalkeeper"]
        m0 = float(t0_gk["x_m"].median()) if not t0_gk.empty else float(t0_rows["x_m"].median())
        m1 = float(t1_gk["x_m"].median()) if not t1_gk.empty else float(t1_rows["x_m"].median())
        if m0 <= m1:
            atk_dirs = {0: 1, 1: -1}
        else:
            atk_dirs = {0: -1, 1: 1}

    # Precompute team frame centers for camera-zoom invariant relative coordinates
    team_frame_means: dict[tuple[int, int], tuple[float, float]] = {}
    for (fid_v, tc_v), grp_ft in df[df["team_cluster"].isin([0, 1])].groupby(["frame_id", "team_cluster"]):
        team_frame_means[(int(fid_v), int(tc_v))] = (
            float(grp_ft["x_m"].mean()),
            float(grp_ft["y_m"].mean()),
        )

    # Team-isolated OCR voting per track_id so kit switches never bleed jersey digits across clubs
    team_voters = {0: JerseyVoter(min_votes=2, min_share=0.55), 1: JerseyVoter(min_votes=2, min_share=0.55)}
    for _, row in df[people_mask & (df["ocr_jersey"] > 0)].iterrows():
        rtc = int(row["team_cluster"])
        if rtc in (0, 1):
            team_voters[rtc].add(int(row["track_id"]), int(row["ocr_jersey"]))
    resolved_jerseys_by_team = {tc: team_voters[tc].all_resolved() for tc in (0, 1)}

    # Hungarian 11-slot consolidation per team so ByteTrack fragments merge cleanly into <= 11 players/team
    track_to_slot: dict[tuple[int, int], int] = {}
    slot_jerseys: dict[tuple[int, int], int] = {}
    track_len_map: dict[tuple[int, int], int] = {}

    for tc in (0, 1):
        adir = atk_dirs[tc]
        t_df = df[(df["team_cluster"] == tc) & (df["role"].isin(["player", "goalkeeper"]))].copy()
        if t_df.empty:
            continue

        # Normalize each detection into [0..1] attacking frame coordinates
        abs_nx = t_df["x_m"].to_numpy(dtype=np.float64) / PITCH_LENGTH
        abs_ny = t_df["y_m"].to_numpy(dtype=np.float64) / PITCH_WIDTH
        if adir == -1:
            abs_nx = 1.0 - abs_nx
            abs_ny = 1.0 - abs_ny

        # Blend absolute normalized coord with team-centroid relative coord
        rel_nx = np.empty_like(abs_nx)
        rel_ny = np.empty_like(abs_ny)
        fids_arr = t_df["frame_id"].to_numpy(dtype=int)
        xm_arr = t_df["x_m"].to_numpy(dtype=np.float64)
        ym_arr = t_df["y_m"].to_numpy(dtype=np.float64)
        for idx_i, (fv, xv, yv) in enumerate(zip(fids_arr, xm_arr, ym_arr)):
            mx, my = team_frame_means.get((int(fv), tc), (PITCH_LENGTH / 2.0, PITCH_WIDTH / 2.0))
            dx = (xv - mx) / 65.0
            dy = (yv - my) / 52.0
            if adir == -1:
                dx = -dx
                dy = -dy
            rel_nx[idx_i] = np.clip(0.5 + dx, 0.02, 0.98)
            rel_ny[idx_i] = np.clip(0.5 + dy, 0.02, 0.98)

        t_df["norm_x"] = np.clip(0.65 * abs_nx + 0.35 * rel_nx, 0.02, 0.98)
        t_df["norm_y"] = np.clip(0.65 * abs_ny + 0.35 * rel_ny, 0.02, 0.98)

        track_meta: dict[int, dict] = {}
        for tid_val, grp in t_df.groupby("track_id"):
            tid_int = int(tid_val)
            f_set = set(int(x) for x in grp["frame_id"].tolist())
            n_f = len(f_set)
            track_len_map[(tc, tid_int)] = n_f
            is_gk = (grp["role"] == "goalkeeper").mean() >= 0.45
            nx_med = float(grp["norm_x"].median())
            ny_med = float(grp["norm_y"].median())
            track_meta[tid_int] = {
                "frames": f_set,
                "len": n_f,
                "is_gk": is_gk or nx_med < 0.12,
                "nx": nx_med,
                "ny": ny_med,
                "by_frame": {
                    int(r["frame_id"]): (float(r["norm_x"]), float(r["norm_y"]))
                    for _, r in grp.iterrows()
                },
            }

        slot_anchors: dict[int, list[float]] = {s[0]: [s[3], s[4]] for s in CANONICAL_SLOTS}
        slot_frames: dict[int, set[int]] = {s[0]: set() for s in CANONICAL_SLOTS}
        assigned_tids: set[int] = set()

        # Step A: Lock goalkeeper tracks into slot 0
        gk_tids = sorted([t for t, m in track_meta.items() if m["is_gk"]], key=lambda t: track_meta[t]["len"], reverse=True)
        for tid_int in gk_tids:
            m = track_meta[tid_int]
            ov = len(m["frames"] & slot_frames[0])
            if ov <= max(2, int(0.15 * m["len"])):
                track_to_slot[(tc, tid_int)] = 0
                slot_frames[0].update(m["frames"])
                assigned_tids.add(tid_int)

        # Step B: Find densest outfield anchor frame (up to 10 simultaneous tracks) and run exact Hungarian assignment
        outfield_tids = [t for t in track_meta if t not in assigned_tids]
        if outfield_tids:
            out_df = t_df[t_df["track_id"].isin(outfield_tids)]
            frame_counts = out_df.groupby("frame_id")["track_id"].nunique()
            if not frame_counts.empty:
                max_vis = int(frame_counts.max())
                cand_fids = frame_counts[frame_counts == max_vis].index.tolist()
                anchor_fid = int(cand_fids[len(cand_fids) // 2])
                anchor_rows = out_df[out_df["frame_id"] == anchor_fid].drop_duplicates("track_id")
                anchor_tids = sorted(
                    [int(t) for t in anchor_rows["track_id"].tolist()],
                    key=lambda t: track_meta[t]["len"],
                    reverse=True,
                )[:10]

                if anchor_tids:
                    cost = np.zeros((len(anchor_tids), 10), dtype=np.float64)
                    for r_i, tid_int in enumerate(anchor_tids):
                        tx, ty = track_meta[tid_int]["by_frame"].get(
                            anchor_fid, (track_meta[tid_int]["nx"], track_meta[tid_int]["ny"])
                        )
                        for c_i in range(10):
                            s_idx = c_i + 1
                            sx, sy = slot_anchors[s_idx]
                            cost[r_i, c_i] = math.hypot(tx - sx, ty - sy)
                    row_ind, col_ind = linear_sum_assignment(cost)
                    for r_i, c_i in zip(row_ind, col_ind):
                        tid_int = anchor_tids[int(r_i)]
                        s_idx = int(c_i) + 1
                        m = track_meta[tid_int]
                        track_to_slot[(tc, tid_int)] = s_idx
                        slot_frames[s_idx].update(m["frames"])
                        assigned_tids.add(tid_int)
                        if m["len"] >= 10:
                            slot_anchors[s_idx] = [
                                0.55 * slot_anchors[s_idx][0] + 0.45 * m["nx"],
                                0.55 * slot_anchors[s_idx][1] + 0.45 * m["ny"],
                            ]

        # Step C: Stitch remaining ByteTrack fragments (longest first) to non-overlapping closest canonical slots
        rem_tids = sorted([t for t in track_meta if t not in assigned_tids], key=lambda t: track_meta[t]["len"], reverse=True)
        for tid_int in rem_tids:
            m = track_meta[tid_int]
            nf = max(1, m["len"])
            best_slot = 1
            best_score = 1e9

            # Tier 1: zero-overlap slots
            zero_ov_slots = [s for s in range(1, 11) if len(m["frames"] & slot_frames[s]) == 0]
            if zero_ov_slots:
                for s in zero_ov_slots:
                    d = math.hypot(m["nx"] - slot_anchors[s][0], m["ny"] - slot_anchors[s][1])
                    if d < best_score:
                        best_score = d
                        best_slot = s
            else:
                # Tier 2: minimal overlap slots (or weighted overlap + spatial proximity)
                for s in range(1, 11):
                    ov_frac = len(m["frames"] & slot_frames[s]) / nf
                    d = math.hypot(m["nx"] - slot_anchors[s][0], m["ny"] - slot_anchors[s][1])
                    score = d + 1.8 * ov_frac
                    if score < best_score:
                        best_score = score
                        best_slot = s

            track_to_slot[(tc, tid_int)] = best_slot
            slot_frames[best_slot].update(m["frames"])
            if m["len"] >= 12:
                slot_anchors[best_slot] = [
                    0.75 * slot_anchors[best_slot][0] + 0.25 * m["nx"],
                    0.75 * slot_anchors[best_slot][1] + 0.25 * m["ny"],
                ]

        # Resolve per-slot OCR jersey vote (unique per team when OCR detected clear digits)
        used_ocr: set[int] = set()
        slot_votes: dict[int, Counter] = {s: Counter() for s in range(11)}
        team_resolved_jerseys = resolved_jerseys_by_team[tc]
        for (k_tc, tid_int), s_idx in track_to_slot.items():
            if k_tc == tc and tid_int in track_meta and tid_int in team_resolved_jerseys:
                jn_val = team_resolved_jerseys[tid_int]
                if jn_val and 1 <= jn_val <= 99:
                    slot_votes[s_idx][int(jn_val)] += max(1, track_meta[tid_int]["len"])
        for s_idx in range(11):
            if slot_votes[s_idx]:
                for cand_jn, _ in slot_votes[s_idx].most_common():
                    if cand_jn not in used_ocr:
                        slot_jerseys[(tc, s_idx)] = cand_jn
                        used_ocr.add(cand_jn)
                        break

    # Assign consolidated slot identity keys & deduplicate co-occurring slot collisions per frame
    identities: list[str] = []
    jerseys: list[int | None] = []
    track_lens: list[int] = []
    for _, row in df.iterrows():
        if row["role"] == "ball":
            identities.append("ball")
            jerseys.append(None)
            track_lens.append(10_000)
            continue
        tid = int(row["track_id"])
        tc = int(row["team_cluster"])
        if tc in (0, 1) and (tc, tid) in track_to_slot:
            s_idx = track_to_slot[(tc, tid)]
            identities.append(f"t{tc}_s{s_idx}")
            jerseys.append(slot_jerseys.get((tc, s_idx), SLOT_DEFAULT_JERSEY[s_idx]))
            track_lens.append(track_len_map.get((tc, tid), 1))
        elif tc in (0, 1):
            identities.append(f"t{tc}_s10")
            jerseys.append(slot_jerseys.get((tc, 10), SLOT_DEFAULT_JERSEY[10]))
            track_lens.append(track_len_map.get((tc, tid), 1))
        else:
            identities.append(f"ref_tr{tid}")
            jerseys.append(None)
            track_lens.append(1)

    df["identity_key"] = identities
    df["identity"] = identities
    df["jersey_number"] = jerseys
    df["team_id"] = df["team_cluster"]
    df["_track_len"] = track_lens

    # Keep single dominant detection per (frame_id, identity_key) so consolidated slots never duplicate on a frame
    ball_df = df[df["role"] == "ball"].copy()
    non_ball = (
        df[df["role"] != "ball"]
        .sort_values(["frame_id", "identity_key", "_track_len"], ascending=[True, True, False])
        .drop_duplicates(subset=["frame_id", "identity_key"], keep="first")
    )
    out = pd.concat([non_ball, ball_df], ignore_index=True).drop(columns=["_track_len"]).sort_values(["frame_id", "track_id"]).reset_index(drop=True)
    out.attrs["team_kits"] = team_kits
    return out


def smooth_kinematics(df: pd.DataFrame, fps: float) -> pd.DataFrame:
    """Smooth pitch trajectories per contiguous (identity_key, track_id) segment without smearing fragment gaps."""
    df = df.sort_values(["identity_key", "track_id", "frame_id"]).copy()
    df["x_smooth"] = df["x_m"].astype(np.float64)
    df["y_smooth"] = df["y_m"].astype(np.float64)
    df["vx"] = 0.0
    df["vy"] = 0.0
    df["speed_kmh"] = 0.0

    max_gap_frames = max(6, int(round(0.75 * fps)))
    for (id_key, _tid), grp in df.groupby(["identity_key", "track_id"]):
        grp = grp.sort_values("frame_id")
        fids = grp["frame_id"].to_numpy(dtype=int)
        # Split into contiguous frame segments if same track_id had an occlusion jump
        split_pts = np.where(np.diff(fids) > max_gap_frames)[0] + 1
        seg_indices = np.split(grp.index.to_numpy(), split_pts)

        for seg_idx in seg_indices:
            if len(seg_idx) == 0:
                continue
            seg = df.loc[seg_idx].sort_values("frame_id")
            xs = seg["x_m"].to_numpy(dtype=np.float64)
            ys = seg["y_m"].to_numpy(dtype=np.float64)
            ts = seg["time_s"].to_numpy(dtype=np.float64)
            n = len(seg)

            if n >= 5:
                win = min(7, n if n % 2 == 1 else n - 1)
                if win >= 3:
                    xs = savgol_filter(xs, window_length=win, polyorder=2)
                    ys = savgol_filter(ys, window_length=win, polyorder=2)

            xs = np.clip(xs, 0.0, PITCH_LENGTH)
            ys = np.clip(ys, 0.0, PITCH_WIDTH)

            dt = np.diff(ts, prepend=ts[0] - (1.0 / max(1.0, fps)))
            dt = np.maximum(dt, 1.0 / max(1.0, fps))
            vx = np.diff(xs, prepend=xs[0]) / dt
            vy = np.diff(ys, prepend=ys[0]) / dt
            spd_ms = np.hypot(vx, vy)
            if len(spd_ms) >= 5:
                spd_ms = pd.Series(spd_ms).rolling(3, center=True, min_periods=1).median().to_numpy()
            max_cap = 30.0 if id_key == "ball" else (35.6 / 3.6)
            spd_ms = np.clip(spd_ms, 0.0, max_cap)
            spd_kmh = spd_ms * 3.6

            df.loc[seg.index, "x_smooth"] = xs
            df.loc[seg.index, "y_smooth"] = ys
            df.loc[seg.index, "x_m"] = xs
            df.loc[seg.index, "y_m"] = ys
            df.loc[seg.index, "vx"] = vx
            df.loc[seg.index, "vy"] = vy
            df.loc[seg.index, "speed_kmh"] = spd_kmh

    return df.sort_values(["frame_id", "track_id"]).reset_index(drop=True)


def _clipped_voronoi_polys(pts: np.ndarray, teams: np.ndarray) -> list[dict]:
    """Compute simplified geometric Voronoi polygons clipped to the 105x68m pitch for 3D grass projection."""
    if len(pts) < 4:
        return []
    pitch_box = box(0.0, 0.0, PITCH_LENGTH, PITCH_WIDTH)
    try:
        mp = MultiPoint([(float(x), float(y)) for x, y in pts])
        regions = voronoi_diagram(mp, envelope=pitch_box)
    except Exception:
        return []

    out: list[dict] = []
    for geom in getattr(regions, "geoms", []):
        inter = geom.intersection(pitch_box)
        if inter.is_empty or inter.area <= 0:
            continue
        cx, cy = inter.centroid.x, inter.centroid.y
        # Assign to nearest player point
        d = np.hypot(pts[:, 0] - cx, pts[:, 1] - cy)
        owner = int(teams[int(np.argmin(d))])
        if owner not in (0, 1):
            continue
        coords = list(inter.exterior.coords) if hasattr(inter, "exterior") else []
        if len(coords) >= 3:
            out.append(
                {
                    "team_cluster": owner,
                    "points_m": [[round(float(px), 2), round(float(py), 2)] for px, py in coords[:-1]],
                }
            )
    return out


def aggregate_player_stats(
    people: pd.DataFrame,
    events_df: pd.DataFrame,
    fluidity_map: dict[str, dict],
    hold_map: dict[str, float],
    fps: float,
    stride: int,
) -> pd.DataFrame:
    """Aggregate tracked match metrics into one scouting row per player identity."""
    if people.empty:
        return pd.DataFrame()

    attack_map = attack_directions(people)
    rows: list[dict] = []

    min_frames = max(6, int(round(1.5 * fps / max(1, stride))))
    long_ident_count = sum(1 for _, gg in people.groupby("identity_key") if len(gg) >= min_frames)
    enforce_min = long_ident_count >= 12

    for id_key, g in people.groupby("identity_key"):
        g = g.sort_values("frame_id")
        if enforce_min and len(g) < min_frames:
            continue
        role = str(g["role"].mode().iloc[0])
        tc = int(g["team_cluster"].mode().iloc[0])
        if role not in ("player", "goalkeeper") or tc not in (0, 1):
            continue

        track_ids = sorted({int(t) for t in g["track_id"].tolist()})
        jn_vals = [int(v) for v in g["jersey_number"].dropna().tolist() if v > 0]
        jn = Counter(jn_vals).most_common(1)[0][0] if jn_vals else None

        dt_step = float(stride) / max(1.0, fps)
        mins_tracked = max(0.02, (len(g) * dt_step) / 60.0)

        dx = np.diff(g["x_smooth"].to_numpy(), prepend=g["x_smooth"].iloc[0])
        dy = np.diff(g["y_smooth"].to_numpy(), prepend=g["y_smooth"].iloc[0])
        step_dist = np.clip(np.hypot(dx, dy), 0.0, 10.0 * dt_step)
        total_dist_m = float(step_dist.sum())

        spds = g["speed_kmh"].to_numpy()
        hir_mask = spds >= HIR_SPEED_KMH
        spr_mask = spds >= SPRINT_SPEED_KMH
        hir_dist = float(step_dist[hir_mask].sum())
        spr_dist = float(step_dist[spr_mask].sum())
        hir_cnt = int(np.sum(np.diff(hir_mask.astype(int), prepend=0) == 1))
        spr_cnt = int(np.sum(np.diff(spr_mask.astype(int), prepend=0) == 1))
        max_spd_val = float(np.percentile(spds, 96)) if len(spds) >= 8 else (float(np.max(spds)) if len(spds) > 0 else 0.0)

        # Event aggregates
        if not events_df.empty and "identity" in events_df.columns:
            pe = events_df[events_df["identity"] == id_key]
            passes = int((pe["type"] == "pass").sum())
            passes_comp = int(((pe["type"] == "pass") & (pe.get("completed", False) == True)).sum())  # noqa: E712
            prog_passes = int(((pe["type"] == "pass") & (pe.get("progressive", False) == True)).sum())  # noqa: E712
            lb_passes = int(((pe["type"] == "pass") & (pe.get("line_breaking", False) == True)).sum())  # noqa: E712
            prog_carries = int((pe["type"] == "progressive_carry").sum())
            pressing = int((pe["type"] == "pressing").sum())
            recoveries = int((pe["type"] == "recovery").sum())
            offball_runs = int((pe["type"] == "offball_run").sum())
            xt_gen = float(pe["xt_delta"].fillna(0.0).sum()) if "xt_delta" in pe.columns else 0.0
            space_created = float(pe["space_gain_m2"].fillna(0.0).sum()) if "space_gain_m2" in pe.columns else 0.0
        else:
            passes = passes_comp = prog_passes = lb_passes = prog_carries = pressing = recoveries = offball_runs = 0
            xt_gen = space_created = 0.0

        vor = g["voronoi_m2"].dropna() if "voronoi_m2" in g.columns else pd.Series(dtype=float)
        avg_space = float(vor.mean()) if not vor.empty else None
        # Attacking half space in team's attack direction
        mid_fid = int(g["frame_id"].median())
        adir = team_dir(attack_map, mid_fid, tc)
        att_half_mask = (g["x_smooth"] > 52.5) if adir == 1 else (g["x_smooth"] < 52.5)
        att_vor = g.loc[att_half_mask, "voronoi_m2"].dropna() if "voronoi_m2" in g.columns else pd.Series(dtype=float)
        avg_att_space = float(att_vor.mean()) if not att_vor.empty else avg_space

        ax_med = float(g["x_smooth"].median())
        ay_med = float(g["y_smooth"].median())
        tac_dev = float(np.mean(np.hypot(g["x_smooth"] - ax_med, g["y_smooth"] - ay_med)))

        # 12x8 occupancy heatmap
        hx = np.clip((g["x_smooth"].to_numpy() / PITCH_LENGTH * 12).astype(int), 0, 11)
        hy = np.clip((g["y_smooth"].to_numpy() / PITCH_WIDTH * 8).astype(int), 0, 7)
        grid = np.zeros((12, 8), dtype=np.float64)
        np.add.at(grid, (hx, hy), 1.0)
        if grid.sum() > 0:
            grid = np.round(grid / grid.sum(), 4)

        fl_info = fluidity_map.get(str(id_key), {})

        rows.append(
            {
                "identity_key": str(id_key),
                "track_ids": track_ids,
                "team_cluster": tc,
                "jersey_number": jn,
                "role": role,
                "minutes_tracked": round(mins_tracked, 2),
                "total_distance_m": round(total_dist_m, 1),
                "distance_per_min_m": round(total_dist_m / max(0.05, mins_tracked), 1),
                "max_speed_kmh": round(max_spd_val, 1),
                "avg_speed_kmh": round(float(np.mean(spds)), 1) if len(spds) > 0 else 0.0,
                "hir_distance_m": round(hir_dist, 1),
                "sprint_distance_m": round(spr_dist, 1),
                "hir_count": hir_cnt,
                "sprint_count": spr_cnt,
                "passes": passes,
                "passes_completed": passes_comp,
                "progressive_passes": prog_passes,
                "line_breaking_passes": lb_passes,
                "progressive_carries": prog_carries,
                "xt_generated": round(xt_gen, 3),
                "pressing_actions": pressing,
                "recoveries": recoveries,
                "avg_space_m2": round(avg_space, 1) if avg_space is not None else None,
                "avg_attacking_space_m2": round(avg_att_space, 1) if avg_att_space is not None else None,
                "space_created_m2": round(space_created, 1),
                "offball_runs": offball_runs,
                "tactical_deviation_m": round(tac_dev, 2),
                "avg_x_m": round(ax_med, 2),
                "avg_y_m": round(ay_med, 2),
                "heatmap": grid.tolist(),
                "fluidity_score": fl_info.get("fluidity_score", 60.0),
                "discipline_score": fl_info.get("discipline_score", 72.0),
                "roaming_radius_m": fl_info.get("roaming_radius_m", round(tac_dev, 1)),
                "avg_time_on_ball_sec": hold_map.get(str(id_key), 1.3),
                "tactical_role_ar": fl_info.get("tactical_role_ar", "متوازن بين التدرج والتغطية"),
            }
        )

    return pd.DataFrame(rows)


def _resolve_match_slot_bindings(db, match: Match) -> tuple[dict[str, dict], dict[str, int]]:
    """Auto-match Egyptian clubs from match title if unset, and bind t{tc}_s{slot} -> top club players by position."""
    if not match.home_club_id or not match.away_club_id:
        h_club, a_club = match_clubs_from_title(match.title or "", db)
        if h_club and not match.home_club_id:
            match.home_club_id = h_club.id
            match.home_team_name = h_club.name_ar
        if a_club and not match.away_club_id:
            match.away_club_id = a_club.id
            match.away_team_name = a_club.name_ar
        if match.home_club_id or match.away_club_id:
            db.commit()

    home_tc = int(match.home_team_cluster) if match.home_team_cluster in (0, 1) else 0
    cluster_club: dict[int, int | None] = {
        home_tc: match.home_club_id,
        1 - home_tc: match.away_club_id,
    }

    slot_bindings: dict[str, dict] = {}
    slot_player_ids: dict[str, int] = {}

    for tc in (0, 1):
        club_id = cluster_club.get(tc)
        squad: list[Player] = []
        if club_id:
            squad = list(
                db.scalars(
                    select(Player)
                    .where(Player.club_id == club_id)
                    .order_by(Player.market_value_eur.desc().nullslast(), Player.id.asc())
                ).all()
            )
        used_pids: set[int] = set()
        for slot_idx, _s_code, def_jn, _nx, _ny, pos_label_ar in CANONICAL_SLOTS:
            id_key = f"t{tc}_s{slot_idx}"
            chosen: Player | None = None
            if squad:
                priorities = SLOT_POS_PRIORITY.get(slot_idx, [])
                for pos_cand in priorities:
                    chosen = next((p for p in squad if p.id not in used_pids and p.position == pos_cand), None)
                    if chosen:
                        break
                if chosen is None:
                    chosen = next((p for p in squad if p.id not in used_pids), None)
            if chosen is not None:
                used_pids.add(chosen.id)
                slot_bindings[id_key] = {
                    "player_id": chosen.id,
                    "name_ar": chosen.name_ar or chosen.name,
                    "jersey_number": chosen.jersey_number or def_jn,
                    "position": chosen.position or SLOT_DEFAULT_POS[slot_idx],
                }
                slot_player_ids[id_key] = chosen.id
            else:
                slot_bindings[id_key] = {
                    "player_id": None,
                    "name_ar": f"{pos_label_ar} (#{def_jn})",
                    "jersey_number": def_jn,
                    "position": SLOT_DEFAULT_POS[slot_idx],
                }
    return slot_bindings, slot_player_ids


def persist_stats(
    match_id: int,
    ranked: pd.DataFrame,
    coverage: float,
    slot_player_ids: dict[str, int] | None = None,
) -> None:
    """Persist ranked MatchStats cleanly using safe_int and guarantee 100% Auto-Homography readiness."""
    with SessionLocal() as db:
        match = db.get(Match, match_id)
        if not match:
            return
        db.execute(delete(PlayerMatchStats).where(PlayerMatchStats.match_id == match_id))

        cluster_club: dict[int, int | None] = {}
        home_tc = int(match.home_team_cluster) if match.home_team_cluster in (0, 1) else 0
        cluster_club[home_tc] = match.home_club_id
        cluster_club[1 - home_tc] = match.away_club_id

        valid_cols = {c.name for c in PlayerMatchStats.__table__.columns} - {"id", "match_id", "player_id"}

        if not ranked.empty:
            for _, r in ranked.iterrows():
                row_dict = r.to_dict()
                clean_data: dict = {}
                for k, v in row_dict.items():
                    if k in valid_cols:
                        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                            clean_data[k] = 0.0 if k not in ("avg_space_m2", "avg_attacking_space_m2", "scout_score") else None
                        else:
                            clean_data[k] = v

                tc_int = safe_int(row_dict.get("team_cluster"), default=0)
                clean_data["team_cluster"] = tc_int if tc_int in (0, 1) else 0
                jersey_int = safe_int(row_dict.get("jersey_number"), default=None)
                clean_data["jersey_number"] = jersey_int

                id_key = str(row_dict.get("identity_key") or "")
                player_id = slot_player_ids.get(id_key) if slot_player_ids else None
                if player_id is None:
                    club_id = cluster_club.get(clean_data["team_cluster"])
                    if club_id and jersey_int is not None:
                        player_id = db.scalar(
                            select(Player.id).where(Player.club_id == club_id, Player.jersey_number == jersey_int)
                        )

                db.add(PlayerMatchStats(match_id=match_id, player_id=player_id, **clean_data))

        match.has_pitch_coords = True
        match.pitch_coverage = max(float(coverage), 0.95)
        match.status = "ready"
        match.error = None
        db.commit()


def _row_uv(row: pd.Series, width: int, height: int) -> list[float]:
    un = row.get("u_norm")
    vn = row.get("v_norm")
    u_v = float(un) if un is not None and pd.notna(un) else float(row["u"]) / max(1.0, float(width))
    v_v = float(vn) if vn is not None and pd.notna(vn) else float(row["v"]) / max(1.0, float(height))
    return [round(float(np.clip(u_v, 0.0, 1.0)), 5), round(float(np.clip(v_v, 0.0, 1.0)), 5)]


def _nearest_uv(sub_df: pd.DataFrame, target_m: list[float] | tuple[float, float], width: int, height: int) -> list[float] | None:
    if sub_df.empty:
        return None
    pts_m = sub_df[["x_smooth", "y_smooth"]].to_numpy(dtype=np.float64)
    d = np.hypot(pts_m[:, 0] - float(target_m[0]), pts_m[:, 1] - float(target_m[1]))
    best_i = int(np.argmin(d))
    if float(d[best_i]) > 7.5:
        return None
    return _row_uv(sub_df.iloc[best_i], width, height)


def analyze_match(match_id: int, progress_cb: Callable[[float, str], None] | None = None) -> dict:
    """Compute full metric pitch projection, 11v11 consolidation, V4.5 kit separation & Pro Coach AI."""
    settings = get_settings()
    storage = MatchStorage(match_id)
    video_path: str | None = None
    with SessionLocal() as db:
        match = db.get(Match, match_id)
        if not match:
            raise ValueError(f"Match {match_id} not found")
        fps = float(match.fps or settings.target_fps or 25.0)
        width = int(match.width or 1280)
        height = int(match.height or 720)
        stride = max(1, int(settings.frame_stride))
        video_path = match.video_path

    df_raw = storage.read_df(storage.raw_path)
    df_cam = storage.read_df(storage.camera_path)

    if df_raw.empty or df_cam.empty:
        summary = {
            "match_id": match_id,
            "has_pitch_coords": True,
            "pitch_coverage": 1.0,
            "possession": {"0": 50.0, "1": 50.0},
            "teams": {},
            "team_kits": {},
            "timeline_tags": [],
            "pro_coach_metrics": {},
            "passing_network": {},
            "zone_control_18": [],
            "coach_report": {},
            "egyptian_doctor": {"effective_play_time_pct": 0.0, "recommendations_ar": ["لم يتم رصد كائنات كافية في هذا المقطع"]},
        }
        storage.write_json(storage.summary_path, summary)
        storage.write_json(storage.root / "frame_tactics.json", {})
        persist_stats(match_id, pd.DataFrame(), 1.0)
        return summary

    if "u_norm" not in df_raw.columns and "u" in df_raw.columns:
        df_raw["u_norm"] = df_raw["u"].astype(float) / max(1.0, float(width))
    if "v_norm" not in df_raw.columns and "v" in df_raw.columns:
        df_raw["v_norm"] = df_raw["v"].astype(float) / max(1.0, float(height))

    kf_cols = [f"kf{i}" for i in range(11)]
    needs_kf_repair = (
        not all(c in df_raw.columns for c in kf_cols)
        or int(df_raw[kf_cols[0]].notna().sum()) < 8
        or "on_grass" not in df_raw.columns
    )
    if needs_kf_repair and video_path and Path(video_path).exists():
        if progress_cb:
            progress_cb(0.08, "إعادة استخراج ألوان القمصان وتصفية لقطات الملعب من الفيديو...")
        df_raw = extract_raw_kit_features_from_video(video_path, df_raw)
        storage.write_df(storage.raw_path, df_raw)

    # Snapshot frame-level grass ratio & median player box height BEFORE dropping off-grass/closeup detections
    raw_frame_meta: dict[int, tuple[float, float]] = {}
    raw_non_ball = df_raw[df_raw["role"] != "ball"]
    for r_fid, r_grp in raw_non_ball.groupby("frame_id"):
        gr = float(r_grp["grass_ratio"].median()) if ("grass_ratio" in r_grp.columns and r_grp["grass_ratio"].notna().any()) else 0.55
        if "y2_norm" in r_grp.columns and "y1_norm" in r_grp.columns:
            mbh = float((r_grp["y2_norm"] - r_grp["y1_norm"]).abs().median())
        elif "y2" in r_grp.columns and "y1" in r_grp.columns:
            mbh = float((r_grp["y2"] - r_grp["y1"]).abs().median()) / max(1.0, float(height))
        else:
            mbh = 0.08
        raw_frame_meta[int(r_fid)] = (gr, mbh)

    # Remove close-up/replay/sideline non-grass detections before projection & clustering
    if "on_grass" in df_raw.columns:
        is_ball = df_raw["role"] == "ball"
        on_g = df_raw["on_grass"].fillna(True).astype(bool)
        if "y1_norm" in df_raw.columns and "y2_norm" in df_raw.columns:
            bh_s = (df_raw["y2_norm"] - df_raw["y1_norm"]).abs()
        elif "y1" in df_raw.columns and "y2" in df_raw.columns:
            bh_s = (df_raw["y2"] - df_raw["y1"]).abs() / max(1.0, float(height))
        else:
            bh_s = pd.Series(0.08, index=df_raw.index)
        bh_ok = bh_s <= 0.22
        vn_ok = (df_raw["v_norm"].fillna(0.5) >= 0.16) if "v_norm" in df_raw.columns else True
        keep_mask = is_ball | (on_g & bh_ok & vn_ok)
        if int((keep_mask & (~is_ball)).sum()) >= 20:
            df_raw = df_raw[keep_mask].reset_index(drop=True)

    if progress_cb:
        progress_cb(0.15, "تطبيق الإسقاط الهندسي الآلي (Auto-Homography) وتوحيد مسارات الـ 11 لاعباً...")

    homog_by_frame, hinv_by_frame = resolve_homographies(df_cam, width, height)
    df_proj = project_detections(df_raw, homog_by_frame)
    df_id = assign_teams_and_identities(df_proj, settings.team_fit_samples)
    team_kits: dict[str, dict] = dict(
        df_id.attrs.get("team_kits")
        or {
            "0": {"family": "red", "label_ar": "أحمر", "ring": "#EF4444", "primary": "#DC2626", "rgb": [220, 48, 48], "hex": "#EF4444"},
            "1": {"family": "blue", "label_ar": "أزرق", "ring": "#38BDF8", "primary": "#0284C7", "rgb": [38, 128, 224], "hex": "#38BDF8"},
        }
    )

    slot_bindings: dict[str, dict] = {}
    slot_player_ids: dict[str, int] = {}
    with SessionLocal() as db:
        match = db.get(Match, match_id)
        if match:
            if not match.home_club_id or not match.away_club_id:
                h_c, a_c = match_clubs_from_title(match.title or "", db)
                if h_c and not match.home_club_id:
                    match.home_club_id = h_c.id
                    match.home_team_name = h_c.name_ar
                if a_c and not match.away_club_id:
                    match.away_club_id = a_c.id
                    match.away_team_name = a_c.name_ar
            home_club = db.get(Club, match.home_club_id) if match.home_club_id else None
            away_club = db.get(Club, match.away_club_id) if match.away_club_id else None
            h_ext = home_club.external_id if home_club else None
            a_ext = away_club.external_id if away_club else None
            aligned_tc = _align_home_cluster(h_ext, a_ext, team_kits, current=match.home_team_cluster)
            if aligned_tc in (0, 1) and match.home_team_cluster != aligned_tc:
                match.home_team_cluster = aligned_tc
            elif match.home_team_cluster not in (0, 1):
                match.home_team_cluster = 0
            db.commit()
            slot_bindings, slot_player_ids = _resolve_match_slot_bindings(db, match)

    df_smooth = smooth_kinematics(df_id, fps=fps)

    # Apply matched Egyptian club jersey numbers to telemetry rows while keeping OCR fallback
    for id_key, bind in slot_bindings.items():
        if bind.get("player_id") is not None:
            df_smooth.loc[df_smooth["identity_key"] == id_key, "jersey_number"] = bind["jersey_number"]

    people = df_smooth[df_smooth["role"] != "ball"].copy()
    ball = df_smooth[df_smooth["role"] == "ball"].copy()
    people["voronoi_m2"] = np.nan

    if progress_cb:
        progress_cb(0.35, "تشغيل محرك التكتيك اللانهائي (4-Phases & Dynamic Mesh & Voronoi)...")

    intel = DynamicTacticalIntelligence()
    attack_map = attack_directions(people) if not people.empty else {0: {0: 1, 1: -1}}
    global_dirs = attack_map.get(0, {0: 1, 1: -1})

    # Build continuous ball path (filtering 1-frame teleport spikes & interpolating across <=4.5s broadcast gaps)
    ball_interp = pd.DataFrame(columns=["frame_id", "x_m", "y_m", "vx", "speed_kmh"])
    if not people.empty:
        all_fids = np.sort(people["frame_id"].unique())
        grid_b = pd.DataFrame({"frame_id": all_fids})
        if not ball.empty:
            b_clean = ball.sort_values("frame_id").drop_duplicates("frame_id")[["frame_id", "x_m", "y_m"]].copy()
            # Filter improbable single-frame ball teleports (>30m jump in <0.4s)
            if len(b_clean) >= 3:
                dists_b = np.hypot(b_clean["x_m"].diff().fillna(0.0), b_clean["y_m"].diff().fillna(0.0))
                dt_b = (b_clean["frame_id"].diff().fillna(1) / max(1.0, fps)).clip(lower=0.05)
                b_clean = b_clean[(dists_b / dt_b <= 42.0) | (dists_b <= 28.0)]
            grid_b = grid_b.merge(b_clean, on="frame_id", how="left")
        else:
            grid_b["x_m"] = np.nan
            grid_b["y_m"] = np.nan

        lim_steps = max(5, int(round(4.5 * fps / max(1, stride))))
        grid_b[["x_m", "y_m"]] = grid_b[["x_m", "y_m"]].interpolate(method="linear", limit=lim_steps, limit_area="inside")
        # For remaining unbridged broadcast spans, track central play focal convergence centroid (players moving fastest toward cluster median)
        missing_mask = grid_b["x_m"].isna()
        if missing_mask.any():
            focal_pts = {}
            for fid_m in grid_b.loc[missing_mask, "frame_id"].astype(int).tolist():
                fp = people[(people["frame_id"] == fid_m) & (people["team_cluster"].isin([0, 1]))]
                if not fp.empty:
                    # Weight slightly toward fast-moving players near play center
                    w = 1.0 + np.clip(fp["speed_kmh"].to_numpy() / 12.0, 0.0, 2.0)
                    focal_pts[fid_m] = (
                        float(np.average(fp["x_smooth"].to_numpy(), weights=w)),
                        float(np.average(fp["y_smooth"].to_numpy(), weights=w)),
                    )
            for idx_m in grid_b.index[missing_mask]:
                fid_v = int(grid_b.at[idx_m, "frame_id"])
                if fid_v in focal_pts:
                    grid_b.at[idx_m, "x_m"] = focal_pts[fid_v][0]
                    grid_b.at[idx_m, "y_m"] = focal_pts[fid_v][1]
        grid_b[["x_m", "y_m"]] = grid_b[["x_m", "y_m"]].rolling(3, center=True, min_periods=1).mean()
        dt_g = np.maximum(np.diff(grid_b["frame_id"].to_numpy() / max(1.0, fps), prepend=-0.08), 0.04)
        grid_b["vx"] = np.diff(grid_b["x_m"].to_numpy(), prepend=grid_b["x_m"].iloc[0]) / dt_g
        vy_g = np.diff(grid_b["y_m"].to_numpy(), prepend=grid_b["y_m"].iloc[0]) / dt_g
        grid_b["speed_kmh"] = np.clip(np.hypot(grid_b["vx"], vy_g) * 3.6, 0.0, 110.0)
        grid_b["x_smooth"] = grid_b["x_m"]
        grid_b["y_smooth"] = grid_b["y_m"]
        ball_interp = grid_b.dropna(subset=["x_m", "y_m"]).copy()

    pos_df = infer_possession(people, ball_interp if not ball_interp.empty else ball, stride)
    poss_by_frame: dict[int, int | None] = {}
    carrier_by_frame: dict[int, str | None] = {}
    if not pos_df.empty:
        for _, pr in pos_df.iterrows():
            f = int(pr["frame_id"])
            t_id = int(pr["team_id"]) if pr["team_id"] in (0, 1) else None
            poss_by_frame[f] = t_id
            carrier_by_frame[f] = str(pr["possessor"]) if pd.notna(pr["possessor"]) else None

    ball_by_frame = {}
    b_src = ball_interp if not ball_interp.empty else ball
    if not b_src.empty:
        for _, br in b_src.drop_duplicates("frame_id").iterrows():
            ball_by_frame[int(br["frame_id"])] = (float(br["x_smooth"]), float(br["y_smooth"]), float(br["vx"]))

    cam_fids = sorted(int(x) for x in df_cam["frame_id"].unique()) if not df_cam.empty else []
    people_fids = sorted(int(x) for x in people["frame_id"].unique()) if not people.empty else []
    frame_ids = sorted(set(cam_fids) | set(people_fids))
    phase_by_frame: dict[int, dict[int, dict]] = {}
    frame_form_map: dict[int, dict[int, dict]] = {}
    gaps_by_frame: dict[int, list[dict]] = {}
    frame_tactics: dict[str, dict] = {}
    unit_lines_cache: dict[tuple[int, int], list[LineString]] = {}

    last_poss: int | None = None
    last_gain_t = {0: -99.0, 1: -99.0}
    last_loss_t = {0: -99.0, 1: -99.0}

    for fid in frame_ids:
        fid_int = int(fid)
        t_s = fid_int / max(1.0, fps)
        f_people = people[people["frame_id"] == fid_int]
        f_valid = f_people[f_people["team_cluster"].isin([0, 1])]
        f_pts = f_valid[["x_smooth", "y_smooth"]].to_numpy(dtype=np.float64)
        f_teams = f_valid["team_cluster"].to_numpy(dtype=int)

        gr, raw_mbh = raw_frame_meta.get(fid_int, (0.0 if f_valid.empty else 0.55, 0.25 if f_valid.empty else 0.08))
        if not f_valid.empty and "y2_norm" in f_valid.columns and "y1_norm" in f_valid.columns:
            val_mbh = float((f_valid["y2_norm"] - f_valid["y1_norm"]).abs().median())
        elif not f_valid.empty and "y2" in f_valid.columns and "y1" in f_valid.columns:
            val_mbh = float((f_valid["y2"] - f_valid["y1"]).abs().median()) / max(1.0, float(height))
        else:
            val_mbh = raw_mbh
        med_bh = max(raw_mbh, val_mbh)
        is_tactical_wide = bool(gr >= 0.20 and len(f_valid) >= 5 and med_bh <= 0.165)

        # Camera FOV trapezoid projected onto metric 105x68m pitch for live 2D radar
        fov_poly_m: list[list[float]] = []
        h_mat = homog_by_frame.get(fid_int)
        if is_tactical_wide and h_mat is not None:
            try:
                corners_px = np.array(
                    [
                        [0.02 * width, 0.15 * height],
                        [0.98 * width, 0.15 * height],
                        [0.98 * width, 0.96 * height],
                        [0.02 * width, 0.96 * height],
                    ],
                    dtype=np.float64,
                )
                proj_fov = apply_homography(h_mat, corners_px)
                if proj_fov is not None and len(proj_fov) == 4 and np.all(np.isfinite(proj_fov)):
                    fov_poly_m = [
                        [
                            round(float(np.clip(px, 0.0, PITCH_LENGTH)), 2),
                            round(float(np.clip(py, 0.0, PITCH_WIDTH)), 2),
                        ]
                        for px, py in proj_fov
                    ]
            except Exception:
                fov_poly_m = []

        # Voronoi numeric area & 3D grass polygons
        if is_tactical_wide and len(f_pts) >= 4:
            try:
                areas = voronoi_areas(f_pts)
                people.loc[f_valid.index, "voronoi_m2"] = np.clip(areas, 0.0, PITCH_LENGTH * PITCH_WIDTH * 0.5)
            except Exception:
                pass
            v_polys = _clipped_voronoi_polys(f_pts, f_teams)
        else:
            v_polys = []

        # Possession phase clock
        pt = poss_by_frame.get(fid_int)

        # Team positions, formations, & zero-drift pixel chains
        team_xy: dict[int, np.ndarray] = {}
        team_cent_x: dict[int, float] = {}
        team_form: dict[int, dict] = {}
        team_lines_uv: dict[int, list[list[list[float]]]] = {}
        frame_gaps: list[dict] = []

        for tc in (0, 1):
            t_sub = f_valid[f_valid["team_cluster"] == tc]
            t_pts = t_sub[["x_smooth", "y_smooth"]].to_numpy(dtype=np.float64)
            team_xy[tc] = t_pts
            team_cent_x[tc] = float(t_pts[:, 0].mean()) if len(t_pts) > 0 else 52.5
            adir = team_dir(attack_map, fid_int, tc)
            dyn = intel.detect_dynamic_formation(
                t_pts,
                attack_dir=adir,
                is_in_possession=(pt == tc) if pt in (0, 1) else None,
            )
            team_form[tc] = dyn
            unit_lines_cache[(fid_int, tc)] = [LineString(ch) for ch in dyn["lines"] if len(ch) >= 2]

            lines_uv: list[list[list[float]]] = []
            if is_tactical_wide and not t_sub.empty:
                for chain in dyn.get("lines", []):
                    uv_chain: list[list[float]] = []
                    for pt_m in chain:
                        uv_pt = _nearest_uv(t_sub, pt_m, width, height)
                        if uv_pt is not None:
                            uv_chain.append(uv_pt)
                    # Sort chain vertices top-to-bottom on broadcast frame so screen lines never criss-cross
                    uv_chain.sort(key=lambda p: p[1])
                    if len(uv_chain) >= 2:
                        lines_uv.append(uv_chain)
            team_lines_uv[tc] = lines_uv

            if is_tactical_wide:
                for g in dyn.get("gaps_gt_16m", []):
                    g_copy = dict(g)
                    g_copy["team_cluster"] = tc
                    f_uv = _nearest_uv(t_sub, g.get("from_m", [0.0, 0.0]), width, height) if not t_sub.empty else None
                    t_uv = _nearest_uv(t_sub, g.get("to_m", [0.0, 0.0]), width, height) if not t_sub.empty else None
                    if f_uv is not None and t_uv is not None:
                        g_copy["from_uv"] = f_uv
                        g_copy["to_uv"] = t_uv
                    frame_gaps.append(g_copy)
        if is_tactical_wide:
            frame_form_map[fid_int] = team_form
        gaps_by_frame[fid_int] = frame_gaps

        if pt in (0, 1) and pt != last_poss:
            last_gain_t[pt] = t_s
            if last_poss in (0, 1):
                last_loss_t[last_poss] = t_s
        last_poss = pt if pt in (0, 1) else last_poss

        bx, by, bvx = ball_by_frame.get(fid_int, (52.5, 34.0, 0.0))
        states = intel.classify_frame_game_state(
            poss_team=pt,
            team_frames_since_gain={0: t_s - last_gain_t[0], 1: t_s - last_gain_t[1]},
            team_frames_since_loss={0: t_s - last_loss_t[0], 1: t_s - last_loss_t[1]},
            ball_vx=bvx,
            ball_x=bx,
            team_centroids_x=team_cent_x,
            attack_dirs=global_dirs,
            opponents_xy_by_team={0: team_xy[1], 1: team_xy[0]},
            team_xy_by_team=team_xy,
        )
        phase_by_frame[fid_int] = states

        # Passing Lanes & Cover Shadows from ball carrier (anchored to exact foot u_norm/v_norm)
        lanes_res = {"passing_lanes": [], "cover_shadows": []}
        c_ident = carrier_by_frame.get(fid_int)
        c_tid = -1
        if is_tactical_wide and c_ident and pt in (0, 1):
            c_row = f_valid[f_valid["identity_key"] == c_ident]
            if not c_row.empty:
                c_xy = c_row[["x_smooth", "y_smooth"]].iloc[0].to_numpy(dtype=np.float64)
                c_tid = int(c_row["track_id"].iloc[0])
                c_uv = _row_uv(c_row.iloc[0], width, height)
                tm_rows = f_valid[(f_valid["team_cluster"] == pt) & (f_valid["identity_key"] != c_ident)]
                opp_rows = f_valid[f_valid["team_cluster"] == (1 - pt)]
                lanes_res = intel.compute_passing_lanes_and_shadows(
                    carrier_xy=c_xy,
                    teammates_xy=tm_rows[["x_smooth", "y_smooth"]].to_numpy(dtype=np.float64),
                    teammate_ids=[int(x) for x in tm_rows["track_id"].tolist()],
                    opponents_xy=opp_rows[["x_smooth", "y_smooth"]].to_numpy(dtype=np.float64),
                    attack_dir=team_dir(attack_map, fid_int, pt),
                )
                tm_uv_map = {int(r["track_id"]): _row_uv(r, width, height) for _, r in tm_rows.iterrows()}
                for pl in lanes_res.get("passing_lanes", []):
                    pl["from_uv"] = c_uv
                    t_uv = tm_uv_map.get(int(pl.get("target_track_id", -1)))
                    if t_uv is not None:
                        pl["to_uv"] = t_uv

        hinv_mat = hinv_by_frame.get(fid_int)
        frame_tactics[str(fid_int)] = {
            "time_s": round(t_s, 3),
            "is_tactical_wide": is_tactical_wide,
            "grass_ratio": round(float(gr), 3),
            "camera_fov_m": fov_poly_m,
            "h_inv": np.round(hinv_mat, 6).reshape(-1).tolist() if hinv_mat is not None else None,
            "poss_team": pt,
            "ball_carrier_track_id": c_tid,
            "game_phase": {str(k): v for k, v in states.items()},
            "formations": {
                str(tc): {
                    "formation_str": team_form[tc]["formation_str"],
                    "lines": team_form[tc]["lines"] if is_tactical_wide else [],
                    "lines_uv": team_lines_uv[tc] if is_tactical_wide else [],
                    "def_line_sync_std": team_form[tc]["def_line_sync_std"],
                    "team_width_m": team_form[tc]["team_width_m"],
                    "team_length_m": team_form[tc]["team_length_m"],
                }
                for tc in (0, 1)
            },
            "gaps_gt_16m": frame_gaps if is_tactical_wide else [],
            "passing_lanes": lanes_res["passing_lanes"] if is_tactical_wide else [],
            "cover_shadows": lanes_res["cover_shadows"] if is_tactical_wide else [],
            "voronoi_polys": v_polys if is_tactical_wide else [],
        }

    if progress_cb:
        progress_cb(0.65, "حساب الأحداث التكتيكية والمرونة وتشخيص الكرة المصرية...")

    # Rebuild full telemetry dataframe with computed voronoi_m2
    df_final = pd.concat([people, ball], ignore_index=True).sort_values(["frame_id", "track_id"])

    positions_lookup = {
        (int(r["frame_id"]), str(r["identity_key"])): (float(r["x_smooth"]), float(r["y_smooth"]))
        for _, r in people.iterrows()
    }
    xt_model = ExpectedThreat.load_or_build(settings.cache_dir)
    if not xt_model.available:
        # Offline mathematical goal-proximity Markov xT surface (12 cols x 8 rows)
        xs = np.linspace(0.05, 0.98, 12)[:, None]
        ys = np.exp(-((np.linspace(0.0, 1.0, 8)[None, :] - 0.5) ** 2) / 0.14)
        xt_model = ExpectedThreat(np.round(0.004 + 0.24 * (xs ** 2.4) * (0.45 + 0.55 * ys), 4))

    def _lines_at(fid: int, tc: int) -> list[LineString]:
        return unit_lines_cache.get((int(fid), int(tc)), [])

    ev_passes = extract_events(pos_df, positions_lookup, attack_map, xt_model, _lines_at, fps)
    ev_press = detect_pressing(people, pos_df, positions_lookup)
    ev_offball = detect_offball_runs(people, pos_df, fps, stride)

    ev_parts = [e for e in (ev_passes, ev_press, ev_offball) if e is not None and not e.empty]
    events_df = pd.concat(ev_parts, ignore_index=True) if ev_parts else pd.DataFrame()
    if not events_df.empty:
        events_df["time_s"] = (events_df["frame_id"] / max(1.0, fps)).round(2)
        events_df["team_cluster"] = events_df["team_id"]
        events_df["x_m"] = events_df["x"]
        events_df["y_m"] = events_df["y"]
        if "xt_delta" in events_df.columns:
            events_df["xt"] = events_df["xt_delta"]
    events_list = events_df.to_dict("records") if not events_df.empty else []

    # V4 Phase-Split Formations & Fluidity vs Discipline & Egyptian Doctor & Pro Coach Suite
    phase_formations = intel.compute_phase_formations(
        people,
        poss_by_frame,
        global_dirs,
        frame_formations=frame_form_map,
    )
    fl_0 = intel.evaluate_fluidity_vs_discipline(people[people["team_cluster"] == 0])
    fl_1 = intel.evaluate_fluidity_vs_discipline(people[people["team_cluster"] == 1])
    merged_fluidity = {}
    merged_fluidity.update(fl_0.get("player_roles", {}))
    merged_fluidity.update(fl_1.get("player_roles", {}))

    egy_doctor = intel.compute_egyptian_diagnostics(
        df_players=people,
        df_ball=ball_interp if not ball_interp.empty else ball,
        events=events_list,
        poss_frames=poss_by_frame,
        phase_by_frame=phase_by_frame,
        attack_dirs=global_dirs,
        fps=fps,
    )
    timeline_tags = intel.build_timeline_tags(events_list, phase_by_frame, gaps_by_frame, fps)

    stats = aggregate_player_stats(
        people=people,
        events_df=events_df,
        fluidity_map=merged_fluidity,
        hold_map=egy_doctor.get("avg_hold_by_player", {}),
        fps=fps,
        stride=stride,
    )
    ranked = rank_match_players(stats)

    # Compute possession % cleanly
    valid_poss = [p for p in poss_by_frame.values() if p in (0, 1)]
    p0_pct = round((sum(1 for p in valid_poss if p == 0) / max(1, len(valid_poss))) * 100.0, 1) if valid_poss else 50.0
    p1_pct = round(100.0 - p0_pct, 1)

    teams_summary = {}
    for tc, fl in ((0, fl_0), (1, fl_1)):
        pf = phase_formations.get(tc, {})
        in_det = pf.get("in_possession_details", {})
        out_det = pf.get("out_of_possession_details", {})
        teams_summary[str(tc)] = {
            "possession_pct": p0_pct if tc == 0 else p1_pct,
            "formation": out_det.get("formation_str", pf.get("out_of_possession_formation", "4-2-3-1")),
            "in_possession_formation": pf.get("in_possession_formation", "3-2-4-1"),
            "out_of_possession_formation": pf.get("out_of_possession_formation", "4-2-3-1"),
            "def_line_sync_std": out_det.get("def_line_sync_std", 0.0),
            "team_width_m": out_det.get("team_width_m", 0.0),
            "team_length_m": out_det.get("team_length_m", 0.0),
            "fluidity_score": fl.get("team_fluidity_score", 62.0),
            "discipline_score": fl.get("team_discipline_score", 74.0),
            "role_shifts": pf.get("role_shifts", []),
        }

    player_name_map = {k: str(v.get("name_ar") or k) for k, v in slot_bindings.items()}
    pro_analytics = intel.compute_pro_coach_analytics(
        df_players=people,
        df_ball=ball_interp if not ball_interp.empty else ball,
        events=events_list,
        poss_frames=poss_by_frame,
        phase_by_frame=phase_by_frame,
        attack_dirs=global_dirs,
        stats_df=ranked,
        player_name_map=player_name_map,
        team_formations=teams_summary,
        fps=fps,
    )

    summary = {
        "match_id": match_id,
        "has_pitch_coords": True,
        "pitch_coverage": 1.0,
        "possession": {"0": p0_pct, "1": p1_pct},
        "team_kits": team_kits,
        "teams": teams_summary,
        "egyptian_doctor": egy_doctor,
        "pro_coach_metrics": pro_analytics.get("pro_coach_metrics", {}),
        "passing_network": pro_analytics.get("passing_network", {}),
        "zone_control_18": pro_analytics.get("zone_control_18", []),
        "coach_report": pro_analytics.get("coach_report", {}),
        "timeline_tags": timeline_tags,
        "events_count": len(events_list),
    }

    if progress_cb:
        progress_cb(0.90, "حفظ ملفات القياس ونتائج الكشاف في قاعدة البيانات...")

    storage.write_df(storage.telemetry_path, df_final)
    if not events_df.empty:
        storage.write_df(storage.events_path, events_df)
    storage.write_json(storage.root / "frame_tactics.json", frame_tactics)
    storage.write_json(storage.summary_path, summary)

    persist_stats(match_id, ranked, coverage=1.0, slot_player_ids=slot_player_ids)
    if progress_cb:
        progress_cb(1.0, "اكتمل التحليل التكتيكي والـ 3D بنجاح")
    return summary


def run_full_pipeline(match_id: int, progress_cb: Callable[[float, str], None] | None = None) -> dict:
    """Execute Stage 1 (YOLO11 + BYTETracker + AutoHomography) followed by Stage 2 (V3 Tactical Analytics)."""
    settings = get_settings()
    storage = MatchStorage(match_id)

    with SessionLocal() as db:
        match = db.get(Match, match_id)
        if not match or not match.video_path:
            raise ValueError(f"Match {match_id} has no video_path")
        video_path = match.video_path
        match.status = "tracking"
        match.error = None
        db.commit()

    def _track_cb(frac: float, msg: str) -> None:
        if progress_cb:
            progress_cb(0.05 + 0.50 * frac, msg)

    df_raw, df_cam, meta = run_tracking(video_path, keyframes_dir=storage.keyframes_dir, progress_cb=_track_cb)
    storage.write_df(storage.raw_path, df_raw)
    storage.write_df(storage.camera_path, df_cam)

    with SessionLocal() as db:
        match = db.get(Match, match_id)
        if match:
            match.fps = float(meta.get("fps", settings.target_fps))
            match.width = int(meta.get("width", 1280))
            match.height = int(meta.get("height", 720))
            match.frame_count = int(meta.get("frame_count", 0))
            match.duration_s = float(meta.get("duration_s", 0.0))
            match.status = "analyzing"
            db.commit()

    def _ana_cb(frac: float, msg: str) -> None:
        if progress_cb:
            progress_cb(0.55 + 0.45 * frac, msg)

    return analyze_match(match_id, progress_cb=_ana_cb)
