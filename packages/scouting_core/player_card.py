"""Pure physics-honest Player Card stats, heatmap, tier, and match percentile engine."""
from __future__ import annotations

from typing import Any, Optional

import numpy as np
import pandas as pd

MAX_PHYSICAL_SPEED_KMH = 36.0
SPRINT_THRESHOLD_KMH = 25.0
SPRINT_MIN_DURATION_S = 1.0
MAX_STEP_GAP_S = 2.0
MIN_STEP_GAP_GUARD = 0.04
MIN_WORK_RATE_SECONDS = 300.0
LOW_RES_BBOX_HEIGHT_PX = 96.0


def stabilize_dataframe_homography_drift(df: pd.DataFrame) -> pd.DataFrame:
    """Remove rigid whole-frame homography pan/drift shared by >=4 co-visible players.

    Preserves each player's individual relative motion while preventing camera-pan or
    homography slip from inflating every player on screen to 34-36 km/h.
    """
    if df is None or df.empty or "x_m" not in df.columns or "y_m" not in df.columns:
        return df
    valid = df[df["role"].isin(["player", "goalkeeper"]) & df["x_m"].notna() & df["y_m"].notna()]
    if valid["frame_id"].nunique() < 3 or valid["track_id"].nunique() < 4:
        return df

    out = df.copy()
    piv_x = valid.pivot_table(index="frame_id", columns="track_id", values="x_m", aggfunc="first").sort_index()
    piv_y = valid.pivot_table(index="frame_id", columns="track_id", values="y_m", aggfunc="first").sort_index()
    if "time_s" in valid.columns:
        fid_ts = valid.groupby("frame_id")["time_s"].first().reindex(piv_x.index).to_numpy(dtype=np.float64)
    else:
        fid_ts = piv_x.index.to_numpy(dtype=np.float64) / 25.0

    dx = piv_x.diff()
    dy = piv_y.diff()
    fids = piv_x.index.to_numpy()
    cum_dx = 0.0
    cum_dy = 0.0
    offset_map: dict[int, tuple[float, float]] = {int(fids[0]): (0.0, 0.0)}

    for idx in range(1, len(fids)):
        row_dx = dx.iloc[idx].dropna()
        row_dy = dy.iloc[idx].dropna()
        dt = float(fid_ts[idx] - fid_ts[idx - 1]) if np.isfinite(fid_ts[idx] - fid_ts[idx - 1]) else 0.08
        if len(row_dx) >= 4 and len(row_dy) >= 4 and 1e-3 < dt <= 0.5:
            med_dx = float(row_dx.median())
            med_dy = float(row_dy.median())
            med_spd_ms = float(np.hypot(med_dx, med_dy)) / dt
            # Rigid common-mode translation > 2.8 m/s (~10 km/h) across >=4 scattered players is homography/camera drift
            if med_spd_ms > 2.8:
                cum_dx += med_dx
                cum_dy += med_dy
        offset_map[int(fids[idx])] = (cum_dx, cum_dy)

    if cum_dx == 0.0 and cum_dy == 0.0:
        return df

    off_x = out["frame_id"].astype(int).map(lambda f: offset_map.get(int(f), (0.0, 0.0))[0]).to_numpy(dtype=np.float64)
    off_y = out["frame_id"].astype(int).map(lambda f: offset_map.get(int(f), (0.0, 0.0))[1]).to_numpy(dtype=np.float64)
    mask = out["x_m"].notna() & out["y_m"].notna()
    out.loc[mask, "x_m"] = np.clip(out.loc[mask, "x_m"].to_numpy(dtype=np.float64) - off_x[mask], -2.0, 107.0).astype(out["x_m"].dtype)
    out.loc[mask, "y_m"] = np.clip(out.loc[mask, "y_m"].to_numpy(dtype=np.float64) - off_y[mask], -2.0, 70.0).astype(out["y_m"].dtype)
    return out

