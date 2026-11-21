"""18-Chunk Map-Reduce Video Orchestrator & Cross-Chunk Re-ID Stitcher (Wave 1, Section 8)."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class VideoChunkSpec:
    chunk_index: int
    start_s: float
    end_s: float
    overlap_s: float
    start_frame: int
    end_frame: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def plan_video_chunks(
    duration_s: float,
    fps: float = 25.0,
    chunk_duration_s: float = 300.0,  # 5 minutes -> 18 chunks for a 90-min match
    overlap_s: float = 5.0,
) -> list[VideoChunkSpec]:
    """Split a match into parallel GPU chunks with overlap for cross-chunk Re-ID stitching."""
    if duration_s <= 0:
        return []
    chunks: list[VideoChunkSpec] = []
    idx = 0
    cursor = 0.0
    while cursor < duration_s - 1e-3:
        start = max(0.0, cursor - (overlap_s if idx > 0 else 0.0))
        end = min(duration_s, cursor + chunk_duration_s)
        chunks.append(
            VideoChunkSpec(
                chunk_index=idx,
                start_s=round(start, 2),
                end_s=round(end, 2),
                overlap_s=overlap_s if idx > 0 else 0.0,
                start_frame=int(round(start * fps)),
                end_frame=int(round(end * fps)),
            )
        )
        cursor += chunk_duration_s
        idx += 1
    return chunks


def _bbox_iou_xyxy(a: np.ndarray, b: np.ndarray) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    return inter / max(1e-6, area_a + area_b - inter)


def stitch_chunk_dataframes(
    chunk_dfs: list[pd.DataFrame],
    max_spatial_dist_m: float = 2.5,
    min_iou: float = 0.35,
) -> pd.DataFrame:
    """Stitch track_ids seamlessly across overlapping chunk boundaries & deduplicate overlap frames."""
    non_empty = [df.copy() for df in chunk_dfs if not df.empty]
    if not non_empty:
        return pd.DataFrame()
    if len(non_empty) == 1:
        return non_empty[0].reset_index(drop=True)

    merged = non_empty[0]
    next_global_tid = int(merged["track_id"].max()) + 1

    for nxt in non_empty[1:]:
        overlap_fids = sorted(set(merged["frame_id"].unique()) & set(nxt["frame_id"].unique()))
        remap: dict[int, int] = {}

        if overlap_fids:
            m_ov = merged[merged["frame_id"].isin(overlap_fids)]
            n_ov = nxt[nxt["frame_id"].isin(overlap_fids)]

            # Score candidate (nxt_tid -> prev_tid) pairs across overlapping frames
            pair_votes: dict[tuple[int, int], float] = {}
            for fid in overlap_fids:
                mf = m_ov[m_ov["frame_id"] == fid]
                nf = n_ov[n_ov["frame_id"] == fid]
                for _, nr in nf.iterrows():
                    ntid = int(nr["track_id"])
                    nb = np.array([nr["x1"], nr["y1"], nr["x2"], nr["y2"]], dtype=np.float32)
                    best_score = 0.0
                    best_mtid = None
                    for _, mr in mf.iterrows():
                        if str(mr.get("role")) != str(nr.get("role")):
                            continue
                        mb = np.array([mr["x1"], mr["y1"], mr["x2"], mr["y2"]], dtype=np.float32)
                        iou = _bbox_iou_xyxy(nb, mb)
                        score = iou
                        if pd.notna(nr.get("x_m")) and pd.notna(mr.get("x_m")):
                            dist_m = float(np.hypot(nr["x_m"] - mr["x_m"], nr["y_m"] - mr["y_m"]))
                            if dist_m <= max_spatial_dist_m:
                                score += (1.0 - dist_m / max_spatial_dist_m) * 0.6
                        if score >= min_iou and score > best_score:
                            best_score = score
                            best_mtid = int(mr["track_id"])
                    if best_mtid is not None:
                        key = (ntid, best_mtid)
                        pair_votes[key] = pair_votes.get(key, 0.0) + best_score

            # Greedy one-to-one highest-vote assignment
            used_prev: set[int] = set()
            for (ntid, mtid), _ in sorted(pair_votes.items(), key=lambda kv: kv[1], reverse=True):
                if ntid not in remap and mtid not in used_prev:
                    remap[ntid] = mtid
                    used_prev.add(mtid)

        # Assign fresh unique global IDs to unmapped new tracks
        for tid in sorted(nxt["track_id"].unique()):
            tid_i = int(tid)
            if tid_i < 0:
                remap[tid_i] = tid_i
            elif tid_i not in remap:
                remap[tid_i] = next_global_tid
                next_global_tid += 1

        nxt["track_id"] = nxt["track_id"].map(lambda x: remap[int(x)])
        # Drop duplicate frames already covered by previous chunk
        prev_max_fid = int(merged["frame_id"].max())
        nxt_new = nxt[nxt["frame_id"] > prev_max_fid]
        merged = pd.concat([merged, nxt_new], ignore_index=True)

    return merged.sort_values(["frame_id", "track_id"]).reset_index(drop=True)


def run_chunked_map_reduce(
    chunks: list[VideoChunkSpec],
    worker_fn: Callable[[VideoChunkSpec], pd.DataFrame],
    max_retries: int = 2,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """Fault-tolerant chunk runner (retries only failed chunks, then stitches tracks)."""
    results: list[pd.DataFrame] = []
    audit: list[dict[str, Any]] = []
    for ch in chunks:
        last_err = None
        for attempt in range(1, max_retries + 2):
            try:
                df = worker_fn(ch)
                results.append(df)
                audit.append({"chunk": ch.chunk_index, "status": "ok", "attempts": attempt, "rows": len(df)})
                last_err = None
                break
            except Exception as exc:
                last_err = str(exc)
        if last_err is not None:
            audit.append({"chunk": ch.chunk_index, "status": "failed", "error": last_err})
    return stitch_chunk_dataframes(results), audit
