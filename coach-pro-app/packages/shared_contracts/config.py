"""Standalone Vercel-safe configuration & seed manager for EGY-SCOUT Coach Pro (zero cv2)."""
from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


def get_repo_root() -> Path:
    env_root = os.environ.get("EGY_SCOUT_REPO_ROOT")
    if env_root:
        return Path(env_root).resolve()
    return Path(__file__).resolve().parents[2]


def default_data_root() -> Path:
    env_dir = os.environ.get("EGY_SCOUT_DATA_DIR")
    if env_dir:
        return Path(env_dir)
    if os.environ.get("VERCEL"):
        return Path("/tmp/egy_scout_coach_pro")
    return get_repo_root() / ".data"


@dataclass(frozen=True)
class DataPaths:
    root: Path
    datasets: Path
    benchmark: Path
    weights: Path
    cache: Path
    outputs: Path

    def ensure_all(self) -> "DataPaths":
        for p in (self.root, self.datasets, self.benchmark, self.weights, self.cache, self.outputs):
            p.mkdir(parents=True, exist_ok=True)
        seed_json = get_repo_root() / "data" / "egyptian_league_full_2026_27.json"
        target_json = self.cache / "egyptian_league_full_2026_27.json"
        if seed_json.is_file() and not target_json.is_file():
            try:
                shutil.copy2(seed_json, target_json)
            except Exception:
                pass
        return self


def get_data_paths() -> DataPaths:
    root = default_data_root()
    return DataPaths(
        root=root,
        datasets=root / "datasets",
        benchmark=root / "benchmark",
        weights=root / "weights",
        cache=root / "cache",
        outputs=root / "outputs",
    ).ensure_all()
