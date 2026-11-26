"""Prefetch high-resolution public club player portraits via Wikimedia MediaWiki batch API.

Stores clean 3:4 portraits (540x720) in D:/egy-scout-data/cache/club_portraits/ so
EA FC 25 Player Cards display real player faces immediately without runtime API latency.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from packages.shared_contracts.config import get_data_paths, imwrite_unicode

WIKI_ALIASES: dict[str, str] = {
    "Trezeguet": "Trézéguet (Egyptian footballer)",
    "Mohamed Magdy Afsha": "Mohamed Magdy",
    "Blati Toure": "Blati Touré",
    "Osama Galal": "Osama Galal",
    "Walid El Karti": "Walid El Karti",
    "Fiston Mayele": "Fiston Mayele",
    "Ahmed Kalosha": "Ahmed Kalosha",
    "Salah Mohsen": "Salah Mohsen",
    "Baher El Mohamady": "Baher El Mohamady",
    "Ziad Kamal": "Ziad Kamal",
    "Ammar Hamdy": "Ammar Hamdy",
    "Lukas Hradecky": "Lukáš Hrádecký",
}


def portrait_slug(name_en: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "_", (name_en or "").lower()).strip("_")
    return clean or "player"


def _save_portrait_bytes(raw: bytes, dest: Path) -> bool:
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None or img.size == 0:
        return False
    h, w = img.shape[:2]
    target_ratio = 3.0 / 4.0
    cur_ratio = w / max(1, h)
    if cur_ratio > target_ratio:
        new_w = max(1, int(round(h * target_ratio)))
        x0 = (w - new_w) // 2
        cropped = img[:, x0 : x0 + new_w]
    else:
        new_h = max(1, int(round(w / target_ratio)))
        y0 = max(0, (h - new_h) // 6)
        cropped = img[y0 : min(h, y0 + new_h), :]
    out_img = cv2.resize(cropped, (540, 720), interpolation=cv2.INTER_LANCZOS4)
    imwrite_unicode(dest, out_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return dest.is_file()


def _batch_fetch_wiki(titles: list[str], lang: str = "en") -> dict[str, str]:
    headers = {"User-Agent": "EGYScoutSportsAnalytics/10.6 (https://localhost; dev@egyscout.local)"}
    out: dict[str, str] = {}
    for i in range(0, len(titles), 40):
        chunk = [t for t in titles[i : i + 40] if t]
        if not chunk:
            continue
        url = f"https://{lang}.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
            {
                "action": "query",
                "titles": "|".join(chunk),
                "prop": "pageimages",
                "pithumbsize": "600",
                "redirects": "1",
                "format": "json",
            }
        )
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            query = data.get("query", {})
            norm_map: dict[str, str] = {}
            for item in query.get("normalized", []) + query.get("redirects", []):
                norm_map[item.get("from", "")] = item.get("to", "")
            pages_by_title: dict[str, str] = {}
            for page in (query.get("pages") or {}).values():
                t = page.get("title")
                src = (page.get("thumbnail") or {}).get("source")
                if t and src:
                    pages_by_title[t] = src
            for orig in chunk:
                resolved = orig
                for _ in range(4):
                    if resolved in norm_map:
                        resolved = norm_map[resolved]
                if resolved in pages_by_title:
                    out[orig] = pages_by_title[resolved]
        except Exception:
            continue
    return out


def main() -> int:
    os.environ.setdefault("EGY_SCOUT_DATA_DIR", r"D:\egy-scout-data")
    rosters_p = REPO_ROOT / "datasets" / "rosters" / "clubs_2025_26.json"
    clubs = json.loads(rosters_p.read_text(encoding="utf-8")).get("clubs", {})
    out_dir = get_data_paths(create=True).cache / "club_portraits"
    out_dir.mkdir(parents=True, exist_ok=True)

    player_entries: list[tuple[str, int, str, str]] = []
    wiki_titles_en: list[str] = []
    wiki_titles_ar: list[str] = []

    for cid, club in clubs.items():
        for pl in club.get("players", []):
            nen = str(pl.get("name_en") or "").strip()
            nar = str(pl.get("name_ar") or "").strip()
            j = int(pl.get("jersey_number") or 0)
            if not nen or nen.startswith("El Sekka"):
                continue
            player_entries.append((cid, j, nen, nar))
            wiki_titles_en.append(WIKI_ALIASES.get(nen, nen))
            if nar:
                wiki_titles_ar.append(nar)

    en_urls = _batch_fetch_wiki(sorted(set(wiki_titles_en)), lang="en")
    missing_ar = [nar for _, _, nen, nar in player_entries if WIKI_ALIASES.get(nen, nen) not in en_urls and nar]
    ar_urls = _batch_fetch_wiki(sorted(set(missing_ar)), lang="ar") if missing_ar else {}

    headers = {"User-Agent": "EGYScoutSportsAnalytics/10.6 (https://localhost; dev@egyscout.local)"}
    saved = 0
    for cid, j, nen, nar in player_entries:
        slug_path = out_dir / f"{portrait_slug(nen)}.jpg"
        club_path = out_dir / f"{cid}_{j}.jpg"
        if slug_path.is_file() and club_path.is_file():
            saved += 1
            continue
        url = en_urls.get(WIKI_ALIASES.get(nen, nen)) or ar_urls.get(nar)
        if not url:
            continue
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as r:
                raw = r.read(5 * 1024 * 1024)
            if _save_portrait_bytes(raw, slug_path):
                club_path.write_bytes(slug_path.read_bytes())
                saved += 1
                print(f"Saved portrait: {cid} #{j} {nen}")
        except Exception as exc:
            print(f"Skip {nen}: {exc}")

    print(f"Total cached portraits ready: {saved}/{len(player_entries)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
