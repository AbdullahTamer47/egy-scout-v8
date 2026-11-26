"""Pre-sync ALL 20 active 2026/27 Egyptian Premier League clubs & players from live 365Scores API."""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from packages.coach_engine.live_data_hub import (  # noqa: E402
    EGYPTIAN_CLUB_PRESETS,
    _cache_dir,
    _full_egypt_cache_path,
    fetch_live_league_hub,
    sync_365scores_club_squad,
)
from packages.shared_contracts.config import get_data_paths  # noqa: E402


def main() -> int:
    # Clear stale SQLite legacy club rosters & stale standings cache first
    db_path = get_data_paths().root / "coach_pro.sqlite3"
    if db_path.is_file():
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute("DELETE FROM club_rosters WHERE payload_json LIKE '%Wikipedia%' OR club_id IN ({})".format(",".join(f"'{k}'" for k in EGYPTIAN_CLUB_PRESETS)))
            conn.commit()
    old_hub = _cache_dir() / "league_hub_egy.1.json"
    if old_hub.is_file():
        old_hub.unlink()

    clubs_out: dict[str, dict] = {}
    total_players = 0
    for cid, meta in EGYPTIAN_CLUB_PRESETS.items():
        ts_id = meta.get("ts_365_id")
        if not ts_id:
            continue
        try:
            res = sync_365scores_club_squad(
                comp_id=int(ts_id),
                club_id=cid,
                name_ar=meta["name_ar"],
                name_en=meta["name_en"],
                kit_hex=meta["kit_hex"],
                stadium_ar=meta.get("stadium_ar", ""),
                city_ar=meta.get("city_ar", ""),
            )
            n = len(res.get("players") or [])
            clubs_out[cid] = res
            total_players += n
            print(f"[OK] {cid:18s} | {meta['name_ar']:22s} | players={n:2d} | coach={res.get('head_coach_ar') or '-'}")
        except Exception as exc:
            print(f"[ERR] {cid:18s}: {exc}")

    dest = _full_egypt_cache_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(
        json.dumps(
            {
                "synced_at_utc": datetime.now(timezone.utc).isoformat(),
                "season": "2026/2027",
                "source": "365Scores Live 2026/27",
                "club_count": len(clubs_out),
                "total_players": total_players,
                "clubs": clubs_out,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    hub = fetch_live_league_hub("egy.1", force_refresh=True)
    print(f"SAVED LIVE 2026/27 CACHE: {dest} ({len(clubs_out)} clubs, {total_players} players, standings={len(hub.get('standings') or [])})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
