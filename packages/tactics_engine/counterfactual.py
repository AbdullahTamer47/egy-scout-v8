"""Counterfactual 'What-If' Simulator & Spearman Dynamic Pitch Control (Section 10.3 & 16 Level 2).

Computes:
  - Vectorized 2D Spearman Dynamic Pitch Control (using velocity + reaction time + ball travel time)
  - Geometric Shot xG Cone (distance, visible goal angle, defender shadow blocking, GK reach)
  - Virtual Ghost Move simulation: move any defender by (dx_m, dy_m) and immediately recompute
    Pitch Control inside the danger zone and Shot xG!
"""
from __future__ import annotations

from typing import Any, Optional

import numpy as np


def compute_dynamic_pitch_control(
    players: list[dict[str, Any]],
    ball_xy: tuple[float, float] = (78.0, 34.0),
    attacking_team: str = "team_a",
    nx: int = 24,
    ny: int = 16,
    pitch_l: float = 105.0,
    pitch_w: float = 68.0,
    goal_x: Optional[float] = None,
) -> dict[str, Any]:
    """Compute Spearman-style Dynamic Pitch Control grid in [0, 1] for attacking_team."""
    target_goal_x = float(goal_x) if goal_x is not None else (pitch_l if attacking_team == "team_a" else 0.0)
    xs = np.linspace(pitch_l / (2 * nx), pitch_l - pitch_l / (2 * nx), nx, dtype=np.float32)
    ys = np.linspace(pitch_w / (2 * ny), pitch_w - pitch_w / (2 * ny), ny, dtype=np.float32)
    gx, gy = np.meshgrid(xs, ys)  # shape (ny, nx)

    bx, by = float(ball_xy[0]), float(ball_xy[1])
    t_ball = np.hypot(gx - bx, gy - by) / 15.0  # ~15 m/s average pass speed

    att_influence = np.zeros_like(gx, dtype=np.float32)
    def_influence = np.zeros_like(gx, dtype=np.float32)

    reaction_s = 0.55
    vmax = 5.5  # m/s sustainable sprint speed
    sigma = 0.45  # logistic steepness

    for p in players:
        if p.get("role") not in ("player", "goalkeeper"):
            continue
        team = p.get("team")
        if team not in ("team_a", "team_b"):
            continue
        px = float(p["x_m"])
        py = float(p["y_m"])
        vx = float(p.get("vx_ms", 0.0) or 0.0)
        vy = float(p.get("vy_ms", 0.0) or 0.0)

        # Reaction displacement
        rx = px + vx * reaction_s
        ry = py + vy * reaction_s
        t_arrive = reaction_s + np.hypot(gx - rx, gy - ry) / vmax
        # Probability player arrives before ball + logistic decay
        p_ctrl = 1.0 / (1.0 + np.exp((t_arrive - t_ball) / sigma))
        if team == attacking_team:
            att_influence += p_ctrl
        else:
            def_influence += p_ctrl

    total = att_influence + def_influence + 1e-5
    grid = np.clip(att_influence / total, 0.0, 1.0)

    # Box danger zone control (final 16.5m x central 40.32m on the ACTUAL defended goal side)
    if target_goal_x >= pitch_l * 0.5:
        box_mask = (gx >= (pitch_l - 16.5)) & (gy >= 13.84) & (gy <= 54.16)
    else:
        box_mask = (gx <= 16.5) & (gy >= 13.84) & (gy <= 54.16)
    box_control = float(grid[box_mask].mean()) if box_mask.any() else float(grid.mean())

    return {
        "nx": nx,
        "ny": ny,
        "attacking_team": attacking_team,
        "attack_goal_x": round(target_goal_x, 1),
        "overall_control_pct": round(float(grid.mean()) * 100.0, 1),
        "box_control_pct": round(box_control * 100.0, 1),
        "grid": np.round(grid, 3).tolist(),
    }