_POSITION_LABELS: dict[str, tuple[str, str]] = {
    "GK": ("حارس مرمى", "Goalkeeper"),
    "LB": ("ظهير أيسر", "Left Back"),
    "LWB": ("ظهير جناح أيسر", "Left Wing Back"),
    "CB": ("قلب دفاع", "Center Back"),
    "RB": ("ظهير أيمن", "Right Back"),
    "RWB": ("ظهير جناح أيمن", "Right Wing Back"),
    "DM": ("ارتكاز دفاعي", "Defensive Midfield"),
    "CDM": ("ارتكاز دفاعي", "Defensive Midfield"),
    "LM": ("جناح وسط أيسر", "Left Midfield"),
    "CM": ("وسط ملعب", "Central Midfield"),
    "RM": ("جناح وسط أيمن", "Right Midfield"),
    "CAM": ("صانع ألعاب", "Attacking Midfield"),
    "AM": ("صانع ألعاب", "Attacking Midfield"),
    "LW": ("جناح أيسر", "Left Winger"),
    "ST": ("مهاجم صريح", "Striker"),
    "CF": ("مهاجم صريح", "Center Forward"),
    "RW": ("جناح أيمن", "Right Winger"),
    "UNK": ("غير محدد", "Unverified"),
}


def compute_clean_trajectory_kinematics(
    fids: np.ndarray,
    ts: Optional[np.ndarray],
    xs_raw: np.ndarray,
    ys_raw: np.ndarray,
    fps: float,
    window_half_s: float = 0.28,
) -> dict[str, Any]:
    """Local linear-regression trajectory smoother across continuous segments.

    Cancels high-frequency alternating camera/homography jitter while preserving
    exact constant velocities and breaking cleanly across tracking teleports.
    """
    n = int(len(xs_raw))
    if n == 0 or fps <= 0:
        return {
            "xs": xs_raw.copy(),
            "ys": ys_raw.copy(),
            "speeds_kmh": np.zeros(0, dtype=np.float64),
            "vx_ms": np.zeros(0, dtype=np.float64),
            "vy_ms": np.zeros(0, dtype=np.float64),
            "distance_m": 0.0,
            "top_speed_kmh": 0.0,
            "avg_speed_kmh": 0.0,
            "sprints": 0,
            "step_ok": np.zeros(0, dtype=bool),
        }

    t_fid = fids.astype(np.float64) / float(fps)
    if ts is not None and len(ts) == n:
        t_arr = ts.astype(np.float64)
        # Use provided timestamps if strictly monotonic, else frame/fps
        if n >= 2 and np.all(np.diff(t_arr) > 1e-4):
            t_sec = t_arr
        else:
            t_sec = t_fid
    else:
        t_sec = t_fid

    if n == 1:
        return {
            "xs": xs_raw.astype(np.float64),
            "ys": ys_raw.astype(np.float64),
            "speeds_kmh": np.zeros(1, dtype=np.float64),
            "vx_ms": np.zeros(1, dtype=np.float64),
            "vy_ms": np.zeros(1, dtype=np.float64),
            "distance_m": 0.0,
            "top_speed_kmh": 0.0,
            "avg_speed_kmh": 0.0,
            "sprints": 0,
            "step_ok": np.zeros(0, dtype=bool),
        }

    dt_raw = np.diff(t_sec)
    raw_dist = np.hypot(np.diff(xs_raw), np.diff(ys_raw))
    with np.errstate(divide="ignore", invalid="ignore"):
        raw_kmh = np.where(dt_raw > 1e-4, (raw_dist / dt_raw) * 3.6, np.inf)
    step_ok = (dt_raw > 1e-4) & (dt_raw <= MAX_STEP_GAP_S) & (raw_kmh <= MAX_PHYSICAL_SPEED_KMH)

    # Split into continuous unbroken segments at invalid/teleport steps
    break_indices = np.where(~step_ok)[0]
    seg_starts = [0] + [int(b + 1) for b in break_indices]
    seg_ends = [int(b + 1) for b in break_indices] + [n]

    xs_s = xs_raw.astype(np.float64).copy()
    ys_s = ys_raw.astype(np.float64).copy()
    vx_arr = np.zeros(n, dtype=np.float64)
    vy_arr = np.zeros(n, dtype=np.float64)
    spds_kmh = np.zeros(n, dtype=np.float64)

    total_dist = 0.0
    total_dt = 0.0
    valid_step_spds: list[float] = []
    valid_step_dts: list[float] = []

    for s0, s1 in zip(seg_starts, seg_ends):
        m = s1 - s0
        if m < 2:
            continue
        t_seg = t_sec[s0:s1]
        x_seg = xs_raw[s0:s1].astype(np.float64)
        y_seg = ys_raw[s0:s1].astype(np.float64)

        for i in range(m):
            lo = int(np.searchsorted(t_seg, t_seg[i] - window_half_s, side="left"))
            hi = int(np.searchsorted(t_seg, t_seg[i] + window_half_s, side="right"))
            if hi - lo < 2:
                lo = max(0, i - 1)
                hi = min(m, i + 2)
            tw = t_seg[lo:hi]
            xw = x_seg[lo:hi]
            yw = y_seg[lo:hi]
            t_mean = float(np.mean(tw))
            dt_w = tw - t_mean
            denom = float(np.dot(dt_w, dt_w))
            if denom > 1e-9:
                x_mean = float(np.mean(xw))
                y_mean = float(np.mean(yw))
                vx = float(np.dot(dt_w, xw - x_mean) / denom)
                vy = float(np.dot(dt_w, yw - y_mean) / denom)
                xs_s[s0 + i] = x_mean + vx * (float(t_seg[i]) - t_mean)
                ys_s[s0 + i] = y_mean + vy * (float(t_seg[i]) - t_mean)
            else:
                vx, vy = 0.0, 0.0

            spd_mps = float(np.hypot(vx, vy))
            max_mps = MAX_PHYSICAL_SPEED_KMH / 3.6
            if spd_mps > max_mps and spd_mps > 1e-6:
                scale = max_mps / spd_mps
                vx *= scale
                vy *= scale
                spd_mps = max_mps
            vx_arr[s0 + i] = vx
            vy_arr[s0 + i] = vy
            spds_kmh[s0 + i] = min(MAX_PHYSICAL_SPEED_KMH, spd_mps * 3.6)

        seg_dx = np.diff(xs_s[s0:s1])
        seg_dy = np.diff(ys_s[s0:s1])
        seg_dt = np.diff(t_seg)
        seg_dists = np.hypot(seg_dx, seg_dy)
        with np.errstate(divide="ignore", invalid="ignore"):
            seg_kmh = np.where(seg_dt > 1e-4, (seg_dists / seg_dt) * 3.6, 0.0)
        seg_kmh = np.clip(seg_kmh, 0.0, MAX_PHYSICAL_SPEED_KMH)
        total_dist += float(seg_dists.sum())
        total_dt += float(seg_dt.sum())
        valid_step_spds.extend(seg_kmh.tolist())
        valid_step_dts.extend(seg_dt.tolist())

    if not valid_step_spds or total_dt <= 0:
        return {
            "xs": xs_s,
            "ys": ys_s,
            "speeds_kmh": spds_kmh,
            "vx_ms": vx_arr,
            "vy_ms": vy_arr,
            "distance_m": 0.0,
            "top_speed_kmh": 0.0,
            "avg_speed_kmh": 0.0,
            "sprints": 0,
            "step_ok": step_ok,
        }

    arr_spds = np.asarray(valid_step_spds, dtype=np.float64)
    arr_dts = np.asarray(valid_step_dts, dtype=np.float64)
    # Also suppress common 2-frame residual jitter when computing top speed
    if len(arr_spds) >= 6:
        top_kmh = round(min(MAX_PHYSICAL_SPEED_KMH, float(np.percentile(arr_spds, 92))), 1)
    else:
        top_kmh = round(min(MAX_PHYSICAL_SPEED_KMH, float(np.percentile(arr_spds, 95))), 1)
    avg_kmh = round(min(MAX_PHYSICAL_SPEED_KMH, (total_dist / total_dt) * 3.6), 1)

    sprints = 0
    seg_dur = 0.0
    for spd_val, seg_dt in zip(arr_spds, arr_dts):
        if spd_val >= SPRINT_THRESHOLD_KMH:
            seg_dur += float(seg_dt)
        else:
            if seg_dur >= SPRINT_MIN_DURATION_S:
                sprints += 1
            seg_dur = 0.0
    if seg_dur >= SPRINT_MIN_DURATION_S:
        sprints += 1

    return {
        "xs": xs_s,
        "ys": ys_s,
        "speeds_kmh": spds_kmh,
        "vx_ms": vx_arr,
        "vy_ms": vy_arr,
        "distance_m": round(total_dist, 1),
        "top_speed_kmh": top_kmh,
        "avg_speed_kmh": avg_kmh,
        "sprints": int(sprints),
        "step_ok": step_ok,
    }


