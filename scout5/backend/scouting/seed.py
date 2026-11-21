"""Standalone Egyptian Football Database (2025/2026 EGY1, EGY2, Youth 2005-2008) & V5 Match Sync."""
from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from scouting.database import DATA_ROOT, SessionLocal
from scouting.models import Club, League, MatchRecord, Player

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

CLUBS_DATA: list[tuple[str, str, str, float]] = [
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
    "GK": {"pace_sprint": 58, "stamina_workrate": 64, "pressing_intensity": 48, "ball_recovery": 84, "aerial_duels": 88, "defensive_positioning": 89, "short_pass_accuracy": 78, "progressive_passes": 72, "xt_creation": 40, "progressive_carries": 42, "space_creation": 52, "ball_retention_tempo": 79, "tactical_discipline": 90, "tactical_fluidity": 54},
    "CB": {"pace_sprint": 71, "stamina_workrate": 73, "pressing_intensity": 66, "ball_recovery": 83, "aerial_duels": 85, "defensive_positioning": 86, "short_pass_accuracy": 76, "progressive_passes": 68, "xt_creation": 44, "progressive_carries": 58, "space_creation": 48, "ball_retention_tempo": 74, "tactical_discipline": 86, "tactical_fluidity": 56},
    "LB": {"pace_sprint": 82, "stamina_workrate": 84, "pressing_intensity": 76, "ball_recovery": 74, "aerial_duels": 60, "defensive_positioning": 74, "short_pass_accuracy": 76, "progressive_passes": 74, "xt_creation": 70, "progressive_carries": 78, "space_creation": 75, "ball_retention_tempo": 75, "tactical_discipline": 75, "tactical_fluidity": 76},
    "RB": {"pace_sprint": 83, "stamina_workrate": 84, "pressing_intensity": 77, "ball_recovery": 74, "aerial_duels": 60, "defensive_positioning": 74, "short_pass_accuracy": 75, "progressive_passes": 74, "xt_creation": 71, "progressive_carries": 78, "space_creation": 75, "ball_retention_tempo": 75, "tactical_discipline": 75, "tactical_fluidity": 76},
    "DM": {"pace_sprint": 68, "stamina_workrate": 83, "pressing_intensity": 82, "ball_recovery": 86, "aerial_duels": 74, "defensive_positioning": 84, "short_pass_accuracy": 84, "progressive_passes": 78, "xt_creation": 58, "progressive_carries": 66, "space_creation": 65, "ball_retention_tempo": 82, "tactical_discipline": 85, "tactical_fluidity": 68},
    "CM": {"pace_sprint": 73, "stamina_workrate": 85, "pressing_intensity": 79, "ball_recovery": 74, "aerial_duels": 63, "defensive_positioning": 73, "short_pass_accuracy": 85, "progressive_passes": 83, "xt_creation": 74, "progressive_carries": 76, "space_creation": 78, "ball_retention_tempo": 83, "tactical_discipline": 78, "tactical_fluidity": 79},
    "AM": {"pace_sprint": 77, "stamina_workrate": 76, "pressing_intensity": 72, "ball_recovery": 55, "aerial_duels": 50, "defensive_positioning": 58, "short_pass_accuracy": 84, "progressive_passes": 86, "xt_creation": 87, "progressive_carries": 82, "space_creation": 86, "ball_retention_tempo": 80, "tactical_discipline": 68, "tactical_fluidity": 86},
    "RW": {"pace_sprint": 87, "stamina_workrate": 79, "pressing_intensity": 76, "ball_recovery": 52, "aerial_duels": 48, "defensive_positioning": 56, "short_pass_accuracy": 74, "progressive_passes": 72, "xt_creation": 84, "progressive_carries": 87, "space_creation": 84, "ball_retention_tempo": 76, "tactical_discipline": 67, "tactical_fluidity": 83},
    "LW": {"pace_sprint": 87, "stamina_workrate": 79, "pressing_intensity": 76, "ball_recovery": 52, "aerial_duels": 48, "defensive_positioning": 56, "short_pass_accuracy": 75, "progressive_passes": 73, "xt_creation": 85, "progressive_carries": 87, "space_creation": 84, "ball_retention_tempo": 76, "tactical_discipline": 67, "tactical_fluidity": 84},
    "ST": {"pace_sprint": 82, "stamina_workrate": 74, "pressing_intensity": 73, "ball_recovery": 46, "aerial_duels": 80, "defensive_positioning": 52, "short_pass_accuracy": 70, "progressive_passes": 62, "xt_creation": 83, "progressive_carries": 76, "space_creation": 88, "ball_retention_tempo": 75, "tactical_discipline": 64, "tactical_fluidity": 76},
}

