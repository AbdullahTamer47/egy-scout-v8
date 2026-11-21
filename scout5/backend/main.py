"""EGY-SCOUT V7 Autonomous Broadcast Studio, Goal/Error Forensics & Egyptian Moneyball Backend."""
from __future__ import annotations

import json
import shutil
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import desc, or_, select

from engine.analytics import infer_attack_dir
from engine.forensics import build_moment_forensics, enrich_portfolios_with_mistakes_and_strengths
from engine.identity import auto_match_squad_to_identities
from engine.pipeline import DATA_DIR as MATCHES_DATA_DIR
from engine.pipeline import run_match_v5
from engine.tactical_director import (
    answer_coach_query,
    build_db_player_portfolio,
    build_match_tactical_brief,
    evaluate_6x4_compatibility,
)
from scouting.database import DATA_ROOT, SessionLocal, init_db
from scouting.ingestor import VIDEOS_DIR, download_youtube_clip, normalize_mp4
from scouting.models import Club, JobRecord, League, MatchRecord, Player, PlayerMatchLink
from scouting.seed import (
    POSITION_RADAR_LABELS,
    SCOUTING_METRIC_KEYS,
    position_family,
    seed_database,
    sync_v5_matches,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):  # noqa: ANN201
    init_db()
    seed_database()
    sync_v5_matches()
    yield


