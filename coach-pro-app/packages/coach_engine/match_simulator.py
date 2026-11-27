"""Full-Match Tactical Monte Carlo Simulator & AI Formation-Aware Lineup Swap Advisor."""
from __future__ import annotations

import math
import random
from typing import Any, Optional

# Compatible positions matrix (score 1.0 = exact, 0.8 = strong secondary, 0.55 = emergency, 0.1 = mismatch)
_SLOT_COMPAT: dict[str, dict[str, float]] = {
    "GK": {"GK": 1.0},
    "CB": {"CB": 1.0, "RCB": 0.95, "LCB": 0.95, "DM": 0.72, "RB": 0.65, "LB": 0.65},
    "RB": {"RB": 1.0, "RWB": 0.95, "CB": 0.72, "RM": 0.78, "DM": 0.65},
    "LB": {"LB": 1.0, "LWB": 0.95, "CB": 0.72, "LM": 0.78, "DM": 0.65},
    "RWB": {"RWB": 1.0, "RB": 0.95, "RM": 0.90, "RW": 0.80, "CM": 0.60},
    "LWB": {"LWB": 1.0, "LB": 0.95, "LM": 0.90, "LW": 0.80, "CM": 0.60},
    "DM": {"DM": 1.0, "CDM": 1.0, "CM": 0.88, "CB": 0.70, "CAM": 0.60},
    "CM": {"CM": 1.0, "DM": 0.88, "CDM": 0.88, "CAM": 0.84, "RM": 0.72, "LM": 0.72},
    "CAM": {"CAM": 1.0, "CM": 0.84, "RW": 0.82, "LW": 0.82, "RM": 0.76, "LM": 0.76, "ST": 0.72},
    "RM": {"RM": 1.0, "RW": 0.94, "RWB": 0.88, "RB": 0.78, "CAM": 0.78, "CM": 0.72},
    "LM": {"LM": 1.0, "LW": 0.94, "LWB": 0.88, "LB": 0.78, "CAM": 0.78, "CM": 0.72},
    "RW": {"RW": 1.0, "RM": 0.92, "CAM": 0.84, "LW": 0.82, "ST": 0.76, "RWB": 0.70},
    "LW": {"LW": 1.0, "LM": 0.92, "CAM": 0.84, "RW": 0.82, "ST": 0.76, "LWB": 0.70},
    "ST": {"ST": 1.0, "CF": 1.0, "RW": 0.78, "LW": 0.78, "CAM": 0.72},
}


def _canonical_slot(slot: str) -> str:
    s = (slot or "CM").upper().strip()
    mapping = {
        "RCB": "CB", "LCB": "CB", "CCB": "CB", "FIX": "CB",
        "RDM": "DM", "LDM": "DM", "CDM": "DM",
        "RCM": "CM", "LCM": "CM",
        "RAM": "CAM", "LAM": "CAM", "AM": "CAM",
        "RST": "ST", "LST": "ST", "CF": "ST", "PIV": "ST",
        "ALA": "RW",
    }
    return mapping.get(s, s if s in _SLOT_COMPAT else "CM")


def _fit_score(player: dict[str, Any], slot: str) -> float:
    ppos = _canonical_slot(str(player.get("position") or "CM"))
    tpos = _canonical_slot(slot)
    if tpos == "GK":
        base = 100.0 if ppos == "GK" else 5.0
    elif ppos == "GK":
        base = 5.0
    else:
        compat = (_SLOT_COMPAT.get(tpos) or {}).get(ppos, 0.35)
        base = compat * 78.0

    ready = float(player.get("readiness_pct") or 100) / 100.0
    elig = 1.0 if player.get("is_eligible_starter", True) else 0.12
    ls = player.get("live_stats") or {}
    apps = float(ls.get("appearances") or 0)
    goals = float(ls.get("goals") or 0)
    assists = float(ls.get("assists") or 0)
    form_bonus = min(14.0, apps * 0.45 + goals * 1.4 + assists * 1.1)
    warn_pen = 4.0 if int(player.get("yellow_cards") or 0) >= 2 else 0.0
    return round(max(1.0, (base + form_bonus) * ready * elig - warn_pen), 1)


def _match_node_player(node: dict[str, Any], by_jersey: dict[int, dict[str, Any]]) -> Optional[dict[str, Any]]:
    jn = node.get("jersey_number")
    if jn is not None:
        try:
            p = by_jersey.get(int(jn))
            if p:
                return p
        except Exception:
            pass
    return None


