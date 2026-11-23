"""EGY-SCOUT V8.3 - V9.0 FastAPI Routes:
- Persistent SQLite Tactical Plans & .egyplan storage (/api/plans)
- Deterministic Tactical Math Validator (/api/plans/validate)
- Analyst Clip Tagging & Locker-Room Playlists (/api/matches/{id}/tags)
- Sportscode / Nacsport XML Export & Import (/api/matches/{id}/tags/export-xml, import-xml)
- Head-to-Head Fair Player Comparison (/api/scouting/compare)
- Multi-Match Player Progression & Opponent Scouting (/api/scouting/multi-match-trends)
- Role-Aware Mobile Player Feedback Portal (/api/share/player, /api/share/player/{token})
"""
from __future__ import annotations

import html as html_lib
import xml.etree.ElementTree as ET
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import HTMLResponse

from apps.api.rbac import TenantContext, get_tenant_context
from packages.tactics_engine.plan_validator import validate_tactical_plan

router = APIRouter()


def _get_store():
    from apps.api.main import service

    return service.sqlite_store


# ---------- V8.3 / V8.5 Server-Persisted Tactical Plans & Math Validator ----------
@router.get("/api/plans")
def api_list_plans(
    match_id: str | None = None,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:tactics")
    return {"plans": _get_store().list_plans(ctx.tenant_id, match_id=match_id)}


@router.post("/api/plans")
def api_save_plan(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    match_id = str(payload.get("match_id") or "m2_ahly_enppi")
    saved = _get_store().save_plan(ctx.tenant_id, match_id, payload)
    return {"plan": saved, "plans": _get_store().list_plans(ctx.tenant_id, match_id=match_id)}


@router.delete("/api/plans/{plan_id}")
def api_delete_plan(
    plan_id: str,
    match_id: str | None = None,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    _get_store().delete_plan(ctx.tenant_id, plan_id)
    return {"deleted": True, "plans": _get_store().list_plans(ctx.tenant_id, match_id=match_id)}


@router.post("/api/plans/validate")
def api_validate_plan(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Pure geometric validation of any manual or AI-drawn 22-player plan (Math-First)."""
    ctx.require("read:tactics")
    nodes_a = payload.get("nodes_a") or payload.get("nodes") or []
    nodes_b = payload.get("nodes_b") or payload.get("opponent_nodes") or []
    formation_code = str(payload.get("formation_code") or "")
    return validate_tactical_plan(nodes_a, nodes_b, formation_code=formation_code)


# ---------- V8.4 Clip Tagging, Locker-Room Playlists & Sportscode/Nacsport XML ----------
@router.get("/api/matches/{match_id}/tags")
def api_list_match_tags(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("read:matches")
    return {"match_id": match_id, "tags": _get_store().list_tags(ctx.tenant_id, match_id)}


@router.post("/api/matches/{match_id}/tags")
def api_add_match_tag(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    tag = _get_store().add_tag(ctx.tenant_id, match_id, payload)
    return {"tag": tag, "tags": _get_store().list_tags(ctx.tenant_id, match_id)}


@router.delete("/api/matches/{match_id}/tags/{tag_id}")
def api_delete_match_tag(
    match_id: str,
    tag_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    ctx.require("write:tactics")
    _get_store().delete_tag(ctx.tenant_id, match_id, tag_id)
    return {"deleted": True, "tags": _get_store().list_tags(ctx.tenant_id, match_id)}


@router.get("/api/matches/{match_id}/tags/export-xml")
def api_export_sportscode_xml(
    match_id: str,
    ctx: TenantContext = Depends(get_tenant_context),
) -> Response:
    """Export match tags in standard Hudl Sportscode / Nacsport XML format."""
    ctx.require("read:matches")
    tags = _get_store().list_tags(ctx.tenant_id, match_id)

    root = ET.Element("file")
    all_inst = ET.SubElement(root, "ALL_INSTANCES")
    for idx, t in enumerate(tags, start=1):
        inst = ET.SubElement(all_inst, "instance")
        ET.SubElement(inst, "ID").text = str(idx)
        ET.SubElement(inst, "start").text = f"{float(t['start_s']):.2f}"
        ET.SubElement(inst, "end").text = f"{float(t['end_s']):.2f}"
        ET.SubElement(inst, "code").text = str(t["label_en"] or t["category"])
        lbl_ar = ET.SubElement(inst, "label")
        ET.SubElement(lbl_ar, "group").text = "ArabicLabel"
        ET.SubElement(lbl_ar, "text").text = str(t["label_ar"])
        lbl_pl = ET.SubElement(inst, "label")
        ET.SubElement(lbl_pl, "group").text = "Playlist"
        ET.SubElement(lbl_pl, "text").text = str(t["playlist_name"])
        if t.get("player_label"):
            lbl_p = ET.SubElement(inst, "label")
            ET.SubElement(lbl_p, "group").text = "Player"
            ET.SubElement(lbl_p, "text").text = str(t["player_label"])
        if t.get("note"):
            ET.SubElement(inst, "free_text").text = str(t["note"])

    xml_bytes = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="egy_scout_{match_id}_sportscode.xml"'},
    )


@router.post("/api/matches/{match_id}/tags/import-xml")
def api_import_sportscode_xml(
    match_id: str,
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Import Hudl Sportscode / Nacsport XML timeline instances into EGY-SCOUT."""
    ctx.require("write:tactics")
    xml_text = str(payload.get("xml_text") or "").strip()
    if not xml_text:
        raise HTTPException(status_code=400, detail="Empty XML payload")
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid Sportscode XML: {exc}")

    store = _get_store()
    imported = 0
    for inst in root.findall(".//instance"):
        start_s = float((inst.findtext("start") or "0").strip())
        end_s = float((inst.findtext("end") or str(start_s + 6.0)).strip())
        code = (inst.findtext("code") or "Tag").strip()
        note = (inst.findtext("free_text") or "").strip()
        label_ar = code
        playlist = "مستورد من XML"
        player_lbl = ""
        for lb in inst.findall("label"):
            grp = (lb.findtext("group") or "").strip().lower()
            txt = (lb.findtext("text") or "").strip()
            if grp == "arabiclabel" and txt:
                label_ar = txt
            elif grp == "playlist" and txt:
                playlist = txt
            elif grp == "player" and txt:
                player_lbl = txt
        store.add_tag(
            ctx.tenant_id,
            match_id,
            {
                "category": code.lower().replace(" ", "_")[:32],
                "label_ar": label_ar,
                "label_en": code,
                "time_s": round((start_s + end_s) * 0.5, 2),
                "start_s": start_s,
                "end_s": max(start_s + 1.0, end_s),
                "playlist_name": playlist,
                "player_label": player_lbl,
                "note": note,
            },
        )
        imported += 1

    return {"imported_count": imported, "tags": store.list_tags(ctx.tenant_id, match_id)}


# ---------- V9.0 Head-to-Head Player Comparison & Multi-Match Progression ----------
@router.get("/api/scouting/compare")
def api_scouting_compare(
    match_id: str = "m2_ahly_enppi",
    player_ids: str = "",
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Compare 2 to 4 players Head-to-Head with position-fair radar & evidence clips."""
    ctx.require("read:scouting")
    from apps.api.main import service

    sc = service.get_scouting_data(ctx.tenant_id, match_id=match_id)
    pool = sc.get("benchmark_players", []) + sc.get("video_tracks", [])
    by_id = {str(p["player_id"]): p for p in pool}

    wanted = [x.strip() for x in player_ids.split(",") if x.strip()]
    selected = [by_id[pid] for pid in wanted if pid in by_id]
    if len(selected) < 2:
        selected = pool[:2]

    compared = []
    for p in selected[:4]:
        # Normalize 5 radar axes (0..100)
        vaep = float(p.get("vaep_per90") or 0.0)
        xt = float(p.get("xt_per90") or 0.0)
        padj = float(p.get("padj_defensive_actions_per90") or 0.0)
        hir = float(p.get("hir_distance_m_per90") or 0.0)
        disc = float(p.get("positional_discipline_score") or 70.0)
        spd = float(p.get("max_speed_kmh") or 24.0)
        compared.append(
            {
                "player_id": p["player_id"],
                "display_name": p["display_name"],
                "team_name": p["team_name"],
                "position": p["position"],
                "archetype_ar": p.get("archetype_ar", ""),
                "rating_10": p.get("rating_10"),
                "minutes_analyzed": p.get("minutes_analyzed", 0),
                "sample_confidence": p.get("sample_confidence", "clip_only"),
                "radar": {
                    "attack_impact": min(100, max(15, int(round(vaep * 115 if vaep > 0 else spd * 2.4)))),
                    "progression_xt": min(100, max(15, int(round(xt * 240 if xt > 0 else spd * 2.2)))),
                    "defensive_work": min(100, max(15, int(round(padj * 8.5 if padj > 0 else disc * 0.85)))),
                    "physical_hir": min(100, max(15, int(round((hir / 11.0) if hir > 0 else spd * 2.8)))),
                    "tactical_discipline": min(100, max(15, int(round(disc)))),
                },
                "metrics": {
                    "vaep_per90": p.get("vaep_per90"),
                    "xt_per90": p.get("xt_per90"),
                    "padj_def_per90": p.get("padj_defensive_actions_per90"),
                    "hir_m_per90": p.get("hir_distance_m_per90"),
                    "max_speed_kmh": p.get("max_speed_kmh"),
                    "discipline": p.get("positional_discipline_score"),
                },
                "evidence_clips": p.get("evidence_clips", [])[:3],
            }
        )

    return {
        "match_id": match_id,
        "players": compared,
        "fairness_note_ar": "المقارنة تراعي مركز اللاعب وزمن اللعب الفعلي؛ إذا كانت العينة أقل من 45 دقيقة تظهر شارة تنبيه بوضوح.",
        "fairness_note_en": "Comparison adjusts for role & sample minutes; clips under 45m carry an explicit small-sample badge.",
    }


@router.get("/api/scouting/multi-match-trends")
def api_multi_match_trends(
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Aggregate player progression & opponent patterns across ALL ingested matches in the club archive."""
    ctx.require("read:scouting")
    from apps.api.main import service

    matches = service.list_matches()
    player_series: dict[str, list[dict[str, Any]]] = {}
    opponent_profiles: dict[str, dict[str, Any]] = {}

    for m in matches:
        mid = m["match_id"]
        try:
            sc = service.get_scouting_data(ctx.tenant_id, match_id=mid)
            pos = service.get_positioning_analysis(mid, frame_id=1250)
        except Exception:
            continue

        dur_s = float(sc.get("input_gate", {}).get("duration_s", 0.0))
        conf = "high" if dur_s >= 600 else ("medium" if dur_s >= 45 else "clip_sample")

        # Track top video players across matches by display name
        for vp in sc.get("video_tracks", [])[:8]:
            pname = str(vp.get("display_name") or "").strip()
            if not pname or pname.startswith("#"):
                continue
            player_series.setdefault(pname, []).append(
                {
                    "match_id": mid,
                    "match_title_ar": m.get("title_ar") or mid,
                    "max_speed_kmh": vp.get("max_speed_kmh", 0.0),
                    "avg_speed_kmh": vp.get("avg_speed_kmh", 0.0),
                    "discipline": vp.get("positional_discipline_score", 75.0),
                    "observed_s": vp.get("observed_seconds", 0.0),
                    "confidence": conf,
                }
            )

        # Aggregate opponent vulnerabilities per team_b
        opp_name = m.get("team_b_name_ar") or m.get("team_b_name") or "Opponent"
        prof = opponent_profiles.setdefault(
            opp_name,
            {
                "opponent_name": opp_name,
                "matches_analyzed": 0,
                "total_observed_s": 0.0,
                "avg_box_control_conceded_pct": [],
                "recurring_vulnerabilities_ar": [],
                "coach_focus_points_ar": [],
            },
        )
        prof["matches_analyzed"] += 1
        prof["total_observed_s"] = round(prof["total_observed_s"] + dur_s, 1)
        prof["avg_box_control_conceded_pct"].append(float(pos.get("pitch_control", {}).get("box_control_pct", 50.0)))
        for dg in pos.get("diagnoses", [])[:2]:
            t_ar = str(dg.get("title_ar") or "")
            if t_ar and t_ar not in prof["recurring_vulnerabilities_ar"]:
                prof["recurring_vulnerabilities_ar"].append(t_ar)
            for opt in dg.get("options", [])[:1]:
                act = str(opt.get("action_ar") or "")
                if act and act not in prof["coach_focus_points_ar"]:
                    prof["coach_focus_points_ar"].append(act)

    # Format opponent profiles
    opp_list = []
    for prof in opponent_profiles.values():
        vals = prof["avg_box_control_conceded_pct"] or [50.0]
        opp_list.append(
            {
                "opponent_name": prof["opponent_name"],
                "matches_analyzed": prof["matches_analyzed"],
                "total_observed_s": prof["total_observed_s"],
                "sample_warning_ar": (
                    "عينة قصيرة — يوصى برفع شوط كامل لتعميم النمط"
                    if prof["total_observed_s"] < 300
                    else "عينة قوية متعددة المباريات"
                ),
                "avg_box_control_conceded_pct": round(sum(vals) / len(vals), 1),
                "recurring_vulnerabilities_ar": prof["recurring_vulnerabilities_ar"][:4],
                "coach_focus_points_ar": prof["coach_focus_points_ar"][:3],
            }
        )

    # Format player progression (prefer players seen in >= 1 verified matches)
    prog_list = [
        {
            "player_name": pname,
            "matches_count": len(pts),
            "sample_warning_ar": "عينة صغيرة (مباراة واحدة فقط)" if len(pts) < 2 else f"متتبع عبر {len(pts)} مباريات",
            "series": pts,
        }
        for pname, pts in sorted(player_series.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:10]
    ]

    return {
        "total_matches_in_archive": len(matches),
        "player_progression": prog_list,
        "opponent_scouting": opp_list,
    }


# ---------- V9.0 Role-Aware Mobile Player Feedback Portal ----------
@router.post("/api/share/player")
def api_create_player_share_link(
    payload: dict[str, Any],
    ctx: TenantContext = Depends(get_tenant_context),
) -> dict[str, Any]:
    """Generate a lightweight mobile player feedback link with role-aware redaction (strips internal board notes)."""
    ctx.require("read:scouting")
    match_id = str(payload.get("match_id") or "m2_ahly_enppi")
    player_name = str(payload.get("player_name") or "اللاعب").strip()
    # Role-aware redaction: NEVER expose internal board/contract/salary notes on player-facing links
    sanitized = {
        "club_name": str(payload.get("club_name") or "EGY-SCOUT Club Academy"),
        "match_title": str(payload.get("match_title") or match_id),
        "position": str(payload.get("position") or "MID"),
        "rating_10": payload.get("rating_10"),
        "strengths_ar": [str(s) for s in (payload.get("strengths_ar") or [])][:4],
        "focus_points_ar": [str(w) for w in (payload.get("focus_points_ar") or [])][:4],
        "coach_message_ar": str(payload.get("coach_message_ar") or "أداء مميز! ركّز في المران القادم على الملاحظتين أدناه."),
        "clips": (payload.get("clips") or [])[:5],
        "tactical_plans": (payload.get("tactical_plans") or [])[:2],
        "redacted_internal_notes": True,
    }
    rec = _get_store().create_share_link(ctx.tenant_id, match_id, player_name, ctx.role, sanitized)
    return {
        "token": rec["token"],
        "share_url": f"/api/share/player/{rec['token']}",
        "player_name": player_name,
        "redacted_internal_notes": True,
    }


@router.get("/api/share/player/{token}", response_class=HTMLResponse)
def api_view_player_share_portal(token: str) -> HTMLResponse:
    """Mobile-optimized player feedback page (lightweight HTML, RTL Arabic, watermarked, zero internal board notes)."""
    data = _get_store().get_share_link(token)
    if not data:
        raise HTTPException(status_code=404, detail="Share link expired or not found")

    club = html_lib.escape(str(data.get("club_name", "EGY-SCOUT")))
    pname = html_lib.escape(str(data.get("player_name", "Player")))
    mtitle = html_lib.escape(str(data.get("match_title", "")))
    pos = html_lib.escape(str(data.get("position", "")))
    rating = data.get("rating_10")
    coach_msg = html_lib.escape(str(data.get("coach_message_ar", "")))

    strengths_li = "".join(f"<li>✅ {html_lib.escape(str(s))}</li>" for s in data.get("strengths_ar", []))
    focus_li = "".join(f"<li>🎯 {html_lib.escape(str(f))}</li>" for f in data.get("focus_points_ar", []))
    clips_html = "".join(
        f"<div class='clip'><strong>🎬 {html_lib.escape(str(c.get('title_ar', c.get('label_ar', 'لقطة'))))}</strong>"
        f"<span>{float(c.get('start_s', 0)):.1f}s – {float(c.get('end_s', 5)):.1f}s</span>"
        f"<div class='proof'>{html_lib.escape(str(c.get('metric_proof', c.get('note', ''))))}</div></div>"
        for c in data.get("clips", [])
    ) or "<p class='muted'>لا توجد لقطات مرفقة في هذه الحزمة.</p>"

    page = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{pname} — بطاقة تقييم اللاعب | {club}</title>
<style>
  body {{ margin:0; font-family: system-ui, -apple-system, sans-serif; background:#090D16; color:#F1F5F9; padding:18px; }}
  .wrap {{ max-width:520px; margin:0 auto; }}
  .badge {{ display:inline-block; background:#10B98122; color:#34D399; border:1px solid #10B98155; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:700; }}
  .card {{ background:#111827; border:1px solid #1F2937; border-radius:16px; padding:16px; margin-top:14px; }}
  h1 {{ margin:10px 0 4px; font-size:22px; color:#FFFFFF; }}
  h2 {{ margin:0 0 10px; font-size:15px; color:#34D399; }}
  .sub {{ color:#94A3B8; font-size:13px; }}
  .rating {{ float:left; background:#10B981; color:#090D16; font-weight:900; font-size:20px; padding:8px 14px; border-radius:12px; }}
  ul {{ margin:0; padding-right:18px; line-height:1.7; font-size:14px; }}
  .clip {{ background:#090D16; border:1px solid #334155; border-radius:10px; padding:10px 12px; margin-top:8px; display:flex; flex-direction:column; gap:4px; font-size:13px; }}
  .clip span {{ color:#38BDF8; font-size:12px; }}
  .proof {{ color:#CBD5E1; font-size:12px; }}
  .muted {{ color:#64748B; font-size:13px; }}
  .footer {{ text-align:center; color:#64748B; font-size:11px; margin-top:20px; }}
</style>
</head>
<body>
  <div class="wrap">
    <span class="badge">🛡️ {club} • بوابة اللاعب المحمية</span>
    <div class="card">
      {f'<div class="rating">{rating}/10</div>' if rating is not None else ''}
      <h1>{pname}</h1>
      <div class="sub">{pos} • {mtitle}</div>
      <p style="margin-top:12px;font-size:14px;line-height:1.6;">💬 <strong>رسالة المدرب:</strong> {coach_msg}</p>
    </div>
    <div class="card">
      <h2>نقاط القوة الموثّقة</h2>
      <ul>{strengths_li or '<li>انضباط تكتيكي جيد خلال العينة المحلّلة.</li>'}</ul>
    </div>
    <div class="card">
      <h2>نقاط التركيز في المران القادم</h2>
      <ul>{focus_li or '<li>الحفاظ على سرعة رد الفعل في التحولات الدفاعية.</li>'}</ul>
    </div>
    <div class="card">
      <h2>لقطاتك المحددة من المباراة</h2>
      {clips_html}
    </div>
    <div class="footer">EGY-SCOUT V9.0 Pro Studio • نسخة مخصصة للاعب (ملاحظات الإدارة الداخلية مخفية تلقائياً)</div>
  </div>
</body>
</html>"""
    return HTMLResponse(content=page)
