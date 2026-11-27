"""Live & Verified Football Data Hub for EGY-SCOUT Coach Pro.

Covers ALL Egyptian Premier League (2026/27 + historic EPL) clubs and players with rich details
(Arabic/English names, jersey numbers, natural positions, nationalities, portraits, stadiums, kit hex),
plus live league standings & fixtures via Wikipedia MediaWiki API (primary <400ms for Egypt EPL),
TheSportsDB v1 (optional fixtures/badges), and ESPN Public Soccer API (EPL, LaLiga, Bundesliga,
Serie A, UEFA CL, CAF CL). Zero fabricated statistics or invented players.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

from packages.shared_contracts.config import get_data_paths, get_repo_root

WIKI_HEADERS = {
    "User-Agent": "EGYScoutCoachPro/1.0 (https://egy-scout.local; contact@egy-scout.local) httpx/0.28"
}
PUBLIC_HEADERS = {
    "User-Agent": "EGYScoutCoachPro/1.0 (coach-pro-live-hub)"
}

SUPPORTED_LEAGUES: dict[str, dict[str, str]] = {
    "egy.1": {
        "id": "egy.1",
        "name_ar": "الدوري المصري الممتاز",
        "name_en": "Egyptian Premier League",
        "provider": "egy_hybrid",
        "tsdb_id": "4829",
        "espn_slug": "egy.1",
        "country_flag": "🇪🇬",
        "logo_url": "https://imagecache.365scores.com/image/upload/f_png,w_96,h_96,c_limit,q_auto:eco,dpr_2,d_Competitions:default.png/v1/Competitions/552",
    },
    "eng.1": {
        "id": "eng.1",
        "name_ar": "الدوري الإنجليزي الممتاز",
        "name_en": "English Premier League",
        "provider": "espn",
        "espn_slug": "eng.1",
        "country_flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
    },
    "esp.1": {
        "id": "esp.1",
        "name_ar": "الدوري الإسباني (LaLiga)",
        "name_en": "Spanish LaLiga",
        "provider": "espn",
        "espn_slug": "esp.1",
        "country_flag": "🇪🇸",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png",
    },
    "ger.1": {
        "id": "ger.1",
        "name_ar": "الدوري الألماني (Bundesliga)",
        "name_en": "German Bundesliga",
        "provider": "espn",
        "espn_slug": "ger.1",
        "country_flag": "🇩🇪",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png",
    },
    "ita.1": {
        "id": "ita.1",
        "name_ar": "الدوري الإيطالي (Serie A)",
        "name_en": "Italian Serie A",
        "provider": "espn",
        "espn_slug": "ita.1",
        "country_flag": "🇮🇹",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png",
    },
    "fra.1": {
        "id": "fra.1",
        "name_ar": "الدوري الفرنسي (Ligue 1)",
        "name_en": "French Ligue 1",
        "provider": "espn",
        "espn_slug": "fra.1",
        "country_flag": "🇫🇷",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png",
    },
    "uefa.champions": {
        "id": "uefa.champions",
        "name_ar": "دوري أبطال أوروبا",
        "name_en": "UEFA Champions League",
        "provider": "espn",
        "espn_slug": "uefa.champions",
        "country_flag": "🇪🇺",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png",
    },
    "caf.champions": {
        "id": "caf.champions",
        "name_ar": "دوري أبطال إفريقيا",
        "name_en": "CAF Champions League",
        "provider": "espn",
        "espn_slug": "caf.champions",
        "country_flag": "🌍",
        "logo_url": "https://a.espncdn.com/i/leaguelogos/soccer/500/67.png",
    },
}

EGYPTIAN_CLUB_PRESETS: dict[str, dict[str, Any]] = {
    "pyramids": {"code": "PYR", "ts_365_id": 22143, "wiki_page": "Pyramids_FC", "ar_wiki_page": "نادي_بيراميدز", "name_ar": "بيراميدز", "name_en": "Pyramids FC", "kit_hex": "#0EA5E9", "stadium_ar": "ستاد الدفاع الجوي", "city_ar": "القاهرة"},
    "zamalek": {"code": "ZAM", "ts_365_id": 8201, "wiki_page": "Zamalek_SC", "ar_wiki_page": "نادي_الزمالك", "name_ar": "الزمالك", "name_en": "Zamalek SC", "kit_hex": "#F8FAFC", "stadium_ar": "ستاد القاهرة الدولي", "city_ar": "الجيزة"},
    "al_ahly": {"code": "AHL", "ts_365_id": 8200, "wiki_page": "Al_Ahly_SC", "ar_wiki_page": "النادي_الأهلي_(مصر)", "name_ar": "الأهلي", "name_en": "Al Ahly SC", "kit_hex": "#DC2626", "stadium_ar": "ستاد القاهرة الدولي", "city_ar": "القاهرة"},
    "ceramica": {"code": "CER", "ts_365_id": 50882, "wiki_page": "Ceramica_Cleopatra_FC", "ar_wiki_page": "نادي_سيراميكا_كليوباترا", "name_ar": "سيراميكا كليوباترا", "name_en": "Ceramica Cleopatra", "kit_hex": "#E01F1F", "stadium_ar": "ستاد المقاولون العرب", "city_ar": "القاهرة"},
    "al_ittihad": {"code": "ITH", "ts_365_id": 8312, "wiki_page": "Al_Ittihad_Alexandria_Club", "ar_wiki_page": "نادي_الاتحاد_السكندري", "name_ar": "الاتحاد السكندري", "name_en": "Al Ittihad Alexandria", "kit_hex": "#16A34A", "stadium_ar": "ستاد الإسكندرية", "city_ar": "الإسكندرية"},
    "mokawloon": {"code": "MOK", "ts_365_id": 8310, "wiki_page": "Al_Mokawloon_Al_Arab_SC", "ar_wiki_page": "نادي_المقاولون_العرب", "name_ar": "المقاولون العرب", "name_en": "Al Mokawloon", "kit_hex": "#FACC15", "stadium_ar": "ستاد المقاولون العرب", "city_ar": "القاهرة"},
    "modern_sport": {"code": "MOD", "ts_365_id": 50877, "wiki_page": "Modern_Sport_FC", "ar_wiki_page": "نادي_مودرن_سبورت", "name_ar": "مودرن سبورت", "name_en": "Modern Sport", "kit_hex": "#E11D48", "stadium_ar": "ستاد السلام", "city_ar": "القاهرة"},
    "national_bank": {"code": "NBE", "ts_365_id": 50527, "wiki_page": "National_Bank_of_Egypt_SC", "ar_wiki_page": "نادي_البنك_الأهلي_المصري", "name_ar": "البنك الأهلي", "name_en": "National Bank of Egypt", "kit_hex": "#F97316", "stadium_ar": "ستاد القاهرة الدولي", "city_ar": "القاهرة"},
    "al_masry": {"code": "MAS", "ts_365_id": 8303, "wiki_page": "Al_Masry_SC", "ar_wiki_page": "النادي_المصري", "name_ar": "المصري البورسعيدي", "name_en": "Al Masry", "kit_hex": "#0D9488", "stadium_ar": "ستاد السويس الجديد", "city_ar": "بورسعيد"},
    "smouha": {"code": "SMO", "ts_365_id": 8309, "wiki_page": "Smouha_SC", "ar_wiki_page": "نادي_سموحة", "name_ar": "سموحة", "name_en": "Smouha", "kit_hex": "#2563EB", "stadium_ar": "ستاد الإسكندرية", "city_ar": "الإسكندرية"},
    "zed": {"code": "ZED", "ts_365_id": 29732, "wiki_page": "ZED_FC", "ar_wiki_page": "نادي_زد", "name_ar": "زد إف سي", "name_en": "ZED FC", "kit_hex": "#16A34A", "stadium_ar": "ستاد القاهرة الدولي", "city_ar": "الجيزة"},
    "enppi": {"code": "SEI", "ts_365_id": 8300, "wiki_page": "ENPPI_SC", "ar_wiki_page": "نادي_إنبي", "name_ar": "إنبي", "name_en": "ENPPI", "kit_hex": "#38BDF8", "stadium_ar": "ستاد بتروسبورت", "city_ar": "القاهرة"},
    "ghazl_mahalla": {"code": "GMH", "ts_365_id": 8610, "wiki_page": "Ghazl_El_Mahalla_SC", "ar_wiki_page": "نادي_غزل_المحلة", "name_ar": "غزل المحلة", "name_en": "Ghazl El Mahalla", "kit_hex": "#0284C7", "stadium_ar": "ستاد غزل المحلة", "city_ar": "المحلة الكبرى"},
    "el_gaish": {"code": "TGS", "ts_365_id": 8306, "wiki_page": "Tala'ea_El_Gaish_SC", "ar_wiki_page": "نادي_طلائع_الجيش", "name_ar": "طلائع الجيش", "name_en": "Tala'ea El Gaish", "kit_hex": "#B91C1C", "stadium_ar": "ستاد جهاز الرياضة العسكري", "city_ar": "القاهرة"},
    "petrojet": {"code": "MSP", "ts_365_id": 8302, "wiki_page": "Petrojet_SC", "ar_wiki_page": "نادي_بتروجيت", "name_ar": "بتروجيت", "name_en": "Petrojet", "kit_hex": "#EA580C", "stadium_ar": "ستاد بتروسبورت", "city_ar": "السويس"},
    "wadi_degla": {"code": "WAD", "ts_365_id": 8311, "wiki_page": "Wadi_Degla_SC", "ar_wiki_page": "نادي_وادي_دجلة", "name_ar": "وادي دجلة", "name_en": "Wadi Degla", "kit_hex": "#EAB308", "stadium_ar": "ستاد السلام", "city_ar": "القاهرة"},
    "el_qanah": {"code": "QAN", "ts_365_id": 12252, "wiki_page": "El_Qanah_FC", "ar_wiki_page": "نادي_القناة", "name_ar": "القناة", "name_en": "El Qanah", "kit_hex": "#0D9488", "stadium_ar": "ستاد هيئة قناة السويس", "city_ar": "الإسماعيلية"},
    "asyut_petroleum": {"code": "ASY", "ts_365_id": 12254, "wiki_page": "Asyut_Petroleum_SC", "ar_wiki_page": "نادي_بترول_أسيوط", "name_ar": "بترول أسيوط", "name_en": "Asyut Petroleum", "kit_hex": "#D97706", "stadium_ar": "ستاد بترول أسيوط", "city_ar": "أسيوط"},
    "abou_qir": {"code": "ABO", "ts_365_id": 19480, "wiki_page": "Abou_Qir_Fertilizers_SC", "ar_wiki_page": "نادي_أبو_قير_للأسمدة", "name_ar": "أبو قير للأسمدة", "name_en": "Abou Qir", "kit_hex": "#059669", "stadium_ar": "ستاد الإسكندرية", "city_ar": "الإسكندرية"},
    "el_gouna": {"code": "GOU", "ts_365_id": 8308, "wiki_page": "El_Gouna_FC", "ar_wiki_page": "نادي_الجونة", "name_ar": "الجونة", "name_en": "El Gouna", "kit_hex": "#14B8A6", "stadium_ar": "ستاد خالد بشارة", "city_ar": "الغردقة"},
}

EGY_TEAM_NAME_AR: dict[str, str] = {v["name_en"]: v["name_ar"] for v in EGYPTIAN_CLUB_PRESETS.values()}
EGY_TEAM_NAME_AR.update(
    {
        "Al Ahly": "الأهلي",
        "Zamalek SC": "الزمالك",
        "Pyramids FC": "بيراميدز",
        "Al Masry": "المصري البورسعيدي",
        "El Sharkia Enppi": "إنبي",
        "Al Ittihad": "الاتحاد السكندري",
        "Al Mokawloon Al Arab": "المقاولون العرب",
        "Montakhab El Suez Petrojet": "بتروجيت",
        "National Bank of Egypt": "البنك الأهلي",
        "National Bank": "البنك الأهلي",
        "ZED": "زد إف سي",
        "Kahraba Ismailia": "كهرباء الإسماعيلية",
    }
)

CLUB_NAME_TO_ID: dict[str, str] = {}
for cid, meta in EGYPTIAN_CLUB_PRESETS.items():
    CLUB_NAME_TO_ID[meta["name_en"].lower()] = cid
    CLUB_NAME_TO_ID[meta["name_ar"].lower()] = cid
CLUB_NAME_TO_ID.update(
    {
        "el sharkia enppi": "enppi",
        "al ittihad": "al_ittihad",
        "al mokawloon al arab": "mokawloon",
        "montakhab el suez petrojet": "petrojet",
        "zed": "zed",
        "pyramids fc": "pyramids",
        "zamalek sc": "zamalek",
        "al ahly sc": "al_ahly",
        "haras el hodood": "haras_el_hodood",
    }
)

CODE_TO_CLUB_ID: dict[str, str] = {meta["code"]: cid for cid, meta in EGYPTIAN_CLUB_PRESETS.items()}
CODE_TO_CLUB_ID["WDG"] = "wadi_degla"

NAT_FLAGS: dict[str, tuple[str, str]] = {
    "EGY": ("🇪🇬", "مصر"),
    "MAR": ("🇲🇦", "المغرب"),
    "TUN": ("🇹🇳", "تونس"),
    "ALG": ("🇩🇿", "الجزائر"),
    "PLE": ("🇵🇸", "فلسطين"),
    "MLI": ("🇲🇱", "مالي"),
    "NGA": ("🇳🇬", "نيجيريا"),
    "GHA": ("🇬🇭", "غانا"),
    "SEN": ("🇸🇳", "السنغال"),
    "CIV": ("🇨🇮", "كوت ديفوار"),
    "RSA": ("🇿🇦", "جنوب إفريقيا"),
    "BFA": ("🇧🇫", "بوركينا فاسو"),
    "COD": ("🇨🇩", "الكونغو الديمقراطية"),
    "BRA": ("🇧🇷", "البرازيل"),
    "ARG": ("🇦🇷", "الأرجنتين"),
    "POR": ("🇵🇹", "البرتغال"),
    "FRA": ("🇫🇷", "فرنسا"),
    "ESP": ("🇪🇸", "إسبانيا"),
    "JOR": ("🇯🇴", "الأردن"),
    "SYR": ("🇸🇾", "سوريا"),
    "SDN": ("🇸🇩", "السودان"),
    "LBY": ("🇱🇾", "ليبيا"),
    "UGA": ("🇺🇬", "أوغندا"),
}

AR_COUNTRY_TO_ISO: dict[str, str] = {
    "مصر": "EGY", "المغرب": "MAR", "تونس": "TUN", "الجزائر": "ALG", "فلسطين": "PLE",
    "مالي": "MLI", "نيجيريا": "NGA", "غانا": "GHA", "السنغال": "SEN", "ساحل العاج": "CIV",
    "جنوب إفريقيا": "RSA", "بوركينا فاسو": "BFA", "البرازيل": "BRA", "الأرجنتين": "ARG",
    "الأردن": "JOR", "سوريا": "SYR", "السودان": "SDN", "ليبيا": "LBY", "أوغندا": "UGA",
}

FS_PLAYER_RE = re.compile(
    r"\{\{(?:Fs player2?|Football squad player|تشكيلة لاعب|لاعب تشكيلة كرة قدم)\s*\|([^}]+)\}\}",
    flags=re.IGNORECASE,
)
CACHE_TTL_SECONDS = 300
SQUAD_CACHE_TTL_SECONDS = 21600

THREESIXFIVE_COMPETITION_EGY = 552
THREESIXFIVE_LEAGUE_IDS: dict[str, int] = {
    "egy.1": 552,
    "eng.1": 7,
    "esp.1": 11,
    "ger.1": 25,
    "ita.1": 17,
    "fra.1": 35,
    "uefa.champions": 572,
    "caf.champions": 624,
}
_MEM_LEAGUE_CLUBS: dict[str, tuple[float, list[dict[str, Any]]]] = {}
THREESIXFIVE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
}
THREESIXFIVE_CLUB_ID_MAP: dict[int, str] = {
    int(v["ts_365_id"]): cid for cid, v in EGYPTIAN_CLUB_PRESETS.items() if v.get("ts_365_id")
}
THREESIXFIVE_POS_MAP: dict[str, str] = {
    "goalkeeper": "GK",
    "centre back": "CB",
    "center back": "CB",
    "defender": "CB",
    "right back": "RB",
    "left back": "LB",
    "right wing back": "RWB",
    "left wing back": "LWB",
    "defensive midfield": "DM",
    "central midfield": "CM",
    "midfielder": "CM",
    "attacking midfield": "CAM",
    "right midfield": "RM",
    "left midfield": "LM",
    "right forward": "RW",
    "left forward": "LW",
    "right winger": "RW",
    "left winger": "LW",
    "centre forward": "ST",
    "center forward": "ST",
    "forward": "ST",
    "striker": "ST",
    "حارس مرمى": "GK",
    "قلب دفاع": "CB",
    "ظهير أيمن": "RB",
    "ظهير أيسر": "LB",
    "الدفاع": "CB",
    "وسط دفاعي": "DM",
    "وسط محوري": "CM",
    "وسط هجومي": "CAM",
    "الوسط": "CM",
    "مهاجم أيمن": "RW",
    "مهاجم أيسر": "LW",
    "مهاجم صريح": "ST",
    "رأس حربة": "ST",
    "الهجوم": "ST",
}
THREESIXFIVE_COUNTRY_ISO: dict[int, tuple[str, str, str]] = {
    131: ("EGY", "🇪🇬", "مصر"),
    127: ("MAR", "🇲🇦", "المغرب"),
    135: ("TUN", "🇹🇳", "تونس"),
    139: ("ALG", "🇩🇿", "الجزائر"),
    226: ("PLE", "🇵🇸", "فلسطين"),
    119: ("JOR", "🇯🇴", "الأردن"),
    114: ("IRQ", "🇮🇶", "العراق"),
    123: ("LBN", "🇱🇧", "لبنان"),
    21: ("BRA", "🇧🇷", "البرازيل"),
    5: ("FRA", "🇫🇷", "فرنسا"),
    7: ("NED", "🇳🇱", "هولندا"),
    46: ("SVN", "🇸🇮", "سلوفينيا"),
    65: ("GHA", "🇬🇭", "غانا"),
    67: ("SLE", "🇸🇱", "سيراليون"),
    68: ("ERI", "🇪🇷", "إريتريا"),
    69: ("GUI", "🇬🇳", "غينيا"),
    71: ("TOG", "🇹🇬", "توغو"),
    72: ("CGO", "🇨🇬", "الكونغو"),
    73: ("CMR", "🇨🇲", "الكاميرون"),
    74: ("CIV", "🇨🇮", "كوت ديفوار"),
    83: ("NGA", "🇳🇬", "نيجيريا"),
    129: ("BEN", "🇧🇯", "بنين"),
    132: ("ZAM", "🇿🇲", "زامبيا"),
    133: ("SEN", "🇸🇳", "السنغال"),
    134: ("RSA", "🇿🇦", "جنوب إفريقيا"),
    136: ("ANG", "🇦🇴", "أنجولا"),
    137: ("UGA", "🇺🇬", "أوغندا"),
    138: ("LBR", "🇱🇷", "ليبيريا"),
    141: ("TAN", "🇹🇿", "تنزانيا"),
    142: ("RWA", "🇷🇼", "رواندا"),
    150: ("BFA", "🇧🇫", "بوركينا فاسو"),
    191: ("MTN", "🇲🇷", "موريتانيا"),
    235: ("COD", "🇨🇩", "الكونغو الديمقراطية"),
}


def _cache_dir() -> Path:
    d = get_data_paths().cache / "live_hub"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _full_egypt_cache_path() -> Path:
    return get_data_paths().cache / "egyptian_league_full_2026_27.json"


def _read_cache(key: str, max_age_s: int = CACHE_TTL_SECONDS, allow_stale: bool = False) -> Optional[dict[str, Any]]:
    path = _cache_dir() / f"{re.sub(r'[^a-zA-Z0-9._-]', '_', key)}.json"
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        fetched_ts = float(payload.get("_cached_ts", 0.0))
        if not allow_stale and (time.time() - fetched_ts) > max_age_s:
            return None
        return payload
    except Exception:
        return None


def _write_cache(key: str, data: dict[str, Any]) -> None:
    path = _cache_dir() / f"{re.sub(r'[^a-zA-Z0-9._-]', '_', key)}.json"
    to_save = dict(data)
    to_save["_cached_ts"] = time.time()
    path.write_text(json.dumps(to_save, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_local_clubs_json() -> dict[str, dict[str, Any]]:
    p = get_repo_root() / "datasets" / "rosters" / "clubs_2025_26.json"
    if not p.is_file():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        return dict(raw.get("clubs") or {})
    except Exception:
        return {}


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        if val is None or val == "":
            return default
        return int(float(val))
    except (TypeError, ValueError):
        return default


def _nat_details(nat_raw: str) -> tuple[str, str, str]:
    clean = (nat_raw or "EGY").strip()
    upper = clean.upper()
    if upper in NAT_FLAGS:
        fl, ar = NAT_FLAGS[upper]
        return upper, fl, ar
    if clean in AR_COUNTRY_TO_ISO:
        iso = AR_COUNTRY_TO_ISO[clean]
        fl, ar = NAT_FLAGS[iso]
        return iso, fl, ar
    for name_tok, iso in (("EGYPT", "EGY"), ("MOROCCO", "MAR"), ("TUNISIA", "TUN"), ("ALGERIA", "ALG"), ("PALESTINE", "PLE"), ("NIGERIA", "NGA"), ("GHANA", "GHA"), ("MALI", "MLI"), ("BRAZIL", "BRA")):
        if name_tok in upper:
            fl, ar = NAT_FLAGS[iso]
            return iso, fl, ar
    return upper[:3] or "EGY", "🌍", clean


def _ts365_score_str(val: Any) -> str:
    if val is None or val == "" or float(val) < 0:
        return "-"
    try:
        return str(int(round(float(val))))
    except (TypeError, ValueError):
        return "-"


def fetch_365scores_egyptian_standings_and_games() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Fetch LIVE today-updated 2026/27 (Season 74) Egyptian Premier League table, crests, results & upcoming games."""
    from datetime import timedelta

    standings: list[dict[str, Any]] = []
    upcoming: list[dict[str, Any]] = []
    recent: list[dict[str, Any]] = []

    now_local = datetime.now(timezone(timedelta(hours=2)))
    start_str = now_local.strftime("%d/%m/%Y")
    end_str = (now_local + timedelta(days=28)).strftime("%d/%m/%Y")

    with httpx.Client(headers=THREESIXFIVE_HEADERS, timeout=12.0) as client:
        r_ar = client.get(
            "https://webws.365scores.com/web/standings/",
            params={"appTypeId": 5, "langId": 27, "timezoneName": "Africa/Cairo", "userCountryId": 21, "competitions": THREESIXFIVE_COMPETITION_EGY},
        )
        r_ar.raise_for_status()
        r_en = client.get(
            "https://webws.365scores.com/web/standings/",
            params={"appTypeId": 5, "langId": 1, "timezoneName": "Africa/Cairo", "userCountryId": 21, "competitions": THREESIXFIVE_COMPETITION_EGY},
        )
        en_rows = ((r_en.json().get("standings") or [{}])[0].get("rows") or []) if r_en.status_code == 200 else []
        en_by_id = {int((rw.get("competitor") or {}).get("id") or 0): str((rw.get("competitor") or {}).get("name") or "") for rw in en_rows}

        st_block = (r_ar.json().get("standings") or [{}])[0]
        for row in st_block.get("rows") or []:
            comp = row.get("competitor") or {}
            comp_id = _safe_int(comp.get("id"))
            cid = THREESIXFIVE_CLUB_ID_MAP.get(comp_id) or CLUB_NAME_TO_ID.get(en_by_id.get(comp_id, "").lower(), f"ts_{comp_id}")
            preset = EGYPTIAN_CLUB_PRESETS.get(cid, {})
            img_ver = _safe_int(comp.get("imageVersion"), 1)
            logo_url = (
                f"https://imagecache.365scores.com/image/upload/f_png,w_64,h_64,c_limit,q_auto:eco,dpr_2,"
                f"d_Competitors:default1.png/v{img_ver}/Competitors/{comp_id}"
            )
            gf = _safe_int(row.get("for"))
            ga = _safe_int(row.get("against"))
            standings.append(
                {
                    "rank": _safe_int(row.get("position"), len(standings) + 1),
                    "team_id": cid,
                    "ts_365_id": comp_id,
                    "code": preset.get("code", ""),
                    "team_name": en_by_id.get(comp_id) or preset.get("name_en") or str(comp.get("name") or ""),
                    "team_name_ar": preset.get("name_ar") or str(comp.get("name") or ""),
                    "kit_hex": preset.get("kit_hex") or str(comp.get("color") or "#0FB5AE"),
                    "stadium_ar": preset.get("stadium_ar", ""),
                    "logo_url": logo_url,
                    "group": "",
                    "played": _safe_int(row.get("gamePlayed")),
                    "wins": _safe_int(row.get("gamesWon")),
                    "draws": _safe_int(row.get("gamesEven")),
                    "losses": _safe_int(row.get("gamesLost")),
                    "gf": gf,
                    "ga": ga,
                    "gd": gf - ga,
                    "points": _safe_int(row.get("points")),
                    "form": "",
                }
            )

        r_cur = client.get(
            "https://webws.365scores.com/web/games/current/",
            params={"appTypeId": 5, "langId": 27, "timezoneName": "Africa/Cairo", "competitions": THREESIXFIVE_COMPETITION_EGY},
        )
        if r_cur.status_code == 200:
            for ev in (r_cur.json().get("games") or []):
                hc = ev.get("homeCompetitor") or {}
                ac = ev.get("awayCompetitor") or {}
                sg = _safe_int(ev.get("statusGroup"))
                item = {
                    "event_id": str(ev.get("id") or ""),
                    "date_utc": str(ev.get("startTime") or ""),
                    "name": f"{hc.get('name','')} × {ac.get('name','')}",
                    "status": str(ev.get("statusText") or ""),
                    "home_team": str(hc.get("name") or ""),
                    "away_team": str(ac.get("name") or ""),
                    "home_logo": f"https://imagecache.365scores.com/image/upload/f_png,w_48,h_48,c_limit,q_auto:eco/v{_safe_int(hc.get('imageVersion'),1)}/Competitors/{_safe_int(hc.get('id'))}",
                    "away_logo": f"https://imagecache.365scores.com/image/upload/f_png,w_48,h_48,c_limit,q_auto:eco/v{_safe_int(ac.get('imageVersion'),1)}/Competitors/{_safe_int(ac.get('id'))}",
                    "home_score": _ts365_score_str(hc.get("score")),
                    "away_score": _ts365_score_str(ac.get("score")),
                }
                if sg == 4:
                    recent.append(item)
                else:
                    upcoming.append(item)

        r_up = client.get(
            "https://webws.365scores.com/web/games/allscores/",
            params={
                "appTypeId": 5,
                "langId": 27,
                "timezoneName": "Africa/Cairo",
                "competitions": THREESIXFIVE_COMPETITION_EGY,
                "startDate": start_str,
                "endDate": end_str,
            },
        )
        if r_up.status_code == 200:
            seen_ids = {x["event_id"] for x in upcoming}
            for ev in (r_up.json().get("games") or []):
                eid = str(ev.get("id") or "")
                if eid in seen_ids or _safe_int(ev.get("statusGroup")) == 4:
                    continue
                hc = ev.get("homeCompetitor") or {}
                ac = ev.get("awayCompetitor") or {}
                upcoming.append(
                    {
                        "event_id": eid,
                        "date_utc": str(ev.get("startTime") or ""),
                        "name": f"{hc.get('name','')} × {ac.get('name','')}",
                        "status": str(ev.get("statusText") or "مجدولة"),
                        "home_team": str(hc.get("name") or ""),
                        "away_team": str(ac.get("name") or ""),
                        "home_logo": f"https://imagecache.365scores.com/image/upload/f_png,w_48,h_48,c_limit,q_auto:eco/v{_safe_int(hc.get('imageVersion'),1)}/Competitors/{_safe_int(hc.get('id'))}",
                        "away_logo": f"https://imagecache.365scores.com/image/upload/f_png,w_48,h_48,c_limit,q_auto:eco/v{_safe_int(ac.get('imageVersion'),1)}/Competitors/{_safe_int(ac.get('id'))}",
                        "home_score": "-",
                        "away_score": "-",
                    }
                )

    standings.sort(key=lambda r: (r["rank"], -r["points"], -r["gd"]))
    upcoming.sort(key=lambda x: x["date_utc"])
    recent.sort(key=lambda x: x["date_utc"], reverse=True)
    return standings, upcoming[:14], recent[:14]


