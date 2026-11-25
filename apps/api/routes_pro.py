"""Pro Waves 1-5 FastAPI routes (Scoresheet, DRM, Moments & Brief, Shortlist CRM, Bench/Subs, White-Label PDF/MP4)."""
from __future__ import annotations

import html as html_lib
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse

from apps.api.rbac import TenantContext, get_tenant_context
from packages.innovation_lab.kinematic_sandbox import optimize_set_piece_self_play
from packages.shared_contracts.lineup_connector import parse_scoresheet_text
from packages.shared_contracts.r2_storage import generate_signed_video_token

router = APIRouter()


@router.post("/api/lineups/parse-scoresheet")
def api_parse_scoresheet(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:qa")
    players = parse_scoresheet_text(str(payload.get("raw_text", "")))
    return {
        "count": len(players),
        "starters": [p.to_dict() for p in players if p.is_starter],
        "substitutes": [p.to_dict() for p in players if not p.is_starter],
    }


@router.post("/api/matches/{match_id}/apply-scoresheet")
def api_apply_scoresheet(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:qa")
    from apps.api.main import service

    return service.apply_scoresheet_to_match(ctx.tenant_id, match_id, str(payload.get("raw_text", "")))


@router.get("/api/matches/{match_id}/moments-and-brief")
def api_moments_and_brief(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    from apps.api.main import service

    return service.get_moments_and_brief(ctx.tenant_id, match_id)


@router.post("/api/matches/{match_id}/export-clip")
def api_export_clip(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> FileResponse:
    ctx.require("read:matches")
    from apps.api.main import service

    try:
        out_p = service.export_clip_mp4(
            tenant_id=ctx.tenant_id,
            match_id=match_id,
            start_s=float(payload.get("start_s", 50.0)),
            end_s=float(payload.get("end_s", 55.0)),
            auto_face_blur=bool(payload.get("auto_face_blur", False)),
        )
        return FileResponse(str(out_p), media_type="video/mp4", filename=out_p.name)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/scouting/shortlist")
def api_get_shortlist(ctx: TenantContext = Depends(get_tenant_context)) -> dict[str, Any]:
    ctx.require("read:scouting")
    from apps.api.main import service

    return {"items": service.get_shortlist(ctx.tenant_id)}


@router.post("/api/scouting/shortlist")
def api_upsert_shortlist(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:scouting")
    from apps.api.main import service

    try:
        items = service.upsert_shortlist_item(ctx.tenant_id, payload)
        return {"items": items}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/scouting/shortlist/{player_id}")
def api_delete_shortlist(
    player_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:scouting")
    from apps.api.main import service

    return {"items": service.delete_shortlist_item(ctx.tenant_id, player_id)}


@router.get("/api/matches/{match_id}/bench-state")
def api_get_bench_state(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    from apps.api.main import service

    return service.get_bench_state(ctx.tenant_id, match_id)


@router.post("/api/matches/{match_id}/bench-state")
def api_post_bench_state(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    from apps.api.main import service

    try:
        return service.apply_bench_action(ctx.tenant_id, match_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/matches/{match_id}/drm-token")
def api_drm_token(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    return generate_signed_video_token(f"matches/{match_id}/master.m3u8", club_id=ctx.tenant_id)


@router.post("/api/tactics/innovation/simulate")
def api_innovation_simulate(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    res = optimize_set_piece_self_play(
        scenario=str(payload.get("scenario", "right_corner_inswinger")),
        n_candidates=min(40, max(5, int(payload.get("n_candidates", 20)))),
        rollouts_per_candidate=min(1000, max(100, int(payload.get("rollouts_per_candidate", 300)))),
    )
    return res.to_dict()


@router.get("/api/matches/{match_id}/export-report", response_class=HTMLResponse)
def api_export_club_report(
    match_id: str,
    club_name: str = "EGY-SCOUT Club Dossier",
    audience: str = "admin",
    ctx: TenantContext = Depends(get_tenant_context),
) -> HTMLResponse:
    """Generate a printable Role-Aware White-Label HTML club dossier (audience='admin' vs 'player')."""
    ctx.require("read:reports")
    from apps.api.main import service

    is_player_view = (audience.lower().strip() == "player") or (ctx.role == "player")
    ba = service.get_before_after(match_id, frame_id=1250)
    sc = service.get_scouting_data(ctx.tenant_id, match_id=match_id)
    pos = service.get_positioning_analysis(match_id, frame_id=1250)
    mb = service.get_moments_and_brief(ctx.tenant_id, match_id)

    safe_club = html_lib.escape(club_name)
    safe_match = html_lib.escape(f"{ba['team_a_name']} vs {ba['team_b_name']} ({match_id})")
    aud_badge = "نسخة اللاعب المبسّطة (ملاحظات الإدارة والمخاطر الداخلية مخفية تلقائياً)" if is_player_view else "نسخة الإدارة والجهاز الفني الكاملة (Full Technical & Risk Dossier)"

    brief_html = "".join(
        f"<div class='card'><h4>{html_lib.escape(b['title_ar'])}</h4><p>{html_lib.escape(b['detail_ar'])}</p></div>"
        for b in mb.get("coach_brief", [])
    )
    def _opt_li(o: dict[str, Any]) -> str:
        risk_part = "" if is_player_view else f" <em>(المخاطرة الداخلية: {html_lib.escape(o['risk_ar'])})</em>"
        return f"<li><b>{html_lib.escape(o['title_ar'])}:</b> {html_lib.escape(o['action_ar'])}{risk_part}</li>"

    diag_html = "" if is_player_view else "".join(
        f"<div class='card'><h4>{html_lib.escape(d['title_ar'])}</h4><p>{html_lib.escape(d['evidence_ar'])}</p>"
        f"<ul>{''.join(_opt_li(o) for o in d['options'])}</ul></div>"
        for d in pos.get("diagnoses", [])
    )
    evt_rows = "".join(
        f"<tr><td dir='ltr'>{e['time_s']}s</td><td>{html_lib.escape(e['moment_phase'])}</td><td>{html_lib.escape(e['title_ar'])}</td><td dir='ltr'>{html_lib.escape(e['metric_proof'])}</td></tr>"
        for e in mb.get("events", [])[:12]
    )
    top_rows = "".join(
        f"<tr><td>{html_lib.escape(p['display_name'])}</td><td dir='ltr'>{p['observed_seconds']}s</td><td dir='ltr'>{p['in_frame_distance_m']} m</td><td dir='ltr'>{p['avg_speed_kmh']} km/h</td><td dir='ltr'>{p['max_speed_kmh']} km/h</td></tr>"
        for p in sc["video_tracks"][:10]
    )

    html = f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<title>{safe_club} — {safe_match}</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 28px; }}
  .wrap {{ max-width: 1020px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px; }}
  .hdr {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #10b981; padding-bottom: 16px; margin-bottom: 20px; }}
  .kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }}
  .kpi {{ background: #f1f5f9; border-radius: 10px; padding: 12px; }}
  .kpi .v {{ font-size: 20px; font-weight: 800; color: #047857; margin-top: 4px; }}
  .grid3 {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-bottom: 20px; }}
  .card {{ background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; }}
  .card h4 {{ margin: 0 0 6px; color: #0f172a; font-size: 14px; }}
  .card p, li {{ margin: 0; font-size: 12px; color: #334155; line-height: 1.55; }}
  table {{ width: 100%; border-collapse: collapse; margin: 12px 0 22px; }}
  th, td {{ border: 1px solid #cbd5e1; padding: 8px; text-align: start; font-size: 12px; }}
  th {{ background: #f1f5f9; }}
  .btn {{ background: #10b981; color: #06281e; border: 0; padding: 8px 16px; border-radius: 8px; font-weight: 700; cursor: pointer; }}
  .badge {{ background: #fef3c7; border: 1px solid #f59e0b; padding: 8px 12px; border-radius: 8px; font-size: 12px; color: #78350f; margin-bottom: 18px; }}
  @media print {{ .no-print {{ display: none; }} body {{ background: #fff; padding: 0; }} .wrap {{ border: 0; }} }}
</style>
</head><body><div class="wrap">
  <div class="hdr">
    <div>
      <div style="font-size:12px;color:#047857;font-weight:700">{safe_club} • {html_lib.escape(ctx.tenant_id.upper())}</div>
      <h1 style="margin:4px 0 0;font-size:22px">تقرير المباراة الموثّق — {safe_match}</h1>
    </div>
    <button class="btn no-print" onclick="window.print()">طباعة / حفظ PDF</button>
  </div>
  <div class="badge">🛡️ {html_lib.escape(aud_badge)} — قياسات فيديو بث تكتيكي مقاسة داخل الكادر فقط (In-Frame Metrics • عزل الحكام + تنعيم One-Euro).</div>
  <div class="kpis">
    <div class="kpi"><div>طاقم التحكيم المعزول</div><div class="v">{ba['after']['unique_official_tracks']}</div></div>
    <div class="kpi"><div>ثبات الدور بالمسار</div><div class="v">{ba['after']['track_role_stability_pct']}%</div></div>
    <div class="kpi"><div>سقف السرعة الفيزيائي</div><div class="v" dir="ltr">&le; {ba['max_speed_cap_kmh']} km/h</div></div>
    <div class="kpi"><div>أهداف موثّقة (لوحة النتيجة)</div><div class="v">{len(mb.get('verified_goals', []))}</div></div>
  </div>
  <h3>ملخص ما بين الشوطين الموثّق (Grounded Coach Brief)</h3>
  <div class="grid3">{brief_html}</div>
  <h3>التشخيص التكتيكي وبدائل الحلول (3 خيارات مع المخاطرة)</h3>
  <div class="grid3">{diag_html}</div>
  <h3>سجل اللحظات الأربع والأحداث المكتشفة (UEFA 4-Moment + Kalman Ball)</h3>
  <table><thead><tr><th>الزمن</th><th>المرحلة</th><th>الحدث</th><th>الدليل الفيزيائي</th></tr></thead><tbody>{evt_rows}</tbody></table>
  <h3>أطول 10 مسارات مقاسة داخل الكادر (بدون أسماء مخمّنة)</h3>
  <table><thead><tr><th>المسار</th><th>المدة</th><th>المسافة</th><th>متوسط السرعة</th><th>أقصى سرعة</th></tr></thead><tbody>{top_rows}</tbody></table>
</div></body></html>"""
    return HTMLResponse(html)


@router.get("/api/matches/{match_id}/benchmark")
def api_match_benchmark(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    from apps.api.main import service

    try:
        return service.get_match_benchmark(match_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/api/matches/ingest")
async def api_ingest_custom_match(
    file: UploadFile = File(...),
    team_a_name: str = Form(default="Team A"),
    team_b_name: str = Form(default="Team B"),
    match_format: str = Form(default="11v11"),
    official_roster_text: str = Form(default=""),
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("run:live_proof")
    import os
    import tempfile
    from pathlib import Path
    from apps.api.main import service

    allowed_exts = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
    fname = (file.filename or "custom_clip.mp4").strip()
    ext = Path(fname).suffix.lower() or ".mp4"
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video extension '{ext}'. Allowed: {', '.join(sorted(allowed_exts))}",
        )

    max_mb = max(1, int(os.environ.get("EGY_SCOUT_MAX_UPLOAD_MB", "1024") or "1024"))
    max_bytes = max_mb * 1024 * 1024
    tmp_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp_path = Path(tmp.name)
            total = 0
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Uploaded video exceeds {max_mb} MB limit",
                    )
                tmp.write(chunk)

        res = service.ingest_custom_match(
            video_file_path=tmp_path,
            filename=fname,
            team_a_name=team_a_name,
            team_b_name=team_b_name,
            match_format=match_format,
            tenant_id=ctx.tenant_id,
        )
        if official_roster_text.strip() and res.get("match_id"):
            try:
                res["roster_applied"] = service.apply_scoresheet_to_match(ctx.tenant_id, res["match_id"], official_roster_text)
            except Exception:
                pass
        return res
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


@router.get("/api/custom-matches/{match_id}/parquet")
def api_download_custom_match_parquet(match_id: str) -> FileResponse:
    from apps.api.main import service

    try:
        clean_id = service._validate_id(match_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    pq_path = service.data_paths.outputs / "custom_matches" / clean_id / "v8.parquet"
    if not pq_path.is_file():
        raise HTTPException(status_code=404, detail="Custom match Parquet not found")
    return FileResponse(
        str(pq_path),
        media_type="application/octet-stream",
        filename=f"{clean_id}_v8.parquet",
    )


@router.post("/api/matches/ingest-url")
def api_ingest_match_from_url(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Hybrid Ingestion Hub (Sec 9.5): import from YouTube / Drive / Broadcast URL via yt-dlp."""
    ctx.require("run:live_proof")
    from apps.api.main import service

    try:
        return service.ingest_match_from_url(
            url=str(payload.get("url", "")),
            team_a_name=str(payload.get("team_a_name", "Team A")),
            team_b_name=str(payload.get("team_b_name", "Team B")),
            match_format=str(payload.get("match_format", "11v11")),
            max_duration_s=int(payload.get("max_duration_s", 45)),
            tenant_id=ctx.tenant_id,
            official_roster_text=str(payload.get("official_roster_text", "")),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/matches/{match_id}/phase0-eval")
def api_phase0_eval(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Run real Phase-0 ground-truth benchmark evaluation against annotated Egyptian frames."""
    ctx.require("read:matches")
    from apps.api.main import service

    try:
        return service.get_phase0_evaluation(match_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/api/matches/{match_id}/opponent-dossier")
def api_opponent_dossier(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Grounded Pre-Match Opponent Dossier (Sec 11.3) strictly backed by telemetry & playbook."""
    ctx.require("read:tactics")
    from apps.api.main import service

    try:
        return service.get_opponent_dossier(ctx.tenant_id, match_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/api/scouting/players/{player_id}/dossier")
def api_player_dossier(
    player_id: str,
    match_id: str = "m2_ahly_enppi",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Full Evidence-First Player Dossier with /10 position breakdown & clip playlist."""
    ctx.require("read:scouting")
    from apps.api.main import service

    try:
        return service.get_player_dossier(ctx.tenant_id, player_id, match_id=match_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/api/matches/{match_id}/package-hls")
def api_package_hls(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Transcode match MP4 to GOP-aligned HLS (keyint=15) for instant-scrub streaming."""
    ctx.require("read:matches")
    from apps.api.main import service

    try:
        return service.package_match_hls(match_id)
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/hls/{match_id}/{filename}")
def api_serve_hls_file(match_id: str, filename: str) -> FileResponse:
    """Serve GOP-aligned HLS playlist (.m3u8) and MPEG-TS segments (.ts)."""
    from apps.api.main import service

    try:
        clean_mid = service._validate_id(match_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    fpath = service.data_paths.outputs / "hls" / clean_mid / filename
    if not fpath.is_file():
        raise HTTPException(status_code=404, detail="HLS asset not found")
    media = "application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else "video/MP2T"
    return FileResponse(str(fpath), media_type=media)


@router.post("/api/matches/{match_id}/auto-assign-qa")
def api_auto_assign_qa(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """1-click smart roster auto-assignment for the 2-Minute Identity QA Sheet."""
    ctx.require("write:qa")
    from apps.api.main import service

    try:
        return service.auto_assign_roster_to_qa(
            ctx.tenant_id,
            match_id,
            frame_id=int(payload.get("frame_id", 1250)),
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/matches/{match_id}/moment-state")
def api_moment_state(
    match_id: str,
    frame_id: int | None = None,
    time_s: float | None = None,
    selected_track_id: int | None = None,
    defending_team: str | None = None,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Moment State Analyzer (PDF Pages 25-26: Did / Did Not / Where & Why) + Live Formation Lines."""
    ctx.require("read:tactics")
    from apps.api.main import service

    try:
        return service.get_moment_state_analysis(
            tenant_id=ctx.tenant_id,
            match_id=match_id,
            frame_id=frame_id,
            time_s=time_s,
            selected_track_id=selected_track_id,
            defending_team=defending_team,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/api/matches/{match_id}/formation-blueprint")
def api_formation_blueprint(
    match_id: str,
    formation_code: str = "4-2-3-1",
    team: str = "team_a",
    tactical_mode: str = "balanced",
    opponent_formation_code: str = "4-4-2",
    opponent_tactical_mode: str = "balanced",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Interactive 22-player (Two-Team 11v11) Formation Blueprint Board populated with real match tracks/roster."""
    ctx.require("read:tactics")
    from apps.api.main import service

    try:
        return service.get_formation_blueprint(
            tenant_id=ctx.tenant_id,
            match_id=match_id,
            formation_code=formation_code,
            team=team,
            tactical_mode=tactical_mode,
            opponent_formation_code=opponent_formation_code,
            opponent_tactical_mode=opponent_tactical_mode,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/api/matches/{match_id}/ai-draw")
def api_ai_tactical_draw(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Use Groq Multi-Model AI (GPT-OSS 120B / Qwen 3.8 / ALLaM 2) to draw any custom or innovative 22-player tactical plan."""
    ctx.require("read:tactics")
    from apps.api.main import service

    try:
        return service.generate_ai_tactical_drawing(ctx.tenant_id, match_id, payload)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/chat/ask")
def api_tactical_chat_ask(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Grounded AI Tactical Chatbot endpoint (supports built-in NLU + Free Gemini / Groq API keys)."""
    ctx.require("read:tactics")
    from apps.api.main import service

    try:
        match_id = str(payload.get("match_id", "m2_ahly_enppi"))
        return service.answer_tactical_chat(ctx.tenant_id, match_id, payload)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

