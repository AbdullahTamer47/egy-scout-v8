"""Core Groq AI Copilot for EGY-SCOUT Coach Pro.

Connects live squad availability, discipline suspensions, weekly training load,
opponent roster/standings, and tactical blueprint drawing into a unified Coach Copilot.
Strictly zero fake names or stats: grounded exclusively in verified & live club data.
"""
from __future__ import annotations

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

    club_lines = [
        f"- #{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({p.get('position')}, readiness {p.get('readiness_pct', 100)}%, YC={p.get('yellow_cards', 0)})"
        for p in fit_p[:16]
    ]
    unavail_lines = [
        f"- #{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({p.get('position')}) -> {p.get('block_reason_ar')}"
        for p in unavail
    ]
    opp_lines = [
        f"- #{p.get('jersey_number')} {p.get('name_ar') or p.get('name_en')} ({p.get('position')})"
        for p in opp_players[:14]
    ]

    club_st = next((s for s in standings if club.get("name_en", "").lower() in str(s.get("team_name", "")).lower()), None)
    opp_st = next((s for s in standings if opponent.get("name_en", "").lower() in str(s.get("team_name", "")).lower()), None)
    st_text = ""
    if club_st or opp_st:
        c_str = f"{club.get('name_ar')}: مركز {club_st['rank']} ({club_st['points']} نقطة من {club_st['played']} مباريات)" if club_st else ""
        o_str = f"{opponent.get('name_ar')}: مركز {opp_st['rank']} ({opp_st['points']} نقطة من {opp_st['played']} مباريات)" if opp_st else ""
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
    """Execute deterministic Coach Pro action + grounded Groq LLM coaching response."""
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
    ]

    want_tactics = any(
        kw in low
        for kw in (
            "خطة", "تكتيك", "تشكيل", "ارسم", "رسم", "ألونسو", "الونسو",
            "جوارديولا", "كلوب", "إنزاجي", "انزاجي", "3-4-2-1", "3421",
            "4-3-3", "433", "4-2-3-1", "4231", "3-5-2", "352", "4-4-2", "tactic", "formation",
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
            bp = build_formation_blueprint(
                formation_code=resolved_form,
                team_name=str(club.get("name_ar") or "فريقك"),
                opponent_name=str(opponent.get("name_ar") or "الخصم"),
                attack_right=True,
                roster_players=fit_players,
                tactical_mode=preset.get("style", "balanced"),
                opponent_formation_code=preset.get("opponent_formation_code", "4-4-2"),
                opponent_roster_players=opp_players,
            )
            bp["title_ar"] = f"{club.get('name_ar')}: {preset['title_ar']}"
            bp["philosophy_ar"] = preset["philosophy_ar"]
            preset_arrows = enrich_arrows_with_probabilities(
                preset.get("passes", []),
                bp["nodes"],
                bp.get("opponent_nodes", []),
                attack_right=True,
            )
            if preset_arrows:
                bp["passing_arrows"] = preset_arrows
        else:
            bp = build_formation_blueprint(
                formation_code=resolved_form,
                team_name=str(club.get("name_ar") or "فريقك"),
                opponent_name=str(opponent.get("name_ar") or "الخصم"),
                attack_right=True,
                roster_players=fit_players,
                tactical_mode=tactical_mode or "balanced",
                opponent_formation_code=opponent_formation_code or "4-4-2",
                opponent_roster_players=opp_players,
                opponent_tactical_mode=opponent_tactical_mode or "balanced",
            )
        bp["kit_colors"] = {
            "team_a_hex": str(club.get("kit_hex") or "#EF4444"),
            "team_b_hex": str(opponent.get("kit_hex") or "#38BDF8"),
        }
        bp["validation"] = validate_tactical_plan(bp["nodes"], bp.get("opponent_nodes", []), formation_code=resolved_form)
        ai_blueprint = bp
        structured_cards.append(
            {
                "type": "tactics_applied",
                "title": bp["title_ar"],
                "fit_used": len(fit_players),
                "excluded": len(unavail),
                "formation": resolved_form,
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
            "2. اعتمد حصراً على قائمة اللاعبين الجاهزين والمستبعدين والترتيب الحي في البيانات المرفقة. يُمنع منعاً باتاً اختراع أسماء لاعبين أو إحصائيات غير موجودة.\n"
            "3. عند وجود لاعبين مصابين أو موقوفين بـ 3 إنذارات، نبه المدرب فوراً ولا تضعهم في التشكيل الأساسي.\n"
            "4. إذا تم تنفيذ إجراء عملي (رسم خطة / وحدة تدريبية / كشف مباراة)، اشرح خطوات التنفيذ على أرض الملعب بإيجاز ودقة.\n\n"
            f"البيانات الحية الموثّقة الآن:\n{ctx_block}"
        )
        msgs: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        for h in (history or [])[-4:]:
            if h.get("role") in ("user", "assistant") and h.get("content"):
                msgs.append({"role": h["role"], "content": str(h["content"])[:500]})
        action_note = (
            f"\n[تم تجهيز خطة {resolved_form} لـ {len(fit_players)} لاعب جاهز واستبعاد {len(unavail)} لاعب غير متاح.]"
            if ai_blueprint
            else f"\n[تم توليد وحدة تدريبية {ai_training_session['md_code']} بحمل {ai_training_session['srpe_au']} AU.]"
            if ai_training_session
            else f"\n[تم توليد كشف المباراة الرسمي: {len(ai_matchday_sheet['starters'])} أساسيين + {len(ai_matchday_sheet['substitutes'])} بدلاء + {len(ai_matchday_sheet['excluded'])} مستبعدين.]"
            if ai_matchday_sheet
            else ""
        )
        msgs.append({"role": "user", "content": q + action_note})

        try:
            r = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": chosen_model, "messages": msgs, "temperature": 0.25, "max_tokens": 750},
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
                f"{greet} — تم رسم وتطبيق خطة **{resolved_form}** لـ **{club.get('name_ar')}** ضد **{opponent.get('name_ar')}** على السبورة التكتيكية مباشرةً بالاعتماد على اللاعبين الجاهزين فقط.{excl_txt}\n"
                f"- **نماذج من التمركز:** {starters_preview}\n"
                f"- يمكنك سحب أي لاعب أو تعديل أسهم التمرير وسيتم فحص المسافات رياضياً فوراً."
            )
        elif ai_training_session:
            answer_text = (
                f"{greet} — تم تجهيز وتطبيق وحدة **{ai_training_session['title_ar']}** على لوحة التدريب.\n"
                f"- **المدة:** {ai_training_session['duration_min']} دقيقة | **الشدة المستهدفة:** RPE {ai_training_session['target_rpe']} | **الحمل التدريبي:** `{ai_training_session['srpe_au']} AU`.\n"
                f"- **نقطة تركيز:** {ai_training_session['coaching_points_ar'][0] if ai_training_session.get('coaching_points_ar') else ''}"
            )
        elif ai_matchday_sheet:
            answer_text = (
                f"{greet} — تم إعداد **كشف المباراة الرسمي** لمواجهة **{opponent.get('name_ar')}**:\n"
                f"- **الأساسيون (11 متاحاً):** {', '.join(str(p.get('name_ar')) for p in ai_matchday_sheet['starters'][:5])}...\n"
                f"- **البدلاء:** {len(ai_matchday_sheet['substitutes'])} لاعبين | **القائد:** {ai_matchday_sheet['captain_name']}.{excl_txt}"
            )
        else:
            depth = build_squad_depth_report(evaluated_players, formation_code=resolved_form)
            alerts = "\n- ".join(depth["shortage_alerts_ar"][:3]) or "تغطية جميع المراكز الأساسية مكتملة."
            answer_text = (
                f"{greet} — موقف **{club.get('name_ar')}** الآن قبل مواجهة **{opponent.get('name_ar')}** ({resolved_form}):\n"
                f"- **الجاهزون:** {len(fit_players)} لاعباً | **المستبعدون:** {len(unavail)} لاعبين.\n"
                f"- **تقرير المدير الفني:** {alerts}"
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
