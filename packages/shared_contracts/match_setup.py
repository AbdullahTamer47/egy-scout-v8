"""Match Setup Wizard, Age-Scaled Thresholds, Bench/Sub State, & 4-Point Homography.

Covers Master Plan V8 Section 17:
- Formats: 11v11, 9v9, 7v7, 6v6, 5v5 (and custom)
- Age groups: Senior, Youth (U13-U18), U12 (U7-U12) with scaled speed/distance thresholds
- Offside automatically disabled in small-sided formats (5v5, 6v6, 7v7)
- Active player cap, rolling substitutions, red-card cap reduction, bench isolation
- 4-Point Homography calibration fallback for small-sided / academy pitches
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

import cv2
import numpy as np

MatchFormat = Literal["11v11", "9v9", "7v7", "6v6", "5v5"]
AgeGroup = Literal["senior", "youth", "u12"]
CalibrationMode = Literal["pnlcalib", "four_point"]

FORMAT_DEFAULTS: dict[str, dict[str, Any]] = {
    "11v11": {
        "players_per_side": 11,
        "pitch_length_m": 105.0,
        "pitch_width_m": 68.0,
        "offside_enabled": True,
        "rolling_subs": False,
        "max_subs": 5,
    },
    "9v9": {
        "players_per_side": 9,
        "pitch_length_m": 73.0,
        "pitch_width_m": 46.0,
        "offside_enabled": True,
        "rolling_subs": True,
        "max_subs": 99,
    },
    "7v7": {
        "players_per_side": 7,
        "pitch_length_m": 55.0,
        "pitch_width_m": 36.0,
        "offside_enabled": False,
        "rolling_subs": True,
        "max_subs": 99,
    },
    "6v6": {
        "players_per_side": 6,
        "pitch_length_m": 44.0,
        "pitch_width_m": 28.0,
        "offside_enabled": False,
        "rolling_subs": True,
        "max_subs": 99,
    },
    "5v5": {
        "players_per_side": 5,
        "pitch_length_m": 38.0,
        "pitch_width_m": 22.0,
        "offside_enabled": False,
        "rolling_subs": True,
        "max_subs": 99,
    },
}

AGE_SPEED_THRESHOLDS: dict[str, dict[str, float]] = {
    "senior": {"hir_kmh": 19.8, "sprint_kmh": 25.2, "vmax_ref_kmh": 32.0},
    "youth": {"hir_kmh": 17.5, "sprint_kmh": 22.0, "vmax_ref_kmh": 28.5},
    "u12": {"hir_kmh": 14.5, "sprint_kmh": 18.0, "vmax_ref_kmh": 23.0},
}


@dataclass
class MatchSetupConfig:
    match_id: str = "custom_match"
    match_format: MatchFormat = "11v11"
    age_group: AgeGroup = "senior"
    players_per_side: int = 11
    pitch_length_m: float = 105.0
    pitch_width_m: float = 68.0
    offside_enabled: bool = True
    rolling_subs: bool = False
    calibration_mode: CalibrationMode = "pnlcalib"
    auto_face_blur: bool = False
    red_cards_team_a: int = 0
    red_cards_team_b: int = 0
    four_point_pixels: Optional[list[list[float]]] = None  # 4 corners TL, TR, BR, BL

    @classmethod
    def from_format(
        cls,
        match_format: MatchFormat = "11v11",
        age_group: AgeGroup = "senior",
        match_id: str = "custom_match",
        pitch_length_m: Optional[float] = None,
        pitch_width_m: Optional[float] = None,
        calibration_mode: Optional[CalibrationMode] = None,
        auto_face_blur: Optional[bool] = None,
    ) -> "MatchSetupConfig":
        preset = FORMAT_DEFAULTS[match_format]
        cal: CalibrationMode = (
            calibration_mode
            if calibration_mode is not None
            else ("pnlcalib" if match_format == "11v11" else "four_point")
        )
        blur = auto_face_blur if auto_face_blur is not None else (age_group == "u12")
        return cls(
            match_id=match_id,
            match_format=match_format,
            age_group=age_group,
            players_per_side=int(preset["players_per_side"]),
            pitch_length_m=float(pitch_length_m or preset["pitch_length_m"]),
            pitch_width_m=float(pitch_width_m or preset["pitch_width_m"]),
            offside_enabled=bool(preset["offside_enabled"]),
            rolling_subs=bool(preset["rolling_subs"]),
            calibration_mode=cal,
            auto_face_blur=blur,
        )

    def active_cap(self, team: str) -> int:
        reds = self.red_cards_team_a if team == "team_a" else self.red_cards_team_b
        return max(1, self.players_per_side - max(0, reds))

    def speed_thresholds(self) -> dict[str, float]:
        return dict(AGE_SPEED_THRESHOLDS[self.age_group])

    def scaled_tactical_distances(self) -> dict[str, float]:
        """Scale tactical thresholds proportionally to pitch dimensions."""
        scale = min(self.pitch_length_m / 105.0, self.pitch_width_m / 68.0)
        return {
            "marking_gap_m": round(3.5 * scale, 2),
            "zone14_radius_m": round(5.0 * scale, 2),
            "backline_drop_m": round(3.0 * scale, 2),
            "compactness_target_m": round(32.0 * scale, 2),
            "touchline_margin_m": round(max(0.6, 1.2 * scale), 2),
        }

    def is_on_pitch(self, x_m: float, y_m: float, pad_m: float = 0.5) -> bool:
        return (
            -pad_m <= x_m <= (self.pitch_length_m + pad_m)
            and -pad_m <= y_m <= (self.pitch_width_m + pad_m)
        )

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["active_cap_team_a"] = self.active_cap("team_a")
        d["active_cap_team_b"] = self.active_cap("team_b")
        d["speed_thresholds"] = self.speed_thresholds()
        d["scaled_distances"] = self.scaled_tactical_distances()
        return d


@dataclass
class SubEvent:
    minute: float
    team: str
    player_out: str
    player_in: str


@dataclass
class BenchSubstitutionManager:
    """Tracks active on-pitch roster, rolling subs, red cards, and on-pitch minutes."""

    config: MatchSetupConfig
    on_pitch: dict[str, set[str]] = field(
        default_factory=lambda: {"team_a": set(), "team_b": set()}
    )
    bench: dict[str, set[str]] = field(
        default_factory=lambda: {"team_a": set(), "team_b": set()}
    )
    minutes_played: dict[str, float] = field(default_factory=dict)
    _entered_at: dict[str, float] = field(default_factory=dict)
    sub_log: list[SubEvent] = field(default_factory=list)

    def set_starting_lineup(self, team: str, starters: list[str], subs: list[str]) -> None:
        cap = self.config.active_cap(team)
        active = starters[:cap]
        overflow = starters[cap:]
        self.on_pitch[team] = set(active)
        self.bench[team] = set(subs) | set(overflow)
        for p in active:
            self._entered_at[p] = 0.0
            self.minutes_played.setdefault(p, 0.0)
        for p in self.bench[team]:
            self.minutes_played.setdefault(p, 0.0)

    def substitute(self, team: str, player_out: str, player_in: str, minute: float) -> bool:
        if player_out not in self.on_pitch[team]:
            return False
        if not self.config.rolling_subs and len(
            [s for s in self.sub_log if s.team == team]
        ) >= FORMAT_DEFAULTS[self.config.match_format]["max_subs"]:
            return False

        entered = self._entered_at.pop(player_out, 0.0)
        self.minutes_played[player_out] = self.minutes_played.get(player_out, 0.0) + max(
            0.0, minute - entered
        )
        self.on_pitch[team].remove(player_out)
        if self.config.rolling_subs:
            self.bench[team].add(player_out)

        self.bench[team].discard(player_in)
        self.on_pitch[team].add(player_in)
        self._entered_at[player_in] = minute
        self.minutes_played.setdefault(player_in, 0.0)
        self.sub_log.append(SubEvent(minute=minute, team=team, player_out=player_out, player_in=player_in))
        return True

    def record_red_card(self, team: str, player_id: str, minute: float) -> int:
        if player_id in self.on_pitch[team]:
            entered = self._entered_at.pop(player_id, 0.0)
            self.minutes_played[player_id] = self.minutes_played.get(player_id, 0.0) + max(
                0.0, minute - entered
            )
            self.on_pitch[team].remove(player_id)
        if team == "team_a":
            self.config.red_cards_team_a += 1
        else:
            self.config.red_cards_team_b += 1
        return self.config.active_cap(team)

    def finalize_minutes(self, end_minute: float) -> dict[str, float]:
        totals = dict(self.minutes_played)
        for p, start_m in self._entered_at.items():
            totals[p] = round(totals.get(p, 0.0) + max(0.0, end_minute - start_m), 2)
        return totals


def compute_four_point_homography(
    pixel_corners: list[list[float]],
    pitch_length_m: float,
    pitch_width_m: float,
) -> np.ndarray:
    """Compute pixel -> pitch-metres 3x3 homography from 4 user-clicked corners (TL, TR, BR, BL)."""
    if len(pixel_corners) != 4:
        raise ValueError("Exactly 4 pixel corners [TL, TR, BR, BL] are required.")
    src = np.asarray(pixel_corners, dtype=np.float32).reshape(4, 2)
    dst = np.asarray(
        [
            [0.0, 0.0],
            [pitch_length_m, 0.0],
            [pitch_length_m, pitch_width_m],
            [0.0, pitch_width_m],
        ],
        dtype=np.float32,
    )
    H, _ = cv2.findHomography(src, dst, method=0)
    if H is None:
        raise ValueError("Degenerate 4-point corners; cannot compute homography.")
    return H.astype(np.float64)


def project_pixels_with_homography(
    H: np.ndarray, pixel_points: list[list[float]] | np.ndarray
) -> np.ndarray:
    """Project (N, 2) pixel coordinates into pitch metres using homography H."""
    pts = np.asarray(pixel_points, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(pts, np.asarray(H, dtype=np.float64)).reshape(-1, 2)
