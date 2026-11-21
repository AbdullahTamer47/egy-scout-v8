"""Physical telemetry: Savitzky-Golay smoothing, speed, distance, high-intensity runs and sprints."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.signal import savgol_filter

from core.config import HIR_SPEED_KMH, MAX_HUMAN_SPEED_KMH, SPRINT_MIN_DURATION_S, SPRINT_SPEED_KMH


def _contiguous_runs(frames: np.ndarray, max_gap: int) -> np.ndarray:
    """Label contiguous runs of frame ids (a new run starts when the gap exceeds max_gap)."""
    if len(frames) == 0:
        return np.array([], dtype=int)
    breaks = np.diff(frames) > max_gap
    return np.concatenate([[0], np.cumsum(breaks)])


def compute_player_kinematics(df_tracks: pd.DataFrame, fps: float = 25.0, stride: int = 1) -> pd.DataFrame:
    """
    Input columns: ['frame_id', 'track_id', 'x_m', 'y_m'] (rows with valid pitch coordinates only).
    Adds: x_smooth, y_smooth, vx_mps, vy_mps, speed_kmh, step_dist_m, cum_dist_m, is_hir, is_sprint, run_id.
    """
    if df_tracks.empty:
        return df_tracks.assign(x_smooth=[], y_smooth=[], vx_mps=[], vy_mps=[], speed_kmh=[], step_dist_m=[],
                                cum_dist_m=[], is_hir=[], is_sprint=[], run_id=[])
    dt = 1.0 / fps
    eff_fps = fps / max(1, stride)
    # 15-frame window at 25 fps (0.6 s); scaled for stride, always odd and >= 5
    window = int(round(15 / max(1, stride)))
    window = max(5, window | 1)
    out = []
    for track_id, group in df_tracks.groupby("track_id", sort=False):
        group = group.sort_values("frame_id").copy()
        frames = group["frame_id"].to_numpy()
        runs = _contiguous_runs(frames, max_gap=3 * max(1, stride))
        group["run_id"] = runs
        xs = group["x_m"].to_numpy(dtype=float)
        ys = group["y_m"].to_numpy(dtype=float)
        xsm, ysm = xs.copy(), ys.copy()
        for r in np.unique(runs):
            idx = np.where(runs == r)[0]
            if len(idx) >= window:
                xsm[idx] = savgol_filter(xs[idx], window_length=window, polyorder=2)
                ysm[idx] = savgol_filter(ys[idx], window_length=window, polyorder=2)
        group["x_smooth"] = np.clip(xsm, 0.0, 105.0)
        group["y_smooth"] = np.clip(ysm, 0.0, 68.0)

        dx = group["x_smooth"].diff().to_numpy()
        dy = group["y_smooth"].diff().to_numpy()
        gap = group["frame_id"].diff().to_numpy()
        new_run = np.concatenate([[True], np.diff(runs) != 0])
        dx[new_run], dy[new_run], gap[new_run] = 0.0, 0.0, 1.0
        gap = np.clip(gap, 1.0, None)
        step = np.sqrt(dx ** 2 + dy ** 2)
        speed_mps = step / (gap * dt)
        speed_kmh = speed_mps * 3.6
        valid = speed_kmh <= MAX_HUMAN_SPEED_KMH
        group["step_dist_m"] = np.where(valid, step, 0.0)
        sp = pd.Series(np.where(valid, speed_kmh, np.nan), index=group.index)
        group["speed_kmh"] = sp.interpolate(method="linear", limit_direction="both").fillna(0.0)
        vx = np.where(valid, dx / (gap * dt), np.nan)
        vy = np.where(valid, dy / (gap * dt), np.nan)
        group["vx_mps"] = pd.Series(vx, index=group.index).interpolate(limit_direction="both").fillna(0.0)
        group["vy_mps"] = pd.Series(vy, index=group.index).interpolate(limit_direction="both").fillna(0.0)
        group["cum_dist_m"] = group["step_dist_m"].cumsum()
        group["is_hir"] = (group["speed_kmh"] >= HIR_SPEED_KMH) & (group["speed_kmh"] < SPRINT_SPEED_KMH)
        group["is_sprint"] = group["speed_kmh"] >= SPRINT_SPEED_KMH
        out.append(group)
    res = pd.concat(out, ignore_index=True)
    res.attrs["effective_fps"] = eff_fps
    return res


def count_sustained_efforts(speed_kmh: np.ndarray, frames: np.ndarray, threshold: float, fps: float,
                            min_duration_s: float = SPRINT_MIN_DURATION_S) -> int:
    """Number of efforts where speed stays >= threshold for at least min_duration_s."""
    if len(speed_kmh) == 0:
        return 0
    max_gap = 6
    count = 0
    start: int | None = None
    last: int | None = None

    def _close() -> int:
        if start is not None and last is not None and (frames[last] - frames[start]) / fps >= min_duration_s:
            return 1
        return 0

    for i in range(len(speed_kmh)):
        if speed_kmh[i] >= threshold:
            if start is None or frames[i] - frames[last] > max_gap:
                count += _close()
                start = i
            last = i
        else:
            count += _close()
            start, last = None, None
    count += _close()
    return count


def physical_summary(group: pd.DataFrame, fps: float) -> dict:
    g = group.sort_values("frame_id")
    frames = g["frame_id"].to_numpy()
    speed = g["speed_kmh"].to_numpy()
    step = g["step_dist_m"].to_numpy()
    total = float(step.sum())
    return {
        "total_distance_m": total,
        "max_speed_kmh": float(np.nanmax(speed)) if len(speed) else 0.0,
        "avg_speed_kmh": float(np.nanmean(speed)) if len(speed) else 0.0,
        "hir_distance_m": float(step[(speed >= HIR_SPEED_KMH) & (speed < SPRINT_SPEED_KMH)].sum()),
        "sprint_distance_m": float(step[speed >= SPRINT_SPEED_KMH].sum()),
        "hir_count": count_sustained_efforts(speed, frames, HIR_SPEED_KMH, fps),
        "sprint_count": count_sustained_efforts(speed, frames, SPRINT_SPEED_KMH, fps),
    }
