"""Scientific Training Periodization & 2D Interactive Drill Planner for EGY-SCOUT Coach Pro."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Optional


WEEKLY_MICROCYCLE_TEMPLATES: dict[str, dict[str, Any]] = {
    "MD-5": {
        "md_code": "MD-5",
        "label_ar": "MD-5 • استشفاء وتفعيل عصبي",
        "label_en": "MD-5 • Active Recovery & Neural Activation",
        "duration_min": 45,
        "target_rpe": 3.0,
        "intensity": "low",
        "focus_ar": "استشفاء عضلي، مرونة حركية، تمريرات قصيرة بدون احتكاك",
        "focus_en": "Muscle recovery, mobility, non-contact passing technical activation",
        "default_drill_id": "rondo_6v3_pressing",
    },
    "MD-4": {
        "md_code": "MD-4",
        "label_ar": "MD-4 • القوة واللعب في المساحات الضيقة",
        "label_en": "MD-4 • Strength & Small-Sided Conditioning",
        "duration_min": 75,
        "target_rpe": 7.0,
        "intensity": "high",
        "focus_ar": "مباريات مصغرة 4 ضد 4 / 6 ضد 3، تسارع وتباطؤ، وتثبيت الضغط العكسي",
        "focus_en": "Small-sided games, accelerations/decelerations, and 5-second counter-press",
        "default_drill_id": "rondo_6v3_pressing",
    },
    "MD-3": {
        "md_code": "MD-3",
        "label_ar": "MD-3 • اليوم التكتيكي الرئيسي (11 ضد 11)",
        "label_en": "MD-3 • Main Tactical Organization (11v11)",
        "duration_min": 85,
        "target_rpe": 8.0,
        "intensity": "high",
        "focus_ar": "تطبيق شكل الفريق الكامل في البناء وكسر خطوط المنافس والترحيل الدفاعي",
        "focus_en": "Full-pitch tactical phases: buildup under pressure, half-space entry & shifting",
        "default_drill_id": "buildup_vs_high_press_8v6",
    },
    "MD-2": {
        "md_code": "MD-2",
        "label_ar": "MD-2 • السرعة الانتقالية والإنهاء في الثلث الأخير",
        "label_en": "MD-2 • Transition Speed & Final-Third Finishing",
        "duration_min": 65,
        "target_rpe": 6.0,
        "intensity": "moderate",
        "focus_ar": "تحولات هجومية في 8 ثوانٍ، اختراق المنطقة 14، واللعب الثالث",
        "focus_en": "Fast breaks (<8s), Zone 14 third-man combinations, and cutback finishing",
        "default_drill_id": "alonso_zone14_third_man",
    },
    "MD-1": {
        "md_code": "MD-1",
        "label_ar": "MD-1 • التنشيط التكتيكي والكرات الثابتة",
        "label_en": "MD-1 • Matchday Activation & Set-Pieces",
        "duration_min": 45,
        "target_rpe": 4.0,
        "intensity": "low",
        "focus_ar": "سرعة رد الفعل، الركلات الركنية والحرة، والمراجعة النهائية لتشكيل المباراة",
        "focus_en": "Neural sharpness, offensive/defensive corners, and starting XI walk-through",
        "default_drill_id": "corner_near_post_decoy",
    },
    "MD": {
        "md_code": "MD",
        "label_ar": "MD • يوم المباراة الرسمية",
        "label_en": "MD • Official Matchday",
        "duration_min": 95,
        "target_rpe": 9.5,
        "intensity": "match",
        "focus_ar": "الإحماء الرسمي (-45 دقيقة) وتنفيذ الخطة المعتمدة خلال الـ 90 دقيقة",
        "focus_en": "Pre-match activation (-45m) and full tactical execution across 90 minutes",
        "default_drill_id": "gegenpress_transition_box",
    },
    "MD+1": {
        "md_code": "MD+1",
        "label_ar": "MD+1 • الاستشفاء والتعويض البدني للبدلاء",
        "label_en": "MD+1 • Regeneration & Non-Starter Compensation",
        "duration_min": 40,
        "target_rpe": 2.5,
        "intensity": "low",
        "focus_ar": "جلسة استشفاء للأساسيين + وحدة تعويضية مكثفة للاعبي الدكة والمستبعدين",
        "focus_en": "Active recovery for starters + high-speed running top-up for substitutes",
        "default_drill_id": "back4_compactness_shifting",
    },
}


PRO_DRILLS_CATALOG: list[dict[str, Any]] = [
    {
        "drill_id": "rondo_6v3_pressing",
        "title_ar": "روندو الاستحواذ والضغط العكسي (6 ضد 3)",
        "title_en": "6v3 Possession Rondo & 5s Counter-Press",
        "category_ar": "استحواذ وضغط عكسي",
        "category_en": "Possession & Counter-Press",
        "pitch_view": "half",
        "area_m": "22m × 18m",
        "duration_min": 18,
        "target_rpe": 7.0,
        "coaching_points_ar": [
            "تمرير من لمسة أو لمستين بزاوية جسم مفتوحة قبل وصول الكرة.",
            "فور فقدان الكرة: أقرب 3 لاعبين يغلقون المثلث خلال 5 ثوانٍ لمنع الخروج.",
            "مساندة مستمرة للاعب الحامل من اليمين واليسار والعمق (مثلثات التمرير).",
        ],
        "players": [
            {"id": "A1", "team": "a", "label": "6", "x_m": 62.0, "y_m": 34.0},
            {"id": "A2", "team": "a", "label": "8", "x_m": 71.0, "y_m": 25.0},
            {"id": "A3", "team": "a", "label": "10", "x_m": 71.0, "y_m": 43.0},
            {"id": "A4", "team": "a", "label": "2", "x_m": 80.0, "y_m": 22.0},
            {"id": "A5", "team": "a", "label": "3", "x_m": 80.0, "y_m": 46.0},
            {"id": "A6", "team": "joker", "label": "9", "x_m": 88.0, "y_m": 34.0},
            {"id": "B1", "team": "b", "label": "P1", "x_m": 73.0, "y_m": 31.0},
            {"id": "B2", "team": "b", "label": "P2", "x_m": 77.0, "y_m": 37.0},
            {"id": "B3", "team": "b", "label": "P3", "x_m": 82.0, "y_m": 34.0},
        ],
        "props": [
            {"id": "c1", "kind": "cone", "x_m": 60.0, "y_m": 20.0},
            {"id": "c2", "kind": "cone", "x_m": 90.0, "y_m": 20.0},
            {"id": "c3", "kind": "cone", "x_m": 60.0, "y_m": 48.0},
            {"id": "c4", "kind": "cone", "x_m": 90.0, "y_m": 48.0},
            {"id": "b1", "kind": "ball", "x_m": 63.0, "y_m": 34.0},
        ],
        "arrows": [
            {"from_x_m": 62.0, "from_y_m": 34.0, "to_x_m": 71.0, "to_y_m": 25.0, "kind": "pass"},
            {"from_x_m": 71.0, "from_y_m": 25.0, "to_x_m": 88.0, "to_y_m": 34.0, "kind": "pass"},
            {"from_x_m": 73.0, "from_y_m": 31.0, "to_x_m": 66.0, "to_y_m": 33.0, "kind": "press"},
        ],
        "zones": [{"x1_m": 60.0, "y1_m": 20.0, "x2_m": 90.0, "y2_m": 48.0, "label": "منطقة الروندو"}],
    },
    {
        "drill_id": "buildup_vs_high_press_8v6",
        "title_ar": "بناء اللعب من الخلف وكسر الضغط العالي (8 ضد 6)",
        "title_en": "Buildup vs High Press (8v6 + Counter Mini-Goals)",
        "category_ar": "البناء التكتيكي",
        "category_en": "Phase 1 Buildup",
        "pitch_view": "half",
        "area_m": "55m × 62m",
        "duration_min": 25,
        "target_rpe": 8.0,
        "coaching_points_ar": [
            "استدراج ثنائي ضغط المنافس بتمريرة الحارس لأحد قلبي الدفاع ثم كسر الخط عبر الارتكاز الحر.",
            "نزول الجناح العكسي لفتح زاوية اللعب الثالث إذا أغلق الخصم الوسط.",
            "عند قطع الكرة: الفريق الضاغط ينطلق نحو المرمى الكبير أو المرميين الصغيرين خلال 6 ثوانٍ.",
        ],
        "players": [
            {"id": "A1", "team": "a", "label": "GK", "x_m": 58.0, "y_m": 34.0},
            {"id": "A2", "team": "a", "label": "LCB", "x_m": 68.0, "y_m": 24.0},
            {"id": "A3", "team": "a", "label": "RCB", "x_m": 68.0, "y_m": 44.0},
            {"id": "A4", "team": "a", "label": "LB", "x_m": 75.0, "y_m": 12.0},
            {"id": "A5", "team": "a", "label": "RB", "x_m": 75.0, "y_m": 56.0},
            {"id": "A6", "team": "a", "label": "6", "x_m": 80.0, "y_m": 30.0},
            {"id": "A7", "team": "a", "label": "8", "x_m": 84.0, "y_m": 41.0},
            {"id": "A8", "team": "a", "label": "10", "x_m": 92.0, "y_m": 34.0},
            {"id": "B1", "team": "b", "label": "9", "x_m": 74.0, "y_m": 31.0},
            {"id": "B2", "team": "b", "label": "10", "x_m": 74.0, "y_m": 39.0},
            {"id": "B3", "team": "b", "label": "7", "x_m": 81.0, "y_m": 50.0},
            {"id": "B4", "team": "b", "label": "11", "x_m": 81.0, "y_m": 18.0},
            {"id": "B5", "team": "b", "label": "6", "x_m": 87.0, "y_m": 30.0},
            {"id": "B6", "team": "b", "label": "8", "x_m": 87.0, "y_m": 40.0},
        ],
        "props": [
            {"id": "mg1", "kind": "mini_goal", "x_m": 54.0, "y_m": 14.0},
            {"id": "mg2", "kind": "mini_goal", "x_m": 54.0, "y_m": 54.0},
            {"id": "b1", "kind": "ball", "x_m": 59.5, "y_m": 34.0},
        ],
        "arrows": [
            {"from_x_m": 58.0, "from_y_m": 34.0, "to_x_m": 68.0, "to_y_m": 24.0, "kind": "pass"},
            {"from_x_m": 68.0, "from_y_m": 24.0, "to_x_m": 80.0, "to_y_m": 30.0, "kind": "pass"},
            {"from_x_m": 80.0, "from_y_m": 30.0, "to_x_m": 92.0, "to_y_m": 34.0, "kind": "pass"},
            {"from_x_m": 74.0, "from_y_m": 31.0, "to_x_m": 69.0, "to_y_m": 26.0, "kind": "press"},
        ],
        "zones": [{"x1_m": 54.0, "y1_m": 8.0, "x2_m": 96.0, "y2_m": 60.0, "label": "منطقة الخروج بالكرة"}],
    },
    {
        "drill_id": "alonso_zone14_third_man",
        "title_ar": "اختراق المنطقة 14 واللعب الثالث (أسلوب 3-4-2-1)",
        "title_en": "Zone 14 Penetration & Third-Man Overlap",
        "category_ar": "الثلث الهجومي",
        "category_en": "Final Third Patterns",
        "pitch_view": "half",
        "area_m": "45m × 58m",
        "duration_min": 22,
        "target_rpe": 6.5,
        "coaching_points_ar": [
            "الارتكاز يمرر داخل الممر النصفي لصانع اللعب بين الخطوط، ثم سندة فورية للظهير-الجناح المنطلق.",
            "المهاجم يسحب قلب الدفاع نحو القائم القريب لتفريغ نقطة الجزاء أمام صانع اللعب الثاني.",
            "التركيز على دقة العرضية الأرضية (Cutback) نحو حدود المنطقة 14.",
        ],
        "players": [
            {"id": "A1", "team": "a", "label": "6", "x_m": 60.0, "y_m": 30.0},
            {"id": "A2", "team": "a", "label": "8", "x_m": 61.0, "y_m": 41.0},
            {"id": "A3", "team": "a", "label": "LAM", "x_m": 77.0, "y_m": 25.0},
            {"id": "A4", "team": "a", "label": "RAM", "x_m": 78.0, "y_m": 44.0},
            {"id": "A5", "team": "a", "label": "RWB", "x_m": 82.0, "y_m": 57.0},
            {"id": "A6", "team": "a", "label": "LWB", "x_m": 74.0, "y_m": 12.0},
            {"id": "A7", "team": "a", "label": "9", "x_m": 90.0, "y_m": 34.0},
            {"id": "B1", "team": "b", "label": "GK", "x_m": 101.0, "y_m": 34.0},
        ],
        "props": [
            {"id": "m1", "kind": "mannequin", "x_m": 85.0, "y_m": 24.0},
            {"id": "m2", "kind": "mannequin", "x_m": 85.0, "y_m": 34.0},
            {"id": "m3", "kind": "mannequin", "x_m": 85.0, "y_m": 44.0},
            {"id": "m4", "kind": "mannequin", "x_m": 74.0, "y_m": 34.0},
            {"id": "b1", "kind": "ball", "x_m": 61.0, "y_m": 41.0},
        ],
        "arrows": [
            {"from_x_m": 61.0, "from_y_m": 41.0, "to_x_m": 78.0, "to_y_m": 44.0, "kind": "pass"},
            {"from_x_m": 78.0, "from_y_m": 44.0, "to_x_m": 82.0, "to_y_m": 57.0, "kind": "pass"},
            {"from_x_m": 82.0, "from_y_m": 57.0, "to_x_m": 95.0, "to_y_m": 54.0, "kind": "run"},
            {"from_x_m": 95.0, "from_y_m": 54.0, "to_x_m": 91.0, "to_y_m": 35.0, "kind": "pass"},
        ],
        "zones": [{"x1_m": 72.0, "y1_m": 22.0, "x2_m": 88.5, "y2_m": 46.0, "label": "Zone 14"}],
    },
    {
        "drill_id": "gegenpress_transition_box",
        "title_ar": "مربع التحولات السريعة والإنهاء (< 8 ثوانٍ)",
        "title_en": "Transition Overload & 8-Second Counter Finishing",
        "category_ar": "التحولات والسرعة",
        "category_en": "Attack-to-Defense Transition",
        "pitch_view": "full",
        "area_m": "65m × 52m",
        "duration_min": 20,
        "target_rpe": 7.5,
        "coaching_points_ar": [
            "أقصى زمن من استرجاع الكرة إلى التسديد داخل الصندوق لا يتجاوز 8 ثوانٍ.",
            "انطلاق الجناحين قطرياً خلف أظهرة الخصم بمجرد رفع حامل الكرة رأسه.",
        ],
        "players": [
            {"id": "A1", "team": "a", "label": "6", "x_m": 46.0, "y_m": 34.0},
            {"id": "A2", "team": "a", "label": "10", "x_m": 55.0, "y_m": 34.0},
            {"id": "A3", "team": "a", "label": "RW", "x_m": 62.0, "y_m": 52.0},
            {"id": "A4", "team": "a", "label": "LW", "x_m": 62.0, "y_m": 16.0},
            {"id": "A5", "team": "a", "label": "9", "x_m": 68.0, "y_m": 34.0},
            {"id": "B1", "team": "b", "label": "CB1", "x_m": 74.0, "y_m": 27.0},
            {"id": "B2", "team": "b", "label": "CB2", "x_m": 74.0, "y_m": 41.0},
            {"id": "B3", "team": "b", "label": "GK", "x_m": 100.0, "y_m": 34.0},
        ],
        "props": [
            {"id": "c1", "kind": "cone", "x_m": 42.0, "y_m": 14.0},
            {"id": "c2", "kind": "cone", "x_m": 42.0, "y_m": 54.0},
            {"id": "b1", "kind": "ball", "x_m": 47.0, "y_m": 34.0},
        ],
        "arrows": [
            {"from_x_m": 46.0, "from_y_m": 34.0, "to_x_m": 55.0, "to_y_m": 34.0, "kind": "pass"},
            {"from_x_m": 55.0, "from_y_m": 34.0, "to_x_m": 78.0, "to_y_m": 22.0, "kind": "pass"},
            {"from_x_m": 62.0, "from_y_m": 16.0, "to_x_m": 82.0, "to_y_m": 25.0, "kind": "run"},
        ],
        "zones": [{"x1_m": 42.0, "y1_m": 12.0, "x2_m": 92.0, "y2_m": 56.0, "label": "مسار التحول 8 ث"}],
    },
    {
        "drill_id": "back4_compactness_shifting",
        "title_ar": "ترحيل خط الدفاع الرباعي وحماية العمق",
        "title_en": "Back-4 Shifting & Blind-Side Cover",
        "category_ar": "التنظيم الدفاعي",
        "category_en": "Defensive Compactness",
        "pitch_view": "half",
        "area_m": "40m × 64m",
        "duration_min": 20,
        "target_rpe": 5.5,
        "coaching_points_ar": [
            "المسافة العرضية بين قلبي الدفاع لا تتجاوز 9 أمتار أثناء ترحيل الكرة للأطراف.",
            "الظهير العكسي يغلق عمق المنطقة بنصف خطوة داخل القائم القريب عند تحضير العرضية.",
        ],
        "players": [
            {"id": "A1", "team": "a", "label": "GK", "x_m": 99.0, "y_m": 34.0},
            {"id": "A2", "team": "a", "label": "RB", "x_m": 84.0, "y_m": 52.0},
            {"id": "A3", "team": "a", "label": "RCB", "x_m": 86.0, "y_m": 41.0},
            {"id": "A4", "team": "a", "label": "LCB", "x_m": 86.0, "y_m": 31.0},
            {"id": "A5", "team": "a", "label": "LB", "x_m": 83.0, "y_m": 18.0},
            {"id": "B1", "team": "b", "label": "LW", "x_m": 74.0, "y_m": 55.0},
            {"id": "B2", "team": "b", "label": "10", "x_m": 71.0, "y_m": 36.0},
            {"id": "B3", "team": "b", "label": "RW", "x_m": 75.0, "y_m": 15.0},
        ],
        "props": [{"id": "b1", "kind": "ball", "x_m": 74.0, "y_m": 55.0}],
        "arrows": [
            {"from_x_m": 84.0, "from_y_m": 52.0, "to_x_m": 79.0, "to_y_m": 54.0, "kind": "press"},
            {"from_x_m": 83.0, "from_y_m": 18.0, "to_x_m": 86.0, "to_y_m": 27.0, "kind": "run"},
        ],
        "zones": [{"x1_m": 81.0, "y1_m": 14.0, "x2_m": 92.0, "y2_m": 56.0, "label": "سلسلة الدفاع"}],
    },
    {
        "drill_id": "corner_near_post_decoy",
        "title_ar": "الركنية الهجومية (سحب القائم الأول + الاختراق)",
        "title_en": "Attacking Corner (Near-Post Decoy & Late Arrival)",
        "category_ar": "الكرات الثابتة",
        "category_en": "Set-Pieces",
        "pitch_view": "corner",
        "area_m": "25m × 44m",
        "duration_min": 15,
        "target_rpe": 4.0,
        "coaching_points_ar": [
            "مهاجم ينطلق للقائم الأول لسحب مدافع المراقبة (Decoy)، مع دخول قلب الدفاع القوي خلفه.",
            "الحفاظ على 3 لاعبين خارج الصندوق كشبكة أمان (Rest Defense) ضد المرتدات.",
        ],
        "players": [
            {"id": "A1", "team": "a", "label": "TRG", "x_m": 94.0, "y_m": 33.0},
            {"id": "A2", "team": "a", "label": "DEC", "x_m": 95.5, "y_m": 40.0},
            {"id": "A3", "team": "a", "label": "BLK", "x_m": 97.5, "y_m": 31.0},
            {"id": "A4", "team": "a", "label": "EDGE", "x_m": 84.0, "y_m": 34.0},
            {"id": "A5", "team": "a", "label": "CRN", "x_m": 103.8, "y_m": 66.5},
            {"id": "B1", "team": "b", "label": "GK", "x_m": 103.5, "y_m": 34.0},
            {"id": "B2", "team": "b", "label": "Z1", "x_m": 99.5, "y_m": 36.5},
            {"id": "B3", "team": "b", "label": "Z2", "x_m": 99.5, "y_m": 31.5},
        ],
        "props": [{"id": "b1", "kind": "ball", "x_m": 104.2, "y_m": 67.2}],
        "arrows": [
            {"from_x_m": 104.2, "from_y_m": 67.2, "to_x_m": 97.5, "to_y_m": 34.0, "kind": "pass"},
            {"from_x_m": 94.0, "from_y_m": 33.0, "to_x_m": 98.0, "to_y_m": 34.0, "kind": "run"},
            {"from_x_m": 95.5, "from_y_m": 40.0, "to_x_m": 100.0, "to_y_m": 42.5, "kind": "run"},
        ],
        "zones": [{"x1_m": 94.0, "y1_m": 27.0, "x2_m": 103.5, "y2_m": 41.0, "label": "منطقة القائم الحاسمة"}],
    },
]


def compute_session_load(duration_min: float, target_rpe: float) -> dict[str, Any]:
    """Compute Foster session-RPE (sRPE AU) and load classification deterministically."""
    dur = max(10.0, min(150.0, float(duration_min)))
    rpe = max(1.0, min(10.0, float(target_rpe)))
    srpe_au = round(dur * rpe, 1)
    if rpe >= 8.5:
        zone, zone_ar = "match", "حمل مباراة أقصى"
    elif rpe >= 6.5:
        zone, zone_ar = "high", "حمل عالٍ (تطويري)"
    elif rpe >= 4.5:
        zone, zone_ar = "moderate", "حمل متوسط (تكتيكي)"
    else:
        zone, zone_ar = "low", "حمل منخفض (استشفاء)"
    return {"duration_min": int(round(dur)), "target_rpe": round(rpe, 1), "srpe_au": srpe_au, "intensity": zone, "intensity_ar": zone_ar}


def evaluate_weekly_microcycle_safety(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    """Flag weekly overload (> 3200 AU) or consecutive high-RPE spikes (>= 8)."""
    total_au = round(sum(float(s.get("srpe_au") or 0.0) for s in sessions), 1)
    warnings: list[str] = []
    if total_au > 3200.0:
        warnings.append(f"تنبيه أحمال أسبوعي: مجموع الأسبوع {total_au} AU يتجاوز الحد الآمن (3200 AU) — يُنصح بتخفيض مدة MD-2.")
    sorted_s = sorted(sessions, key=lambda x: str(x.get("md_code") or ""))
    for i in range(1, len(sorted_s)):
        if float(sorted_s[i - 1].get("target_rpe") or 0) >= 8.0 and float(sorted_s[i].get("target_rpe") or 0) >= 8.0:
            warnings.append("تحذير تتابع الأحمال: حصتان متتاليتان بشدة RPE ≥ 8.0 ترفعان خطر الإجهاد العضلي.")
            break
    return {
        "total_weekly_au": total_au,
        "status": "warning" if warnings else "optimal",
        "warnings_ar": warnings,
    }


def _pick_drill(drill_id: Optional[str] = None, focus_topic: str = "") -> dict[str, Any]:
    if drill_id:
        for d in PRO_DRILLS_CATALOG:
            if d["drill_id"] == drill_id:
                return dict(d)
    low = (focus_topic or "").lower()
    if any(k in low for k in ("ركن", "ثابت", "corner", "set")):
        return dict(PRO_DRILLS_CATALOG[5])
    if any(k in low for k in ("بناء", "خلف", "ضغط عال", "buildup", "press")):
        return dict(PRO_DRILLS_CATALOG[1])
    if any(k in low for k in ("14", "ألونسو", "هجوم", "ثلث", "zone", "3-4-2-1")):
        return dict(PRO_DRILLS_CATALOG[2])
    if any(k in low for k in ("تحول", "مرتد", "transition", "سرع")):
        return dict(PRO_DRILLS_CATALOG[3])
    if any(k in low for k in ("دفاع", "ترحيل", "back", "تنظيم")):
        return dict(PRO_DRILLS_CATALOG[4])
    return dict(PRO_DRILLS_CATALOG[0])


def generate_custom_session_plan(
    club_name: str,
    md_code: str = "MD-3",
    focus_topic: str = "",
    tactical_formation: str = "4-2-3-1",
    available_players: Optional[list[dict[str, Any]]] = None,
    drill_id: Optional[str] = None,
    duration_min: Optional[int] = None,
    target_rpe: Optional[float] = None,
    session_date: Optional[str] = None,
) -> dict[str, Any]:
    """Generate a complete 4-phase coaching session grounded in available squad members."""
    tpl = WEEKLY_MICROCYCLE_TEMPLATES.get(md_code, WEEKLY_MICROCYCLE_TEMPLATES["MD-3"])
    chosen_drill = _pick_drill(drill_id or tpl.get("default_drill_id"), focus_topic)
    dur = duration_min if duration_min is not None else int(tpl["duration_min"])
    rpe = target_rpe if target_rpe is not None else float(tpl["target_rpe"])
    load = compute_session_load(dur, rpe)

    fit_pool = [p for p in (available_players or []) if p.get("is_eligible_starter", True)]
    if not fit_pool:
        fit_pool = list(available_players or [])

    drill_players = []
    for idx, node in enumerate(chosen_drill.get("players", [])):
        n_copy = dict(node)
        if n_copy.get("team") == "a" and idx < len(fit_pool):
            p = fit_pool[idx]
            n_copy["player_name"] = p.get("name_ar") or p.get("name_en") or n_copy["label"]
            n_copy["jersey_number"] = p.get("jersey_number")
            n_copy["label"] = str(p.get("jersey_number") or n_copy["label"])
        drill_players.append(n_copy)

    chosen_drill_inst = dict(chosen_drill)
    chosen_drill_inst["players"] = drill_players

    focus_line = focus_topic.strip() or tpl["focus_ar"]
    warmup_m = max(8, int(round(load["duration_min"] * 0.18)))
    tech_m = max(10, int(round(load["duration_min"] * 0.24)))
    tact_m = max(12, int(round(load["duration_min"] * 0.44)))
    cool_m = max(5, load["duration_min"] - (warmup_m + tech_m + tact_m))

    return {
        "session_id": f"sess_{md_code.lower()}_{int(datetime.now(timezone.utc).timestamp())}",
        "club_name": club_name,
        "md_code": tpl["md_code"],
        "title_ar": f"{tpl['md_code']} • {chosen_drill['title_ar']} ({tactical_formation})",
        "title_en": f"{tpl['md_code']} • {chosen_drill['title_en']} ({tactical_formation})",
        "session_date": session_date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "tactical_formation": tactical_formation,
        "focus_ar": focus_line,
        "available_players_count": len(fit_pool),
        **load,
        "phases": [
            {
                "phase": "warmup",
                "title_ar": "1. الإحماء الحركي وتفعيل المفاصل (RAMP)",
                "duration_min": warmup_m,
                "notes_ar": "إطالة ديناميكية، تغييرات اتجاه خفيفة، ولمس كرة ثنائي لإعداد الجهاز العصبي.",
            },
            {
                "phase": "technical",
                "title_ar": "2. الجزء المهاري والتمريرات المركّبة",
                "duration_min": tech_m,
                "notes_ar": f"أنماط تمرير مخصصة لتشكيل {tactical_formation} تحت ضغط زمني من لمستين.",
            },
            {
                "phase": "tactical",
                "title_ar": f"3. التمرين التكتيكي الرئيسي: {chosen_drill['title_ar']}",
                "duration_min": tact_m,
                "notes_ar": f"مساحة اللعب {chosen_drill['area_m']} • التركيز: {focus_line}",
            },
            {
                "phase": "cooldown",
                "title_ar": "4. التهدئة والاستشفاء وتقييم الـ RPE",
                "duration_min": cool_m,
                "notes_ar": "جري بطيء، إطالة ثابتة، وتسجيل مؤشر الإجهاد المدرك (RPE 1–10) لكل لاعب.",
            },
        ],
        "drill_setup": chosen_drill_inst,
        "coaching_points_ar": list(chosen_drill.get("coaching_points_ar") or []),
    }
