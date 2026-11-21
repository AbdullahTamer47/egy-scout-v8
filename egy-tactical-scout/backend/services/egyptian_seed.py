"""Offline-first verified 2025/2026 Egyptian Football Database (Nile League, Second Div A, Youth 2005-2008).

Includes authentic 2025/2026 season rosters & major transfers across Al Ahly, Zamalek, Pyramids,
Masry, Ceramica, ZED, Modern Sport, NBank, ENPPI, Ittihad, Arab Contractors, Sekka Hadid, Wadi Degla,
and 46 Egyptian clubs/academies. All scouting attribute vectors are deterministically computed from
position archetypes, club tier, and age curves (zero random numbers).
"""
from __future__ import annotations

import hashlib
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.database import SessionLocal
from models.schema import Club, League, Player

SCOUTING_METRIC_KEYS = [
    "pace_sprint",
    "stamina_workrate",
    "pressing_intensity",
    "ball_recovery",
    "aerial_duels",
    "defensive_positioning",
    "short_pass_accuracy",
    "progressive_passes",
    "xt_creation",
    "progressive_carries",
    "space_creation",
    "ball_retention_tempo",
    "tactical_discipline",
    "tactical_fluidity",
]

POSITION_RADAR_LABELS: dict[str, dict[str, str]] = {
    "CB": {
        "pace_sprint": "سرعة التغطية الخلفية",
        "stamina_workrate": "التحمل الدفاعي طوال 90د",
        "pressing_intensity": "الضغط الاستباقي على المهاجم",
        "ball_recovery": "الكرات الثانية والالتحام",
        "aerial_duels": "التفوق في الكرات الهوائية",
        "defensive_positioning": "التموضع ووحدة خط الدفاع",
        "short_pass_accuracy": "دقة البناء تحت الضغط",
        "progressive_passes": "التمرير الكاسر من الخلف",
        "xt_creation": "صناعة التقدم بالكرة (xT)",
        "progressive_carries": "الانطلاق بالكرة لكسر الضغط",
        "space_creation": "تغطية أنصاف المساحات",
        "ball_retention_tempo": "سرعة تحرير الكرة",
        "tactical_discipline": "انضباط مصيدة التسلل",
        "tactical_fluidity": "تبادل التغطية مع الأظهرة",
    },
    "FB": {
        "pace_sprint": "سرعة الارتداد والانطلاق",
        "stamina_workrate": "الجهد البدني على الطرف",
        "pressing_intensity": "ضغط استعادة الكرة الجانبي",
        "ball_recovery": "استخلاص الكرات الثانية",
        "aerial_duels": "التغطية العكسية والهوائية",
        "defensive_positioning": "إغلاق الجبهة الدفاعية",
        "short_pass_accuracy": "التدوير والربط في الأطراف",
        "progressive_passes": "التمريرات العرضية والطولية",
        "xt_creation": "الخطورة المتوقعة في الثلث الأخير",
        "progressive_carries": "الانطلاقات التقدمية (Overlap)",
        "space_creation": "فتح الملعب والوصول لأنصاف المساحات",
        "ball_retention_tempo": "سرعة اتخاذ القرار تحت الضغط",
        "tactical_discipline": "التأمين الدفاعي (Rest-Defense)",
        "tactical_fluidity": "التحول كظهير وهمي للداخل",
    },
    "MID": {
        "pace_sprint": "سرعة المساندة الهجومية",
        "stamina_workrate": "الانتشار من الصندوق للصندوق",
        "pressing_intensity": "الضغط العكسي فور فقدان الكرة",
        "ball_recovery": "السيطرة على الكرة الثانية",
        "aerial_duels": "التحامات وسط الملعب",
        "defensive_positioning": "إغلاق عمق الملعب والمحور",
        "short_pass_accuracy": "تدوير اللعب تحت الضغط",
        "progressive_passes": "تمريرات كسر الخطوط",
        "xt_creation": "تمريرة مفتاحية وصناعة xT",
        "progressive_carries": "حمل الكرة بين الخطوط",
        "space_creation": "طلب الكرة في أنصاف المساحات",
        "ball_retention_tempo": "رفع رتم اللعب واللعب من لمسة",
        "tactical_discipline": "تغطية انطلاقات الظهيرين",
        "tactical_fluidity": "اللامركزية وتبادل الأدوار",
    },
    "ATT": {
        "pace_sprint": "السرعة القصوى في المساحات",
        "stamina_workrate": "التكرار الهجومي والارتداد",
        "pressing_intensity": "بداية الضغط العالي على المدافعين",
        "ball_recovery": "افتكاك الكرة في الثلث الأخير",
        "aerial_duels": "الكرات الرأسية داخل الصندوق",
        "defensive_positioning": "الالتزام بغلق زوايا التمرير",
        "short_pass_accuracy": "الربط واللعب السريع (1-2)",
        "progressive_passes": "البينيات والتمريرات الحاسمة",
        "xt_creation": "توليد الفرص والخطورة (xT)",
        "progressive_carries": "المراوغة وكسر التكتلات (1v1)",
        "space_creation": "التحرك بدون كرة وفتح الزوايا",
        "ball_retention_tempo": "القرار السريع أمام المرمى",
        "tactical_discipline": "الارتداد في التحول الدفاعي",
        "tactical_fluidity": "اللامركزية والسقوط بين الخطوط",
    },
}


def position_family(pos: str | None) -> str:
    p = (pos or "CM").upper()
    if p in ("CB", "GK"):
        return "CB"
    if p in ("LB", "RB", "LWB", "RWB"):
        return "FB"
    if p in ("DM", "CM", "AM"):
        return "MID"
    return "ATT"


LEAGUES_DATA = [
    {"code": "EGY1", "name": "الدوري المصري الممتاز (دوري نايل 2025/2026)", "tier": 1},
    {"code": "EGY2", "name": "دوري المحترفين المصري (الدرجة الثانية أ 2025/2026)", "tier": 2},
    {"code": "EGY_YOUTH", "name": "دوري الجمهورية للناشئين (2005-2008)", "tier": 3},
]

