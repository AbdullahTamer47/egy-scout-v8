"""SQLite Server-Side Persistence for EGY-SCOUT V8.3 - V9.0 Pro Studio.

Stores per-tenant:
  1. Saved Tactical Plans (22-player formations, keyframes, props, arrows, zones)
  2. Analyst Clip Tags & Locker-Room Playlists (with Pre-roll/Post-roll & XML export/import)
  3. Tokenized Mobile Player Feedback Share Links (role-aware redaction)
"""
from __future__ import annotations

import contextlib
import json
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


class ScoutSQLiteStore:
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
                CREATE TABLE IF NOT EXISTS saved_plans (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    match_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    formation_a TEXT NOT NULL,
                    formation_b TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_saved_plans_tenant ON saved_plans(tenant_id, match_id);

                CREATE TABLE IF NOT EXISTS clip_tags (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    match_id TEXT NOT NULL,
                    category TEXT NOT NULL,
                    label_ar TEXT NOT NULL,
                    label_en TEXT NOT NULL,
                    time_s REAL NOT NULL,
                    start_s REAL NOT NULL,
                    end_s REAL NOT NULL,
                    playlist_name TEXT NOT NULL DEFAULT 'غرفة الملابس (الأساسية)',
                    player_label TEXT DEFAULT '',
                    note TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_clip_tags_tenant_match ON clip_tags(tenant_id, match_id);

                CREATE TABLE IF NOT EXISTS player_share_links (
                    token TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    match_id TEXT NOT NULL,
                    player_name TEXT NOT NULL,
                    created_by_role TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS shortlist_items (
                    tenant_id TEXT NOT NULL,
                    player_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, player_id)
                );

                CREATE TABLE IF NOT EXISTS qa_lineups (
                    tenant_id TEXT NOT NULL,
                    match_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, match_id)
                );

                CREATE TABLE IF NOT EXISTS bench_states (
                    tenant_id TEXT NOT NULL,
                    match_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, match_id)
                );
                """
            )

    # ---------- Tactical Plans ----------
    def list_plans(self, tenant_id: str, match_id: str | None = None) -> list[dict[str, Any]]:
        with self._connect() as conn:
            if match_id:
                rows = conn.execute(
                    "SELECT * FROM saved_plans WHERE tenant_id = ? AND match_id = ? ORDER BY created_at DESC LIMIT 30",
                    (tenant_id, match_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM saved_plans WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 30",
                    (tenant_id,),
                ).fetchall()
        out = []
        for r in rows:
            data = json.loads(r["payload_json"])
            data["id"] = r["id"]
            data["match_id"] = r["match_id"]
            data["name"] = r["name"]
            data["formationA"] = r["formation_a"]
            data["formationB"] = r["formation_b"]
            data["createdAt"] = r["created_at"]
            out.append(data)
        return out

    def save_plan(self, tenant_id: str, match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        plan_id = str(payload.get("id") or f"plan-{secrets.token_hex(5)}")
        name = str(payload.get("name") or payload.get("titleAr") or "خطة تكتيكية").strip()[:100]
        fa = str(payload.get("formationA") or "4-2-3-1")[:24]
        fb = str(payload.get("formationB") or "4-4-2")[:24]
        now = datetime.now(timezone.utc).isoformat()
        stored = dict(payload)
        stored["id"] = plan_id
        stored["name"] = name
        stored["createdAt"] = now
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO saved_plans
                (id, tenant_id, match_id, name, formation_a, formation_b, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (plan_id, tenant_id, match_id, name, fa, fb, json.dumps(stored, ensure_ascii=False), now),
            )
        return stored

    def delete_plan(self, tenant_id: str, plan_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM saved_plans WHERE tenant_id = ? AND id = ?", (tenant_id, plan_id))
            return cur.rowcount > 0

    # ---------- Clip Tags & Locker-Room Playlists ----------
    def list_tags(self, tenant_id: str, match_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM clip_tags WHERE tenant_id = ? AND match_id = ? ORDER BY time_s ASC, created_at ASC",
                (tenant_id, match_id),
            ).fetchall()
        return [dict(r) for r in rows]

    def add_tag(self, tenant_id: str, match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        tag_id = str(payload.get("id") or f"tag-{secrets.token_hex(4)}")
        time_s = float(payload.get("time_s", 0.0))
        pre_s = max(0.5, min(20.0, float(payload.get("pre_roll_s", 4.0))))
        post_s = max(0.5, min(20.0, float(payload.get("post_roll_s", 4.0))))
        start_s = float(payload.get("start_s", max(0.0, time_s - pre_s)))
        end_s = float(payload.get("end_s", time_s + post_s))
        cat = str(payload.get("category") or "buildup")[:40]
        label_ar = str(payload.get("label_ar") or cat)[:80]
        label_en = str(payload.get("label_en") or cat)[:80]
        playlist = str(payload.get("playlist_name") or "محاضرة غرفة الملابس")[:80]
        player_lbl = str(payload.get("player_label") or "")[:80]
        note = str(payload.get("note") or "")[:300]
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO clip_tags
                (id, tenant_id, match_id, category, label_ar, label_en, time_s, start_s, end_s, playlist_name, player_label, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (tag_id, tenant_id, match_id, cat, label_ar, label_en, round(time_s, 2), round(start_s, 2), round(end_s, 2), playlist, player_lbl, note, now),
            )
        return {
            "id": tag_id,
            "tenant_id": tenant_id,
            "match_id": match_id,
            "category": cat,
            "label_ar": label_ar,
            "label_en": label_en,
            "time_s": round(time_s, 2),
            "start_s": round(start_s, 2),
            "end_s": round(end_s, 2),
            "playlist_name": playlist,
            "player_label": player_lbl,
            "note": note,
            "created_at": now,
        }

    def delete_tag(self, tenant_id: str, match_id: str, tag_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM clip_tags WHERE tenant_id = ? AND match_id = ? AND id = ?",
                (tenant_id, match_id, tag_id),
            )
            return cur.rowcount > 0

    # ---------- Player Mobile Feedback Share Links ----------
    def create_share_link(
        self,
        tenant_id: str,
        match_id: str,
        player_name: str,
        created_by_role: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        token = secrets.token_urlsafe(12)
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO player_share_links
                (token, tenant_id, match_id, player_name, created_by_role, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (token, tenant_id, match_id, player_name[:80], created_by_role, json.dumps(payload, ensure_ascii=False), now),
            )
        return {"token": token, "player_name": player_name, "created_at": now}

    def get_share_link(self, token: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM player_share_links WHERE token = ?", (token,)).fetchone()
        if not row:
            return None
        out = json.loads(row["payload_json"])
        out["token"] = row["token"]
        out["match_id"] = row["match_id"]
        out["player_name"] = row["player_name"]
        out["created_at"] = row["created_at"]
        return out

    # ---------- Full SQLite Persistence: Shortlist, QA Lineups, Bench States ----------
    def list_shortlist(self, tenant_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT payload_json FROM shortlist_items WHERE tenant_id = ? ORDER BY updated_at DESC",
                (tenant_id,),
            ).fetchall()
        return [json.loads(r["payload_json"]) for r in rows]

    def upsert_shortlist(self, tenant_id: str, player_id: str, item: dict[str, Any]) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO shortlist_items (tenant_id, player_id, payload_json, updated_at) VALUES (?, ?, ?, ?)",
                (tenant_id, player_id, json.dumps(item, ensure_ascii=False), now),
            )
        return self.list_shortlist(tenant_id)

    def delete_shortlist(self, tenant_id: str, player_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            conn.execute("DELETE FROM shortlist_items WHERE tenant_id = ? AND player_id = ?", (tenant_id, player_id))
        return self.list_shortlist(tenant_id)

    def get_qa_lineup(self, tenant_id: str, match_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM qa_lineups WHERE tenant_id = ? AND match_id = ?",
                (tenant_id, match_id),
            ).fetchone()
        return json.loads(row["payload_json"]) if row else None

    def save_qa_lineup(self, tenant_id: str, match_id: str, data: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO qa_lineups (tenant_id, match_id, payload_json, updated_at) VALUES (?, ?, ?, ?)",
                (tenant_id, match_id, json.dumps(data, ensure_ascii=False), now),
            )

    def get_bench_state(self, tenant_id: str, match_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM bench_states WHERE tenant_id = ? AND match_id = ?",
                (tenant_id, match_id),
            ).fetchone()
        return json.loads(row["payload_json"]) if row else None

    def save_bench_state(self, tenant_id: str, match_id: str, data: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO bench_states (tenant_id, match_id, payload_json, updated_at) VALUES (?, ?, ?, ?)",
                (tenant_id, match_id, json.dumps(data, ensure_ascii=False), now),
            )

    def delete_bench_state(self, tenant_id: str, match_id: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "DELETE FROM bench_states WHERE tenant_id = ? AND match_id = ?",
                (tenant_id, match_id),
            )
