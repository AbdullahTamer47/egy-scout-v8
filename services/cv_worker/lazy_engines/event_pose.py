"""Event-Triggered Pose & Head-Scanning Resolution Gate (Wave 4, Section 15.1).

Guardrails enforced:
  1. Runs ONLY within +-2.0s of verified ball events (saves ~90% GPU cost).
  2. Resolution Gate: computes Torso Open/Closed on standard broadcast frames,
     and enables Head Scanning ONLY when player bbox height >= 75px.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

import numpy as np


@dataclass
class PoseAssessment:
    track_id: int
    frame_id: int
    bbox_height_px: float
    torso_orientation: str  # "open_to_pitch" | "closed_to_touchline"
    torso_angle_deg: float
    head_scanning_enabled: bool
    head_scan_count: Optional[int]
    gate_note: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def select_event_pose_windows(
    event_times_s: list[float], window_half_s: float = 2.0
) -> list[tuple[float, float]]:
    """Merge overlapping +-2s windows around events for lazy RTMPose execution."""
    if not event_times_s:
        return []
    intervals = sorted((max(0.0, t - window_half_s), t + window_half_s) for t in event_times_s)
    merged: list[tuple[float, float]] = [intervals[0]]
    for s, e in intervals[1:]:
        ps, pe = merged[-1]
        if s <= pe:
            merged[-1] = (ps, max(pe, e))
        else:
            merged.append((s, e))
    return [(round(s, 2), round(e, 2)) for s, e in merged]


def evaluate_pose_with_resolution_gate(
    track_id: int,
    frame_id: int,
    bbox: list[float],
    shoulder_vec: tuple[float, float],
    head_yaw_series_deg: Optional[list[float]] = None,
    min_head_height_px: float = 75.0,
) -> PoseAssessment:
    """Compute torso openness and enforce the >= 75px Resolution Gate for Head Scanning."""
    bh = max(1.0, float(bbox[3]) - float(bbox[1]))
    ang = float(np.rad2deg(np.arctan2(shoulder_vec[1], shoulder_vec[0])))
    open_body = abs(ang) <= 65.0

    if bh >= min_head_height_px and head_yaw_series_deg:
        # Count distinct left/right head turns (> 28 deg swing) prior to ball reception
        diffs = np.abs(np.diff(np.asarray(head_yaw_series_deg, dtype=np.float32)))
        scans = int(np.sum(diffs >= 28.0))
        return PoseAssessment(
            track_id=track_id,
            frame_id=frame_id,
            bbox_height_px=round(bh, 1),
            torso_orientation="open_to_pitch" if open_body else "closed_to_touchline",
            torso_angle_deg=round(ang, 1),
            head_scanning_enabled=True,
            head_scan_count=scans,
            gate_note="Resolution Gate passed (>= 75px)",
        )

    return PoseAssessment(
        track_id=track_id,
        frame_id=frame_id,
        bbox_height_px=round(bh, 1),
        torso_orientation="open_to_pitch" if open_body else "closed_to_touchline",
        torso_angle_deg=round(ang, 1),
        head_scanning_enabled=False,
        head_scan_count=None,
        gate_note=f"Head Scanning skipped (bbox height {bh:.0f}px < {min_head_height_px:.0f}px)",
    )
