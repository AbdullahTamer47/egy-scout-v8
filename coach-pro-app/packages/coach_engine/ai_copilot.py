"""Core Groq AI Copilot & 3-Phase Tactical Phase State Generator for EGY-SCOUT Coach Pro V2."""
from __future__ import annotations

import copy
import os
import re
from typing import Any, Optional

import httpx

from packages.coach_engine.director_admin import (
    _assign_roster_by_position,
    build_official_matchday_sheet,
    build_squad_depth_report,
)
from packages.coach_engine.live_research import research_player_live
from packages.coach_engine.training_planner import generate_custom_session_plan
from packages.tactics_engine.moment_analyzer import (
    build_formation_blueprint,
    enrich_arrows_with_probabilities,
    match_masterclass_preset,
)
from packages.tactics_engine.plan_validator import validate_tactical_plan


SMALL_SIDED_FORMATIONS: dict[int, dict[str, list[dict[str, Any]]]] = {
    5: {
        "1-2-1": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.07, "y_norm": 0.50},
            {"slot": "CB", "role_ar": "ليبرو / مدافع خماسي (Fixo)", "x_norm": 0.25, "y_norm": 0.50},
            {"slot": "RW", "role_ar": "جناح أيمن (Ala)", "x_norm": 0.52, "y_norm": 0.80},
            {"slot": "LW", "role_ar": "جناح أيسر (Ala)", "x_norm": 0.52, "y_norm": 0.20},
            {"slot": "ST", "role_ar": "رأس حربة / بيفوت (Pivot)", "x_norm": 0.78, "y_norm": 0.50},
        ],
        "2-2": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.07, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "مدافع أيمن", "x_norm": 0.28, "y_norm": 0.72},
            {"slot": "LB", "role_ar": "مدافع أيسر", "x_norm": 0.28, "y_norm": 0.28},
            {"slot": "RW", "role_ar": "مهاجم أيمن", "x_norm": 0.70, "y_norm": 0.72},
            {"slot": "LW", "role_ar": "مهاجم أيسر", "x_norm": 0.70, "y_norm": 0.28},
        ],
        "1-1-2": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.07, "y_norm": 0.50},
            {"slot": "CB", "role_ar": "قلب دفاع", "x_norm": 0.25, "y_norm": 0.50},
            {"slot": "CM", "role_ar": "صانع لعب محوري", "x_norm": 0.50, "y_norm": 0.50},
            {"slot": "RW", "role_ar": "مهاجم أيمن", "x_norm": 0.74, "y_norm": 0.74},
            {"slot": "LW", "role_ar": "مهاجم أيسر", "x_norm": 0.74, "y_norm": 0.26},
        ],
    },
    6: {
        "2-2-1": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.07, "y_norm": 0.50},
            {"slot": "RCB", "role_ar": "مدافع أيمن", "x_norm": 0.25, "y_norm": 0.68},
            {"slot": "LCB", "role_ar": "مدافع أيسر", "x_norm": 0.25, "y_norm": 0.32},
            {"slot": "RW", "role_ar": "وسط/جناح أيمن", "x_norm": 0.53, "y_norm": 0.78},
            {"slot": "LW", "role_ar": "وسط/جناح أيسر", "x_norm": 0.53, "y_norm": 0.22},
            {"slot": "ST", "role_ar": "مهاجم صريح", "x_norm": 0.79, "y_norm": 0.50},
        ],
        "2-1-2": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.07, "y_norm": 0.50},
            {"slot": "RCB", "role_ar": "مدافع أيمن", "x_norm": 0.25, "y_norm": 0.68},
            {"slot": "LCB", "role_ar": "مدافع أيسر", "x_norm": 0.25, "y_norm": 0.32},
            {"slot": "CM", "role_ar": "ارتكاز وسط", "x_norm": 0.49, "y_norm": 0.50},
            {"slot": "RW", "role_ar": "مهاجم أيمن", "x_norm": 0.76, "y_norm": 0.68},
            {"slot": "LW", "role_ar": "مهاجم أيسر", "x_norm": 0.76, "y_norm": 0.32},
        ],
    },
    7: {
        "2-3-1": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.07, "y_norm": 0.50},
            {"slot": "RCB", "role_ar": "قلب دفاع أيمن", "x_norm": 0.25, "y_norm": 0.67},
            {"slot": "LCB", "role_ar": "قلب دفاع أيسر", "x_norm": 0.25, "y_norm": 0.33},
            {"slot": "RW", "role_ar": "جناح أيمن", "x_norm": 0.54, "y_norm": 0.82},
            {"slot": "CM", "role_ar": "محور وسط", "x_norm": 0.49, "y_norm": 0.50},
            {"slot": "LW", "role_ar": "جناح أيسر", "x_norm": 0.54, "y_norm": 0.18},
            {"slot": "ST", "role_ar": "رأس حربة", "x_norm": 0.80, "y_norm": 0.50},
        ],
        "3-2-1": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.07, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "ظهير أيمن", "x_norm": 0.27, "y_norm": 0.78},
            {"slot": "CB", "role_ar": "قلب دفاع", "x_norm": 0.22, "y_norm": 0.50},
            {"slot": "LB", "role_ar": "ظهير أيسر", "x_norm": 0.27, "y_norm": 0.22},
            {"slot": "RCM", "role_ar": "وسط أيمن", "x_norm": 0.54, "y_norm": 0.66},
            {"slot": "LCM", "role_ar": "وسط أيسر", "x_norm": 0.54, "y_norm": 0.34},
            {"slot": "ST", "role_ar": "مهاجم صريح", "x_norm": 0.80, "y_norm": 0.50},
        ],
    },
    8: {
        "3-3-1": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "ظهير أيمن", "x_norm": 0.26, "y_norm": 0.80},
            {"slot": "CB", "role_ar": "قلب دفاع", "x_norm": 0.22, "y_norm": 0.50},
            {"slot": "LB", "role_ar": "ظهير أيسر", "x_norm": 0.26, "y_norm": 0.20},
            {"slot": "RW", "role_ar": "جناح أيمن", "x_norm": 0.54, "y_norm": 0.82},
            {"slot": "CM", "role_ar": "ارتكاز وسط", "x_norm": 0.48, "y_norm": 0.50},
            {"slot": "LW", "role_ar": "جناح أيسر", "x_norm": 0.54, "y_norm": 0.18},
            {"slot": "ST", "role_ar": "رأس حربة", "x_norm": 0.80, "y_norm": 0.50},
        ],
        "2-3-2": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RCB", "role_ar": "قلب دفاع أيمن", "x_norm": 0.24, "y_norm": 0.67},
            {"slot": "LCB", "role_ar": "قلب دفاع أيسر", "x_norm": 0.24, "y_norm": 0.33},
            {"slot": "RCM", "role_ar": "وسط أيمن", "x_norm": 0.50, "y_norm": 0.78},
            {"slot": "DM", "role_ar": "ارتكاز محوري", "x_norm": 0.45, "y_norm": 0.50},
            {"slot": "LCM", "role_ar": "وسط أيسر", "x_norm": 0.50, "y_norm": 0.22},
            {"slot": "RST", "role_ar": "مهاجم أيمن", "x_norm": 0.78, "y_norm": 0.64},
            {"slot": "LST", "role_ar": "مهاجم أيسر", "x_norm": 0.78, "y_norm": 0.36},
        ],
    },
    9: {
        "3-3-2": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "ظهير أيمن", "x_norm": 0.26, "y_norm": 0.80},
            {"slot": "CB", "role_ar": "قلب دفاع", "x_norm": 0.22, "y_norm": 0.50},
            {"slot": "LB", "role_ar": "ظهير أيسر", "x_norm": 0.26, "y_norm": 0.20},
            {"slot": "RM", "role_ar": "وسط أيمن", "x_norm": 0.50, "y_norm": 0.78},
            {"slot": "DM", "role_ar": "ارتكاز", "x_norm": 0.44, "y_norm": 0.50},
            {"slot": "LM", "role_ar": "وسط أيسر", "x_norm": 0.50, "y_norm": 0.22},
            {"slot": "RST", "role_ar": "مهاجم أيمن", "x_norm": 0.78, "y_norm": 0.64},
            {"slot": "LST", "role_ar": "مهاجم أيسر", "x_norm": 0.78, "y_norm": 0.36},
        ],
        "3-2-3": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "ظهير أيمن", "x_norm": 0.26, "y_norm": 0.78},
            {"slot": "CB", "role_ar": "قلب دفاع", "x_norm": 0.22, "y_norm": 0.50},
            {"slot": "LB", "role_ar": "ظهير أيسر", "x_norm": 0.26, "y_norm": 0.22},
            {"slot": "RDM", "role_ar": "محور أيمن", "x_norm": 0.46, "y_norm": 0.64},
            {"slot": "LDM", "role_ar": "محور أيسر", "x_norm": 0.46, "y_norm": 0.36},
            {"slot": "RW", "role_ar": "جناح أيمن", "x_norm": 0.74, "y_norm": 0.80},
            {"slot": "ST", "role_ar": "رأس حربة", "x_norm": 0.81, "y_norm": 0.50},
            {"slot": "LW", "role_ar": "جناح أيسر", "x_norm": 0.74, "y_norm": 0.20},
        ],
    },
    10: {
        "3-4-2": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RCB", "role_ar": "مدافع أيمن", "x_norm": 0.23, "y_norm": 0.74},
            {"slot": "CB", "role_ar": "مدافع أوسط", "x_norm": 0.20, "y_norm": 0.50},
            {"slot": "LCB", "role_ar": "مدافع أيسر", "x_norm": 0.23, "y_norm": 0.26},
            {"slot": "RWB", "role_ar": "جناح وسط أيمن", "x_norm": 0.49, "y_norm": 0.85},
            {"slot": "RDM", "role_ar": "ارتكاز أيمن", "x_norm": 0.44, "y_norm": 0.61},
            {"slot": "LDM", "role_ar": "ارتكاز أيسر", "x_norm": 0.44, "y_norm": 0.39},
            {"slot": "LWB", "role_ar": "جناح وسط أيسر", "x_norm": 0.49, "y_norm": 0.15},
            {"slot": "RST", "role_ar": "مهاجم أيمن", "x_norm": 0.77, "y_norm": 0.63},
            {"slot": "LST", "role_ar": "مهاجم أيسر", "x_norm": 0.77, "y_norm": 0.37},
        ],
        "4-3-2": [
            {"slot": "GK", "role_ar": "حارس مرمى", "x_norm": 0.06, "y_norm": 0.50},
            {"slot": "RB", "role_ar": "ظهير أيمن", "x_norm": 0.26, "y_norm": 0.84},
            {"slot": "RCB", "role_ar": "قلب دفاع أيمن", "x_norm": 0.22, "y_norm": 0.62},
            {"slot": "LCB", "role_ar": "قلب دفاع أيسر", "x_norm": 0.22, "y_norm": 0.38},
            {"slot": "LB", "role_ar": "ظهير أيسر", "x_norm": 0.26, "y_norm": 0.16},
            {"slot": "RCM", "role_ar": "وسط أيمن", "x_norm": 0.52, "y_norm": 0.72},
            {"slot": "DM", "role_ar": "ارتكاز", "x_norm": 0.45, "y_norm": 0.50},
            {"slot": "LCM", "role_ar": "وسط أيسر", "x_norm": 0.52, "y_norm": 0.28},
            {"slot": "CAM", "role_ar": "صانع ألعاب", "x_norm": 0.70, "y_norm": 0.38},
            {"slot": "ST", "role_ar": "رأس حربة", "x_norm": 0.81, "y_norm": 0.60},
        ],
    },
}


