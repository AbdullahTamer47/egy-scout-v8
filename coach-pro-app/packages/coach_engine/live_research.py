"""Grounded Live Player & Club Research Engine (365Scores 2026/27 + Active Squad Matching).

Executes BEFORE AI generation so tactical deployment / role / strength-weakness answers
are strictly anchored to real live 2026/27 profiles, positions, physicals, and stats.
"""
from __future__ import annotations

import re
import time
from typing import Any, Optional

import httpx

THREESIXFIVE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

_RESEARCH_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_S = 900.0

_STRIP_WORDS = {
    "ايه", "ما", "هو", "هي", "توظيف", "توضيف", "مركز", "مراكز", "لاعب", "اللاعب",
    "احطه", "أحطه", "فين", "العب", "العبه", "الالعبه", "يلعب", "بيها", "مميزات", "عيوب",
    "ومميزاته", "وعيوبه", "نقاط", "قوة", "ضعف", "حلل", "تحليل", "دور", "اداء", "أداء",
    "احصائيات", "إحصائيات", "بيانات", "معلومات", "عن", "في", "من", "الى", "إلى", "على",
    "بتاع", "نادي", "فريق", "الاهلي", "الأهلي", "الزمالك", "بيراميدز", "تشكيل", "خطة",
    "التدريب", "تدريب", "تطوير", "أحمال", "احمال", "يعني", "بالتفصيل", "لايف", "مباشر",
    "مركزه", "ومراكزه", "واحطه", "الاعبه", "توظيفه", "دوره", "مكانه", "ارقامه", "أرقامه",
    "احصائياته", "بياناته", "قدراته", "تقييمه", "وايه", "اللي", "فيها", "معاه", "عليه",
    "شوف", "قولي", "قول", "لي", "عايز", "اعرف", "هتلاعبه", "تلاعبه", "العبها",
    "what", "is", "the", "role", "position", "deploy", "deployment", "for", "of", "player",
    "analyze", "analysis", "strengths", "weaknesses", "about", "how", "to", "use", "stats",
    "his", "him", "he", "where", "play",
}

_POS_TO_CODE = {
    "حارس مرمى": "GK",
    "goalkeeper": "GK",
    "قلب دفاع": "CB",
    "centre back": "CB",
    "center back": "CB",
    "defender": "CB",
    "ظهير أيمن": "RB",
    "right back": "RB",
    "ظهير أيسر": "LB",
    "left back": "LB",
    "جناح خلفي أيمن": "RWB",
    "right wing back": "RWB",
    "جناح خلفي أيسر": "LWB",
    "left wing back": "LWB",
    "وسط دفاعي": "DM",
    "لاعب ارتكاز": "DM",
    "defensive midfield": "DM",
    "وسط محوري": "CM",
    "لاعب وسط": "CM",
    "central midfield": "CM",
    "لاعب الوسط المهاجم": "CAM",
    "وسط هجومي": "CAM",
    "صانع ألعاب": "CAM",
    "attacking midfield": "CAM",
    "جناح أيمن": "RW",
    "مهاجم أيمن": "RW",
    "right winger": "RW",
    "right forward": "RW",
    "جناح أيسر": "LW",
    "مهاجم أيسر": "LW",
    "left winger": "LW",
    "left forward": "LW",
    "مهاجم صريح": "ST",
    "رأس حربة": "ST",
    "centre forward": "ST",
    "striker": "ST",
    "forward": "ST",
}

