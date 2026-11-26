"""Pre-sync ALL 23 Egyptian Premier League clubs & players from Wikipedia MediaWiki API into local cache."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from packages.coach_engine.live_data_hub import (  # noqa: E402
    EGYPTIAN_CLUB_PRESETS,
    _full_egypt_cache_path,
    sync_wikipedia_club_squad,
)


def main() -> int:
    clubs_out: dict[str, dict] = {}
    total_players = 0
    for cid, meta in EGYPTIAN_CLUB_PRESETS.items():
        try:
            res = sync_wikipedia_club_squad(
                wiki_page=meta["wiki_page"],
                club_id=cid,
                name_ar=meta["name_ar"],
                name_en=meta["name_en"],
                kit_hex=meta["kit_hex"],
                ar_wiki_page=meta.get("ar_wiki_page"),
                stadium_ar=meta.get("stadium_ar", ""),
                city_ar=meta.get("city_ar", ""),
            )
            n = len(res.get("players") or [])
            clubs_out[cid] = res
            total_players += n
            print(f"[OK] {cid:18s} | {meta['name_ar']:22s} | players={n:2d} | {res['source']}")
        except Exception as exc:
            print(f"[ERR] {cid:18s}: {exc}")

    dest = _full_egypt_cache_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(
        json.dumps(
            {
                "synced_at_utc": datetime.now(timezone.utc).isoformat(),
                "club_count": len(clubs_out),
                "total_players": total_players,
                "clubs": clubs_out,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"SAVED FULL EGYPTIAN LEAGUE CACHE: {dest} ({len(clubs_out)} clubs, {total_players} players)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
