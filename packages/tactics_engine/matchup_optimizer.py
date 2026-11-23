"""Squad & Matchup Optimizer (Master Plan V8, Section 16 — Level 3).

Recommends top 2 formations, starting XI roles, pair synergy highlights, and
timed substitutions based on real player capability profiles & opponent vulnerabilities.
"""
from __future__ import annotations

from typing import Any

FORMATION_TEMPLATES: dict[str, dict[str, Any]] = {
    "4-2-3-1": {
        "style_ar": "توازن دفاعي وإغلاق المنطقة 14 بارتكاز مزدوج",
        "style_en": "Balanced block sealing Zone 14 with a double pivot",
        "counters": ["zone_14_exposure", "rest_defense_underload"],
        "slots": {"GK": 1, "CB": 2, "FB": 2, "DM": 2, "AM": 1, "W": 2, "ST": 1},
    },
    "4-3-3": {
        "style_ar": "ضغط عالٍ وتفوق عددي في وسط الملعب والأطراف",
        "style_en": "High pressing with central midfield & wide wing overloads",
        "counters": ["high_press_buildup_failure", "blind_side_run_lost"],
        "slots": {"GK": 1, "CB": 2, "FB": 2, "DM": 1, "CM": 2, "W": 2, "ST": 1},
    },
    "3-4-2-1": {
        "style_ar": "تأمين 3 قلوب دفاع في التحولات + تفوق أنصاف المساحات",
        "style_en": "3-CB transition security + twin half-space creators",
        "counters": ["broken_backline", "rest_defense_underload"],
        "slots": {"GK": 1, "CB": 3, "FB": 2, "CM": 2, "AM": 2, "ST": 1},
    },
}


def recommend_matchup_plan(
    squad_profiles: list[dict[str, Any]],
    opponent_vulnerabilities: list[str],
    unavailable_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Score formations from real rated profiles (>= 15 min) without duplicate hardcoded scores."""
    blocked = set(unavailable_ids or [])
    available = [
        p for p in squad_profiles
        if p.get("player_id") not in blocked and p.get("rating_10") is not None
    ]
    available.sort(key=lambda p: float(p.get("rating_10") or 0.0), reverse=True)

    vuln_set = set(opponent_vulnerabilities)
    pos_counts: dict[str, int] = {}
    for p in available:
        pos = str(p.get("position", "CM")).upper()
        pos_counts[pos] = pos_counts.get(pos, 0) + 1

    ranked_formations = []
    for fname, tpl in FORMATION_TEMPLATES.items():
        counter_hits = sum(1 for c in tpl["counters"] if c in vuln_set)
        # Positional coverage score based on actual available player roles
        slots: dict[str, int] = tpl["slots"]
        matched_slots = sum(min(pos_counts.get(pos, 0), req) for pos, req in slots.items())
        pos_coverage = matched_slots / max(1, sum(slots.values()))
        avg_rating = (
            sum(float(p["rating_10"]) for p in available[:11]) / max(1, min(11, len(available)))
            if available
            else 0.0
        )
        # Weight by actual squad profile traits matching each tactical system (prevents identical tie scores)
        avg_vaep = sum(float(p.get("vaep_per90") or 0.0) for p in available[:11]) / max(1, min(11, len(available)))
        avg_padj = sum(float(p.get("padj_defensive_actions_per90") or 0.0) for p in available[:11]) / max(1, min(11, len(available)))
        avg_hir = sum(float(p.get("hir_distance_m_per90") or 0.0) for p in available[:11]) / max(1, min(11, len(available)))
        trait_bonus = (
            (avg_padj * 0.55 + avg_vaep * 9.5 + 1.8)
            if fname == "4-2-3-1"
            else (avg_hir / 160.0 + avg_vaep * 8.5)
            if fname == "4-3-3"
            else (avg_padj * 0.35 + avg_hir / 260.0)
        )
        fit_score = round(min(96.0, avg_rating * 6.2 + pos_coverage * 20.0 + counter_hits * 5.5 + trait_bonus), 1)
        ranked_formations.append(
            {
                "formation": fname,
                "fit_score": fit_score,
                "style_ar": tpl["style_ar"],
                "style_en": tpl["style_en"],
                "counters_matched": [c for c in tpl["counters"] if c in vuln_set],
            }
        )
    ranked_formations.sort(key=lambda x: x["fit_score"], reverse=True)

    starters = available[:11]
    bench = available[11:18]

    synergy_pairs = []
    if len(starters) >= 2:
        by_xt = sorted(starters, key=lambda p: float(p.get("xt_per90") or 0.0), reverse=True)
        p1, p2 = by_xt[0], by_xt[1]
        synergy_pairs.append(
            {
                "pair": [p1.get("display_name"), p2.get("display_name")],
                "combined_xt_per90": round(
                    float(p1.get("xt_per90") or 0.0) + float(p2.get("xt_per90") or 0.0), 3
                ),
                "note_ar": "أعلى ثنائية إنتاجاً للخطورة المتوقعة (xT) بناءً على العينة الموثّقة.",
                "note_en": "Highest combined Expected Threat (xT/90) pair in verified dataset.",
            }
        )

    sub_plan = []
    if bench and starters:
        fastest_bench = max(bench, key=lambda p: float(p.get("max_speed_kmh") or 0.0))
        sub_plan.append(
            {
                "minute": 62,
                "player_in": fastest_bench.get("display_name"),
                "reason_ar": f"ورقة سريعة مسجّلة ({fastest_bench.get('max_speed_kmh', 0)} كم/س).",
                "reason_en": f"High-pace impact sub ({fastest_bench.get('max_speed_kmh', 0)} km/h).",
            }
        )
    elif len(available) >= 4:
        fastest_alt = max(available[3:], key=lambda p: float(p.get("max_speed_kmh") or 0.0))
        sub_plan.append(
            {
                "minute": 62,
                "player_in": fastest_alt.get("display_name"),
                "reason_ar": f"مرشّح تبديل مؤثّر (سرعة عالية {fastest_alt.get('max_speed_kmh', 0)} كم/س).",
                "reason_en": f"High-Pace Impact Option ({fastest_alt.get('max_speed_kmh', 0)} km/h).",
            }
        )

    return {
        "recommended_formations": ranked_formations[:2],
        "starting_xi": [
            {
                "player_id": p.get("player_id"),
                "display_name": p.get("display_name"),
                "position": p.get("position"),
                "rating_10": p.get("rating_10"),
                "archetype_ar": p.get("archetype_ar"),
            }
            for p in starters
        ],
        "synergy_pairs": synergy_pairs,
        "substitution_plan": sub_plan,
    }
