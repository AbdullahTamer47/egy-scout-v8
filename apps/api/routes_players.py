"""FastAPI routes for EGY-SCOUT FIFA/Fantasy Player Cards, Photos, Verified Rosters, and AI Models."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile

from apps.api.rbac import ROLE_PERMISSIONS, TenantContext, get_tenant_context

router = APIRouter()

MAX_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _require_photo_write(ctx: TenantContext) -> None:
    perms = ROLE_PERMISSIONS.get(ctx.role, set())
    if ctx.is_read_only or not any(p in perms for p in ("write:scouting", "write:tactics", "write:qa")):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{ctx.role}' cannot modify player photos or match rosters.",
        )


@router.get("/api/rosters")
def api_list_verified_rosters(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:matches")
    from apps.api.main import service

    return service.list_verified_rosters()


@router.post("/api/matches/{match_id}/import-roster")
def api_import_match_roster(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    _require_photo_write(ctx)
    from apps.api.main import service

    try:
        return service.import_match_roster(ctx.tenant_id, match_id, payload)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/matches/{match_id}/players")
def api_list_players(
    match_id: str,
    min_observed_s: float = 0.5,
    include_all: bool = False,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    from apps.api.main import service

    try:
        return service.list_player_cards(
            ctx.tenant_id,
            match_id,
            min_observed_s=min_observed_s,
            consolidate=not include_all,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/api/matches/{match_id}/players/{track_id}/card")
def api_get_player_card(
    match_id: str,
    track_id: int,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    from apps.api.main import service

    try:
        return service.get_player_card(ctx.tenant_id, match_id, track_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/api/matches/{match_id}/players/{track_id}/photo")
def api_get_player_photo(
    match_id: str,
    track_id: int,
    ctx: TenantContext = Depends(get_tenant_context),
) -> Response:
    ctx.require("read:matches")
    from apps.api.main import service

    try:
        jpg, source = service.get_player_photo_jpeg(ctx.tenant_id, match_id, track_id)
        return Response(
            content=jpg,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "no-cache",
                "X-Photo-Source": source,
            },
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/api/matches/{match_id}/players/{track_id}/photo")
async def api_upload_player_photo(
    match_id: str,
    track_id: int,
    file: UploadFile = File(...),
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    _require_photo_write(ctx)
    from apps.api.main import service

    fname = (file.filename or "").strip()
    ext = Path(fname).suffix.lower() if fname else ""
    if ext and ext not in ALLOWED_PHOTO_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported photo extension. Allowed: .jpg, .jpeg, .png, .webp")

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_PHOTO_BYTES:
            raise HTTPException(status_code=413, detail="Photo exceeds 5 MB limit")
        chunks.append(chunk)
    raw = b"".join(chunks)

    try:
        service.save_player_photo(ctx.tenant_id, match_id, track_id, raw)
        card = service.get_player_card(ctx.tenant_id, match_id, track_id)
        return {"status": "uploaded", "photo_url": card["photo_url"], "photo_source": card["photo_source"], "card": card}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/matches/{match_id}/players/batch-photos")
async def api_batch_upload_player_photos(
    match_id: str,
    team: str = Form(default="team_a"),
    files: list[UploadFile] = File(...),
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    _require_photo_write(ctx)
    from apps.api.main import service

    items: list[tuple[str, bytes]] = []
    for f in files[:30]:
        fname = (f.filename or "").strip()
        ext = Path(fname).suffix.lower() if fname else ""
        if ext and ext not in ALLOWED_PHOTO_EXTS:
            continue
        chunks: list[bytes] = []
        total = 0
        too_big = False
        while True:
            chunk = await f.read(256 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_PHOTO_BYTES:
                too_big = True
                break
            chunks.append(chunk)
        if not too_big and chunks:
            items.append((fname, b"".join(chunks)))

    try:
        return service.save_batch_player_photos(ctx.tenant_id, match_id, team, items)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/matches/{match_id}/players/{track_id}/photo")
def api_delete_player_photo(
    match_id: str,
    track_id: int,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    _require_photo_write(ctx)
    from apps.api.main import service

    try:
        deleted = service.delete_player_photo(ctx.tenant_id, match_id, track_id)
        card = service.get_player_card(ctx.tenant_id, match_id, track_id)
        return {"deleted": deleted, "photo_url": card["photo_url"], "photo_source": card["photo_source"], "card": card}
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/api/matches/{match_id}/players/{track_id}/fetch-photo")
def api_fetch_verified_player_photo(
    match_id: str,
    track_id: int,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    _require_photo_write(ctx)
    from apps.api.main import service

    try:
        return service.fetch_verified_player_photo(ctx.tenant_id, match_id, track_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/matches/{match_id}/players/fetch-verified-photos")
def api_fetch_all_verified_photos(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    _require_photo_write(ctx)
    from apps.api.main import service

    try:
        return service.fetch_all_verified_photos(ctx.tenant_id, match_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/matches/{match_id}/players/{track_id}/identity-candidates")
def api_get_identity_candidates(
    match_id: str,
    track_id: int,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    from apps.api.main import service

    try:
        return service.get_identity_candidates(ctx.tenant_id, match_id, track_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/api/matches/{match_id}/players/{track_id}/identity")
def api_assign_track_identity(
    match_id: str,
    track_id: int,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    _require_photo_write(ctx)
    from apps.api.main import service

    team = str(payload.get("team") or "").strip()
    if team not in ("team_a", "team_b"):
        raise HTTPException(status_code=400, detail="team must be 'team_a' or 'team_b'")
    raw_j = payload.get("jersey_number")
    jersey_number: int | None
    if raw_j is None:
        jersey_number = None
    else:
        try:
            jersey_number = int(raw_j)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="jersey_number must be integer 1..99 or null")
        if jersey_number < 1 or jersey_number > 99:
            raise HTTPException(status_code=400, detail="jersey_number must be between 1 and 99")
    try:
        return service.assign_track_identity(ctx.tenant_id, match_id, track_id, team, jersey_number)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/plans/pass-probabilities")
def api_compute_pass_probabilities(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    from packages.tactics_engine.moment_analyzer import enrich_arrows_with_probabilities

    arrows = payload.get("arrows") or []
    team_nodes = payload.get("nodes_a") or payload.get("nodes") or []
    opp_nodes = payload.get("nodes_b") or payload.get("opponent_nodes") or []
    attack_right = bool(payload.get("attack_right", True))
    return {
        "arrows": enrich_arrows_with_probabilities(arrows, team_nodes, opp_nodes, attack_right=attack_right)
    }


@router.get("/api/chat/models")
def api_chat_models(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:tactics")
    from apps.api.main import service

    return service.get_groq_models()


@router.get("/api/compute/status")
def api_compute_status(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:matches")
    from apps.api.main import service

    return service.get_compute_status()


@router.post("/api/compute/config")
def api_configure_cloud_compute(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    _require_photo_write(ctx)
    from apps.api.main import service

    try:
        return service.configure_cloud_compute(ctx.tenant_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