def assign_team_relative_positions(
    entries: list[dict[str, Any]],
    team_a_attacks_right: bool,
    pitch_length: float = 105.0,
    pitch_width: float = 68.0,
) -> None:
    """Assign realistic football positions relative to each team's active outfield distribution.

    Prevents attacking-phase clips from labeling an entire team as 'ST'.
    """
    for team_key in ("team_a", "team_b"):
        atk_right = team_a_attacks_right if team_key == "team_a" else (not team_a_attacks_right)
        outfield: list[tuple[dict[str, Any], float, float]] = []
        for entry in entries:
            if entry.get("team") != team_key or entry.get("is_gk") or str(entry.get("role", "")).lower() == "goalkeeper":
                continue
            avg_pos = entry.get("avg_position")
            if not isinstance(avg_pos, dict) or avg_pos.get("x_m") is None or avg_pos.get("y_m") is None:
                continue
            ax = float(avg_pos["x_m"])
            ay = float(avg_pos["y_m"])
            ox = ax if atk_right else (pitch_length - ax)
            oy = ay if atk_right else (pitch_width - ay)
            outfield.append((entry, ox, oy))

        m = len(outfield)
        if m < 2:
            continue

        # Sort by advancing depth ox ascending (own goal -> opponent goal)
        by_depth = sorted(outfield, key=lambda item: item[1])
        n_def = min(4, max(1, int(round(m * 0.40))))
        n_fwd = min(3, max(1, int(round(m * 0.25))))
        if n_def + n_fwd > m:
            n_fwd = max(0, m - n_def)
        n_mid = max(0, m - n_def - n_fwd)

        defs = sorted(by_depth[:n_def], key=lambda item: item[2])
        mids = sorted(by_depth[n_def : n_def + n_mid], key=lambda item: item[2])
        fwds = sorted(by_depth[n_def + n_mid :], key=lambda item: item[2])

        def _set_code(target_entry: dict[str, Any], code: str) -> None:
            ar, en = _POSITION_LABELS[code]
            target_entry["position_label"] = {"code": code, "ar": ar, "en": en}

        # Defenders
        if len(defs) == 1:
            _set_code(defs[0][0], "CB")
        elif len(defs) == 2:
            if (defs[1][2] - defs[0][2]) > 20.0:
                _set_code(defs[0][0], "LB")
                _set_code(defs[1][0], "RB")
            else:
                _set_code(defs[0][0], "CB")
                _set_code(defs[1][0], "CB")
        elif len(defs) >= 3:
            _set_code(defs[0][0], "LB")
            for mid_d in defs[1:-1]:
                _set_code(mid_d[0], "CB")
            _set_code(defs[-1][0], "RB")

        # Midfielders
        if len(mids) == 1:
            _set_code(mids[0][0], "CM")
        elif len(mids) == 2:
            if (mids[1][2] - mids[0][2]) > 24.0:
                _set_code(mids[0][0], "LM")
                _set_code(mids[1][0], "RM")
            else:
                _set_code(mids[0][0], "CM")
                _set_code(mids[1][0], "CM")
        elif len(mids) >= 3:
            _set_code(mids[0][0], "LM")
            for mid_m in mids[1:-1]:
                _set_code(mid_m[0], "CM")
            _set_code(mids[-1][0], "RM")

        # Forwards (capped to <=2 STs per team!)
        if len(fwds) == 1:
            oy0 = fwds[0][2]
            _set_code(fwds[0][0], "LW" if oy0 < 16.0 else ("RW" if oy0 > 52.0 else "ST"))
        elif len(fwds) == 2:
            if (fwds[1][2] - fwds[0][2]) > 24.0:
                _set_code(fwds[0][0], "LW")
                _set_code(fwds[1][0], "RW")
            else:
                _set_code(fwds[0][0], "ST")
                _set_code(fwds[1][0], "ST")
        elif len(fwds) >= 3:
            _set_code(fwds[0][0], "LW")
            for mid_f in fwds[1:-1]:
                _set_code(mid_f[0], "ST")
            _set_code(fwds[-1][0], "RW")