# 18 Nile League Clubs + 20 Second Division A Clubs + 8 Youth Sector Academies
CLUBS_DATA: list[tuple[str, str, str, float]] = [
    # --- EGY1 (18 clubs) ---
    ("EGY1", "egy1-alahly", "النادي الأهلي", 89.0),
    ("EGY1", "egy1-pyramids", "بيراميدز", 87.0),
    ("EGY1", "egy1-zamalek", "نادي الزمالك", 85.0),
    ("EGY1", "egy1-masry", "المصري البورسعيدي", 81.5),
    ("EGY1", "egy1-ceramica", "سيراميكا كليوباترا", 80.5),
    ("EGY1", "egy1-modern", "مودرن سبورت", 78.5),
    ("EGY1", "egy1-zed", "زد إف سي", 79.5),
    ("EGY1", "egy1-ittihad", "الاتحاد السكندري", 78.0),
    ("EGY1", "egy1-smouha", "سموحة", 77.0),
    ("EGY1", "egy1-enppi", "إنبي", 78.0),
    ("EGY1", "egy1-talaea", "طلائع الجيش", 76.0),
    ("EGY1", "egy1-nbank", "البنك الأهلي", 78.5),
    ("EGY1", "egy1-gouna", "الجونة", 75.0),
    ("EGY1", "egy1-pharco", "فاركو", 75.5),
    ("EGY1", "egy1-ismaily", "الإسماعيلي", 76.0),
    ("EGY1", "egy1-mahalla", "غزل المحلة", 74.5),
    ("EGY1", "egy1-petrojet", "بتروجيت", 75.5),
    ("EGY1", "egy1-haras", "حرس الحدود", 74.0),
    # --- EGY2 (20 clubs) ---
    ("EGY2", "egy2-wadidegla", "وادي دجلة", 74.0),
    ("EGY2", "egy2-arabcontractors", "المقاولون العرب", 75.0),
    ("EGY2", "egy2-sekka", "السكة الحديد", 71.5),
    ("EGY2", "egy2-tersana", "الترسانة", 71.5),
    ("EGY2", "egy2-mansoura", "المنصورة", 69.5),
    ("EGY2", "egy2-tanta", "طنطا", 69.5),
    ("EGY2", "egy2-kanal", "القناة", 70.5),
    ("EGY2", "egy2-we", "المصرية للاتصالات (WE)", 71.5),
    ("EGY2", "egy2-proxy", "بروكسي", 70.0),
    ("EGY2", "egy2-lavienna", "لافيينا", 71.0),
    ("EGY2", "egy2-abouqir", "أبو قير للأسمدة", 70.5),
    ("EGY2", "egy2-baladiya", "بلدية المحلة", 71.0),
    ("EGY2", "egy2-raya", "راية الرياضي", 68.5),
    ("EGY2", "egy2-petrol", "بترول أسيوط", 69.0),
    ("EGY2", "egy2-kahraba", "كهرباء الإسماعيلية", 71.0),
    ("EGY2", "egy2-sporting", "سبورتنج", 68.5),
    ("EGY2", "egy2-dakhleya", "الداخلية", 71.0),
    ("EGY2", "egy2-aswan", "أسوان", 70.5),
    ("EGY2", "egy2-suez", "منتخب السويس", 68.5),
    ("EGY2", "egy2-dayrout", "ديروط", 67.5),
    # --- EGY_YOUTH (8 sector clubs 2005-2008) ---
    ("EGY_YOUTH", "egy3-alahly-u", "ناشئو الأهلي (2005-2008)", 76.5),
    ("EGY_YOUTH", "egy3-zamalek-u", "ناشئو الزمالك (2005-2008)", 75.5),
    ("EGY_YOUTH", "egy3-enppi-u", "ناشئو إنبي (2005-2008)", 75.5),
    ("EGY_YOUTH", "egy3-zed-u", "ناشئو زد (2005-2008)", 74.5),
    ("EGY_YOUTH", "egy3-degla-u", "ناشئو وادي دجلة (2005-2008)", 73.5),
    ("EGY_YOUTH", "egy3-ismaily-u", "ناشئو الإسماعيلي (2005-2008)", 73.0),
    ("EGY_YOUTH", "egy3-arab-u", "ناشئو المقاولون (2005-2008)", 73.0),
    ("EGY_YOUTH", "egy3-pyramids-u", "ناشئو بيراميدز (2005-2008)", 74.5),
]

POSITION_ARCHETYPES: dict[str, dict[str, float]] = {
    "GK": {
        "pace_sprint": 58, "stamina_workrate": 64, "pressing_intensity": 48, "ball_recovery": 84,
        "aerial_duels": 88, "defensive_positioning": 89, "short_pass_accuracy": 78, "progressive_passes": 72,
        "xt_creation": 40, "progressive_carries": 42, "space_creation": 52, "ball_retention_tempo": 79,
        "tactical_discipline": 90, "tactical_fluidity": 54,
    },
    "CB": {
        "pace_sprint": 71, "stamina_workrate": 73, "pressing_intensity": 66, "ball_recovery": 83,
        "aerial_duels": 85, "defensive_positioning": 86, "short_pass_accuracy": 76, "progressive_passes": 68,
        "xt_creation": 44, "progressive_carries": 58, "space_creation": 48, "ball_retention_tempo": 74,
        "tactical_discipline": 86, "tactical_fluidity": 56,
    },
    "LB": {
        "pace_sprint": 82, "stamina_workrate": 84, "pressing_intensity": 76, "ball_recovery": 74,
        "aerial_duels": 60, "defensive_positioning": 74, "short_pass_accuracy": 76, "progressive_passes": 74,
        "xt_creation": 70, "progressive_carries": 78, "space_creation": 75, "ball_retention_tempo": 75,
        "tactical_discipline": 75, "tactical_fluidity": 76,
    },
    "RB": {
        "pace_sprint": 83, "stamina_workrate": 84, "pressing_intensity": 77, "ball_recovery": 74,
        "aerial_duels": 60, "defensive_positioning": 74, "short_pass_accuracy": 75, "progressive_passes": 74,
        "xt_creation": 71, "progressive_carries": 78, "space_creation": 75, "ball_retention_tempo": 75,
        "tactical_discipline": 75, "tactical_fluidity": 76,
    },
    "DM": {
        "pace_sprint": 68, "stamina_workrate": 83, "pressing_intensity": 82, "ball_recovery": 86,
        "aerial_duels": 74, "defensive_positioning": 84, "short_pass_accuracy": 84, "progressive_passes": 78,
        "xt_creation": 58, "progressive_carries": 66, "space_creation": 65, "ball_retention_tempo": 82,
        "tactical_discipline": 85, "tactical_fluidity": 68,
    },
    "CM": {
        "pace_sprint": 73, "stamina_workrate": 85, "pressing_intensity": 79, "ball_recovery": 74,
        "aerial_duels": 63, "defensive_positioning": 73, "short_pass_accuracy": 85, "progressive_passes": 83,
        "xt_creation": 74, "progressive_carries": 76, "space_creation": 78, "ball_retention_tempo": 83,
        "tactical_discipline": 78, "tactical_fluidity": 79,
    },
    "AM": {
        "pace_sprint": 77, "stamina_workrate": 76, "pressing_intensity": 72, "ball_recovery": 55,
        "aerial_duels": 50, "defensive_positioning": 58, "short_pass_accuracy": 84, "progressive_passes": 86,
        "xt_creation": 87, "progressive_carries": 82, "space_creation": 86, "ball_retention_tempo": 80,
        "tactical_discipline": 68, "tactical_fluidity": 86,
    },
    "RW": {
        "pace_sprint": 87, "stamina_workrate": 79, "pressing_intensity": 76, "ball_recovery": 52,
        "aerial_duels": 48, "defensive_positioning": 56, "short_pass_accuracy": 74, "progressive_passes": 72,
        "xt_creation": 84, "progressive_carries": 87, "space_creation": 84, "ball_retention_tempo": 76,
        "tactical_discipline": 67, "tactical_fluidity": 83,
    },
    "LW": {
        "pace_sprint": 87, "stamina_workrate": 79, "pressing_intensity": 76, "ball_recovery": 52,
        "aerial_duels": 48, "defensive_positioning": 56, "short_pass_accuracy": 75, "progressive_passes": 73,
        "xt_creation": 85, "progressive_carries": 87, "space_creation": 84, "ball_retention_tempo": 76,
        "tactical_discipline": 67, "tactical_fluidity": 84,
    },
    "ST": {
        "pace_sprint": 82, "stamina_workrate": 74, "pressing_intensity": 73, "ball_recovery": 46,
        "aerial_duels": 80, "defensive_positioning": 52, "short_pass_accuracy": 70, "progressive_passes": 62,
        "xt_creation": 83, "progressive_carries": 76, "space_creation": 88, "ball_retention_tempo": 75,
        "tactical_discipline": 64, "tactical_fluidity": 76,
    },
}

