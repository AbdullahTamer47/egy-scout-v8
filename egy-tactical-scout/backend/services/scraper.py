"""Egyptian Premier League & Second Division A club/player harvester (Transfermarkt live scraper).
Populates `leagues`, `clubs`, and `players` tables with real rosters, jersey numbers, ages, heights,
preferred feet, and market values so tracked jersey numbers link to real player records."""
from __future__ import annotations

import re
from datetime import datetime

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import select

from core.database import SessionLocal
from models.schema import Club, League, Player

TM_BASE = "https://www.transfermarkt.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

EGYPTIAN_LEAGUES = [
    {"code": "EGY1", "name": "Egyptian Premier League (Nile League)", "tier": 1,
     "url": f"{TM_BASE}/egyptian-premier-league/startseite/wettbewerb/EGY1"},
    {"code": "EGY2", "name": "Egyptian Second Division A (El Mahtarefeen)", "tier": 2,
     "url": f"{TM_BASE}/egyptian-second-division-a/startseite/wettbewerb/EGY2"},
]

ARABIC_NAMES_BY_EN: dict[str, str] = {
    "Al Ahly": "الأهلي",
    "Zamalek": "الزمالك",
    "Pyramids": "بيراميدز",
    "Al Masry": "المصري البورسعيدي",
    "Al Ittihad": "الاتحاد السكندري",
    "Ismaily": "الإسماعيلي",
    "Ceramica Cleopatra": "سيراميكا كليوباترا",
    "Modern Sport": "مودرن سبورت",
    "ZED": "زد إف سي",
    "ENPPI": "إنبي",
    "Smouha": "سموحة",
    "Tala'ea El Gaish": "طلائع الجيش",
    "National Bank": "البنك الأهلي",
    "Pharco": "فاركو",
    "El Gouna": "الجونة",
    "Ghazl El Mahalla": "غزل المحلة",
    "Haras El Hodood": "حرس الحدود",
    "Petrojet": "بتروجيت",
    "Wadi Degla": "وادي دجلة",
    "El Mokawloon": "المقاولون العرب",
    "Sekka": "السكة الحديد",
    "Tersana": "الترسانة",
    "Mansoura": "المنصورة",
    "Tanta": "طنطا",
    "Qanah": "القناة",
    "Telecom": "المصرية للاتصالات (وي)",
    "Aswan": "أسوان",
}


def _parse_market_value(text: str) -> int | None:
    if not text:
        return None
    t = text.replace("€", "").replace(",", ".").strip().lower()
    m = re.search(r"([\d.]+)\s*(m|k|th\.)?", t)
    if not m:
        return None
    val = float(m.group(1))
    unit = m.group(2) or ""
    if unit == "m":
        return int(val * 1_000_000)
    if unit in ("k", "th."):
        return int(val * 1_000)
    return int(val)


def _arabic_name(en_name: str) -> str | None:
    for key, ar in ARABIC_NAMES_BY_EN.items():
        if key.lower() in en_name.lower():
            return ar
    return None