def compute_card_tier(calibrated_ratio: float, observed_s: float) -> str:
    """Data-confidence tier (Gold/Silver/Bronze) based strictly on calibration & sample time."""
    if calibrated_ratio >= 0.8 and observed_s >= 60.0:
        return "gold"
    if calibrated_ratio >= 0.5 and observed_s >= 20.0:
        return "silver"
    return "bronze"


def _infer_position_label(
    role: str,
    avg_x: Optional[float],
    avg_y: Optional[float],
    pitch_length: float,
    pitch_width: float,
    attack_right: bool,
) -> dict[str, str]:
    if str(role).lower() == "goalkeeper":
        ar, en = _POSITION_LABELS["GK"]
        return {"code": "GK", "ar": ar, "en": en}
    if avg_x is None or avg_y is None:
        ar, en = _POSITION_LABELS["UNK"]
        return {"code": "UNK", "ar": ar, "en": en}

    ox = float(avg_x) if attack_right else (pitch_length - float(avg_x))
    oy = float(avg_y) if attack_right else (pitch_width - float(avg_y))
    x_ratio = np.clip(ox / max(1.0, pitch_length), 0.0, 1.0)
    y_ratio = np.clip(oy / max(1.0, pitch_width), 0.0, 1.0)

    if x_ratio < 0.36:
        zone = "DEF"
    elif x_ratio <= 0.66:
        zone = "MID"
    else:
        zone = "FWD"

    if y_ratio < 0.33:
        side = "L"
    elif y_ratio > 0.67:
        side = "R"
    else:
        side = "C"

    code_map = {
        ("DEF", "L"): "LB",
        ("DEF", "C"): "CB",
        ("DEF", "R"): "RB",
        ("MID", "L"): "LM",
        ("MID", "C"): "CM",
        ("MID", "R"): "RM",
        ("FWD", "L"): "LW",
        ("FWD", "C"): "ST",
        ("FWD", "R"): "RW",
    }
    code = code_map[(zone, side)]
    ar, en = _POSITION_LABELS[code]
    return {"code": code, "ar": ar, "en": en}