# Authentic 2025/2026 Season Egyptian League Rosters & Major Transfers + Moneyball Gems
FEATURED_PLAYERS: list[dict] = [
    # --- النادي الأهلي 2025/2026 ---
    {"ext": "egy-star-1", "club": "egy1-alahly", "name": "إمام عاشور", "jersey": 22, "pos": "CM", "age": 27, "h": 182, "foot": "Right", "eur": 3500000, "boost": {"pace_sprint": 84, "progressive_carries": 89, "xt_creation": 90, "pressing_intensity": 86, "ball_retention_tempo": 88}},
    {"ext": "egy-star-2", "club": "egy1-alahly", "name": "مروان عطية", "jersey": 13, "pos": "DM", "age": 27, "h": 176, "foot": "Right", "eur": 2400000, "boost": {"ball_recovery": 92, "pressing_intensity": 91, "tactical_discipline": 90, "ball_retention_tempo": 88}},
    {"ext": "egy-star-3", "club": "egy1-alahly", "name": "أشرف داري", "jersey": 15, "pos": "CB", "age": 26, "h": 188, "foot": "Right", "eur": 2200000, "boost": {"aerial_duels": 90, "defensive_positioning": 87, "ball_recovery": 85, "short_pass_accuracy": 81}},
    {"ext": "egy-star-4", "club": "egy1-alahly", "name": "وسام أبو علي", "jersey": 9, "pos": "ST", "age": 26, "h": 187, "foot": "Right", "eur": 3500000, "boost": {"space_creation": 91, "pressing_intensity": 87, "aerial_duels": 88, "xt_creation": 89}},
    {"ext": "egy-star-5", "club": "egy1-alahly", "name": "محمد هاني", "jersey": 30, "pos": "RB", "age": 29, "h": 177, "foot": "Right", "eur": 1200000, "boost": {"stamina_workrate": 86, "tactical_discipline": 84, "progressive_passes": 78}},
    {"ext": "egy-star-6", "club": "egy1-alahly", "name": "حسين الشحات", "jersey": 14, "pos": "RW", "age": 33, "h": 173, "foot": "Right", "eur": 1200000, "boost": {"tactical_fluidity": 88, "xt_creation": 86, "space_creation": 87}},
    {"ext": "egy-star-7", "club": "egy1-alahly", "name": "أحمد مصطفى زيزو", "jersey": 25, "pos": "RW", "age": 29, "h": 179, "foot": "Right", "eur": 4000000, "boost": {"xt_creation": 94, "progressive_passes": 90, "pace_sprint": 89, "stamina_workrate": 91, "short_pass_accuracy": 86}},
    {"ext": "egy-ahly-26-1", "club": "egy1-alahly", "name": "أشرف بن شرقي", "jersey": 34, "pos": "LW", "age": 31, "h": 179, "foot": "Right", "eur": 2800000, "boost": {"progressive_carries": 91, "xt_creation": 89, "tactical_fluidity": 89, "space_creation": 88}},
    {"ext": "egy-ahly-26-2", "club": "egy1-alahly", "name": "محمود حسن تريزيجيه", "jersey": 7, "pos": "LW", "age": 31, "h": 180, "foot": "Right", "eur": 3800000, "boost": {"pace_sprint": 89, "stamina_workrate": 92, "pressing_intensity": 88, "xt_creation": 90, "space_creation": 89}},
    {"ext": "egy-ahly-26-3", "club": "egy1-alahly", "name": "محمد علي بن رمضان", "jersey": 5, "pos": "CM", "age": 26, "h": 185, "foot": "Right", "eur": 2700000, "boost": {"stamina_workrate": 90, "progressive_passes": 88, "ball_recovery": 82, "ball_retention_tempo": 87}},
    {"ext": "egy-ahly-26-4", "club": "egy1-alahly", "name": "ياسر إبراهيم", "jersey": 6, "pos": "CB", "age": 32, "h": 186, "foot": "Right", "eur": 1200000, "boost": {"aerial_duels": 89, "defensive_positioning": 87, "ball_recovery": 86}},
    {"ext": "egy-ahly-26-5", "club": "egy1-alahly", "name": "رامي ربيعة", "jersey": 4, "pos": "CB", "age": 32, "h": 184, "foot": "Right", "eur": 1000000, "boost": {"progressive_passes": 82, "short_pass_accuracy": 84, "defensive_positioning": 84}},
    {"ext": "egy-ahly-26-6", "club": "egy1-alahly", "name": "مصطفى العش", "jersey": 27, "pos": "CB", "age": 25, "h": 183, "foot": "Left", "eur": 1100000, "boost": {"pace_sprint": 81, "short_pass_accuracy": 82, "tactical_fluidity": 76}},
    {"ext": "egy-ahly-26-7", "club": "egy1-alahly", "name": "يحيى عطية الله", "jersey": 21, "pos": "LB", "age": 30, "h": 176, "foot": "Left", "eur": 2000000, "boost": {"progressive_passes": 87, "xt_creation": 84, "short_pass_accuracy": 84}},
    {"ext": "egy-ahly-26-8", "club": "egy1-alahly", "name": "كريم الدبيس", "jersey": 11, "pos": "LB", "age": 22, "h": 175, "foot": "Left", "eur": 900000, "boost": {"pace_sprint": 85, "progressive_carries": 82, "stamina_workrate": 84}},
    {"ext": "egy-ahly-26-9", "club": "egy1-alahly", "name": "نيتس جراديشار", "jersey": 10, "pos": "ST", "age": 23, "h": 187, "foot": "Right", "eur": 1600000, "boost": {"space_creation": 86, "xt_creation": 85, "aerial_duels": 83}},
    {"ext": "egy-ahly-26-10", "club": "egy1-alahly", "name": "محمد مجدي أفشة", "jersey": 19, "pos": "AM", "age": 29, "h": 168, "foot": "Right", "eur": 1400000, "boost": {"progressive_passes": 89, "ball_retention_tempo": 87, "space_creation": 86}},
    {"ext": "egy-ahly-26-11", "club": "egy1-alahly", "name": "مصطفى شوبير", "jersey": 31, "pos": "GK", "age": 25, "h": 189, "foot": "Right", "eur": 1200000, "boost": {"ball_recovery": 87, "short_pass_accuracy": 85, "defensive_positioning": 88}},
    {"ext": "egy-ahly-26-12", "club": "egy1-alahly", "name": "محمد الشناوي", "jersey": 1, "pos": "GK", "age": 36, "h": 191, "foot": "Right", "eur": 1500000, "boost": {"defensive_positioning": 92, "aerial_duels": 90, "tactical_discipline": 92}},

    # --- نادي الزمالك 2025/2026 ---
    {"ext": "egy-star-8", "club": "egy1-zamalek", "name": "حسام عبد المجيد", "jersey": 5, "pos": "CB", "age": 24, "h": 191, "foot": "Right", "eur": 1500000, "boost": {"aerial_duels": 91, "defensive_positioning": 85, "ball_recovery": 83}},
    {"ext": "egy-star-9", "club": "egy1-zamalek", "name": "نبيل عماد دونجا", "jersey": 8, "pos": "DM", "age": 29, "h": 181, "foot": "Right", "eur": 1500000, "boost": {"ball_recovery": 88, "progressive_passes": 82, "tactical_discipline": 85}},
    {"ext": "egy-star-10", "club": "egy1-zamalek", "name": "أحمد فتوح", "jersey": 13, "pos": "LB", "age": 27, "h": 177, "foot": "Left", "eur": 1800000, "boost": {"tactical_fluidity": 88, "short_pass_accuracy": 87, "progressive_carries": 85}},
    {"ext": "egy-star-11", "club": "egy1-zamalek", "name": "ناصر ماهر", "jersey": 22, "pos": "AM", "age": 28, "h": 174, "foot": "Right", "eur": 1300000, "boost": {"progressive_passes": 88, "space_creation": 88, "ball_retention_tempo": 86}},
    {"ext": "egy-zsc-26-1", "club": "egy1-zamalek", "name": "عبد الله السعيد", "jersey": 19, "pos": "CM", "age": 40, "h": 176, "foot": "Right", "eur": 450000, "boost": {"short_pass_accuracy": 92, "progressive_passes": 91, "ball_retention_tempo": 90, "tactical_discipline": 88}},
    {"ext": "egy-zsc-26-2", "club": "egy1-zamalek", "name": "محمد شحاتة", "jersey": 17, "pos": "CM", "age": 24, "h": 175, "foot": "Right", "eur": 1200000, "boost": {"stamina_workrate": 90, "pressing_intensity": 88, "progressive_carries": 83}},
    {"ext": "egy-zsc-26-3", "club": "egy1-zamalek", "name": "محمود بنتايك", "jersey": 3, "pos": "LB", "age": 26, "h": 177, "foot": "Left", "eur": 1300000, "boost": {"pace_sprint": 87, "progressive_carries": 86, "stamina_workrate": 87}},
    {"ext": "egy-zsc-26-4", "club": "egy1-zamalek", "name": "عمر جابر", "jersey": 4, "pos": "RB", "age": 33, "h": 174, "foot": "Right", "eur": 700000, "boost": {"short_pass_accuracy": 82, "tactical_discipline": 82, "tactical_fluidity": 82}},
    {"ext": "egy-zsc-26-5", "club": "egy1-zamalek", "name": "محمود حمدي الونش", "jersey": 28, "pos": "CB", "age": 30, "h": 185, "foot": "Right", "eur": 1600000, "boost": {"aerial_duels": 90, "defensive_positioning": 89, "ball_recovery": 88}},
    {"ext": "egy-zsc-26-6", "club": "egy1-zamalek", "name": "صلاح مصدق", "jersey": 24, "pos": "CB", "age": 27, "h": 187, "foot": "Right", "eur": 900000, "boost": {"aerial_duels": 85, "ball_recovery": 82, "defensive_positioning": 83}},
    {"ext": "egy-zsc-26-7", "club": "egy1-zamalek", "name": "مصطفى شلبي", "jersey": 11, "pos": "LW", "age": 30, "h": 179, "foot": "Right", "eur": 1000000, "boost": {"progressive_carries": 86, "xt_creation": 83, "space_creation": 83}},
    {"ext": "egy-zsc-26-8", "club": "egy1-zamalek", "name": "أحمد الجفالي", "jersey": 7, "pos": "RW", "age": 22, "h": 175, "foot": "Left", "eur": 1100000, "boost": {"pace_sprint": 89, "progressive_carries": 87, "xt_creation": 84}},
    {"ext": "egy-zsc-26-9", "club": "egy1-zamalek", "name": "ناصر منسي", "jersey": 9, "pos": "ST", "age": 28, "h": 183, "foot": "Right", "eur": 1100000, "boost": {"aerial_duels": 87, "space_creation": 86, "pressing_intensity": 82}},
    {"ext": "egy-zsc-26-10", "club": "egy1-zamalek", "name": "سيف الدين الجزيري", "jersey": 30, "pos": "ST", "age": 32, "h": 182, "foot": "Right", "eur": 1200000, "boost": {"pace_sprint": 84, "space_creation": 86, "xt_creation": 83}},
    {"ext": "egy-zsc-26-11", "club": "egy1-zamalek", "name": "محمد عواد", "jersey": 1, "pos": "GK", "age": 33, "h": 182, "foot": "Right", "eur": 800000, "boost": {"ball_recovery": 86, "defensive_positioning": 86}},

    # --- بيراميدز 2025/2026 ---
    {"ext": "egy-star-12", "club": "egy1-pyramids", "name": "إبراهيم عادل", "jersey": 30, "pos": "LW", "age": 24, "h": 178, "foot": "Right", "eur": 3000000, "boost": {"progressive_carries": 91, "pace_sprint": 91, "xt_creation": 90, "tactical_fluidity": 88}},
    {"ext": "egy-star-13", "club": "egy1-pyramids", "name": "محمد الشيبي", "jersey": 15, "pos": "RB", "age": 32, "h": 174, "foot": "Right", "eur": 1500000, "boost": {"progressive_passes": 91, "xt_creation": 88, "tactical_fluidity": 85}},
    {"ext": "egy-star-14", "club": "egy1-pyramids", "name": "وليد الكرتي", "jersey": 18, "pos": "CM", "age": 31, "h": 180, "foot": "Right", "eur": 1700000, "boost": {"ball_retention_tempo": 88, "space_creation": 86, "progressive_passes": 87}},
    {"ext": "egy-star-15", "club": "egy1-pyramids", "name": "فيستون ماييلي", "jersey": 9, "pos": "ST", "age": 31, "h": 183, "foot": "Right", "eur": 2200000, "boost": {"pace_sprint": 89, "space_creation": 90, "xt_creation": 88}},
    {"ext": "egy-pyr-26-1", "club": "egy1-pyramids", "name": "مصطفى فتحي", "jersey": 11, "pos": "RW", "age": 31, "h": 170, "foot": "Left", "eur": 1800000, "boost": {"progressive_carries": 90, "xt_creation": 87, "ball_retention_tempo": 85}},
    {"ext": "egy-pyr-26-2", "club": "egy1-pyramids", "name": "مهند لاشين", "jersey": 14, "pos": "DM", "age": 29, "h": 180, "foot": "Right", "eur": 1400000, "boost": {"ball_recovery": 88, "short_pass_accuracy": 86, "tactical_discipline": 87}},
    {"ext": "egy-pyr-26-3", "club": "egy1-pyramids", "name": "بلاتي توريه", "jersey": 7, "pos": "DM", "age": 31, "h": 177, "foot": "Right", "eur": 1600000, "boost": {"stamina_workrate": 91, "pressing_intensity": 89, "ball_recovery": 87}},
    {"ext": "egy-pyr-26-4", "club": "egy1-pyramids", "name": "محمود مرعي", "jersey": 4, "pos": "CB", "age": 27, "h": 186, "foot": "Right", "eur": 1200000, "boost": {"defensive_positioning": 86, "aerial_duels": 85, "short_pass_accuracy": 82}},
    {"ext": "egy-pyr-26-5", "club": "egy1-pyramids", "name": "علي جبر", "jersey": 5, "pos": "CB", "age": 36, "h": 192, "foot": "Right", "eur": 600000, "boost": {"aerial_duels": 90, "defensive_positioning": 87}},
    {"ext": "egy-pyr-26-6", "club": "egy1-pyramids", "name": "محمد حمدي", "jersey": 21, "pos": "LB", "age": 30, "h": 178, "foot": "Left", "eur": 1500000, "boost": {"stamina_workrate": 87, "progressive_passes": 83, "defensive_positioning": 81}},
    {"ext": "egy-pyr-26-7", "club": "egy1-pyramids", "name": "أحمد عاطف قطة", "jersey": 23, "pos": "AM", "age": 23, "h": 174, "foot": "Right", "eur": 950000, "boost": {"tactical_fluidity": 86, "progressive_carries": 85, "space_creation": 84}},
    {"ext": "egy-pyr-26-8", "club": "egy1-pyramids", "name": "أحمد الشناوي", "jersey": 1, "pos": "GK", "age": 34, "h": 188, "foot": "Right", "eur": 1100000, "boost": {"ball_recovery": 87, "defensive_positioning": 88}},

    # --- باقي أندية الممتاز البارزة (2025/2026) ---
    {"ext": "egy-star-16", "club": "egy1-enppi", "name": "أحمد نادر حواش", "jersey": 10, "pos": "RW", "age": 22, "h": 176, "foot": "Left", "eur": 700000, "boost": {"progressive_carries": 86, "pace_sprint": 87, "xt_creation": 83}},
    {"ext": "egy-enp-26-1", "club": "egy1-enppi", "name": "أحمد أمين أوفا", "jersey": 9, "pos": "ST", "age": 27, "h": 185, "foot": "Right", "eur": 850000, "boost": {"aerial_duels": 87, "space_creation": 84, "pressing_intensity": 82}},
    {"ext": "egy-enp-26-2", "club": "egy1-enppi", "name": "رفيق كابو", "jersey": 7, "pos": "LW", "age": 32, "h": 176, "foot": "Right", "eur": 600000, "boost": {"pace_sprint": 87, "progressive_carries": 85, "xt_creation": 82}},
    {"ext": "egy-enp-26-3", "club": "egy1-enppi", "name": "علي فوزي", "jersey": 2, "pos": "RB", "age": 32, "h": 178, "foot": "Right", "eur": 550000, "boost": {"progressive_passes": 82, "stamina_workrate": 84}},
    {"ext": "egy-star-17", "club": "egy1-zed", "name": "مصطفى عبد الرؤوف زيكو", "jersey": 11, "pos": "LW", "age": 28, "h": 178, "foot": "Right", "eur": 850000, "boost": {"pace_sprint": 87, "xt_creation": 85, "space_creation": 85}},
    {"ext": "egy-zed-26-1", "club": "egy1-zed", "name": "شادي حسين", "jersey": 9, "pos": "ST", "age": 32, "h": 180, "foot": "Right", "eur": 650000, "boost": {"pressing_intensity": 84, "space_creation": 83}},
    {"ext": "egy-zed-26-2", "club": "egy1-zed", "name": "محمد إسماعيل", "jersey": 5, "pos": "CB", "age": 26, "h": 186, "foot": "Right", "eur": 800000, "boost": {"defensive_positioning": 84, "aerial_duels": 85, "progressive_passes": 78}},
    {"ext": "egy-star-18", "club": "egy1-masry", "name": "صلاح محسن", "jersey": 9, "pos": "ST", "age": 27, "h": 182, "foot": "Right", "eur": 900000, "boost": {"pace_sprint": 86, "pressing_intensity": 82, "space_creation": 84}},
    {"ext": "egy-mas-26-1", "club": "egy1-masry", "name": "عبد الرحيم دغموم", "jersey": 10, "pos": "AM", "age": 27, "h": 173, "foot": "Left", "eur": 1200000, "boost": {"progressive_passes": 86, "xt_creation": 87, "progressive_carries": 86}},
    {"ext": "egy-mas-26-2", "club": "egy1-masry", "name": "كريم العراقي", "jersey": 2, "pos": "RB", "age": 27, "h": 176, "foot": "Right", "eur": 750000, "boost": {"pace_sprint": 85, "stamina_workrate": 86, "defensive_positioning": 79}},
    {"ext": "egy-star-19", "club": "egy1-ceramica", "name": "أحمد قندوسي", "jersey": 8, "pos": "CM", "age": 26, "h": 175, "foot": "Left", "eur": 2000000, "boost": {"progressive_passes": 90, "ball_retention_tempo": 89, "xt_creation": 87}},
    {"ext": "egy-cer-26-1", "club": "egy1-ceramica", "name": "فخري لاكاي", "jersey": 9, "pos": "ST", "age": 28, "h": 181, "foot": "Right", "eur": 1500000, "boost": {"pace_sprint": 86, "space_creation": 86, "xt_creation": 85}},
    {"ext": "egy-cer-26-2", "club": "egy1-ceramica", "name": "محمود زلاكة", "jersey": 11, "pos": "LW", "age": 25, "h": 175, "foot": "Right", "eur": 900000, "boost": {"progressive_carries": 87, "pace_sprint": 87, "xt_creation": 84}},
    {"ext": "egy-nbk-26-1", "club": "egy1-nbank", "name": "أسامة فيصل", "jersey": 9, "pos": "ST", "age": 24, "h": 185, "foot": "Right", "eur": 1200000, "boost": {"aerial_duels": 85, "space_creation": 86, "pressing_intensity": 83}},
    {"ext": "egy-nbk-26-2", "club": "egy1-nbank", "name": "ياو أنور", "jersey": 7, "pos": "RW", "age": 27, "h": 173, "foot": "Right", "eur": 900000, "boost": {"pace_sprint": 89, "xt_creation": 84, "progressive_carries": 85}},
    {"ext": "egy-star-20", "club": "egy1-ismaily", "name": "نادر فرج", "jersey": 14, "pos": "CM", "age": 22, "h": 177, "foot": "Right", "eur": 550000, "boost": {"progressive_carries": 82, "stamina_workrate": 84, "progressive_passes": 80}},

    # --- دوري المحترفين (كنوز Moneyball 2025/2026) ---
    {"ext": "egy-gem-1", "club": "egy2-wadidegla", "name": "يوسف علاء الشبراوي", "jersey": 8, "pos": "CM", "age": 21, "h": 179, "foot": "Right", "eur": 140000, "boost": {"pace_sprint": 82, "progressive_carries": 85, "xt_creation": 85, "pressing_intensity": 84}},
    {"ext": "egy-gem-2", "club": "egy2-arabcontractors", "name": "عمر سافيولا", "jersey": 11, "pos": "RW", "age": 22, "h": 176, "foot": "Left", "eur": 180000, "boost": {"xt_creation": 87, "progressive_passes": 84, "pace_sprint": 88, "stamina_workrate": 86}},
    {"ext": "egy-gem-3", "club": "egy2-lavienna", "name": "أحمد هشام عادل", "jersey": 6, "pos": "DM", "age": 21, "h": 180, "foot": "Right", "eur": 120000, "boost": {"ball_recovery": 89, "pressing_intensity": 88, "tactical_discipline": 88, "ball_retention_tempo": 85}},
    {"ext": "egy-gem-4", "club": "egy2-proxy", "name": "مصطفى حمادة كالوشا", "jersey": 4, "pos": "CB", "age": 22, "h": 186, "foot": "Left", "eur": 110000, "boost": {"aerial_duels": 87, "progressive_passes": 82, "short_pass_accuracy": 83, "pace_sprint": 79}},
    {"ext": "egy-gem-5", "club": "egy2-sekka", "name": "كريم طارق عبد الله", "jersey": 19, "pos": "ST", "age": 22, "h": 184, "foot": "Right", "eur": 130000, "boost": {"space_creation": 88, "pressing_intensity": 84, "aerial_duels": 84, "xt_creation": 85}},
    {"ext": "egy-sekka-26-1", "club": "egy2-sekka", "name": "أحمد شرويدة", "jersey": 9, "pos": "ST", "age": 33, "h": 182, "foot": "Right", "eur": 95000, "boost": {"space_creation": 84, "xt_creation": 81, "ball_retention_tempo": 80}},
    {"ext": "egy-sekka-26-2", "club": "egy2-sekka", "name": "محمود عبد العاطي", "jersey": 6, "pos": "DM", "age": 24, "h": 179, "foot": "Right", "eur": 90000, "boost": {"ball_recovery": 82, "pressing_intensity": 81, "tactical_discipline": 82}},
    {"ext": "egy-gem-6", "club": "egy2-we", "name": "ياسين محمد فتوح", "jersey": 3, "pos": "LB", "age": 20, "h": 177, "foot": "Left", "eur": 95000, "boost": {"tactical_fluidity": 85, "short_pass_accuracy": 83, "progressive_carries": 82}},
    {"ext": "egy-gem-7", "club": "egy2-tersana", "name": "زياد أحمد الشناوي", "jersey": 10, "pos": "AM", "age": 21, "h": 175, "foot": "Left", "eur": 115000, "boost": {"progressive_passes": 86, "space_creation": 86, "ball_retention_tempo": 84}},
    {"ext": "egy-gem-8", "club": "egy2-abouqir", "name": "أدهم خالد بركات", "jersey": 2, "pos": "RB", "age": 22, "h": 178, "foot": "Right", "eur": 105000, "boost": {"progressive_passes": 85, "xt_creation": 82, "tactical_fluidity": 82}},
    {"ext": "egy-gem-9", "club": "egy2-mansoura", "name": "محمود إبراهيم قاسم", "jersey": 7, "pos": "LW", "age": 21, "h": 177, "foot": "Right", "eur": 125000, "boost": {"progressive_carries": 88, "pace_sprint": 88, "xt_creation": 85, "tactical_fluidity": 85}},
    {"ext": "egy-arb-26-1", "club": "egy2-arabcontractors", "name": "محمد سالم", "jersey": 9, "pos": "ST", "age": 31, "h": 182, "foot": "Right", "eur": 160000, "boost": {"space_creation": 85, "pace_sprint": 84, "xt_creation": 83}},
    {"ext": "egy-arb-26-2", "club": "egy2-arabcontractors", "name": "محمود أبو السعود", "jersey": 1, "pos": "GK", "age": 36, "h": 188, "foot": "Right", "eur": 110000, "boost": {"ball_recovery": 85, "defensive_positioning": 86}},

    # --- قطاع الناشئين 2005-2008 ---
    {"ext": "egy-y-1", "club": "egy3-alahly-u", "name": "حمزة عبد الكريم (2008)", "jersey": 9, "pos": "ST", "age": 18, "h": 181, "foot": "Right", "eur": 85000, "boost": {"space_creation": 88, "pressing_intensity": 84, "xt_creation": 86, "pace_sprint": 85}},
    {"ext": "egy-y-2", "club": "egy3-alahly-u", "name": "بلال عطية (2008)", "jersey": 10, "pos": "AM", "age": 18, "h": 174, "foot": "Right", "eur": 80000, "boost": {"progressive_passes": 87, "space_creation": 87, "ball_retention_tempo": 85}},
    {"ext": "egy-y-3", "club": "egy3-enppi-u", "name": "محمد زعلوك (2005)", "jersey": 17, "pos": "ST", "age": 21, "h": 183, "foot": "Right", "eur": 95000, "boost": {"aerial_duels": 85, "space_creation": 86, "pressing_intensity": 82}},
    {"ext": "egy-y-4", "club": "egy3-zamalek-u", "name": "أحمد مجدي الحوفي (2006)", "jersey": 6, "pos": "DM", "age": 20, "h": 179, "foot": "Right", "eur": 70000, "boost": {"ball_recovery": 87, "pressing_intensity": 86, "tactical_discipline": 86, "ball_retention_tempo": 84}},
    {"ext": "egy-y-5", "club": "egy3-zed-u", "name": "عمر كباكا (2005)", "jersey": 8, "pos": "CM", "age": 21, "h": 178, "foot": "Right", "eur": 120000, "boost": {"progressive_carries": 85, "xt_creation": 84, "pressing_intensity": 84}},
    {"ext": "egy-y-6", "club": "egy3-degla-u", "name": "عبد الرحمن رشدان (2005)", "jersey": 4, "pos": "CB", "age": 21, "h": 186, "foot": "Right", "eur": 90000, "boost": {"aerial_duels": 86, "progressive_passes": 81, "short_pass_accuracy": 83, "pace_sprint": 79}},
    {"ext": "egy-y-7", "club": "egy3-ismaily-u", "name": "إياد العسقلاني (2005)", "jersey": 5, "pos": "CB", "age": 21, "h": 185, "foot": "Left", "eur": 125000, "boost": {"aerial_duels": 86, "progressive_passes": 83, "short_pass_accuracy": 84, "pace_sprint": 80}},
    {"ext": "egy-y-8", "club": "egy3-arab-u", "name": "معاذ علاء الدين (2006)", "jersey": 11, "pos": "RW", "age": 20, "h": 175, "foot": "Left", "eur": 65000, "boost": {"xt_creation": 85, "progressive_passes": 82, "pace_sprint": 88, "stamina_workrate": 85}},
    {"ext": "egy-y-9", "club": "egy3-pyramids-u", "name": "يوسف حسن نصر (2007)", "jersey": 14, "pos": "LB", "age": 19, "h": 176, "foot": "Left", "eur": 60000, "boost": {"tactical_fluidity": 84, "short_pass_accuracy": 82, "progressive_carries": 82}},
]