def _build_small_sided_team(
    team_size: int,
    formation_code: str,
    roster: list[dict[str, Any]],
    attack_right: bool,
    team_key: str,
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    catalog = SMALL_SIDED_FORMATIONS.get(team_size, SMALL_SIDED_FORMATIONS[7])
    resolved_code = formation_code if formation_code in catalog else next(iter(catalog.keys()))
    spec_nodes = catalog[resolved_code]
    matched = _assign_roster_by_position([str(n["slot"]) for n in spec_nodes], roster)

    nodes_out: list[dict[str, Any]] = []
    for idx, nd in enumerate(spec_nodes):
        xn = float(nd["x_norm"]) if attack_right else (1.0 - float(nd["x_norm"]))
        yn = float(nd["y_norm"]) if attack_right else (1.0 - float(nd["y_norm"]))
        xm = round(xn * 105.0, 2)
        ym = round(yn * 68.0, 2)
        pl = matched[idx] if idx < len(matched) else None
        lbl = (pl.get("name_ar") or pl.get("name_en") or nd["slot"]) if pl else nd["slot"]
        nodes_out.append(
            {
                "team": team_key,
                "slot": nd["slot"],
                "role_ar": nd["role_ar"],
                "player_label": str(lbl),
                "jersey_number": int(pl.get("jersey_number") or (idx + 1)) if pl else (idx + 1),
                "x_m": xm,
                "y_m": ym,
            }
        )

    arrows_out: list[dict[str, Any]] = []
    by_x = sorted(nodes_out, key=lambda n: n["x_m"] if attack_right else -n["x_m"])
    for k in range(max(0, len(by_x) - 2)):
        n1, n2 = by_x[k], by_x[k + 1]
        arrows_out.append(
            {
                "team": team_key,
                "from_slot": n1["slot"],
                "to_slot": n2["slot"],
                "from_x_m": n1["x_m"],
                "from_y_m": n1["y_m"],
                "to_x_m": n2["x_m"],
                "to_y_m": n2["y_m"],
                "label_ar": "ربط الخطوط" if k == 0 else "تدرج وتمرير",
                "kind": "pass",
            }
        )
    return resolved_code, nodes_out, arrows_out


def _resolve_groq_key() -> str:
    return os.environ.get("GROQ_API_KEY", "").strip()


def _detect_formation_code(q: str, default_code: str) -> str:
    m = re.search(r"\b([345]\s*[-–]?\s*[1-5]\s*[-–]?\s*[1-5](?:\s*[-–]?\s*[1-4])?)\b", q)
    if not m:
        return default_code
    digits = re.findall(r"\d", m.group(1))
    if 3 <= len(digits) <= 4 and sum(int(d) for d in digits) == 10:
        return "-".join(digits)
    return default_code


def _shift_phase_nodes(
    nodes: list[dict[str, Any]],
    dx_outfield: float,
    x_compress: float = 1.0,
    y_compress: float = 1.0,
    min_x: float = 8.0,
    max_x: float = 96.0,
) -> list[dict[str, Any]]:
    """Transform 11 player nodes realistically along x/y axes while clamping inside 105x68m pitch."""
    out: list[dict[str, Any]] = []
    for n in nodes:
        c = copy.deepcopy(n)
        slot = str(c.get("slot") or "").upper()
        x = float(c.get("x_m") or 52.5)
        y = float(c.get("y_m") or 34.0)
        if slot == "GK":
            nx = max(4.5, min(18.0, x + dx_outfield * 0.18)) if x < 52.5 else min(100.5, max(87.0, x + dx_outfield * 0.18))
            ny = y
        else:
            nx = max(min_x, min(max_x, 52.5 + (x - 52.5) * x_compress + dx_outfield))
            ny = max(5.0, min(63.0, 34.0 + (y - 34.0) * y_compress))
        c["x_m"] = round(nx, 1)
        c["y_m"] = round(ny, 1)
        if "move_to_x_m" in c and c["move_to_x_m"] is not None:
            mx = float(c["move_to_x_m"]) + dx_outfield * 0.85
            c["move_to_x_m"] = round(max(4.5, min(100.5, mx)), 1)
        out.append(c)
    return out


def build_three_phase_tactical_package(
    club: dict[str, Any],
    opponent: dict[str, Any],
    fit_players: list[dict[str, Any]],
    opp_players: list[dict[str, Any]],
    formation_code: str = "4-2-3-1",
    opponent_formation_code: str = "4-4-2",
    tactical_mode: str = "tiki_taka",
    opponent_tactical_mode: str = "balanced",
    masterclass_preset: Optional[dict[str, Any]] = None,
    team_size: int = 11,
) -> dict[str, Any]:
    """Build 3 distinct, editable tactical phase states (Possession / Attack / Defense) for 5v5..11v11."""
    clamped_size = max(5, min(11, int(team_size or 11)))
    team_name = str(club.get("name_ar") or club.get("name_en") or "فريقك")
    opp_name = str(opponent.get("name_ar") or opponent.get("name_en") or "الخصم")

    if clamped_size < 11:
        base_form, s_nodes_a, s_arr_a = _build_small_sided_team(clamped_size, formation_code, fit_players, True, "team_a")
        opp_form, s_nodes_b, s_arr_b = _build_small_sided_team(clamped_size, opponent_formation_code, opp_players, False, "team_b")
        bp_pos: dict[str, Any] = {
            "formation_code": base_form,
            "opponent_formation_code": opp_form,
            "team_size": clamped_size,
            "title_ar": f"{team_name}: خطة {clamped_size} ضد {clamped_size} ({base_form})",
            "philosophy_ar": f"تنظيم تكتيكي لـ {clamped_size} ضد {clamped_size} بالحالات الثلاث.",
            "team_name": team_name,
            "opponent_name": opp_name,
            "tactical_mode": tactical_mode or "tiki_taka",
            "nodes": s_nodes_a,
            "opponent_nodes": s_nodes_b,
            "passing_arrows": enrich_arrows_with_probabilities(s_arr_a, s_nodes_a, s_nodes_b, attack_right=True),
            "opponent_passing_arrows": enrich_arrows_with_probabilities(s_arr_b, s_nodes_b, s_nodes_a, attack_right=False),
        }
    else:
        base_form = masterclass_preset["formation_code"] if masterclass_preset else formation_code
        opp_form = masterclass_preset.get("opponent_formation_code", opponent_formation_code) if masterclass_preset else opponent_formation_code

        bp_pos = build_formation_blueprint(
            formation_code=base_form,
            team_name=team_name,
            opponent_name=opp_name,
            attack_right=True,
            roster_players=fit_players,
            tactical_mode=masterclass_preset.get("style", tactical_mode) if masterclass_preset else (tactical_mode or "tiki_taka"),
            opponent_formation_code=opp_form,
            opponent_roster_players=opp_players,
            opponent_tactical_mode=opponent_tactical_mode or "balanced",
        )
        bp_pos["team_size"] = 11
        if masterclass_preset:
            bp_pos["title_ar"] = f"{team_name}: {masterclass_preset['title_ar']}"
            bp_pos["philosophy_ar"] = masterclass_preset["philosophy_ar"]
            m_arrows = enrich_arrows_with_probabilities(
                masterclass_preset.get("passes", []),
                bp_pos["nodes"],
                bp_pos.get("opponent_nodes", []),
                attack_right=True,
            )
            if m_arrows:
                bp_pos["passing_arrows"] = m_arrows

    bp_pos["kit_colors"] = {
        "team_a_hex": str(club.get("kit_hex") or "#EF4444"),
        "team_b_hex": str(opponent.get("kit_hex") or "#38BDF8"),
    }

    # Phase 1: Possession (في حالة الاستحواذ والبناء)
    pos_a = copy.deepcopy(bp_pos["nodes"])
    pos_b = copy.deepcopy(bp_pos.get("opponent_nodes", []))
    pos_arrows = enrich_arrows_with_probabilities(bp_pos.get("passing_arrows", []), pos_a, pos_b, attack_right=True)
    pos_opp_arrows = enrich_arrows_with_probabilities(bp_pos.get("opponent_passing_arrows", []), pos_b, pos_a, attack_right=False)

    # Phase 2: Attack / Final-Third Penetration (في حالة الهجوم والاختراق)
    att_a = _shift_phase_nodes(pos_a, dx_outfield=+13.5, x_compress=0.92, y_compress=1.06, min_x=18.0, max_x=98.0)
    att_b = _shift_phase_nodes(pos_b, dx_outfield=+12.0, x_compress=0.82, y_compress=0.84, min_x=15.0, max_x=96.0)
    att_arrows_raw = []
    front_slots = [n for n in att_a if n.get("slot") != "GK"]
    by_x = sorted(front_slots, key=lambda n: float(n.get("x_m") or 0.0))
    if len(by_x) >= 3:
        m = len(by_x)
        i0 = min(1, m - 1)
        i1 = min(max(1, m // 3 + 1), m - 1)
        i2 = min(max(i1 + 1, (2 * m) // 3), m - 1)
        i3 = m - 1
        i_wing = max(0, m - 2)
        for idx_a, idx_b, lbl in [
            (i0, i1, "كسر الخط الأول"),
            (i1, i2, "دخول نصف المساحة"),
            (i2, i3, "تمريرة حاسمة للمهاجم"),
            (i1, i_wing, "تحول على الطرف"),
        ]:
            if by_x[idx_a]["slot"] != by_x[idx_b]["slot"]:
                att_arrows_raw.append(
                    {
                        "from_slot": by_x[idx_a]["slot"],
                        "to_slot": by_x[idx_b]["slot"],
                        "label_ar": lbl,
                        "kind": "pass",
                        "color": "#E0A526",
                    }
                )
    att_arrows = enrich_arrows_with_probabilities(att_arrows_raw or pos_arrows, att_a, att_b, attack_right=True)
    att_opp_arrows = enrich_arrows_with_probabilities(bp_pos.get("opponent_passing_arrows", []), att_b, att_a, attack_right=False)

    # Phase 3: Defense & Ball Recovery (في حالة قطع الكرة والدفاع)
    def_a = _shift_phase_nodes(pos_a, dx_outfield=-14.0, x_compress=0.78, y_compress=0.78, min_x=10.0, max_x=82.0)
    def_b = _shift_phase_nodes(pos_b, dx_outfield=-11.5, x_compress=0.95, y_compress=1.05, min_x=12.0, max_x=94.0)
    def_press_arrows = []
    sorted_def_a = sorted([n for n in def_a if n.get("slot") != "GK"], key=lambda n: float(n.get("x_m") or 0.0), reverse=True)
    sorted_opp_b = sorted([n for n in def_b if n.get("slot") != "GK"], key=lambda n: float(n.get("x_m") or 0.0))
    for k in range(min(3, len(sorted_def_a), len(sorted_opp_b))):
        a_n = sorted_def_a[k]
        b_n = sorted_opp_b[k]
        def_press_arrows.append(
            {
                "id": f"press-{k}",
                "from_slot": a_n["slot"],
                "to_slot": b_n["slot"],
                "from_x_m": a_n["x_m"],
                "from_y_m": a_n["y_m"],
                "to_x_m": b_n["x_m"],
                "to_y_m": b_n["y_m"],
                "label_ar": "ضغط واستخلاص الكرة",
                "kind": "press",
                "color": "#EF4444",
                "xpass_pct": None,
            }
        )
    def_opp_arrows = enrich_arrows_with_probabilities(bp_pos.get("opponent_passing_arrows", []), def_b, def_a, attack_right=False)

    phase_states = {
        "possession": {
            "phase_id": "possession",
            "label_ar": "في حالة الاستحواذ والبناء",
            "label_en": "In Possession (Build-up)",
            "description_ar": f"توزيع {team_name} لتدوير الكرة وبناء الهجمة من الخلف مع فتح زوايا التمرير أمام {opp_name}.",
            "nodes": pos_a,
            "opponent_nodes": pos_b,
            "passing_arrows": pos_arrows,
            "opponent_passing_arrows": pos_opp_arrows,
            "custom_arrows": [],
            "custom_links": [],
            "custom_zones": [],
            "validation": validate_tactical_plan(pos_a, pos_b, formation_code=base_form),
        },
        "attack": {
            "phase_id": "attack",
            "label_ar": "في حالة الهجوم والاختراق",
            "label_en": "Attacking (Final Third)",
            "description_ar": f"اندفاع {team_name} للثلث الأخير والمنطقة 14 وأطراف الملعب بينما يتكتل {opp_name} في عمقه الدفاعي.",
            "nodes": att_a,
            "opponent_nodes": att_b,
            "passing_arrows": att_arrows,
            "opponent_passing_arrows": att_opp_arrows,
            "custom_arrows": [],
            "custom_links": [],
            "custom_zones": [{"id": "atk-z14", "x1_m": 68.0, "y1_m": 22.0, "x2_m": 88.5, "y2_m": 46.0, "label_ar": "Zone 14", "color": "#F59E0B"}],
            "validation": validate_tactical_plan(att_a, att_b, formation_code=base_form),
        },
        "defense": {
            "phase_id": "defense",
            "label_ar": "في حالة قطع الكرة والدفاع",
            "label_en": "Defense & Ball Recovery",
            "description_ar": f"انضغاط خطوط {team_name} وتضييق المساحات العرضية وإغلاق العمق مع مصائد ضغط لاسترجاع الكرة من {opp_name}.",
            "nodes": def_a,
            "opponent_nodes": def_b,
            "passing_arrows": def_press_arrows,
            "opponent_passing_arrows": def_opp_arrows,
            "custom_arrows": [],
            "custom_links": [],
            "custom_zones": [{"id": "def-block", "x1_m": 16.0, "y1_m": 15.0, "x2_m": 44.0, "y2_m": 53.0, "label_ar": "كتلة الإغلاق", "color": "#EF4444"}],
            "validation": validate_tactical_plan(def_a, def_b, formation_code=base_form),
        },
    }

    bp_pos["validation"] = phase_states["possession"]["validation"]
    bp_pos["phase_states"] = phase_states
    return bp_pos


def _build_grounded_context_summary(
    coach_name: str,
    coach_role: str,
    club: dict[str, Any],
    opponent: dict[str, Any],
    evaluated_players: list[dict[str, Any]],
    opp_players: list[dict[str, Any]],
    standings: list[dict[str, Any]],
    formation_code: str,
) -> str:
    fit_p = [p for p in evaluated_players if p.get("is_eligible_starter", True)]
    unavail = [p for p in evaluated_players if not p.get("is_eligible_starter", True)]
    warned = [p for p in fit_p if p.get("warning_ar")]

    def _fmt_bio(p: dict[str, Any]) -> str:
        bits = [str(p.get("position") or "")]
        if p.get("age"):
            bits.append(f"{p['age']}س")
        if p.get("height_cm"):
            bits.append(f"{p['height_cm']}سم")
        if p.get("yellow_cards"):
            bits.append(f"إنذارات:{p['yellow_cards']}")
        return "، ".join(b for b in bits if b)

    # Send ALL eligible players grouped concisely so the AI never misses forwards/attackers!
    club_lines = [
        f"#{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({_fmt_bio(p)}, جاهز {p.get('readiness_pct', 100)}%)"
        for p in fit_p[:45]
    ]
    unavail_lines = [
        f"- #{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({p.get('position')}) -> {p.get('block_reason_ar')}"
        for p in unavail
    ]
    opp_lines = [
        f"#{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({_fmt_bio(p)})"
        for p in opp_players[:28]
    ]

    club_st = next((s for s in standings if club.get("name_en", "").lower() in str(s.get("team_name", "")).lower()), None)
    opp_st = next((s for s in standings if opponent.get("name_en", "").lower() in str(s.get("team_name", "")).lower()), None)
    st_text = ""
    if club_st or opp_st:
        c_str = f"{club.get('name_ar')}: مركز {club_st['rank']} ({club_st['points']} نقطة من {club_st['played']} م، له {club_st['gf']} وعليه {club_st['ga']})" if club_st else ""
        o_str = f"{opponent.get('name_ar')}: مركز {opp_st['rank']} ({opp_st['points']} نقطة من {opp_st['played']} م، له {opp_st['gf']} وعليه {opp_st['ga']})" if opp_st else ""
        st_text = f"\nالترتيب الحي: {c_str} | {o_str}"

    opp_header = (
        f"المنافس: {opponent.get('name_ar')} ({opponent.get('name_en')})"
        if opponent.get("club_id") not in (None, "", "none")
        else "المنافس: لم يتم تحديد خصم محدد بعد"
    )

    return (
        f"المدرب: {coach_name} ({coach_role})\n"
        f"الفريق: {club.get('name_ar')} ({club.get('name_en')}) | التشكيل الأساسي: {formation_code}\n"
        f"{opp_header}{st_text}\n"
        f"كامل قائمة اللاعبين الجاهزين ({len(fit_p)} لاعباً — مكتملة):\n" + " | ".join(club_lines) + "\n"
        + (f"المستبعدون للإصابة/الإيقاف ({len(unavail)}):\n" + "\n".join(unavail_lines) + "\n" if unavail_lines else "لا يوجد مستبعدون.\n")
        + (f"مهددون بالإيقاف (إنذاران): {', '.join(str(p.get('name_ar')) for p in warned)}\n" if warned else "")
        + (f"قائمة المنافس ({len(opp_players)}): " + " | ".join(opp_lines) if opp_lines else "")
    )


def _format_player_dossier_text(dossier: dict[str, Any], formation_code: str = "4-2-3-1") -> str:
    tp = dossier.get("tactical_profile") or {}
    stats = dossier.get("season_stats") or {}
    parts = [
        f"اللاعب: {dossier.get('name_ar')} ({dossier.get('name_en')})",
        f"النادي: {dossier.get('club_name_ar')} | القميص: #{dossier.get('jersey_number') or '-'}",
        f"المركز الفعلي الموثق: {dossier.get('position_label_ar')} ({dossier.get('position_code')})",
        f"العمر: {dossier.get('age') or 'غير مسجل'} سنة | الطول: {dossier.get('height_cm') or 'غير مسجل'} سم | الجنسية: {dossier.get('nationality_ar') or '-'}",
        f"المراكز والوظائف الأنسب له: {'، '.join(tp.get('best_roles_ar') or [])}",
        f"توظيفه في 3-4-2-1: {tp.get('fit_3421') or ''}",
        f"توظيفه في {formation_code}: {tp.get('fit_4231') or ''}",
    ]
    if stats.get("competitions"):
        parts.append(f"إحصائيات موسم {stats.get('season_name', '2026/27')}: " + " ؛ ".join(stats["competitions"]))
    if dossier.get("national_team_stats"):
        parts.append(f"المشاركات الدولية: {dossier['national_team_stats']}")
    if dossier.get("injury"):
        parts.append(f"حالة الإصابة الحية: {dossier['injury']}")
    if dossier.get("highlights"):
        parts.append("أرقام مميزة: " + " | ".join(dossier["highlights"]))
    return "\n".join(parts)


def run_coach_copilot_chat(
    question: str,
    coach_name: str,
    coach_role: str,
    club: dict[str, Any],
    opponent: dict[str, Any],
    evaluated_players: list[dict[str, Any]],
    opp_players: list[dict[str, Any]],
    standings: list[dict[str, Any]],
    formation_code: str = "4-2-3-1",
    model: str = "auto",
    history: Optional[list[dict[str, str]]] = None,
    opponent_formation_code: str = "4-4-2",
    tactical_mode: str = "balanced",
    opponent_tactical_mode: str = "balanced",
    target_player: Optional[dict[str, Any]] = None,
    target_club: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Execute Coach Pro action OR Live Search-First Player/Team Research + full grounded Groq LLM coaching response."""
    q = (question or "").strip()
    low = q.lower()
    fit_players = [p for p in evaluated_players if p.get("is_eligible_starter", True)]
    unavail = [p for p in evaluated_players if not p.get("is_eligible_starter", True)]

    action_executed = "advisory"
    ai_blueprint: Optional[dict[str, Any]] = None
    ai_training_session: Optional[dict[str, Any]] = None
    ai_matchday_sheet: Optional[dict[str, Any]] = None
    structured_cards: list[dict[str, Any]] = []
    follow_ups = [
        f"ارسم خطة 3-4-2-1 لـ {club.get('name_ar')}",
        "صمم وحدة تدريبية MD-2 للضغط العالي والتحولات",
        "جهز كشف المباراة الرسمي مع استبعاد المصابين والموقوفين",
        f"حلل التشكيل الأنسب وأبرز نقاط القوة في {club.get('name_ar')}",
    ]

    # Always run live search BEFORE deciding if this is a player-focused inquiry
    is_player_query = bool(target_player) or any(
        kw in low
        for kw in (
            "توظيف", "توضيف", "مركز", "احطه", "أحطه", "فين", "الاعبه", "العبه", "الالعبه",
            "مميزات", "عيوب", "نقاط", "لاعب", "دور", "اداء", "أداء", "تطوير",
            "role", "deploy", "position", "strengths", "weaknesses", "profile",
        )
    )
    researched_player: Optional[dict[str, Any]] = None
    if is_player_query:
        researched_player = research_player_live(
            question=q,
            club=club,
            opponent=opponent,
            target_player=target_player,
            target_club=target_club,
            history=history,
        )

    want_tactics = (not target_player) and any(
        kw in low
        for kw in (
            "ارسم", "رسم", "خطة 3", "خطة 4", "خطة 5", "تكتيك", "تشكيل الفريق",
            "3-4-2-1", "3421", "4-3-3", "433", "4-2-3-1", "4231", "3-5-2", "352", "4-4-2", "5-3-2", "3-2-4-1", "tactic", "formation",
        )
    )
    want_training = any(
        kw in low
        for kw in ("صمم وحدة", "وحدة تدريبية", "حصة تدريب", "روندو", "md-", "md+", "build session", "training session")
    )
    want_matchday = any(
        kw in low
        for kw in ("كشف المباراة", "اسكور شيت", "matchday", "lineup sheet")
    )

    resolved_form = _detect_formation_code(q, formation_code)
    preset = match_masterclass_preset(q)

    if (want_tactics or preset) and not researched_player:
        action_executed = "apply_tactics"
        if preset:
            resolved_form = preset["formation_code"]
        ai_blueprint = build_three_phase_tactical_package(
            club=club,
            opponent=opponent,
            fit_players=fit_players,
            opp_players=opp_players,
            formation_code=resolved_form,
            opponent_formation_code=opponent_formation_code or "4-4-2",
            tactical_mode=tactical_mode or "tiki_taka",
            opponent_tactical_mode=opponent_tactical_mode or "balanced",
            masterclass_preset=preset,
        )
        structured_cards.append(
            {
                "type": "tactics_applied",
                "title": ai_blueprint["title_ar"],
                "fit_used": len(fit_players),
                "excluded": len(unavail),
                "formation": resolved_form,
                "phases": ["possession", "attack", "defense"],
            }
        )

    elif want_training:
        action_executed = "apply_training"
        md_m = re.search(r"MD\s*[+-]?\s*\d", q, flags=re.IGNORECASE)
        md_code = md_m.group(0).upper().replace(" ", "") if md_m else "MD-2"
        ai_training_session = generate_custom_session_plan(
            club_name=str(club.get("name_ar") or club.get("name_en") or ""),
            md_code=md_code,
            focus_topic=q,
            tactical_formation=resolved_form,
            available_players=fit_players,
        )
        structured_cards.append(
            {
                "type": "training_applied",
                "title": ai_training_session["title_ar"],
                "srpe_au": ai_training_session["srpe_au"],
                "duration_min": ai_training_session["duration_min"],
            }
        )

    elif want_matchday:
        action_executed = "apply_matchday"
        ai_matchday_sheet = build_official_matchday_sheet(
            club_name_ar=str(club.get("name_ar") or ""),
            opponent_name_ar=str(opponent.get("name_ar") or ""),
            evaluated_players=evaluated_players,
            formation_code=resolved_form,
            stadium=str(club.get("stadium_ar") or ""),
        )
        structured_cards.append(
            {
                "type": "matchday_applied",
                "starters": len(ai_matchday_sheet["starters"]),
                "subs": len(ai_matchday_sheet["substitutes"]),
                "excluded": len(ai_matchday_sheet["excluded"]),
            }
        )
    else:
        depth = build_squad_depth_report(evaluated_players, formation_code=resolved_form)
        structured_cards.append(
            {
                "type": "squad_overview",
                "fit_count": depth["fit_count"],
                "unavailable_count": depth["unavailable_count"],
                "alerts": depth["shortage_alerts_ar"][:3],
            }
        )

    ctx_block = _build_grounded_context_summary(
        coach_name=coach_name,
        coach_role=coach_role,
        club=target_club or club,
        opponent=opponent,
        evaluated_players=evaluated_players,
        opp_players=opp_players,
        standings=standings,
        formation_code=resolved_form,
    )

    research_block = ""
    if researched_player:
        research_block = (
            "\n\n=== ملف اللاعب الموثّق من البحث الحي قبل الإجابة (365Scores 2026/27) ===\n"
            + _format_player_dossier_text(researched_player, formation_code=resolved_form)
        )

    api_key = _resolve_groq_key()
    answer_text = ""
    engine_used = "coach_pro_grounded"
    primary_model = "llama-3.3-70b-versatile" if model == "auto" else model
    candidate_models = list(dict.fromkeys([primary_model, "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]))

    if api_key:
        system_prompt = (
            "أنت الخبير التكتيكي ومساعد المدرب الذكي في EGY-SCOUT Coach Pro.\n"
            "قواعد صارمة:\n"
            "1. اعتمد على البحث الحي وبيانات القائمة الكاملة المرفقة، ولا تخترع أي رقم أو إحصائية غير موجودة.\n"
            "2. إذا سأل المدرب عن لاعب معين (توظيفه، مركزه، مميزاته وعيوبه، أو كيف يدربه): أجب فوراً بتحليل مباشر ومنظم يشمل:\n"
            "   - المركز الأساسي والبديل بناءً على البيانات الحية الموثقة.\n"
            "   - أين تضعه بالضبط في التشكيل المطلوب وما أدواره في الحالات الثلاث (الاستحواذ / الهجوم / الدفاع).\n"
            "   - المميزات ونقاط الانتباه المستخلصة من مركزه الفعلي وأرقامه الموثقة وأسلوب لعبه، مع الإشارة بوضوح لما هو غير متوفر إن وُجد.\n"
            "   - توصية تدريبية عملية خاصة به.\n"
            "3. أكمل إجابتك للنهاية بشكل واضح ومختصر ومفيد دون قطع الجمل.\n\n"
            f"البيانات الحية الموثّقة الآن:\n{ctx_block}{research_block}"
        )
        msgs: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for h in (history or [])[-10:]:
            if h.get("role") in ("user", "assistant") and h.get("content"):
                msgs.append({"role": h["role"], "content": str(h["content"])[:900]})
        action_note = (
            f"\n[تم رسم خطة {resolved_form} بالحالات الثلاث لـ {len(fit_players)} لاعب جاهز.]"
            if ai_blueprint
            else f"\n[تم توليد وحدة تدريبية {ai_training_session['md_code']} بحمل {ai_training_session['srpe_au']} AU.]"
            if ai_training_session
            else f"\n[تم توليد كشف المباراة الرسمي: {len(ai_matchday_sheet['starters'])} أساسيين + {len(ai_matchday_sheet['substitutes'])} بدلاء.]"
            if ai_matchday_sheet
            else ""
        )
        msgs.append({"role": "user", "content": q + action_note})

        for m_id in candidate_models:
            try:
                r = httpx.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={"model": m_id, "messages": msgs, "temperature": 0.2, "max_tokens": 1800},
                    timeout=22.0,
                )
                if r.status_code == 200:
                    answer_text = str(r.json()["choices"][0]["message"]["content"]).strip()
                    if answer_text:
                        engine_used = f"groq_live:{m_id}"
                        break
            except Exception:
                continue

    if not answer_text:
        greet = f"مرحباً كابتن **{coach_name}**"
        if researched_player:
            tp = researched_player.get("tactical_profile") or {}
            stats = researched_player.get("season_stats") or {}
            comp_str = " | ".join(stats.get("competitions") or []) or "قيد التحديث من البطولة الحالية"
            answer_text = (
                f"{greet} — **تقرير البحث الحي وتوظيف اللاعب: {researched_player.get('name_ar')}** ({researched_player.get('club_name_ar')}):\n\n"
                f"1. **البيانات والمركز الموثق (`365Scores 2026/27`):**\n"
                f"- القميص: `#{researched_player.get('jersey_number') or '-'}` | المركز الأصلي: **{researched_player.get('position_label_ar')} ({researched_player.get('position_code')})**\n"
                f"- العمر: {researched_player.get('age') or '-'} سنة | الطول: {researched_player.get('height_cm') or '-'} سم | الجاهزية: **{researched_player.get('readiness_pct', 100)}%**\n"
                f"- إحصائيات 2026/27: {comp_str}\n\n"
                f"2. **أين تضعه وما المراكز التي يلعب بها؟**\n"
                f"- **المراكز المناسبة:** {'، '.join(tp.get('best_roles_ar') or [])}\n"
                f"- **في خطة 3-4-2-1:** {tp.get('fit_3421') or ''}\n"
                f"- **في خطة {resolved_form}:** {tp.get('fit_4231') or ''}\n\n"
                f"3. **التوصية التدريبية:** ركّز له في حصص `MD-3` و`MD-2` على التحولات في مساحته الأساسية وسرعة التمرير التقدمي."
            )
        elif ai_blueprint:
            starters_preview = "، ".join(
                f"#{n.get('jersey_number', '')} {n.get('player_label', n.get('slot'))} ({n.get('slot')})"
                for n in ai_blueprint.get("nodes", [])[:6]
            )
            answer_text = (
                f"{greet} — تم رسم وتطبيق خطة **{resolved_form}** لـ **{club.get('name_ar')}** بالحالات التكتيكية الثلاث.\n"
                f"- **أبرز الأساسيين:** {starters_preview}"
            )
        elif ai_training_session:
            answer_text = (
                f"{greet} — تم تجهيز وحدة **{ai_training_session['title_ar']}** على لوحة التدريب (`{ai_training_session['srpe_au']} AU`)."
            )
        elif ai_matchday_sheet:
            answer_text = (
                f"{greet} — تم إعداد كشف المباراة الرسمي ({len(ai_matchday_sheet['starters'])} أساسيين + {len(ai_matchday_sheet['substitutes'])} بدلاء)."
            )
        else:
            depth = build_squad_depth_report(evaluated_players, formation_code=resolved_form)
            alerts = "\n- ".join(depth["shortage_alerts_ar"][:3]) or "تغطية جميع المراكز الأساسية مكتملة."
            answer_text = (
                f"{greet} — ملخص **{club.get('name_ar')}** ({resolved_form}):\n"
                f"- الجاهزون: {len(fit_players)} لاعباً | المستبعدون: {len(unavail)} لاعبين.\n"
                f"- تنبيهات العمق: {alerts}"
            )

    return {
        "answer_ar": answer_text,
        "engine": engine_used,
        "action_executed": action_executed,
        "ai_drawing_blueprint": ai_blueprint,
        "ai_training_session": ai_training_session,
        "ai_matchday_sheet": ai_matchday_sheet,
        "researched_player": researched_player,
        "research_sources": (researched_player or {}).get("sources") or [],
        "structured_cards": structured_cards,
        "follow_up_questions": follow_ups,
    }
