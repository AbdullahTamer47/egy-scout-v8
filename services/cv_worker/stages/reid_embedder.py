"""Appearance Re-ID Track Merger (Wave 1, Section 9.4 — OSNet / SigLIP cosine stitching)."""
from __future__ import annotations

import numpy as np
import pandas as pd


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-6 or nb < 1e-6:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def merge_fragmented_tracks_reid(
    df: pd.DataFrame,
    track_embeddings: dict[int, np.ndarray],
    sim_threshold: float = 0.86,
    max_frame_gap: int = 150,
    max_speed_mps: float = 10.0,
) -> tuple[pd.DataFrame, dict[int, int]]:
    """Merge non-overlapping fragmented tracks of the same player using Re-ID cosine similarity."""
    if df.empty or not track_embeddings:
        return df.copy(), {}

    summaries = []
    for tid, grp in df.groupby("track_id", sort=True):
        t_i = int(tid)
        if t_i < 0 or t_i not in track_embeddings:
            continue
        grp = grp.sort_values("frame_id")
        summaries.append(
            {
                "tid": t_i,
                "role": str(grp["role"].mode().iloc[0]),
                "team": str(grp["team"].mode().iloc[0]),
                "f_start": int(grp["frame_id"].iloc[0]),
                "f_end": int(grp["frame_id"].iloc[-1]),
                "t_start": float(grp["time_s"].iloc[0]),
                "t_end": float(grp["time_s"].iloc[-1]),
                "x_start": float(grp["x_m"].iloc[0]) if pd.notna(grp["x_m"].iloc[0]) else np.nan,
                "y_start": float(grp["y_m"].iloc[0]) if pd.notna(grp["y_m"].iloc[0]) else np.nan,
                "x_end": float(grp["x_m"].iloc[-1]) if pd.notna(grp["x_m"].iloc[-1]) else np.nan,
                "y_end": float(grp["y_m"].iloc[-1]) if pd.notna(grp["y_m"].iloc[-1]) else np.nan,
                "emb": track_embeddings[t_i],
            }
        )
    summaries.sort(key=lambda s: s["f_start"])

    parent: dict[int, int] = {}

    def find(x: int) -> int:
        while x in parent:
            x = parent[x]
        return x

    for i in range(len(summaries)):
        a = summaries[i]
        best_j = None
        best_sim = sim_threshold
        for j in range(i + 1, len(summaries)):
            b = summaries[j]
            if b["f_start"] <= a["f_end"]:
                continue  # temporally overlapping -> cannot be same person
            gap = b["f_start"] - a["f_end"]
            if gap > max_frame_gap:
                break
            if a["role"] != b["role"] or a["team"] != b["team"]:
                continue
            dt = max(0.1, b["t_start"] - a["t_end"])
            if np.isfinite(a["x_end"]) and np.isfinite(b["x_start"]):
                dist_m = float(np.hypot(b["x_start"] - a["x_end"], b["y_start"] - a["y_end"]))
                if dist_m > max_speed_mps * dt + 3.0:
                    continue
            sim = cosine_similarity(a["emb"], b["emb"])
            if sim >= best_sim:
                best_sim = sim
                best_j = j
        if best_j is not None:
            parent[summaries[best_j]["tid"]] = find(a["tid"])

    remap = {s["tid"]: find(s["tid"]) for s in summaries if find(s["tid"]) != s["tid"]}
    if not remap:
        return df.copy(), {}

    out = df.copy()
    out["track_id"] = out["track_id"].map(lambda x: remap.get(int(x), int(x)))
    return out, remap
