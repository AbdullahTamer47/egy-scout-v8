"""Wave 5 Tactical Innovation Lab — 2D Kinematic Sandbox & Set-Piece Self-Play Optimizer (Sec 16 L4)."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np


@dataclass
class SetPieceRoutineResult:
    scenario: str
    simulations_run: int
    baseline_goal_prob_pct: float
    optimized_goal_prob_pct: float
    uplift_pct_points: float
    target_zone_xy: list[float]
    decoy_run_vector: list[float]
    human_realism_constraints: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def simulate_corner_routine(
    target_xy: tuple[float, float],
    decoy_shift_xy: tuple[float, float],
    n_rollouts: int = 500,
    seed: int = 42,
    reaction_time_s: float = 0.25,
    pass_sigma_m: float = 1.15,
) -> float:
    """Run vectorized 2D physical corner-kick rollouts with 250ms human reaction & pass noise."""
    rng = np.random.default_rng(seed)
    tx, ty = float(target_xy[0]), float(target_xy[1])
    dx_decoy, dy_decoy = float(decoy_shift_xy[0]), float(decoy_shift_xy[1])

    # Baseline zonal defenders in 6-yard / penalty spot region
    defenders = np.array(
        [[99.5, 31.5], [99.5, 36.5], [96.0, 33.5], [94.5, 38.0], [103.5, 34.0]],
        dtype=np.float64,
    )
    # Decoy runner pulls nearest zonal defender slightly after human 250ms reaction delay
    pull_strength = np.clip(np.hypot(dx_decoy, dy_decoy) / 5.0, 0.0, 1.0) * 1.45
    defenders_shifted = defenders.copy()
    defenders_shifted[2, 0] += np.clip(dx_decoy * 0.28, -1.8, 1.8)
    defenders_shifted[2, 1] += np.clip(dy_decoy * 0.35, -2.2, 2.2)

    # Sample noisy ball landing locations around target_xy
    land_x = rng.normal(tx, pass_sigma_m, size=n_rollouts)
    land_y = rng.normal(ty, pass_sigma_m, size=n_rollouts)
    flight_time_s = 1.35

    # Attacking target runner starts 5m away and sprints at 7.4 m/s (with 0s cue since pre-planned)
    att_arrival = rng.normal(1.22, 0.14, size=n_rollouts)
    # Nearest defender reacts after 250ms reaction time at 6.9 m/s
    d_dists = np.min(
        np.hypot(
            land_x[:, None] - defenders_shifted[None, :, 0],
            land_y[:, None] - defenders_shifted[None, :, 1],
        ),
        axis=1,
    )
    def_arrival = reaction_time_s + (d_dists / 6.9) + rng.normal(0.0, 0.08, size=n_rollouts)

    attacker_wins = att_arrival < def_arrival
    goal_dist = np.hypot(105.0 - land_x, 34.0 - land_y)
    # Conversion probability given clean header/volley inside box
    header_xg = np.clip(0.28 * np.exp(-((goal_dist - 6.5) / 7.0) ** 2) * (1.0 + 0.15 * pull_strength), 0.01, 0.42)
    scores = attacker_wins & (rng.random(n_rollouts) < header_xg)
    return float(scores.mean())


def optimize_set_piece_self_play(
    scenario: str = "right_corner_inswinger",
    n_candidates: int = 24,
    rollouts_per_candidate: int = 400,
    seed: int = 42,
) -> SetPieceRoutineResult:
    """Optimize a corner routine via evolutionary / Monte-Carlo search under human realism limits."""
    baseline_p = simulate_corner_routine((96.0, 34.0), (0.0, 0.0), n_rollouts=rollouts_per_candidate, seed=seed)

    rng = np.random.default_rng(seed + 1)
    best_p = baseline_p
    best_target = [96.0, 34.0]
    best_decoy = [0.0, 0.0]

    for idx in range(n_candidates):
        cand_tx = float(rng.uniform(93.0, 101.5))
        cand_ty = float(rng.uniform(28.0, 40.0))
        cand_dx = float(rng.uniform(-4.5, 4.5))
        cand_dy = float(rng.uniform(-5.0, 5.0))
        p = simulate_corner_routine(
            (cand_tx, cand_ty),
            (cand_dx, cand_dy),
            n_rollouts=rollouts_per_candidate,
            seed=seed + idx + 10,
        )
        if p > best_p:
            best_p = p
            best_target = [round(cand_tx, 2), round(cand_ty, 2)]
            best_decoy = [round(cand_dx, 2), round(cand_dy, 2)]

    return SetPieceRoutineResult(
        scenario=scenario,
        simulations_run=n_candidates * rollouts_per_candidate,
        baseline_goal_prob_pct=round(baseline_p * 100.0, 2),
        optimized_goal_prob_pct=round(best_p * 100.0, 2),
        uplift_pct_points=round((best_p - baseline_p) * 100.0, 2),
        target_zone_xy=best_target,
        decoy_run_vector=best_decoy,
        human_realism_constraints={
            "reaction_time_ms": 250,
            "pass_error_sigma_m": 1.15,
            "max_sprint_ms": 7.4,
        },
    )