FEATURED_PLAYERS: list[dict] = [
    {"ext": "egy-star-1", "club": "egy1-alahly", "name": "إمام عاشور", "jersey": 22, "pos": "CM", "age": 27, "h": 182, "foot": "Right", "eur": 3500000, "boost": {"pace_sprint": 84, "progressive_carries": 89, "xt_creation": 90, "pressing_intensity": 86, "ball_retention_tempo": 88}},
    {"ext": "egy-star-2", "club": "egy1-alahly", "name": "مروان عطية", "jersey": 13, "pos": "DM", "age": 27, "h": 176, "foot": "Right", "eur": 2400000, "boost": {"ball_recovery": 92, "pressing_intensity": 91, "tactical_discipline": 90, "ball_retention_tempo": 88}},
    {"ext": "egy-star-4", "club": "egy1-alahly", "name": "وسام أبو علي", "jersey": 9, "pos": "ST", "age": 26, "h": 187, "foot": "Right", "eur": 3500000, "boost": {"space_creation": 91, "pressing_intensity": 87, "aerial_duels": 88, "xt_creation": 89}},
    {"ext": "egy-star-7", "club": "egy1-alahly", "name": "أحمد مصطفى زيزو", "jersey": 25, "pos": "RW", "age": 29, "h": 179, "foot": "Right", "eur": 4000000, "boost": {"xt_creation": 94, "progressive_passes": 90, "pace_sprint": 89, "stamina_workrate": 91}},
    {"ext": "egy-ahly-26-2", "club": "egy1-alahly", "name": "محمود حسن تريزيجيه", "jersey": 7, "pos": "LW", "age": 31, "h": 180, "foot": "Right", "eur": 3800000, "boost": {"pace_sprint": 89, "stamina_workrate": 92, "pressing_intensity": 88, "xt_creation": 90}},
    {"ext": "egy-ahly-26-12", "club": "egy1-alahly", "name": "محمد الشناوي", "jersey": 1, "pos": "GK", "age": 36, "h": 191, "foot": "Right", "eur": 1500000, "boost": {"defensive_positioning": 92, "aerial_duels": 90, "tactical_discipline": 92}},
    {"ext": "egy-star-8", "club": "egy1-zamalek", "name": "حسام عبد المجيد", "jersey": 5, "pos": "CB", "age": 24, "h": 191, "foot": "Right", "eur": 1500000, "boost": {"aerial_duels": 91, "defensive_positioning": 85, "ball_recovery": 83}},
    {"ext": "egy-star-10", "club": "egy1-zamalek", "name": "أحمد فتوح", "jersey": 13, "pos": "LB", "age": 27, "h": 177, "foot": "Left", "eur": 1800000, "boost": {"tactical_fluidity": 88, "short_pass_accuracy": 87, "progressive_carries": 85}},
    {"ext": "egy-zsc-26-1", "club": "egy1-zamalek", "name": "عبد الله السعيد", "jersey": 19, "pos": "CM", "age": 40, "h": 176, "foot": "Right", "eur": 450000, "boost": {"short_pass_accuracy": 92, "progressive_passes": 91, "ball_retention_tempo": 90}},
    {"ext": "egy-zsc-26-9", "club": "egy1-zamalek", "name": "ناصر منسي", "jersey": 9, "pos": "ST", "age": 28, "h": 183, "foot": "Right", "eur": 1100000, "boost": {"aerial_duels": 87, "space_creation": 86, "pressing_intensity": 82}},
    {"ext": "egy-star-12", "club": "egy1-pyramids", "name": "إبراهيم عادل", "jersey": 30, "pos": "LW", "age": 24, "h": 178, "foot": "Right", "eur": 3000000, "boost": {"progressive_carries": 91, "pace_sprint": 91, "xt_creation": 90}},
    {"ext": "egy-star-13", "club": "egy1-pyramids", "name": "محمد الشيبي", "jersey": 15, "pos": "RB", "age": 32, "h": 174, "foot": "Right", "eur": 1500000, "boost": {"progressive_passes": 91, "xt_creation": 88}},
    {"ext": "egy-star-15", "club": "egy1-pyramids", "name": "فيستون ماييلي", "jersey": 9, "pos": "ST", "age": 31, "h": 183, "foot": "Right", "eur": 2200000, "boost": {"pace_sprint": 89, "space_creation": 90, "xt_creation": 88}},
    {"ext": "egy-star-16", "club": "egy1-enppi", "name": "أحمد نادر حواش", "jersey": 10, "pos": "RW", "age": 22, "h": 176, "foot": "Left", "eur": 700000, "boost": {"progressive_carries": 86, "pace_sprint": 87, "xt_creation": 83}},
    {"ext": "egy-enp-26-1", "club": "egy1-enppi", "name": "أحمد أمين أوفا", "jersey": 9, "pos": "ST", "age": 27, "h": 185, "foot": "Right", "eur": 850000, "boost": {"aerial_duels": 87, "space_creation": 84}},
    {"ext": "egy-star-19", "club": "egy1-ceramica", "name": "أحمد قندوسي", "jersey": 8, "pos": "CM", "age": 26, "h": 175, "foot": "Left", "eur": 2000000, "boost": {"progressive_passes": 90, "ball_retention_tempo": 89, "xt_creation": 87}},
    {"ext": "egy-gem-1", "club": "egy2-wadidegla", "name": "يوسف علاء الشبراوي", "jersey": 8, "pos": "CM", "age": 21, "h": 179, "foot": "Right", "eur": 140000, "boost": {"pace_sprint": 82, "progressive_carries": 85, "xt_creation": 85, "pressing_intensity": 84}},
    {"ext": "egy-gem-2", "club": "egy2-arabcontractors", "name": "عمر سافيولا", "jersey": 11, "pos": "RW", "age": 22, "h": 176, "foot": "Left", "eur": 180000, "boost": {"xt_creation": 87, "progressive_passes": 84, "pace_sprint": 88, "stamina_workrate": 86}},
    {"ext": "egy-gem-3", "club": "egy2-lavienna", "name": "أحمد هشام عادل", "jersey": 6, "pos": "DM", "age": 21, "h": 180, "foot": "Right", "eur": 120000, "boost": {"ball_recovery": 89, "pressing_intensity": 88, "tactical_discipline": 88}},
    {"ext": "egy-gem-4", "club": "egy2-proxy", "name": "مصطفى حمادة كالوشا", "jersey": 4, "pos": "CB", "age": 22, "h": 186, "foot": "Left", "eur": 110000, "boost": {"aerial_duels": 87, "progressive_passes": 82, "pace_sprint": 79}},
    {"ext": "egy-gem-5", "club": "egy2-sekka", "name": "كريم طارق عبد الله", "jersey": 19, "pos": "ST", "age": 22, "h": 184, "foot": "Right", "eur": 130000, "boost": {"space_creation": 88, "pressing_intensity": 84, "xt_creation": 85}},
    {"ext": "egy-gem-6", "club": "egy2-we", "name": "ياسين محمد فتوح", "jersey": 3, "pos": "LB", "age": 20, "h": 177, "foot": "Left", "eur": 95000, "boost": {"tactical_fluidity": 85, "short_pass_accuracy": 83, "progressive_carries": 82}},
    {"ext": "egy-gem-7", "club": "egy2-tersana", "name": "زياد أحمد الشناوي", "jersey": 10, "pos": "AM", "age": 21, "h": 175, "foot": "Left", "eur": 115000, "boost": {"progressive_passes": 86, "space_creation": 86, "ball_retention_tempo": 84}},
    {"ext": "egy-gem-9", "club": "egy2-mansoura", "name": "محمود إبراهيم قاسم", "jersey": 7, "pos": "LW", "age": 21, "h": 177, "foot": "Right", "eur": 125000, "boost": {"progressive_carries": 88, "pace_sprint": 88, "xt_creation": 85}},
    {"ext": "egy-y-1", "club": "egy3-alahly-u", "name": "حمزة عبد الكريم (2008)", "jersey": 9, "pos": "ST", "age": 18, "h": 181, "foot": "Right", "eur": 85000, "boost": {"space_creation": 88, "pressing_intensity": 84, "xt_creation": 86}},
    {"ext": "egy-y-2", "club": "egy3-alahly-u", "name": "بلال عطية (2008)", "jersey": 10, "pos": "AM", "age": 18, "h": 174, "foot": "Right", "eur": 80000, "boost": {"progressive_passes": 87, "space_creation": 87, "ball_retention_tempo": 85}},
    {"ext": "egy-y-3", "club": "egy3-enppi-u", "name": "محمد زعلوك (2005)", "jersey": 17, "pos": "ST", "age": 21, "h": 183, "foot": "Right", "eur": 95000, "boost": {"aerial_duels": 85, "space_creation": 86}},
    {"ext": "egy-y-5", "club": "egy3-zed-u", "name": "عمر كباكا (2005)", "jersey": 8, "pos": "CM", "age": 21, "h": 178, "foot": "Right", "eur": 120000, "boost": {"progressive_carries": 85, "xt_creation": 84}},
    {"ext": "egy-y-7", "club": "egy3-ismaily-u", "name": "إياد العسقلاني (2005)", "jersey": 5, "pos": "CB", "age": 21, "h": 185, "foot": "Left", "eur": 125000, "boost": {"aerial_duels": 86, "progressive_passes": 83, "pace_sprint": 80}},
    {"ext": "egy-y-8", "club": "egy3-arab-u", "name": "معاذ علاء الدين (2006)", "jersey": 11, "pos": "RW", "age": 20, "h": 175, "foot": "Left", "eur": 65000, "boost": {"xt_creation": 85, "pace_sprint": 88, "stamina_workrate": 85}},
]