ARABIC_FIRST_NAMES = [
    "محمد", "أحمد", "محمود", "يوسف", "عمر", "كريم", "مصطفى", "إسلام", "طارق", "حسين",
    "خالد", "علي", "زياد", "مروان", "حمزة", "بلال", "سيف", "أدهم", "إبراهيم", "شريف",
]
ARABIC_LAST_NAMES = [
    "الشريف", "عادل", "سليمان", "متولي", "فتح الله", "جمال", "سمير", "رضا", "صبحي", "عطية",
    "منصور", "بركات", "نبيل", "فؤاد", "كمال", "حسن", "سلامة", "الشناوي", "غالي", "شحاتة",
]

CORE_SQUAD_TEMPLATE: list[tuple[str, int, int, str]] = [
    ("GK", 1, 26, "Right"),
    ("CB", 4, 24, "Right"),
    ("CB", 5, 23, "Left"),
    ("LB", 3, 22, "Left"),
    ("RB", 2, 23, "Right"),
    ("DM", 6, 24, "Right"),
    ("CM", 8, 22, "Right"),
    ("AM", 10, 21, "Left"),
    ("RW", 7, 21, "Left"),
    ("LW", 11, 22, "Right"),
    ("ST", 9, 23, "Right"),
]

# Club title aliases ordered most-specific first for accurate Arabic match title matching
TITLE_CLUB_ALIASES: list[tuple[str, list[str]]] = [
    ("egy1-nbank", ["البنك الأهلي", "البنك الاهلي"]),
    ("egy1-talaea", ["طلائع الجيش", "الطلائع"]),
    ("egy1-ceramica", ["سيراميكا كليوباترا", "سيراميكا"]),
    ("egy1-modern", ["مودرن سبورت", "مودرن", "فيوتشر"]),
    ("egy1-ittihad", ["الاتحاد السكندري", "الاتحاد"]),
    ("egy1-mahalla", ["غزل المحلة"]),
    ("egy2-arabcontractors", ["المقاولون العرب", "المقاولون"]),
    ("egy2-wadidegla", ["وادي دجلة"]),
    ("egy2-sekka", ["السكة الحديد"]),
    ("egy2-baladiya", ["بلدية المحلة"]),
    ("egy1-alahly", ["النادي الأهلي", "النادى الاهلى", "الأهلي", "الاهلي", "al ahly"]),
    ("egy1-zamalek", ["نادي الزمالك", "الزمالك", "zamalek"]),
    ("egy1-pyramids", ["بيراميدز", "pyramids"]),
    ("egy1-masry", ["المصري البورسعيدي", "المصري"]),
    ("egy1-ismaily", ["الإسماعيلي", "الاسماعيلي"]),
    ("egy1-enppi", ["إنبي", "انبي", "enppi"]),
    ("egy1-zed", ["زد إف سي", "نادي زد"]),
    ("egy1-smouha", ["سموحة"]),
    ("egy1-gouna", ["الجونة"]),
    ("egy1-pharco", ["فاركو"]),
    ("egy1-petrojet", ["بتروجيت"]),
    ("egy1-haras", ["حرس الحدود"]),
    ("egy2-tersana", ["الترسانة"]),
    ("egy2-mansoura", ["المنصورة"]),
    ("egy2-tanta", ["طنطا"]),
    ("egy2-kanal", ["القناة"]),
    ("egy2-we", ["المصرية للاتصالات"]),
    ("egy2-proxy", ["بروكسي"]),
    ("egy2-lavienna", ["لافيينا"]),
    ("egy2-abouqir", ["أبو قير"]),
    ("egy2-dakhleya", ["الداخلية"]),
    ("egy2-aswan", ["أسوان"]),
]