_TACTICAL_ROLES_BY_POS: dict[str, dict[str, Any]] = {
    "GK": {
        "best_roles_ar": ["حارس مرمى أساسي", "حارس بناء لعب (Sweeper Keeper)"],
        "fit_3421": "نقطة ارتكاز أولى في الخروج بالكرة بين الثلاثي الخلفي وتغطية المساحة خلف خط الدفاع المتقدم",
        "fit_4231": "التدرج بالكرة نحو الأظهرة والمحور، مع توجيه خط الدفاع في الكرات الثابتة",
    },
    "CB": {
        "best_roles_ar": ["قلب دفاع (CB)", "مدافع طرف في ثلاثي الدفاع (RCB/LCB)"],
        "fit_3421": "قلب الدفاع الأيمن/الأيسر في الثلاثي الخلفي لتغطية ظهر الظهير الطائر وكسر التدرج بالتمريرات القطرية",
        "fit_4231": "التمركز في قلب الدفاع مع المراقبة الفردية وتأمين التحول الدفاعي",
    },
    "RB": {
        "best_roles_ar": ["ظهير أيمن (RB)", "ظهير طائر/وسط أيمن (RWB/RM)", "قلب دفاع أيمن عند التدوير"],
        "fit_3421": "مثالي كـ **ظهير وسط أيمن (RWB/RM)** يغطي الرواق الأيمن بالكامل هجوماً بعرضيات أو اختراقاً بالمساحة النصفية، ويدافع كظهير رابع/خامس عند فقدان الكرة",
        "fit_4231": "ظهير أيمن متوازن: إغلاق الجبهة اليمنى دفاعياً، والمشاركة في التفوق العددي 2v1 على الخط مع الجناح الأيمن",
    },
    "LB": {
        "best_roles_ar": ["ظهير أيسر (LB)", "ظهير طائر/وسط أيسر (LWB/LM)", "قلب دفاع أيسر في ثلاثي"],
        "fit_3421": "مثالي كـ **ظهير وسط أيسر (LWB/LM)** يوفر العرض الهجومي الكامل ويفتح زوايا التمرير للارتكاز وصانع اللعب الأيسر",
        "fit_4231": "ظهير أيسر متقدم لتوسيع الملعب مع تغطية عكسية من المحور",
    },
    "RWB": {
        "best_roles_ar": ["ظهير طائر أيمن (RWB)", "ظهير أيمن (RB)", "جناح أيمن تقليدي (RM)"],
        "fit_3421": "المركز التخصصي المباشر على الخط الأيمن مع تكليفات صعود وهبوط مستمرة عبر الرواق",
        "fit_4231": "ظهير أيمن هجومي أو جناح أيمن في التحولات",
    },
    "LWB": {
        "best_roles_ar": ["ظهير طائر أيسر (LWB)", "ظهير أيسر (LB)", "جناح أيسر تقليدي (LM)"],
        "fit_3421": "المركز التخصصي المباشر على الخط الأيسر لتثبيت ظهير الخصم وخلق زيادات عددية",
        "fit_4231": "ظهير أيسر هجومي أو جناح أيسر في التحولات",
    },
    "DM": {
        "best_roles_ar": ["محور ارتكاز دفاعي (#6 DM)", "وسط محوري مزدوج (Double Pivot #8)"],
        "fit_3421": "أحد ثنائي الارتكاز لتأمين المساحات خلف الأجنحة الطائرة وتوزيع اللعب للممرين النصفيين",
        "fit_4231": "الارتكاز الدفاعي الرئيسي لقراءة التحولات وقطع خطوط التمرير للعمق",
    },
    "CM": {
        "best_roles_ar": ["وسط محوري (Box-to-Box #8 CM)", "ارتكاز مساند (#6/#8)", "وسط ممر نصفي"],
        "fit_3421": "أحد ثنائي الوسط أو صانع لعب متأخر للربط بين الارتكاز والمثلث الهجومي",
        "fit_4231": "محور التحول من الدفاع للهجوم ودعم الدخول لمنطقة الجزاء كموجة ثانية",
    },
    "CAM": {
        "best_roles_ar": ["صانع ألعاب (#10 CAM)", "مهاجم متأخر في الممر النصفي (AM / SS)", "جناح مقلوب"],
        "fit_3421": "مثالي كأحد **صانعي اللعب الـ 2 خلف المهاجم (RAM/LAM)** داخل الممر النصفي لاستلام الكرة بين الخطوط والربط مع المهاجم الصريح والظهير الطائر",
        "fit_4231": "صانع ألعاب محوري #10 يقود التمريرات البينية والضغط الأول مع المهاجم",
    },
    "RW": {
        "best_roles_ar": ["جناح أيمن (RW)", "صانع لعب أيمن داخل الممر النصفي (RAM)", "مهاجم ثانٍ"],
        "fit_3421": "مثالي في مركز **صانع اللعب الأيمن (RAM)** للدخول بالقدم العكسية والتسديد أو التمرير البيني للمهاجم",
        "fit_4231": "جناح أيمن هجومي يستهدف المواجهات الفردية 1v1 ويقطع نحو العمق",
    },
    "LW": {
        "best_roles_ar": ["جناح أيسر (LW)", "صانع لعب أيسر داخل الممر النصفي (LAM)", "مهاجم طرف"],
        "fit_3421": "مثالي في مركز **صانع اللعب الأيسر (LAM)** للتحرك في الممر النصفي الأيسر واستغلال المساحة خلف ظهير الخصم",
        "fit_4231": "جناح أيسر هجومي على الخط مع الاختراق القطري نحو منطقة الجزاء",
    },
    "ST": {
        "best_roles_ar": ["مهاجم صريح (#9 ST)", "مهاجم متحرك يثبت قلوب الدفاع"],
        "fit_3421": "رأس الحربة الصريح الذي يسحب قلوب الدفاع لفتح الممرات النصفية أمام ثنائي صناعة اللعب",
        "fit_4231": "المهاجم الرئيسي لتثبيت العمق وإنهاء العرضيات والكرات البينية",
    },
}