def scrape_league_clubs(client: httpx.Client, league_url: str) -> list[dict]:
    resp = client.get(league_url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    clubs: dict[str, dict] = {}
    for a in soup.select("table.items td.hauptlink a[href*='/startseite/verein/']"):
        href = a.get("href", "")
        name = a.get_text(strip=True)
        m = re.search(r"/verein/(\d+)", href)
        if not name or not m:
            continue
        ext_id = f"tm_club_{m.group(1)}"
        kader_url = re.sub(r"/startseite/verein/(\d+).*", r"/kader/verein/\1/plus/1", href)
        clubs[ext_id] = {
            "external_id": ext_id,
            "name": name,
            "name_ar": _arabic_name(name),
            "source_url": f"{TM_BASE}{kader_url}",
        }
    return list(clubs.values())


def scrape_club_roster(client: httpx.Client, kader_url: str) -> list[dict]:
    resp = client.get(kader_url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")
    players: list[dict] = []
    for tr in soup.select("table.items > tbody > tr"):
        num_el = tr.select_one("div.rn_nummer")
        name_el = tr.select_one("td.hauptlink a[href*='/profil/spieler/']")
        if not name_el:
            continue
        href = name_el.get("href", "")
        pm = re.search(r"/spieler/(\d+)", href)
        if not pm:
            continue
        ext_id = f"tm_player_{pm.group(1)}"
        name = name_el.get_text(strip=True)
        jersey = None
        if num_el:
            nt = num_el.get_text(strip=True)
            if nt.isdigit():
                jersey = int(nt)

        pos_td = tr.select("table.inline-table tr")
        position = pos_td[1].get_text(strip=True) if len(pos_td) > 1 else None

        tds = tr.find_all("td", recursive=False)
        birth_date, age, height_cm, foot, mv = None, None, None, None, None
        for td in tds:
            txt = td.get_text(" ", strip=True)
            bm = re.search(r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*\((\d{2})\)", txt)
            if bm and birth_date is None:
                try:
                    birth_date = datetime.strptime(bm.group(1), "%b %d, %Y").date()
                except ValueError:
                    pass
                age = int(bm.group(2))
            hm = re.search(r"(\d)[,.](\d{2})\s*m", txt)
            if hm and height_cm is None:
                height_cm = int(hm.group(1)) * 100 + int(hm.group(2))
            if txt.lower() in ("right", "left", "both") and foot is None:
                foot = txt.lower()
            if "€" in txt and mv is None:
                mv = _parse_market_value(txt)

        nat_img = tr.select_one("td img.flaggenrahmen")
        nationality = nat_img.get("title") if nat_img else "Egypt"

        players.append({
            "external_id": ext_id,
            "name": name,
            "jersey_number": jersey,
            "position": position,
            "birth_date": birth_date,
            "age": age,
            "height_cm": height_cm,
            "preferred_foot": foot,
            "nationality": nationality,
            "market_value_eur": mv,
            "source_url": f"{TM_BASE}{href}",
        })
    return players


def harvest_egyptian_leagues(max_clubs_per_league: int = 8) -> dict:
    """Scrapes Egyptian leagues and persists clubs + players into SQLite."""
    clubs_saved = 0
    players_saved = 0
    with httpx.Client(headers=HEADERS, timeout=30.0, follow_redirects=True) as client, SessionLocal() as db:
        for lg_meta in EGYPTIAN_LEAGUES:
            league = db.scalar(select(League).where(League.code == lg_meta["code"]))
            if league is None:
                league = League(code=lg_meta["code"], name=lg_meta["name"], tier=lg_meta["tier"],
                                source_url=lg_meta["url"])
                db.add(league)
                db.flush()
            try:
                clubs = scrape_league_clubs(client, lg_meta["url"])
            except Exception:
                continue
            for cdata in clubs[:max_clubs_per_league]:
                club = db.scalar(select(Club).where(Club.external_id == cdata["external_id"]))
                if club is None:
                    club = Club(league_id=league.id, **cdata)
                    db.add(club)
                    db.flush()
                else:
                    club.name = cdata["name"]
                    club.name_ar = cdata["name_ar"] or club.name_ar
                    club.source_url = cdata["source_url"]
                clubs_saved += 1
                try:
                    roster = scrape_club_roster(client, cdata["source_url"])
                except Exception:
                    continue
                for pdata in roster:
                    player = db.scalar(select(Player).where(Player.external_id == pdata["external_id"]))
                    if player is None:
                        player = Player(club_id=club.id, **pdata)
                        db.add(player)
                    else:
                        player.club_id = club.id
                        for k, v in pdata.items():
                            if v is not None:
                                setattr(player, k, v)
                    players_saved += 1
            db.commit()
    return {"clubs": clubs_saved, "players": players_saved}