ARABIC_FIRST_NAMES = ["محمد", "أحمد", "محمود", "يوسف", "عمر", "كريم", "مصطفى", "إسلام", "طارق", "حسين", "خالد", "علي", "زياد", "مروان", "حمزة", "بلال", "سيف", "أدهم", "إبراهيم", "شريف"]
ARABIC_LAST_NAMES = ["الشريف", "عادل", "سليمان", "متولي", "فتح الله", "جمال", "سمير", "رضا", "صبحي", "عطية", "منصور", "بركات", "نبيل", "فؤاد", "كمال", "حسن", "سلامة", "الشناوي", "غالي", "شحاتة"]
CORE_SQUAD_TEMPLATE: list[tuple[str, int, int, str]] = [
    ("GK", 1, 26, "Right"), ("CB", 4, 24, "Right"), ("CB", 5, 23, "Left"), ("LB", 3, 22, "Left"),
    ("RB", 2, 23, "Right"), ("DM", 6, 24, "Right"), ("CM", 8, 22, "Right"), ("AM", 10, 21, "Left"),
    ("RW", 7, 21, "Left"), ("LW", 11, 22, "Right"), ("ST", 9, 23, "Right"),
]


def _det_offset(key: str, metric: str) -> float:
    digest = hashlib.sha256(f"{key}:{metric}".encode("utf-8")).digest()
    return (int.from_bytes(digest[:2], "big") / 65535.0 - 0.5) * 9.0


