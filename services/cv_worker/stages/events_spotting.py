"""Shot/Replay Gatekeeper & Dual-Lock Event / Goal Spotter (Wave 2, Sections 9.1 & 11)."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

import numpy as np

ShotClass = Literal["tactical_wide", "close_up", "replay", "unknown"]


@dataclass
class MatchEvent:
    event_type: str  # goal | shot | pass | cross | corner | turnover
    frame_id: int
    time_s: float
    team: str
    confidence: float
    verified_by_scoreboard: bool = False
    details: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def classify_shot_gate(
    calibrated_player_count: int,
    hist_diff_prev: float,
    is_replay_wipe: bool = False,
) -> ShotClass:
    """Gatekeeper isolating replays & close-ups so goals/sprints are never double-counted."""
    if is_replay_wipe:
        return "replay"
    if calibrated_player_count >= 8 and hist_diff_prev < 0.45:
        return "tactical_wide"
    if calibrated_player_count < 4:
        return "close_up"
    return "tactical_wide"


def detect_scoreboard_goal_changes(
    scoreboard_readings: list[tuple[int, float, int, int, ShotClass]],
    confirm_frames: int = 3,
) -> list[MatchEvent]:
    """Lock 1 — Detect verified goals ONLY when scoreboard score increments & persists (ignoring replays)."""
    events: list[MatchEvent] = []
    confirmed_a: int | None = None
    confirmed_b: int | None = None
    pending: tuple[int, int] | None = None
    pending_count = 0
    pending_meta: tuple[int, float] = (0, 0.0)

    for fid, ts, sa, sb, shot_cls in scoreboard_readings:
        if shot_cls == "replay":
            continue
        if confirmed_a is None:
            confirmed_a, confirmed_b = sa, sb
            continue
        if (sa, sb) == (confirmed_a, confirmed_b):
            pending = None
            pending_count = 0
            continue
        # Only accept valid +1 increment
        if (sa == confirmed_a + 1 and sb == confirmed_b) or (sb == confirmed_b + 1 and sa == confirmed_a):
            if pending == (sa, sb):
                pending_count += 1
            else:
                pending = (sa, sb)
                pending_count = 1
                pending_meta = (fid, ts)
            if pending_count >= confirm_frames:
                scoring_team = "team_a" if sa > confirmed_a else "team_b"
                events.append(
                    MatchEvent(
                        event_type="goal",
                        frame_id=pending_meta[0],
                        time_s=round(pending_meta[1], 2),
                        team=scoring_team,
                        confidence=0.99,
                        verified_by_scoreboard=True,
                        details=f"Scoreboard confirmed {confirmed_a}-{confirmed_b} -> {sa}-{sb}",
                    )
                )
                confirmed_a, confirmed_b = sa, sb
                pending = None
                pending_count = 0
    return events


def extract_goal_forensics_window(
    ball_states: list[dict[str, Any]], goal_time_s: float, window_s: float = 18.0
) -> dict[str, Any]:
    """Reconstruct the last 15-20s build-up sequence preceding a verified goal."""
    start_s = max(0.0, goal_time_s - window_s)
    seq = [b for b in ball_states if start_s <= float(b["time_s"]) <= goal_time_s]
    if not seq:
        return {"start_s": start_s, "end_s": goal_time_s, "ball_travel_m": 0.0, "frames": 0}
    xs = np.array([float(b["x_m"]) for b in seq], dtype=np.float64)
    ys = np.array([float(b["y_m"]) for b in seq], dtype=np.float64)
    travel = float(np.hypot(np.diff(xs), np.diff(ys)).sum()) if len(seq) >= 2 else 0.0
    return {
        "start_s": round(start_s, 2),
        "end_s": round(goal_time_s, 2),
        "ball_travel_m": round(travel, 1),
        "origin_xy": [round(float(xs[0]), 1), round(float(ys[0]), 1)],
        "shot_xy": [round(float(xs[-1]), 1), round(float(ys[-1]), 1)],
        "frames": len(seq),
    }
