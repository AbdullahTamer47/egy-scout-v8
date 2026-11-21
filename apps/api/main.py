"""EGY-SCOUT V8 Multi-Tenant FastAPI Control Plane (Anti-Hallucination & Pro Broadcast Edition)."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse

from apps.api.rbac import TenantContext, get_tenant_context
from apps.api.routes_pro import router as pro_router
from apps.api.service import ScoutV8Service
from packages.scouting_core.fair_engine import import_external_scouting_csv
from packages.tactics_engine.matchup_optimizer import recommend_matchup_plan
from packages.tactics_engine.playbook import get_playbook_catalog

app = FastAPI(title="EGY-SCOUT V8 API", version="8.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

service = ScoutV8Service()
app.include_router(pro_router)


@app.get("/api/health")
def health(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    return {
        "status": "ok",
        "version": "8.2.0",
        "tenant_id": ctx.tenant_id,
        "role": ctx.role,
        "read_only": ctx.is_read_only,
    }


@app.get("/api/matches")
def list_matches(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:matches")
    return {"tenant_id": ctx.tenant_id, "matches": service.list_matches()}


@app.get("/api/matches/{match_id}/before-after")
def before_after(
    match_id: str,
    frame_id: int = 1250,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    try:
        return service.get_before_after(match_id, frame_id=frame_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/api/matches/{match_id}/frame/{frame_id}/image")
def frame_image(
    match_id: str,
    frame_id: int,
    highlight_track: Optional[int] = None,
) -> Response:
    try:
        jpg = service.render_frame_jpeg(match_id, frame_id, highlight_track=highlight_track)
        return Response(content=jpg, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=300"})
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/api/matches/{match_id}/track/{track_id}/crop")
def track_crop_image(
    match_id: str, track_id: int, frame_id: Optional[int] = None
) -> Response:
    """Return a real cropped player/official JPEG portrait extracted from the match video."""
    try:
        jpg = service.render_track_crop_jpeg(match_id, track_id, frame_id=frame_id)
        return Response(content=jpg, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=600"})
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/api/matches/{match_id}/video")
def stream_match_video(match_id: str, request: Request) -> Response:
    """Stream match MP4 with HTTP 206 Partial Content (Range Requests) for smooth scrubbing."""
    try:
        vpath = service.get_video_path(match_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    file_size = vpath.stat().st_size
    range_header = request.headers.get("range")
    chunk_size = 256 * 1024

    def _iter_file(start: int, end: int):
        with vpath.open("rb") as fh:
            fh.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                data = fh.read(min(chunk_size, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    if range_header:
        try:
            unit, rng = range_header.strip().split("=", 1)
            if unit.lower() != "bytes":
                raise ValueError("Unsupported range unit")
            start_s, end_s = rng.split("-", 1)
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else min(start + 1024 * 1024 - 1, file_size - 1)
            end = min(end, file_size - 1)
            if start < 0 or start > end or start >= file_size:
                raise HTTPException(status_code=416, detail="Requested Range Not Satisfiable")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=416, detail="Invalid Range header")

        return StreamingResponse(
            _iter_file(start, end),
            status_code=206,
            media_type="video/mp4",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(end - start + 1),
                "Cache-Control": "public, max-age=300",
            },
        )

    return StreamingResponse(
        _iter_file(0, file_size - 1),
        status_code=200,
        media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Cache-Control": "public, max-age=300",
        },
    )


@app.get("/api/matches/{match_id}/timeline")
def match_timeline(
    match_id: str, ctx: TenantContext = Depends(get_tenant_context)
) -> dict[str, Any]:
    ctx.require("read:matches")
    try:
        return service.get_match_timeline(match_id, tenant_id=ctx.tenant_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/api/matches/{match_id}/qa-sheet")
def get_qa_sheet(
    match_id: str, ctx: TenantContext = Depends(get_tenant_context)
) -> dict[str, Any]:
    ctx.require("read:matches")
    return service.get_qa_sheet(ctx.tenant_id, match_id)


@app.post("/api/matches/{match_id}/lineup")
def save_lineup(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:qa")
    return service.save_lineup_and_qa(ctx.tenant_id, match_id, payload)


@app.get("/api/matches/{match_id}/goal-forensics")
@app.get("/api/matches/{match_id}/positioning-analysis")
def positioning_analysis(
    match_id: str,
    frame_id: int = 1250,
    defending_team: str = "team_b",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    return service.get_positioning_analysis(match_id, frame_id=frame_id, defending_team=defending_team)


@app.get("/api/tactics/playbook")
def playbook_catalog(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:tactics")
    return {"playbook": get_playbook_catalog()}


@app.post("/api/tactics/what-if")
def what_if(
    payload: dict[str, Any], ctx: TenantContext = Depends(get_tenant_context)
) -> dict[str, Any]:
    ctx.require("write:tactics")
    return service.run_what_if(payload)


@app.get("/api/tactics/matchup")
def matchup_get(
    match_id: str = "m2_ahly_enppi",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Read-only matchup recommendation (accessible to Board, Coach, Analyst, Scout)."""
    ctx.require("read:tactics")
    scouting = service.get_scouting_data(ctx.tenant_id, match_id=match_id)
    return recommend_matchup_plan(
        scouting["benchmark_players"],
        ["zone_14_exposure", "broken_backline"],
    )


@app.post("/api/tactics/matchup")
def matchup_post(
    payload: dict[str, Any], ctx: TenantContext = Depends(get_tenant_context)
) -> dict[str, Any]:
    ctx.require("write:tactics")
    match_id = str(payload.get("match_id", "m2_ahly_enppi"))
    scouting = service.get_scouting_data(ctx.tenant_id, match_id=match_id)
    vulns = payload.get("opponent_vulnerabilities", ["zone_14_exposure", "broken_backline"])
    unavail = payload.get("unavailable_ids", [])
    return recommend_matchup_plan(scouting["benchmark_players"], vulns, unavail)


@app.get("/api/scouting/players")
def scouting_players(
    match_id: str = "m2_ahly_enppi",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:scouting")
    return service.get_scouting_data(ctx.tenant_id, match_id=match_id)


@app.post("/api/scouting/import-csv")
async def scouting_import_csv(
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:scouting")
    raw = await file.read()
    target = service._tenant_dir(ctx.tenant_id) / "external_scouting.csv"
    target.write_bytes(raw)
    imported = import_external_scouting_csv(target)
    return {"status": "imported", "count": len(imported), "players": [p.to_dict() for p in imported]}


@app.get("/api/match-setup/{match_id}")
def get_setup(match_id: str, ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:matches")
    return service.get_match_setup(ctx.tenant_id, match_id)


@app.post("/api/match-setup/{match_id}")
def save_setup(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    return service.save_match_setup(ctx.tenant_id, match_id, payload)


@app.post("/api/live-proof")
async def live_proof(
    file: Optional[UploadFile] = File(default=None),
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("run:live_proof")
    raw = await file.read() if file is not None else None
    fname = file.filename if (file is not None and file.filename) else "m2_ahly_enppi_sample.mp4"
    return service.run_live_proof(raw, filename=fname)


@app.get("/api/live-proof/{run_id}/parquet")
def download_live_proof_parquet(run_id: str) -> Response:
    try:
        clean_id = service._validate_id(run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    pq_path = service.data_paths.outputs / "live_proof" / f"{clean_id}_tracking.parquet"
    if not pq_path.is_file():
        raise HTTPException(status_code=404, detail="Parquet file not found")
    return FileResponse(
        str(pq_path),
        media_type="application/octet-stream",
        filename=f"{clean_id}_tracking.parquet",
    )
