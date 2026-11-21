"""EGY-SCOUT PRO V3.0 FastAPI Backend.

Offline-first Club-Exclusive Enterprise API serving:
- Automatic Pitch Homography + 3D Broadcast Telemetry & Video Rendering
- Dynamic 4-Phase V3 Tactical Intelligence, Fluidity/Discipline & Passing Lanes
- Egyptian Tactical Doctor (Tempo, Hold >2.8s, Second Ball, Fatigue >18%, Low-Block Breaker)
- Egyptian League Seed Database (46 clubs) & Moneyball Cosine Similarity Finder
"""
from __future__ import annotations

import asyncio
import json
import math
import shutil
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import desc, or_, select

from core.config import get_settings
from core.database import MatchStorage, SessionLocal, init_db
from engine.video_renderer import render_clip
from models.schema import Club, Job, League, Match, Player, PlayerMatchStats
from services.egyptian_seed import (
    POSITION_ARCHETYPES,
    POSITION_RADAR_LABELS,
    SCOUTING_METRIC_KEYS,
    position_family,
    seed_egyptian_database,
)
from services.ingestor import EGYPTIAN_SEARCH_QUERIES, AutonomousMatchHarvester
from services.pipeline import CANONICAL_SLOTS, SLOT_DEFAULT_POS, analyze_match, run_full_pipeline

settings = get_settings()


# ---------------- WebSocket Job Broadcaster ----------------
class _JobHub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    def broadcast(self, payload: dict) -> None:
        if not self.loop or not self.clients:
            return
        msg = json.dumps(payload, ensure_ascii=False)
        for ws in list(self.clients):
            try:
                asyncio.run_coroutine_threadsafe(ws.send_text(msg), self.loop)
            except Exception:
                self.clients.discard(ws)


hub = _JobHub()


@asynccontextmanager
async def lifespan(_app: FastAPI):  # noqa: ANN201
    hub.loop = asyncio.get_running_loop()
    init_db()
    seed_egyptian_database()
    yield


app = FastAPI(title="EGY-SCOUT PRO V3.0 Engine", version="3.0.0", lifespan=lifespan)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _update_job(job_id: int, *, status: str | None = None, progress: float | None = None, message: str | None = None, result: dict | None = None) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        if status is not None:
            job.status = status
        if progress is not None:
            job.progress = round(float(progress), 4)
        if message is not None:
            job.message = message
        if result is not None:
            job.result = result
        db.commit()
        payload = {
            "id": job.id,
            "match_id": job.match_id,
            "kind": job.kind,
            "status": job.status,
            "progress": job.progress,
            "message": job.message,
            "result": job.result,
        }
    hub.broadcast(payload)


def _spawn_match_pipeline_worker(match_id: int, job_id: int, youtube_url: str | None = None, max_sec: int = 60) -> None:
    def _run() -> None:
        try:
            _update_job(job_id, status="running", progress=0.02, message="بدء معالجة المباراة...")
            if youtube_url:
                with SessionLocal() as db:
                    m = db.get(Match, match_id)
                    if m:
                        m.status = "downloading"
                        m.error = None
                        db.commit()
                harvester = AutonomousMatchHarvester()

                def _dl_cb(p: float, msg: str) -> None:
                    _update_job(job_id, progress=0.02 + 0.30 * p, message=msg)

                downloaded_m = harvester.ingest_youtube(youtube_url, max_sec=max_sec, progress_cb=_dl_cb)
                target_id = downloaded_m.id
            else:
                target_id = match_id

            def _pipe_cb(p: float, msg: str) -> None:
                base = 0.32 if youtube_url else 0.05
                span = 0.68 if youtube_url else 0.95
                _update_job(job_id, progress=base + span * p, message=msg)

            summary = run_full_pipeline(target_id, progress_cb=_pipe_cb)
            _update_job(
                job_id,
                status="done",
                progress=1.0,
                message="اكتمل التحليل التكتيكي والـ 3D بنجاح",
                result={"match_id": target_id, "pitch_coverage": summary.get("pitch_coverage", 1.0)},
            )
        except Exception as exc:
            with SessionLocal() as db:
                m = db.get(Match, match_id)
                if m:
                    m.status = "failed"
                    m.error = str(exc)
                    db.commit()
            _update_job(job_id, status="failed", message=f"خطأ أثناء المعالجة: {exc}")

    t = threading.Thread(target=_run, daemon=True)
    t.start()


def _serialize_match(m: Match) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "source_url": m.source_url,
        "competition": m.competition,
        "home_team_name": m.home_team_name,
        "away_team_name": m.away_team_name,
        "home_club_id": m.home_club_id,
        "away_club_id": m.away_club_id,
        "home_team_cluster": m.home_team_cluster if m.home_team_cluster in (0, 1) else 0,
        "fps": m.fps or 25.0,
        "width": m.width or 1280,
        "height": m.height or 720,
        "duration_s": m.duration_s or 0.0,
        "frame_count": m.frame_count or 0,
        "status": m.status,
        "has_pitch_coords": bool(m.has_pitch_coords),
        "pitch_coverage": float(m.pitch_coverage or 0.0),
        "error": m.error,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "video_url": f"/api/matches/{m.id}/video" if m.video_path else None,
    }


def _stat_to_radar_vector(st: PlayerMatchStats) -> dict[str, float]:
    """Derive 14 standardized [0..100] radar dimensions purely from real tracked telemetry."""
    mins = max(0.25, float(st.minutes_tracked or 0.5))
    pass_acc = (float(st.passes_completed) / float(st.passes) * 100.0) if st.passes > 0 else 72.0
    hold_s = float(st.avg_time_on_ball_sec or 1.4)
    tempo_score = max(35.0, min(98.0, 96.0 - max(0.0, hold_s - 1.1) * 16.0))
    return {
        "pace_sprint": round(min(98.0, max(35.0, (float(st.max_speed_kmh) / 34.5) * 95.0)), 1),
        "stamina_workrate": round(min(98.0, max(35.0, (float(st.distance_per_min_m) / 140.0) * 92.0)), 1),
        "pressing_intensity": round(min(98.0, max(35.0, 42.0 + (float(st.pressing_actions) / mins) * 14.0)), 1),
        "ball_recovery": round(min(98.0, max(35.0, 44.0 + (float(st.recoveries) / mins) * 16.0)), 1),
        "aerial_duels": round(min(95.0, max(40.0, 58.0 + (float(st.recoveries) / mins) * 8.0)), 1),
        "defensive_positioning": round(min(98.0, max(35.0, float(st.discipline_score or 70.0))), 1),
        "short_pass_accuracy": round(min(98.0, max(40.0, pass_acc)), 1),
        "progressive_passes": round(min(98.0, max(35.0, 42.0 + ((float(st.progressive_passes) + float(st.line_breaking_passes) * 1.6) / mins) * 15.0)), 1),
        "xt_creation": round(min(98.0, max(35.0, 40.0 + (float(st.xt_generated) / mins) * 180.0)), 1),
        "progressive_carries": round(min(98.0, max(35.0, 44.0 + (float(st.progressive_carries) / mins) * 18.0)), 1),
        "space_creation": round(min(98.0, max(35.0, 45.0 + (float(st.offball_runs) / mins) * 12.0 + (float(st.avg_attacking_space_m2 or 120.0) / 8.0))), 1),
        "ball_retention_tempo": round(tempo_score, 1),
        "tactical_discipline": round(min(98.0, max(35.0, float(st.discipline_score or 70.0))), 1),
        "tactical_fluidity": round(min(98.0, max(35.0, float(st.fluidity_score or 62.0))), 1),
    }


