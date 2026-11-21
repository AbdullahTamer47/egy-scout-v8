"""Official Match Lineup Connector: Scoresheet Parser (30s) + API-Football Client (Wave 1, Section 9.4)."""
from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass
from typing import Any, Optional

LINE_RE = re.compile(r"^\s*#?(\d{1,2})\s*[-–:.]?\s+(.+?)\s*$")


@dataclass
class RosterPlayer:
    jersey_number: int
    name: str
    is_starter: bool = True
    is_captain: bool = False
    position: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def parse_scoresheet_text(raw_text: str) -> list[RosterPlayer]:
    """Parse pasted Arabic/English official scoresheet lines into structured players.

    Supports formats like:
      1 - محمد الشناوي (GK) (C)
      10 إمام عاشور
      #9 - Wessam Abou Ali
      --- احتياط / Subs ---
      14 - حسين الشحات
    """
    players: list[RosterPlayer] = []
    seen_nums: set[int] = set()
    is_starter = True

    for line in raw_text.splitlines():
        clean = line.strip()
        if not clean:
            continue
        low = clean.lower()
        if any(tok in low for tok in ("sub", "bench", "احتياط", "بدلاء", "دكة")):
            is_starter = False
            continue
        m = LINE_RE.match(clean)
        if not m:
            continue
        num = int(m.group(1))
        if not (1 <= num <= 99) or num in seen_nums:
            continue
        name = m.group(2).strip()
        is_cap = "(c)" in name.lower() or "(ك)" in name
        pos = ""
        for pcode in ("GK", "CB", "FB", "DM", "CM", "AM", "ST", "W"):
            if f"({pcode.lower()})" in name.lower():
                pos = pcode
                name = re.sub(rf"\(\s*{pcode}\s*\)", "", name, flags=re.IGNORECASE).strip()
        name = re.sub(r"\(\s*[cCك]\s*\)", "", name).strip()
        seen_nums.add(num)
        players.append(
            RosterPlayer(
                jersey_number=num,
                name=name,
                is_starter=is_starter,
                is_captain=is_cap,
                position=pos,
            )
        )
    return players


def fetch_api_football_lineup(fixture_id: int, api_key: Optional[str] = None) -> dict[str, Any]:
    """Fetch official starting XI & substitutes from API-Football (requires API_FOOTBALL_KEY)."""
    key = api_key or os.environ.get("API_FOOTBALL_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "API_FOOTBALL_KEY is not configured. Use parse_scoresheet_text() for free offline entry."
        )
    import httpx

    resp = httpx.get(
        "https://v3.football.api-sports.io/fixtures/lineups",
        params={"fixture": int(fixture_id)},
        headers={"x-apisports-key": key},
        timeout=15.0,
    )
    resp.raise_for_status()
    return resp.json()
