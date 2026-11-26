"""FastAPI routes for EGY-SCOUT Coach Pro (Coach, Training, Technical Director, Team Admin & Core AI Copilot)."""
from __future__ import annotations

import threading
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from apps.api.rbac import TenantContext, get_tenant_context
from packages.coach_engine.ai_copilot import (
    build_three_phase_tactical_package,
    run_coach_copilot_chat,
)
from packages.coach_engine.director_admin import (
    CoachProStore,
    build_official_matchday_sheet,
    build_squad_depth_report,
    compute_foreign_quota,
    evaluate_squad_availability,
    render_matchday_sheet_html,
    render_training_session_html,
    search_egyptian_league_players,
)
from packages.coach_engine.live_data_hub import (
    EGYPTIAN_CLUB_PRESETS,
    SUPPORTED_LEAGUES,
    fetch_live_league_hub,
    load_all_coach_clubs,
    sync_espn_team_roster,
    sync_wikipedia_club_squad,
)
from packages.coach_engine.training_planner import (
    PRO_DRILLS_CATALOG,
    WEEKLY_MICROCYCLE_TEMPLATES,
    evaluate_weekly_microcycle_safety,
    generate_custom_session_plan,
)
from packages.innovation_lab.kinematic_sandbox import optimize_set_piece_self_play
from packages.shared_contracts.config import get_data_paths
from packages.shared_contracts.lineup_connector import parse_scoresheet_text

router = APIRouter(prefix="/api/coach", tags=["coach-pro"])

_COACH_STORE: Optional[CoachProStore] = None
_STORE_LOCK = threading.Lock()


def get_coach_store() -> CoachProStore:
    global _COACH_STORE
    with _STORE_LOCK:
        if _COACH_STORE is None:
            db_path = get_data_paths().root / "coach_pro.sqlite3"
            _COACH_STORE = CoachProStore(db_path)
        return _COACH_STORE


def _enrich_club_with_admin(store: CoachProStore, tenant_id: str, club: dict[str, Any]) -> dict[str, Any]:
    cid = str(club.get("club_id") or "")
    admin_map = store.get_admin_statuses(tenant_id, cid)
    evaluated = evaluate_squad_availability(list(club.get("players") or []), admin_map)
    return {**club, "players": evaluated}