def suggest_tactical_lineup_swaps(
    club: dict[str, Any],
    formation_code: str,
    current_nodes: list[dict[str, Any]],
    opponent: Optional[dict[str, Any]] = None,
    line_height: str = "mid",
    pressing_style: str = "trigger",
) -> dict[str, Any]:
    """Recommend concrete tactical XI upgrades from bench players based on formation & roles."""
    players = list(club.get("players") or [])
    by_jersey = {int(p["jersey_number"]): p for p in players if p.get("jersey_number") is not None}

    starter_jerseys: set[int] = set()
    for n in current_nodes:
        if n.get("jersey_number") is not None:
            try:
                starter_jerseys.add(int(n["jersey_number"]))
            except Exception:
                pass

    bench = [p for p in players if int(p.get("jersey_number") or -999) not in starter_jerseys and p.get("is_eligible_starter", True)]
    used_bench: set[int] = set()
    suggestions: list[dict[str, Any]] = []
    issues: list[str] = []
    total_fit = 0.0

    for idx, n in enumerate(current_nodes):
        slot = str(n.get("slot") or "CM")
        cur_p = _match_node_player(n, by_jersey)
        cur_score = _fit_score(cur_p, slot) if cur_p else 25.0
        total_fit += cur_score

        if cur_p and not cur_p.get("is_eligible_starter", True):
            issues.append(f"#{cur_p.get('jersey_number')} {cur_p.get('name_ar')} ({slot}) غير مؤهل: {cur_p.get('block_reason_ar')}")
        elif cur_p and _canonical_slot(str(cur_p.get("position") or "")) != _canonical_slot(slot):
            compat = (_SLOT_COMPAT.get(_canonical_slot(slot)) or {}).get(_canonical_slot(str(cur_p.get("position") or "")), 0.35)
            if compat < 0.72:
                issues.append(f"#{cur_p.get('jersey_number')} {cur_p.get('name_ar')} مركزه الأصلي {cur_p.get('position')} ويلعب في {slot}")

        # Find best available bench replacement for this slot
        best_cand: Optional[dict[str, Any]] = None
        best_cand_score = cur_score
        for bp in bench:
            bj = int(bp.get("jersey_number") or 0)
            if bj in used_bench:
                continue
            sc = _fit_score(bp, slot)
            # Only recommend if strictly better by meaningful margin or fixing ineligible/mismatch
            threshold = 0.5 if (not cur_p or not cur_p.get("is_eligible_starter", True)) else 6.0
            if sc > best_cand_score + threshold:
                best_cand_score = sc
                best_cand = bp

        if best_cand:
            used_bench.add(int(best_cand.get("jersey_number") or 0))
            gain = round(best_cand_score - cur_score, 1)
            is_urgent = not cur_p or not cur_p.get("is_eligible_starter", True)
            reason = (
                f"بديل جاهز متخصص في مركز ({slot})"
                if is_urgent
                else f"ملاءمة تكتيكية أعلى لمركز {slot} في خطة {formation_code} (+{gain} نقطة)"
            )
            ls = best_cand.get("live_stats") or {}
            stat_hint = ""
            if ls.get("appearances"):
                stat_hint = f" ({ls['appearances']} مباراة، {ls.get('goals') or 0} أهداف، {ls.get('assists') or 0} صناعة)"
            suggestions.append({
                "slot": slot,
                "node_index": idx,
                "out_jersey": n.get("jersey_number"),
                "out_name_ar": cur_p.get("name_ar") if cur_p else n.get("player_label", slot),
                "out_pos": cur_p.get("position") if cur_p else "-",
                "in_jersey": best_cand.get("jersey_number"),
                "in_name_ar": best_cand.get("name_ar"),
                "in_pos": best_cand.get("position"),
                "in_photo_url": best_cand.get("photo_url"),
                "gain_points": gain,
                "priority": "urgent" if is_urgent else "tactical",
                "reason_ar": reason + stat_hint,
                "tactical_impact_ar": f"يرفع التوافق الجماعي عند التطبيق في الحالات الثلاث ({line_height}/{pressing_style}).",
            })

    suggestions.sort(key=lambda s: (0 if s["priority"] == "urgent" else 1, -s["gain_points"]))
    avg_fit = round(min(99.0, total_fit / max(1, len(current_nodes))), 1)
    summary = (
        f"تقييم توافق التشكيل لخطة {formation_code}: {avg_fit}/100"
        + (f" — يوجد {len(suggestions)} تبديلات مقترحة لتحسين المراكز." if suggestions else " — التوزيع الحالي مثالي ومتوازن في كل الخطوط.")
    )

    return {
        "formation_code": formation_code,
        "squad_fit_score": avg_fit,
        "current_issues_ar": issues[:5],
        "suggestions": suggestions[:6],
        "summary_ar": summary,
    }