def build_player_card_stats(
    track_df: pd.DataFrame,
    fps: float,
    pitch_length: float = 105.0,
    pitch_width: float = 68.0,
    attack_right: bool = True,
) -> dict[str, Any]:
    """Compute honest, measured tracking statistics for one player track (never invents OVR/rating)."""
    if track_df is None or track_df.empty or fps <= 0:
        return {
            "kind": "measured",
            "observed_s": 0.0,
            "observed_min": 0.0,
            "distance_m": None,
            "top_speed_kmh": None,
            "avg_speed_kmh": None,
            "work_rate_m_per_min": None,
            "sprints": None,
            "avg_position": None,
            "heatmap": None,
            "position_label": {"code": "UNK", "ar": "غير محدد", "en": "Unverified"},
            "tier": "bronze",
            "reason": "uncalibrated",
            "quality": {"calibrated_ratio": 0.0, "samples": 0, "low_sample": True},
        }

    df = track_df.sort_values("frame_id").drop_duplicates(subset=["frame_id"]).reset_index(drop=True)
    samples = int(len(df))
    role_mode = str(df["role"].mode().iloc[0]) if ("role" in df.columns and not df["role"].dropna().empty) else "player"

    fids = df["frame_id"].to_numpy(dtype=np.float64)
    if len(fids) >= 2:
        diffs = np.diff(fids)
        pos_diffs = diffs[diffs > 0]
        median_gap = float(np.median(pos_diffs)) if len(pos_diffs) > 0 else 1.0
        median_gap = max(1.0, min(median_gap, float(fps)))
    else:
        median_gap = 1.0

    observed_s = round(float(samples * median_gap / float(fps)), 2)
    observed_min = round(observed_s / 60.0, 2)

    crop_is_low_res = True
    if "y1" in df.columns and "y2" in df.columns:
        bhs = (df["y2"] - df["y1"]).dropna()
        if not bhs.empty:
            crop_is_low_res = bool(float(bhs.quantile(0.75)) < LOW_RES_BBOX_HEIGHT_PX)

    peak_frame_id = int(fids[0]) if len(fids) > 0 else 0
    if "x1" in df.columns and "x2" in df.columns and "y1" in df.columns and "y2" in df.columns:
        areas = ((df["x2"] - df["x1"]).clip(lower=0) * (df["y2"] - df["y1"]).clip(lower=0)).fillna(0.0)
        if not areas.empty:
            peak_frame_id = int(df.loc[areas.idxmax(), "frame_id"])

    has_coords = ("x_m" in df.columns) and ("y_m" in df.columns)
    if has_coords:
        cal_mask = df["x_m"].notna() & df["y_m"].notna()
    else:
        cal_mask = pd.Series([False] * samples)

    calibrated_ratio = round(float(cal_mask.mean()), 3) if samples > 0 else 0.0
    low_sample = bool(observed_s < 15.0)
    tier = compute_card_tier(calibrated_ratio, observed_s)

    cal_df = df[cal_mask].reset_index(drop=True)
    if len(cal_df) < 2:
        pos_lbl = _infer_position_label(role_mode, None, None, pitch_length, pitch_width, attack_right)
        return {
            "kind": "measured",
            "observed_s": observed_s,
            "observed_min": observed_min,
            "distance_m": None,
            "top_speed_kmh": None,
            "avg_speed_kmh": None,
            "work_rate_m_per_min": None,
            "sprints": None,
            "avg_position": None,
            "heatmap": None,
            "position_label": pos_lbl,
            "tier": tier,
            "reason": "uncalibrated",
            "peak_frame_id": peak_frame_id,
            "crop_is_low_res": crop_is_low_res,
            "quality": {
                "calibrated_ratio": calibrated_ratio,
                "samples": samples,
                "low_sample": low_sample,
            },
        }

    xs_raw = cal_df["x_m"].to_numpy(dtype=np.float64)
    ys_raw = cal_df["y_m"].to_numpy(dtype=np.float64)
    cfids = cal_df["frame_id"].to_numpy(dtype=np.float64)
    ts_arr = cal_df["time_s"].to_numpy(dtype=np.float64) if "time_s" in cal_df.columns else None

    kin = compute_clean_trajectory_kinematics(cfids, ts_arr, xs_raw, ys_raw, fps=float(fps))
    xs = kin["xs"]
    ys = kin["ys"]
    distance_m = kin["distance_m"]
    top_speed_kmh = kin["top_speed_kmh"]
    avg_speed_kmh = kin["avg_speed_kmh"]
    sprints = kin["sprints"]

    work_rate = (
        round(float(distance_m / (observed_s / 60.0)), 1)
        if observed_s >= MIN_WORK_RATE_SECONDS and distance_m is not None
        else None
    )

    avg_x = float(np.mean(xs))
    avg_y = float(np.mean(ys))
    pos_lbl = _infer_position_label(role_mode, avg_x, avg_y, pitch_length, pitch_width, attack_right)

    # 8 rows (Y) x 12 cols (X) normalized heatmap oriented so attacking direction is always +X (right)
    hm_x = xs if attack_right else (pitch_length - xs)
    hm_y = ys if attack_right else (pitch_width - ys)
    cols = np.clip((hm_x / max(1.0, pitch_length) * 12).astype(int), 0, 11)
    rows = np.clip((hm_y / max(1.0, pitch_width) * 8).astype(int), 0, 7)
    grid = np.zeros((8, 12), dtype=np.float64)
    np.add.at(grid, (rows, cols), 1.0)
    total_pts = float(grid.sum())
    if total_pts > 0:
        grid /= total_pts
    heatmap = [[round(float(v), 4) for v in row] for row in grid]

    return {
        "kind": "measured",
        "observed_s": observed_s,
        "observed_min": observed_min,
        "distance_m": distance_m,
        "top_speed_kmh": top_speed_kmh,
        "avg_speed_kmh": avg_speed_kmh,
        "work_rate_m_per_min": work_rate,
        "sprints": int(sprints),
        "avg_position": {"x_m": round(avg_x, 1), "y_m": round(avg_y, 1)},
        "heatmap": heatmap,
        "position_label": pos_lbl,
        "tier": tier,
        "reason": None,
        "peak_frame_id": peak_frame_id,
        "crop_is_low_res": crop_is_low_res,
        "quality": {
            "calibrated_ratio": calibrated_ratio,
            "samples": samples,
            "low_sample": low_sample,
        },
    }