def _build_profile(ext_key: str, pos: str, tier_rating: float, age: int, boosts: dict[str, float] | None = None) -> dict[str, float]:
    base = POSITION_ARCHETYPES.get(pos, POSITION_ARCHETYPES["CM"])
    tier_shift = (tier_rating - 75.0) * 0.45
    age_adj = max(-5.0, (24 - age) * 0.45) if age <= 26 else max(-8.0, (26 - age) * 0.7)
    prof: dict[str, float] = {}
    for k in SCOUTING_METRIC_KEYS:
        v = float(base[k]) + tier_shift + _det_offset(ext_key, k)
        if k in ("pace_sprint", "stamina_workrate"):
            v += age_adj
        if boosts and k in boosts:
            v = max(v, float(boosts[k]))
        prof[k] = round(max(35.0, min(98.0, v)), 1)
    return prof


def _market_val_eur(division: str, tier_rating: float, age: int, profile: dict[str, float]) -> int:
    avg_s = sum(profile.values()) / len(profile)
    if division == "EGY1":
        base = 220000 + max(0.0, avg_s - 65.0) * 32000 + max(0.0, tier_rating - 73.0) * 45000
    elif division == "EGY2":
        base = 55000 + max(0.0, avg_s - 60.0) * 5200
    else:
        base = 35000 + max(0.0, avg_s - 58.0) * 3800
    mult = 1.25 if age <= 22 else (1.05 if age <= 26 else (0.85 if age <= 30 else 0.65))
    return int(round((base * mult) / 5000.0) * 5000)


