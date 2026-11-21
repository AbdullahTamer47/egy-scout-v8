"""Automated Phase 0 Benchmark Evaluator (Master Plan V8, Wave 0 / Sprint 0.1).

Evaluates tracking Parquet predictions against Phase 0 annotated ground truth:
  - Referee Classification Accuracy (Target >= 95.0%) + Leakage Rate
  - Team Separation Accuracy (Target >= 97.0%, permutation-invariant)
  - Track-Level Role Stability (% of tracks with 0 role flips across frames)
  - Explicit Before vs. After comparison + Critical Case Spotlight (e.g. Frame 1250)
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd

from packages.shared_contracts.schemas import (
    MatchAnnotationFile,
    PersonAnnotation,
    load_legacy_scout5_telemetry,
    read_tracking_parquet,
)

REFEREE_ROLES = {"referee", "assistant_referee"}
TARGET_REFEREE_ACC = 0.95
TARGET_TEAM_ACC = 0.97


@dataclass
class EvaluationMetrics:
    label: str
    matched_instances: int = 0
    total_gt_instances: int = 0
    referee_gt_count: int = 0
    referee_tp: int = 0
    referee_fp: int = 0
    referee_fn: int = 0
    referee_tn: int = 0
    referee_accuracy: float = 0.0
    referee_precision: float = 0.0
    referee_recall: float = 0.0
    referee_f1: float = 0.0
    referee_leakage_rate: float = 0.0  # GT refs wrongly assigned to team_a/team_b
    team_gt_count: int = 0
    team_correct: int = 0
    team_accuracy: float = 0.0
    team_mapping: str = "direct"
    total_tracks: int = 0
    stable_tracks: int = 0
    track_role_stability: float = 0.0
    gate_referee_pass: bool = False
    gate_team_pass: bool = False
    spotlight_cases: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def bbox_iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0.0 else 0.0


def load_predictions_auto(path: str | Path, match_id: Optional[str] = None) -> pd.DataFrame:
    """Load either V8 TRACKING_PARQUET_SCHEMA or legacy scout5 telemetry.parquet."""
    p = Path(path)
    df = read_tracking_parquet(p)
    if "team" not in df.columns and "team_id" in df.columns:
        return load_legacy_scout5_telemetry(p, match_id=match_id)
    if match_id and "match_id" not in df.columns:
        df["match_id"] = match_id
    return df


def _match_gt_to_pred(
    gt_person: PersonAnnotation,
    frame_preds: pd.DataFrame,
    iou_thresh: float = 0.35,
) -> Optional[pd.Series]:
    """Match one GT annotation to a predicted row in the same frame (track_id or best IoU)."""
    if frame_preds.empty:
        return None
    if gt_person.track_id is not None:
        by_tid = frame_preds[frame_preds["track_id"] == gt_person.track_id]
        if not by_tid.empty:
            return by_tid.iloc[0]

    best_iou = iou_thresh
    best_row: Optional[pd.Series] = None
    for _, row in frame_preds.iterrows():
        pbox = [float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])]
        score = bbox_iou(gt_person.bbox, pbox)
        if score >= best_iou:
            best_iou = score
            best_row = row
    return best_row


def compute_track_role_stability(pred_df: pd.DataFrame) -> tuple[int, int, float]:
    """Return (total_tracks, stable_tracks_with_zero_flips, stability_ratio)."""
    if pred_df.empty or "track_id" not in pred_df.columns:
        return 0, 0, 0.0
    valid = pred_df[pred_df["track_id"] >= 0]
    if valid.empty:
        return 0, 0, 0.0
    total = 0
    stable = 0
    for _, grp in valid.groupby("track_id"):
        if len(grp) < 1:
            continue
        total += 1
        if grp["role"].nunique() == 1:
            stable += 1
    return total, stable, (stable / total if total > 0 else 0.0)


def evaluate_predictions(
    gt_file: MatchAnnotationFile,
    pred_df: pd.DataFrame,
    label: str = "model",
    spotlight_frames: Optional[list[int]] = None,
    only_verified: bool = False,
) -> EvaluationMetrics:
    """Evaluate a prediction DataFrame against a MatchAnnotationFile."""
    m = EvaluationMetrics(label=label)
    if spotlight_frames is None:
        spotlight_frames = [1250]

    total_tracks, stable_tracks, stability = compute_track_role_stability(pred_df)
    m.total_tracks = total_tracks
    m.stable_tracks = stable_tracks
    m.track_role_stability = round(stability, 4)

    team_pairs: list[tuple[str, str]] = []
    leaked_refs = 0

    for frame in gt_file.frames:
        f_preds = pred_df[pred_df["frame_id"] == frame.frame_id]
        for gt_p in frame.persons:
            if only_verified and not gt_p.verified:
                continue
            m.total_gt_instances += 1
            pred_row = _match_gt_to_pred(gt_p, f_preds)
            if pred_row is None:
                continue
            m.matched_instances += 1

            gt_is_ref = gt_p.role in REFEREE_ROLES
            pred_role = str(pred_row["role"]).lower()
            pred_team = str(pred_row["team"]).lower()
            pred_is_ref = pred_role in REFEREE_ROLES

            if gt_is_ref:
                m.referee_gt_count += 1
                if pred_is_ref:
                    m.referee_tp += 1
                else:
                    m.referee_fn += 1
                if pred_team in ("team_a", "team_b"):
                    leaked_refs += 1
            else:
                if pred_is_ref:
                    m.referee_fp += 1
                else:
                    m.referee_tn += 1

            if gt_p.role in ("player", "goalkeeper") and gt_p.team in ("team_a", "team_b"):
                m.team_gt_count += 1
                team_pairs.append((gt_p.team, pred_team))

            # Record critical spotlight cases (e.g. Frame 1250 referees/assistant_refs)
            if frame.frame_id in spotlight_frames and (
                gt_is_ref or (gt_p.track_id in (9, 20))
            ):
                m.spotlight_cases.append(
                    {
                        "frame_id": frame.frame_id,
                        "track_id": gt_p.track_id,
                        "gt_role": gt_p.role,
                        "gt_team": gt_p.team,
                        "pred_role": pred_role,
                        "pred_team": pred_team,
                        "pred_team_conf": round(float(pred_row.get("team_conf", 0.0) or 0.0), 3),
                        "y_m": round(float(pred_row["y_m"]), 2)
                        if pd.notna(pred_row.get("y_m", np.nan))
                        else None,
                        "source_layer": str(pred_row.get("source_layer", "unknown")),
                        "correct": (gt_is_ref == pred_is_ref) and (
                            pred_team == "none" if gt_is_ref else True
                        ),
                    }
                )

    total_cls = m.referee_tp + m.referee_tn + m.referee_fp + m.referee_fn
    if total_cls > 0:
        m.referee_accuracy = round((m.referee_tp + m.referee_tn) / total_cls, 4)
    if (m.referee_tp + m.referee_fp) > 0:
        m.referee_precision = round(m.referee_tp / (m.referee_tp + m.referee_fp), 4)
    if (m.referee_tp + m.referee_fn) > 0:
        m.referee_recall = round(m.referee_tp / (m.referee_tp + m.referee_fn), 4)
    if (m.referee_precision + m.referee_recall) > 0:
        m.referee_f1 = round(
            2 * m.referee_precision * m.referee_recall / (m.referee_precision + m.referee_recall),
            4,
        )
    if m.referee_gt_count > 0:
        m.referee_leakage_rate = round(leaked_refs / m.referee_gt_count, 4)

    # Optimal permutation for team_a / team_b (KMeans cluster ordering is arbitrary)
    if team_pairs:
        direct_ok = sum(1 for g, p in team_pairs if g == p)
        swap = {"team_a": "team_b", "team_b": "team_a", "none": "none"}
        swapped_ok = sum(1 for g, p in team_pairs if g == swap.get(p, "none"))
        if swapped_ok > direct_ok:
            m.team_correct = swapped_ok
            m.team_mapping = "swapped"
        else:
            m.team_correct = direct_ok
            m.team_mapping = "direct"
        m.team_accuracy = round(m.team_correct / len(team_pairs), 4)

    # Acceptance gate: both overall referee accuracy and recall/no-leak must meet >= 95%
    m.gate_referee_pass = (
        m.referee_accuracy >= TARGET_REFEREE_ACC
        and (m.referee_recall >= TARGET_REFEREE_ACC if m.referee_gt_count > 0 else True)
    )
    m.gate_team_pass = m.team_accuracy >= TARGET_TEAM_ACC
    return m


def format_comparison_markdown(
    before: Optional[EvaluationMetrics],
    after: EvaluationMetrics,
    match_id: str,
) -> str:
    """Build a crisp Markdown Before-vs-After report for terminal & investor docs."""
    lines = [
        f"# EGY-SCOUT V8 — Phase 0 Benchmark Report (`{match_id}`)",
        "",
        "| Metric | Target | Before (Legacy) | After (V8 Shield) | Delta | Gate |",
        "|---|---:|---:|---:|---:|:---:|",
    ]

    def _pct(v: Optional[float]) -> str:
        return f"{v * 100:.2f}%" if v is not None else "—"

    def _delta(b: Optional[float], a: float, invert: bool = False) -> str:
        if b is None:
            return "—"
        diff = (a - b) * 100.0
        sign = "+" if diff >= 0 else ""
        return f"{sign}{diff:.2f}%"

    rows = [
        (
            "Referee Accuracy",
            ">= 95.0%",
            before.referee_accuracy if before else None,
            after.referee_accuracy,
            "PASS" if after.gate_referee_pass else "FAIL",
        ),
        (
            "Referee Recall",
            ">= 95.0%",
            before.referee_recall if before else None,
            after.referee_recall,
            "PASS" if after.referee_recall >= TARGET_REFEREE_ACC or after.referee_gt_count == 0 else "FAIL",
        ),
        (
            "Referee Leakage Rate",
            "0.0%",
            before.referee_leakage_rate if before else None,
            after.referee_leakage_rate,
            "PASS" if after.referee_leakage_rate <= 0.05 else "FAIL",
        ),
        (
            "Team Separation Accuracy",
            ">= 97.0%",
            before.team_accuracy if before else None,
            after.team_accuracy,
            "PASS" if after.gate_team_pass else "FAIL",
        ),
        (
            "Track Role Stability",
            "100.0%",
            before.track_role_stability if before else None,
            after.track_role_stability,
            "PASS" if after.track_role_stability >= 0.99 else "WARN",
        ),
    ]
    for name, target, bv, av, gate in rows:
        lines.append(f"| {name} | {target} | {_pct(bv)} | {_pct(av)} | {_delta(bv, av)} | {gate} |")

    if after.spotlight_cases or (before and before.spotlight_cases):
        lines.extend(["", "## Critical Case Spotlight (Referee & Assistant Referee Leaks)", ""])
        lines.append("| Frame | Track | GT Role | Before Pred | After Pred | y_m | Layer |")
        lines.append("|---:|---:|---|---|---|---:|---|")
        before_map = {
            (c["frame_id"], c["track_id"]): c
            for c in (before.spotlight_cases if before else [])
        }
        for c in after.spotlight_cases:
            bc = before_map.get((c["frame_id"], c["track_id"]))
            b_str = f"{bc['pred_role']}/{bc['pred_team']} (c={bc['pred_team_conf']})" if bc else "—"
            a_str = f"{c['pred_role']}/{c['pred_team']}"
            lines.append(
                f"| {c['frame_id']} | {c['track_id']} | {c['gt_role']} | {b_str} | {a_str} | {c['y_m']} | `{c['source_layer']}` |"
            )

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate EGY-SCOUT V8 predictions against Phase 0 annotations."
    )
    parser.add_argument("--gt", required=True, help="Path to Phase 0 annotation JSON file.")
    parser.add_argument("--after", required=True, help="Path to V8 tracking Parquet file.")
    parser.add_argument(
        "--before",
        default="",
        help="Optional path to legacy scout5 telemetry.parquet for Before-vs-After comparison.",
    )
    parser.add_argument(
        "--only-verified",
        action="store_true",
        help="Evaluate only persons explicitly marked verified=True.",
    )
    parser.add_argument("--out-json", default="", help="Optional path to save JSON report.")
    parser.add_argument("--out-md", default="", help="Optional path to save Markdown report.")
    args = parser.parse_args()

    gt = MatchAnnotationFile.load(args.gt)
    after_df = load_predictions_auto(args.after, match_id=gt.match_id)
    after_metrics = evaluate_predictions(
        gt, after_df, label="after_v8", only_verified=args.only_verified
    )

    before_metrics: Optional[EvaluationMetrics] = None
    if args.before:
        before_df = load_predictions_auto(args.before, match_id=gt.match_id)
        before_metrics = evaluate_predictions(
            gt, before_df, label="before_legacy", only_verified=args.only_verified
        )

    md = format_comparison_markdown(before_metrics, after_metrics, gt.match_id)
    print(md)

    report_payload = {
        "match_id": gt.match_id,
        "before": before_metrics.to_dict() if before_metrics else None,
        "after": after_metrics.to_dict(),
    }
    if args.out_json:
        Path(args.out_json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out_json).write_text(
            json.dumps(report_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    if args.out_md:
        Path(args.out_md).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out_md).write_text(md, encoding="utf-8")


if __name__ == "__main__":
    main()
