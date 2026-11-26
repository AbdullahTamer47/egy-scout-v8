"""Core Groq AI Copilot & 3-Phase Tactical Phase State Generator for EGY-SCOUT Coach Pro V2."""
from __future__ import annotations

import copy
import os
import re
from typing import Any, Optional

import httpx

from packages.coach_engine.director_admin import (
    build_official_matchday_sheet,
    build_squad_depth_report,
)
from packages.coach_engine.training_planner import generate_custom_session_plan
from packages.tactics_engine.moment_analyzer import (
    build_formation_blueprint,
    enrich_arrows_with_probabilities,
    match_masterclass_preset,
)
from packages.tactics_engine.plan_validator import validate_tactical_plan


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
) -> dict[str, Any]:
    """Build 3 distinct, editable tactical phase states (Possession / Attack / Defense) for both clubs."""
    team_name = str(club.get("name_ar") or club.get("name_en") or "فريقك")
    opp_name = str(opponent.get("name_ar") or opponent.get("name_en") or "الخصم")
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
    if len(by_x) >= 6:
        for i, j, lbl in [(1, 4, "كسر الخط الأول"), (4, 7, "دخول نصف المساحة"), (7, len(by_x) - 1, "تمريرة حاسمة للمهاجم"), (5, len(by_x) - 2, "تحول على الطرف")]:
            att_arrows_raw.append({"from_slot": by_x[i]["slot"], "to_slot": by_x[j]["slot"], "label_ar": lbl, "kind": "pass", "color": "#FACC15"})
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
            bits.append(f"{p['age']} سنة")
        if p.get("height_cm"):
            bits.append(f"{p['height_cm']} سم")
        return ", ".join(b for b in bits if b)

    club_lines = [
        f"- #{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({_fmt_bio(p)}, جاهزية {p.get('readiness_pct', 100)}%, إنذارات={p.get('yellow_cards', 0)})"
        for p in fit_p[:18]
    ]
    unavail_lines = [
        f"- #{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({p.get('position')}) -> {p.get('block_reason_ar')}"
        for p in unavail
    ]
    opp_lines = [
        f"- #{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({_fmt_bio(p)})"
        for p in opp_players[:15]
    ]

    club_st = next((s for s in standings if club.get("name_en", "").lower() in str(s.get("team_name", "")).lower()), None)
    opp_st = next((s for s in standings if opponent.get("name_en", "").lower() in str(s.get("team_name", "")).lower()), None)
    st_text = ""
    if club_st or opp_st:
        c_str = f"{club.get('name_ar')}: مركز {club_st['rank']} ({club_st['points']} نقطة من {club_st['played']} مباريات، له {club_st['gf']} وعليه {club_st['ga']})" if club_st else ""
        o_str = f"{opponent.get('name_ar')}: مركز {opp_st['rank']} ({opp_st['points']} نقطة من {opp_st['played']} مباريات، له {opp_st['gf']} وعليه {opp_st['ga']})" if opp_st else ""
        st_text = f"\nالترتيب الحي: {c_str} | {o_str}"

    return (
        f"المدرب: {coach_name} ({coach_role})\n"
        f"الفريق: {club.get('name_ar')} ({club.get('name_en')}) | التشكيل: {formation_code}\n"
        f"المنافس: {opponent.get('name_ar')} ({opponent.get('name_en')}){st_text}\n"
        f"اللاعبون الجاهزون ({len(fit_p)}):\n" + "\n".join(club_lines) + "\n"
        + (f"المستبعدون للإصابة/الإيقاف ({len(unavail)}):\n" + "\n".join(unavail_lines) + "\n" if unavail_lines else "لا يوجد مستبعدون حالياً.\n")
        + (f"مهددون بالإيقاف (إنذاران): {', '.join(str(p.get('name_ar')) for p in warned)}\n" if warned else "")
        + f"أبرز لاعبي المنافس ({len(opp_players)}):\n" + "\n".join(opp_lines)
    )


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
) -> dict[str, Any]:
    """Execute deterministic Coach Pro action (with 3 tactical phases) + grounded Groq LLM coaching response."""
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
        f"ارسم خطة 3-4-2-1 ألونسو لـ {club.get('name_ar')} ضد {opponent.get('name_ar')}",
        f"صمم وحدة تدريبية MD-2 لمواجهة {opponent.get('name_ar')}",
        "جهز كشف المباراة الرسمي مع استبعاد المصابين والموقوفين",
        f"اكتب خطاب غرفة الملابس قبل مواجهة {opponent.get('name_ar')}",
    ]

    want_tactics = any(
        kw in low
        for kw in (
            "خطة", "تكتيك", "تشكيل", "ارسم", "رسم", "ألونسو", "الونسو",
            "جوارديولا", "كلوب", "إنزاجي", "انزاجي", "3-4-2-1", "3421",
            "4-3-3", "433", "4-2-3-1", "4231", "3-5-2", "352", "4-4-2", "5-3-2", "tactic", "formation",
        )
    )
    want_training = any(
        kw in low
        for kw in ("تمرين", "تدريب", "وحدة", "أحمال", "روندو", "بدني", "md-", "md+", "drill", "training", "session")
    )
    want_matchday = any(
        kw in low
        for kw in ("كشف", "قائمة", "اسكور", "اسكور شيت", "موقوف", "مصاب", "إصابات", "إنذار", "البدلاء", "matchday", "lineup", "sheet")
    )

    resolved_form = _detect_formation_code(q, formation_code)
    preset = match_masterclass_preset(q)

    if want_tactics or preset:
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
        club=club,
        opponent=opponent,
        evaluated_players=evaluated_players,
        opp_players=opp_players,
        standings=standings,
        formation_code=resolved_form,
    )

    api_key = _resolve_groq_key()
    answer_text = ""
    engine_used = "coach_pro_deterministic"
    chosen_model = "llama-3.3-70b-versatile" if model == "auto" else model

    if api_key:
        system_prompt = (
            "أنت المساعد الذكي الرئيسي في EGY-SCOUT Coach Pro (مساعد المدير الفني والمدير الإداري).\n"
            "قواعد صارمة:\n"
            "1. خاطب المدرب باسمه بأسلوب احترافي عملي باللغة العربية.\n"
            "2. اعتمد حصراً على قائمة اللاعبين الجاهزين والمستبعدين والأعمار والأطوال والترتيب الحي في البيانات المرفقة. يُمنع منعاً باتاً اختراع أي أسماء أو أرقام.\n"
            "3. عند رسم خطة تكتيكية، وضّح دور الفريقين في الحالات الثلاث: الاستحواذ، الهجوم والاختراق، وقطع الكرة والدفاع.\n\n"
            f"البيانات الحية الموثّقة الآن:\n{ctx_block}"
        )
        msgs: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for h in (history or [])[-4:]:
            if h.get("role") in ("user", "assistant") and h.get("content"):
                msgs.append({"role": h["role"], "content": str(h["content"])[:500]})
        action_note = (
            f"\n[تم رسم خطة {resolved_form} بالحالات الثلاث (الاستحواذ / الهجوم / الدفاع وقطع الكرة) لـ {len(fit_players)} لاعب جاهز واستبعاد {len(unavail)} لاعب.]"
            if ai_blueprint
            else f"\n[تم توليد وحدة تدريبية {ai_training_session['md_code']} بحمل {ai_training_session['srpe_au']} AU.]"
            if ai_training_session
            else f"\n[تم توليد كشف المباراة الرسمي: {len(ai_matchday_sheet['starters'])} أساسيين + {len(ai_matchday_sheet['substitutes'])} بدلاء.]"
            if ai_matchday_sheet
            else ""
        )
        msgs.append({"role": "user", "content": q + action_note})

        try:
            r = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": chosen_model, "messages": msgs, "temperature": 0.25, "max_tokens": 800},
                timeout=16.0,
            )
            if r.status_code == 200:
                answer_text = str(r.json()["choices"][0]["message"]["content"]).strip()
                engine_used = f"groq_live:{chosen_model}"
        except Exception:
            answer_text = ""

    if not answer_text:
        greet = f"مرحباً كابتن **{coach_name}**"
        excl_txt = (
            f"\n- **تنبيه إداري:** تم استبعاد {len(unavail)} لاعب تلقائياً ({', '.join(str(p.get('name_ar')) for p in unavail[:4])})."
            if unavail
            else "\n- جميع لاعبي القائمة جاهزون طبياً وانضباطياً."
        )
        if ai_blueprint:
            starters_preview = "، ".join(
                f"#{n.get('jersey_number', '')} {n.get('player_name', n.get('slot'))} ({n.get('slot')})"
                for n in ai_blueprint.get("nodes", [])[:6]
            )
            answer_text = (
                f"{greet} — تم رسم وتطبيق خطة **{resolved_form}** لـ **{club.get('name_ar')}** ضد **{opponent.get('name_ar')}** بالحالات التكتيكية الثلاث (الاستحواذ / الهجوم / الدفاع وقطع الكرة).{excl_txt}\n"
                f"- **التشكيل الأساسي:** {starters_preview}\n"
                f"- يمكنك سحب أي لاعب، ربط اللاعبين بأسهم مخصصة، التبديل بين الحالات الثلاث، أو تعديل الخطة بحرية مباشرةً على الملعب."
            )
        elif ai_training_session:
            answer_text = (
                f"{greet} — تم تجهيز وتطبيق وحدة **{ai_training_session['title_ar']}** على لوحة التدريب.\n"
                f"- **المدة:** {ai_training_session['duration_min']} دقيقة | **الشدة:** RPE {ai_training_session['target_rpe']} | **الحمل:** `{ai_training_session['srpe_au']} AU`."
            )
        elif ai_matchday_sheet:
            answer_text = (
                f"{greet} — تم إعداد **كشف المباراة الرسمي** لمواجهة **{opponent.get('name_ar')}** ({len(ai_matchday_sheet['starters'])} أساسيين + {len(ai_matchday_sheet['substitutes'])} بدلاء).{excl_txt}"
            )
        else:
            depth = build_squad_depth_report(evaluated_players, formation_code=resolved_form)
            alerts = "\n- ".join(depth["shortage_alerts_ar"][:3]) or "تغطية جميع المراكز الأساسية مكتملة."
            answer_text = (
                f"{greet} — موقف **{club.get('name_ar')}** قبل مواجهة **{opponent.get('name_ar')}** ({resolved_form}):\n"
                f"- **الجاهزون:** {len(fit_players)} لاعباً | **المستبعدون:** {len(unavail)} لاعبين.\n"
                f"- **ملخص المدير الفني:** {alerts}"
            )

    return {
        "answer_ar": answer_text,
        "engine": engine_used,
        "action_executed": action_executed,
        "ai_drawing_blueprint": ai_blueprint,
        "ai_training_session": ai_training_session,
        "ai_matchday_sheet": ai_matchday_sheet,
        "structured_cards": structured_cards,
        "follow_up_questions": follow_ups,
    }