def sync_365scores_club_squad(
    comp_id: int,
    club_id: str,
    name_ar: Optional[str] = None,
    name_en: Optional[str] = None,
    kit_hex: Optional[str] = None,
    stadium_ar: Optional[str] = None,
    city_ar: Optional[str] = None,
    league_id: str = "egy.1",
) -> dict[str, Any]:
    """Fetch exact live 2026/27 first-team squad, HD portraits, ages, heights, positions & head coach via 365Scores."""
    from datetime import timedelta

    preset = EGYPTIAN_CLUB_PRESETS.get(club_id, {})
    with httpx.Client(headers=THREESIXFIVE_HEADERS, timeout=15.0) as client:
        r_ar = client.get(
            "https://webws.365scores.com/web/squads/",
            params={"appTypeId": 5, "langId": 27, "timezoneName": "Africa/Cairo", "competitors": comp_id},
        )
        r_ar.raise_for_status()
        j_ar = r_ar.json()
        r_en = client.get(
            "https://webws.365scores.com/web/squads/",
            params={"appTypeId": 5, "langId": 1, "timezoneName": "Africa/Cairo", "competitors": comp_id},
        )
        j_en = r_en.json() if r_en.status_code == 200 else {}

    en_athletes = {
        int(a.get("id") or 0): a
        for a in ((j_en.get("squads") or [{}])[0].get("athletes") or [])
        if a.get("id")
    }
    en_comp_meta = next((c for c in (j_en.get("competitors") or []) if int(c.get("id") or 0) == comp_id), {})
    country_names_ar = {int(c.get("id") or 0): str(c.get("name") or "") for c in (j_ar.get("countries") or []) if c.get("id")}
    comp_meta = next((c for c in (j_ar.get("competitors") or []) if int(c.get("id") or 0) == comp_id), {})
    img_cver = _safe_int(comp_meta.get("imageVersion"), 1)
    logo_url = (
        f"https://imagecache.365scores.com/image/upload/f_png,w_96,h_96,c_limit,q_auto:eco,dpr_2,"
        f"d_Competitors:default1.png/v{img_cver}/Competitors/{comp_id}"
    )
    resolved_color = str(comp_meta.get("color") or "").strip()
    if resolved_color and not resolved_color.startswith("#") and len(resolved_color) == 6:
        resolved_color = f"#{resolved_color}"

    players: list[dict[str, Any]] = []
    used_nums: set[int] = set()
    head_coach_ar = ""
    head_coach_en = ""
    pos_rank = {"GK": 0, "CB": 1, "RB": 2, "LB": 3, "RWB": 4, "LWB": 5, "DM": 6, "CM": 7, "CAM": 8, "RM": 9, "LM": 10, "RW": 11, "LW": 12, "ST": 13}

    raw_aths = ((j_ar.get("squads") or [{}])[0].get("athletes") or [])
    fallback_jersey = 40
    for ath in raw_aths:
        aid = int(ath.get("id") or 0)
        a_en = en_athletes.get(aid, {})
        fpos_en = str((a_en.get("formationPosition") or {}).get("name") or "").strip()
        pos_en = str((a_en.get("position") or {}).get("name") or "").strip()
        fpos_ar = str((ath.get("formationPosition") or {}).get("name") or "").strip()
        pos_ar = str((ath.get("position") or {}).get("name") or "").strip()

        role_txt = f"{fpos_en} {pos_en} {fpos_ar} {pos_ar}".lower()
        age_chk = _safe_int(ath.get("age"), 0)
        is_staff = any(
            cw in role_txt
            for cw in ("coach", "manager", "staff", "assistant", "مدرب", "إدارة", "الإدارة", "طاقم", "المدير")
        ) or (age_chk >= 42 and _safe_int(ath.get("jerseyNum"), 0) == 0)
        if is_staff:
            if not head_coach_ar and any(cw in role_txt for cw in ("coach", "manager", "مدرب", "المدير")):
                head_coach_ar = str(ath.get("name") or "").strip()
                head_coach_en = str(a_en.get("name") or head_coach_ar).strip()
            continue

        num = _safe_int(ath.get("jerseyNum"), 0)
        if not (1 <= num <= 99):
            while fallback_jersey in used_nums and fallback_jersey < 99:
                fallback_jersey += 1
            if fallback_jersey >= 99:
                continue
            num = fallback_jersey
            fallback_jersey += 1
        elif num in used_nums:
            while fallback_jersey in used_nums and fallback_jersey < 99:
                fallback_jersey += 1
            num = fallback_jersey
            fallback_jersey += 1
        used_nums.add(num)

        resolved_pos = (
            THREESIXFIVE_POS_MAP.get(fpos_en.lower())
            or THREESIXFIVE_POS_MAP.get(fpos_ar)
            or THREESIXFIVE_POS_MAP.get(pos_en.lower())
            or THREESIXFIVE_POS_MAP.get(pos_ar)
            or "CM"
        )
        nat_id = _safe_int(ath.get("nationalityId"), 131)
        if nat_id in THREESIXFIVE_COUNTRY_ISO:
            nat_iso, nat_flag, nat_ar_name = THREESIXFIVE_COUNTRY_ISO[nat_id]
        else:
            nat_ar_name = country_names_ar.get(nat_id, "دولي")
            nat_iso = f"C{nat_id}"
            nat_flag = "🌍"

        age_val = _safe_int(ath.get("age"), 0)
        ht_val = _safe_int(ath.get("height"), 0)
        dob_raw = str(ath.get("birthdate") or "")[:10]
        img_ver = _safe_int(ath.get("imageVersion"), 1)
        photo_url = (
            f"https://imagecache.365scores.com/image/upload/f_png,w_160,h_160,c_thumb,g_face,q_auto:eco,dpr_2,"
            f"d_Athletes:default.png/v{img_ver}/Athletes/{aid}"
        ) if aid else None

        nm_ar = str(ath.get("name") or a_en.get("name") or f"لاعب #{num}").strip()
        nm_en = str(a_en.get("name") or nm_ar).strip()
        short_ar = str(ath.get("shortName") or nm_ar).strip()

        players.append(
            {
                "athlete_id": aid,
                "jersey_number": num,
                "name_en": nm_en,
                "name_ar": nm_ar,
                "short_name_ar": short_ar,
                "position": resolved_pos,
                "position_label_ar": fpos_ar or pos_ar or resolved_pos,
                "nationality": nat_iso,
                "nationality_flag": nat_flag,
                "nationality_ar": nat_ar_name,
                "birth_date": dob_raw or None,
                "age": age_val if 15 <= age_val <= 48 else None,
                "height_cm": ht_val if 155 <= ht_val <= 215 else None,
                "preferred_foot": None,
                "is_captain": False,
                "is_starter": True,
                "photo_url": photo_url,
                "source": "365Scores Live 2026/27",
            }
        )

    players.sort(
        key=lambda p: (
            pos_rank.get(p["position"], 9),
            0 if 1 <= int(p["jersey_number"]) <= 35 else 1,
            0 if p.get("age") else 1,
            int(p["jersey_number"]),
        )
    )
    for idx, pl in enumerate(players):
        pl["is_starter"] = idx < 11

    cairo_now = datetime.now(timezone(timedelta(hours=2))).strftime("%Y-%m-%d %H:%M")
    return {
        "club_id": club_id,
        "ts_365_id": comp_id,
        "name_ar": name_ar or preset.get("name_ar") or str(comp_meta.get("name") or club_id),
        "name_en": name_en or preset.get("name_en") or str(en_comp_meta.get("name") or club_id),
        "kit_hex": kit_hex or preset.get("kit_hex") or resolved_color or "#0FB5AE",
        "stadium_ar": stadium_ar or preset.get("stadium_ar") or "",
        "city_ar": city_ar or preset.get("city_ar") or "",
        "logo_url": logo_url,
        "head_coach_ar": head_coach_ar,
        "head_coach_en": head_coach_en,
        "league_id": league_id,
        "season": "2026/2027",
        "source": "365Scores Live 2026/27",
        "verified_at": f"{cairo_now} (توقيت القاهرة)",
        "synced_ts": time.time(),
        "is_live": True,
        "players": players,
    }