_PERCENTILE_KEYS: tuple[tuple[str, str], ...] = (
    ("spd", "top_speed_kmh"),
    ("dst", "distance_m"),
    ("wrk", "work_rate_m_per_min"),
    ("spr", "sprints"),
    ("avg", "avg_speed_kmh"),
    ("min", "observed_s"),
)


def get_position_label_dict(code: Optional[str]) -> Optional[dict[str, str]]:
    """Map a position code (e.g. DM, CAM, CB, ST) to localized Arabic/English label dict."""
    if not code:
        return None
    up = str(code).upper().strip()
    if up in _POSITION_LABELS:
        ar, en = _POSITION_LABELS[up]
        return {"code": up, "ar": ar, "en": en}
    return None


def compute_match_percentiles(
    items: list[dict[str, Any]],
    min_pool_size: int = 3,
    min_observed_s: float = 0.0,
) -> dict[int, dict[str, Optional[int]]]:
    """Compute honest 0-99 match-pool percentiles separately for outfield vs GK.

    Withholds percentiles (returns None) whenever <min_pool_size valid players OR observed_s < min_observed_s.
    """
    result: dict[int, dict[str, Optional[int]]] = {
        int(it["track_id"]): {short_k: None for short_k, _ in _PERCENTILE_KEYS}
        for it in items
    }
    for gk_flag in (False, True):
        group = [
            it
            for it in items
            if bool(it.get("is_gk", False)) == gk_flag
            and float(it.get("observed_s") or 0.0) >= float(min_observed_s)
        ]
        for short_k, field_k in _PERCENTILE_KEYS:
            valid = [
                (int(it["track_id"]), float(it[field_k]))
                for it in group
                if it.get(field_k) is not None
            ]
            n = len(valid)
            if n < min_pool_size:
                continue
            vals = np.array([v for _, v in valid], dtype=np.float64)
            for tid, val in valid:
                below = int(np.sum(vals < val))
                equal = int(np.sum(vals == val))
                pct = int(round(((below + 0.5 * max(0, equal - 1)) / max(1, n - 1)) * 99.0))
                result[tid][short_k] = max(0, min(99, pct))
    return result
