"""Ball Tracker: SAHI Tile Slicing + Kalman Physics + Trajectory Inpainting + 3D Arc (Wave 2, Sec 9.3)."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

import numpy as np


def generate_sahi_tiles(
    width: int, height: int, tile_w: int = 640, tile_h: int = 384, overlap: float = 0.2
) -> list[tuple[int, int, int, int]]:
    """Generate overlapping (x1, y1, x2, y2) SAHI tiles for tiny 8-16px broadcast ball detection."""
    step_x = max(1, int(tile_w * (1.0 - overlap)))
    step_y = max(1, int(tile_h * (1.0 - overlap)))
    tiles: list[tuple[int, int, int, int]] = []
    for y in range(0, height, step_y):
        y2 = min(height, y + tile_h)
        y1 = max(0, y2 - tile_h)
        for x in range(0, width, step_x):
            x2 = min(width, x + tile_w)
            x1 = max(0, x2 - tile_w)
            tiles.append((x1, y1, x2, y2))
            if x2 == width:
                break
        if y2 == height:
            break
    return tiles


@dataclass
class BallState:
    frame_id: int
    time_s: float
    x_m: float
    y_m: float
    z_m: float  # estimated ballistic height in metres
    vx_ms: float
    vy_ms: float
    inpainted: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class KalmanBallTracker:
    """2D constant-velocity Kalman filter with occlusion inpainting & 3D ballistic arc estimation."""

    def __init__(self, dt: float = 0.04, process_noise: float = 2.0, meas_noise: float = 0.6):
        self.default_dt = dt
        self.dt = dt
        self.process_noise = process_noise
        self.meas_noise = meas_noise
        self.H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=np.float64)
        self.Q = np.eye(4, dtype=np.float64) * process_noise
        self.R = np.eye(2, dtype=np.float64) * meas_noise
        self.reset()

    def reset(self) -> None:
        self.dt = self.default_dt
        self.x = np.zeros((4, 1), dtype=np.float64)  # [x, y, vx, vy]
        self.P = np.eye(4, dtype=np.float64) * 25.0
        self.F = np.array(
            [[1, 0, self.dt, 0], [0, 1, 0, self.dt], [0, 0, 1, 0], [0, 0, 0, 1]],
            dtype=np.float64,
        )
        self._initialized = False
        self._obs_count = 0

    def set_dt(self, dt_s: float) -> None:
        self.dt = max(0.02, float(dt_s))
        self.F[0, 2] = self.dt
        self.F[1, 3] = self.dt

    def predict(self) -> tuple[float, float, float, float]:
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q
        return float(self.x[0, 0]), float(self.x[1, 0]), float(self.x[2, 0]), float(self.x[3, 0])

    def update(self, meas_xy: Optional[tuple[float, float]]) -> tuple[float, float, float, float]:
        if meas_xy is None:
            return self.predict() if self._initialized else (52.5, 34.0, 0.0, 0.0)
        z = np.array([[float(meas_xy[0])], [float(meas_xy[1])]], dtype=np.float64)
        if not self._initialized:
            self.x[0, 0], self.x[1, 0] = z[0, 0], z[1, 0]
            self._initialized = True
            self._obs_count = 1
            return float(self.x[0, 0]), float(self.x[1, 0]), 0.0, 0.0
        if self._obs_count == 1:
            # Textbook 2-point velocity initialization eliminates cold-start lag
            self.x[2, 0] = (z[0, 0] - self.x[0, 0]) / max(self.dt, 1e-3)
            self.x[3, 0] = (z[1, 0] - self.x[1, 0]) / max(self.dt, 1e-3)
            self.x[0, 0], self.x[1, 0] = z[0, 0], z[1, 0]
            self._obs_count = 2
            return float(self.x[0, 0]), float(self.x[1, 0]), float(self.x[2, 0]), float(self.x[3, 0])
        self._obs_count += 1

        self.predict()
        y = z - (self.H @ self.x)
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.x = self.x + K @ y
        self.P = (np.eye(4) - K @ self.H) @ self.P
        return float(self.x[0, 0]), float(self.x[1, 0]), float(self.x[2, 0]), float(self.x[3, 0])


def track_and_inpaint_ball(
    detections: list[tuple[int, float, Optional[tuple[float, float]]]],
    max_gap_frames: int = 12,
    gravity: float = 9.81,
    max_speed_mps: float = 38.0,
    max_gap_s: float = 0.85,
) -> list[BallState]:
    """Filter raw ball detections, reject teleports, reset across cuts, & estimate 3D arc."""
    if not detections:
        return []
    dt_init = max(0.02, detections[1][1] - detections[0][1]) if len(detections) >= 2 else 0.04
    kf = KalmanBallTracker(dt=min(0.5, dt_init))

    states: list[BallState] = []
    gap = 0
    prev_ts: Optional[float] = None
    last_obs_xy: Optional[tuple[float, float]] = None
    last_obs_ts: Optional[float] = None

    for fid, ts, xy in detections:
        ts_f = float(ts)
        if prev_ts is not None:
            dt_step = ts_f - prev_ts
            if dt_step > max_gap_s or gap > max_gap_frames:
                kf.reset()
                gap = 0
                last_obs_xy = None
                last_obs_ts = None
            else:
                kf.set_dt(max(0.02, min(0.5, dt_step)))
        prev_ts = ts_f

        meas_xy = xy
        if meas_xy is not None and last_obs_xy is not None and last_obs_ts is not None:
            dt_obs = max(0.04, ts_f - last_obs_ts)
            dist_obs = float(np.hypot(float(meas_xy[0]) - last_obs_xy[0], float(meas_xy[1]) - last_obs_xy[1]))
            if dt_obs <= 0.65 and (dist_obs / dt_obs) > max_speed_mps:
                # Physical spike outlier (e.g. reflection or wrong ball >136 km/h) -> treat as missing
                meas_xy = None

        if meas_xy is not None:
            x, y, vx, vy = kf.update(meas_xy)
            last_obs_xy = (float(meas_xy[0]), float(meas_xy[1]))
            last_obs_ts = ts_f
            gap = 0
            inpainted = False
        else:
            gap += 1
            if gap <= max_gap_frames and kf._initialized:
                x, y, vx, vy = kf.update(None)
                inpainted = True
            else:
                continue

        spd_raw = float(np.hypot(vx, vy))
        if spd_raw > 35.0 and spd_raw > 1e-6:
            scale = 35.0 / spd_raw
            vx *= scale
            vy *= scale

        states.append(
            BallState(
                frame_id=int(fid),
                time_s=round(ts_f, 3),
                x_m=round(float(np.clip(x, 0.0, 105.0)), 2),
                y_m=round(float(np.clip(y, 0.0, 68.0)), 2),
                z_m=0.0,
                vx_ms=round(float(vx), 2),
                vy_ms=round(float(vy), 2),
                inpainted=inpainted,
            )
        )

    # Estimate 3D ballistic height arc for high-speed airborne segments (speed >= 14 m/s for >= 0.35s)
    i = 0
    while i < len(states):
        spd = float(np.hypot(states[i].vx_ms, states[i].vy_ms))
        if spd >= 14.0:
            j = i + 1
            while (
                j < len(states)
                and (states[j].time_s - states[j - 1].time_s) <= 0.5
                and float(np.hypot(states[j].vx_ms, states[j].vy_ms)) >= 12.0
            ):
                j += 1
            flight_dur = states[j - 1].time_s - states[i].time_s
            if flight_dur >= 0.35:
                t0 = states[i].time_s
                vz0 = 0.5 * gravity * flight_dur
                for k in range(i, j):
                    tk = states[k].time_s - t0
                    z = max(0.0, vz0 * tk - 0.5 * gravity * tk * tk)
                    states[k].z_m = round(min(18.0, z), 2)
            i = j
        else:
            i += 1

    return states
