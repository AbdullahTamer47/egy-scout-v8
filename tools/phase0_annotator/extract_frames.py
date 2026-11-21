"""Extract representative benchmark frames for Phase 0 annotation (default: 300 frames).

Discovers existing matches in `scout5/data/matches/` (or accepts any custom `--video`),
remaps legacy `D:\\مدرب\\` paths automatically, reads video & saves JPEGs safely with
Unicode-safe OpenCV I/O, and pre-populates candidate bounding boxes from telemetry.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import pandas as pd

from packages.shared_contracts.config import (
    get_data_paths,
    get_repo_root,
    imwrite_unicode,
    open_video_unicode,
    resolve_project_path,
)
from packages.shared_contracts.schemas import (
    FrameAnnotation,
    MatchAnnotationFile,
    PersonAnnotation,
    load_legacy_scout5_telemetry,
)

# Critical diagnostic frames guaranteed to be included in the benchmark
PINNED_CRITICAL_FRAMES: dict[str, list[int]] = {
    "m2_ahly_enppi": [1250],
}


def discover_scout5_matches(repo_root: Optional[Path] = None) -> list[dict[str, str]]:
    """Find all matches under scout5/data/matches/ with their summary & telemetry."""
    root = repo_root or get_repo_root()
    matches_dir = root / "scout5" / "data" / "matches"
    if not matches_dir.is_dir():
        return []

    found: list[dict[str, str]] = []
    for sub in sorted(matches_dir.iterdir()):
        if not sub.is_dir():
            continue
        summary_p = sub / "summary.json"
        telem_p = sub / "telemetry.parquet"
        video_path = ""
        team_a = "Team A"
        team_b = "Team B"
        fps = 25.0
        if summary_p.is_file():
            try:
                meta = json.loads(summary_p.read_text(encoding="utf-8"))
                video_path = str(resolve_project_path(meta.get("video_path", ""), root))
                fps = float(meta.get("fps", 25.0) or 25.0)
                teams = meta.get("teams", {})
                if isinstance(teams, dict):
                    t0 = teams.get("0") or teams.get("team_a") or {}
                    t1 = teams.get("1") or teams.get("team_b") or {}
                    if isinstance(t0, dict) and t0.get("name"):
                        team_a = str(t0["name"])
                    if isinstance(t1, dict) and t1.get("name"):
                        team_b = str(t1["name"])
            except Exception:
                pass
        found.append(
            {
                "match_id": sub.name,
                "video_path": video_path,
                "telemetry_path": str(telem_p) if telem_p.is_file() else "",
                "team_a_name": team_a,
                "team_b_name": team_b,
                "fps": str(fps),
            }
        )
    return found


def select_representative_frame_ids(
    available_frames: list[int],
    target_count: int,
    pinned_frames: Optional[list[int]] = None,
) -> list[int]:
    """Select evenly-spaced representative frames while guaranteeing pinned frames."""
    if not available_frames:
        return []
    uniq = sorted(set(int(f) for f in available_frames))
    if len(uniq) <= target_count:
        return uniq

    pinned = [f for f in (pinned_frames or []) if f in set(uniq)]
    idx = np.linspace(0, len(uniq) - 1, num=target_count, dtype=int)
    selected = {uniq[i] for i in idx}
    for pf in pinned:
        selected.add(pf)

    ordered = sorted(selected)
    # If adding pinned pushed slightly over target_count, trim non-pinned farthest from pinned
    pinned_set = set(pinned)
    while len(ordered) > target_count:
        for i in range(len(ordered) - 1, -1, -1):
            if ordered[i] not in pinned_set:
                ordered.pop(i)
                break
        else:
            break
    return ordered


def extract_match_benchmark_frames(
    match_id: str,
    video_path: str | Path,
    telemetry_path: Optional[str | Path] = None,
    output_benchmark_dir: Optional[str | Path] = None,
    frames_count: int = 100,
    team_a_name: str = "Team A",
    team_b_name: str = "Team B",
    merge_existing: bool = True,
) -> Path:
    """Extract representative frames & build/update Phase 0 annotation JSON for one match."""
    resolved_video = resolve_project_path(video_path)
    if not resolved_video.is_file():
        raise FileNotFoundError(f"Video not found: {video_path} (resolved: {resolved_video})")

    bench_dir = (
        Path(output_benchmark_dir)
        if output_benchmark_dir is not None
        else get_data_paths().benchmark
    )
    frames_dir = bench_dir / "frames" / match_id
    ann_dir = bench_dir / "annotations"
    frames_dir.mkdir(parents=True, exist_ok=True)
    ann_dir.mkdir(parents=True, exist_ok=True)
    ann_path = ann_dir / f"{match_id}.json"

    existing_by_frame: dict[int, FrameAnnotation] = {}
    if merge_existing and ann_path.is_file():
        prev = MatchAnnotationFile.load(ann_path)
        existing_by_frame = {f.frame_id: f for f in prev.frames}

    telem_df: Optional[pd.DataFrame] = None
    if telemetry_path and Path(telemetry_path).is_file():
        telem_df = load_legacy_scout5_telemetry(telemetry_path, match_id=match_id)

    cap, proxy_path = open_video_unicode(resolved_video)
    try:
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open video: {resolved_video}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720

        if telem_df is not None and not telem_df.empty:
            avail = sorted(telem_df["frame_id"].unique().tolist())
        else:
            avail = list(range(0, max(total_frames, 1), max(1, int(fps))))

        pinned = PINNED_CRITICAL_FRAMES.get(match_id, [])
        selected_ids = select_representative_frame_ids(avail, frames_count, pinned)

        frame_anns: list[FrameAnnotation] = []
        for fid in selected_ids:
            img_name = f"frame_{fid:06d}.jpg"
            img_abs = frames_dir / img_name
            img_rel = f"frames/{match_id}/{img_name}"

            if not img_abs.is_file():
                cap.set(cv2.CAP_PROP_POS_FRAMES, fid)
                ok, frame_bgr = cap.read()
                if not ok or frame_bgr is None:
                    continue
                imwrite_unicode(img_abs, frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
                height, width = frame_bgr.shape[:2]

            if fid in existing_by_frame:
                frame_anns.append(existing_by_frame[fid])
                continue

            persons: list[PersonAnnotation] = []
            if telem_df is not None:
                sub = telem_df[telem_df["frame_id"] == fid]
                for idx, (_, row) in enumerate(sub.iterrows(), start=1):
                    role = str(row["role"])
                    if role == "ball":
                        continue
                    persons.append(
                        PersonAnnotation(
                            ann_id=idx,
                            bbox=[
                                round(float(row["x1"]), 1),
                                round(float(row["y1"]), 1),
                                round(float(row["x2"]), 1),
                                round(float(row["y2"]), 1),
                            ],
                            role=role if role in ("player", "goalkeeper", "referee", "assistant_referee") else "player",
                            team=str(row["team"]) if str(row["team"]) in ("team_a", "team_b", "none") else "none",
                            jersey_number=None,
                            track_id=int(row["track_id"]) if pd.notna(row["track_id"]) else None,
                            x_m=round(float(row["x_m"]), 2) if pd.notna(row["x_m"]) else None,
                            y_m=round(float(row["y_m"]), 2) if pd.notna(row["y_m"]) else None,
                            verified=False,
                        )
                    )

            frame_anns.append(
                FrameAnnotation(
                    frame_id=int(fid),
                    time_s=round(fid / fps, 3),
                    image_rel_path=img_rel,
                    width=width,
                    height=height,
                    persons=persons,
                    completed=False,
                )
            )
    finally:
        cap.release()
        if proxy_path is not None and proxy_path.exists():
            try:
                proxy_path.unlink()
            except OSError:
                pass

    ann_file = MatchAnnotationFile(
        match_id=match_id,
        video_path=str(resolved_video),
        fps=fps,
        team_a_name=team_a_name,
        team_b_name=team_b_name,
        frames=frame_anns,
    )
    return ann_file.save(ann_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract representative frames for EGY-SCOUT Phase 0 Benchmark (300 frames)."
    )
    parser.add_argument(
        "--frames-per-match",
        type=int,
        default=100,
        help="Target frames per match (default 100 x 3 matches = 300 frames).",
    )
    parser.add_argument(
        "--match",
        type=str,
        default="",
        help="Optional single match_id to extract (default: all discovered scout5 matches).",
    )
    parser.add_argument(
        "--video",
        type=str,
        default="",
        help="Optional custom video path (use with --match).",
    )
    parser.add_argument(
        "--telemetry",
        type=str,
        default="",
        help="Optional telemetry parquet path (use with --video).",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default="",
        help="Override EGY_SCOUT_DATA_DIR (default: D:\\egy-scout-data on Windows).",
    )
    args = parser.parse_args()

    bench_dir = (
        Path(args.data_dir) / "datasets" / "egypt_benchmark"
        if args.data_dir
        else get_data_paths().benchmark
    )

    if args.video:
        mid = args.match or Path(args.video).stem
        saved = extract_match_benchmark_frames(
            match_id=mid,
            video_path=args.video,
            telemetry_path=args.telemetry or None,
            output_benchmark_dir=bench_dir,
            frames_count=args.frames_per_match,
        )
        print(f"[OK] Extracted benchmark frames for {mid} -> {saved}")
        return

    matches = discover_scout5_matches()
    if args.match:
        matches = [m for m in matches if m["match_id"] == args.match]
    if not matches:
        print("[WARN] No matches discovered under scout5/data/matches/. Use --video to specify one.")
        return

    total_frames = 0
    for m in matches:
        try:
            saved = extract_match_benchmark_frames(
                match_id=m["match_id"],
                video_path=m["video_path"],
                telemetry_path=m["telemetry_path"] or None,
                output_benchmark_dir=bench_dir,
                frames_count=args.frames_per_match,
                team_a_name=m["team_a_name"],
                team_b_name=m["team_b_name"],
            )
            loaded = MatchAnnotationFile.load(saved)
            total_frames += len(loaded.frames)
            print(f"[OK] {m['match_id']}: {len(loaded.frames)} frames -> {saved}")
        except Exception as exc:
            print(f"[ERR] {m['match_id']}: {exc}")

    print(f"[DONE] Total Phase 0 benchmark frames ready: {total_frames} in {bench_dir}")


if __name__ == "__main__":
    main()