def compute_shot_xg(
    players: list[dict[str, Any]],
    ball_xy: tuple[float, float],
    attacking_team: str = "team_a",
    pitch_l: float = 105.0,
    pitch_w: float = 68.0,
    goal_x: Optional[float] = None,
) -> dict[str, Any]:
    """Compute geometric Expected Goals (xG) considering distance, goal angle, & defender occlusion."""
    target_goal_x = float(goal_x) if goal_x is not None else (pitch_l if attacking_team == "team_a" else 0.0)
    goal_y = pitch_w / 2.0
    bx, by = float(ball_xy[0]), float(ball_xy[1])

    dist = float(np.hypot(target_goal_x - bx, goal_y - by))
    # Visible angle to the 7.32m goal posts
    post1 = np.array([target_goal_x, goal_y - 3.66]) - np.array([bx, by])
    post2 = np.array([target_goal_x, goal_y + 3.66]) - np.array([bx, by])
    cos_a = float(
        np.clip(
            np.dot(post1, post2) / (np.linalg.norm(post1) * np.linalg.norm(post2) + 1e-6),
            -1.0,
            1.0,
        )
    )
    angle_rad = float(np.arccos(cos_a))

    # Count defending players inside the shot triangle cone + continuous defender pressure/blocking
    defending_team = "team_b" if attacking_team == "team_a" else "team_a"
    blockers = 0
    pressure_penalty = 0.0
    cone_occlusion = 0.0
    seg = np.array([target_goal_x - bx, goal_y - by])
    seg_len = float(np.linalg.norm(seg)) + 1e-6

    for p in players:
        if p.get("team") != defending_team:
            continue
        px, py = float(p["x_m"]), float(p["y_m"])
        d_ball = float(np.hypot(px - bx, py - by))
        # Smooth Gaussian close-down pressure (effective within ~6m of shooter)
        pressure_penalty += 0.65 * float(np.exp(-((d_ball / 3.2) ** 2)))

        # Projection along shot segment from ball (t=0) to goal (t=1)
        vec = np.array([px - bx, py - by])
        t_proj = float(np.dot(vec, seg)) / (seg_len * seg_len)
        if -0.05 <= t_proj <= 1.02:
            # 2D scalar cross product (NumPy 2.x safe): |seg_x * dy - seg_y * dx| / |seg|
            perp = abs(float(seg[0]) * (py - by) - float(seg[1]) * (px - bx)) / seg_len
            if perp <= 1.8:
                blockers += 1
            cone_occlusion += 0.55 * float(np.exp(-((perp / 2.2) ** 2)))

    # Calibrated continuous logistic xG (uses effective attack distance so midfield simulations
    # also reflect real chance-creation threat sensitivity to defender positioning)
    eff_dist = min(dist, 24.0)
    eff_angle = max(angle_rad, 0.22)
    logit = 0.25 - 0.085 * eff_dist + 2.4 * eff_angle - 0.55 * cone_occlusion - pressure_penalty
    xg = float(np.clip(1.0 / (1.0 + np.exp(-logit)), 0.02, 0.92))
    return {
        "xg": round(xg, 3),
        "goal_x": round(target_goal_x, 1),
        "distance_m": round(dist, 2),
        "goal_angle_deg": round(float(np.rad2deg(angle_rad)), 1),
        "blockers_in_cone": blockers,
    }


def simulate_ghost_move(
    players: list[dict[str, Any]],
    ball_xy: tuple[float, float],
    target_track_id: int,
    dx_m: float,
    dy_m: float,
    attacking_team: str = "team_a",
    pitch_l: float = 105.0,
    pitch_w: float = 68.0,
    goal_x: Optional[float] = None,
) -> dict[str, Any]:
    """Move one defender by (dx_m, dy_m) and return Before vs. After Pitch Control & xG."""
    before_pc = compute_dynamic_pitch_control(
        players, ball_xy, attacking_team, pitch_l=pitch_l, pitch_w=pitch_w, goal_x=goal_x
    )
    before_xg = compute_shot_xg(
        players, ball_xy, attacking_team, pitch_l=pitch_l, pitch_w=pitch_w, goal_x=goal_x
    )

    modified = []
    moved_from = None
    moved_to = None
    for p in players:
        cp = dict(p)
        if int(cp.get("track_id", -1)) == int(target_track_id):
            moved_from = [round(float(cp["x_m"]), 2), round(float(cp["y_m"]), 2)]
            nx = float(np.clip(float(cp["x_m"]) + dx_m, 0.0, pitch_l))
            ny = float(np.clip(float(cp["y_m"]) + dy_m, 0.0, pitch_w))
            cp["x_m"] = nx
            cp["y_m"] = ny
            moved_to = [round(nx, 2), round(ny, 2)]
        modified.append(cp)

    after_pc = compute_dynamic_pitch_control(
        modified, ball_xy, attacking_team, pitch_l=pitch_l, pitch_w=pitch_w, goal_x=goal_x
    )
    after_xg = compute_shot_xg(
        modified, ball_xy, attacking_team, pitch_l=pitch_l, pitch_w=pitch_w, goal_x=goal_x
    )

    return {
        "target_track_id": int(target_track_id),
        "dx_m": round(float(dx_m), 2),
        "dy_m": round(float(dy_m), 2),
        "moved_from": moved_from,
        "moved_to": moved_to,
        "before_box_control_pct": before_pc["box_control_pct"],
        "after_box_control_pct": after_pc["box_control_pct"],
        "delta_box_control_pct": round(after_pc["box_control_pct"] - before_pc["box_control_pct"], 1),
        "before_xg": before_xg["xg"],
        "after_xg": after_xg["xg"],
        "delta_xg": round(after_xg["xg"] - before_xg["xg"], 3),
        "after_pitch_control": after_pc,
    }


def find_optimal_ghost_move(
    players: list[dict[str, Any]],
    ball_xy: tuple[float, float],
    target_track_id: int,
    attacking_team: str = "team_a",
    radius_m: float = 8.0,
    goal_x: Optional[float] = None,
) -> dict[str, Any]:
    """Search 25 counterfactual positions within +-radius_m to find the highest defensive impact."""
    best: Optional[dict[str, Any]] = None
    best_score = 1e9
    grid_vals = np.linspace(-radius_m, radius_m, 5)
    for dx in grid_vals:
        for dy in grid_vals:
            if abs(dx) < 0.5 and abs(dy) < 0.5:
                continue
            res = simulate_ghost_move(
                players, ball_xy, target_track_id, float(dx), float(dy), attacking_team, goal_x=goal_x
            )
            score = res["after_xg"] * 100.0 + res["after_box_control_pct"] * 0.35
            if score < best_score:
                best_score = score
                best = res
    return best or simulate_ghost_move(
        players, ball_xy, target_track_id, 0.0, 0.0, attacking_team, goal_x=goal_x
    )
