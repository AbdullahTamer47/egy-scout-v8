"""Authentic 2026/27 Club Tactical Profiles & 3-Phase Identity (Zero Coach Names)."""
from __future__ import annotations

from typing import Any

# Phase numbering enforced cleanly across UI & Backend:
# 1 = defense (الدفاع), 2 = possession (الاستحواذ), 3 = attack (الهجوم)
CLUB_TACTICAL_PROFILES: dict[str, dict[str, Any]] = {
    "al_ahly": {
        "default_formation": "4-2-3-1",
        "line_height": "high",
        "pressing_style": "gegenpress",
        "phase_shapes": {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-3-5"},
        "identity_ar": "بناء هجومي منظّم بـ 4-2-3-1 تتحول إلى 3-2-5 في الاستحواذ مع ضغط عالٍ مباشر بعد فقدان الكرة وتكثيف الممرات النصفية.",
        "identity_en": "Structured 4-2-3-1 morphing to 3-2-5 in possession with immediate counter-pressing and half-space overloads.",
    },
    "zamalek": {
        "default_formation": "4-2-3-1",
        "line_height": "mid",
        "pressing_style": "trigger",
        "phase_shapes": {"defense": "4-4-2", "possession": "4-2-3-1", "attack": "3-2-5"},
        "identity_ar": "سيطرة محورية في وسط الملعب بالـ 4-2-3-1 مع تبادل مراكز ثنائي صناعة اللعب والاختراق القطري من الأطراف.",
        "identity_en": "Midfield-controlled 4-2-3-1 relying on technical central combinations and inverted wingers.",
    },
    "pyramids": {
        "default_formation": "4-3-3",
        "line_height": "high",
        "pressing_style": "trigger",
        "phase_shapes": {"defense": "4-1-4-1", "possession": "3-2-4-1", "attack": "2-3-5"},
        "identity_ar": "تحولات هجومية سريعة بالـ 4-3-3 مع انطلاقات الأجنحة المباشرة في المساحة خلف أظهرة الخصم.",
        "identity_en": "Vertical 4-3-3 targeting direct wide transitions and aggressive wing-back overlaps.",
    },
    "al_masry": {
        "default_formation": "4-2-3-1",
        "line_height": "mid",
        "pressing_style": "trigger",
        "phase_shapes": {"defense": "4-4-2", "possession": "4-2-3-1", "attack": "4-2-4"},
        "identity_ar": "تنظيم دفاعي متوسط متماسك 4-4-2 والتحول السريع عبر الجناحين إلى العمق.",
        "identity_en": "Compact mid-block 4-4-2 transitioning rapidly through wide channels.",
    },
    "ceramica": {
        "default_formation": "4-2-3-1",
        "line_height": "mid",
        "pressing_style": "trigger",
        "phase_shapes": {"defense": "4-4-1-1", "possession": "3-2-5", "attack": "3-2-5"},
        "identity_ar": "بناء لعب هادئ من الارتكازين مع تثبيت صانع الألعاب بين خطوط الخصم.",
        "identity_en": "Measured double-pivot progression feeding #10 pockets between defensive lines.",
    },
    "manchester_city": {
        "default_formation": "3-2-4-1",
        "line_height": "high",
        "pressing_style": "gegenpress",
        "phase_shapes": {"defense": "4-4-2", "possession": "3-2-4-1", "attack": "2-3-5"},
        "identity_ar": "صعود الظهير/القلب للمحور لتشكيل مربع وسط 3-2-4-1 يخنق التحولات ويستحوذ على الثلث الأخير.",
        "identity_en": "Box-midfield 3-2-4-1 in possession pinning opponents inside their defensive third with 3+2 rest defense.",
    },
    "arsenal": {
        "default_formation": "4-3-3",
        "line_height": "high",
        "pressing_style": "gegenpress",
        "phase_shapes": {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-3-5"},
        "identity_ar": "ضغط عالٍ منظم 4-4-2 والتحول في الاستحواذ إلى 3-2-5 مع دخول الظهير المقلوب وتفوق الممر النصفي.",
        "identity_en": "High 4-4-2 press and 3-2-5 positional structure with inverted full-back progression.",
    },
    "liverpool": {
        "default_formation": "4-2-3-1",
        "line_height": "high",
        "pressing_style": "gegenpress",
        "phase_shapes": {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-4-4"},
        "identity_ar": "ضغط عكسي مكثف وتحول عمودي سريع على الأطراف لاستغلال سرعة المهاجمين.",
        "identity_en": "Relentless counter-pressing and rapid vertical transitions into wide forwards.",
    },
    "real_madrid": {
        "default_formation": "4-3-3",
        "line_height": "mid",
        "pressing_style": "trigger",
        "phase_shapes": {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-4-4"},
        "identity_ar": "مرونة هجومية مع تحميل الجبهة اليسرى وتناوب الثلاثي الأمامي في العمق والمساحات النصفية.",
        "identity_en": "Fluid left-side overload 4-3-3 with asymmetric attacking rotations and lethal transitions.",
    },
    "barcelona": {
        "default_formation": "4-2-3-1",
        "line_height": "high",
        "pressing_style": "gegenpress",
        "phase_shapes": {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-3-5"},
        "identity_ar": "خط دفاع متقدم جداً لمصيدة التسلل وضغط عالٍ لاستعادة الكرة في نصف ملعب الخصم.",
        "identity_en": "Aggressive high offside line and 3-2-5 positional play creating central overloads.",
    },
    "inter": {
        "default_formation": "3-5-2",
        "line_height": "mid",
        "pressing_style": "trigger",
        "phase_shapes": {"defense": "5-3-2", "possession": "3-5-2", "attack": "3-3-4"},
        "identity_ar": "ثلاثي دفاعي صلب وتناوب ثلاثي الوسط مع ثنائي هجومي متكامل والأظهرة الطائرة.",
        "identity_en": "Dynamic 3-5-2 with rotating midfield triangles, overlapping wing-backs, and twin strikers.",
    },
    "bayern": {
        "default_formation": "4-2-3-1",
        "line_height": "high",
        "pressing_style": "gegenpress",
        "phase_shapes": {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-3-5"},
        "identity_ar": "ضغط شرس في الثلث الهجومي مع سيطرة المحورين ودخول الأجنحة للتسديد من العمق.",
        "identity_en": "Dominant 4-2-3-1 pressing front-foot with double-pivot control and inverted wing threats.",
    },
    "bayer_leverkusen": {
        "default_formation": "3-4-2-1",
        "line_height": "high",
        "pressing_style": "gegenpress",
        "phase_shapes": {"defense": "5-4-1", "possession": "3-4-2-1", "attack": "3-2-5"},
        "identity_ar": "تنظيم 3-4-2-1 بصعود الأظهرة الطائرة بالكامل وتمركز صانعي الألعاب خلف المهاجم الصريح.",
        "identity_en": "Classic 3-4-2-1 stretching width with high wing-backs and twin #10 pockets.",
    },
    "psg": {
        "default_formation": "4-3-3",
        "line_height": "high",
        "pressing_style": "gegenpress",
        "phase_shapes": {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-3-5"},
        "identity_ar": "استحواذ عالٍ بالـ 4-3-3 مع تبادل المراكز الهجومي وضغط فوري في نصف ملعب المنافس.",
        "identity_en": "Possession-heavy 4-3-3 with fluid front-three rotations and aggressive counter-pressing.",
    },
}

_NAME_ALIASES: list[tuple[tuple[str, ...], str]] = [
    (("ahly", "الأهلي", "الاهلي"), "al_ahly"),
    (("zamalek", "الزمالك"), "zamalek"),
    (("pyramids", "بيراميدز"), "pyramids"),
    (("masry", "المصري"), "al_masry"),
    (("ceramica", "سيراميكا"), "ceramica"),
    (("manchester city", "man city", "مانشستر سيتي"), "manchester_city"),
    (("arsenal", "أرسنال", "ارسنال"), "arsenal"),
    (("liverpool", "ليفربول"), "liverpool"),
    (("real madrid", "ريال مدريد"), "real_madrid"),
    (("barcelona", "برشلونة"), "barcelona"),
    (("inter", "إنتر", "انتر"), "inter"),
    (("bayern", "بايرن"), "bayern"),
    (("leverkusen", "ليفركوزن"), "bayer_leverkusen"),
    (("paris", "psg", "باريس"), "psg"),
]


def get_club_tactical_profile(club: dict[str, Any]) -> dict[str, Any]:
    """Resolve a club's authentic tactical profile in Defense -> Possession -> Attack."""
    cid = str(club.get("club_id") or "").lower().strip()
    nm_en = str(club.get("name_en") or "").lower()
    nm_ar = str(club.get("name_ar") or "")

    prof = CLUB_TACTICAL_PROFILES.get(cid)
    if not prof:
        for kws, key in _NAME_ALIASES:
            if any(k in nm_en or k in nm_ar or k in cid for k in kws):
                prof = CLUB_TACTICAL_PROFILES.get(key)
                break

    if prof:
        return {**prof, "source": "club_tactical_dna_2026_27"}

    # Infer authentic default formation from actual squad depth
    players = list(club.get("players") or [])
    cbs = sum(1 for p in players if p.get("position") == "CB")
    rwb_lwb = sum(1 for p in players if p.get("position") in ("RWB", "LWB"))
    wingers = sum(1 for p in players if p.get("position") in ("RW", "LW"))
    sts = sum(1 for p in players if p.get("position") in ("ST", "CF"))
    cams = sum(1 for p in players if p.get("position") == "CAM")

    if cbs >= 5 and rwb_lwb >= 2:
        fmt = "3-4-2-1" if wingers >= 2 or cams >= 2 else "3-5-2"
        shapes = {"defense": "5-3-2" if fmt == "3-5-2" else "5-4-1", "possession": fmt, "attack": "3-2-5"}
    elif wingers >= 3 and cams <= 1:
        fmt = "4-3-3"
        shapes = {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-3-5"}
    elif sts >= 4 and cams == 0:
        fmt = "4-4-2"
        shapes = {"defense": "4-4-2", "possession": "4-2-2-2", "attack": "2-4-4"}
    else:
        fmt = "4-2-3-1"
        shapes = {"defense": "4-4-2", "possession": "3-2-5", "attack": "2-3-5"}

    rank = int(club.get("live_rank") or 8)
    line_h = "high" if rank <= 4 else "mid" if rank <= 12 else "low"
    press = "gegenpress" if rank <= 3 else "trigger" if rank <= 12 else "contain"

    return {
        "default_formation": fmt,
        "line_height": line_h,
        "pressing_style": press,
        "phase_shapes": shapes,
        "identity_ar": f"تنظيم متوازن {fmt} يتدرج في الاستحواذ إلى {shapes['possession']} ويعود في الدفاع إلى {shapes['defense']}.",
        "identity_en": f"Balanced {fmt} transitioning to {shapes['possession']} on ball and {shapes['defense']} out of possession.",
        "source": "inferred_from_live_squad",
    }
