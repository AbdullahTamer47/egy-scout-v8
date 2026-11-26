"""Technical Director & Team Admin Engine + SQLite Persistence for EGY-SCOUT Coach Pro."""
from __future__ import annotations

import contextlib
import html as html_lib
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from packages.tactics_engine.moment_analyzer import (
    _assign_roster_by_position,
    parse_any_formation_spec,
)

ELIGIBILITY_BLOCKED_STATUSES = {"injured", "suspended", "rehab"}


class CoachProStore:
    """Thread-safe SQLite store for Coach profiles, synced club rosters, availability, training & matchday sheets."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextlib.contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS coach_profiles (
                    tenant_id TEXT PRIMARY KEY,
                    coach_name TEXT NOT NULL,
                    coach_role TEXT NOT NULL DEFAULT 'head_coach',
                    club_id TEXT NOT NULL DEFAULT 'al_ahly',
                    opponent_id TEXT NOT NULL DEFAULT 'zamalek',
                    formation TEXT NOT NULL DEFAULT '4-2-3-1',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS club_rosters (
                    tenant_id TEXT NOT NULL,
                    club_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, club_id)
                );

                CREATE TABLE IF NOT EXISTS player_admin_status (
                    tenant_id TEXT NOT NULL,
                    club_id TEXT NOT NULL,
                    jersey_number INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'fit',
                    readiness_pct INTEGER NOT NULL DEFAULT 100,
                    yellow_cards INTEGER NOT NULL DEFAULT 0,
                    red_cards INTEGER NOT NULL DEFAULT 0,
                    return_date TEXT DEFAULT '',
                    minutes_season INTEGER DEFAULT 0,
                    contract_until TEXT DEFAULT '',
                    admin_note TEXT DEFAULT '',
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, club_id, jersey_number)
                );

                CREATE TABLE IF NOT EXISTS training_sessions (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    club_id TEXT NOT NULL,
                    md_code TEXT NOT NULL,
                    title TEXT NOT NULL,
                    session_date TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_train_tenant_club ON training_sessions(tenant_id, club_id);

                CREATE TABLE IF NOT EXISTS matchday_sheets (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    club_id TEXT NOT NULL,
                    opponent_name TEXT NOT NULL,
                    match_date TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_matchday_tenant_club ON matchday_sheets(tenant_id, club_id);
                """
            )

    def get_coach_profile(self, tenant_id: str) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM coach_profiles WHERE tenant_id = ?",
                (tenant_id,),
            ).fetchone()
        return dict(row) if row else None

    def save_coach_profile(
        self,
        tenant_id: str,
        coach_name: str,
        coach_role: str = "head_coach",
        club_id: str = "al_ahly",
        opponent_id: str = "zamalek",
        formation: str = "4-2-3-1",
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        clean_name = (coach_name or "").strip()[:80]
        if not clean_name:
            raise ValueError("coach_name cannot be empty")
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO coach_profiles (tenant_id, coach_name, coach_role, club_id, opponent_id, formation, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id) DO UPDATE SET
                    coach_name = excluded.coach_name,
                    coach_role = excluded.coach_role,
                    club_id = excluded.club_id,
                    opponent_id = excluded.opponent_id,
                    formation = excluded.formation,
                    updated_at = excluded.updated_at
                """,
                (tenant_id, clean_name, coach_role, club_id, opponent_id, formation, now),
            )
        return self.get_coach_profile(tenant_id) or {}

    def save_club_roster(self, tenant_id: str, club_id: str, club_payload: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO club_rosters (tenant_id, club_id, payload_json, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(tenant_id, club_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (tenant_id, club_id, json.dumps(club_payload, ensure_ascii=False), now),
            )

    def list_club_rosters(self, tenant_id: str) -> dict[str, dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT club_id, payload_json FROM club_rosters WHERE tenant_id = ?",
                (tenant_id,),
            ).fetchall()
        return {str(r["club_id"]): json.loads(r["payload_json"]) for r in rows}

    def get_admin_statuses(self, tenant_id: str, club_id: str) -> dict[int, dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM player_admin_status WHERE tenant_id = ? AND club_id = ?",
                (tenant_id, club_id),
            ).fetchall()
        return {int(r["jersey_number"]): dict(r) for r in rows}

    def upsert_admin_status(
        self,
        tenant_id: str,
        club_id: str,
        jersey_number: int,
        status: str = "fit",
        readiness_pct: int = 100,
        yellow_cards: int = 0,
        red_cards: int = 0,
        return_date: str = "",
        minutes_season: int = 0,
        contract_until: str = "",
        admin_note: str = "",
    ) -> dict[str, Any]:
        clean_status = status if status in ("fit", "rehab", "injured", "suspended", "load_managed") else "fit"
        clean_ready = max(0, min(100, int(readiness_pct)))
        clean_yc = max(0, min(15, int(yellow_cards)))
        clean_rc = max(0, min(5, int(red_cards)))
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO player_admin_status (
                    tenant_id, club_id, jersey_number, status, readiness_pct,
                    yellow_cards, red_cards, return_date, minutes_season, contract_until, admin_note, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, club_id, jersey_number) DO UPDATE SET
                    status = excluded.status,
                    readiness_pct = excluded.readiness_pct,
                    yellow_cards = excluded.yellow_cards,
                    red_cards = excluded.red_cards,
                    return_date = excluded.return_date,
                    minutes_season = excluded.minutes_season,
                    contract_until = excluded.contract_until,
                    admin_note = excluded.admin_note,
                    updated_at = excluded.updated_at
                """,
                (
                    tenant_id,
                    club_id,
                    int(jersey_number),
                    clean_status,
                    clean_ready,
                    clean_yc,
                    clean_rc,
                    str(return_date or "")[:40],
                    max(0, int(minutes_season or 0)),
                    str(contract_until or "")[:24],
                    str(admin_note or "")[:200],
                    now,
                ),
            )
        return self.get_admin_statuses(tenant_id, club_id).get(int(jersey_number), {})

    def save_training_session(self, tenant_id: str, club_id: str, session_payload: dict[str, Any]) -> dict[str, Any]:
        sid = str(session_payload.get("session_id") or f"sess_{uuid.uuid4().hex[:10]}")
        session_payload = {**session_payload, "session_id": sid, "club_id": club_id}
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO training_sessions (id, tenant_id, club_id, md_code, title, session_date, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    md_code = excluded.md_code,
                    title = excluded.title,
                    session_date = excluded.session_date,
                    payload_json = excluded.payload_json
                """,
                (
                    sid,
                    tenant_id,
                    club_id,
                    str(session_payload.get("md_code") or "MD-3"),
                    str(session_payload.get("title_ar") or session_payload.get("title_en") or "Training Session"),
                    str(session_payload.get("session_date") or now[:10]),
                    json.dumps(session_payload, ensure_ascii=False),
                    now,
                ),
            )
        return session_payload

    def list_training_sessions(self, tenant_id: str, club_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, payload_json, created_at FROM training_sessions WHERE tenant_id = ? AND club_id = ? ORDER BY created_at DESC LIMIT 25",
                (tenant_id, club_id),
            ).fetchall()
        out = []
        for r in rows:
            item = json.loads(r["payload_json"])
            item["session_id"] = r["id"]
            out.append(item)
        return out

    def get_training_session(self, tenant_id: str, session_id: str) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM training_sessions WHERE tenant_id = ? AND id = ?",
                (tenant_id, session_id),
            ).fetchone()
        return json.loads(row["payload_json"]) if row else None

    def delete_training_session(self, tenant_id: str, session_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM training_sessions WHERE tenant_id = ? AND id = ?",
                (tenant_id, session_id),
            )

    def save_matchday_sheet(self, tenant_id: str, club_id: str, sheet_payload: dict[str, Any]) -> dict[str, Any]:
        mid = str(sheet_payload.get("sheet_id") or f"mds_{uuid.uuid4().hex[:10]}")
        sheet_payload = {**sheet_payload, "sheet_id": mid}
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO matchday_sheets (id, tenant_id, club_id, opponent_name, match_date, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json
                """,
                (
                    mid,
                    tenant_id,
                    club_id,
                    str(sheet_payload.get("opponent_name") or ""),
                    str(sheet_payload.get("match_date") or now[:10]),
                    json.dumps(sheet_payload, ensure_ascii=False),
                    now,
                ),
            )
        return sheet_payload

    def get_latest_matchday_sheet(self, tenant_id: str, club_id: str) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM matchday_sheets WHERE tenant_id = ? AND club_id = ? ORDER BY created_at DESC LIMIT 1",
                (tenant_id, club_id),
            ).fetchone()
        return json.loads(row["payload_json"]) if row else None


