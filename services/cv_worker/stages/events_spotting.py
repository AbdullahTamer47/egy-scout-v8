"""Shot/Replay Gatekeeper & Dual-Lock Event / Goal Spotter (Wave 2, Sections 9.1 & 11)."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import re
from typing import Any, Literal, Optional

import cv2
import numpy as np

SCORE_RE = re.compile(r"\b(\d)\s*[-–:\s]\s*(\d)\b")
CLOCK_RE = re.compile(r"\b(\d{1,2}:\d{2})\b")

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


def parse_scoreboard_text(tokens: list[str]) -> Optional[tuple[int, int]]:
    """Parse score pair (score_a, score_b) from broadcast HUD OCR tokens (0..9 per team)."""
    joined = " ".join(t.strip() for t in tokens if t and t.strip())
    if not joined:
        return None
    # Strip match clock like 42:18 before parsing score digits
    cleaned = CLOCK_RE.sub(" ", joined)
    m = SCORE_RE.search(cleaned)
    if m:
        sa, sb = int(m.group(1)), int(m.group(2))
        if 0 <= sa <= 9 and 0 <= sb <= 9:
            return sa, sb
    digits = [int(tok.strip()) for tok in tokens if tok.strip().isdigit() and 0 <= int(tok.strip()) <= 9]
    if len(digits) == 2:
        return digits[0], digits[1]
    return None


def scan_video_scoreboard_goals(
    video_path: str | Path,
    ocr_reader: Any,
    ball_states: Optional[list[dict[str, Any]]] = None,
    sample_stride_s: float = 1.5,
    max_samples: int = 45,
) -> dict[str, Any]:
    """Scan TV broadcast top-left/top-right scoreboard HUD with EasyOCR & run Dual-Lock Goal Detection."""
    from packages.shared_contracts.config import open_video_unicode

    readings: list[tuple[int, float, int, int, ShotClass]] = []
    scores_seen: list[dict[str, Any]] = []
    if ocr_reader is None:
        return {
            "scoreboard_scanned": False,
            "samples": 0,
            "latest_score": None,
            "verified_goals": [],
        }

    cap, proxy = open_video_unicode(video_path)
    try:
        if not cap.isOpened():
            return {"scoreboard_scanned": False, "samples": 0, "latest_score": None, "verified_goals": []}
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        step = max(1, int(round(fps * sample_stride_s)))
        if total_frames > 0:
            fids = list(range(0, total_frames, step))[:max_samples]
        else:
            fids = [i * step for i in range(max_samples)]

        for fid in fids:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(fid))
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            h, w = frame.shape[:2]
            # Broadcast scorebug lives in top 14% (left 42% or right 42%)
            rois = [
                frame[0 : max(40, int(h * 0.14)), 0 : max(120, int(w * 0.42))],
                frame[0 : max(40, int(h * 0.14)), max(0, int(w * 0.58)) : w],
            ]
            parsed: Optional[tuple[int, int]] = None
            for roi in rois:
                if roi.size == 0:
                    continue
                try:
                    up = cv2.resize(roi, (roi.shape[1] * 2, roi.shape[0] * 2), interpolation=cv2.INTER_CUBIC)
                    res = ocr_reader.readtext(up, detail=1)
                    toks = [str(txt) for _, txt, cf in res if float(cf) >= 0.40]
                    parsed = parse_scoreboard_text(toks)
                    if parsed is not None:
                        break
                except Exception:
                    continue
            if parsed is not None:
                ts = round(fid / fps, 2)
                readings.append((int(fid), ts, parsed[0], parsed[1], "tactical_wide"))
                scores_seen.append({"frame_id": int(fid), "time_s": ts, "score_a": parsed[0], "score_b": parsed[1]})
    finally:
        cap.release()
        if proxy is not None and proxy.exists():
            try:
                proxy.unlink()
            except OSError:
                pass

    goal_events = detect_scoreboard_goal_changes(readings, confirm_frames=2)
    verified_goals = []
    for g in goal_events:
        gd = g.to_dict()
        if ball_states:
            gd["forensics_window"] = extract_goal_forensics_window(ball_states, g.time_s, window_s=18.0)
        verified_goals.append(gd)

    latest = scores_seen[-1] if scores_seen else None
    return {
        "scoreboard_scanned": True,
        "samples": len(readings),
        "latest_score": f"{latest['score_a']}-{latest['score_b']}" if latest else None,
        "verified_goals": verified_goals,
    }