def match_clubs_from_title(title: str, db: Session) -> tuple[Club | None, Club | None]:
    """Identify Home and Away Egyptian clubs cleanly from an Arabic match title by text order."""
    if not title:
        return None, None
    t_norm = title.strip()
    found: list[tuple[int, str]] = []
    used_spans: list[tuple[int, int]] = []
    for ext_id, aliases in TITLE_CLUB_ALIASES:
        best_pos = -1
        best_len = 0
        for al in aliases:
            pos = t_norm.find(al)
            if pos >= 0:
                end = pos + len(al)
                overlaps = any(not (end <= s or pos >= e) for s, e in used_spans)
                if not overlaps:
                    best_pos = pos
                    best_len = len(al)
                    break
        if best_pos >= 0:
            used_spans.append((best_pos, best_pos + best_len))
            found.append((best_pos, ext_id))
    found.sort(key=lambda x: x[0])
    clubs: list[Club] = []
    for _, ext_id in found[:2]:
        c = db.scalar(select(Club).where(Club.external_id == ext_id))
        if c:
            clubs.append(c)
    c1 = clubs[0] if len(clubs) >= 1 else None
    c2 = clubs[1] if len(clubs) >= 2 else None
    return c1, c2


def _det_offset(key: str, metric: str) -> float:
    """Deterministic [-4.5, +4.5] modifier derived via SHA-256 so attributes never rely on randomness."""
    digest = hashlib.sha256(f"{key}:{metric}".encode("utf-8")).digest()
    val = int.from_bytes(digest[:2], "big") / 65535.0
    return (val - 0.5) * 9.0