def _poisson(rng: random.Random, lam: float) -> int:
    L = math.exp(-max(0.05, min(6.0, lam)))
    k = 0
    p = 1.0
    while p > L:
        k += 1
        p *= rng.random()
    return k - 1


def simulate_tactical_match(
    club: dict[str, Any],
    opponent: dict[str, Any],
    formation_a: str,
    formation_b: str,
    nodes_a: list[dict[str, Any]],
    nodes_b: Optional[list[dict[str, Any]]] = None,
    line_height: str = "mid",
    pressing_style: str = "trigger",
    mode: str = "full_match",
    standings: Optional[list[dict[str, Any]]] = None,
    n_rollouts: int = 5000,
) -> dict[str, Any]:
    """Run accurate seeded Monte Carlo simulation for Full Match (90m) or targeted match phases."""
    players_a = list(club.get("players") or [])
    by_jersey_a = {int(p["jersey_number"]): p for p in players_a if p.get("jersey_number") is not None}

    # 1. Measure XI Tactical Fit & Readiness from exact pitch nodes
    fit_scores = []
    att_boost = 0.0
    for n in (nodes_a or [])[:11]:
        p = _match_node_player(n, by_jersey_a)
        sc = _fit_score(p, str(n.get("slot") or "CM")) if p else 58.0
        fit_scores.append(sc)
        if p and str(n.get("slot") or "") in ("ST", "RW", "LW", "CAM", "RAM", "LAM"):
            ls = p.get("live_stats") or {}
            att_boost += float(ls.get("goals") or 0) * 0.015 + float(ls.get("assists") or 0) * 0.012
    xi_quality = (sum(fit_scores) / max(1, len(fit_scores))) / 100.0

    # 2. Standings strength delta if present
    rank_delta = 0.0
    if standings:
        cid_a = str(club.get("club_id") or "")
        cid_b = str(opponent.get("club_id") or "")
        st_a = next((s for s in standings if s.get("team_id") == cid_a or str(club.get("name_en", "")).lower() in str(s.get("team_name", "")).lower()), None)
        st_b = next((s for s in standings if s.get("team_id") == cid_b or str(opponent.get("name_en", "")).lower() in str(s.get("team_name", "")).lower()), None)
        if st_a and st_b:
            ppg_a = float(st_a.get("points") or 0) / max(1, float(st_a.get("played") or 1))
            ppg_b = float(st_b.get("points") or 0) / max(1, float(st_b.get("played") or 1))
            rank_delta = max(-0.45, min(0.45, (ppg_a - ppg_b) * 0.38))

    # 3. Line height & pressing modifiers (authentic football risk-reward)
    lh_att = {"low": -0.14, "mid": 0.04, "high": 0.22}.get(line_height, 0.04)
    lh_def_risk = {"low": -0.16, "mid": 0.0, "high": 0.20}.get(line_height, 0.0)
    pr_att = {"contain": -0.06, "trigger": 0.12, "gegenpress": 0.24}.get(pressing_style, 0.12)
    pr_def_risk = {"contain": -0.10, "trigger": 0.04, "gegenpress": 0.17}.get(pressing_style, 0.04)

    base_xg_a = 1.25 + (xi_quality - 0.68) * 1.15 + att_boost * 0.35 + rank_delta + lh_att + pr_att
    base_xg_b = 1.05 - (xi_quality - 0.68) * 0.55 - rank_delta + lh_def_risk + pr_def_risk

    mode_clean = mode if mode in ("full_match", "high_press_buildup", "counter_attack", "low_block_break", "set_pieces") else "full_match"
    if mode_clean == "high_press_buildup":
        base_xg_a += 0.26 if pressing_style != "contain" else -0.15
        base_xg_b += 0.16 if line_height == "high" else 0.0
    elif mode_clean == "counter_attack":
        base_xg_a += 0.22 if line_height != "high" else -0.08
        base_xg_b -= 0.12
    elif mode_clean == "low_block_break":
        base_xg_a += 0.18 if ("3-4-2-1" in formation_a or "3-2-4-1" in formation_a or "4-2-3-1" in formation_a) else 0.04
        base_xg_b -= 0.18
    elif mode_clean == "set_pieces":
        base_xg_a = max(0.32, 0.44 + (xi_quality - 0.65) * 0.4)
        base_xg_b = 0.26

    lam_a = round(max(0.25, min(3.4, base_xg_a)), 2)
    lam_b = round(max(0.20, min(3.1, base_xg_b)), 2)

    seed_val = sum(ord(c) for c in f"{club.get('club_id')}:{formation_a}:{line_height}:{pressing_style}:{mode_clean}")
    rng = random.Random(seed_val)
    wins = draws = losses = 0
    score_hist: dict[str, int] = {}
    rollouts = max(500, min(8000, int(n_rollouts)))

    for _ in range(rollouts):
        ga = _poisson(rng, lam_a)
        gb = _poisson(rng, lam_b)
        if ga > gb:
            wins += 1
        elif ga == gb:
            draws += 1
        else:
            losses += 1
        key = f"{ga}-{gb}"
        score_hist[key] = score_hist.get(key, 0) + 1

    win_pct = round((wins / rollouts) * 100.0, 1)
    draw_pct = round((draws / rollouts) * 100.0, 1)
    loss_pct = round(100.0 - win_pct - draw_pct, 1)

    poss_a = round(max(32.0, min(72.0, 50.0 + (lh_att + pr_att) * 26.0 + rank_delta * 14.0)), 1)
    ppda_a = round(max(5.8, min(16.5, 11.5 - {"contain": -2.5, "trigger": 1.6, "gegenpress": 4.2}.get(pressing_style, 1.5))), 1)
    field_tilt = round(max(34.0, min(74.0, poss_a + 3.2)), 1)

    top_scores = [
        {"score": k, "prob_pct": round((v / rollouts) * 100.0, 1)}
        for k, v in sorted(score_hist.items(), key=lambda kv: -kv[1])[:4]
    ]

    # 6 x 15-min Momentum Timeline
    phase_weights = [(0.16, 0.14), (0.18, 0.16), (0.15, 0.17), (0.18, 0.16), (0.17, 0.19), (0.16, 0.18)]
    labels = ["0-15'", "15-30'", "30-45'", "45-60'", "60-75'", "75-90'"]
    momentum = []
    for i, (wa, wb) in enumerate(phase_weights):
        ctrl = max(34.0, min(72.0, poss_a + (4.0 if (i in (1, 3) and pressing_style == "gegenpress") else -3.0 if i == 5 else 0.0)))
        momentum.append({
            "window": labels[i],
            "team_a_xg": round(lam_a * wa, 2),
            "team_b_xg": round(lam_b * wb, 2),
            "control_pct": round(ctrl, 1),
        })

    opp_lbl = f"لـ {opponent.get('name_ar')}" if opponent.get("club_id") != "none" else "للخصم الافتراضي"
    insights = [
        f"توافق التشكيل الأساسي الحالي لـ {club.get('name_ar', 'الفريق')} بلغ {round(xi_quality * 100, 1)}% بخطة {formation_a}.",
        f"متوسط الأهداف المتوقعة (xG): {lam_a} لصالح {club.get('name_ar', 'فريقك')} مقابل {lam_b} {opp_lbl}.",
        f"مؤشر الضغط المتوقع: {ppda_a} PPDA واستحواذ متوقع {poss_a}% (Field Tilt {field_tilt}%).",
    ]
    warnings: list[str] = []
    if line_height == "high" and pressing_style == "gegenpress":
        warnings.append("ارتفاع خط الدفاع مع الضغط العكسي يزيد خطورة الكرات الطويلة في ظهر الثلاثي/الرباعي الخلفي آخر 25 دقيقة.")
    if xi_quality < 0.72:
        warnings.append("يوجد لاعبون خارج مراكزهم الأصلية في التشكيل الحالي — استخدم «ترشيح التبديلات» لرفع جودة المحاكاة.")

    return {
        "mode": mode_clean,
        "rollouts": rollouts,
        "win_prob_pct": win_pct,
        "draw_prob_pct": draw_pct,
        "loss_prob_pct": loss_pct,
        "xg_team_a": lam_a,
        "xg_team_b": lam_b,
        "possession_pct_a": poss_a,
        "ppda_a": ppda_a,
        "field_tilt_pct_a": field_tilt,
        "xi_quality_pct": round(xi_quality * 100.0, 1),
        "top_scorelines": top_scores,
        "momentum_blocks": momentum,
        "tactical_insights_ar": insights,
        "risk_warnings_ar": warnings,
    }
