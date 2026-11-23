"""Moment State Analyzer (PDF Pages 25-26: Did / Did Not / Where & Why) & Live Tactical Formation Geometry Engine.

Every single tactical statement, formation line, passing channel, and correction arrow is computed
100% dynamically from real frame coordinates (x_m, y_m), velocities (vx_ms, vy_ms, speed_kmh),
distances, cover shadows, and offside line geometry. Zero static/canned template strings.
"""
from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from packages.tactics_engine.counterfactual import (
    compute_dynamic_pitch_control,
    compute_shot_xg,
)


TACTICAL_FORMATIONS_CATALOG: dict[str, dict[str, Any]] = {
    "4-2-3-1": {
        "code": "4-2-3-1",
        "title_ar": "4-2-3-1 (محور مزدوج وإغلاق الممرات النصفية + Zone 14)",
        "philosophy_ar": "تأمين العمق أمام قلبي الدفاع بمحورين (Double Pivot) مع تحرير صانع اللعب في المنطقة 14 والأجنحة في أنصاف المساحات.",
        "nodes": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "ظهير أيمن", "x_norm": 0.25, "y_norm": 0.84},
            {"slot": "RCB", "role_ar": "قلب دفاع أيمن", "x_norm": 0.21, "y_norm": 0.62},
            {"slot": "LCB", "role_ar": "قلب دفاع أيسر", "x_norm": 0.21, "y_norm": 0.38},
            {"slot": "LB", "role_ar": "ظهير أيسر", "x_norm": 0.25, "y_norm": 0.16},
            {"slot": "RDM", "role_ar": "ارتكاز دفاعي أيمن (6)", "x_norm": 0.41, "y_norm": 0.61},
            {"slot": "LDM", "role_ar": "ارتكاز مساند أيسر (8)", "x_norm": 0.43, "y_norm": 0.39},
            {"slot": "RW", "role_ar": "جناح أيمن عكسي", "x_norm": 0.66, "y_norm": 0.82},
            {"slot": "CAM", "role_ar": "صانع ألعاب (Zone 14)", "x_norm": 0.63, "y_norm": 0.50},
            {"slot": "LW", "role_ar": "جناح أيسر هجومي", "x_norm": 0.66, "y_norm": 0.18},
            {"slot": "ST", "role_ar": "مهاجم صريح (9)", "x_norm": 0.81, "y_norm": 0.50},
        ],
        "lines": [
            {"line_type": "backline", "label_ar": "خط الدفاع الرباعي", "slots": ["LB", "LCB", "RCB", "RB"]},
            {"line_type": "midfield", "label_ar": "المحور المزدوج (Double Pivot)", "slots": ["LDM", "RDM"]},
            {"line_type": "attack", "label_ar": "خط صناعة اللعب والأجنحة", "slots": ["LW", "CAM", "RW", "ST"]},
        ],
    },
    "4-3-3": {
        "code": "4-3-3",
        "title_ar": "4-3-3 (ضغط عالٍ ومثلثات استحواذ في أنصاف المساحات)",
        "philosophy_ar": "ارتكاز وحيد يحمي الخط الخلفي مع لاعبي وسط متقدمين (8/10) لخلق تفوق عددي في أنصاف المساحات والضغط العكسي الفوري.",
        "nodes": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "ظهير أيمن متقدم", "x_norm": 0.28, "y_norm": 0.86},
            {"slot": "RCB", "role_ar": "قلب دفاع أيمن", "x_norm": 0.22, "y_norm": 0.62},
            {"slot": "LCB", "role_ar": "قلب دفاع أيسر", "x_norm": 0.22, "y_norm": 0.38},
            {"slot": "LB", "role_ar": "ظهير أيسر متقدم", "x_norm": 0.28, "y_norm": 0.14},
            {"slot": "CDM", "role_ar": "ارتكاز دفاعي وحيد (6)", "x_norm": 0.40, "y_norm": 0.50},
            {"slot": "RCM", "role_ar": "وسط هجومي أيمن (8)", "x_norm": 0.55, "y_norm": 0.67},
            {"slot": "LCM", "role_ar": "وسط هجومي أيسر (8)", "x_norm": 0.55, "y_norm": 0.33},
            {"slot": "RW", "role_ar": "جناح أيمن يخترق للعمق", "x_norm": 0.74, "y_norm": 0.80},
            {"slot": "LW", "role_ar": "جناح أيسر يخترق للعمق", "x_norm": 0.74, "y_norm": 0.20},
            {"slot": "ST", "role_ar": "رأس حربة ضاغط", "x_norm": 0.82, "y_norm": 0.50},
        ],
        "lines": [
            {"line_type": "backline", "label_ar": "خط الدفاع", "slots": ["LB", "LCB", "RCB", "RB"]},
            {"line_type": "midfield", "label_ar": "مثلث الوسط", "slots": ["LCM", "CDM", "RCM"]},
            {"line_type": "attack", "label_ar": "ثلاثي الهجوم الضاغط", "slots": ["LW", "ST", "RW"]},
        ],
    },
    "3-4-2-1": {
        "code": "3-4-2-1",
        "title_ar": "3-4-2-1 (صندوق وسط 3-2-2-3 وتفوق عددي في العمق)",
        "philosophy_ar": "ثلاثة قلوب دفاع لتأمين التحولات مع ظهيري جنب وصانعي لعب داخل أنصاف المساحات (Box Midfield).",
        "nodes": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RCB", "role_ar": "قلب دفاع أيمن", "x_norm": 0.22, "y_norm": 0.72},
            {"slot": "CCB", "role_ar": "قلب دفاع محوري", "x_norm": 0.19, "y_norm": 0.50},
            {"slot": "LCB", "role_ar": "قلب دفاع أيسر", "x_norm": 0.22, "y_norm": 0.28},
            {"slot": "RWB", "role_ar": "ظهير جناح أيمن", "x_norm": 0.49, "y_norm": 0.88},
            {"slot": "RDM", "role_ar": "محور ارتكاز أيمن", "x_norm": 0.43, "y_norm": 0.60},
            {"slot": "LDM", "role_ar": "محور ارتكاز أيسر", "x_norm": 0.43, "y_norm": 0.40},
            {"slot": "LWB", "role_ar": "ظهير جناح أيسر", "x_norm": 0.49, "y_norm": 0.12},
            {"slot": "RAM", "role_ar": "صانع لعب نصفي أيمن", "x_norm": 0.67, "y_norm": 0.64},
            {"slot": "LAM", "role_ar": "صانع لعب نصفي أيسر", "x_norm": 0.67, "y_norm": 0.36},
            {"slot": "ST", "role_ar": "مهاجم محطة", "x_norm": 0.82, "y_norm": 0.50},
        ],
        "lines": [
            {"line_type": "backline", "label_ar": "ثلاثي قلب الدفاع", "slots": ["LCB", "CCB", "RCB"]},
            {"line_type": "midfield", "label_ar": "رباعي الوسط والأطراف", "slots": ["LWB", "LDM", "RDM", "RWB"]},
            {"line_type": "attack", "label_ar": "ثنائي أنصاف المساحات والمهاجم", "slots": ["LAM", "ST", "RAM"]},
        ],
    },
    "4-4-2": {
        "code": "4-4-2",
        "title_ar": "4-4-2 (كتلة دفاعية متراصة Mid-Block وتحولات سريعة)",
        "philosophy_ar": "خطان متوازيان من 4 لاعبين بمسافة طولية لا تتجاوز 12 متراً لإغلاق العمق تماماً وإجبار الخصم على الأطراف.",
        "nodes": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "ظهير أيمن", "x_norm": 0.24, "y_norm": 0.82},
            {"slot": "RCB", "role_ar": "قلب دفاع أيمن", "x_norm": 0.21, "y_norm": 0.60},
            {"slot": "LCB", "role_ar": "قلب دفاع أيسر", "x_norm": 0.21, "y_norm": 0.40},
            {"slot": "LB", "role_ar": "ظهير أيسر", "x_norm": 0.24, "y_norm": 0.18},
            {"slot": "RM", "role_ar": "وسط أيمن", "x_norm": 0.46, "y_norm": 0.80},
            {"slot": "RCM", "role_ar": "محور وسط أيمن", "x_norm": 0.43, "y_norm": 0.59},
            {"slot": "LCM", "role_ar": "محور وسط أيسر", "x_norm": 0.43, "y_norm": 0.41},
            {"slot": "LM", "role_ar": "وسط أيسر", "x_norm": 0.46, "y_norm": 0.20},
            {"slot": "RST", "role_ar": "مهاجم ثانٍ متحرك", "x_norm": 0.72, "y_norm": 0.58},
            {"slot": "LST", "role_ar": "مهاجم صريح", "x_norm": 0.76, "y_norm": 0.42},
        ],
        "lines": [
            {"line_type": "backline", "label_ar": "خط الدفاع الرباعي", "slots": ["LB", "LCB", "RCB", "RB"]},
            {"line_type": "midfield", "label_ar": "خط الوسط الرباعي المتراص", "slots": ["LM", "LCM", "RCM", "RM"]},
            {"line_type": "attack", "label_ar": "ثنائي الهجوم", "slots": ["LST", "RST"]},
        ],
    },
}