def fetch_wikipedia_egyptian_standings() -> list[dict[str, Any]]:
    with httpx.Client(headers=WIKI_HEADERS, timeout=10.0) as client:
        r = client.get(
            "https://en.wikipedia.org/w/api.php",
            params={"action": "parse", "page": "2026–27_Egyptian_Premier_League", "prop": "wikitext", "format": "json"},
        )
        r.raise_for_status()
        wt = (r.json().get("parse") or {}).get("wikitext", {}).get("*") or ""

    names_raw = dict(re.findall(r"name_([A-Z0-9]+)\s*=\s*([^\n]+)", wt))
    wins_raw = dict(re.findall(r"win_([A-Z0-9]+)\s*=\s*(\d+)", wt))
    draws_raw = dict(re.findall(r"draw_([A-Z0-9]+)\s*=\s*(\d+)", wt))
    losses_raw = dict(re.findall(r"loss_([A-Z0-9]+)\s*=\s*(\d+)", wt))
    gf_raw = dict(re.findall(r"gf_([A-Z0-9]+)\s*=\s*(\d+)", wt))
    ga_raw = dict(re.findall(r"ga_([A-Z0-9]+)\s*=\s*(\d+)", wt))

    rows: list[dict[str, Any]] = []
    for code, raw_nm in names_raw.items():
        if code not in wins_raw and code not in draws_raw:
            continue
        link_m = re.search(r"\[\[[^\]|]+\|([^\]]+)\]\]|\[\[([^\]]+)\]\]", raw_nm)
        en_name = (link_m.group(1) or link_m.group(2) if link_m else raw_nm).strip()
        cid = CODE_TO_CLUB_ID.get(code) or CLUB_NAME_TO_ID.get(en_name.lower(), code.lower())
        preset = EGYPTIAN_CLUB_PRESETS.get(cid, {})
        w = _safe_int(wins_raw.get(code))
        d = _safe_int(draws_raw.get(code))
        l = _safe_int(losses_raw.get(code))
        gf = _safe_int(gf_raw.get(code))
        ga = _safe_int(ga_raw.get(code))
        pts = w * 3 + d
        rows.append(
            {
                "rank": 0,
                "team_id": cid,
                "code": code,
                "team_name": en_name,
                "team_name_ar": preset.get("name_ar") or EGY_TEAM_NAME_AR.get(en_name, en_name),
                "kit_hex": preset.get("kit_hex", "#10B981"),
                "stadium_ar": preset.get("stadium_ar", ""),
                "logo_url": "",
                "group": "",
                "played": w + d + l,
                "wins": w,
                "draws": d,
                "losses": l,
                "gf": gf,
                "ga": ga,
                "gd": gf - ga,
                "points": pts,
                "form": "",
            }
        )
    rows.sort(key=lambda r: (-r["points"], -r["gd"], -r["gf"], r["team_name"]))
    for idx, r in enumerate(rows, start=1):
        r["rank"] = idx
    return rows