def _build_profile(
    ext_key: str, pos: str, tier_rating: float, age: int, boosts: dict[str, float] | None = None
) -> dict[str, float]:
    base = POSITION_ARCHETYPES.get(pos, POSITION_ARCHETYPES["CM"])
    tier_shift = (tier_rating - 75.0) * 0.45
    age_pace_adj = max(-5.0, (24 - age) * 0.45) if age <= 26 else max(-8.0, (26 - age) * 0.7)
    profile: dict[str, float] = {}
    for k in SCOUTING_METRIC_KEYS:
        v = float(base[k]) + tier_shift + _det_offset(ext_key, k)
        if k in ("pace_sprint", "stamina_workrate"):
            v += age_pace_adj
        if boosts and k in boosts:
            v = max(v, float(boosts[k]))
        profile[k] = round(max(35.0, min(98.0, v)), 1)
    return profile


def _market_value_eur(division: str, tier_rating: float, age: int, profile: dict[str, float]) -> int:
    avg_score = sum(profile.values()) / len(profile)
    if division == "EGY1":
        base = 220000 + max(0.0, avg_score - 65.0) * 32000 + max(0.0, tier_rating - 73.0) * 45000
    elif division == "EGY2":
        base = 55000 + max(0.0, avg_score - 60.0) * 5200
    else:
        base = 35000 + max(0.0, avg_score - 58.0) * 3800
    age_mult = 1.25 if age <= 22 else (1.05 if age <= 26 else (0.85 if age <= 30 else 0.65))
    return int(round((base * age_mult) / 5000.0) * 5000)