app = FastAPI(title="EGY-SCOUT V7 Pro Engine", version="7.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _match_dir(slug: str) -> Path:
    return MATCHES_DATA_DIR / Path(slug).name


def _serialize_match(m: MatchRecord) -> dict:
    return {
        "id": m.id,
        "slug": m.slug,
        "title": m.title,
        "competition": m.competition,
        "home_team_name": m.home_team_name,
        "away_team_name": m.away_team_name,
        "home_club_id": m.home_club_id,
        "away_club_id": m.away_club_id,
        "home_team_cluster": m.home_team_cluster,
        "fps": m.fps,
        "width": m.width,
        "height": m.height,
        "duration_s": m.duration_s,
        "frame_count": m.frame_count,
        "status": m.status,
        "cal_coverage_pct": m.cal_coverage_pct,
        "median_rep_err_px": m.median_rep_err_px,
        "ball_calibrated_frames": m.ball_calibrated_frames,
        "error": m.error,
        "video_url": f"/api/matches/{m.slug}/video",
        "audit_grid_url": f"/api/matches/{m.slug}/audit-grid",
    }


def _find_club_by_name(db, name: str | None) -> Club | None:
    if not name:
        return None
    clean = name.strip()
    if not clean:
        return None
    # Exact match first, preferring senior clubs (non-youth)
    clubs = db.execute(select(Club, League).join(League, Club.league_id == League.id, isouter=True)).all()
    exact = [c for c, _lg in clubs if (c.name_ar or "").strip() == clean or (c.name or "").strip().lower() == clean.lower()]
    if exact:
        return exact[0]
    # Substring match preferring non-youth tier 1/2 clubs
    want_youth = "ناشئ" in clean or "شباب" in clean
    cands = []
    for c, lg in clubs:
        cn = (c.name_ar or c.name or "").strip()
        if not cn:
            continue
        is_youth = (lg and lg.code == "EGY_YOUTH") or ("ناشئ" in cn)
        if not want_youth and is_youth:
            continue
        if clean in cn or cn in clean:
            cands.append((lg.tier if lg else 3, len(cn), c))
    if cands:
        cands.sort(key=lambda x: (x[0], x[1]))
        return cands[0][2]
    return None


def _load_bound_players_map(slug: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    with SessionLocal() as db:
        rows = db.execute(
            select(PlayerMatchLink, Player, Club)
            .join(Player, PlayerMatchLink.player_id == Player.id)
            .join(Club, Player.club_id == Club.id, isouter=True)
            .where(PlayerMatchLink.match_slug == slug)
        ).all()
        for lnk, p, c in rows:
            out[lnk.identity_key] = {
                "link_id": lnk.id,
                "player_id": p.id,
                "name": p.name_ar or p.name,
                "club_name": (c.name_ar or c.name) if c else "",
                "division": p.division,
                "position": p.position,
                "jersey_number": lnk.jersey_number or p.jersey_number,
                "age": p.age,
                "market_value_egp": p.market_value_egp or 0,
                "notes": lnk.notes,
                "identity_status": "confirmed_manual",
                "status_label_ar": "مؤكد يدوياً",
            }
    return out


def _resolve_match_identities_and_names(
    slug: str,
    match_rec: MatchRecord,
    summary: dict,
) -> tuple[dict[str, dict], dict[int, list[dict]], dict[str, str]]:
    """Semi-automatically resolve real club squads -> video identities + return (resolved_map, squad_by_team, team_names)."""
    hc = int(match_rec.home_team_cluster or 0)
    ac = 1 - hc
    team_names = {
        str(hc): match_rec.home_team_name or "الفريق 1",
        str(ac): match_rec.away_team_name or "الفريق 2",
    }

    squad_by_team: dict[int, list[dict]] = {0: [], 1: []}
    with SessionLocal() as db:
        m_db = db.get(MatchRecord, match_rec.id)
        home_club = db.get(Club, m_db.home_club_id) if (m_db and m_db.home_club_id) else _find_club_by_name(db, match_rec.home_team_name)
        away_club = db.get(Club, m_db.away_club_id) if (m_db and m_db.away_club_id) else _find_club_by_name(db, match_rec.away_team_name)
        changed = False
        if m_db and home_club and m_db.home_club_id != home_club.id:
            m_db.home_club_id = home_club.id
            changed = True
        if m_db and away_club and m_db.away_club_id != away_club.id:
            m_db.away_club_id = away_club.id
            changed = True
        if changed:
            db.commit()

        for cid, club_obj in ((hc, home_club), (ac, away_club)):
            if not club_obj:
                continue
            pls = db.scalars(select(Player).where(Player.club_id == club_obj.id).order_by(desc(Player.market_value_eur))).all()
            squad_by_team[cid] = [
                {
                    "id": p.id,
                    "name": p.name_ar or p.name,
                    "club_name": club_obj.name_ar or club_obj.name,
                    "division": p.division,
                    "position": p.position,
                    "jersey_number": p.jersey_number,
                    "age": p.age,
                    "market_value_egp": p.market_value_egp or 0,
                }
                for p in pls
            ]

    bound_map = _load_bound_players_map(slug)
    portfolios = summary.get("player_portfolios") or summary.get("tracked_players") or []
    auto_map = auto_match_squad_to_identities(portfolios, squad_by_team, bound_map=bound_map)

    resolved: dict[str, dict] = {}
    for ikey, info in auto_map.items():
        resolved[ikey] = info
    for ikey, info in bound_map.items():
        resolved[ikey] = info  # Manual coach confirmation always wins

    # Attach resolved names cleanly onto every portfolio and key sequence
    for p in portfolios:
        ikey = p.get("identity_key")
        if not ikey:
            continue
        if ikey in bound_map:
            p["bound_player"] = bound_map[ikey]
        if ikey in auto_map:
            p["auto_player"] = auto_map[ikey]
        r_info = resolved.get(ikey)
        if r_info:
            p["display_name"] = r_info["name"]
            p["display_jersey"] = r_info.get("jersey_number") or p.get("jersey_ocr")
            p["identity_status"] = r_info["identity_status"]
            p["status_label_ar"] = r_info["status_label_ar"]
        else:
            p["display_name"] = f"لاعب #{p['jersey_ocr']}" if p.get("jersey_ocr") else f"{p.get('inferred_role_ar', 'لاعب')} ({ikey})"
            p["display_jersey"] = p.get("jersey_ocr")
            p["identity_status"] = "unidentified"
            p["status_label_ar"] = "تتبع بصري (اضغط للتسمية)"

    # Enrich sequence names & team names cleanly
    for seq in summary.get("key_sequences") or []:
        att_id = str(seq.get("attacking_team_id", 0))
        def_id = str(seq.get("defending_team_id", 1))
        att_n = team_names.get(att_id, seq.get("attacking_team_name", "الفريق 1"))
        def_n = team_names.get(def_id, seq.get("defending_team_name", "الفريق 2"))
        seq["attacking_team_name"] = att_n
        seq["defending_team_name"] = def_n
        seq["title_ar"] = (
            seq.get("title_ar", "")
            .replace("الفريق 1", team_names["0"])
            .replace("الفريق 2", team_names["1"])
        )
        for st in seq.get("stages") or []:
            st["detail_ar"] = (
                st.get("detail_ar", "")
                .replace("الفريق 1", team_names["0"])
                .replace("الفريق 2", team_names["1"])
            )
        for h in seq.get("attacking_heroes") or []:
            r_info = resolved.get(h.get("identity_key", ""))
            if r_info:
                h["name"] = r_info["name"]
                h["identity_status"] = r_info["identity_status"]
        for dfault in seq.get("defensive_faults") or []:
            r_info = resolved.get(dfault.get("identity_key", ""))
            if r_info:
                dfault["name"] = r_info["name"]
                dfault["identity_status"] = r_info["identity_status"]

    # Also update partner identity names inside mistakes text
    for p in portfolios:
        for mk in p.get("match_mistakes") or []:
            txt = mk.get("detail_ar", "")
            for ikey, r_info in resolved.items():
                if f"({ikey})" in txt:
                    txt = txt.replace(f"({ikey})", f"({r_info['name']})")
            mk["detail_ar"] = txt

    summary["bound_players"] = bound_map
    summary["resolved_identities"] = resolved
    return resolved, squad_by_team, team_names


def _top_div2_targets(limit: int = 6) -> list[dict]:
    with SessionLocal() as db:
        rows = db.execute(
            select(Player, Club)
            .join(Club, Player.club_id == Club.id, isouter=True)
            .where(Player.division.in_(["EGY2", "EGY_YOUTH"]))
            .order_by(desc(Player.market_value_eur))
            .limit(40)
        ).all()
        scored = []
        for p, c in rows:
            prof = p.scouting_profile or {}
            if not prof:
                continue
            ov = round(sum(float(prof.get(k, 65.0)) for k in SCOUTING_METRIC_KEYS) / len(SCOUTING_METRIC_KEYS), 1)
            compat = evaluate_6x4_compatibility(prof, p.position or "CM")
            scored.append(
                {
                    "id": p.id,
                    "name": p.name_ar or p.name,
                    "club_name": (c.name_ar or c.name) if c else "",
                    "division": p.division,
                    "position": p.position,
                    "age": p.age,
                    "market_value_eur": p.market_value_eur or 0,
                    "market_value_egp": p.market_value_egp or 0,
                    "overall_rating": ov,
                    "archetype_ar": compat["archetype_ar"],
                    "best_formation": compat["best_formation"],
                    "best_formation_pct": compat["best_formation_pct"],
                }
            )
        scored.sort(key=lambda x: (x["overall_rating"], -(x["market_value_eur"] or 0)), reverse=True)
        return scored[:limit]


def _update_job(job_id: int, status: str | None = None, progress: float | None = None, msg: str | None = None) -> None:
    with SessionLocal() as db:
        j = db.get(JobRecord, job_id)
        if not j:
            return
        if status is not None:
            j.status = status
        if progress is not None:
            j.progress = round(float(progress), 3)
        if msg is not None:
            j.message = msg
        db.commit()


def _spawn_pipeline_worker(slug: str, job_id: int, stride: int = 3, pnl_interval: int = 12, youtube_url: str | None = None, max_sec: int = 45) -> None:
    def _run() -> None:
        try:
            _update_job(job_id, status="running", progress=0.02, msg="بدء التحليل التنفيذي V7...")
            if youtube_url:
                info = download_youtube_clip(youtube_url, max_sec=max_sec, progress_cb=lambda p, m: _update_job(job_id, progress=p, msg=m))
                with SessionLocal() as db:
                    rec = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
                    if rec:
                        rec.title = info["title"]
                        rec.source_url = info["source_url"]
                        rec.video_path = info["video_path"]
                        rec.fps = info["meta"]["fps"]
                        rec.width = info["meta"]["width"]
                        rec.height = info["meta"]["height"]
                        rec.frame_count = info["meta"]["frame_count"]
                        rec.duration_s = info["meta"]["duration_s"]
                        db.commit()
                vpath = info["video_path"]
            else:
                with SessionLocal() as db:
                    rec = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
                    vpath = rec.video_path if rec else ""

            base = 0.28 if youtube_url else 0.05
            summ = run_match_v5(
                slug,
                vpath,
                stride=stride,
                pnl_interval=pnl_interval,
                progress_cb=lambda p, m: _update_job(job_id, progress=base + (1.0 - base) * p, msg=m),
            )
            sync_v5_matches()
            _update_job(job_id, status="done", progress=1.0, msg=f"اكتمل (تغطية {summ['calibration']['wide_cal_coverage_pct']}%)")
        except Exception as exc:
            with SessionLocal() as db:
                rec = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
                if rec:
                    rec.status = "failed"
                    rec.error = str(exc)
                    db.commit()
            _update_job(job_id, status="failed", msg=str(exc))

    threading.Thread(target=_run, daemon=True).start()


# ---------------- Matches, Auto-Lineup, Telemetry & Portraits ----------------
@app.get("/api/matches")
def list_matches() -> list[dict]:
    with SessionLocal() as db:
        rows = db.scalars(select(MatchRecord).order_by(desc(MatchRecord.id))).all()
        return [_serialize_match(m) for m in rows]


@app.get("/api/matches/{slug}")
def get_match(slug: str) -> dict:
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        data = _serialize_match(m)
        sf = _match_dir(slug) / "summary.json"
        summary = json.loads(sf.read_text(encoding="utf-8")) if sf.exists() else None
        if summary:
            _resolve_match_identities_and_names(slug, m, summary)
    data["summary"] = summary
    return data


@app.get("/api/matches/{slug}/video")
def stream_match_video(slug: str) -> FileResponse:
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m or not m.video_path or not Path(m.video_path).exists():
            raise HTTPException(status_code=404, detail="ملف الفيديو غير موجود")
        return FileResponse(path=m.video_path, media_type="video/mp4")


@app.get("/api/matches/{slug}/audit-grid")
def get_audit_grid(slug: str) -> FileResponse:
    p = _match_dir(slug) / "audit_grid.jpg"
    if not p.exists():
        raise HTTPException(status_code=404, detail="صورة التحقق البصري غير متوفرة")
    return FileResponse(path=str(p), media_type="image/jpeg")


@app.get("/api/matches/{slug}/portraits/{filename}")
def get_player_portrait(slug: str, filename: str) -> FileResponse:
    safe_name = Path(filename).name
    p = _match_dir(slug) / "portraits" / safe_name
    if not p.exists():
        raise HTTPException(status_code=404, detail="صورة البورتريه غير موجودة")
    return FileResponse(path=str(p), media_type="image/jpeg")


@app.get("/api/matches/{slug}/lineup")
def get_match_lineup(slug: str) -> dict:
    """Return semi-automatic matched lineup + club squad rosters for 1-click confirmation or swap."""
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        sf = _match_dir(slug) / "summary.json"
        if not sf.exists():
            raise HTTPException(status_code=404, detail="ملخص المباراة غير متوفر")
        summ = json.loads(sf.read_text(encoding="utf-8"))
        resolved, squad_by_team, team_names = _resolve_match_identities_and_names(slug, m, summ)

    teams_out = {}
    for tid in (0, 1):
        t_pl = [p for p in (summ.get("player_portfolios") or []) if int(p.get("team_id", -1)) == tid]
        t_pl.sort(key=lambda x: (x.get("identity_status") == "confirmed_manual", x.get("n_cal_frames", 0)), reverse=True)
        teams_out[str(tid)] = {
            "team_name": team_names[str(tid)],
            "kit": (summ.get("teams") or {}).get(str(tid), {}).get("kit") or {},
            "squad_roster": squad_by_team.get(tid) or [],
            "identities": [
                {
                    "identity_key": p["identity_key"],
                    "portrait_url": p.get("portrait_url"),
                    "inferred_role_code": p.get("inferred_role_code"),
                    "inferred_role_ar": p.get("inferred_role_ar"),
                    "jersey_ocr": p.get("jersey_ocr"),
                    "n_cal_frames": p.get("n_cal_frames"),
                    "overall_score": (p.get("scorecard") or {}).get("overall_score"),
                    "display_name": p.get("display_name"),
                    "display_jersey": p.get("display_jersey"),
                    "identity_status": p.get("identity_status"),
                    "status_label_ar": p.get("status_label_ar"),
                    "matched_player_id": (resolved.get(p["identity_key"]) or {}).get("player_id"),
                }
                for p in t_pl[:14]
            ],
        }
    return {
        "match_slug": slug,
        "confirmed_count": sum(1 for v in resolved.values() if v.get("identity_status") == "confirmed_manual"),
        "auto_matched_count": sum(1 for v in resolved.values() if v.get("identity_status") in ("auto_lineup", "confirmed_ocr")),
        "teams": teams_out,
    }


class LineupConfirmItem(BaseModel):
    identity_key: str
    player_id: int | None = None
    custom_name: str | None = None
    jersey_number: int | None = None


class LineupConfirmReq(BaseModel):
    confirm_auto_all: bool = False
    items: list[LineupConfirmItem] = []


@app.post("/api/matches/{slug}/lineup/confirm")
def confirm_match_lineup(slug: str, req: LineupConfirmReq) -> dict:
    """1-Click confirm all auto-matched club players OR apply custom coach lineup overrides."""
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        sf = _match_dir(slug) / "summary.json"
        if not sf.exists():
            raise HTTPException(status_code=404, detail="ملخص المباراة غير متوفر")
        summ = json.loads(sf.read_text(encoding="utf-8"))
        resolved, _squad, _tnames = _resolve_match_identities_and_names(slug, m, summ)

    p_by_id = {p["identity_key"]: p for p in (summ.get("player_portfolios") or [])}
    to_save: list[LineupConfirmItem] = list(req.items)

    if req.confirm_auto_all:
        existing_keys = {it.identity_key for it in to_save}
        for ikey, r_info in resolved.items():
            if ikey not in existing_keys and r_info.get("player_id"):
                to_save.append(
                    LineupConfirmItem(
                        identity_key=ikey,
                        player_id=int(r_info["player_id"]),
                        jersey_number=r_info.get("jersey_number"),
                    )
                )

    saved_n = 0
    with SessionLocal() as db:
        for item in to_save:
            vp = p_by_id.get(item.identity_key)
            if not vp:
                continue
            pid = item.player_id
            if not pid and item.custom_name and item.custom_name.strip():
                new_p = Player(
                    external_id=f"lineup_{slug}_{item.identity_key}_{uuid.uuid4().hex[:6]}",
                    name=item.custom_name.strip(),
                    name_ar=item.custom_name.strip(),
                    division="EGY2",
                    position=vp.get("inferred_role_code") or "CM",
                    jersey_number=item.jersey_number or vp.get("jersey_ocr"),
                    age=23,
                    preferred_foot="Right",
                    nationality="Egypt",
                    market_value_eur=90000,
                    market_value_egp=4770000,
                    scouting_profile=vp.get("scouting_profile") or {k: 68.0 for k in SCOUTING_METRIC_KEYS},
                )
                db.add(new_p)
                db.flush()
                pid = new_p.id
            if not pid:
                continue

            existing = db.scalar(
                select(PlayerMatchLink).where(
                    PlayerMatchLink.match_slug == slug,
                    PlayerMatchLink.identity_key == item.identity_key,
                )
            )
            sc_ov = float((vp.get("scorecard") or {}).get("overall_score", 0.0))
            if existing:
                existing.player_id = pid
                existing.jersey_number = item.jersey_number or vp.get("jersey_ocr") or existing.jersey_number
                existing.overall_score = sc_ov
            else:
                db.add(
                    PlayerMatchLink(
                        match_slug=slug,
                        identity_key=item.identity_key,
                        player_id=pid,
                        team_id=int(vp.get("team_id", 0)),
                        jersey_number=item.jersey_number or vp.get("jersey_ocr"),
                        overall_score=sc_ov,
                        max_speed_kmh=float(vp.get("max_speed_kmh", 0.0)),
                        distance_m=float(vp.get("distance_m", 0.0)),
                        avg_voronoi_m2=float(vp.get("avg_voronoi_m2", 0.0)),
                        portrait_url=vp.get("portrait_url"),
                    )
                )
            saved_n += 1
        db.commit()
    return {"ok": True, "saved_count": saved_n}


@app.get("/api/matches/{slug}/players")
def list_match_players(slug: str) -> dict:
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        sf = _match_dir(slug) / "summary.json"
        if not sf.exists():
            raise HTTPException(status_code=404, detail="بيانات المباراة غير متوفرة")
        summ = json.loads(sf.read_text(encoding="utf-8"))
        resolved, _, _ = _resolve_match_identities_and_names(slug, m, summ)
    return {
        "match_slug": slug,
        "identity_diagnostics": summ.get("identity_diagnostics") or {},
        "bound_count": sum(1 for v in resolved.values() if v.get("identity_status") == "confirmed_manual"),
        "auto_matched_count": sum(1 for v in resolved.values() if v.get("identity_status") in ("auto_lineup", "confirmed_ocr")),
        "players": summ.get("player_portfolios") or [],
    }


@app.get("/api/matches/{slug}/players/{identity_key}")
def get_match_player_portfolio(slug: str, identity_key: str) -> dict:
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        sf = _match_dir(slug) / "summary.json"
        if not sf.exists():
            raise HTTPException(status_code=404, detail="بيانات المباراة غير متوفرة")
        summ = json.loads(sf.read_text(encoding="utf-8"))
        _resolve_match_identities_and_names(slug, m, summ)
    players = summ.get("player_portfolios") or []
    found = next((p for p in players if p.get("identity_key") == identity_key), None)
    if not found:
        raise HTTPException(status_code=404, detail="اللاعب غير موجود في هذه المباراة")
    return found


class BindPlayerReq(BaseModel):
    identity_key: str
    player_id: int | None = None
    new_player_name: str | None = None
    new_club_id: int | None = None
    new_division: str = "EGY2"
    new_position: str | None = None
    new_age: int | None = 22
    jersey_number: int | None = None
    notes: str | None = None


@app.post("/api/matches/{slug}/bind-player")
def bind_match_player(slug: str, req: BindPlayerReq) -> dict:
    sf = _match_dir(slug) / "summary.json"
    if not sf.exists():
        raise HTTPException(status_code=404, detail="المباراة غير موجودة")
    summ = json.loads(sf.read_text(encoding="utf-8"))
    players = summ.get("player_portfolios") or []
    v_player = next((p for p in players if p.get("identity_key") == req.identity_key), None)
    if not v_player:
        raise HTTPException(status_code=404, detail="هوية اللاعب غير موجودة في بيانات الفيديو")

    with SessionLocal() as db:
        target_player: Player | None = None
        if req.player_id:
            target_player = db.get(Player, req.player_id)
            if not target_player:
                raise HTTPException(status_code=404, detail="اللاعب المختار غير موجود في قاعدة البيانات")
        elif req.new_player_name and req.new_player_name.strip():
            sc_prof = v_player.get("scouting_profile") or {k: 68.0 for k in SCOUTING_METRIC_KEYS}
            target_player = Player(
                club_id=req.new_club_id,
                external_id=f"scouted_{slug}_{req.identity_key}_{uuid.uuid4().hex[:6]}",
                name=req.new_player_name.strip(),
                name_ar=req.new_player_name.strip(),
                division=req.new_division or "EGY2",
                jersey_number=req.jersey_number or v_player.get("jersey_ocr"),
                position=req.new_position or v_player.get("inferred_role_code") or "CM",
                age=req.new_age or 22,
                preferred_foot="Right",
                nationality="Egypt",
                market_value_eur=95000,
                market_value_egp=5035000,
                scouting_profile=sc_prof,
            )
            db.add(target_player)
            db.flush()
        else:
            raise HTTPException(status_code=400, detail="يجب اختيار لاعب من القاعدة أو إدخال اسم لاعب جديد")

        existing = db.scalar(
            select(PlayerMatchLink).where(
                PlayerMatchLink.match_slug == slug,
                PlayerMatchLink.identity_key == req.identity_key,
            )
        )
        sc_ov = float((v_player.get("scorecard") or {}).get("overall_score", 0.0))
        if existing:
            existing.player_id = target_player.id
            existing.jersey_number = req.jersey_number or v_player.get("jersey_ocr") or target_player.jersey_number
            existing.overall_score = sc_ov
            existing.max_speed_kmh = float(v_player.get("max_speed_kmh", 0.0))
            existing.distance_m = float(v_player.get("distance_m", 0.0))
            existing.avg_voronoi_m2 = float(v_player.get("avg_voronoi_m2", 0.0))
            existing.portrait_url = v_player.get("portrait_url")
            existing.notes = req.notes
        else:
            db.add(
                PlayerMatchLink(
                    match_slug=slug,
                    identity_key=req.identity_key,
                    player_id=target_player.id,
                    team_id=int(v_player.get("team_id", 0)),
                    jersey_number=req.jersey_number or v_player.get("jersey_ocr") or target_player.jersey_number,
                    overall_score=sc_ov,
                    max_speed_kmh=float(v_player.get("max_speed_kmh", 0.0)),
                    distance_m=float(v_player.get("distance_m", 0.0)),
                    avg_voronoi_m2=float(v_player.get("avg_voronoi_m2", 0.0)),
                    portrait_url=v_player.get("portrait_url"),
                    notes=req.notes,
                )
            )
        db.commit()
        pid = target_player.id
        pname = target_player.name_ar or target_player.name

    return {"ok": True, "identity_key": req.identity_key, "player_id": pid, "player_name": pname}


# ---------------- Goal / Big-Chance / Defensive-Error Forensics ----------------
@app.get("/api/matches/{slug}/forensics")
def get_match_forensics(slug: str) -> dict:
    """Return all automatically detected dangerous sequences, goal/box breakdowns, and player error/strength audits."""
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        sf = _match_dir(slug) / "summary.json"
        if not sf.exists():
            raise HTTPException(status_code=404, detail="ملخص المباراة غير متوفر")
        summ = json.loads(sf.read_text(encoding="utf-8"))
        _resolved, _squads, team_names = _resolve_match_identities_and_names(slug, m, summ)

    portfolios = summ.get("player_portfolios") or []
    player_audits = [
        {
            "identity_key": p["identity_key"],
            "team_id": p["team_id"],
            "team_name": team_names.get(str(p["team_id"]), ""),
            "display_name": p.get("display_name") or p["identity_key"],
            "display_jersey": p.get("display_jersey"),
            "identity_status": p.get("identity_status", "unidentified"),
            "status_label_ar": p.get("status_label_ar", ""),
            "inferred_role_ar": p.get("inferred_role_ar", ""),
            "portrait_url": p.get("portrait_url"),
            "overall_score": (p.get("scorecard") or {}).get("overall_score", 0),
            "mistakes_count": p.get("mistakes_count", 0),
            "highlights_count": p.get("highlights_count", 0),
            "match_strengths": p.get("match_strengths") or [],
            "match_mistakes": p.get("match_mistakes") or [],
            "coaching_fix_ar": p.get("coaching_fix_ar", ""),
        }
        for p in portfolios
        if (p.get("mistakes_count", 0) > 0 or p.get("highlights_count", 0) > 0)
    ]
    player_audits.sort(key=lambda x: (x["mistakes_count"], x["highlights_count"], x["overall_score"]), reverse=True)

    return {
        "match_slug": slug,
        "team_names": team_names,
        "team_kits": {k: (v.get("kit") or {}) for k, v in (summ.get("teams") or {}).items()},
        "sequences": summ.get("key_sequences") or [],
        "player_audits": player_audits[:18],
        "totals": {
            "sequences_count": len(summ.get("key_sequences") or []),
            "total_mistakes_flagged": sum(p.get("mistakes_count", 0) for p in portfolios),
            "total_highlights_flagged": sum(p.get("highlights_count", 0) for p in portfolios),
        },
    }


class MomentForensicsReq(BaseModel):
    time_s: float
    event_type: str = "goal"  # goal | big_chance | defensive_breakdown
    title_ar: str | None = None


@app.post("/api/matches/{slug}/forensics/moment")
def analyze_custom_moment(slug: str, req: MomentForensicsReq) -> dict:
    """On-demand 3-stage reverse-replay forensics at ANY video timestamp (e.g., analyze how a goal was conceded)."""
    mdir = _match_dir(slug)
    tf, ff, sf, ft_f = mdir / "telemetry.parquet", mdir / "frames.parquet", mdir / "summary.json", mdir / "frame_tactics.json"
    if not tf.exists() or not ff.exists() or not sf.exists() or not ft_f.exists():
        raise HTTPException(status_code=404, detail="بيانات المباراة غير متوفرة")

    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        summ = json.loads(sf.read_text(encoding="utf-8"))
        _resolved, _squads, team_names = _resolve_match_identities_and_names(slug, m, summ)

    df_f = pd.read_parquet(ff)
    df_t = pd.read_parquet(tf)
    ft_raw = json.loads(ft_f.read_text(encoding="utf-8"))
    frame_tactics = {int(k): v for k, v in ft_raw.items()}
    attack_dirs = infer_attack_dir(df_t)
    portfolios = summ.get("player_portfolios") or []
    _, gap_blame_by_fid = enrich_portfolios_with_mistakes_and_strengths(df_t, frame_tactics, portfolios, attack_dirs)

    seq = build_moment_forensics(
        target_time_s=req.time_s,
        df_frames=df_f,
        df_dets=df_t,
        frame_tactics=frame_tactics,
        portfolios=portfolios,
        team_names=team_names,
        attack_dirs=attack_dirs,
        gap_blame_by_fid=gap_blame_by_fid,
        forced_type=req.event_type,
        forced_title=req.title_ar,
    )
    if not seq:
        raise HTTPException(status_code=400, detail="هذه اللحظة خارج اللقطات المعايَرة — انتقل للقطة معايَرة وحاول مجدداً")
    return seq


@app.get("/api/matches/{slug}/telemetry")
def get_telemetry(slug: str) -> dict:
    mdir = _match_dir(slug)
    tf, ff, sf, ft_f = mdir / "telemetry.parquet", mdir / "frames.parquet", mdir / "summary.json", mdir / "frame_tactics.json"
    if not tf.exists() or not ff.exists() or not sf.exists():
        raise HTTPException(status_code=404, detail="بيانات التليميتري غير متاحة بعد")

    summ = json.loads(sf.read_text(encoding="utf-8"))
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if m:
            resolved_map, _, _ = _resolve_match_identities_and_names(slug, m, summ)
        else:
            resolved_map = _load_bound_players_map(slug)

    df_f = pd.read_parquet(ff)
    df_t = pd.read_parquet(tf)
    ft_map = json.loads(ft_f.read_text(encoding="utf-8")) if ft_f.exists() else {}

    id_lookup: dict[str, dict] = {}
    for pp in summ.get("player_portfolios") or []:
        ikey = pp.get("identity_key")
        if ikey:
            id_lookup[ikey] = {
                "jersey_ocr": pp.get("jersey_ocr"),
                "inferred_role_code": pp.get("inferred_role_code"),
                "overall_score": (pp.get("scorecard") or {}).get("overall_score"),
                "portrait_url": pp.get("portrait_url"),
            }

    teams_meta = summ.get("teams") or {}
    team_kits = {k: (v.get("kit") or {}) for k, v in teams_meta.items() if isinstance(v, dict)}

    has_id_col = "identity_key" in df_t.columns
    has_vel_cols = "vx_ms" in df_t.columns and "vy_ms" in df_t.columns and "speed_kmh" in df_t.columns

    by_fid = df_t.groupby("frame_id").groups if not df_t.empty else {}
    frames_out: list[dict] = []
    for _, frow in df_f.iterrows():
        fid = int(frow["frame_id"])
        tac = ft_map.get(str(fid), {})
        players: list[dict] = []
        ball = None
        if fid in by_fid:
            for _, r in df_t.loc[by_fid[fid]].iterrows():
                role = str(r["role"])
                xm = float(r["x_m"]) if pd.notna(r["x_m"]) else None
                ym = float(r["y_m"]) if pd.notna(r["y_m"]) else None
                if role == "ball":
                    ball = {
                        "u_norm": float(r["u_norm"]),
                        "v_norm": float(r["v_norm"]),
                        "x_m": round(xm, 2) if xm is not None else None,
                        "y_m": round(ym, 2) if ym is not None else None,
                        "conf": float(r["conf"]),
                    }
                    continue
                ikey = str(r["identity_key"]) if has_id_col and pd.notna(r["identity_key"]) else ""
                meta_i = id_lookup.get(ikey) or {}
                res_i = resolved_map.get(ikey)
                players.append(
                    {
                        "track_id": int(r["track_id"]),
                        "identity_key": ikey,
                        "role": role,
                        "team_id": int(r["team_id"]),
                        "u_norm": float(r["u_norm"]),
                        "v_norm": float(r["v_norm"]),
                        "x1_norm": round(float(r["x1"]) / max(1, int(frow["width"])), 5),
                        "y1_norm": round(float(r["y1"]) / max(1, int(frow["height"])), 5),
                        "x2_norm": round(float(r["x2"]) / max(1, int(frow["width"])), 5),
                        "y2_norm": round(float(r["y2"]) / max(1, int(frow["height"])), 5),
                        "x_m": round(xm, 2) if xm is not None else None,
                        "y_m": round(ym, 2) if ym is not None else None,
                        "vx_ms": round(float(r["vx_ms"]), 2) if has_vel_cols and pd.notna(r["vx_ms"]) else 0.0,
                        "vy_ms": round(float(r["vy_ms"]), 2) if has_vel_cols and pd.notna(r["vy_ms"]) else 0.0,
                        "speed_kmh": round(float(r["speed_kmh"]), 1) if has_vel_cols and pd.notna(r["speed_kmh"]) else 0.0,
                        "jersey_ocr": meta_i.get("jersey_ocr"),
                        "inferred_role_code": meta_i.get("inferred_role_code"),
                        "overall_score": meta_i.get("overall_score"),
                        "bound_name": res_i["name"] if res_i else None,
                        "bound_jersey": res_i.get("jersey_number") if res_i else None,
                        "identity_status": res_i.get("identity_status") if res_i else "unidentified",
                        "on_pitch": bool(r.get("on_pitch", False)),
                    }
                )
        frames_out.append(
            {
                "frame_id": fid,
                "time_s": float(frow["time_s"]),
                "shot_id": int(frow["shot_id"]),
                "is_wide": bool(frow["is_wide"]),
                "cal_src": str(frow["cal_src"]),
                "cal_err_px": round(float(frow["cal_err_px"]), 2) if pd.notna(frow["cal_err_px"]) else None,
                "kp_count": int(frow["kp_count"]),
                "h_inv_norm": tac.get("h_inv_norm"),
                "camera_fov_m": tac.get("camera_fov_m") or [],
                "poss_team": tac.get("poss_team"),
                "ball_carrier_track_id": tac.get("ball_carrier_track_id"),
                "ball_carrier_identity": tac.get("ball_carrier_identity"),
                "formations": tac.get("formations") or {},
                "passing_lanes": tac.get("passing_lanes") or [],
                "voronoi_cells": tac.get("voronoi_cells") or [],
                "pitch_control": tac.get("pitch_control") or {},
                "defensive_gaps": tac.get("defensive_gaps") or [],
                "players": players,
                "ball": ball,
            }
        )

    return {
        "slug": slug,
        "meta": summ.get("meta") or {},
        "team_kits": team_kits,
        "calibration": summ.get("calibration") or {},
        "timeline_events": summ.get("timeline_events") or [],
        "bound_players": resolved_map,
        "frames": frames_out,
    }


# ---------------- Tactical Director & Coaching Intelligence ----------------
@app.get("/api/matches/{slug}/tactical-brief")
def get_match_tactical_brief(slug: str) -> dict:
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        match_meta = _serialize_match(m)
        sf = _match_dir(slug) / "summary.json"
        if not sf.exists():
            raise HTTPException(status_code=404, detail="ملخص المباراة غير جاهز بعد")
        summ = json.loads(sf.read_text(encoding="utf-8"))
        _resolve_match_identities_and_names(slug, m, summ)
    div2 = _top_div2_targets(limit=6)
    brief = build_match_tactical_brief(match_meta, summ, div2_targets=div2)
    # Attach resolved names onto standout players
    p_by_id = {p["identity_key"]: p for p in (summ.get("player_portfolios") or [])}
    for sp in brief.get("standout_players") or []:
        po = p_by_id.get(sp["identity_key"])
        if po:
            sp["display_name"] = po.get("display_name")
            sp["mistakes_count"] = po.get("mistakes_count", 0)
            sp["highlights_count"] = po.get("highlights_count", 0)
    return brief


class CoachAskReq(BaseModel):
    match_slug: str
    question: str
    focus_identity_key: str | None = None
    focus_player_id: int | None = None
    gemini_api_key: str | None = None


@app.post("/api/coach/ask")
def ask_tactical_director(req: CoachAskReq) -> dict:
    with SessionLocal() as db:
        m = db.scalar(select(MatchRecord).where(MatchRecord.slug == req.match_slug))
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        match_meta = _serialize_match(m)
        sf = _match_dir(req.match_slug) / "summary.json"
        if not sf.exists():
            raise HTTPException(status_code=404, detail="بيانات المباراة غير متوفرة")
        summ = json.loads(sf.read_text(encoding="utf-8"))
        _resolve_match_identities_and_names(req.match_slug, m, summ)

    div2 = _top_div2_targets(limit=6)
    brief = build_match_tactical_brief(match_meta, summ, div2_targets=div2)

    focus_player = None
    if req.focus_identity_key:
        focus_player = next(
            (p for p in (summ.get("player_portfolios") or []) if p.get("identity_key") == req.focus_identity_key),
            None,
        )
        if focus_player:
            focus_player = {**focus_player, "bound_player_name": focus_player.get("display_name")}
    elif req.focus_player_id:
        with SessionLocal() as db:
            p = db.get(Player, req.focus_player_id)
            if p:
                c = db.get(Club, p.club_id) if p.club_id else None
                focus_player = build_db_player_portfolio(
                    {
                        "id": p.id,
                        "name": p.name_ar or p.name,
                        "club_name": (c.name_ar or c.name) if c else "",
                        "division": p.division,
                        "position": p.position,
                        "age": p.age,
                        "market_value_eur": p.market_value_eur or 0,
                        "market_value_egp": p.market_value_egp or 0,
                        "scouting_profile": p.scouting_profile or {},
                    },
                    [],
                )

    return answer_coach_query(
        question=req.question,
        brief=brief,
        summary=summ,
        div2_targets=div2,
        focus_player=focus_player,
        gemini_api_key=req.gemini_api_key,
    )


@app.post("/api/matches/upload")
async def upload_match(
    file: UploadFile = File(...),
    title: str = Form(""),
    competition: str = Form("الدوري المصري"),
    max_sec: int = Form(0),
) -> dict:
    slug = f"up_{uuid.uuid4().hex[:8]}"
    raw_path = DATA_ROOT / "raw" / f"{slug}_{Path(file.filename or 'clip.mp4').name}"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    with raw_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    dst = VIDEOS_DIR / f"{slug}.mp4"
    meta = normalize_mp4(raw_path, dst, max_sec=max_sec)
    with SessionLocal() as db:
        m = MatchRecord(
            slug=slug,
            title=title.strip() or Path(file.filename or slug).stem,
            competition=competition,
            home_team_name="الفريق 1",
            away_team_name="الفريق 2",
            video_path=str(dst),
            fps=meta["fps"],
            width=meta["width"],
            height=meta["height"],
            frame_count=meta["frame_count"],
            duration_s=meta["duration_s"],
            status="queued",
        )
        db.add(m)
        job = JobRecord(match_slug=slug, kind="analyze", status="queued", progress=0.0, message="بانتظار بدء التحليل")
        db.add(job)
        db.commit()
        db.refresh(job)
        jid = job.id
    _spawn_pipeline_worker(slug, jid)
    return {"slug": slug, "job_id": jid}


class YouTubeIngestReq(BaseModel):
    url_or_query: str
    competition: str = "الدوري المصري"
    max_sec: int = 35


@app.post("/api/matches/ingest-youtube")
def ingest_youtube(req: YouTubeIngestReq) -> dict:
    slug = f"yt_{uuid.uuid4().hex[:8]}"
    with SessionLocal() as db:
        m = MatchRecord(slug=slug, title=req.url_or_query[:120], competition=req.competition, source_url=req.url_or_query, video_path="", status="downloading")
        db.add(m)
        job = JobRecord(match_slug=slug, kind="ingest", status="queued", progress=0.0, message="بدء سحب المقطع...")
        db.add(job)
        db.commit()
        db.refresh(job)
        jid = job.id
    _spawn_pipeline_worker(slug, jid, youtube_url=req.url_or_query, max_sec=req.max_sec)
    return {"slug": slug, "job_id": jid}


@app.get("/api/jobs")
def list_jobs(limit: int = 12) -> list[dict]:
    with SessionLocal() as db:
        rows = db.scalars(select(JobRecord).order_by(desc(JobRecord.id)).limit(limit)).all()
        return [{"id": j.id, "match_slug": j.match_slug, "kind": j.kind, "status": j.status, "progress": j.progress, "message": j.message} for j in rows]


# ---------------- Egyptian Scouting, Executive DB Player Portfolios, Moneyball & Squad Fit ----------------
COACHING_STYLES: dict[str, dict[str, float]] = {
    "high_press": {"pace_sprint": 1.35, "stamina_workrate": 1.45, "pressing_intensity": 1.65, "ball_recovery": 1.40, "aerial_duels": 0.90, "defensive_positioning": 1.15, "short_pass_accuracy": 1.05, "progressive_passes": 1.15, "xt_creation": 1.25, "progressive_carries": 1.20, "space_creation": 1.15, "ball_retention_tempo": 1.35, "tactical_discipline": 1.25, "tactical_fluidity": 1.10},
    "possession": {"pace_sprint": 0.90, "stamina_workrate": 1.05, "pressing_intensity": 1.05, "ball_recovery": 1.00, "aerial_duels": 0.80, "defensive_positioning": 1.15, "short_pass_accuracy": 1.65, "progressive_passes": 1.55, "xt_creation": 1.40, "progressive_carries": 1.25, "space_creation": 1.45, "ball_retention_tempo": 1.55, "tactical_discipline": 1.25, "tactical_fluidity": 1.45},
    "direct_counter": {"pace_sprint": 1.70, "stamina_workrate": 1.30, "pressing_intensity": 1.00, "ball_recovery": 1.30, "aerial_duels": 1.05, "defensive_positioning": 1.15, "short_pass_accuracy": 0.95, "progressive_passes": 1.40, "xt_creation": 1.45, "progressive_carries": 1.55, "space_creation": 1.30, "ball_retention_tempo": 1.20, "tactical_discipline": 1.25, "tactical_fluidity": 1.15},
    "low_block": {"pace_sprint": 1.15, "stamina_workrate": 1.35, "pressing_intensity": 0.80, "ball_recovery": 1.50, "aerial_duels": 1.45, "defensive_positioning": 1.70, "short_pass_accuracy": 1.05, "progressive_passes": 1.10, "xt_creation": 1.00, "progressive_carries": 1.00, "space_creation": 0.95, "ball_retention_tempo": 1.05, "tactical_discipline": 1.65, "tactical_fluidity": 0.85},
}


def _cosine(a: list[float], b: list[float]) -> float:
    va, vb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    na, nb = float(np.linalg.norm(va)), float(np.linalg.norm(vb))
    return float(np.dot(va, vb) / (na * nb)) if na > 0 and nb > 0 else 0.0


@app.get("/api/clubs")
def list_clubs() -> list[dict]:
    with SessionLocal() as db:
        rows = db.execute(select(Club, League).join(League, Club.league_id == League.id, isouter=True).order_by(League.tier, Club.id)).all()
        return [{"id": c.id, "name": c.name_ar or c.name, "division": lg.code if lg else "EGY1"} for c, lg in rows]


@app.get("/api/scouting/database")
def query_scouting_db(division: str = "all", position: str = "all", q: str = "", limit: int = 80) -> dict:
    with SessionLocal() as db:
        stmt = select(Player, Club).join(Club, Player.club_id == Club.id, isouter=True)
        if division and division != "all":
            stmt = stmt.where(Player.division == division)
        if position and position != "all":
            fmap = {"CB": ["CB", "GK"], "FB": ["LB", "RB"], "MID": ["DM", "CM", "AM"], "ATT": ["RW", "LW", "ST"]}
            stmt = stmt.where(Player.position.in_(fmap.get(position, [position])))
        if q.strip():
            term = f"%{q.strip()}%"
            stmt = stmt.where(or_(Player.name.ilike(term), Player.name_ar.ilike(term), Club.name_ar.ilike(term)))
        rows = db.execute(stmt.order_by(desc(Player.market_value_eur)).limit(limit)).all()
        link_counts: dict[int, int] = {}
        for lnk in db.scalars(select(PlayerMatchLink)).all():
            link_counts[lnk.player_id] = link_counts.get(lnk.player_id, 0) + 1

        out = []
        for p, c in rows:
            prof = p.scouting_profile or {}
            ov = round(sum(float(prof.get(k, 65)) for k in SCOUTING_METRIC_KEYS) / len(SCOUTING_METRIC_KEYS), 1)
            out.append({
                "id": p.id, "name": p.name_ar or p.name, "club_name": (c.name_ar or c.name) if c else "",
                "division": p.division, "position": p.position, "position_family": position_family(p.position),
                "jersey_number": p.jersey_number, "age": p.age, "preferred_foot": p.preferred_foot,
                "market_value_eur": p.market_value_eur or 0, "market_value_egp": p.market_value_egp or 0,
                "overall_rating": ov, "video_matches_count": link_counts.get(p.id, 0),
                "scouting_profile": prof,
            })
        return {"total": len(out), "metric_keys": SCOUTING_METRIC_KEYS, "position_templates": POSITION_RADAR_LABELS, "players": out}


@app.get("/api/scouting/player/{player_id}")
def get_db_player_portfolio(player_id: int) -> dict:
    with SessionLocal() as db:
        p = db.get(Player, player_id)
        if not p:
            raise HTTPException(status_code=404, detail="اللاعب غير موجود")
        c = db.get(Club, p.club_id) if p.club_id else None
        links = db.scalars(
            select(PlayerMatchLink).where(PlayerMatchLink.player_id == player_id).order_by(desc(PlayerMatchLink.created_at))
        ).all()
        linked_matches = [
            {
                "match_slug": lk.match_slug,
                "identity_key": lk.identity_key,
                "jersey_number": lk.jersey_number,
                "overall_score": lk.overall_score,
                "max_speed_kmh": lk.max_speed_kmh,
                "distance_m": lk.distance_m,
                "avg_voronoi_m2": lk.avg_voronoi_m2,
                "portrait_url": lk.portrait_url,
                "notes": lk.notes,
            }
            for lk in links
        ]
        p_dict = {
            "id": p.id,
            "name": p.name_ar or p.name,
            "club_id": p.club_id,
            "club_name": (c.name_ar or c.name) if c else "",
            "division": p.division,
            "position": p.position,
            "position_family": position_family(p.position),
            "jersey_number": p.jersey_number,
            "age": p.age,
            "height_cm": p.height_cm,
            "preferred_foot": p.preferred_foot,
            "nationality": p.nationality,
            "market_value_eur": p.market_value_eur or 0,
            "market_value_egp": p.market_value_egp or 0,
            "scouting_profile": p.scouting_profile or {},
        }
        return build_db_player_portfolio(p_dict, linked_matches)


@app.get("/api/scouting/moneyball/{player_id}")
def moneyball_alternatives(player_id: int, limit: int = 6) -> dict:
    with SessionLocal() as db:
        target = db.get(Player, player_id)
        if not target:
            raise HTTPException(status_code=404, detail="اللاعب غير موجود")
        t_fam = position_family(target.position)
        t_prof = target.scouting_profile or {k: 70.0 for k in SCOUTING_METRIC_KEYS}
        t_vec = [float(t_prof.get(k, 70.0)) for k in SCOUTING_METRIC_KEYS]
        t_val = int(target.market_value_eur or 500000)

        cands = db.execute(
            select(Player, Club).join(Club, Player.club_id == Club.id, isouter=True)
            .where(Player.id != target.id, Player.division.in_(["EGY2", "EGY_YOUTH"]), Player.market_value_eur <= max(250000, int(t_val * 0.65)))
        ).all()
        scored = []
        for cand, cc in cands:
            if not cand.scouting_profile:
                continue
            c_vec = [float(cand.scouting_profile.get(k, 65.0)) for k in SCOUTING_METRIC_KEYS]
            sim = 0.68 * _cosine(t_vec, c_vec) + 0.32 * max(0.0, 1.0 - float(np.mean(np.abs(np.asarray(t_vec) - np.asarray(c_vec)))) / 45.0)
            if cand.position == target.position:
                sim += 0.04
            elif position_family(cand.position) != t_fam:
                sim -= 0.09
            c_eur = int(cand.market_value_eur or 80000)
            scored.append({
                "id": cand.id, "name": cand.name_ar or cand.name, "club_name": (cc.name_ar or cc.name) if cc else "",
                "division": cand.division, "position": cand.position, "age": cand.age,
                "market_value_egp": int(cand.market_value_egp or c_eur * 53),
                "savings_pct": round(max(0.0, (1.0 - c_eur / max(1, t_val)) * 100.0), 1),
                "similarity_pct": round(min(99.2, max(45.0, sim * 100.0)), 1),
                "scouting_profile": cand.scouting_profile,
            })
        scored.sort(key=lambda x: x["similarity_pct"], reverse=True)
        return {"target_id": target.id, "target_name": target.name_ar or target.name, "alternatives": scored[:limit]}


@app.get("/api/clubs/{club_id}/squad-analysis")
def club_squad_analysis(club_id: int, style: str = "high_press") -> dict:
    weights = COACHING_STYLES.get(style, COACHING_STYLES["high_press"])
    with SessionLocal() as db:
        club = db.get(Club, club_id)
        if not club:
            raise HTTPException(status_code=404, detail="النادي غير موجود")
        squad = db.scalars(select(Player).where(Player.club_id == club_id).order_by(desc(Player.market_value_eur))).all()
        rows = []
        w_sum = sum(weights.values())
        for p in squad:
            prof = p.scouting_profile or {}
            fit = sum(float(prof.get(k, 65.0)) * weights[k] for k in SCOUTING_METRIC_KEYS) / max(1e-6, w_sum)
            rows.append({
                "id": p.id, "name": p.name_ar or p.name, "position": p.position, "age": p.age,
                "jersey_number": p.jersey_number, "market_value_egp": p.market_value_egp or 0,
                "style_fit_pct": round(min(98.5, max(45.0, fit)), 1),
            })
        slots = [("GK", "حارس", 8, 34), ("RB", "ظهير أيمن", 28, 56), ("CB", "مساك أيمن", 22, 42), ("CB", "مساك أيسر", 22, 26), ("LB", "ظهير أيسر", 28, 12), ("DM", "ارتكاز 6", 46, 34), ("CM", "وسط 8", 58, 46), ("AM", "صانع لعب 10", 68, 34), ("RW", "جناح أيمن", 82, 54), ("LW", "جناح أيسر", 82, 14), ("ST", "مهاجم صريح", 92, 34)]
        used = set()
        xi = []
        for idx, (pos, label_ar, xm, ym) in enumerate(slots):
            cands = [r for r in rows if r["id"] not in used]
            same = [r for r in cands if r["position"] == pos] or cands
            if same:
                pick = max(same, key=lambda x: x["style_fit_pct"])
                used.add(pick["id"])
                xi.append({"slot_idx": idx, "slot_label_ar": label_ar, "slot_pos": pos, "x_m": xm, "y_m": ym, **pick})
        weakest = sorted(xi, key=lambda x: x["style_fit_pct"])[:3]
        return {
            "club_name": club.name_ar or club.name,
            "style": style,
            "avg_fit_pct": round(sum(x["style_fit_pct"] for x in xi) / max(1, len(xi)), 1),
            "starting_xi": xi,
            "weakest_slots": weakest,
        }
