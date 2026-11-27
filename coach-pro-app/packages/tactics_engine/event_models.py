"""Lightweight Open-Formula xPass & OBV math models (zero pandas) for standalone Coach Pro."""
from __future__ import annotations

import math
import numpy as np

XT_GRID_12X8 = np.array(
    [
        [0.00638, 0.00779, 0.00845, 0.00978, 0.01126, 0.01248, 0.01474, 0.01745, 0.02122, 0.02756, 0.03485, 0.03792],
        [0.00750, 0.00879, 0.00942, 0.01059, 0.01215, 0.01385, 0.01612, 0.01870, 0.02402, 0.02953, 0.04067, 0.04648],
        [0.00888, 0.00978, 0.01001, 0.01110, 0.01269, 0.01429, 0.01690, 0.01997, 0.02448, 0.03511, 0.05731, 0.07162],
        [0.00941, 0.01083, 0.01017, 0.01132, 0.01263, 0.01485, 0.01690, 0.02000, 0.02507, 0.03897, 0.07560, 0.14500],
        [0.00941, 0.01083, 0.01017, 0.01132, 0.01263, 0.01485, 0.01690, 0.02000, 0.02507, 0.03897, 0.07560, 0.14500],
        [0.00888, 0.00978, 0.01001, 0.01110, 0.01269, 0.01429, 0.01690, 0.01997, 0.02448, 0.03511, 0.05731, 0.07162],
        [0.00750, 0.00879, 0.00942, 0.01059, 0.01215, 0.01385, 0.01612, 0.01870, 0.02402, 0.02953, 0.04067, 0.04648],
        [0.00638, 0.00779, 0.00845, 0.00978, 0.01126, 0.01248, 0.01474, 0.01745, 0.02122, 0.02756, 0.03485, 0.03792],
    ],
    dtype=np.float32,
)


def compute_xt_value(x_m: float, y_m: float, pitch_l: float = 105.0, pitch_w: float = 68.0) -> float:
    ix = int(np.clip(np.floor((x_m / pitch_l) * 12.0), 0, 11))
    iy = int(np.clip(np.floor((y_m / pitch_w) * 8.0), 0, 7))
    return float(XT_GRID_12X8[iy, ix])


def _sigmoid(z: float) -> float:
    z = float(np.clip(z, -12.0, 12.0))
    return 1.0 / (1.0 + math.exp(-z))


def compute_xpass_probability(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    attack_right: bool,
    passer_pressure_m: float,
    lane_defenders: int,
) -> float:
    dist = math.hypot(x2 - x1, y2 - y1)
    prog_dx = (x2 - x1) if attack_right else (x1 - x2)
    target_att_x = x2 if attack_right else (105.0 - x2)
    logit = (
        2.65
        - 0.052 * dist
        - 0.028 * max(0.0, prog_dx)
        - 0.85 * lane_defenders
        - (0.65 if passer_pressure_m < 2.2 else 0.0)
        - (0.45 if target_att_x >= 88.5 and 13.8 <= y2 <= 54.2 else 0.0)
    )
    return round(float(np.clip(_sigmoid(logit), 0.08, 0.97)), 3)


def _state_score_concede_probs(x_m: float, y_m: float, attack_right: bool) -> tuple[float, float]:
    ax = x_m if attack_right else (105.0 - x_m)
    p_score = compute_xt_value(ax, y_m)
    own_danger = compute_xt_value(105.0 - ax, y_m) * 0.42
    return float(p_score), float(own_danger)


def compute_obv_delta(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    attack_right: bool,
    retained_possession: bool = True,
) -> dict[str, float]:
    ps0, pc0 = _state_score_concede_probs(x1, y1, attack_right)
    if retained_possession:
        ps1, pc1 = _state_score_concede_probs(x2, y2, attack_right)
    else:
        opp_ps, _ = _state_score_concede_probs(x2, y2, not attack_right)
        ps1, pc1 = 0.0, opp_ps
    obv = (ps1 - ps0) - (pc1 - pc0)
    return {
        "obv": round(float(obv), 4),
        "delta_score": round(float(ps1 - ps0), 4),
        "delta_concede": round(float(pc1 - pc0), 4),
    }


def _count_defenders_in_lane(
    x1: float, y1: float, x2: float, y2: float, defenders_xy: list[tuple[float, float]], corridor_m: float = 2.6
) -> int:
    vx, vy = x2 - x1, y2 - y1
    seg_len2 = vx * vx + vy * vy
    if seg_len2 < 1.0:
        return 0
    cnt = 0
    for dx, dy in defenders_xy:
        t = ((dx - x1) * vx + (dy - y1) * vy) / seg_len2
        if 0.08 <= t <= 0.92:
            proj_x = x1 + t * vx
            proj_y = y1 + t * vy
            if math.hypot(dx - proj_x, dy - proj_y) <= corridor_m:
                cnt += 1
    return cnt