def _cosine_similarity(v1: list[float], v2: list[float]) -> float:
    a = np.asarray(v1, dtype=np.float64)
    b = np.asarray(v2, dtype=np.float64)
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-9:
        return 0.0
    return float(np.clip(np.dot(a, b) / denom, 0.0, 1.0))


# ---------------- Health & Jobs ----------------
@app.get("/api/health")
def health() -> dict:
    with SessionLocal() as db:
        clubs_cnt = db.query(Club).count()
        players_cnt = db.query(Player).count()
        matches_cnt = db.query(Match).count()
    return {
        "status": "ok",
        "version": "3.0.0",
        "clubs_count": clubs_cnt,
        "players_count": players_cnt,
        "matches_count": matches_cnt,
    }


@app.get("/api/jobs")
def list_jobs(limit: int = 20) -> list[dict]:
    with SessionLocal() as db:
        jobs = db.scalars(select(Job).order_by(desc(Job.id)).limit(limit)).all()
        return [
            {
                "id": j.id,
                "match_id": j.match_id,
                "kind": j.kind,
                "status": j.status,
                "progress": j.progress,
                "message": j.message,
                "result": j.result,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
            for j in jobs
        ]


@app.websocket("/ws/jobs")
async def ws_jobs(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)


# ---------------- Match Endpoints ----------------
@app.get("/api/matches")
def list_matches() -> list[dict]:
    with SessionLocal() as db:
        matches = db.scalars(select(Match).order_by(desc(Match.id))).all()
        return [_serialize_match(m) for m in matches]


@app.get("/api/matches/{match_id}")
def get_match(match_id: int) -> dict:
    with SessionLocal() as db:
        m = db.get(Match, match_id)
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        stats = db.scalars(
            select(PlayerMatchStats)
            .where(PlayerMatchStats.match_id == match_id)
            .order_by(desc(PlayerMatchStats.scout_score))
        ).all()
        players_out = []
        for s in stats:
            linked_name = None
            linked_pos = None
            if s.player_id:
                pl = db.get(Player, s.player_id)
                if pl:
                    linked_name = pl.name_ar or pl.name
                    linked_pos = pl.position
            if not linked_pos:
                if s.role == "goalkeeper":
                    linked_pos = "GK"
                elif "_s" in (s.identity_key or ""):
                    try:
                        s_idx = int(str(s.identity_key).split("_s")[-1])
                        linked_pos = SLOT_DEFAULT_POS.get(s_idx, "CM")
                    except ValueError:
                        linked_pos = "CM"
                else:
                    linked_pos = "CM"
            players_out.append(
                {
                    "id": s.id,
                    "identity_key": s.identity_key,
                    "player_id": s.player_id,
                    "player_name": linked_name or (f"لاعب #{s.jersey_number}" if s.jersey_number else f"مسار {s.identity_key}"),
                    "position": linked_pos,
                    "team_cluster": s.team_cluster,
                    "jersey_number": s.jersey_number,
                    "role": s.role,
                    "minutes_tracked": s.minutes_tracked,
                    "total_distance_m": s.total_distance_m,
                    "distance_per_min_m": s.distance_per_min_m,
                    "max_speed_kmh": s.max_speed_kmh,
                    "avg_speed_kmh": s.avg_speed_kmh,
                    "hir_distance_m": s.hir_distance_m,
                    "sprint_distance_m": s.sprint_distance_m,
                    "sprint_count": s.sprint_count,
                    "passes": s.passes,
                    "passes_completed": s.passes_completed,
                    "progressive_passes": s.progressive_passes,
                    "line_breaking_passes": s.line_breaking_passes,
                    "progressive_carries": s.progressive_carries,
                    "xt_generated": s.xt_generated,
                    "pressing_actions": s.pressing_actions,
                    "recoveries": s.recoveries,
                    "avg_space_m2": s.avg_space_m2,
                    "avg_attacking_space_m2": s.avg_attacking_space_m2,
                    "space_created_m2": s.space_created_m2,
                    "offball_runs": s.offball_runs,
                    "tactical_deviation_m": s.tactical_deviation_m,
                    "fluidity_score": s.fluidity_score,
                    "discipline_score": s.discipline_score,
                    "roaming_radius_m": s.roaming_radius_m,
                    "avg_time_on_ball_sec": s.avg_time_on_ball_sec,
                    "tactical_role_ar": s.tactical_role_ar,
                    "scout_score": s.scout_score,
                    "score_breakdown": s.score_breakdown,
                    "verdict": s.verdict,
                }
            )

        storage = MatchStorage(match_id)
        summary = storage.read_json(storage.summary_path, default={})
        out = _serialize_match(m)
        out["summary"] = summary
        out["players"] = players_out
        return out


@app.get("/api/matches/{match_id}/video")
def stream_match_video(match_id: int) -> FileResponse:
    with SessionLocal() as db:
        m = db.get(Match, match_id)
        if not m or not m.video_path:
            raise HTTPException(status_code=404, detail="ملف الفيديو غير متاح")
        p = Path(m.video_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="ملف الفيديو غير موجود على القرص")
    return FileResponse(path=str(p), media_type="video/mp4", filename=p.name)


@app.get("/api/matches/{match_id}/telemetry")
def get_match_telemetry(match_id: int) -> dict:
    from models.schema import Player, PlayerMatchStats

    player_names: dict[str, str] = {}
    with SessionLocal() as db:
        m = db.get(Match, match_id)
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        fps = float(m.fps or 25.0)
        width = int(m.width or 1280)
        height = int(m.height or 720)
        frame_count = int(m.frame_count or 0)
        p_rows = db.execute(
            select(PlayerMatchStats.identity_key, Player.name_ar, Player.name)
            .join(Player, PlayerMatchStats.player_id == Player.id, isouter=True)
            .where(PlayerMatchStats.match_id == match_id)
        ).all()
        for ikey, n_ar, n_en in p_rows:
            if ikey and (n_ar or n_en):
                player_names[str(ikey)] = str(n_ar or n_en)

    storage = MatchStorage(match_id)
    summary = storage.read_json(storage.summary_path, default={})
    team_kits = summary.get("team_kits", {})
    df = storage.read_df(storage.telemetry_path)
    frame_tactics = storage.read_json(storage.root / "frame_tactics.json", default={})

    if df.empty and not frame_tactics:
        return {
            "match_id": match_id,
            "fps": fps,
            "width": width,
            "height": height,
            "frame_count": frame_count,
            "has_pitch_coords": True,
            "team_kits": team_kits,
            "frames": [],
        }

    df_by_fid = {int(fid): grp for fid, grp in df.groupby("frame_id")} if not df.empty else {}
    all_fids = sorted(set(df_by_fid.keys()) | set(int(k) for k in frame_tactics.keys()))
    frames_out: list[dict] = []
    for fid_int in all_fids:
        grp = df_by_fid.get(fid_int)
        ft = frame_tactics.get(str(fid_int), {})
        players_arr = []
        ball_obj = None
        if grp is not None and not grp.empty:
            for _, r in grp.iterrows():
                role = str(r["role"])
                u_norm = float(r.get("u_norm") or (float(r["u"]) / max(1, width)))
                v_norm = float(r.get("v_norm") or (float(r["v"]) / max(1, height)))
                if role == "ball":
                    ball_obj = {
                        "u_norm": round(u_norm, 5),
                        "v_norm": round(v_norm, 5),
                        "x_m": round(float(r["x_smooth"]), 2),
                        "y_m": round(float(r["y_smooth"]), 2),
                    }
                    continue
                jn_raw = r.get("jersey_number")
                jn = int(jn_raw) if (jn_raw is not None and not (isinstance(jn_raw, float) and math.isnan(jn_raw)) and int(jn_raw) > 0) else None
                vor = r.get("voronoi_m2")
                vor_val = round(float(vor), 1) if (vor is not None and not (isinstance(vor, float) and math.isnan(vor))) else None
                ikey = str(r["identity_key"])
                players_arr.append(
                    {
                        "track_id": int(r["track_id"]),
                        "identity_key": ikey,
                        "player_name": player_names.get(ikey),
                        "team_cluster": int(r["team_cluster"]),
                        "jersey_number": jn,
                        "role": role,
                        "u_norm": round(u_norm, 5),
                        "v_norm": round(v_norm, 5),
                        "x1_norm": round(float(r["x1"]) / max(1, width), 5),
                        "y1_norm": round(float(r["y1"]) / max(1, height), 5),
                        "x2_norm": round(float(r["x2"]) / max(1, width), 5),
                        "y2_norm": round(float(r["y2"]) / max(1, height), 5),
                        "x_m": round(float(r["x_smooth"]), 2),
                        "y_m": round(float(r["y_smooth"]), 2),
                        "vx": round(float(r["vx"]), 2),
                        "vy": round(float(r["vy"]), 2),
                        "speed_kmh": round(float(r["speed_kmh"]), 1),
                        "voronoi_m2": vor_val,
                    }
                )

        time_s = (
            round(float(grp["time_s"].iloc[0]), 3)
            if (grp is not None and not grp.empty)
            else round(float(ft.get("time_s", fid_int / max(1.0, fps))), 3)
        )
        frames_out.append(
            {
                "frame_id": fid_int,
                "time_s": time_s,
                "is_tactical_wide": bool(ft.get("is_tactical_wide", len(players_arr) >= 5)),
                "camera_fov_m": ft.get("camera_fov_m", []),
                "h_inv": ft.get("h_inv"),
                "poss_team": ft.get("poss_team"),
                "ball_carrier_track_id": ft.get("ball_carrier_track_id", -1),
                "game_phase": ft.get("game_phase", {}),
                "formations": ft.get("formations", {}),
                "gaps_gt_16m": ft.get("gaps_gt_16m", []),
                "passing_lanes": ft.get("passing_lanes", []),
                "cover_shadows": ft.get("cover_shadows", []),
                "voronoi_polys": ft.get("voronoi_polys", []),
                "players": players_arr,
                "ball": ball_obj,
            }
        )

    return {
        "match_id": match_id,
        "fps": fps,
        "width": width,
        "height": height,
        "frame_count": frame_count,
        "has_pitch_coords": True,
        "team_kits": team_kits,
        "frames": frames_out,
    }


@app.get("/api/matches/{match_id}/events")
def get_match_events(match_id: int) -> dict:
    storage = MatchStorage(match_id)
    summary = storage.read_json(storage.summary_path, default={})
    df_ev = storage.read_df(storage.events_path)
    events = df_ev.replace({np.nan: None}).to_dict("records") if not df_ev.empty else []
    return {
        "match_id": match_id,
        "timeline_tags": summary.get("timeline_tags", []),
        "events": events[:200],
    }


class YouTubeIngestRequest(BaseModel):
    url_or_query: str
    competition: str | None = "الدوري المصري الممتاز"
    max_sec: int = 60


@app.post("/api/matches/ingest-youtube")
def ingest_youtube_match(req: YouTubeIngestRequest) -> dict:
    harvester = AutonomousMatchHarvester()
    with SessionLocal() as db:
        m = Match(
            title=req.url_or_query[:240],
            source_url=req.url_or_query if req.url_or_query.startswith("http") else None,
            competition=req.competition,
            status="downloading",
        )
        db.add(m)
        db.commit()
        db.refresh(m)
        job = Job(match_id=m.id, kind="ingest", status="queued", progress=0.0, message="في انتظار سحب الفيديو...")
        db.add(job)
        db.commit()
        db.refresh(job)

    # Launch background download + normalization + full CV pipeline
    def _worker() -> None:
        try:
            _update_job(job.id, status="running", progress=0.05, message="جاري سحب المقطع من يوتيوب...")
            dl = harvester.ingest_youtube(
                req.url_or_query,
                competition=req.competition,
                max_sec=req.max_sec,
                progress_cb=lambda p, msg: _update_job(job.id, progress=0.05 + 0.30 * p, message=msg),
            )
            # Re-point placeholder match row if ingest_youtube matched/created another record
            target_id = dl.id
            if target_id != m.id:
                with SessionLocal() as db:
                    placeholder = db.get(Match, m.id)
                    if placeholder and placeholder.status == "downloading":
                        db.delete(placeholder)
                    j = db.get(Job, job.id)
                    if j:
                        j.match_id = target_id
                    db.commit()
            summary = run_full_pipeline(
                target_id,
                progress_cb=lambda p, msg: _update_job(job.id, progress=0.35 + 0.65 * p, message=msg),
            )
            _update_job(
                job.id,
                status="done",
                progress=1.0,
                message="تم السحب والتحليل التكتيكي بنجاح",
                result={"match_id": target_id, "pitch_coverage": summary.get("pitch_coverage", 1.0)},
            )
        except Exception as exc:
            with SessionLocal() as db:
                bad = db.get(Match, m.id)
                if bad:
                    bad.status = "failed"
                    bad.error = str(exc)
                    db.commit()
            _update_job(job.id, status="failed", message=f"فشل السحب أو التحليل: {exc}")

    threading.Thread(target=_worker, daemon=True).start()
    return {"match_id": m.id, "job_id": job.id, "status": "queued"}


@app.post("/api/matches/upload")
async def upload_local_match(
    file: UploadFile = File(...),
    title: str = Form("مباراة محلية للتحليل التكتيكي"),
    competition: str = Form("الدوري المصري"),
    home_team: str = Form(""),
    away_team: str = Form(""),
    max_sec: int = Form(0),
) -> dict:
    raw_tmp = settings.raw_dir / f"upload_{uuid.uuid4().hex[:10]}_{Path(file.filename or 'clip.mp4').name}"
    raw_tmp.parent.mkdir(parents=True, exist_ok=True)
    with raw_tmp.open("wb") as out_f:
        shutil.copyfileobj(file.file, out_f)

    harvester = AutonomousMatchHarvester()
    try:
        m = harvester.ingest_local_file(
            raw_tmp,
            title=title or file.filename or "مباراة محلية",
            competition=competition,
            home_team_name=home_team or None,
            away_team_name=away_team or None,
            max_sec=max_sec if max_sec > 0 else None,
        )
    finally:
        if raw_tmp.exists():
            raw_tmp.unlink(missing_ok=True)

    with SessionLocal() as db:
        job = Job(match_id=m.id, kind="track", status="queued", progress=0.0, message="بدء التتبع التكتيكي...")
        db.add(job)
        db.commit()
        db.refresh(job)

    _spawn_match_pipeline_worker(m.id, job.id)
    return {"match_id": m.id, "job_id": job.id, "status": "queued"}


@app.post("/api/matches/{match_id}/reanalyze")
def reanalyze_match(match_id: int) -> dict:
    with SessionLocal() as db:
        m = db.get(Match, match_id)
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        vpath = Path(m.video_path) if m.video_path else None
        needs_dl = (not vpath or not vpath.exists()) and bool(m.source_url)
        yt_url = m.source_url if needs_dl else None
        if not vpath and not m.source_url:
            raise HTTPException(status_code=400, detail="لا يوجد ملف فيديو أو رابط لإعادة التحليل")
        m.status = "queued"
        m.error = None
        job = Job(match_id=m.id, kind="track", status="queued", progress=0.0, message="جاري إعادة تحليل المباراة...")
        db.add(job)
        db.commit()
        db.refresh(job)

    _spawn_match_pipeline_worker(match_id, job.id, youtube_url=yt_url)
    return {"match_id": match_id, "job_id": job.id, "status": "queued"}


@app.delete("/api/matches/{match_id}")
def delete_match(match_id: int) -> dict:
    with SessionLocal() as db:
        m = db.get(Match, match_id)
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        db.delete(m)
        db.commit()
    storage = MatchStorage(match_id)
    if storage.root.exists():
        shutil.rmtree(storage.root, ignore_errors=True)
    return {"deleted": match_id}


class ExportClipRequest(BaseModel):
    start_s: float = 0.0
    end_s: float | None = None
    highlight_identity: str | None = None


@app.post("/api/matches/{match_id}/export-clip")
def export_3d_clip(match_id: int, req: ExportClipRequest) -> dict:
    with SessionLocal() as db:
        m = db.get(Match, match_id)
        if not m or not m.video_path or not Path(m.video_path).exists():
            raise HTTPException(status_code=404, detail="فيديو المباراة غير متاح للتصدير")
        vpath = m.video_path
        job = Job(match_id=match_id, kind="render", status="queued", progress=0.0, message="تجهيز فيديو الـ 3D...")
        db.add(job)
        db.commit()
        db.refresh(job)

    filename = f"egy_scout_3d_m{match_id}_{uuid.uuid4().hex[:6]}.mp4"
    out_path = settings.renders_dir / filename
    storage = MatchStorage(match_id)

    def _render() -> None:
        try:
            _update_job(job.id, status="running", progress=0.05, message="تحميل بيانات الـ 3D...")
            df_tel = storage.read_df(storage.telemetry_path)
            ftac = storage.read_json(storage.root / "frame_tactics.json", default={})
            summ = storage.read_json(storage.summary_path, default={})
            render_clip(
                video_path=vpath,
                telemetry=df_tel,
                out_path=out_path,
                start_s=req.start_s,
                end_s=req.end_s,
                frame_tactics=ftac,
                team_kits=summ.get("team_kits"),
                highlight_identity=req.highlight_identity,
                progress_cb=lambda p, msg: _update_job(job.id, progress=p, message=msg),
            )
            _update_job(
                job.id,
                status="done",
                progress=1.0,
                message="جاهز للتحميل",
                result={"download_url": f"/api/renders/{filename}", "filename": filename},
            )
        except Exception as exc:
            _update_job(job.id, status="failed", message=f"فشل تصدير الفيديو: {exc}")

    threading.Thread(target=_render, daemon=True).start()
    return {"job_id": job.id, "filename": filename, "download_url": f"/api/renders/{filename}"}


@app.get("/api/renders/{filename}")
def download_rendered_clip(filename: str) -> FileResponse:
    p = settings.renders_dir / Path(filename).name
    if not p.exists():
        raise HTTPException(status_code=404, detail="المقطع المصدر غير موجود")
    return FileResponse(path=str(p), media_type="video/mp4", filename=p.name)


# ---------------- Scouting, Radars & Moneyball Egypt ----------------
@app.get("/api/top-prospects")
def get_top_prospects(limit: int = 30) -> list[dict]:
    with SessionLocal() as db:
        rows = db.scalars(
            select(PlayerMatchStats)
            .where(PlayerMatchStats.scout_score.is_not(None))
            .order_by(desc(PlayerMatchStats.scout_score))
            .limit(limit)
        ).all()
        out = []
        for s in rows:
            m = db.get(Match, s.match_id)
            p = db.get(Player, s.player_id) if s.player_id else None
            out.append(
                {
                    "stat_id": s.id,
                    "match_id": s.match_id,
                    "match_title": m.title if m else f"Match #{s.match_id}",
                    "identity_key": s.identity_key,
                    "player_name": (p.name_ar or p.name) if p else (f"لاعب #{s.jersey_number}" if s.jersey_number else s.identity_key),
                    "jersey_number": s.jersey_number,
                    "team_cluster": s.team_cluster,
                    "minutes_tracked": s.minutes_tracked,
                    "max_speed_kmh": s.max_speed_kmh,
                    "xt_generated": s.xt_generated,
                    "line_breaking_passes": s.line_breaking_passes,
                    "fluidity_score": s.fluidity_score,
                    "discipline_score": s.discipline_score,
                    "tactical_role_ar": s.tactical_role_ar,
                    "scout_score": s.scout_score,
                    "verdict": s.verdict,
                }
            )
        return out


@app.get("/api/scouting/stat/{stat_id}")
def get_stat_profile(stat_id: int) -> dict:
    with SessionLocal() as db:
        s = db.get(PlayerMatchStats, stat_id)
        if not s:
            raise HTTPException(status_code=404, detail="بطاقة اللاعب غير موجودة")
        m = db.get(Match, s.match_id)
        p = db.get(Player, s.player_id) if s.player_id else None
        club = db.get(Club, p.club_id) if p and p.club_id else None

        vec_dict = _stat_to_radar_vector(s)
        fam = position_family(p.position if p else "CM")
        labels = POSITION_RADAR_LABELS[fam]
        radar_axes = [{"key": k, "label_ar": labels[k], "value": vec_dict[k]} for k in SCOUTING_METRIC_KEYS]

        return {
            "stat_id": s.id,
            "match_id": s.match_id,
            "match_title": m.title if m else "",
            "identity_key": s.identity_key,
            "team_cluster": s.team_cluster,
            "jersey_number": s.jersey_number,
            "role": s.role,
            "player": {
                "id": p.id,
                "name": p.name_ar or p.name,
                "club": club.name_ar or club.name if club else None,
                "position": p.position,
                "age": p.age,
                "preferred_foot": p.preferred_foot,
                "market_value_eur": p.market_value_eur,
                "market_value_egp": p.market_value_egp,
            }
            if p
            else None,
            "position_family": fam,
            "radar_axes": radar_axes,
            "stats": {
                "minutes_tracked": s.minutes_tracked,
                "total_distance_m": s.total_distance_m,
                "distance_per_min_m": s.distance_per_min_m,
                "max_speed_kmh": s.max_speed_kmh,
                "avg_speed_kmh": s.avg_speed_kmh,
                "hir_distance_m": s.hir_distance_m,
                "sprint_distance_m": s.sprint_distance_m,
                "sprint_count": s.sprint_count,
                "passes": s.passes,
                "passes_completed": s.passes_completed,
                "progressive_passes": s.progressive_passes,
                "line_breaking_passes": s.line_breaking_passes,
                "progressive_carries": s.progressive_carries,
                "xt_generated": s.xt_generated,
                "pressing_actions": s.pressing_actions,
                "recoveries": s.recoveries,
                "avg_space_m2": s.avg_space_m2,
                "avg_attacking_space_m2": s.avg_attacking_space_m2,
                "space_created_m2": s.space_created_m2,
                "offball_runs": s.offball_runs,
                "tactical_deviation_m": s.tactical_deviation_m,
                "fluidity_score": s.fluidity_score,
                "discipline_score": s.discipline_score,
                "roaming_radius_m": s.roaming_radius_m,
                "avg_time_on_ball_sec": s.avg_time_on_ball_sec,
                "tactical_role_ar": s.tactical_role_ar,
                "heatmap": s.heatmap,
                "scout_score": s.scout_score,
                "score_breakdown": s.score_breakdown,
                "verdict": s.verdict,
            },
        }


@app.get("/api/clubs")
def list_clubs(division: str | None = None) -> list[dict]:
    with SessionLocal() as db:
        q = select(Club, League).join(League, Club.league_id == League.id, isouter=True)
        if division and division != "all":
            q = q.where(League.code == division)
        rows = db.execute(q.order_by(League.tier, Club.id)).all()
        return [
            {
                "id": c.id,
                "name": c.name_ar or c.name,
                "external_id": c.external_id,
                "division": lg.code if lg else None,
                "league_name": lg.name if lg else None,
            }
            for c, lg in rows
        ]


@app.get("/api/scouting/database")
def query_scouting_database(
    division: str = "all",
    position: str = "all",
    club_id: int | None = None,
    q: str = "",
    max_age: int | None = None,
    limit: int = 80,
) -> dict:
    with SessionLocal() as db:
        stmt = select(Player, Club, League).join(Club, Player.club_id == Club.id, isouter=True).join(League, Club.league_id == League.id, isouter=True)
        if division and division != "all":
            stmt = stmt.where(or_(Player.division == division, League.code == division))
        if position and position != "all":
            if position in ("CB", "FB", "MID", "ATT"):
                fam_map = {
                    "CB": ["CB", "GK"],
                    "FB": ["LB", "RB", "LWB", "RWB"],
                    "MID": ["DM", "CM", "AM"],
                    "ATT": ["RW", "LW", "ST"],
                }
                stmt = stmt.where(Player.position.in_(fam_map[position]))
            else:
                stmt = stmt.where(Player.position == position)
        if club_id:
            stmt = stmt.where(Player.club_id == club_id)
        if max_age:
            stmt = stmt.where(Player.age <= max_age)
        if q.strip():
            term = f"%{q.strip()}%"
            stmt = stmt.where(or_(Player.name.ilike(term), Player.name_ar.ilike(term), Club.name_ar.ilike(term)))

        rows = db.execute(stmt.order_by(desc(Player.market_value_eur)).limit(limit)).all()
        players = []
        for p, c, lg in rows:
            fam = position_family(p.position)
            prof = p.scouting_profile or {}
            avg_rating = round(sum(float(prof.get(k, 65)) for k in SCOUTING_METRIC_KEYS) / len(SCOUTING_METRIC_KEYS), 1)
            players.append(
                {
                    "id": p.id,
                    "name": p.name_ar or p.name,
                    "club_id": c.id if c else None,
                    "club_name": (c.name_ar or c.name) if c else "غير محدد",
                    "division": p.division or (lg.code if lg else "EGY1"),
                    "league_name": lg.name if lg else "",
                    "position": p.position,
                    "position_family": fam,
                    "jersey_number": p.jersey_number,
                    "age": p.age,
                    "height_cm": p.height_cm,
                    "preferred_foot": p.preferred_foot,
                    "market_value_eur": p.market_value_eur or 0,
                    "market_value_egp": p.market_value_egp or ((p.market_value_eur or 0) * 53),
                    "overall_rating": avg_rating,
                    "scouting_profile": prof,
                }
            )
        return {
            "total_returned": len(players),
            "position_templates": POSITION_RADAR_LABELS,
            "metric_keys": SCOUTING_METRIC_KEYS,
            "players": players,
        }


@app.get("/api/scouting/player/{player_id}")
def get_seeded_player_profile(player_id: int) -> dict:
    with SessionLocal() as db:
        p = db.get(Player, player_id)
        if not p:
            raise HTTPException(status_code=404, detail="اللاعب غير موجود في قاعدة البيانات")
        c = db.get(Club, p.club_id) if p.club_id else None
        fam = position_family(p.position)
        labels = POSITION_RADAR_LABELS[fam]
        prof = p.scouting_profile or {k: 70.0 for k in SCOUTING_METRIC_KEYS}
        radar_axes = [{"key": k, "label_ar": labels[k], "value": float(prof.get(k, 70.0))} for k in SCOUTING_METRIC_KEYS]
        return {
            "id": p.id,
            "name": p.name_ar or p.name,
            "club_name": (c.name_ar or c.name) if c else "غير محدد",
            "division": p.division,
            "position": p.position,
            "position_family": fam,
            "age": p.age,
            "jersey_number": p.jersey_number,
            "preferred_foot": p.preferred_foot,
            "market_value_eur": p.market_value_eur or 0,
            "market_value_egp": p.market_value_egp or 0,
            "radar_axes": radar_axes,
            "scouting_profile": prof,
        }


@app.get("/api/scouting/moneyball-alternatives/{player_id}")
def find_moneyball_alternatives(
    player_id: int,
    max_budget_eur: int | None = None,
    include_divisions: str = "EGY2,EGY_YOUTH",
    limit: int = 8,
) -> dict:
    """Moneyball Egypt Cosine Similarity engine finding cheaper EGY2 & Youth sector tactical clones."""
    with SessionLocal() as db:
        target = db.get(Player, player_id)
        if not target:
            raise HTTPException(status_code=404, detail="اللاعب الهدف غير موجود")
        target_club = db.get(Club, target.club_id) if target.club_id else None
        target_fam = position_family(target.position)
        target_prof = target.scouting_profile or {k: 72.0 for k in SCOUTING_METRIC_KEYS}
        target_vec = [float(target_prof.get(k, 70.0)) for k in SCOUTING_METRIC_KEYS]
        target_val = int(target.market_value_eur or 500000)

        divs = [d.strip() for d in include_divisions.split(",") if d.strip()]
        stmt = select(Player, Club).join(Club, Player.club_id == Club.id, isouter=True).where(Player.id != target.id)
        if divs:
            stmt = stmt.where(Player.division.in_(divs))
        if max_budget_eur is not None:
            stmt = stmt.where(Player.market_value_eur <= max_budget_eur)
        else:
            stmt = stmt.where(Player.market_value_eur <= max(250000, int(target_val * 0.65)))

        candidates = db.execute(stmt).all()
        scored = []
        for cand, c_club in candidates:
            if not cand.scouting_profile:
                continue
            cand_fam = position_family(cand.position)
            cand_vec = [float(cand.scouting_profile.get(k, 65.0)) for k in SCOUTING_METRIC_KEYS]
            sim = _cosine_similarity(target_vec, cand_vec)
            # Combine angular vector similarity with Euclidean profile tightness for sharp differentiation (>88%)
            l1_diff = float(np.mean(np.abs(np.asarray(target_vec) - np.asarray(cand_vec))))
            profile_closeness = max(0.0, 1.0 - l1_diff / 45.0)
            blended_sim = 0.68 * sim + 0.32 * profile_closeness
            # Prioritize same tactical position family cleanly
            if cand.position == target.position:
                blended_sim += 0.04
            elif cand_fam != target_fam:
                blended_sim -= 0.09
            sim_pct = round(min(99.2, max(45.0, blended_sim * 100.0)), 1)

            cand_eur = int(cand.market_value_eur or 80000)
            cand_egp = int(cand.market_value_egp or (cand_eur * 53))
            target_egp = int(target.market_value_egp or (target_val * 53))
            savings_pct = round(max(0.0, (1.0 - cand_eur / max(1, target_val)) * 100.0), 1)

            scored.append(
                {
                    "id": cand.id,
                    "name": cand.name_ar or cand.name,
                    "club_name": (c_club.name_ar or c_club.name) if c_club else "غير محدد",
                    "division": cand.division,
                    "position": cand.position,
                    "position_family": cand_fam,
                    "age": cand.age,
                    "preferred_foot": cand.preferred_foot,
                    "market_value_eur": cand_eur,
                    "market_value_egp": cand_egp,
                    "savings_pct": savings_pct,
                    "savings_egp": max(0, target_egp - cand_egp),
                    "similarity_pct": sim_pct,
                    "scouting_profile": cand.scouting_profile,
                }
            )

        scored.sort(key=lambda x: x["similarity_pct"], reverse=True)
        labels = POSITION_RADAR_LABELS[target_fam]
        return {
            "target": {
                "id": target.id,
                "name": target.name_ar or target.name,
                "club_name": (target_club.name_ar or target_club.name) if target_club else "",
                "division": target.division,
                "position": target.position,
                "position_family": target_fam,
                "age": target.age,
                "market_value_eur": target_val,
                "market_value_egp": int(target.market_value_egp or target_val * 53),
                "scouting_profile": target_prof,
            },
            "radar_labels": labels,
            "metric_keys": SCOUTING_METRIC_KEYS,
            "alternatives": scored[:limit],
        }


# ---------------- V4 Pro Coach Club Assignment, Season Sync & Squad Fit ----------------
COACHING_STYLE_WEIGHTS: dict[str, dict[str, float]] = {
    "high_press": {
        "pace_sprint": 1.35, "stamina_workrate": 1.45, "pressing_intensity": 1.65,
        "ball_recovery": 1.40, "aerial_duels": 0.90, "defensive_positioning": 1.15,
        "short_pass_accuracy": 1.05, "progressive_passes": 1.15, "xt_creation": 1.25,
        "progressive_carries": 1.20, "space_creation": 1.15, "ball_retention_tempo": 1.35,
        "tactical_discipline": 1.25, "tactical_fluidity": 1.10,
    },
    "possession": {
        "pace_sprint": 0.90, "stamina_workrate": 1.05, "pressing_intensity": 1.05,
        "ball_recovery": 1.00, "aerial_duels": 0.80, "defensive_positioning": 1.15,
        "short_pass_accuracy": 1.65, "progressive_passes": 1.55, "xt_creation": 1.40,
        "progressive_carries": 1.25, "space_creation": 1.45, "ball_retention_tempo": 1.55,
        "tactical_discipline": 1.25, "tactical_fluidity": 1.45,
    },
    "direct_counter": {
        "pace_sprint": 1.70, "stamina_workrate": 1.30, "pressing_intensity": 1.00,
        "ball_recovery": 1.30, "aerial_duels": 1.05, "defensive_positioning": 1.15,
        "short_pass_accuracy": 0.95, "progressive_passes": 1.40, "xt_creation": 1.45,
        "progressive_carries": 1.55, "space_creation": 1.30, "ball_retention_tempo": 1.20,
        "tactical_discipline": 1.25, "tactical_fluidity": 1.15,
    },
    "low_block": {
        "pace_sprint": 1.15, "stamina_workrate": 1.35, "pressing_intensity": 0.80,
        "ball_recovery": 1.50, "aerial_duels": 1.45, "defensive_positioning": 1.70,
        "short_pass_accuracy": 1.05, "progressive_passes": 1.10, "xt_creation": 1.00,
        "progressive_carries": 1.00, "space_creation": 0.95, "ball_retention_tempo": 1.05,
        "tactical_discipline": 1.65, "tactical_fluidity": 0.85,
    },
}


def _compute_player_fit(profile: dict | None, weights: dict[str, float]) -> tuple[float, float]:
    prof = profile or {}
    vals = [float(prof.get(k, 65.0)) for k in SCOUTING_METRIC_KEYS]
    w_vals = [float(weights.get(k, 1.0)) for k in SCOUTING_METRIC_KEYS]
    overall = sum(vals) / max(1, len(vals))
    w_sum = sum(w_vals)
    style_fit = sum(v * w for v, w in zip(vals, w_vals)) / max(1e-6, w_sum)
    return round(overall, 1), round(min(98.5, max(45.0, style_fit)), 1)


class MatchClubsUpdate(BaseModel):
    home_club_id: int | None = None
    away_club_id: int | None = None
    home_team_cluster: int | None = None


@app.put("/api/matches/{match_id}/clubs")
def update_match_clubs(match_id: int, body: MatchClubsUpdate) -> dict:
    with SessionLocal() as db:
        m = db.get(Match, match_id)
        if not m:
            raise HTTPException(status_code=404, detail="المباراة غير موجودة")
        if body.home_club_id is not None:
            hc = db.get(Club, body.home_club_id)
            if not hc:
                raise HTTPException(status_code=404, detail="النادي المضيف غير موجود")
            m.home_club_id = hc.id
            m.home_team_name = hc.name_ar or hc.name
        if body.away_club_id is not None:
            ac = db.get(Club, body.away_club_id)
            if not ac:
                raise HTTPException(status_code=404, detail="النادي الضيف غير موجود")
            m.away_club_id = ac.id
            m.away_team_name = ac.name_ar or ac.name
        if body.home_team_cluster in (0, 1):
            m.home_team_cluster = int(body.home_team_cluster)
        db.commit()

    # Re-analyze immediately using cached telemetry to re-bind player identities & passing network
    analyze_match(match_id)
    return get_match(match_id)


@app.post("/api/scouting/sync-season")
def sync_season_database() -> dict:
    res = seed_egyptian_database(force_update=True)
    return {"status": "synced", "season": "2025/2026", **res}


class CustomPlayerCreate(BaseModel):
    club_id: int
    name_ar: str
    name: str | None = None
    position: str = "CM"
    age: int = 23
    jersey_number: int = 18
    preferred_foot: str = "Right"
    market_value_eur: int = 350000
    scouting_profile: dict[str, float] | None = None


@app.post("/api/scouting/players")
def create_custom_player(body: CustomPlayerCreate) -> dict:
    pos = body.position.upper() if body.position.upper() in POSITION_ARCHETYPES else "CM"
    with SessionLocal() as db:
        club = db.get(Club, body.club_id)
        if not club:
            raise HTTPException(status_code=404, detail="النادي غير موجود")
        lg = db.get(League, club.league_id) if club.league_id else None
        base_arch = dict(POSITION_ARCHETYPES[pos])
        if body.scouting_profile:
            for k in SCOUTING_METRIC_KEYS:
                if k in body.scouting_profile:
                    base_arch[k] = round(max(40.0, min(96.0, float(body.scouting_profile[k]))), 1)
        ext_id = f"custom-{club.external_id or club.id}-{uuid.uuid4().hex[:8]}"
        pl = Player(
            club_id=club.id,
            external_id=ext_id,
            name=(body.name or body.name_ar).strip(),
            name_ar=body.name_ar.strip(),
            division=lg.code if lg else "EGY-1",
            jersey_number=int(body.jersey_number),
            position=pos,
            age=int(body.age),
            height_cm=178,
            preferred_foot=body.preferred_foot,
            market_value_eur=int(body.market_value_eur),
            market_value_egp=int(body.market_value_eur * 53),
            scouting_profile=base_arch,
        )
        db.add(pl)
        db.commit()
        db.refresh(pl)
        return {
            "status": "created",
            "player": {
                "id": pl.id,
                "name": pl.name_ar or pl.name,
                "club_id": pl.club_id,
                "club_name": club.name_ar or club.name,
                "division": pl.division,
                "position": pl.position,
                "jersey_number": pl.jersey_number,
                "age": pl.age,
                "market_value_eur": pl.market_value_eur,
                "market_value_egp": pl.market_value_egp,
                "scouting_profile": pl.scouting_profile,
            },
        }


@app.get("/api/clubs/{club_id}/squad-analysis")
def analyze_club_squad(club_id: int, style: str = "high_press") -> dict:
    style_key = style if style in COACHING_STYLE_WEIGHTS else "high_press"
    weights = COACHING_STYLE_WEIGHTS[style_key]

    with SessionLocal() as db:
        club = db.get(Club, club_id)
        if not club:
            raise HTTPException(status_code=404, detail="النادي غير موجود")
        lg = db.get(League, club.league_id) if club.league_id else None
        squad = list(
            db.scalars(
                select(Player)
                .where(Player.club_id == club_id)
                .order_by(Player.market_value_eur.desc().nullslast())
            ).all()
        )

        squad_rows: list[dict] = []
        for p in squad:
            ov, fit = _compute_player_fit(p.scouting_profile, weights)
            squad_rows.append(
                {
                    "id": p.id,
                    "name": p.name_ar or p.name,
                    "position": p.position,
                    "jersey_number": p.jersey_number,
                    "age": p.age,
                    "preferred_foot": p.preferred_foot,
                    "market_value_eur": p.market_value_eur or 250000,
                    "market_value_egp": p.market_value_egp or 13_250_000,
                    "overall_rating": ov,
                    "style_fit_pct": fit,
                    "scouting_profile": p.scouting_profile or {},
                }
            )

        # Build Starting XI across the 11 canonical tactical slots
        xi_priority = {
            0: ["GK"], 1: ["RB", "RWB", "CB"], 2: ["CB", "RB", "DM"], 3: ["CB", "LB", "DM"],
            4: ["LB", "LWB", "CB"], 5: ["DM", "CM", "CB"], 6: ["CM", "DM", "AM"],
            7: ["AM", "CM", "RW", "LW"], 8: ["RW", "AM", "ST", "LW"], 9: ["LW", "AM", "ST", "RW"], 10: ["ST", "LW", "RW"],
        }
        used_ids: set[int] = set()
        starting_xi: list[dict] = []
        for slot_idx, s_code, _jn, nx, ny, pos_ar in CANONICAL_SLOTS:
            cands = [r for r in squad_rows if r["id"] not in used_ids]
            picked = None
            for pos_c in xi_priority[slot_idx]:
                pos_cands = [r for r in cands if r["position"] == pos_c]
                if pos_cands:
                    picked = max(pos_cands, key=lambda x: (x["style_fit_pct"], x["overall_rating"]))
                    break
            if not picked and cands:
                picked = max(cands, key=lambda x: (x["style_fit_pct"], x["overall_rating"]))
            if picked:
                used_ids.add(picked["id"])
                starting_xi.append(
                    {
                        "slot_idx": slot_idx,
                        "slot_code": s_code,
                        "slot_label_ar": pos_ar,
                        "x_m": round(nx * 105.0, 1),
                        "y_m": round(ny * 68.0, 1),
                        **picked,
                    }
                )

        # Identify weakest 3 slots needing upgrade & fetch Moneyball market targets
        weakest = sorted(starting_xi, key=lambda x: x["style_fit_pct"])[:3]
        weak_positions = [w["slot_code"] for w in weakest]

        all_external = db.execute(
            select(Player, Club)
            .join(Club, Player.club_id == Club.id, isouter=True)
            .where(Player.club_id != club_id)
        ).all()

        transfer_targets: list[dict] = []
        seen_target_ids: set[int] = set()
        for w in weakest:
            slot_pos_target = "CB" if w["slot_code"] in ("RCB", "LCB") else ("CM" if w["slot_code"] == "RCM" else ("AM" if w["slot_code"] == "LCM" else w["slot_code"]))
            w_fit = float(w["style_fit_pct"])
            slot_cands: list[dict] = []
            for p_cand, c_cand in all_external:
                if p_cand.id in seen_target_ids:
                    continue
                if p_cand.position != slot_pos_target and position_family(p_cand.position) != position_family(slot_pos_target):
                    continue
                ov_c, fit_c = _compute_player_fit(p_cand.scouting_profile, weights)
                gain = round(fit_c - w_fit, 1)
                if gain <= 0.5:
                    continue
                val_eur = int(p_cand.market_value_eur or 300000)
                slot_cands.append(
                    {
                        "id": p_cand.id,
                        "name": p_cand.name_ar or p_cand.name,
                        "club_name": (c_cand.name_ar or c_cand.name) if c_cand else "",
                        "division": p_cand.division,
                        "position": p_cand.position,
                        "target_slot_ar": w["slot_label_ar"],
                        "replaces_player": w["name"],
                        "age": p_cand.age,
                        "market_value_eur": val_eur,
                        "market_value_egp": int(p_cand.market_value_egp or val_eur * 53),
                        "style_fit_pct": fit_c,
                        "fit_upgrade_pct": gain,
                    }
                )
            slot_cands.sort(key=lambda x: (x["fit_upgrade_pct"], x["style_fit_pct"]), reverse=True)
            for sc in slot_cands[:3]:
                seen_target_ids.add(sc["id"])
                transfer_targets.append(sc)

        avg_xi_fit = round(sum(x["style_fit_pct"] for x in starting_xi) / max(1, len(starting_xi)), 1)
        return {
            "club": {
                "id": club.id,
                "name": club.name_ar or club.name,
                "division": lg.code if lg else "EGY-1",
                "league_name": lg.name if lg else "",
            },
            "style": style_key,
            "avg_style_fit_pct": avg_xi_fit,
            "squad": squad_rows,
            "starting_xi": starting_xi,
            "weakest_positions": weak_positions,
            "weakest_slots": weakest,
            "transfer_targets": transfer_targets[:9],
        }


# ---------------- YouTube Match Search / Harvest ----------------
@app.get("/api/scraper/search")
def search_youtube_matches(q: str = "", max_results: int = 4) -> list[dict]:
    harvester = AutonomousMatchHarvester()
    queries = [q.strip()] if q.strip() else EGYPTIAN_SEARCH_QUERIES[:2]
    return harvester.search_recent(queries=queries, max_results=max_results)