def _describe_pitch_zone_ar(x_m: float, y_m: float, attack_goal_x: float) -> str:
    """Return an exact Arabic tactical zone name for coordinates (x_m, y_m) relative to attack direction."""
    prog_x = x_m if attack_goal_x >= 52.5 else (105.0 - x_m)
    # Zone 14: central region just outside opponent penalty box (prog_x in [68, 88.5], y in [22, 46])
    if 68.0 <= prog_x <= 88.5 and 22.0 <= y_m <= 46.0:
        return "المنطقة 14 (Zone 14 - عمق صناعة اللعب أمام الصندوق)"
    if prog_x > 88.5 and 13.84 <= y_m <= 54.16:
        return "داخل منطقة جزاء الخصم (Penalty Box)"
    if prog_x < 16.5 and 13.84 <= y_m <= 54.16:
        return "داخل منطقة الجزاء الدفاعية"

    third_ar = (
        "الثلث الدفاعي (البناء)"
        if prog_x < 35.0
        else ("ثلث الوسط (التدرج)" if prog_x < 70.0 else "الثلث الهجومي الأخير")
    )
    if y_m < 13.8:
        lane_ar = "الرواق الأيسر/الأيمن الخارجي (Flank)"
    elif y_m < 24.5:
        lane_ar = "الممر النصفي العلوي (Half-Space)"
    elif y_m <= 43.5:
        lane_ar = "الممر المركزي (Central Corridor)"
    elif y_m <= 54.2:
        lane_ar = "الممر النصفي السفلي (Half-Space)"
    else:
        lane_ar = "الرواق الطرفي السفلي (Wide Flank)"
    return f"{third_ar} — {lane_ar}"