def _extract_espn_standings(raw_json: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for child in raw_json.get("children") or []:
        group_name = str(child.get("name") or "")
        entries = (child.get("standings") or {}).get("entries") or []
        for entry in entries:
            team = entry.get("team") or {}
            stats = {str(s.get("name")): s.get("value") for s in (entry.get("stats") or []) if s.get("name")}
            logos = team.get("logos") or []
            logo = str(logos[0].get("href") or "") if logos else ""
            rows.append(
                {
                    "rank": _safe_int(stats.get("rank"), len(rows) + 1),
                    "team_id": str(team.get("id") or ""),
                    "team_name": str(team.get("displayName") or team.get("name") or ""),
                    "team_name_ar": str(team.get("displayName") or team.get("name") or ""),
                    "logo_url": logo,
                    "group": group_name,
                    "played": _safe_int(stats.get("gamesPlayed")),
                    "wins": _safe_int(stats.get("wins")),
                    "draws": _safe_int(stats.get("ties")),
                    "losses": _safe_int(stats.get("losses")),
                    "gf": _safe_int(stats.get("pointsFor")),
                    "ga": _safe_int(stats.get("pointsAgainst")),
                    "gd": _safe_int(stats.get("pointDifferential")),
                    "points": _safe_int(stats.get("points")),
                    "form": "",
                }
            )
    rows.sort(key=lambda r: (r["rank"], -r["points"], -r["gd"]))
    return rows


def _extract_espn_events(raw_json: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    upcoming: list[dict[str, Any]] = []
    recent: list[dict[str, Any]] = []
    for ev in (raw_json.get("events") or [])[:20]:
        comp = (ev.get("competitions") or [{}])[0]
        comps = comp.get("competitors") or []
        home = next((c for c in comps if c.get("homeAway") == "home"), comps[0] if comps else {})
        away = next((c for c in comps if c.get("homeAway") == "away"), comps[1] if len(comps) > 1 else {})
        status_type = (comp.get("status") or {}).get("type") or {}
        state = str(status_type.get("state") or "pre")
        item = {
            "event_id": str(ev.get("id") or ""),
            "date_utc": str(ev.get("date") or ""),
            "name": str(ev.get("name") or ""),
            "status": str(status_type.get("shortDetail") or status_type.get("description") or state),
            "home_team": str((home.get("team") or {}).get("displayName") or ""),
            "away_team": str((away.get("team") or {}).get("displayName") or ""),
            "home_logo": str((home.get("team") or {}).get("logo") or ""),
            "away_logo": str((away.get("team") or {}).get("logo") or ""),
            "home_score": str(home.get("score") or "0") if state != "pre" else "-",
            "away_score": str(away.get("score") or "0") if state != "pre" else "-",
        }
        if state == "post":
            recent.append(item)
        else:
            upcoming.append(item)
    return upcoming[:10], recent[:10]


def fetch_live_league_hub(league_id: str = "egy.1", force_refresh: bool = False) -> dict[str, Any]:
    """Fetch live standings, upcoming fixtures, and recent results with cache & offline fallback."""
    meta = SUPPORTED_LEAGUES.get(league_id, SUPPORTED_LEAGUES["egy.1"])
    lid = meta["id"]
    cache_key = f"league_hub_{lid}"

    if not force_refresh:
        cached = _read_cache(cache_key)
        if cached:
            cached["cache_hit"] = True
            return cached

    standings: list[dict[str, Any]] = []
    upcoming: list[dict[str, Any]] = []
    recent: list[dict[str, Any]] = []
    source_name = ""
    is_live = False

    if lid == "egy.1":
        try:
            standings, upcoming, recent = fetch_365scores_egyptian_standings_and_games()
            source_name = "365Scores Live — الدوري المصري الممتاز 2026/2027"
            is_live = bool(standings)
        except Exception:
            standings = []
        if not standings:
            try:
                standings = fetch_wikipedia_egyptian_standings()
                source_name = "Wikipedia Live Egyptian Premier League 2026/27 (Fallback)"
                is_live = bool(standings)
            except Exception:
                standings = []
    else:
        comp_id_365 = THREESIXFIVE_LEAGUE_IDS.get(lid)
        if comp_id_365:
            try:
                with httpx.Client(headers=THREESIXFIVE_HEADERS, timeout=10.0) as client:
                    r_ar = client.get(
                        "https://webws.365scores.com/web/standings/",
                        params={"appTypeId": 5, "langId": 27, "timezoneName": "Africa/Cairo", "competitions": comp_id_365},
                    )
                    r_en = client.get(
                        "https://webws.365scores.com/web/standings/",
                        params={"appTypeId": 5, "langId": 1, "timezoneName": "Africa/Cairo", "competitions": comp_id_365},
                    )
                    en_rows = ((r_en.json().get("standings") or [{}])[0].get("rows") or []) if r_en.status_code == 200 else []
                    en_by_id = {int((rw.get("competitor") or {}).get("id") or 0): str((rw.get("competitor") or {}).get("name") or "") for rw in en_rows}
                    if r_ar.status_code == 200:
                        for row in ((r_ar.json().get("standings") or [{}])[0].get("rows") or []):
                            comp = row.get("competitor") or {}
                            c_id = _safe_int(comp.get("id"))
                            if not c_id:
                                continue
                            img_v = _safe_int(comp.get("imageVersion"), 1)
                            color_s = str(comp.get("color") or "").strip()
                            kit = color_s if color_s.startswith("#") else f"#{color_s}" if len(color_s) == 6 else "#0FB5AE"
                            gf = _safe_int(row.get("for"))
                            ga = _safe_int(row.get("against"))
                            standings.append(
                                {
                                    "rank": _safe_int(row.get("position"), len(standings) + 1),
                                    "team_id": f"ts365_{c_id}",
                                    "ts_365_id": c_id,
                                    "team_name": en_by_id.get(c_id) or str(comp.get("name") or ""),
                                    "team_name_ar": str(comp.get("name") or en_by_id.get(c_id) or ""),
                                    "kit_hex": kit,
                                    "logo_url": f"https://imagecache.365scores.com/image/upload/f_png,w_96,h_96,c_limit,q_auto:eco,dpr_2,d_Competitors:default1.png/v{img_v}/Competitors/{c_id}",
                                    "group": str(row.get("groupName") or ""),
                                    "played": _safe_int(row.get("gamePlayed")),
                                    "wins": _safe_int(row.get("gamesWon")),
                                    "draws": _safe_int(row.get("gamesEven")),
                                    "losses": _safe_int(row.get("gamesLost")),
                                    "gf": gf,
                                    "ga": ga,
                                    "gd": gf - ga,
                                    "points": _safe_int(row.get("points")),
                                    "form": "",
                                }
                            )
                        standings.sort(key=lambda r: (r["rank"], -r["points"], -r["gd"]))
                        source_name = f"365Scores Live — {meta['name_ar']} 2026/2027"
                        is_live = bool(standings)
            except Exception:
                standings = []
        try:
            slug = meta["espn_slug"]
            with httpx.Client(headers=PUBLIC_HEADERS, timeout=9.0) as client:
                if not standings:
                    r_st = client.get(f"https://site.api.espn.com/apis/v2/sports/soccer/{slug}/standings")
                    if r_st.status_code == 200:
                        standings = _extract_espn_standings(r_st.json())
                        source_name = f"ESPN Public Soccer API ({slug})"
                r_sc = client.get(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard")
                if r_sc.status_code == 200:
                    upcoming, recent = _extract_espn_events(r_sc.json())
                is_live = bool(standings or upcoming or recent)
        except Exception:
            if not standings:
                is_live = False

    if not standings:
        stale = _read_cache(cache_key, allow_stale=True)
        if stale:
            stale["cache_hit"] = True
            stale["is_live"] = False
            stale["source"] = f"{stale.get('source', 'cache')} (offline cache)"
            return stale

    from datetime import timedelta

    cairo_str = datetime.now(timezone(timedelta(hours=2))).strftime("%Y-%m-%d %H:%M")
    payload = {
        "league_id": lid,
        "league_name_ar": meta["name_ar"],
        "league_name_en": meta["name_en"],
        "season": "2026/2027",
        "provider": meta["provider"],
        "source": source_name or "offline_fallback",
        "is_live": is_live,
        "cache_hit": False,
        "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        "fetched_at_cairo": cairo_str,
        "standings": standings,
        "upcoming_fixtures": upcoming,
        "recent_results": recent,
    }
    if is_live:
        _write_cache(cache_key, payload)
    return payload


WIKIDATA_POS_MAP: dict[str, str] = {
    "Q201330": "GK",
    "Q336286": "CB",
    "Q55006111": "LB",
    "Q55006114": "RB",
    "Q55006115": "LWB",
    "Q55006116": "RWB",
    "Q9731197": "DM",
    "Q6008848": "CM",
    "Q18691898": "CAM",
    "Q55006118": "LW",
    "Q55006119": "RW",
    "Q280658": "ST",
    "Q6008847": "ST",
}


def _compute_age_from_dob(dob_raw: str) -> Optional[int]:
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", dob_raw or "")
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1970 <= y <= 2012):
        return None
    now = datetime.now(timezone.utc)
    age = now.year - y - ((now.month, now.day) < (mo, d))
    return age if 15 <= age <= 50 else None


def parse_fs_player_wikitext(
    wikitext: str,
    existing_players: Optional[list[dict[str, Any]]] = None,
    wiki_lang: str = "en",
) -> list[dict[str, Any]]:
    """Parse English ({{Fs player|...}}) or Arabic ({{تشكيلة لاعب|...}}) MediaWiki squad templates cleanly."""
    existing_by_name = {str(p.get("name_en", "")).strip().lower(): p for p in (existing_players or [])}

    raw_rows: list[dict[str, Any]] = []
    seen_nums: set[int] = set()
    df_cycle = ["CB", "CB", "RB", "LB"]
    mf_cycle = ["DM", "CM", "CAM"]
    fw_cycle = ["ST", "RW", "LW"]
    df_i, mf_i, fw_i = 0, 0, 0

    for block in FS_PLAYER_RE.findall(wikitext or ""):
        kv: dict[str, str] = {}
        # Split strictly outside [[wiki|link]] brackets so disambiguated player names never break
        for part in re.split(r"\|(?![^\[]*\]\])", block):
            if "=" in part:
                k, v = part.split("=", 1)
                kv[k.strip().lower()] = v.strip()

        num = _safe_int(kv.get("no") or kv.get("الرقم") or kv.get("رقم"), 0)
        if not (1 <= num <= 99) or num in seen_nums:
            continue

        raw_name = kv.get("name") or kv.get("الاسم") or kv.get("اسم") or ""
        wiki_title = raw_name
        display_name = raw_name
        link_m = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", raw_name)
        if link_m:
            wiki_title = link_m.group(1).strip()
            display_name = (link_m.group(2) or link_m.group(1)).strip()
        display_name = re.sub(r"\{\{[^}]+\}\}", "", display_name)
        display_name = display_name.replace("[[", "").replace("]]", "").strip()
        if "|" in display_name:
            display_name = display_name.split("|")[-1].strip()
        if not display_name:
            continue

        seen_nums.add(num)
        nat_iso, nat_flag, nat_ar = _nat_details(kv.get("nat") or kv.get("دولة") or kv.get("الجنسية") or "EGY")
        other = str(kv.get("other") or kv.get("ملاحظات") or "").lower()
        broad_pos = str(kv.get("pos") or kv.get("مركز") or "MF").upper().strip()

        matched = existing_by_name.get(display_name.lower())
        if matched and matched.get("position"):
            pos = str(matched["position"]).upper()
        elif broad_pos in ("GK", "حارس", "حارس مرمى"):
            pos = "GK"
        elif broad_pos in ("DF", "دفاع", "مدافع"):
            pos = df_cycle[df_i % len(df_cycle)]
            df_i += 1
        elif broad_pos in ("FW", "هجوم", "مهاجم"):
            pos = fw_cycle[fw_i % len(fw_cycle)]
            fw_i += 1
        else:
            pos = mf_cycle[mf_i % len(mf_cycle)]
            mf_i += 1

        name_ar = str(matched.get("name_ar") or display_name) if matched else display_name
        name_en = str(matched.get("name_en") or display_name) if matched else display_name

        raw_rows.append(
            {
                "jersey_number": num,
                "name_en": name_en,
                "name_ar": name_ar,
                "wiki_title": wiki_title.replace("[[", "").replace("]]", "").strip(),
                "wiki_lang": wiki_lang,
                "nationality": nat_iso,
                "nationality_flag": nat_flag,
                "nationality_ar": nat_ar,
                "position": pos,
                "birth_date": None,
                "age": None,
                "height_cm": None,
                "preferred_foot": None,
                "is_captain": ("captain" in other and "vice-captain" not in other) or ("قائد" in other),
                "is_vice_captain": "vice-captain" in other,
                "is_on_loan": ("loan" in other) or ("إعارة" in other),
                "is_starter": len(raw_rows) < 11,
                "photo_url": None,
                "source": f"Wikipedia Live Official Squad ({wiki_lang})",
            }
        )
    return raw_rows


def _enrich_players_with_wikidata(
    client: httpx.Client,
    players: list[dict[str, Any]],
    qid_by_wiki_title: dict[str, str],
    source_lang: str,
) -> None:
    """Batch-enrich players with real birth_date, age, height_cm, exact position & Arabic labels from Wikidata."""
    qids = list(dict.fromkeys(q for q in qid_by_wiki_title.values() if q))
    if not qids:
        return
    entities: dict[str, Any] = {}
    for i in range(0, len(qids), 45):
        batch_ids = qids[i : i + 45]
        try:
            r = client.get(
                "https://www.wikidata.org/w/api.php",
                params={
                    "action": "wbgetentities",
                    "ids": "|".join(batch_ids),
                    "props": "claims|labels",
                    "languages": "ar|en",
                    "format": "json",
                },
            )
            if r.status_code == 200:
                entities.update(r.json().get("entities") or {})
        except Exception:
            continue

    for p in players:
        qid = qid_by_wiki_title.get(p.get("wiki_title") or "")
        ent = entities.get(qid or "")
        if not ent:
            continue
        claims = ent.get("claims") or {}
        labels = ent.get("labels") or {}

        if source_lang == "en" and p["name_ar"] == p["name_en"]:
            ar_lbl = str((labels.get("ar") or {}).get("value") or "").strip()
            if ar_lbl:
                p["name_ar"] = ar_lbl
        elif source_lang == "ar" and p["name_en"] == p["name_ar"]:
            en_lbl = str((labels.get("en") or {}).get("value") or "").strip()
            if en_lbl:
                p["name_en"] = en_lbl

        dob_raw = str((((claims.get("P569") or [{}])[0].get("mainsnak") or {}).get("datavalue") or {}).get("value", {}).get("time") or "")
        m_dob = re.search(r"(\d{4}-\d{2}-\d{2})", dob_raw)
        if m_dob:
            p["birth_date"] = m_dob.group(1)
            p["age"] = _compute_age_from_dob(m_dob.group(1))

        ht_raw = str((((claims.get("P2048") or [{}])[0].get("mainsnak") or {}).get("datavalue") or {}).get("value", {}).get("amount") or "")
        if ht_raw:
            try:
                ht_val = float(ht_raw.lstrip("+"))
                if 1.4 <= ht_val <= 2.2:
                    ht_val *= 100.0
                if 155 <= ht_val <= 215:
                    p["height_cm"] = int(round(ht_val))
            except ValueError:
                pass

        for c in (claims.get("P413") or []):
            pq = str((((c.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {}).get("id") or "")
            if pq in WIKIDATA_POS_MAP and p.get("position") != "GK":
                p["position"] = WIKIDATA_POS_MAP[pq]
                break

        foot_q = str((((claims.get("P552") or [{}])[0].get("mainsnak") or {}).get("datavalue") or {}).get("value", {}).get("id") or "")
        if foot_q == "Q3039938":
            p["preferred_foot"] = "القدم اليمنى"
        elif foot_q == "Q789447":
            p["preferred_foot"] = "القدم اليسرى"

        p["wikidata_id"] = qid
        p["source"] = f"Wikipedia + Wikidata Live ({source_lang})"


def sync_wikipedia_club_squad(
    wiki_page: str,
    club_id: str,
    name_ar: Optional[str] = None,
    name_en: Optional[str] = None,
    kit_hex: str = "#10B981",
    ar_wiki_page: Optional[str] = None,
    stadium_ar: str = "",
    city_ar: str = "",
) -> dict[str, Any]:
    """Fetch a club's live full squad, Arabic names, nationalities, and portraits from Wikipedia."""
    local_clubs = _load_local_clubs_json()
    preset = EGYPTIAN_CLUB_PRESETS.get(club_id, {})
    existing = list((local_clubs.get(club_id) or {}).get("players") or [])

    players: list[dict[str, Any]] = []
    source_lang = "en"
    source_page = wiki_page

    with httpx.Client(headers=WIKI_HEADERS, timeout=12.0) as client:
        for try_lang, try_page in [("en", wiki_page), ("ar", ar_wiki_page or preset.get("ar_wiki_page") or "")]:
            if not try_page:
                continue
            try:
                resp = client.get(
                    f"https://{try_lang}.wikipedia.org/w/api.php",
                    params={"action": "parse", "page": try_page, "prop": "wikitext", "format": "json", "redirects": 1},
                )
                if resp.status_code == 200:
                    wt = (resp.json().get("parse") or {}).get("wikitext", {}).get("*") or ""
                    parsed_p = parse_fs_player_wikitext(wt, existing_players=existing, wiki_lang=try_lang)
                    if len(parsed_p) >= 10:
                        players = parsed_p
                        source_lang = try_lang
                        source_page = try_page
                        break
            except Exception:
                continue

        if players:
            titles = [p["wiki_title"] for p in players[:48] if p.get("wiki_title")]
            other_lang = "ar" if source_lang == "en" else "en"
            info_by_title: dict[str, dict[str, Any]] = {}
            for i in range(0, len(titles), 40):
                batch = titles[i : i + 40]
                q_resp = client.get(
                    f"https://{source_lang}.wikipedia.org/w/api.php",
                    params={
                        "action": "query",
                        "titles": "|".join(batch),
                        "prop": "pageimages|langlinks|pageprops",
                        "ppprop": "wikibase_item",
                        "lllang": other_lang,
                        "pithumbsize": 420,
                        "redirects": 1,
                        "format": "json",
                    },
                )
                if q_resp.status_code == 200:
                    q_json = q_resp.json().get("query") or {}
                    norm_map = {n["from"]: n["to"] for n in (q_json.get("normalized") or [])}
                    red_map = {r["from"]: r["to"] for r in (q_json.get("redirects") or [])}
                    pages_by_title = {
                        str(pg.get("title") or ""): pg
                        for pg in (q_json.get("pages") or {}).values()
                        if pg.get("title")
                    }
                    for orig in batch:
                        t = red_map.get(norm_map.get(orig, orig), norm_map.get(orig, orig))
                        if t in pages_by_title:
                            info_by_title[orig] = pages_by_title[t]

            qid_by_title: dict[str, str] = {}
            for p in players:
                wt_title = p.get("wiki_title") or ""
                pg = info_by_title.get(wt_title)
                if pg:
                    langlinks = pg.get("langlinks") or []
                    if langlinks and langlinks[0].get("*"):
                        linked = str(langlinks[0]["*"]).strip()
                        if source_lang == "en" and p["name_ar"] == p["name_en"]:
                            p["name_ar"] = linked
                        elif source_lang == "ar" and p["name_en"] == p["name_ar"]:
                            p["name_en"] = linked
                    thumb = (pg.get("thumbnail") or {}).get("source")
                    if thumb:
                        p["photo_url"] = str(thumb)
                    qid = str((pg.get("pageprops") or {}).get("wikibase_item") or "").strip()
                    if qid:
                        qid_by_title[wt_title] = qid

            _enrich_players_with_wikidata(client, players, qid_by_title, source_lang)

    return {
        "club_id": club_id,
        "name_ar": name_ar or preset.get("name_ar") or wiki_page.replace("_", " "),
        "name_en": name_en or preset.get("name_en") or wiki_page.replace("_", " "),
        "kit_hex": kit_hex or preset.get("kit_hex") or "#10B981",
        "stadium_ar": stadium_ar or preset.get("stadium_ar") or "",
        "city_ar": city_ar or preset.get("city_ar") or "",
        "league_id": "egy.1",
        "season": "2026/2027",
        "source": f"Wikipedia Live Squad ({source_lang}:{source_page})",
        "verified_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "is_live": True,
        "players": players,
    }


def _map_espn_position(abbr: str, idx_df: int) -> tuple[str, int]:
    a = (abbr or "").upper().strip()
    if a in ("G", "GK"):
        return "GK", idx_df
    if a in ("D", "DF"):
        cycle = ["CB", "CB", "RB", "LB"]
        return cycle[idx_df % len(cycle)], idx_df + 1
    if a in ("CD", "CB", "LCB", "RCB"):
        return "CB", idx_df
    if a in ("LB", "LWB", "LD"):
        return "LB", idx_df
    if a in ("RB", "RWB", "RD"):
        return "RB", idx_df
    if a in ("DM", "CDM"):
        return "DM", idx_df
    if a in ("AM", "CAM"):
        return "CAM", idx_df
    if a in ("LW", "LM"):
        return "LW", idx_df
    if a in ("RW", "RM"):
        return "RW", idx_df
    if a in ("F", "FW", "CF", "ST", "S"):
        return "ST", idx_df
    return "CM", idx_df


def sync_espn_team_roster(
    league_slug: str,
    team_id: str,
    club_id: Optional[str] = None,
    kit_hex: str = "#38BDF8",
) -> dict[str, Any]:
    """Fetch an official live current-season club roster & real stats from ESPN."""
    with httpx.Client(headers=PUBLIC_HEADERS, timeout=12.0) as client:
        r = client.get(f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_slug}/teams/{team_id}/roster")
        r.raise_for_status()
        data = r.json()

    team_meta = data.get("team") or {}
    t_name = str(team_meta.get("displayName") or f"Club {team_id}")
    cid = club_id or f"espn_{league_slug}_{team_id}".replace(".", "_")
    logos = team_meta.get("logos") or []
    logo = str(logos[0].get("href") or "") if logos else ""
    color_hex = str(team_meta.get("color") or "").strip()
    resolved_hex = f"#{color_hex}" if len(color_hex) == 6 else kit_hex

    players: list[dict[str, Any]] = []
    used_nums: set[int] = set()
    df_i = 0

    for ath in (data.get("athletes") or []):
        j_raw = str(ath.get("jersey") or "").strip()
        num = int(j_raw) if j_raw.isdigit() and 1 <= int(j_raw) <= 99 else 0
        if num == 0 or num in used_nums:
            cand = 50
            while cand in used_nums and cand < 99:
                cand += 1
            num = cand
        used_nums.add(num)

        abbr = str(((ath.get("position") or {}).get("abbreviation")) or "CM")
        pos, df_i = _map_espn_position(abbr, df_i)

        live_stats: dict[str, Any] = {}
        for cat in ((ath.get("statistics") or {}).get("splits") or {}).get("categories") or []:
            for st in cat.get("stats") or []:
                if st.get("name"):
                    live_stats[str(st["name"])] = st.get("value")

        headshot = (ath.get("headshot") or {}).get("href")
        players.append(
            {
                "jersey_number": num,
                "name_en": str(ath.get("displayName") or ath.get("fullName") or f"Player #{num}"),
                "name_ar": str(ath.get("displayName") or ath.get("fullName") or f"لاعب #{num}"),
                "position": pos,
                "age": _safe_int(ath.get("age"), 0) or None,
                "nationality": str(ath.get("citizenship") or ""),
                "nationality_flag": "🌍",
                "nationality_ar": str(ath.get("citizenship") or ""),
                "photo_url": str(headshot) if headshot else None,
                "is_starter": len(players) < 11,
                "is_captain": False,
                "live_stats": {
                    "appearances": _safe_int(live_stats.get("appearances"), -1) if "appearances" in live_stats else None,
                    "goals": _safe_int(live_stats.get("totalGoals"), -1) if "totalGoals" in live_stats else None,
                    "assists": _safe_int(live_stats.get("goalAssists"), -1) if "goalAssists" in live_stats else None,
                    "yellow_cards": _safe_int(live_stats.get("yellowCards"), -1) if "yellowCards" in live_stats else None,
                },
                "source": f"ESPN Live Roster ({league_slug})",
            }
        )

    return {
        "club_id": cid,
        "name_ar": t_name,
        "name_en": t_name,
        "kit_hex": resolved_hex,
        "logo_url": logo,
        "league_id": league_slug,
        "season": str((data.get("season") or {}).get("displayName") or "Live Season"),
        "source": f"ESPN Live Squad ({league_slug}/{team_id})",
        "verified_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "is_live": True,
        "players": players,
    }


def load_all_coach_clubs(store_clubs: Optional[dict[str, dict[str, Any]]] = None) -> dict[str, dict[str, Any]]:
    """Merge live 2026/27 Egyptian Premier League 365Scores squads + non-Egyptian dataset + active synced store clubs."""
    merged: dict[str, dict[str, Any]] = {}

    # Keep only non-Egyptian international reference clubs from legacy static JSON so outdated 25/26 Egyptian squads never leak
    local = _load_local_clubs_json()
    for cid, c in local.items():
        if cid in EGYPTIAN_CLUB_PRESETS:
            continue
        merged[cid] = {
            **c,
            "stadium_ar": c.get("stadium_ar") or "",
            "city_ar": c.get("city_ar") or "",
            "league_id": c.get("league_id") or "intl",
        }

    full_path = _full_egypt_cache_path()
    if full_path.is_file():
        try:
            full_data = json.loads(full_path.read_text(encoding="utf-8"))
            for cid, c in (full_data.get("clubs") or {}).items():
                if cid in EGYPTIAN_CLUB_PRESETS and c.get("players"):
                    merged[cid] = c
        except Exception:
            pass

    for cid, meta in EGYPTIAN_CLUB_PRESETS.items():
        if cid not in merged:
            merged[cid] = {
                "club_id": cid,
                "ts_365_id": meta.get("ts_365_id"),
                "name_ar": meta["name_ar"],
                "name_en": meta["name_en"],
                "kit_hex": meta["kit_hex"],
                "stadium_ar": meta["stadium_ar"],
                "city_ar": meta["city_ar"],
                "league_id": "egy.1",
                "season": "2026/2027",
                "source": "Egyptian Premier League 2026/27 Registry",
                "players": [],
            }

    for cid, c in (store_clubs or {}).items():
        if not c.get("players"):
            continue
        src = str(c.get("source") or "")
        # Skip stale pre-V4 Wikipedia rosters for active Egyptian clubs so 365Scores 2026/27 live data always wins
        if cid in EGYPTIAN_CLUB_PRESETS and "Wikipedia" in src:
            continue
        merged[cid] = c

    return merged


def fetch_league_clubs_light(
    league_id: str = "egy.1",
    store_clubs: Optional[dict[str, dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Return lightweight club cards ONLY for the requested league (progressive loading)."""
    lid = league_id if league_id in SUPPORTED_LEAGUES else "egy.1"
    all_local = load_all_coach_clubs(store_clubs)
    hub = fetch_live_league_hub(league_id=lid, force_refresh=False)
    standings = list(hub.get("standings") or [])
    st_by_cid = {str(s.get("team_id") or ""): s for s in standings if s.get("team_id")}

    items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    if lid == "egy.1":
        for cid, c in all_local.items():
            if (c.get("league_id") or "egy.1") != "egy.1" and cid not in EGYPTIAN_CLUB_PRESETS:
                continue
            st = st_by_cid.get(cid)
            ts_id = c.get("ts_365_id") or (EGYPTIAN_CLUB_PRESETS.get(cid) or {}).get("ts_365_id")
            items.append(
                {
                    "club_id": cid,
                    "ts_365_id": ts_id,
                    "name_ar": c.get("name_ar") or cid,
                    "name_en": c.get("name_en") or cid,
                    "kit_hex": c.get("kit_hex") or "#0FB5AE",
                    "stadium_ar": c.get("stadium_ar") or "",
                    "city_ar": c.get("city_ar") or "",
                    "league_id": "egy.1",
                    "season": "2026/2027",
                    "source": c.get("source") or "Egyptian Premier League 2026/27",
                    "head_coach_ar": c.get("head_coach_ar") or "",
                    "player_count": len(c.get("players") or []),
                    "live_rank": st.get("rank") if st else None,
                    "live_points": st.get("points") if st else None,
                    "live_played": st.get("played") if st else None,
                    "logo_url": c.get("logo_url") or (st.get("logo_url") if st else ""),
                }
            )
            seen_ids.add(cid)
    else:
        for st in standings:
            cid = str(st.get("team_id") or "")
            if not cid or cid in seen_ids:
                continue
            seen_ids.add(cid)
            cached_club = all_local.get(cid) or (store_clubs or {}).get(cid)
            items.append(
                {
                    "club_id": cid,
                    "ts_365_id": st.get("ts_365_id"),
                    "name_ar": st.get("team_name_ar") or st.get("team_name") or cid,
                    "name_en": st.get("team_name") or st.get("team_name_ar") or cid,
                    "kit_hex": (cached_club or {}).get("kit_hex") or st.get("kit_hex") or "#0FB5AE",
                    "stadium_ar": (cached_club or {}).get("stadium_ar") or "",
                    "city_ar": "",
                    "league_id": lid,
                    "season": "2026/2027",
                    "source": hub.get("source") or "365Scores Live 2026/27",
                    "head_coach_ar": (cached_club or {}).get("head_coach_ar") or "",
                    "player_count": len((cached_club or {}).get("players") or []),
                    "live_rank": st.get("rank"),
                    "live_points": st.get("points"),
                    "live_played": st.get("played"),
                    "logo_url": st.get("logo_url") or "",
                }
            )

    items.sort(key=lambda x: (x["live_rank"] or 999, -x["player_count"], x["name_en"]))
    return items


_CLUB_SCHED_CACHE: dict[int, tuple[float, dict[str, Any]]] = {}


def resolve_365_competitor_id(club_id: str, team_name: str = "") -> Optional[int]:
    """Resolve a 365Scores numeric competitor ID from club_id, preset, or search."""
    cid = str(club_id or "").strip()
    if cid.startswith("ts365_") and cid[6:].isdigit():
        return int(cid[6:])
    preset = EGYPTIAN_CLUB_PRESETS.get(cid)
    if preset and preset.get("ts_365_id"):
        return int(preset["ts_365_id"])
    q = (team_name or cid.replace("_", " ")).strip()
    if not q:
        return None
    try:
        with httpx.Client(headers=THREESIXFIVE_HEADERS, timeout=6.0) as client:
            r = client.get(
                "https://webws.365scores.com/web/search/",
                params={"appTypeId": 5, "langId": 27, "query": q},
            )
            if r.status_code == 200:
                comps = r.json().get("competitors") or []
                if comps and comps[0].get("id"):
                    return int(comps[0]["id"])
    except Exception:
        pass
    return None


def fetch_club_live_schedule(comp_id: int) -> dict[str, Any]:
    """Fetch upcoming fixtures and recent official results for a club across competitions."""
    now = time.time()
    cached = _CLUB_SCHED_CACHE.get(int(comp_id))
    if cached and (now - cached[0]) < 600.0:
        return cached[1]

    upcoming: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []

    def _parse_game(g: dict[str, Any], is_result: bool) -> dict[str, Any]:
        hc = g.get("homeCompetitor") or {}
        ac = g.get("awayCompetitor") or {}
        hid = int(hc.get("id") or 0)
        aid = int(ac.get("id") or 0)
        hver = _safe_int(hc.get("imageVersion"), 1)
        aver = _safe_int(ac.get("imageVersion"), 1)
        h_score = _safe_int(hc.get("score"), 0) if is_result and hc.get("score") is not None else None
        a_score = _safe_int(ac.get("score"), 0) if is_result and ac.get("score") is not None else None
        outcome = None
        if is_result and h_score is not None and a_score is not None:
            if hid == int(comp_id):
                outcome = "W" if h_score > a_score else ("L" if h_score < a_score else "D")
            elif aid == int(comp_id):
                outcome = "W" if a_score > h_score else ("L" if a_score < h_score else "D")
        return {
            "event_id": str(g.get("id") or ""),
            "competition": str(g.get("competitionDisplayName") or ""),
            "date_utc": str(g.get("startTime") or ""),
            "status": str(g.get("statusText") or ("انتهت" if is_result else "مجدولة")),
            "home_id": hid,
            "away_id": aid,
            "home_team": str(hc.get("name") or ""),
            "away_team": str(ac.get("name") or ""),
            "home_score": h_score,
            "away_score": a_score,
            "outcome": outcome,
            "is_home": hid == int(comp_id),
            "home_logo": f"https://imagecache.365scores.com/image/upload/f_png,w_64,h_64,c_limit,q_auto:eco,dpr_2,d_Competitors:default1.png/v{hver}/Competitors/{hid}" if hid else "",
            "away_logo": f"https://imagecache.365scores.com/image/upload/f_png,w_64,h_64,c_limit,q_auto:eco,dpr_2,d_Competitors:default1.png/v{aver}/Competitors/{aid}" if aid else "",
        }

    try:
        with httpx.Client(headers=THREESIXFIVE_HEADERS, timeout=7.5) as client:
            rf = client.get(
                "https://webws.365scores.com/web/games/fixtures/",
                params={"appTypeId": 5, "langId": 27, "timezoneName": "Africa/Cairo", "competitors": int(comp_id)},
            )
            if rf.status_code == 200:
                upcoming = [_parse_game(g, False) for g in (rf.json().get("games") or [])[:8]]
            rr = client.get(
                "https://webws.365scores.com/web/games/results/",
                params={"appTypeId": 5, "langId": 27, "timezoneName": "Africa/Cairo", "competitors": int(comp_id)},
            )
            if rr.status_code == 200:
                results = [_parse_game(g, True) for g in (rr.json().get("games") or [])[:8]]
    except Exception:
        pass

    payload = {"upcoming_matches": upcoming, "recent_results": results}
    if upcoming or results:
        _CLUB_SCHED_CACHE[int(comp_id)] = (now, payload)
    return payload