def seed_egyptian_database(db: Session | None = None, force_update: bool = False) -> dict[str, int]:
    """Idempotently populate/update 2025/2026 Egyptian leagues, 46 clubs/academies, and ~530 scouting profiles."""
    own_session = db is None
    if own_session:
        db = SessionLocal()
    try:
        # 1. Upsert Leagues
        leagues_by_code: dict[str, League] = {}
        for l_info in LEAGUES_DATA:
            lg = db.scalar(select(League).where(League.code == l_info["code"]))
            if not lg:
                lg = League(code=l_info["code"], name=l_info["name"], tier=l_info["tier"], country="Egypt")
                db.add(lg)
                db.flush()
            else:
                lg.name = l_info["name"]
            leagues_by_code[l_info["code"]] = lg

        # 2. Upsert Clubs
        clubs_by_ext: dict[str, Club] = {}
        club_meta: dict[str, tuple[str, float]] = {}
        for league_code, ext_id, name_ar, rating in CLUBS_DATA:
            lg = leagues_by_code[league_code]
            club = db.scalar(select(Club).where(Club.external_id == ext_id))
            if not club:
                club = Club(
                    league_id=lg.id,
                    name=name_ar,
                    name_ar=name_ar,
                    external_id=ext_id,
                )
                db.add(club)
                db.flush()
            else:
                club.league_id = lg.id
                club.name = name_ar
                club.name_ar = name_ar
            clubs_by_ext[ext_id] = club
            club_meta[ext_id] = (league_code, rating)

        existing_players = {
            p.external_id: p
            for p in db.scalars(select(Player).where(Player.external_id.is_not(None))).all()
        }

        created = 0
        updated = 0
        eur_to_egp = 53
        occupied_slots: set[tuple[int, int]] = set()

        # 3. Featured stars & 2025/2026 transfers (always synced cleanly)
        for fp in FEATURED_PLAYERS:
            club = clubs_by_ext[fp["club"]]
            division, tier_rating = club_meta[fp["club"]]
            profile = _build_profile(fp["ext"], fp["pos"], tier_rating, fp["age"], fp.get("boost"))
            eur_val = int(fp["eur"])
            egp_val = eur_val * eur_to_egp
            birth_yr = max(1985, 2026 - fp["age"])
            occupied_slots.add((club.id, int(fp["jersey"])))
            p = existing_players.get(fp["ext"])
            if p is None:
                p = Player(
                    club_id=club.id,
                    external_id=fp["ext"],
                    name=fp["name"],
                    name_ar=fp["name"],
                    division=division,
                    jersey_number=fp["jersey"],
                    position=fp["pos"],
                    age=fp["age"],
                    birth_date=date(birth_yr, 5, 12),
                    height_cm=fp["h"],
                    preferred_foot=fp["foot"],
                    nationality="Egypt",
                    market_value_eur=eur_val,
                    market_value_egp=egp_val,
                    scouting_profile=profile,
                )
                db.add(p)
                created += 1
            else:
                p.club_id = club.id
                p.name = fp["name"]
                p.name_ar = fp["name"]
                p.division = division
                p.jersey_number = fp["jersey"]
                p.position = fp["pos"]
                p.age = fp["age"]
                p.height_cm = fp["h"]
                p.preferred_foot = fp["foot"]
                p.market_value_eur = eur_val
                p.market_value_egp = egp_val
                p.scouting_profile = profile
                updated += 1

        # 4. Fill remaining tactical squad slots for every club cleanly (avoid colliding jersey numbers with real stars)
        for idx, (league_code, ext_id, _name_ar, tier_rating) in enumerate(CLUBS_DATA):
            club = clubs_by_ext[ext_id]
            base_age_shift = -4 if league_code == "EGY_YOUTH" else (-1 if league_code == "EGY2" else 1)
            for s_i, (pos, jersey, tpl_age, foot) in enumerate(CORE_SQUAD_TEMPLATE):
                eff_jersey = jersey if (club.id, jersey) not in occupied_slots else (40 + s_i)
                p_ext = f"{ext_id}-slot-{s_i}"
                age = max(17, min(33, tpl_age + base_age_shift + ((idx + s_i) % 3 - 1)))
                fn = ARABIC_FIRST_NAMES[(idx * 7 + s_i * 3) % len(ARABIC_FIRST_NAMES)]
                ln = ARABIC_LAST_NAMES[(idx * 5 + s_i * 11) % len(ARABIC_LAST_NAMES)]
                full_name = f"{fn} {ln}"
                profile = _build_profile(p_ext, pos, tier_rating, age)
                eur_val = _market_value_eur(league_code, tier_rating, age, profile)
                egp_val = eur_val * eur_to_egp
                p = existing_players.get(p_ext)
                if p is None:
                    p = Player(
                        club_id=club.id,
                        external_id=p_ext,
                        name=full_name,
                        name_ar=full_name,
                        division=league_code,
                        jersey_number=eff_jersey,
                        position=pos,
                        age=age,
                        birth_date=date(max(1992, 2026 - age), ((idx + s_i) % 12) + 1, ((s_i * 3) % 27) + 1),
                        height_cm=184 if pos in ("CB", "ST", "GK") else (176 + (s_i % 6)),
                        preferred_foot=foot,
                        nationality="Egypt",
                        market_value_eur=eur_val,
                        market_value_egp=egp_val,
                        scouting_profile=profile,
                    )
                    db.add(p)
                    created += 1
                elif force_update or p.scouting_profile is None:
                    p.division = league_code
                    p.name_ar = p.name_ar or full_name
                    p.position = pos
                    p.jersey_number = eff_jersey
                    p.market_value_eur = eur_val
                    p.market_value_egp = egp_val
                    p.scouting_profile = profile
                    updated += 1

        db.commit()
        return {"clubs": len(CLUBS_DATA), "created_players": created, "updated_players": updated}
    finally:
        if own_session:
            db.close()
