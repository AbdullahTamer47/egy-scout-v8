"""Deterministic Tactical Math Validator (V8.5 — Math-First Before LLM).

Evaluates any 22-player tactical formation (manual or AI-invented, including
asymmetric or unconventional shapes like 2-1-6-1 sweeper-keeper) using exact
FIFA pitch geometry (105m x 68m) to compute:
  - 5 Vertical Corridors Coverage (Left Wing, Left Half-Space, Center, Right Half-Space, Right Wing)
  - Rest-Defense Score (0-100) & Counter-Attack Exposure
  - Vertical Compactness & Horizontal Width
  - Grounded Strengths & Weaknesses/Risks in Arabic & English
"""
from __future__ import annotations

from typing import Any


CORRIDORS = [
    ("left_wing", "الجناح الأيسر", "Left Wing", 0.0, 13.6),
    ("left_half_space", "الممر النصفي الأيسر", "Left Half-Space", 13.6, 25.0),
    ("center", "العمق (المنطقة المركزية)", "Central Corridor", 25.0, 43.0),
    ("right_half_space", "الممر النصفي الأيمن", "Right Half-Space", 43.0, 54.4),
    ("right_wing", "الجناح الأيمن", "Right Wing", 54.4, 68.0),
]


def validate_tactical_plan(
    nodes_a: list[dict[str, Any]],
    nodes_b: list[dict[str, Any]] | None = None,
    formation_code: str = "",
) -> dict[str, Any]:
    """Compute exact geometric metrics, strengths, and counter-attack risks for Team A vs Team B."""
    nodes_b = nodes_b or []
    outfield_a = [n for n in nodes_a if str(n.get("slot", "")).upper() != "GK"]
    gk_a = next((n for n in nodes_a if str(n.get("slot", "")).upper() == "GK"), None)

    if not outfield_a:
        return {
            "overall_balance_score": 50,
            "rest_defense_score": 50,
            "half_spaces_score": 50,
            "rest_defenders_count": 0,
            "attacking_players_count": 0,
            "vertical_length_m": 0.0,
            "horizontal_width_m": 0.0,
            "corridors": [],
            "strengths_ar": ["أضف لاعبين إلى الملعب لحساب التوازن الهندسي."],
            "strengths_en": ["Add players to the pitch to compute tactical balance."],
            "vulnerabilities_ar": [],
            "vulnerabilities_en": [],
            "risk_level": "medium",
        }

    xs = [float(n.get("x_m", 52.5)) for n in outfield_a]
    ys = [float(n.get("y_m", 34.0)) for n in outfield_a]
    vert_len = round(max(xs) - min(xs), 1)
    horiz_w = round(max(ys) - min(ys), 1)

    # 1. Five Vertical Corridors Coverage
    corridors_out: list[dict[str, Any]] = []
    covered_corridors = 0
    half_space_players = 0
    empty_corridors_ar: list[str] = []
    empty_corridors_en: list[str] = []
    overloaded_ar: list[str] = []
    overloaded_en: list[str] = []

    for key, lbl_ar, lbl_en, y0, y1 in CORRIDORS:
        cnt = sum(1 for n in outfield_a if y0 <= float(n.get("y_m", 34.0)) < y1 or (y1 == 68.0 and float(n.get("y_m", 34.0)) == 68.0))
        if cnt > 0:
            covered_corridors += 1
        else:
            empty_corridors_ar.append(lbl_ar)
            empty_corridors_en.append(lbl_en)
        if cnt >= 4:
            overloaded_ar.append(f"{lbl_ar} ({cnt} لاعبين)")
            overloaded_en.append(f"{lbl_en} ({cnt} players)")
        if key in ("left_half_space", "right_half_space"):
            half_space_players += cnt
        corridors_out.append(
            {
                "id": key,
                "label_ar": lbl_ar,
                "label_en": lbl_en,
                "count": cnt,
                "status": "overload" if cnt >= 4 else ("covered" if cnt >= 1 else "empty"),
            }
        )

    half_spaces_score = int(min(100, round((covered_corridors / 5.0) * 65 + min(4, half_space_players) * 9)))

    # 2. Rest-Defense (defenders staying behind x <= 48m vs Opponent counter-attacking outlets x <= 62m)
    rest_defs = [n for n in outfield_a if float(n.get("x_m", 52.5)) <= 48.0]
    attackers = [n for n in outfield_a if float(n.get("x_m", 52.5)) >= 62.0]
    opp_outlets = [n for n in nodes_b if str(n.get("slot", "")).upper() != "GK" and float(n.get("x_m", 65.0)) <= 60.0]
    opp_threat = max(2, len(opp_outlets))

    rest_ratio = len(rest_defs) / max(1.0, float(opp_threat))
    rest_defense_score = int(max(12, min(100, round(rest_ratio * 58))))
    gk_sweeper = gk_a is not None and float(gk_a.get("x_m", 8.0)) >= 20.0
    if gk_sweeper:
        # Sweeper-keeper helps sweep balls in behind but leaves goal open to long-range chips
        rest_defense_score = max(15, rest_defense_score - 10)

    # 3. Zone 14 occupation (x in [68..88], y in [22..46])
    zone14_cnt = sum(
        1
        for n in outfield_a
        if 68.0 <= float(n.get("x_m", 52.5)) <= 88.0 and 22.0 <= float(n.get("y_m", 34.0)) <= 46.0
    )

    # 4. Build Concrete Grounded Strengths & Vulnerabilities
    strengths_ar: list[str] = []
    strengths_en: list[str] = []
    vulns_ar: list[str] = []
    vulns_en: list[str] = []

    if covered_corridors >= 5:
        strengths_ar.append("تغطية كاملة للممرات الخمسة (الأجنحة والممرات النصفية والعمق) لتمديد دفاع الخصم.")
        strengths_en.append("Full 5-corridor occupation stretches opponent horizontal compactness.")
    elif overloaded_ar:
        strengths_ar.append(f"تفوق عددي كاسح في {', '.join(overloaded_ar)} لخلق مواقف 2 ضد 1 و 3 ضد 2.")
        strengths_en.append(f"Heavy overload in {', '.join(overloaded_en)} to generate 2v1/3v2 superiority.")

    if zone14_cnt >= 2:
        strengths_ar.append(f"احتلال قوي للمنطقة 14 ({zone14_cnt} لاعبين) مما يضاعف فرص التمريرات الكاسرة للخطوط.")
        strengths_en.append(f"Strong Zone 14 occupation ({zone14_cnt} players) boosting line-breaking passes.")
    if len(attackers) >= 5:
        strengths_ar.append(f"ضغط هجومي شرس بـ {len(attackers)} لاعبين داخل الثلث الأخير لتثبيت خط ظهر الخصم.")
        strengths_en.append(f"Aggressive final-third presence ({len(attackers)} attackers) pinning the opposition backline.")
    if 28.0 <= vert_len <= 48.0:
        strengths_ar.append(f"ترابط طولي مثالي بين الخطوط ({vert_len} متر) يسهّل الضغط العكسي الفوري.")
        strengths_en.append(f"Ideal vertical compactness ({vert_len}m) enabling immediate counter-pressing.")
    if not strengths_ar:
        strengths_ar.append(f"تشكيل متوازن ({formation_code or 'مخصص'}) بعرض {horiz_w}م وطول {vert_len}م.")
        strengths_en.append(f"Balanced shape ({formation_code or 'Custom'}) spanning {horiz_w}m wide by {vert_len}m deep.")

    # Vulnerabilities / Risks
    if len(rest_defs) <= 2:
        vulns_ar.append(
            f"خطر مرتدات مرتفع: وجود {len(rest_defs)} مدافعين فقط في الدفاع الوقائي (Rest-Defense) مقابل {opp_threat} مهاجمين للخصم."
        )
        vulns_en.append(
            f"High counter-attack exposure: only {len(rest_defs)} rest-defenders vs {opp_threat} opposition outlets."
        )
    if gk_sweeper and gk_a is not None:
        vulns_ar.append(
            f"مخاطرة الحارس المتقدم (GK عند X={gk_a.get('x_m')}م): المرمى مكشوف للتسديدات الساقطة المباشرة عند فقدان الكرة."
        )
        vulns_en.append(
            f"Sweeper-Keeper risk (GK at X={gk_a.get('x_m')}m): open goal vulnerable to immediate long-range lobs on turnover."
        )
    if empty_corridors_ar:
        vulns_ar.append(f"مساحات فارغة في: {', '.join(empty_corridors_ar)} — قد يستغلها الخصم لتغيير اللعب (Switch of Play).")
        vulns_en.append(f"Unoccupied corridors: {', '.join(empty_corridors_en)} — vulnerable to quick diagonal switches.")
    if vert_len > 56.0:
        vulns_ar.append(f"تباعد طولي كبير بين الدفاع والهجوم ({vert_len}م) يفتح فجوات وسط الملعب للخصم.")
        vulns_en.append(f"Stretched vertical block ({vert_len}m) exposing central spaces between lines.")
    if not vulns_ar:
        vulns_ar.append("لا توجد ثغرة هندسية حرجة؛ راقب فقط التحولات السريعة خلف الأظهرة المتقدمة.")
        vulns_en.append("No critical structural flaw; monitor transition channels behind advancing fullbacks.")

    overall = int(round(0.45 * half_spaces_score + 0.40 * rest_defense_score + 0.15 * (100 if 28 <= vert_len <= 52 else 65)))
    risk_level = "high" if rest_defense_score < 45 or gk_sweeper else ("medium" if rest_defense_score < 70 else "low")

    return {
        "overall_balance_score": overall,
        "rest_defense_score": rest_defense_score,
        "half_spaces_score": half_spaces_score,
        "rest_defenders_count": len(rest_defs),
        "attacking_players_count": len(attackers),
        "vertical_length_m": vert_len,
        "horizontal_width_m": horiz_w,
        "corridors": corridors_out,
        "strengths_ar": strengths_ar,
        "strengths_en": strengths_en,
        "vulnerabilities_ar": vulns_ar,
        "vulnerabilities_en": vulns_en,
        "risk_level": risk_level,
    }