def _norm_ar(text: str) -> str:
    t = (text or "").strip().lower()
    t = re.sub(r"[\u064b-\u065f\u0670]", "", t)
    t = t.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا").replace("ة", "ه").replace("ى", "ي")
    t = re.sub(r"[^\w\s\u0600-\u06ff-]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _extract_candidate_name(question: str, club_players: list[dict[str, Any]], opp_players: list[dict[str, Any]]) -> tuple[Optional[dict[str, Any]], str]:
    nq = _norm_ar(question)
    # 1. Exact/partial match against FULL loaded squads (all 35+ players, never truncated)
    all_local = [(p, True) for p in club_players] + [(p, False) for p in opp_players]
    best_p: Optional[dict[str, Any]] = None
    best_score = 0
    for p, is_own in all_local:
        for nm in (p.get("name_ar"), p.get("name_en"), p.get("short_name_ar")):
            nn = _norm_ar(str(nm or ""))
            if not nn or len(nn) < 3:
                continue
            words = [w for w in nn.split() if len(w) >= 2]
            if nn in nq:
                sc = len(nn) + (20 if is_own else 0)
                if sc > best_score:
                    best_score = sc
                    best_p = p
            elif len(words) >= 2 and all(w in nq for w in words[:2]):
                sc = sum(len(w) for w in words[:2]) + (12 if is_own else 0)
                if sc > best_score:
                    best_score = sc
                    best_p = p

    # 2. Extract cleaned search phrase by stripping prompt stop-words
    tokens = [tok for tok in nq.split() if tok not in _STRIP_WORDS and len(tok) >= 2 and not tok.isdigit()]
    clean_query = " ".join(tokens[:4]).strip()
    if best_p:
        clean_query = str(best_p.get("name_ar") or best_p.get("name_en") or clean_query)
    return best_p, clean_query


def _parse_365_stats(athlete_json: dict[str, Any]) -> dict[str, Any]:
    stats_out: dict[str, Any] = {}
    cs = athlete_json.get("careerStats") or {}
    seasons = cs.get("seasons") or []
    if not seasons:
        return stats_out
    latest = seasons[0]
    stats_out["season_name"] = latest.get("name") or latest.get("shortName") or "2026/2027"
    tables = (latest.get("stats") or {}).get("tables") or []
    apps_total = 0
    starts_total = 0
    goals_total = 0
    assists_total = 0
    yc_total = 0
    rc_total = 0
    comp_breakdown: list[str] = []

    for tbl in tables:
        cols = {c.get("num"): str(c.get("name") or "") for c in (tbl.get("columns") or []) if c.get("num") is not None}
        for row in (tbl.get("rows") or [])[:4]:
            title = str(row.get("title") or "").strip()
            vals: dict[int, int] = {}
            for cell in row.get("values") or []:
                cnum = cell.get("columnNum")
                try:
                    vals[int(cnum)] = int(float(str(cell.get("value") or "0").replace("-", "0") or 0))
                except ValueError:
                    vals[int(cnum)] = 0
            a = vals.get(5, 0)
            s = vals.get(6, 0)
            g = vals.get(1, 0)
            asst = vals.get(2, 0)
            y = vals.get(3, 0)
            r = vals.get(4, 0)
            if a or g or asst:
                comp_breakdown.append(f"{title}: {a} مشاركات ({s} أساسي)، {g} أهداف، {asst} صناعة، {y} صفراء")
            apps_total += a
            starts_total += s
            goals_total += g
            assists_total += asst
            yc_total += y
            rc_total += r

    if apps_total or comp_breakdown:
        stats_out.update(
            {
                "appearances": apps_total,
                "starts": starts_total,
                "goals": goals_total,
                "assists": assists_total,
                "yellow_cards": yc_total,
                "red_cards": rc_total,
                "competitions": comp_breakdown[:4],
            }
        )
    return stats_out


def research_player_live(
    question: str,
    club: dict[str, Any],
    opponent: dict[str, Any],
    target_player: Optional[dict[str, Any]] = None,
    target_club: Optional[dict[str, Any]] = None,
    history: Optional[list[dict[str, str]]] = None,
) -> Optional[dict[str, Any]]:
    """Run live 365Scores athlete search + fullDetails lookup for accurate player deployment grounding."""
    club_players = list(club.get("players") or [])
    opp_players = list(opponent.get("players") or [])
    active_club = target_club or club
    hint_comp_id = active_club.get("ts_365_id")

    local_hit: Optional[dict[str, Any]] = target_player
    search_phrase = ""

    if local_hit:
        search_phrase = str(local_hit.get("name_ar") or local_hit.get("name_en") or "").strip()
    else:
        local_hit, search_phrase = _extract_candidate_name(question, club_players, opp_players)
        nq = _norm_ar(question)
        is_followup_pronoun = any(
            cue in nq
            for cue in (
                "مركزه", "توظيفه", "احطه", "واحطه", "الاعبه", "العبه", "الالعبه",
                "دوره", "مميزاته", "عيوبه", "مكانه", "ارقامه", "his ", "him",
            )
        )
        # Follow-up question without repeating the player name? Scan recent user turns in history
        if not local_hit and history and (not search_phrase or is_followup_pronoun):
            for msg in reversed(history[-6:]):
                if msg.get("role") == "user" and msg.get("content"):
                    lh, sp = _extract_candidate_name(str(msg["content"]), club_players, opp_players)
                    if lh or sp:
                        local_hit = lh or local_hit
                        search_phrase = sp
                        break

    aid = int((local_hit or {}).get("athlete_id") or 0)
    if not aid and not search_phrase:
        return None

    cache_key = f"{aid}:{search_phrase}:{hint_comp_id or ''}"
    cached = _RESEARCH_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _CACHE_TTL_S:
        return cached[1]

    ath_ar: dict[str, Any] = {}
    ath_en: dict[str, Any] = {}
    clubs_by_365: dict[int, str] = {}

    try:
        with httpx.Client(headers=THREESIXFIVE_HEADERS, timeout=10.0) as client:
            if not aid and search_phrase:
                rs = client.get(
                    "https://webws.365scores.com/web/search/",
                    params={"appTypeId": 5, "langId": 27, "query": search_phrase},
                )
                if rs.status_code == 200:
                    sjson = rs.json()
                    for comp in sjson.get("competitors") or []:
                        if comp.get("id"):
                            clubs_by_365[int(comp["id"])] = str(comp.get("name") or "")
                    hits = sjson.get("athletes") or []
                    if hits:
                        picked = None
                        if hint_comp_id:
                            picked = next((h for h in hits if int(h.get("clubId") or 0) == int(hint_comp_id)), None)
                        if not picked:
                            picked = next((h for h in hits if int(h.get("clubId") or -1) > 0), hits[0])
                        aid = int(picked.get("id") or 0)

            if not aid and not local_hit and history:
                for msg in reversed(history[-6:]):
                    if msg.get("role") == "user" and msg.get("content"):
                        lh, sp = _extract_candidate_name(str(msg["content"]), club_players, opp_players)
                        if lh or (sp and sp != search_phrase):
                            local_hit = lh or local_hit
                            search_phrase = sp or search_phrase
                            aid = int((local_hit or {}).get("athlete_id") or 0)
                            if not aid and search_phrase:
                                rs2 = client.get(
                                    "https://webws.365scores.com/web/search/",
                                    params={"appTypeId": 5, "langId": 27, "query": search_phrase},
                                )
                                if rs2.status_code == 200:
                                    hits2 = rs2.json().get("athletes") or []
                                    if hits2:
                                        aid = int(hits2[0].get("id") or 0)
                            break

            if aid:
                ra = client.get(
                    "https://webws.365scores.com/web/athletes/",
                    params={"appTypeId": 5, "langId": 27, "athletes": aid, "fullDetails": "true"},
                )
                if ra.status_code == 200:
                    aj = ra.json()
                    for comp in aj.get("competitors") or []:
                        if comp.get("id"):
                            clubs_by_365[int(comp["id"])] = str(comp.get("name") or "")
                    ath_ar = (aj.get("athletes") or [{}])[0]
                re_res = client.get(
                    "https://webws.365scores.com/web/athletes/",
                    params={"appTypeId": 5, "langId": 1, "athletes": aid},
                )
                if re_res.status_code == 200:
                    ath_en = (re_res.json().get("athletes") or [{}])[0]
    except Exception:
        pass

    if not ath_ar and not local_hit:
        return None

    # Merge live 365Scores details with local roster info (local roster wins for club status/discipline overrides)
    fpos_ar = str((ath_ar.get("formationPosition") or {}).get("name") or "").strip()
    pos_ar = str((ath_ar.get("position") or {}).get("name") or "").strip()
    fpos_en = str((ath_en.get("formationPosition") or {}).get("name") or "").strip()
    pos_en = str((ath_en.get("position") or {}).get("name") or "").strip()

    pos_code = (
        str((local_hit or {}).get("position") or "").upper()
        or _POS_TO_CODE.get(fpos_ar)
        or _POS_TO_CODE.get(fpos_en.lower())
        or _POS_TO_CODE.get(pos_ar)
        or _POS_TO_CODE.get(pos_en.lower())
        or "CM"
    )
    resolved_aid = int(ath_ar.get("id") or aid or 0)
    img_ver = int(ath_ar.get("imageVersion") or 1)
    photo_url = (local_hit or {}).get("photo_url") or (
        f"https://imagecache.365scores.com/image/upload/f_png,w_160,h_160,c_thumb,g_face,q_auto:eco,dpr_2,"
        f"d_Athletes:default.png/v{img_ver}/Athletes/{resolved_aid}"
        if resolved_aid
        else None
    )

    pdetails = ath_ar.get("playerDetails") or []
    height_cm = (local_hit or {}).get("height_cm")
    preferred_foot = (local_hit or {}).get("preferred_foot")
    for det in pdetails:
        ttl = str(det.get("title") or "")
        val = str(det.get("value") or "")
        if not height_cm and ("طول" in ttl or "Height" in ttl):
            hm = re.search(r"(\d{3})", val)
            if hm:
                height_cm = int(hm.group(1))
        if not preferred_foot and ("قدم" in ttl or "Foot" in ttl):
            preferred_foot = val

    c365_id = int(ath_ar.get("clubId") or 0)
    club_name_ar = str(
        (local_hit and active_club.get("name_ar"))
        or clubs_by_365.get(c365_id)
        or active_club.get("name_ar")
        or ""
    )

    tactical_profile = _TACTICAL_ROLES_BY_POS.get(pos_code, _TACTICAL_ROLES_BY_POS["CM"])
    season_stats = _parse_365_stats(ath_ar) if ath_ar else {}
    highlights = [
        f"{h.get('title')}: {h.get('value')}"
        for h in (ath_ar.get("highlightStats") or [])[:5]
        if h.get("title") and h.get("value") is not None
    ]

    dossier = {
        "athlete_id": resolved_aid or None,
        "name_ar": str(ath_ar.get("name") or (local_hit or {}).get("name_ar") or search_phrase),
        "name_en": str(ath_en.get("name") or (local_hit or {}).get("name_en") or ""),
        "club_id_365": c365_id or None,
        "club_name_ar": club_name_ar,
        "jersey_number": ath_ar.get("jerseyNum") or (local_hit or {}).get("jersey_number"),
        "position_code": pos_code,
        "position_label_ar": fpos_ar or pos_ar or (local_hit or {}).get("position_label_ar") or pos_code,
        "age": ath_ar.get("age") or (local_hit or {}).get("age"),
        "height_cm": height_cm,
        "preferred_foot": preferred_foot,
        "nationality_ar": str(ath_ar.get("nationalityName") or (local_hit or {}).get("nationality_ar") or ""),
        "contract_until": str(ath_ar.get("contractUntil") or (local_hit or {}).get("contract_until") or ""),
        "readiness_pct": (local_hit or {}).get("readiness_pct", 100),
        "status": (local_hit or {}).get("status", "fit"),
        "yellow_cards": (local_hit or {}).get("yellow_cards", 0),
        "injury": (ath_ar.get("injury") or {}).get("description") if isinstance(ath_ar.get("injury"), dict) else None,
        "national_team_stats": str(ath_ar.get("nationalTeamStatsText") or ""),
        "short_bio": str(ath_ar.get("shortBio") or ""),
        "photo_url": photo_url,
        "season_stats": season_stats,
        "highlights": highlights,
        "tactical_profile": tactical_profile,
        "sources": ["365Scores Live 2026/27" if ath_ar else "Verified Club Roster 2026/27"],
    }
    _RESEARCH_CACHE[cache_key] = (time.time(), dossier)
    return dossier