def seed_database(db: Session | None = None) -> dict:
    own = db is None
    if own:
        db = SessionLocal()
    try:
        leagues = {}
        for lg in LEAGUES_DATA:
            obj = db.scalar(select(League).where(League.code == lg["code"]))
            if not obj:
                obj = League(code=lg["code"], name=lg["name"], tier=lg["tier"])
                db.add(obj)
                db.flush()
            leagues[lg["code"]] = obj

        clubs = {}
        club_meta = {}
        for lc, ext_id, name_ar, rating in CLUBS_DATA:
            obj = db.scalar(select(Club).where(Club.external_id == ext_id))
            if not obj:
                obj = Club(league_id=leagues[lc].id, name=name_ar, name_ar=name_ar, external_id=ext_id)
                db.add(obj)
                db.flush()
            clubs[ext_id] = obj
            club_meta[ext_id] = (lc, rating)

        existing = {p.external_id: p for p in db.scalars(select(Player).where(Player.external_id.is_not(None))).all()}
        occupied = set()
        created = 0
        for fp in FEATURED_PLAYERS:
            c = clubs[fp["club"]]
            div, tr = club_meta[fp["club"]]
            prof = _build_profile(fp["ext"], fp["pos"], tr, fp["age"], fp.get("boost"))
            eur = int(fp["eur"])
            occupied.add((c.id, int(fp["jersey"])))
            if fp["ext"] not in existing:
                db.add(Player(
                    club_id=c.id, external_id=fp["ext"], name=fp["name"], name_ar=fp["name"],
                    division=div, jersey_number=fp["jersey"], position=fp["pos"], age=fp["age"],
                    birth_date=date(max(1985, 2026 - fp["age"]), 5, 12), height_cm=fp["h"],
                    preferred_foot=fp["foot"], market_value_eur=eur, market_value_egp=eur * 53,
                    scouting_profile=prof,
                ))
                created += 1

        for idx, (lc, ext_id, _na, tr) in enumerate(CLUBS_DATA):
            c = clubs[ext_id]
            shift = -4 if lc == "EGY_YOUTH" else (-1 if lc == "EGY2" else 1)
            for si, (pos, jn, tpl_age, foot) in enumerate(CORE_SQUAD_TEMPLATE):
                eff_j = jn if (c.id, jn) not in occupied else (40 + si)
                p_ext = f"{ext_id}-slot-{si}"
                if p_ext in existing:
                    continue
                age = max(17, min(33, tpl_age + shift + ((idx + si) % 3 - 1)))
                name_ar = f"{ARABIC_FIRST_NAMES[(idx * 7 + si * 3) % len(ARABIC_FIRST_NAMES)]} {ARABIC_LAST_NAMES[(idx * 5 + si * 11) % len(ARABIC_LAST_NAMES)]}"
                prof = _build_profile(p_ext, pos, tr, age)
                eur = _market_val_eur(lc, tr, age, prof)
                db.add(Player(
                    club_id=c.id, external_id=p_ext, name=name_ar, name_ar=name_ar,
                    division=lc, jersey_number=eff_j, position=pos, age=age,
                    birth_date=date(max(1992, 2026 - age), ((idx + si) % 12) + 1, ((si * 3) % 27) + 1),
                    height_cm=184 if pos in ("CB", "ST", "GK") else (176 + (si % 6)),
                    preferred_foot=foot, market_value_eur=eur, market_value_egp=eur * 53,
                    scouting_profile=prof,
                ))
                created += 1
        db.commit()
        return {"clubs": len(CLUBS_DATA), "created_players": created}
    finally:
        if own:
            db.close()


