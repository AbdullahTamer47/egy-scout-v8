"""3-Mode Input Gate (Master Plan V8, Section 15.2).

Automatically classifies uploaded footage into:
  1. goal_clips   (< 90s or high cut rate on goal sequences): Goal Forensics ONLY, NO scouting ranking.
  2. highlights   (90s..1800s or discontinuous clock/high cuts): Micro-Mechanics Audit + explicit warning badge.
  3. full_match   (>= 1800s continuous or official half/full match): Full Fair Scouting & Talent Comparison.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

VideoMode = Literal["goal_clips", "highlights", "full_match"]


@dataclass
class InputModeAssessment:
    mode: VideoMode
    duration_s: float
    cut_rate_per_min: float
    allow_goal_forensics: bool
    allow_micro_mechanics: bool
    allow_overall_rating: bool
    allow_scouting_ranking: bool
    warning_ar: str
    warning_en: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def assess_video_input_mode(
    duration_s: float,
    shot_cuts: int = 0,
    continuous_clock: bool = True,
    declared_mode: str = "auto",
) -> InputModeAssessment:
    """Determine input mode and enforce fairness rules against the 'highlights trap'."""
    dur = max(0.0, float(duration_s))
    cut_rate = (shot_cuts / max(dur / 60.0, 0.25)) if dur > 0 else 0.0

    mode: VideoMode
    if declared_mode in ("goal_clips", "highlights", "full_match"):
        mode = declared_mode  # type: ignore[assignment]
    elif dur < 90.0:
        mode = "goal_clips"
    elif dur < 1800.0 or (not continuous_clock) or cut_rate > 12.0:
        mode = "highlights"
    else:
        mode = "full_match"

    if mode == "goal_clips":
        return InputModeAssessment(
            mode="goal_clips",
            duration_s=round(dur, 1),
            cut_rate_per_min=round(cut_rate, 2),
            allow_goal_forensics=True,
            allow_micro_mechanics=False,
            allow_overall_rating=False,
            allow_scouting_ranking=False,
            warning_ar="وضع لقطات الأهداف فقط: يُشغّل تشريح الهدف واقتراح الحل التكتيكي ولا يُدخل اللاعب في ترتيب الكشافة.",
            warning_en="Goal Clips Mode: runs Goal Forensics & tactical fixes only — excluded from scouting rankings.",
        )

    if mode == "highlights":
        return InputModeAssessment(
            mode="highlights",
            duration_s=round(dur, 1),
            cut_rate_per_min=round(cut_rate, 2),
            allow_goal_forensics=True,
            allow_micro_mechanics=True,
            allow_overall_rating=False,
            allow_scouting_ranking=False,
            warning_ar="عينة منتقاة (ملخص) — لا تقيس الالتزام الدفاعي أو الاستمرارية؛ يُنصح برفع 3 مباريات كاملة قبل التعاقد.",
            warning_en="Selected highlights sample — does not measure defensive work-rate or consistency; upload 3 full matches before signing.",
        )

    return InputModeAssessment(
        mode="full_match",
        duration_s=round(dur, 1),
        cut_rate_per_min=round(cut_rate, 2),
        allow_goal_forensics=True,
        allow_micro_mechanics=True,
        allow_overall_rating=True,
        allow_scouting_ranking=True,
        warning_ar="مباراة كاملة موثّقة: معيار الكشافة العادل مفعّل بالكامل.",
        warning_en="Verified full-match footage: Fair Scouting & Talent Comparison enabled.",
    )