def evaluate_squad_availability(
    players: list[dict[str, Any]],
    admin_map: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge administrative medical & discipline status into every club player deterministically."""
    enriched: list[dict[str, Any]] = []
    for p in players:
        num = int(p.get("jersey_number") or 0)
        st = admin_map.get(num, {})
        raw_status = str(st.get("status") or "fit")
        readiness = int(st.get("readiness_pct") if st.get("readiness_pct") is not None else 100)
        yc = int(st.get("yellow_cards") if st.get("yellow_cards") is not None else ((p.get("live_stats") or {}).get("yellow_cards") or 0))
        rc = int(st.get("red_cards") or 0)
        return_date = str(st.get("return_date") or "")

        eligible = True
        block_reason_ar = ""
        block_reason_en = ""
        warning_ar = ""

        if yc >= 3:
            eligible = False
            block_reason_ar = f"إيقاف تلقائي (تراكم {yc} إنذارات)"
            block_reason_en = f"Auto-suspended ({yc} yellow cards)"
            raw_status = "suspended"
        elif rc >= 1:
            eligible = False
            block_reason_ar = "إيقاف (بطاقة حمراء)"
            block_reason_en = "Suspended (red card)"
            raw_status = "suspended"
        elif raw_status in ELIGIBILITY_BLOCKED_STATUSES:
            eligible = False
            if raw_status == "injured":
                block_reason_ar = f"إصابة{f' (عودة {return_date})' if return_date else ''}"
                block_reason_en = f"Injured{f' (ETA {return_date})' if return_date else ''}"
            elif raw_status == "rehab":
                block_reason_ar = f"تأهيل فردي{f' ({return_date})' if return_date else ''}"
                block_reason_en = "Individual rehab"
            else:
                block_reason_ar = "موقوف إدارياً"
                block_reason_en = "Suspended"
        elif yc == 2:
            warning_ar = "مهدد بالإيقاف (إنذاران)"

        if raw_status == "load_managed" and eligible:
            warning_ar = warning_ar or "إدارة أحمال بدنية (دقائق مقننة)"

        enriched.append(
            {
                **p,
                "status": raw_status,
                "readiness_pct": readiness,
                "yellow_cards": yc,
                "red_cards": rc,
                "return_date": return_date,
                "minutes_season": int(st.get("minutes_season") or 0),
                "contract_until": str(st.get("contract_until") or ""),
                "admin_note": str(st.get("admin_note") or ""),
                "is_eligible_starter": eligible,
                "block_reason_ar": block_reason_ar,
                "block_reason_en": block_reason_en,
                "warning_ar": warning_ar,
            }
        )
    return enriched


def build_squad_depth_report(
    evaluated_players: list[dict[str, Any]],
    formation_code: str = "4-2-3-1",
) -> dict[str, Any]:
    """Map eligible & unavailable club players onto the target formation's 11 slots and emit shortage alerts."""
    spec = parse_any_formation_spec(formation_code)
    raw_nodes = [
        {"slot": str(n.get("slot") or "CM"), "role_ar": str(n.get("role_ar") or ""), "x_norm": float(n.get("x_norm") or 0.5), "y_norm": float(n.get("y_norm") or 0.5)}
        for n in spec.get("nodes", [])
    ]
    fit_players = [p for p in evaluated_players if p.get("is_eligible_starter", True)]
    unavail = [p for p in evaluated_players if not p.get("is_eligible_starter", True)]

    assigned_list = _assign_roster_by_position([n["slot"] for n in raw_nodes], fit_players) if fit_players else [None] * len(raw_nodes)
    starter_assignments = {raw_nodes[i]["slot"]: assigned_list[i] for i in range(len(raw_nodes))}
    used_jerseys: set[int] = set()
    slots_out: list[dict[str, Any]] = []
    shortage_alerts: list[str] = []

    def _group(pos: str) -> str:
        u = pos.upper()
        if "GK" in u:
            return "GK"
        if any(t in u for t in ("CB", "RB", "LB", "WB", "FB")):
            return "DEF"
        if any(t in u for t in ("ST", "CF", "RW", "LW", "W")):
            return "ATT"
        return "MID"

    for n in raw_nodes:
        sl = n["slot"]
        starter = starter_assignments.get(sl)
        if starter and starter.get("jersey_number"):
            used_jerseys.add(int(starter["jersey_number"]))

    remaining_fit = [p for p in fit_players if int(p.get("jersey_number") or 0) not in used_jerseys]

    for n in raw_nodes:
        sl = n["slot"]
        starter = starter_assignments.get(sl)
        sl_grp = _group(sl)
        backups = [p for p in remaining_fit if _group(str(p.get("position") or "")) == sl_grp][:2]
        slots_out.append(
            {
                "slot": sl,
                "role_ar": n["role_ar"],
                "x_norm": n["x_norm"],
                "y_norm": n["y_norm"],
                "starter": starter,
                "backups": backups,
            }
        )
        if not starter:
            shortage_alerts.append(f"نقص حاد في مركز {sl} ({n['role_ar']}): لا يوجد لاعب متاح طبياً!")

    gk_fit = sum(1 for p in fit_players if "GK" in str(p.get("position", "")).upper())
    def_fit = sum(1 for p in fit_players if _group(str(p.get("position", ""))) == "DEF")
    att_fit = sum(1 for p in fit_players if _group(str(p.get("position", ""))) == "ATT")
    if gk_fit < 2:
        shortage_alerts.append(f"تنبيه المدير الفني: عدد الحراس الجاهزين ({gk_fit}) أقل من الحد الآمن (2).")
    if def_fit < 4:
        shortage_alerts.append(f"تنبيه خط الدفاع: عدد المدافعين الجاهزين ({def_fit}) محدود لتغطية 90 دقيقة.")
    if att_fit < 3:
        shortage_alerts.append(f"تنبيه الخط الأمامي: خيارات الهجوم المتاحة ({att_fit}) تتطلب دعم الشباب/البدلاء.")

    return {
        "formation_code": spec["code"],
        "fit_count": len(fit_players),
        "unavailable_count": len(unavail),
        "total_count": len(evaluated_players),
        "slots": slots_out,
        "unavailable_players": unavail,
        "shortage_alerts_ar": shortage_alerts,
    }


def build_official_matchday_sheet(
    club_name_ar: str,
    opponent_name_ar: str,
    evaluated_players: list[dict[str, Any]],
    formation_code: str = "4-2-3-1",
    match_date: Optional[str] = None,
    stadium: str = "",
) -> dict[str, Any]:
    """Assemble an official 20-man Matchday Sheet (11 Fit Starters + up to 9 Subs + Excluded List + Admin Timeline)."""
    depth = build_squad_depth_report(evaluated_players, formation_code=formation_code)
    fit_players = [p for p in evaluated_players if p.get("is_eligible_starter", True)]
    starters: list[dict[str, Any]] = []
    starter_nums: set[int] = set()

    for s in depth["slots"]:
        st = s.get("starter")
        if st:
            num = int(st.get("jersey_number") or 0)
            starter_nums.add(num)
            starters.append({**st, "assigned_slot": s["slot"], "assigned_role_ar": s["role_ar"]})

    subs = [p for p in fit_players if int(p.get("jersey_number") or 0) not in starter_nums][:9]
    excluded = [p for p in evaluated_players if not p.get("is_eligible_starter", True)]
    captain = next((p for p in starters if p.get("is_captain")), starters[0] if starters else None)

    return {
        "club_name_ar": club_name_ar,
        "opponent_name_ar": opponent_name_ar,
        "formation_code": depth["formation_code"],
        "match_date": match_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "stadium": stadium or "الملعب الرسمي المعتمد",
        "captain_name": (captain.get("name_ar") or captain.get("name_en")) if captain else "-",
        "captain_jersey": captain.get("jersey_number") if captain else None,
        "starters": starters,
        "substitutes": subs,
        "excluded": excluded,
        "admin_timeline": [
            {"offset": "-180m", "task_ar": "وجبة ما قبل المباراة والترطيب المعتمد"},
            {"offset": "-135m", "task_ar": "المحاضرة الفنية النهائية وتوزيع أدوار الكرات الثابتة"},
            {"offset": "-90m", "task_ar": "الوصول إلى الاستاد واعتماد كشف الـ 20 لاعباً لدى مراقب المباراة"},
            {"offset": "-45m", "task_ar": "الإحماء الرسمي في أرض الملعب وتفعيل الحراس"},
            {"offset": "0m", "task_ar": "ضربة البداية وتطبيق التنظيم الدفاعي المبكر"},
        ],
    }


def render_matchday_sheet_html(sheet: dict[str, Any]) -> str:
    """Render printable RTL HTML Matchday Sheet ready for browser Print-to-PDF."""
    esc = html_lib.escape
    starters_rows = "".join(
        f"<tr><td>#{p.get('jersey_number','')}</td><td><b>{esc(str(p.get('name_ar') or p.get('name_en') or ''))}</b></td>"
        f"<td>{esc(str(p.get('assigned_slot') or p.get('position') or ''))}</td>"
        f"<td>{int(p.get('readiness_pct',100))}%</td><td>{'⭐ قائد' if p.get('is_captain') else esc(str(p.get('warning_ar') or 'جاهز'))}</td></tr>"
        for p in sheet.get("starters", [])
    )
    subs_rows = "".join(
        f"<tr><td>#{p.get('jersey_number','')}</td><td>{esc(str(p.get('name_ar') or p.get('name_en') or ''))}</td>"
        f"<td>{esc(str(p.get('position') or ''))}</td><td>{int(p.get('readiness_pct',100))}%</td></tr>"
        for p in sheet.get("substitutes", [])
    )
    excl_rows = "".join(
        f"<tr><td>#{p.get('jersey_number','')}</td><td>{esc(str(p.get('name_ar') or p.get('name_en') or ''))}</td>"
        f"<td>{esc(str(p.get('block_reason_ar') or p.get('status') or ''))}</td></tr>"
        for p in sheet.get("excluded", [])
    ) or "<tr><td colspan='3'>لا يوجد مستبعدون للإصابة أو الإيقاف</td></tr>"

    return f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<title>كشف المباراة الرسمي - {esc(str(sheet.get('club_name_ar','')))}</title>
<style>body{{font-family:Tahoma,Arial,sans-serif;background:#fff;color:#0f172a;padding:24px;}}
h1,h2{{margin:0 0 8px;}} table{{width:100%;border-collapse:collapse;margin:12px 0 20px;font-size:13px;}}
th,td{{border:1px solid #cbd5e1;padding:7px 10px;text-align:right;}} th{{background:#064e3b;color:#fff;}}
.meta{{background:#f1f5f9;padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px;}}</style></head><body>
<h1>كشف المباراة الرسمي — EGY-SCOUT Coach Pro</h1>
<div class="meta"><b>النادي:</b> {esc(str(sheet.get('club_name_ar','')))} &nbsp;|&nbsp; <b>المنافس:</b> {esc(str(sheet.get('opponent_name_ar','')))}
&nbsp;|&nbsp; <b>التشكيل:</b> {esc(str(sheet.get('formation_code','')))} &nbsp;|&nbsp; <b>التاريخ:</b> {esc(str(sheet.get('match_date','')))}
&nbsp;|&nbsp; <b>القائد:</b> {esc(str(sheet.get('captain_name','-')))}</div>
<h2>التشكيل الأساسي (11 لاعباً متاحاً)</h2>
<table><thead><tr><th>الرقم</th><th>الاسم</th><th>المركز</th><th>الجاهزية</th><th>ملاحظات</th></tr></thead><tbody>{starters_rows}</tbody></table>
<h2>قائمة البدلاء ({len(sheet.get('substitutes',[]))})</h2>
<table><thead><tr><th>الرقم</th><th>الاسم</th><th>المركز</th><th>الجاهزية</th></tr></thead><tbody>{subs_rows}</tbody></table>
<h2>المستبعدون (الإصابات والإيقافات)</h2>
<table><thead><tr><th>الرقم</th><th>الاسم</th><th>السبب</th></tr></thead><tbody>{excl_rows}</tbody></table>
<script>window.onload=function(){{if(location.search.indexOf('autoprint=1')>=0)window.print();}}</script></body></html>"""


def render_training_session_html(sess: dict[str, Any]) -> str:
    """Render printable RTL HTML coaching session card."""
    esc = html_lib.escape
    phases = "".join(
        f"<tr><td><b>{esc(str(ph.get('title_ar','')))}</b></td><td>{int(ph.get('duration_min',0))} د</td><td>{esc(str(ph.get('notes_ar','')))}</td></tr>"
        for ph in sess.get("phases", [])
    )
    points = "".join(f"<li>{esc(str(pt))}</li>" for pt in sess.get("coaching_points_ar", []))
    return f"""<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<title>{esc(str(sess.get('title_ar','وحدة تدريبية')))}</title>
<style>body{{font-family:Tahoma,Arial,sans-serif;background:#fff;color:#0f172a;padding:24px;}}
table{{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;}}
th,td{{border:1px solid #cbd5e1;padding:8px;text-align:right;}} th{{background:#065f46;color:#fff;}}
.meta{{background:#ecfdf5;padding:12px;border:1px solid #a7f3d0;border-radius:8px;}}</style></head><body>
<h1>خطة الوحدة التدريبية — EGY-SCOUT Coach Pro</h1>
<div class="meta"><b>النادي:</b> {esc(str(sess.get('club_name','')))} | <b>اليوم:</b> {esc(str(sess.get('md_code','')))} |
<b>المدة:</b> {int(sess.get('duration_min',60))} دقيقة | <b>RPE:</b> {sess.get('target_rpe',6)} | <b>الحمل:</b> {sess.get('srpe_au',0)} AU</div>
<h2>مراحل الحصة</h2>
<table><thead><tr><th>المرحلة</th><th>المدة</th><th>التنفيذ</th></tr></thead><tbody>{phases}</tbody></table>
<h2>نقاط التوجيه الفني للمدرب</h2><ul>{points}</ul>
</body></html>"""