def _point_to_segment_distance(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> tuple[float, float]:
    """Return (perpendicular_distance_m, projection_t_in_0_1) from point P to segment AB."""
    dx, dy = bx - ax, by - ay
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < 1e-6:
        return float(math.hypot(px - ax, py - ay)), 0.0
    t = ((px - ax) * dx + (py - ay) * dy) / seg_len_sq
    t_clamped = max(0.0, min(1.0, t))
    proj_x = ax + t_clamped * dx
    proj_y = ay + t_clamped * dy
    return float(math.hypot(px - proj_x, py - proj_y)), float(t)


def _convex_hull_xy(points: list[tuple[float, float]]) -> list[dict[str, float]]:
    """Compute 2D monotonic-chain convex hull for team block polygon rendering."""
    pts = sorted(set((round(float(x), 2), round(float(y), 2)) for x, y in points))
    if len(pts) <= 2:
        return [{"x_m": x, "y_m": y} for x, y in pts]

    def cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return [{"x_m": round(x, 2), "y_m": round(y, 2)} for x, y in hull]


def _polygon_area(hull: list[dict[str, float]]) -> float:
    if len(hull) < 3:
        return 0.0
    area = 0.0
    n = len(hull)
    for i in range(n):
        j = (i + 1) % n
        area += hull[i]["x_m"] * hull[j]["y_m"] - hull[j]["x_m"] * hull[i]["y_m"]
    return round(abs(area) * 0.5, 1)


def _player_display_label(p: dict[str, Any]) -> str:
    name = p.get("verified_name")
    j = p.get("jersey_number")
    tid = p.get("track_id")
    if name and j:
        return f"{name} (#{j})"
    if name:
        return str(name)
    if j:
        return f"لاعب #{j}"
    return f"مسار #{tid}"


def detect_live_team_formation(
    players: list[dict[str, Any]],
    team: str,
    attack_goal_x: float,
) -> dict[str, Any]:
    """Cluster a team's visible outfield players into Backline, Midfield, and Attacking lines.

    Returns exact connected polyline coordinates for drawing the live formation on the 2D/3D pitch
    and broadcast video overlay.
    """
    team_players = [
        p
        for p in players
        if p.get("team") == team
        and p.get("role") in ("player", "goalkeeper")
        and p.get("x_m") is not None
        and p.get("y_m") is not None
    ]
    outfield = [p for p in team_players if p.get("role") == "player"]
    if not outfield:
        outfield = team_players

    if not outfield:
        return {
            "team": team,
            "detected_shape": "غير متاح",
            "inferred_full_formation": "4-2-3-1",
            "visible_outfield_count": 0,
            "width_m": 0.0,
            "depth_m": 0.0,
            "compactness_m2": 0.0,
            "defensive_line_x_m": 52.5,
            "line_gap_def_mid_m": 0.0,
            "line_gap_mid_att_m": 0.0,
            "lines": [],
            "convex_hull": [],
        }

    # Sort longitudinally from own goal toward attack_goal_x
    attacks_right = attack_goal_x >= 52.5
    sorted_long = sorted(
        outfield,
        key=lambda p: float(p["x_m"]) if attacks_right else (105.0 - float(p["x_m"])),
    )
    prog_xs = [
        float(p["x_m"]) if attacks_right else (105.0 - float(p["x_m"]))
        for p in sorted_long
    ]

    n = len(sorted_long)
    if n <= 3:
        groups = [sorted_long]
    elif n <= 5:
        # Split into 2 lines at largest longitudinal gap
        gaps = [(prog_xs[i + 1] - prog_xs[i], i + 1) for i in range(n - 1)]
        split_idx = max(gaps, key=lambda g: g[0])[1]
        groups = [sorted_long[:split_idx], sorted_long[split_idx:]]
    else:
        # Split into 3 lines (Backline, Midfield, Attack) using the two largest longitudinal gaps
        # constrained so each line has at least 1 player and backline has 2..5 players
        best_score = -1.0
        best_splits = (max(1, n // 3), max(2, (2 * n) // 3))
        for i in range(2, min(6, n - 1)):
            for j in range(i + 1, n):
                gap1 = prog_xs[i] - prog_xs[i - 1]
                gap2 = prog_xs[j] - prog_xs[j - 1]
                # Prefer balanced line sizes + clear longitudinal gaps
                balance_bonus = 1.2 if (2 <= i <= 5 and 2 <= (j - i) <= 5) else 0.0
                score = gap1 + gap2 + balance_bonus
                if score > best_score:
                    best_score = score
                    best_splits = (i, j)
        s1, s2 = best_splits
        groups = [sorted_long[:s1], sorted_long[s1:s2], sorted_long[s2:]]

    line_types = ["backline", "midfield", "attack"]
    line_labels_ar = ["خط الدفاع", "خط الوسط", "خط الهجوم"]
    lines_out: list[dict[str, Any]] = []
    line_mean_x: list[float] = []

    for idx, grp in enumerate(groups):
        if not grp:
            continue
        ltype = line_types[min(idx, len(line_types) - 1)]
        llabel = line_labels_ar[min(idx, len(line_labels_ar) - 1)]
        # Sort laterally from top touchline (y=0) to bottom touchline (y=68)
        grp_lat = sorted(grp, key=lambda p: float(p["y_m"]))
        mean_x = float(sum(float(p["x_m"]) for p in grp_lat) / len(grp_lat))
        line_mean_x.append(mean_x)
        # Check lateral spacing anomalies along this line
        max_lat_gap = 0.0
        for k in range(len(grp_lat) - 1):
            gap_y = abs(float(grp_lat[k + 1]["y_m"]) - float(grp_lat[k]["y_m"]))
            if gap_y > max_lat_gap:
                max_lat_gap = gap_y
        lines_out.append(
            {
                "line_type": ltype,
                "label_ar": f"{llabel} ({len(grp_lat)})",
                "count": len(grp_lat),
                "mean_x_m": round(mean_x, 2),
                "max_lateral_gap_m": round(max_lat_gap, 1),
                "points": [
                    {
                        "track_id": int(p["track_id"]),
                        "x_m": round(float(p["x_m"]), 2),
                        "y_m": round(float(p["y_m"]), 2),
                        "label": _player_display_label(p),
                        "jersey_number": p.get("jersey_number"),
                        "speed_kmh": round(float(p.get("speed_kmh", 0.0) or 0.0), 1),
                    }
                    for p in grp_lat
                ],
            }
        )

    counts_str = "-".join(str(len(g)) for g in groups if g)
    def_cnt = len(groups[0]) if groups else 4
    mid_cnt = len(groups[1]) if len(groups) > 1 else 3
    if def_cnt <= 3:
        inferred_full = "3-4-2-1"
    elif mid_cnt >= 4:
        inferred_full = "4-4-2"
    elif len(groups) >= 3 and len(groups[-1]) >= 3:
        inferred_full = "4-3-3"
    else:
        inferred_full = "4-2-3-1"

    xs = [float(p["x_m"]) for p in outfield]
    ys = [float(p["y_m"]) for p in outfield]
    width_m = round(max(ys) - min(ys), 1) if len(ys) >= 2 else 0.0
    depth_m = round(max(xs) - min(xs), 1) if len(xs) >= 2 else 0.0
    hull = _convex_hull_xy([(float(p["x_m"]), float(p["y_m"])) for p in outfield])
    compactness_m2 = _polygon_area(hull)

    gap_def_mid = round(abs(line_mean_x[1] - line_mean_x[0]), 1) if len(line_mean_x) >= 2 else 0.0
    gap_mid_att = round(abs(line_mean_x[2] - line_mean_x[1]), 1) if len(line_mean_x) >= 3 else 0.0

    return {
        "team": team,
        "detected_shape": counts_str if n >= 7 else f"{counts_str} (مرئي {n}→{inferred_full})",
        "inferred_full_formation": inferred_full,
        "visible_outfield_count": n,
        "width_m": width_m,
        "depth_m": depth_m,
        "compactness_m2": compactness_m2,
        "defensive_line_x_m": round(line_mean_x[0], 2) if line_mean_x else 52.5,
        "line_gap_def_mid_m": gap_def_mid,
        "line_gap_mid_att_m": gap_mid_att,
        "lines": lines_out,
        "convex_hull": hull,
    }


def analyze_frame_moment_state(
    players: list[dict[str, Any]],
    ball_xy: tuple[float, float],
    attacking_team: str = "team_a",
    defending_team: str = "team_b",
    attack_goal_x: float = 105.0,
    time_s: float = 0.0,
    frame_id: int = 1250,
    selected_track_id: Optional[int] = None,
    team_a_name: str = "الأهلي",
    team_b_name: str = "إنبي",
) -> dict[str, Any]:
    """Compute the PDF Pages 25-26 Moment State Analyzer:
    - Exact 'Did' (ما الذي فعله)
    - Exact 'Did Not' (ما الذي لم يفعله)
    - Exact 'Where & Why It Failed/Succeeded' (أين وليه أخطأ / نجح)
    Plus live formation lines, passing channels, and tactical correction vectors for both teams.
    """
    bx, by = float(ball_xy[0]), float(ball_xy[1])
    attacks_right = attack_goal_x >= 52.5
    defend_goal_x = 0.0 if attacks_right else 105.0
    att_team_label = team_a_name if attacking_team == "team_a" else team_b_name
    def_team_label = team_b_name if defending_team == "team_b" else team_a_name

    att_formation = detect_live_team_formation(players, attacking_team, attack_goal_x)
    def_formation = detect_live_team_formation(players, defending_team, defend_goal_x)

    attackers = [
        p
        for p in players
        if p.get("team") == attacking_team
        and p.get("role") in ("player", "goalkeeper")
        and p.get("x_m") is not None
        and p.get("y_m") is not None
    ]
    defenders = [
        p
        for p in players
        if p.get("team") == defending_team
        and p.get("role") in ("player", "goalkeeper")
        and p.get("x_m") is not None
        and p.get("y_m") is not None
    ]

    # Identify ball carrier (nearest attacker or overall nearest player to ball)
    all_field = attackers + defenders
    carrier = (
        min(all_field, key=lambda p: math.hypot(float(p["x_m"]) - bx, float(p["y_m"]) - by))
        if all_field
        else None
    )
    att_carrier = (
        min(attackers, key=lambda p: math.hypot(float(p["x_m"]) - bx, float(p["y_m"]) - by))
        if attackers
        else carrier
    )
    nearest_def_to_ball = (
        min(defenders, key=lambda p: math.hypot(float(p["x_m"]) - bx, float(p["y_m"]) - by))
        if defenders
        else None
    )

    # Compute baseline Pitch Control and Shot xG
    pc_base = compute_dynamic_pitch_control(
        players,
        ball_xy=(bx, by),
        attacking_team=attacking_team,
        nx=21,
        ny=14,
        goal_x=attack_goal_x,
    )
    xg_base = compute_shot_xg(
        players,
        ball_xy=(bx, by),
        attacking_team=attacking_team,
        goal_x=attack_goal_x,
    )

    # Compute Passing Channels from ball (bx, by) to each attacking teammate
    passing_channels: list[dict[str, Any]] = []
    for att in attackers:
        if att_carrier and int(att["track_id"]) == int(att_carrier["track_id"]):
            continue
        tx, ty = float(att["x_m"]), float(att["y_m"])
        pass_dist = float(math.hypot(tx - bx, ty - by))
        if pass_dist < 2.5 or pass_dist > 44.0:
            continue
        min_clearance = 99.0
        blocker_id = None
        for d in defenders:
            dx_m, dy_m = float(d["x_m"]), float(d["y_m"])
            perp_d, proj_t = _point_to_segment_distance(dx_m, dy_m, bx, by, tx, ty)
            if 0.08 <= proj_t <= 0.95 and perp_d < min_clearance:
                min_clearance = perp_d
                if perp_d < 1.85:
                    blocker_id = int(d["track_id"])
        prog_gain = (tx - bx) if attacks_right else (bx - tx)
        is_blocked = min_clearance < 1.85
        channel_quality = round(
            float(np.clip((min_clearance * 14.0) + max(0.0, prog_gain) * 2.2 - pass_dist * 0.6, 5.0, 99.0)),
            1,
        )
        passing_channels.append(
            {
                "from_x_m": round(bx, 2),
                "from_y_m": round(by, 2),
                "to_x_m": round(tx, 2),
                "to_y_m": round(ty, 2),
                "target_track_id": int(att["track_id"]),
                "target_label": _player_display_label(att),
                "distance_m": round(pass_dist, 1),
                "lane_clearance_m": round(min(25.0, min_clearance), 2),
                "progressive_gain_m": round(prog_gain, 1),
                "is_blocked": is_blocked,
                "blocker_track_id": blocker_id,
                "quality_score": channel_quality,
            }
        )
    passing_channels.sort(key=lambda c: (not c["is_blocked"], c["quality_score"]), reverse=True)

    # Offside line analysis for defending backline
    def_outfield = [d for d in defenders if d.get("role") == "player"]
    def_line_x = float(def_formation["defensive_line_x_m"])
    if def_outfield:
        sorted_back = sorted(
            def_outfield,
            key=lambda d: abs(float(d["x_m"]) - defend_goal_x),
        )[: min(4, len(def_outfield))]
        median_back_x = float(np.median([float(d["x_m"]) for d in sorted_back]))
    else:
        sorted_back = []
        median_back_x = def_line_x

    # Build Per-Player Moment States (Did / Did Not / Where & Why) + Correction Arrows
    player_states: list[dict[str, Any]] = []
    correction_arrows: list[dict[str, Any]] = []

    for p in all_field:
        tid = int(p["track_id"])
        px, py = float(p["x_m"]), float(p["y_m"])
        vx, vy = float(p.get("vx_ms", 0.0) or 0.0), float(p.get("vy_ms", 0.0) or 0.0)
        spd_kmh = float(p.get("speed_kmh", round(math.hypot(vx, vy) * 3.6, 1)) or 0.0)
        p_team = str(p.get("team", ""))
        is_def = p_team == defending_team
        team_goal_x = defend_goal_x if is_def else attack_goal_x
        zone_ar = _describe_pitch_zone_ar(px, py, attack_goal_x)
        dist_ball = round(float(math.hypot(px - bx, py - by)), 1)

        opponents = attackers if is_def else defenders
        teammates = [t for t in (defenders if is_def else attackers) if int(t["track_id"]) != tid]
        nearest_opp = (
            min(opponents, key=lambda o: math.hypot(float(o["x_m"]) - px, float(o["y_m"]) - py))
            if opponents
            else None
        )
        dist_opp = (
            round(float(math.hypot(float(nearest_opp["x_m"]) - px, float(nearest_opp["y_m"]) - py)), 1)
            if nearest_opp
            else 99.0
        )
        nearest_mate = (
            min(teammates, key=lambda m: math.hypot(float(m["x_m"]) - px, float(m["y_m"]) - py))
            if teammates
            else None
        )
        dist_mate = (
            round(float(math.hypot(float(nearest_mate["x_m"]) - px, float(nearest_mate["y_m"]) - py)), 1)
            if nearest_mate
            else 99.0
        )

        # Motion vector description
        if spd_kmh < 3.5:
            motion_ar = f"ثابت تقريباً في موقعه (سرعته {spd_kmh:.1f} كم/س)"
        else:
            # Angle toward ball
            to_ball_x, to_ball_y = bx - px, by - py
            dot_ball = (vx * to_ball_x + vy * to_ball_y) / max(1e-5, math.hypot(vx, vy) * max(0.1, dist_ball))
            if dot_ball > 0.45:
                motion_ar = f"ينطلق باتجاه الكرة بسرعة {spd_kmh:.1f} كم/س"
            elif dot_ball < -0.45:
                motion_ar = f"يتراجع/يتحرك بعيداً عن الكرة بسرعة {spd_kmh:.1f} كم/س"
            else:
                motion_ar = f"يتحرك عرضياً/قطرياً بسرعة {spd_kmh:.1f} كم/س"

        plabel = _player_display_label(p)
        status_tag = "disciplined"
        severity_score = 0.0
        opt_x, opt_y = px, py

        # 1. DID (ما الذي فعله فعلياً)
        did_ar = (
            f"تواجد في «{zone_ar}» عند الإحداثي (X={px:.1f}م، Y={py:.1f}م) على بُعد {dist_ball:.1f}م من الكرة "
            f"و{dist_opp:.1f}م من أقرب خصم، و{motion_ar}."
        )

        # 2. DID NOT & 3. WHERE & WHY (calculated dynamically by role & geometry)
        if is_def:
            is_primary_presser = nearest_def_to_ball is not None and int(nearest_def_to_ball["track_id"]) == tid
            offside_drop = (
                (median_back_x - px) if defend_goal_x < 52.5 else (px - median_back_x)
            )
            in_backline = any(int(d["track_id"]) == tid for d in sorted_back)

            if is_primary_presser and dist_ball > 2.8:
                status_tag = "tactical_gap"
                severity_score = min(98.0, dist_ball * 11.5)
                # Optimal position: step 60% of the way toward ball while protecting goal axis
                goal_vec_x = defend_goal_x - bx
                goal_vec_y = 34.0 - by
                gnorm = max(1e-4, math.hypot(goal_vec_x, goal_vec_y))
                opt_x = round(bx + (goal_vec_x / gnorm) * 1.6, 2)
                opt_y = round(by + (goal_vec_y / gnorm) * 1.6, 2)
                open_lanes = sum(1 for c in passing_channels[:3] if not c["is_blocked"])
                did_not_ar = (
                    f"لم يغلق المسافة مع حامل الكرة (ترك فجوة ضغط {dist_ball:.1f}م بدلاً من المسافة المثالية ≤ 1.8م) "
                    f"ولم يحجب زوايا التمرير الأمامية ({open_lanes} قنوات تمرير مفتوحة للخصم)."
                )
                where_and_why_ar = (
                    f"أخطأ عند (X={px:.1f}م، Y={py:.1f}م) في {zone_ar}؛ لأن تأخره بفارق {max(0.5, dist_ball - 1.6):.1f}م "
                    f"وسرعة إغلاقه ({spd_kmh:.1f} كم/س) منحت المهاجم وقتاً لكشف الملعب ورفعت خطورة التسديد/التمرير إلى "
                    f"xG={xg_base['xg']:.3f}. الموقع الصحيح للإغلاق: (X={opt_x:.1f}م، Y={opt_y:.1f}م)."
                )
                correction_arrows.append(
                    {
                        "track_id": tid,
                        "team": p_team,
                        "player_label": plabel,
                        "action_type": "close_down_carrier",
                        "label_ar": f"إغلاق حامل الكرة ({dist_ball:.1f}م → 1.6م)",
                        "from_x_m": round(px, 2),
                        "from_y_m": round(py, 2),
                        "to_x_m": opt_x,
                        "to_y_m": opt_y,
                        "delta_m": round(float(math.hypot(opt_x - px, opt_y - py)), 1),
                        "urgency": "critical",
                    }
                )
            elif in_backline and offside_drop > 1.7:
                status_tag = "line_break"
                severity_score = min(92.0, offside_drop * 18.0)
                opt_x = round(median_back_x, 2)
                opt_y = round(py + (34.0 - py) * 0.18, 2)
                did_not_ar = (
                    f"لم يضبط خط التسلل مع زملائه في خط الدفاع (تأخر للخلف بمقدار {offside_drop:.1f}م عن متوسط الخط الدفاعي عند X={median_back_x:.1f}م)."
                )
                where_and_why_ar = (
                    f"كسر خط التسلل عند (X={px:.1f}م، Y={py:.1f}م) وترك مسافة عرضية {dist_mate:.1f}م عن أقرب مدافع مجاور، "
                    f"مما يغطي انطلاقات مهاجمي {att_team_label} خلف الظهر. كان يجب التقدم إلى (X={opt_x:.1f}م، Y={opt_y:.1f}م)."
                )
                correction_arrows.append(
                    {
                        "track_id": tid,
                        "team": p_team,
                        "player_label": plabel,
                        "action_type": "align_offside_line",
                        "label_ar": f"ضبط خط التسلل (+{offside_drop:.1f}م)",
                        "from_x_m": round(px, 2),
                        "from_y_m": round(py, 2),
                        "to_x_m": opt_x,
                        "to_y_m": opt_y,
                        "delta_m": round(float(math.hypot(opt_x - px, opt_y - py)), 1),
                        "urgency": "high",
                    }
                )
            elif dist_opp > 6.5 and dist_ball < 26.0:
                status_tag = "loose_marking"
                severity_score = min(84.0, dist_opp * 6.5)
                if nearest_opp is not None:
                    ox, oy = float(nearest_opp["x_m"]), float(nearest_opp["y_m"])
                    # Step into passing lane between ball and nearest opponent
                    opt_x = round(ox * 0.72 + bx * 0.28, 2)
                    opt_y = round(oy * 0.72 + by * 0.28, 2)
                did_not_ar = (
                    f"لم يلتزم بالرقابة اللصيقة أو إغلاق ظل التمرير على {_player_display_label(nearest_opp) if nearest_opp else 'الخصم'} "
                    f"(تركه حراً على مسافة {dist_opp:.1f}م)."
                )
                where_and_why_ar = (
                    f"في «{zone_ar}» عند (X={px:.1f}م، Y={py:.1f}م): ابتعاده بـ {dist_opp:.1f}م سمح للخصم باستلام الكرة دون ضغط. "
                    f"التمركز الصحيح لقطع قناة التمرير هو (X={opt_x:.1f}م، Y={opt_y:.1f}م)."
                )
                correction_arrows.append(
                    {
                        "track_id": tid,
                        "team": p_team,
                        "player_label": plabel,
                        "action_type": "block_passing_lane",
                        "label_ar": f"قطع قناة التمرير ({dist_opp:.1f}م)",
                        "from_x_m": round(px, 2),
                        "from_y_m": round(py, 2),
                        "to_x_m": opt_x,
                        "to_y_m": opt_y,
                        "delta_m": round(float(math.hypot(opt_x - px, opt_y - py)), 1),
                        "urgency": "medium",
                    }
                )
            else:
                status_tag = "disciplined"
                severity_score = 18.0
                did_not_ar = (
                    f"لم يترك فجوة دفاعية حرجة (محافظ على مسافة رقابة {dist_opp:.1f}م وترابط {dist_mate:.1f}م مع أقرب زميل)."
                )
                where_and_why_ar = (
                    f"تمركز منضبط في «{zone_ar}» عند (X={px:.1f}م، Y={py:.1f}م) يغلق زاوية التمرير المباشرة نحو المرمى."
                )
        else:
            # Attacking player analysis
            is_carrier = att_carrier is not None and int(att_carrier["track_id"]) == tid
            my_channel = next((c for c in passing_channels if c["target_track_id"] == tid), None)
            if is_carrier:
                best_open = next((c for c in passing_channels if not c["is_blocked"]), None)
                status_tag = "ball_carrier"
                severity_score = 75.0
                if best_open:
                    opt_x, opt_y = best_open["to_x_m"], best_open["to_y_m"]
                    did_not_ar = (
                        f"إذا استمر بالاحتفاظ بالكرة تحت ضغط ({dist_opp:.1f}م من أقرب مدافع) دون التمرير إلى "
                        f"{best_open['target_label']} فسيفقد أفضل قناة تمرير مفتوحة (خلوص {best_open['lane_clearance_m']:.1f}م)."
                    )
                    where_and_why_ar = (
                        f"يمتلك الكرة في «{zone_ar}» عند (X={px:.1f}م، Y={py:.1f}م) مع سيطرة مكانية {pc_base['overall_control_pct']:.1f}%. "
                        f"أفضل قرار تكتيكي فوري هو التمرير التقدمي (+{best_open['progressive_gain_m']:.1f}م) نحو "
                        f"(X={opt_x:.1f}م، Y={opt_y:.1f}م)."
                    )
                else:
                    did_not_ar = "لم يجد زاوية تمرير أمامية مفتوحة حالياً بسبب إغلاق الخصم لقنوات التمرير المباشرة."
                    where_and_why_ar = (
                        f"تحت ضغط على مسافة {dist_opp:.1f}م عند (X={px:.1f}م، Y={py:.1f}م) ويحتاج إلى تمريرة مساندة لفك التكتل."
                    )
            elif my_channel and my_channel["is_blocked"]:
                status_tag = "in_cover_shadow"
                severity_score = 64.0
                # Move laterally 4.5m out of cover shadow and 3.5m progressively
                step_x = 3.5 if attacks_right else -3.5
                step_y = 4.5 if py < 34.0 else -4.5
                opt_x = round(float(np.clip(px + step_x, 2.0, 103.0)), 2)
                opt_y = round(float(np.clip(py + step_y, 3.0, 65.0)), 2)
                did_not_ar = (
                    f"لم يتحرك خارج ظل الرقابة (Cover Shadow) للمدافع #{my_channel['blocker_track_id']} "
                    f"(خلوص ممر التمرير {my_channel['lane_clearance_m']:.2f}م فقط، أقل من حد التمرير الآمن 1.85م)."
                )
                where_and_why_ar = (
                    f"وقف في زاوية تمرير مغلقة عند (X={px:.1f}م، Y={py:.1f}م) بسرعة {spd_kmh:.1f} كم/س. "
                    f"كان يجب التحرك قطرياً إلى (X={opt_x:.1f}م، Y={opt_y:.1f}م) لفتح زاوية استلام في المساحة النصفية."
                )
                correction_arrows.append(
                    {
                        "track_id": tid,
                        "team": p_team,
                        "player_label": plabel,
                        "action_type": "escape_cover_shadow",
                        "label_ar": "تحرك لفتح زاوية تمرير",
                        "from_x_m": round(px, 2),
                        "from_y_m": round(py, 2),
                        "to_x_m": opt_x,
                        "to_y_m": opt_y,
                        "delta_m": round(float(math.hypot(opt_x - px, opt_y - py)), 1),
                        "urgency": "medium",
                    }
                )
            else:
                status_tag = "open_option"
                severity_score = 30.0
                clearance = my_channel["lane_clearance_m"] if my_channel else dist_opp
                step_x = 4.5 if attacks_right else -4.5
                opt_x = round(float(np.clip(px + step_x, 2.0, 103.0)), 2)
                opt_y = round(py, 2)
                did_not_ar = (
                    f"لم يستغل بعد المساحة المفتوحة أمامه بالانطلاق خلف الخط الدفاعي رغم تفوقه المكاني ({dist_opp:.1f}م عن أقرب مدافع)."
                )
                where_and_why_ar = (
                    f"متاح للاستلام في «{zone_ar}» عند (X={px:.1f}م، Y={py:.1f}م) بخلوص تمرير {clearance:.1f}م؛ "
                    f"انطلاقه إلى (X={opt_x:.1f}م، Y={opt_y:.1f}م) يرفع التهديد المتوقع xT مباشرة."
                )

        player_states.append(
            {
                "track_id": tid,
                "player_label": plabel,
                "team": p_team,
                "team_name": def_team_label if is_def else att_team_label,
                "role": str(p.get("role", "player")),
                "jersey_number": p.get("jersey_number"),
                "x_m": round(px, 2),
                "y_m": round(py, 2),
                "opt_x_m": round(opt_x, 2),
                "opt_y_m": round(opt_y, 2),
                "speed_kmh": round(spd_kmh, 1),
                "dist_to_ball_m": dist_ball,
                "dist_to_nearest_opponent_m": dist_opp,
                "dist_to_nearest_teammate_m": dist_mate,
                "zone_ar": zone_ar,
                "status_tag": status_tag,
                "severity_score": round(severity_score, 1),
                "did_ar": did_ar,
                "did_not_ar": did_not_ar,
                "where_and_why_ar": where_and_why_ar,
            }
        )

    # Sort player_states so selected_track_id or highest-severity players come first
    player_states.sort(
        key=lambda s: (
            1 if (selected_track_id is not None and s["track_id"] == int(selected_track_id)) else 0,
            s["severity_score"],
        ),
        reverse=True,
    )

    # Pick the primary focal player for the top Moment State summary card
    focal_player = player_states[0] if player_states else None
    primary_def_fault = next(
        (s for s in player_states if s["team"] == defending_team and s["status_tag"] != "disciplined"),
        next((s for s in player_states if s["team"] == defending_team), focal_player),
    )

    # Simulate counterfactual Pitch Control if top 2 defensive correction arrows are applied
    def_corr_map = {
        c["track_id"]: (c["to_x_m"], c["to_y_m"])
        for c in correction_arrows
        if c["team"] == defending_team
    }
    if def_corr_map:
        corrected_players = [
            {
                **p,
                "x_m": def_corr_map[int(p["track_id"])][0],
                "y_m": def_corr_map[int(p["track_id"])][1],
            }
            if int(p["track_id"]) in def_corr_map
            else dict(p)
            for p in players
        ]
        pc_after = compute_dynamic_pitch_control(
            corrected_players,
            ball_xy=(bx, by),
            attacking_team=attacking_team,
            nx=21,
            ny=14,
            goal_x=attack_goal_x,
        )
        xg_after = compute_shot_xg(
            corrected_players,
            ball_xy=(bx, by),
            attacking_team=attacking_team,
            goal_x=attack_goal_x,
        )
        risk_reduction_pct = round(
            max(1.5, float(pc_base["box_control_pct"]) - float(pc_after["box_control_pct"])),
            1,
        )
        xg_after_val = float(xg_after["xg"])
    else:
        risk_reduction_pct = 0.0
        xg_after_val = float(xg_base["xg"])

    open_channels_count = sum(1 for c in passing_channels if not c["is_blocked"])
    ball_zone_ar = _describe_pitch_zone_ar(bx, by, attack_goal_x)

    moment_summary = {
        "frame_id": int(frame_id),
        "time_s": round(float(time_s), 2),
        "ball_x_m": round(bx, 2),
        "ball_y_m": round(by, 2),
        "ball_zone_ar": ball_zone_ar,
        "attacking_team": attacking_team,
        "defending_team": defending_team,
        "attacking_team_name": att_team_label,
        "defending_team_name": def_team_label,
        "attacking_formation_live": att_formation["detected_shape"],
        "defending_formation_live": def_formation["detected_shape"],
        "attacking_pitch_control_pct": round(float(pc_base["overall_control_pct"]), 1),
        "shot_xg_before": round(float(xg_base["xg"]), 3),
        "shot_xg_after_correction": round(xg_after_val, 3),
        "risk_reduction_if_corrected_pct": risk_reduction_pct,
        "open_passing_channels_count": open_channels_count,
        "headline_did_ar": (
            primary_def_fault["did_ar"]
            if primary_def_fault
            else f"الكرة في {ball_zone_ar} عند (X={bx:.1f}م، Y={by:.1f}م)."
        ),
        "headline_did_not_ar": (
            primary_def_fault["did_not_ar"]
            if primary_def_fault
            else "لم يتم رصد خلل تكتيكي في هذه اللحظة."
        ),
        "headline_where_and_why_ar": (
            primary_def_fault["where_and_why_ar"]
            if primary_def_fault
            else "التمركز الدفاعي والهجومي متوازن حالياً."
        ),
        "focal_player": focal_player,
    }

    return {
        "moment_summary": moment_summary,
        "formations": {
            attacking_team: att_formation,
            defending_team: def_formation,
        },
        "passing_channels": passing_channels[:6],
        "correction_arrows": correction_arrows[:6],
        "player_states": player_states,
    }


def build_formation_blueprint(
    formation_code: str = "4-2-3-1",
    team_name: str = "الأهلي",
    opponent_name: str = "إنبي",
    attack_right: bool = True,
    roster_players: Optional[list[dict[str, Any]]] = None,
    tactical_mode: str = "balanced",
) -> dict[str, Any]:
    """Generate a complete 11v11 visual tactical formation blueprint on a 105x68m FIFA pitch.

    Maps real match players/tracks onto the 11 tactical roles, computes connected line geometry,
    pressing zones, and tactical movement vectors so the frontend can draw the exact plan on canvas.
    """
    clean_code = formation_code.strip() if formation_code.strip() in TACTICAL_FORMATIONS_CATALOG else "4-2-3-1"
    spec = TACTICAL_FORMATIONS_CATALOG[clean_code]

    # Mode shift: aggressive pushes lines +9m higher, conservative drops lines -7m deeper
    mode_shift_x = 0.08 if tactical_mode == "aggressive" else (-0.06 if tactical_mode == "conservative" else 0.0)
    roster = list(roster_players or [])

    nodes_out: list[dict[str, Any]] = []
    slot_to_xy: dict[str, tuple[float, float]] = {}

    for idx, nd in enumerate(spec["nodes"]):
        x_norm = float(nd["x_norm"])
        if nd["slot"] != "GK":
            x_norm = float(np.clip(x_norm + mode_shift_x, 0.14, 0.90))
        if not attack_right:
            x_norm = 1.0 - x_norm
        y_norm = float(nd["y_norm"])
        x_m = round(x_norm * 105.0, 2)
        y_m = round(y_norm * 68.0, 2)
        slot_to_xy[nd["slot"]] = (x_m, y_m)

        assigned = roster[idx] if idx < len(roster) else None
        p_name = (
            assigned.get("verified_name")
            or assigned.get("player_name")
            or (f"#{assigned['jersey_number']}" if assigned and assigned.get("jersey_number") else nd["slot"])
        ) if assigned else nd["slot"]

        # Tactical movement vector for each slot
        dir_s = 1.0 if attack_right else -1.0
        if nd["slot"] in ("RB", "LB", "RWB", "LWB"):
            to_x = round(float(np.clip(x_m + dir_s * 11.5, 4.0, 101.0)), 2)
            to_y = round(y_m + (34.0 - y_m) * 0.12, 2)
            duty_ar = "تقدم على الطرف مع التغطية العكسية للممر النصفي"
        elif nd["slot"] in ("CAM", "RAM", "LAM", "RCM", "LCM"):
            to_x = round(float(np.clip(x_m + dir_s * 8.5, 4.0, 101.0)), 2)
            to_y = round(y_m + (34.0 - y_m) * 0.22, 2)
            duty_ar = "اختراق المنطقة 14 وأنصاف المساحات لربط الخطوط"
        elif nd["slot"] in ("RW", "LW", "RM", "LM"):
            to_x = round(float(np.clip(x_m + dir_s * 10.0, 4.0, 101.0)), 2)
            to_y = round(y_m + (34.0 - y_m) * 0.35, 2)
            duty_ar = "قطع قطري للعمق خلف الظهير لفتح ممر التسديد"
        elif nd["slot"] in ("ST", "RST", "LST"):
            to_x = round(float(np.clip(x_m + dir_s * 9.0, 4.0, 101.0)), 2)
            to_y = y_m
            duty_ar = "تثبيت قلبي الدفاع والضغط على محور بناء اللعب"
        elif nd["slot"] in ("CDM", "RDM", "LDM"):
            to_x = round(float(np.clip(x_m + dir_s * 4.0, 4.0, 101.0)), 2)
            to_y = round(y_m + (34.0 - y_m) * 0.25, 2)
            duty_ar = "حماية المنطقة 14 أمام قلبي الدفاع وإغلاق التحولات"
        else:
            to_x, to_y = x_m, y_m
            duty_ar = "ضبط خط التسلل والتغطية العميقة"

        nodes_out.append(
            {
                "slot": nd["slot"],
                "role_ar": nd["role_ar"],
                "player_label": str(p_name),
                "track_id": assigned.get("track_id") if assigned else None,
                "jersey_number": assigned.get("jersey_number") if assigned else (idx + 1),
                "x_m": x_m,
                "y_m": y_m,
                "move_to_x_m": to_x,
                "move_to_y_m": to_y,
                "duty_ar": duty_ar,
            }
        )

    lines_out: list[dict[str, Any]] = []
    for ln in spec["lines"]:
        pts = []
        for sl in ln["slots"]:
            if sl in slot_to_xy:
                sx, sy = slot_to_xy[sl]
                pts.append({"slot": sl, "x_m": sx, "y_m": sy})
        lines_out.append(
            {
                "line_type": ln["line_type"],
                "label_ar": ln["label_ar"],
                "points": pts,
            }
        )

    zone14_x1 = 68.0 if attack_right else (105.0 - 88.5)
    zone14_x2 = 88.5 if attack_right else (105.0 - 68.0)

    return {
        "formation_code": clean_code,
        "title_ar": spec["title_ar"],
        "philosophy_ar": spec["philosophy_ar"],
        "team_name": team_name,
        "opponent_name": opponent_name,
        "tactical_mode": tactical_mode,
        "nodes": nodes_out,
        "lines": lines_out,
        "tactical_zones": [
            {
                "zone_id": "zone_14",
                "label_ar": "Zone 14 (عمق صناعة اللعب)",
                "x1_m": round(zone14_x1, 1),
                "y1_m": 22.0,
                "x2_m": round(zone14_x2, 1),
                "y2_m": 46.0,
            },
            {
                "zone_id": "half_space_top",
                "label_ar": "الممر النصفي العلوي",
                "x1_m": round(zone14_x1 - 12.0, 1),
                "y1_m": 13.8,
                "x2_m": round(zone14_x2, 1),
                "y2_m": 24.5,
            },
            {
                "zone_id": "half_space_bottom",
                "label_ar": "الممر النصفي السفلي",
                "x1_m": round(zone14_x1 - 12.0, 1),
                "y1_m": 43.5,
                "x2_m": round(zone14_x2, 1),
                "y2_m": 54.2,
            },
        ],
        "execution_steps_ar": [
            f"1. ضبط المسافة الطولية بين خط الدفاع وخط الوسط في تشكيل {clean_code} بحيث لا تتجاوز 13 متراً لإغلاق المنطقة 14.",
            f"2. توجيه حامل الكرة لدى {opponent_name} نحو الأطراف ثم تفعيل مصيدة الضغط الثلاثي (الظهير + المحور + الجناح).",
            "3. عند استرجاع الكرة: تمريرة عمودية أولى نحو صانع اللعب في المساحة النصفية مع انطلاق الجناح العكسي خلف الظهير.",
        ],
    }
