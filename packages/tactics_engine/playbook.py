"""Diagnostic Tactical Playbook (Master Plan V8, Section 16 — Level 1).

Detects concrete tactical breakdowns from real pitch coordinates and maps each
to 3 coach-ready options (Conservative / Balanced / Aggressive) with explicit risks.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
import pandas as pd


@dataclass
class TacticalOption:
    style: str  # conservative | balanced | aggressive
    title_ar: str
    title_en: str
    action_ar: str
    action_en: str
    risk_ar: str
    risk_en: str


@dataclass
class TacticalDiagnosis:
    code: str
    severity: str  # high | medium
    title_ar: str
    title_en: str
    evidence_ar: str
    evidence_en: str
    frame_id: int
    options: list[TacticalOption]

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "title_ar": self.title_ar,
            "title_en": self.title_en,
            "evidence_ar": self.evidence_ar,
            "evidence_en": self.evidence_en,
            "frame_id": self.frame_id,
            "options": [asdict(o) for o in self.options],
        }


PLAYBOOK_SOLUTIONS: dict[str, list[TacticalOption]] = {
    "zone_14_exposure": [
        TacticalOption(
            style="conservative",
            title_ar="ارتكاز مزدوج (4-2-3-1)",
            title_en="Double Pivot Lock (4-2-3-1)",
            action_ar="تثبيت ثنائي ارتكاز أمام قلبي الدفاع بتباعد عرضي < 12م لإغلاق المنطقة 14.",
            action_en="Lock a double pivot ahead of CBs with < 12m horizontal spacing to seal Zone 14.",
            risk_ar="يقلل العدد الهجومي في الثلث الأخير بـ 1 لاعب.",
            risk_en="Reduces final-third attacking presence by 1 player.",
        ),
        TacticalOption(
            style="balanced",
            title_ar="تضييق ثلاثي الوسط (Compact 4-3-3)",
            title_en="Compact Midfield Shuttle (4-3-3)",
            action_ar="توجيه لاعب الوسط الأقرب للكرة لغلق زاوية التمرير القطري نحو المنطقة 14.",
            action_en="Shift ball-side #8 inside to screen diagonal passes into Zone 14.",
            risk_ar="يفتح نسبياً الجبهة العكسية للتحويل الطولي.",
            risk_en="Leaves far-side switch temporarily open.",
        ),
        TacticalOption(
            style="aggressive",
            title_ar="خروج قلب الدفاع للمراقبة اللصيقة",
            title_en="Aggressive CB Step-Out",
            action_ar="قفز قلب الدفاع مع المستلم في المنطقة 14 مع تغطية فورية من الارتكاز خلفه.",
            action_en="CB steps aggressively into Zone 14 while DM drops into the backline cover shadow.",
            risk_ar="مخاطرة انطلاق مهاجم الخصم في المساحة خلف قلب الدفاع.",
            risk_en="Risks a blind-side channel run behind the stepping CB.",
        ),
    ],
    "broken_backline": [
        TacticalOption(
            style="conservative",
            title_ar="خفض الخط 6 أمتار وتوحيد المرجعية",
            title_en="Drop Backline 6m & Reset Alignment",
            action_ar="إرجاع خط الدفاع 6م مع ربط المسافة بين قلبي الدفاع بـ ≤ 10م لإلغاء ثغرات العمق.",
            action_en="Drop defensive line 6m and tighten CB spacing <= 10m to remove depth gaps.",
            risk_ar="يمنح الخصم مساحة أكبر للتسديد من خارج الصندوق.",
            risk_en="Concedes extra space for long-range shots.",
        ),
        TacticalOption(
            style="balanced",
            title_ar="إعادة ضبط مصيدة التسلل بقائد الخط",
            title_en="Leader-Cued Offside Step",
            action_ar="تحديد قلب الدفاع الأيمن كمرجع وحيد للارتفاع المتزامن عند عودة الكرة للخلف.",
            action_en="Assign RCB as single vertical cue to step in unison on backward passes.",
            risk_ar="يتطلب تواصلاً لفظياً فورياً لتفادي كسر فردي للتسلل.",
            risk_en="Requires instant vocal sync to avoid individual lag.",
        ),
        TacticalOption(
            style="aggressive",
            title_ar="ضغط عكسي فوري على حامل الكرة",
            title_en="Immediate Counter-Press on Passer",
            action_ar="منع التمريرة البينية بضغط ثنائي على حامل الكرة قبل رفع رأسه.",
            action_en="Double-press the ball carrier to deny head-up through balls.",
            risk_ar="لو تخطى الخصم الضغط الأول ينكشف الملعب بالكامل.",
            risk_en="Bypassing the first press exposes large transition space.",
        ),
    ],
    "blind_side_run_lost": [
        TacticalOption(
            style="conservative",
            title_ar="تعديل زاوية الجسم 45° لمتابعة الكرة والمهاجم",
            title_en="45-Degree Open Body Orientation",
            action_ar="توجيه المدافع للوقوف بزاوية مفتوحة تتيح رؤية الكرة والمهاجم معاً قبل العرضية.",
            action_en="Orient defender torso at 45° to track both ball and blind-side runner simultaneously.",
            risk_ar="تضحية طفيفة بسرعة الالتفاف للجهة العكسية.",
            risk_en="Slightly slower turn toward the near touchline.",
        ),
        TacticalOption(
            style="balanced",
            title_ar="تسليم واستلام الرقابة مع الظهير العكسي",
            title_en="Weak-Side Fullback Tuck-In",
            action_ar="دخول الظهير العكسي للقائم البعيد لغلق المساحة العمياء خلف قلب الدفاع.",
            action_en="Tuck weak-side FB into back-post channel to absorb blind-side runs.",
            risk_ar="ترك الجناح العكسي حراً على خط التماس.",
            risk_en="Leaves far-side winger free on the touchline.",
        ),
        TacticalOption(
            style="aggressive",
            title_ar="تقدم الحارس لقطع الكرة البينية (Sweeper)",
            title_en="Sweeper-Keeper Proactive Claim",
            action_ar="تقدم الحارس 3–4م لقراءة المسار العرضي وقطع الكرة قبل وصولها للمهاجم.",
            action_en="Advance GK 3-4m to intercept the through-ball/cross before the runner arrives.",
            risk_ar="مخاطرة كرة ساقطة أو ارتداد ثانٍ إن أخطأ التوقيت.",
            risk_en="Vulnerable to chip/rebound if timing is mistimed.",
        ),
    ],
    "rest_defense_underload": [
        TacticalOption(
            style="conservative",
            title_ar="الظهير المقلوب لتثبيت 3 مدافعين (3+2)",
            title_en="Inverted Fullback (3+2 Rest-Defense)",
            action_ar="تثبيت الظهير العكسي بجانب قلبي الدفاع لضمان تفوق +1 دائم ضد مهاجمي الخصم.",
            action_en="Invert weak-side FB alongside CBs to guarantee permanent +1 rest-defense overload.",
            risk_ar="يقلل الكثافة العرضية على الجبهة العكسية.",
            risk_en="Reduces overlapping width on the weak flank.",
        ),
        TacticalOption(
            style="balanced",
            title_ar="تأمين الارتكاز في منتصف الملعب",
            title_en="Holding DM Transition Screen",
            action_ar="منع صعود رقم 6 خلف خط الكرة وتكليفه بتعطيل أول تمريرة مرتدة.",
            action_en="Anchor #6 behind the ball to delay or foul-stop the first counter pass.",
            risk_ar="إجهاد بدني أعلى على لاعب الارتكاز وخطر إنذار مبكر.",
            risk_en="Higher physical load on #6 and tactical-foul card risk.",
        ),
        TacticalOption(
            style="aggressive",
            title_ar="مصيدة ضغط عكسي 5 ثوانٍ",
            title_en="5-Second Counter-Press Trap",
            action_ar="تطويق منطقة فقدان الكرة بـ 3 لاعبين لاستعادتها قبل انطلاق التحول.",
            action_en="Swarm the ball-loss zone with 3 players for 5s to kill transitions at source.",
            risk_ar="استنزاف بدني عالٍ بعد الدقيقة 65.",
            risk_en="High fatigue drain after minute 65.",
        ),
    ],
    "high_press_buildup_failure": [
        TacticalOption(
            style="conservative",
            title_ar="اللعب المباشر خلف الظهير المندفع",
            title_en="Direct Bypass Behind Advancing FB",
            action_ar="كسر الضغط بتمريرة طويلة موجهة للثلث الأوسط/خلف الظهير مع صعود للفوز بالكرة الثانية.",
            action_en="Bypass press via targeted direct ball into channel + midfield swarm for 2nd ball.",
            risk_ar="تراجع نسبي في نسبة الاستحواذ الإجمالية.",
            risk_en="Lower overall possession percentage.",
        ),
        TacticalOption(
            style="balanced",
            title_ar="إنزال رقم 6 بين قلبي الدفاع (Salida Lavolpiana)",
            title_en="Salida Lavolpiana (3v2 Build-Up)",
            action_ar="هبوط الارتكاز لخلق تفوق 3 ضد 2 في الخط الأول وفتح زوايا تمرير للأظهرة.",
            action_en="Drop #6 between CBs to establish a clean 3v2 first-line overload.",
            risk_ar="يفرغ منتصف الملعب مؤقتاً إن لم ينزل رقم 8 لاستلام الكرة.",
            risk_en="Empties central midfield unless #8 drops to link.",
        ),
        TacticalOption(
            style="aggressive",
            title_ar="استخدام الحارس كلاعب زائد (+1)",
            title_en="GK +1 Bait & Split",
            action_ar="استدراج ضغط الخصم داخل الصندوق ثم التمرير العمودي للاعب الحر بين الخطوط.",
            action_en="Bait press via GK to create a free man between lines for a vertical split pass.",
            risk_ar="أعلى خطورة لخسارة الكرة أمام المرمى عند خطأ التمرير.",
            risk_en="Highest turnover severity near own goal on mispass.",
        ),
    ],
}


def get_playbook_catalog() -> dict[str, list[dict[str, Any]]]:
    return {k: [asdict(o) for o in opts] for k, opts in PLAYBOOK_SOLUTIONS.items()}


def diagnose_frame_tactics(
    frame_df: pd.DataFrame,
    defending_team: str = "team_b",
    frame_id: int = 1250,
    pitch_l: float = 105.0,
) -> list[TacticalDiagnosis]:
    """Analyze real player positions in a frame and return concrete tactical diagnoses."""
    attacking_team = "team_a" if defending_team == "team_b" else "team_b"
    valid = frame_df[
        frame_df["role"].isin(["player", "goalkeeper"])
        & frame_df["x_m"].notna()
        & frame_df["y_m"].notna()
    ]
    defs = valid[(valid["team"] == defending_team) & (valid["role"] == "player")]
    atts = valid[(valid["team"] == attacking_team) & (valid["role"] == "player")]

    diagnoses: list[TacticalDiagnosis] = []
    if len(defs) < 3 or len(atts) < 2:
        return diagnoses

    def_x = defs["x_m"].to_numpy(dtype=np.float32)
    def_y = defs["y_m"].to_numpy(dtype=np.float32)
    att_x = atts["x_m"].to_numpy(dtype=np.float32)
    att_y = atts["y_m"].to_numpy(dtype=np.float32)

    # 1. Broken Back-Line check (deepest defender > 3.0m behind back-4 mean)
    # Determine defending goal side from defender median x
    defending_right = float(np.median(def_x)) > (pitch_l / 2.0)
    sorted_dx = np.sort(def_x) if not defending_right else np.sort(def_x)[::-1]
    back4 = sorted_dx[: min(4, len(sorted_dx))]
    if len(back4) >= 3:
        drop_gap = float(abs(back4[0] - np.mean(back4[1:])))
        if drop_gap >= 3.0:
            diagnoses.append(
                TacticalDiagnosis(
                    code="broken_backline",
                    severity="high",
                    title_ar="كسر مصيدة التسلل وتفاوت خط الدفاع",
                    title_en="Broken Back-Line Alignment",
                    evidence_ar=f"أعمق مدافع ساقط بمقدار {drop_gap:.1f}م خلف متوسط خط الدفاع (الحد التكتيكي 3.0م).",
                    evidence_en=f"Deepest defender dropped {drop_gap:.1f}m behind backline mean (threshold 3.0m).",
                    frame_id=frame_id,
                    options=PLAYBOOK_SOLUTIONS["broken_backline"],
                )
            )

    # 2. Zone 14 Exposure (attacker in central edge-of-box zone with no defender within 5m)
    z14_x_lo, z14_x_hi = (pitch_l - 30.0, pitch_l - 16.5) if defending_right else (16.5, 30.0)
    for ax, ay in zip(att_x, att_y):
        if z14_x_lo <= ax <= z14_x_hi and 22.0 <= ay <= 46.0:
            nearest_def = float(np.min(np.hypot(def_x - ax, def_y - ay)))
            if nearest_def >= 5.0:
                diagnoses.append(
                    TacticalDiagnosis(
                        code="zone_14_exposure",
                        severity="high",
                        title_ar="انكشاف المنطقة 14 (Zone 14 Exposure)",
                        title_en="Zone 14 Unmarked Exposure",
                        evidence_ar=f"مهاجم حر في المنطقة 14 وأقرب مدافع على بُعد {nearest_def:.1f}م (> 5.0م).",
                        evidence_en=f"Attacker free in Zone 14 with nearest defender {nearest_def:.1f}m away (> 5.0m).",
                        frame_id=frame_id,
                        options=PLAYBOOK_SOLUTIONS["zone_14_exposure"],
                    )
                )
                break

    # 3. Blind-Side Marking Gap (attacker in final third with nearest defender > 3.5m)
    max_gap = 0.0
    for ax, ay in zip(att_x, att_y):
        in_final_third = (ax >= pitch_l - 35.0) if defending_right else (ax <= 35.0)
        if in_final_third:
            dmin = float(np.min(np.hypot(def_x - ax, def_y - ay)))
            max_gap = max(max_gap, dmin)
    if max_gap >= 3.5:
        diagnoses.append(
            TacticalDiagnosis(
                code="blind_side_run_lost",
                severity="medium",
                title_ar="فقدان الرقابة في الثلث الأخير",
                title_en="Final-Third Marking Gap Lost",
                evidence_ar=f"اتساع فجوة الرقابة داخل الثلث الأخير إلى {max_gap:.1f}م (الحد الآمن 3.5م).",
                evidence_en=f"Marking gap expanded to {max_gap:.1f}m inside the final third (safe limit 3.5m).",
                frame_id=frame_id,
                options=PLAYBOOK_SOLUTIONS["blind_side_run_lost"],
            )
        )

    # 4. Rest-Defense / Compactness check
    def_spread_x = float(def_x.max() - def_x.min())
    if def_spread_x > 34.0:
        diagnoses.append(
            TacticalDiagnosis(
                code="rest_defense_underload",
                severity="medium",
                title_ar="تباعد الخطوط وانكشاف الدفاع الوقائي",
                title_en="Vertical Stretch & Rest-Defense Risk",
                evidence_ar=f"الامتداد الطولي للفريق المدافع وصل إلى {def_spread_x:.1f}م (المثالي ≤ 32م).",
                evidence_en=f"Defending team vertical compactness stretched to {def_spread_x:.1f}m (ideal <= 32m).",
                frame_id=frame_id,
                options=PLAYBOOK_SOLUTIONS["rest_defense_underload"],
            )
        )

    # Zero-Fake Policy: if no geometric defect was measured, return empty list (never fabricate!)
    return diagnoses