SLUG_DEFAULTS = {
    "m1_ahly_sekka": ("الأهلي × السكة الحديد — كأس مصر", "كأس مصر", "النادي الأهلي", "السكة الحديد", 1),
    "m2_ahly_enppi": ("الأهلي × إنبي — الدوري المصري", "الدوري المصري الممتاز", "النادي الأهلي", "إنبي", 0),
    "m3_enppi_mokawloon": ("إنبي × المقاولون العرب — الدوري المصري", "الدوري المصري الممتاز", "إنبي", "المقاولون العرب", 1),
}

CLUB_KIT_PREFS: list[tuple[str, set[str]]] = [
    ("الأهلي", {"red"}),
    ("إنبي", {"blue", "dark"}),
    ("السكة", {"green", "dark"}),
    ("المقاولون", {"white", "yellow", "amber"}),
    ("الزمالك", {"white"}),
]


def _infer_home_cluster(home_name: str, teams_meta: dict, fallback: int) -> int:
    fams = {k: (v.get("kit") or {}).get("family", "") for k, v in (teams_meta or {}).items() if isinstance(v, dict)}
    for kw, expected in CLUB_KIT_PREFS:
        if kw in (home_name or ""):
            for cid in ("0", "1"):
                if fams.get(cid) in expected and fams.get("1" if cid == "0" else "0") not in expected:
                    return int(cid)
    return fallback


def sync_v5_matches() -> int:
    """Register or update any match folder under DATA_ROOT/matches/* cleanly into SQLite."""
    matches_dir = DATA_ROOT / "matches"
    if not matches_dir.exists():
        return 0
    synced = 0
    with SessionLocal() as db:
        for d in sorted(matches_dir.iterdir()):
            sf = d / "summary.json"
            if not d.is_dir() or not sf.exists():
                continue
            summ = json.loads(sf.read_text(encoding="utf-8"))
            slug = summ.get("match_slug") or d.name
            meta = summ.get("meta") or {}
            cal = summ.get("calibration") or {}
            defaults = SLUG_DEFAULTS.get(slug, (slug, "الدوري المصري", "الفريق 1", "الفريق 2", 0))
            inferred_hc = _infer_home_cluster(defaults[2], summ.get("teams") or {}, defaults[4])
            rec = db.scalar(select(MatchRecord).where(MatchRecord.slug == slug))
            fps = float(meta.get("fps") or summ.get("fps") or 25.0)
            fc = int(meta.get("total_video_frames") or 0)
            dur = round(fc / fps, 2) if fc > 0 else 0.0
            if not rec:
                rec = MatchRecord(
                    slug=slug,
                    title=defaults[0],
                    competition=defaults[1],
                    home_team_name=defaults[2],
                    away_team_name=defaults[3],
                    home_team_cluster=inferred_hc,
                    video_path=str(summ.get("video_path") or ""),
                )
                db.add(rec)
            else:
                rec.title = defaults[0]
                rec.home_team_name = defaults[2]
                rec.away_team_name = defaults[3]
                rec.home_team_cluster = inferred_hc
            rec.fps = fps
            rec.width = int(meta.get("width") or 1280)
            rec.height = int(meta.get("height") or 720)
            rec.frame_count = fc
            rec.duration_s = dur
            rec.status = "ready"
            rec.cal_coverage_pct = float(cal.get("wide_cal_coverage_pct") or 0.0)
            rec.median_rep_err_px = cal.get("median_rep_err_px")
            rec.ball_calibrated_frames = int(cal.get("ball_calibrated_frames") or 0)
            synced += 1
        db.commit()
    return synced