@router.get("/profile")
def api_coach_get_profile(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:tactics")
    store = get_coach_store()
    prof = store.get_coach_profile(ctx.tenant_id)
    return {"configured": bool(prof), "profile": prof}


@router.post("/profile")
def api_coach_save_profile(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    store = get_coach_store()
    try:
        prof = store.save_coach_profile(
            tenant_id=ctx.tenant_id,
            coach_name=str(payload.get("coach_name") or ""),
            coach_role=str(payload.get("coach_role") or "head_coach"),
            club_id=str(payload.get("club_id") or "al_ahly"),
            opponent_id=str(payload.get("opponent_id") or "zamalek"),
            formation=str(payload.get("formation") or "4-2-3-1"),
        )
        return {"configured": True, "profile": prof}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/clubs")
def api_coach_clubs(
    league: str = "egy.1",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    store = get_coach_store()
    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    standings: list[dict[str, Any]] = []
    try:
        hub = fetch_live_league_hub(league_id=league, force_refresh=False)
        standings = list(hub.get("standings") or [])
    except Exception:
        standings = []

    st_by_cid = {str(s.get("team_id") or ""): s for s in standings if s.get("team_id")}
    items = []
    for cid, c in clubs_map.items():
        st = st_by_cid.get(cid)
        items.append(
            {
                "club_id": cid,
                "name_ar": c.get("name_ar") or cid,
                "name_en": c.get("name_en") or cid,
                "kit_hex": c.get("kit_hex") or "#10B981",
                "stadium_ar": c.get("stadium_ar") or "",
                "city_ar": c.get("city_ar") or "",
                "league_id": c.get("league_id") or "egy.1",
                "season": c.get("season") or "2026/2027",
                "source": c.get("source") or "",
                "player_count": len(c.get("players") or []),
                "live_rank": st.get("rank") if st else None,
                "live_points": st.get("points") if st else None,
                "live_played": st.get("played") if st else None,
                "logo_url": c.get("logo_url") or (st.get("logo_url") if st else ""),
                "wiki_page": (EGYPTIAN_CLUB_PRESETS.get(cid) or {}).get("wiki_page"),
            }
        )
    items.sort(key=lambda x: (0 if x["league_id"] == "egy.1" else 1, x["live_rank"] or 999, -x["player_count"], x["name_en"]))
    return {"clubs": items, "wiki_presets": EGYPTIAN_CLUB_PRESETS}


@router.get("/clubs/{club_id}")
def api_coach_club_detail(
    club_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    store = get_coach_store()
    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    club = clubs_map.get(club_id)
    if not club:
        raise HTTPException(status_code=404, detail=f"Club {club_id} not found")
    return _enrich_club_with_admin(store, ctx.tenant_id, club)


@router.get("/overview")
def api_coach_overview(
    club_id: Optional[str] = None,
    opponent_id: Optional[str] = None,
    league: str = "egy.1",
    formation: Optional[str] = None,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    store = get_coach_store()
    profile = store.get_coach_profile(ctx.tenant_id)

    active_cid = club_id or (profile or {}).get("club_id") or "al_ahly"
    active_oid = opponent_id or (profile or {}).get("opponent_id") or "zamalek"
    active_form = formation or (profile or {}).get("formation") or "4-2-3-1"

    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    club_raw = clubs_map.get(active_cid) or next(iter(clubs_map.values()))
    opp_raw = clubs_map.get(active_oid) or next((v for k, v in clubs_map.items() if k != club_raw["club_id"]), club_raw)

    # Auto-hydrate on demand if a club has 0 cached players and has a Wikipedia preset
    if not club_raw.get("players") and active_cid in EGYPTIAN_CLUB_PRESETS:
        try:
            preset = EGYPTIAN_CLUB_PRESETS[active_cid]
            club_raw = sync_wikipedia_club_squad(
                preset["wiki_page"],
                active_cid,
                name_ar=preset["name_ar"],
                name_en=preset["name_en"],
                kit_hex=preset["kit_hex"],
                ar_wiki_page=preset.get("ar_wiki_page"),
                stadium_ar=preset.get("stadium_ar", ""),
                city_ar=preset.get("city_ar", ""),
            )
            store.save_club_roster(ctx.tenant_id, active_cid, club_raw)
        except Exception:
            pass

    club_enriched = _enrich_club_with_admin(store, ctx.tenant_id, club_raw)
    opp_enriched = _enrich_club_with_admin(store, ctx.tenant_id, opp_raw)
    depth = build_squad_depth_report(club_enriched["players"], formation_code=active_form)
    matchday_sheet = build_official_matchday_sheet(
        club_name_ar=str(club_enriched.get("name_ar") or ""),
        opponent_name_ar=str(opp_enriched.get("name_ar") or ""),
        evaluated_players=club_enriched["players"],
        formation_code=active_form,
        stadium=str(club_enriched.get("stadium_ar") or ""),
    )

    sessions = store.list_training_sessions(ctx.tenant_id, active_cid)
    weekly_safety = evaluate_weekly_microcycle_safety(sessions)

    try:
        live_hub = fetch_live_league_hub(league_id=league, force_refresh=False)
    except Exception:
        live_hub = {"league_id": league, "standings": [], "upcoming_fixtures": [], "recent_results": [], "is_live": False}

    foreign_quota = compute_foreign_quota(club_enriched["players"])
    st_list = list(live_hub.get("standings") or [])
    c_st = next((s for s in st_list if s.get("team_id") == active_cid), None)
    o_st = next((s for s in st_list if s.get("team_id") == active_oid), None)
    brief_ar = [
        f"القائمة المتاحة: {depth['fit_count']} لاعباً جاهزاً مقابل {depth['unavailable_count']} مستبعداً لإصابة أو إيقاف ({foreign_quota['foreign_count']}/{foreign_quota['limit']} أجانب).",
        (
            f"الترتيب الحي: {club_enriched['name_ar']} في المركز #{c_st['rank']} ({c_st['points']} نقطة) مقابل {opp_enriched['name_ar']} في المركز #{o_st['rank']} ({o_st['points']} نقطة)."
            if c_st and o_st
            else f"مواجهة {club_enriched['name_ar']} ({len(club_enriched['players'])} لاعباً) ضد {opp_enriched['name_ar']} ({len(opp_enriched['players'])} لاعباً) بتشكيل {active_form}."
        ),
        depth["shortage_alerts_ar"][0] if depth["shortage_alerts_ar"] else "توازن مثالي في جميع خطوط التشكيل الأساسي دون نقص عددي.",
    ]

    return {
        "profile": profile,
        "club": club_enriched,
        "opponent": opp_enriched,
        "formation": active_form,
        "squad_depth": depth,
        "foreign_quota": foreign_quota,
        "matchday_brief_ar": brief_ar,
        "matchday_sheet": matchday_sheet,
        "training_sessions": sessions,
        "weekly_load_safety": weekly_safety,
        "live_hub": live_hub,
    }


@router.get("/league-players")
def api_coach_league_players(
    q: str = "",
    position: str = "ALL",
    club_id: str = "ALL",
    nationality_type: str = "all",
    max_age: Optional[int] = None,
    min_height: Optional[int] = None,
    limit: int = 120,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    store = get_coach_store()
    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    players = search_egyptian_league_players(
        clubs_map=clubs_map,
        query=q,
        position=position,
        club_id=club_id,
        nationality_type=nationality_type,
        max_age=max_age,
        min_height=min_height,
        limit=max(10, min(300, limit)),
    )
    return {"count": len(players), "players": players}


@router.post("/tactics/blueprint")
def api_coach_tactics_blueprint(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Deterministic instant 3-phase tactical blueprint builder (zero LLM latency)."""
    ctx.require("read:tactics")
    store = get_coach_store()
    profile = store.get_coach_profile(ctx.tenant_id) or {}
    club_id = str(payload.get("club_id") or profile.get("club_id") or "al_ahly")
    opponent_id = str(payload.get("opponent_id") or profile.get("opponent_id") or "zamalek")
    formation = str(payload.get("formation_code") or payload.get("formation") or profile.get("formation") or "4-2-3-1")
    opp_formation = str(payload.get("opponent_formation_code") or "4-4-2")
    tactical_mode = str(payload.get("tactical_mode") or "tiki_taka")
    opp_mode = str(payload.get("opponent_tactical_mode") or "balanced")
    preset_kw = str(payload.get("masterclass_prompt") or "")

    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    club_raw = clubs_map.get(club_id) or next(iter(clubs_map.values()))
    opp_raw = clubs_map.get(opponent_id) or next((v for k, v in clubs_map.items() if k != club_raw["club_id"]), club_raw)
    club_enriched = _enrich_club_with_admin(store, ctx.tenant_id, club_raw)
    opp_enriched = _enrich_club_with_admin(store, ctx.tenant_id, opp_raw)
    fit_players = [p for p in club_enriched["players"] if p.get("is_eligible_starter", True)]

    from packages.tactics_engine.moment_analyzer import match_masterclass_preset

    preset = match_masterclass_preset(preset_kw) if preset_kw else None
    return build_three_phase_tactical_package(
        club=club_enriched,
        opponent=opp_enriched,
        fit_players=fit_players,
        opp_players=opp_enriched["players"],
        formation_code=formation,
        opponent_formation_code=opp_formation,
        tactical_mode=tactical_mode,
        opponent_tactical_mode=opp_mode,
        masterclass_preset=preset,
    )


@router.get("/live/leagues")
def api_coach_live_leagues(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:tactics")
    return {"leagues": list(SUPPORTED_LEAGUES.values())}


@router.get("/live/hub")
def api_coach_live_hub(
    league: str = "egy.1",
    force_refresh: bool = False,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    return fetch_live_league_hub(league_id=league, force_refresh=force_refresh)


@router.post("/live/sync-club")
def api_coach_sync_club(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    store = get_coach_store()
    mode = str(payload.get("mode") or "wikipedia").lower()

    try:
        if mode == "espn":
            league_slug = str(payload.get("league_slug") or "eng.1")
            team_id = str(payload.get("team_id") or "")
            if not team_id:
                raise ValueError("team_id is required for ESPN sync")
            synced = sync_espn_team_roster(
                league_slug=league_slug,
                team_id=team_id,
                club_id=payload.get("club_id"),
                kit_hex=str(payload.get("kit_hex") or "#38BDF8"),
            )
        elif mode == "scoresheet":
            cid = str(payload.get("club_id") or "custom_club")
            raw_text = str(payload.get("raw_text") or "")
            parsed = parse_scoresheet_text(raw_text)
            if not parsed:
                raise ValueError("Could not extract any numbered players from scoresheet text")
            synced = {
                "club_id": cid,
                "name_ar": str(payload.get("name_ar") or cid),
                "name_en": str(payload.get("name_en") or cid),
                "kit_hex": str(payload.get("kit_hex") or "#10B981"),
                "league_id": "custom",
                "season": "2026/2027",
                "source": "Official Scoresheet Text Import",
                "is_live": True,
                "players": [
                    {
                        "jersey_number": p.jersey_number,
                        "name_ar": p.name,
                        "name_en": p.name,
                        "position": p.position or "CM",
                        "is_starter": p.is_starter,
                        "is_captain": p.is_captain,
                        "nationality": "EGY",
                        "nationality_flag": "🇪🇬",
                        "source": "Coach Scoresheet Import",
                    }
                    for p in parsed
                ],
            }
        else:
            cid = str(payload.get("club_id") or "al_ahly")
            preset = EGYPTIAN_CLUB_PRESETS.get(cid, {})
            wiki_page = str(payload.get("wiki_page") or preset.get("wiki_page") or "")
            if not wiki_page:
                raise ValueError("wiki_page is required for Wikipedia sync")
            synced = sync_wikipedia_club_squad(
                wiki_page=wiki_page,
                club_id=cid,
                name_ar=payload.get("name_ar") or preset.get("name_ar"),
                name_en=payload.get("name_en") or preset.get("name_en"),
                kit_hex=str(payload.get("kit_hex") or preset.get("kit_hex") or "#10B981"),
                ar_wiki_page=preset.get("ar_wiki_page"),
                stadium_ar=preset.get("stadium_ar", ""),
                city_ar=preset.get("city_ar", ""),
            )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Live club sync failed: {exc}")

    store.save_club_roster(ctx.tenant_id, str(synced["club_id"]), synced)
    return _enrich_club_with_admin(store, ctx.tenant_id, synced)


@router.post("/admin/player-status")
def api_coach_admin_player_status(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    store = get_coach_store()
    club_id = str(payload.get("club_id") or "al_ahly")
    jersey_number = int(payload.get("jersey_number") or 0)
    if jersey_number <= 0:
        raise HTTPException(status_code=400, detail="Valid jersey_number required")

    store.upsert_admin_status(
        tenant_id=ctx.tenant_id,
        club_id=club_id,
        jersey_number=jersey_number,
        status=str(payload.get("status") or "fit"),
        readiness_pct=int(payload.get("readiness_pct") if payload.get("readiness_pct") is not None else 100),
        yellow_cards=int(payload.get("yellow_cards") or 0),
        red_cards=int(payload.get("red_cards") or 0),
        return_date=str(payload.get("return_date") or ""),
        minutes_season=int(payload.get("minutes_season") or 0),
        contract_until=str(payload.get("contract_until") or ""),
        admin_note=str(payload.get("admin_note") or ""),
    )

    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    club_raw = clubs_map.get(club_id)
    if not club_raw:
        raise HTTPException(status_code=404, detail="Club not found")
    club_enriched = _enrich_club_with_admin(store, ctx.tenant_id, club_raw)
    formation = str(payload.get("formation") or "4-2-3-1")
    depth = build_squad_depth_report(club_enriched["players"], formation_code=formation)
    sheet = build_official_matchday_sheet(
        club_name_ar=str(club_enriched.get("name_ar") or club_id),
        opponent_name_ar=str(payload.get("opponent_name_ar") or "المنافس"),
        evaluated_players=club_enriched["players"],
        formation_code=formation,
        stadium=str(club_enriched.get("stadium_ar") or ""),
    )
    return {"club": club_enriched, "squad_depth": depth, "matchday_sheet": sheet}


@router.get("/training/catalog")
def api_coach_training_catalog(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:tactics")
    return {
        "microcycle_templates": list(WEEKLY_MICROCYCLE_TEMPLATES.values()),
        "pro_drills": PRO_DRILLS_CATALOG,
    }


@router.get("/training/sessions")
def api_coach_list_sessions(
    club_id: str = "al_ahly",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    store = get_coach_store()
    sessions = store.list_training_sessions(ctx.tenant_id, club_id)
    return {"sessions": sessions, "weekly_load_safety": evaluate_weekly_microcycle_safety(sessions)}


@router.post("/training/sessions")
def api_coach_create_or_save_session(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    store = get_coach_store()
    club_id = str(payload.get("club_id") or "al_ahly")
    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    club_raw = clubs_map.get(club_id) or {"club_id": club_id, "name_ar": club_id, "players": []}
    club_enriched = _enrich_club_with_admin(store, ctx.tenant_id, club_raw)

    if payload.get("drill_setup") and payload.get("phases"):
        sess = dict(payload)
    else:
        sess = generate_custom_session_plan(
            club_name=str(club_enriched.get("name_ar") or club_id),
            md_code=str(payload.get("md_code") or "MD-3"),
            focus_topic=str(payload.get("focus_topic") or ""),
            tactical_formation=str(payload.get("formation") or "4-2-3-1"),
            available_players=club_enriched["players"],
            drill_id=payload.get("drill_id"),
            duration_min=payload.get("duration_min"),
            target_rpe=payload.get("target_rpe"),
            session_date=payload.get("session_date"),
        )
    if payload.get("save", True):
        sess = store.save_training_session(ctx.tenant_id, club_id, sess)
    sessions = store.list_training_sessions(ctx.tenant_id, club_id)
    return {"session": sess, "sessions": sessions, "weekly_load_safety": evaluate_weekly_microcycle_safety(sessions)}


@router.delete("/training/sessions/{session_id}")
def api_coach_delete_session(
    session_id: str,
    club_id: str = "al_ahly",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    store = get_coach_store()
    store.delete_training_session(ctx.tenant_id, session_id)
    sessions = store.list_training_sessions(ctx.tenant_id, club_id)
    return {"deleted": True, "sessions": sessions, "weekly_load_safety": evaluate_weekly_microcycle_safety(sessions)}


@router.get("/training/sessions/{session_id}/print", response_class=HTMLResponse)
def api_coach_print_session(
    session_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> HTMLResponse:
    ctx.require("read:tactics")
    store = get_coach_store()
    sess = store.get_training_session(ctx.tenant_id, session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Training session not found")
    return HTMLResponse(render_training_session_html(sess))


@router.post("/admin/matchday-sheet")
def api_coach_build_matchday_sheet(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    store = get_coach_store()
    club_id = str(payload.get("club_id") or "al_ahly")
    opponent_id = str(payload.get("opponent_id") or "zamalek")
    formation = str(payload.get("formation") or "4-2-3-1")

    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    club_raw = clubs_map.get(club_id)
    if not club_raw:
        raise HTTPException(status_code=404, detail="Club not found")
    opp_raw = clubs_map.get(opponent_id) or {"name_ar": str(payload.get("opponent_name") or opponent_id)}
    club_enriched = _enrich_club_with_admin(store, ctx.tenant_id, club_raw)

    sheet = build_official_matchday_sheet(
        club_name_ar=str(club_enriched.get("name_ar") or club_id),
        opponent_name_ar=str(opp_raw.get("name_ar") or opponent_id),
        evaluated_players=club_enriched["players"],
        formation_code=formation,
        match_date=payload.get("match_date"),
        stadium=str(payload.get("stadium") or club_enriched.get("stadium_ar") or ""),
    )
    saved = store.save_matchday_sheet(ctx.tenant_id, club_id, sheet)
    return {"matchday_sheet": saved}


@router.get("/admin/matchday-sheet/print", response_class=HTMLResponse)
def api_coach_print_matchday_sheet(
    club_id: str = "al_ahly",
    opponent_id: str = "zamalek",
    formation: str = "4-2-3-1",
    ctx: TenantContext = Depends(get_tenant_context),
) -> HTMLResponse:
    ctx.require("read:tactics")
    store = get_coach_store()
    sheet = store.get_latest_matchday_sheet(ctx.tenant_id, club_id)
    if not sheet:
        clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
        club_raw = clubs_map.get(club_id) or {"name_ar": club_id, "players": []}
        opp_raw = clubs_map.get(opponent_id) or {"name_ar": opponent_id}
        club_enriched = _enrich_club_with_admin(store, ctx.tenant_id, club_raw)
        sheet = build_official_matchday_sheet(
            club_name_ar=str(club_enriched.get("name_ar") or club_id),
            opponent_name_ar=str(opp_raw.get("name_ar") or opponent_id),
            evaluated_players=club_enriched["players"],
            formation_code=formation,
            stadium=str(club_enriched.get("stadium_ar") or ""),
        )
    return HTMLResponse(render_matchday_sheet_html(sheet))


@router.post("/set-pieces/optimize")
def api_coach_optimize_set_piece(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    scenario = str(payload.get("scenario") or "right_corner_inswinger")
    return optimize_set_piece_self_play(scenario=scenario, n_candidates=24, rollouts_per_candidate=400, seed=42).to_dict()


@router.post("/chat")
def api_coach_chat(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    store = get_coach_store()
    profile = store.get_coach_profile(ctx.tenant_id) or {}

    club_id = str(payload.get("club_id") or profile.get("club_id") or "al_ahly")
    opponent_id = str(payload.get("opponent_id") or profile.get("opponent_id") or "zamalek")
    formation = str(payload.get("formation") or profile.get("formation") or "4-2-3-1")
    coach_name = str(payload.get("coach_name") or profile.get("coach_name") or "المدرب")
    coach_role = str(payload.get("coach_role") or profile.get("coach_role") or "head_coach")
    league = str(payload.get("league") or "egy.1")

    clubs_map = load_all_coach_clubs(store.list_club_rosters(ctx.tenant_id))
    club_raw = clubs_map.get(club_id) or next(iter(clubs_map.values()))
    opp_raw = clubs_map.get(opponent_id) or next((v for k, v in clubs_map.items() if k != club_raw["club_id"]), club_raw)
    club_enriched = _enrich_club_with_admin(store, ctx.tenant_id, club_raw)
    opp_enriched = _enrich_club_with_admin(store, ctx.tenant_id, opp_raw)

    try:
        standings = list((fetch_live_league_hub(league_id=league, force_refresh=False)).get("standings") or [])
    except Exception:
        standings = []

    res = run_coach_copilot_chat(
        question=str(payload.get("question") or ""),
        coach_name=coach_name,
        coach_role=coach_role,
        club=club_enriched,
        opponent=opp_enriched,
        evaluated_players=club_enriched["players"],
        opp_players=opp_enriched["players"],
        standings=standings,
        formation_code=formation,
        model=str(payload.get("model") or "auto"),
        history=payload.get("history") if isinstance(payload.get("history"), list) else None,
        opponent_formation_code=str(payload.get("opponent_formation_code") or "4-4-2"),
        tactical_mode=str(payload.get("tactical_mode") or "balanced"),
        opponent_tactical_mode=str(payload.get("opponent_tactical_mode") or "balanced"),
    )

    if res.get("ai_training_session"):
        res["ai_training_session"] = store.save_training_session(ctx.tenant_id, club_id, res["ai_training_session"])
    if res.get("ai_matchday_sheet"):
        res["ai_matchday_sheet"] = store.save_matchday_sheet(ctx.tenant_id, club_id, res["ai_matchday_sheet"])

    return res
