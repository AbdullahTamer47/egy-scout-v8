"""Path management, environment configuration, and Unicode-safe OpenCV I/O.

Ensures all image/video/weight operations handle arbitrary Unicode paths on
Windows (e.g. legacy D:\\مدرب\\... paths) and respects EGY_SCOUT_DATA_DIR
(defaulting to an ASCII English path such as D:\\egy-scout-data on Windows).
"""
from __future__ import annotations

import os
import platform
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

LEGACY_ARABIC_ROOTS = (
    "D:\\مدرب",
    "d:\\مدرب",
    "D:/مدرب",
    "d:/مدرب",
)


def get_repo_root() -> Path:
    """Return the workspace repository root (parent of packages/)."""
    env_root = os.environ.get("EGY_SCOUT_REPO_ROOT")
    if env_root:
        return Path(env_root).resolve()
    return Path(__file__).resolve().parents[2]


def default_data_root() -> Path:
    """Return an ASCII-safe default root for datasets, caches, and weights."""
    env_dir = os.environ.get("EGY_SCOUT_DATA_DIR")
    if env_dir:
        return Path(env_dir)
    if os.path.exists("/kaggle/working"):
        return Path("/kaggle/working/egy-scout-data")
    if os.path.exists("/content"):
        return Path("/content/egy-scout-data")
    if platform.system() == "Windows":
        if Path("D:\\").exists():
            return Path(r"D:\egy-scout-data")
        return Path.home() / "egy-scout-data"
    return Path.home() / "egy-scout-data"


@dataclass(frozen=True)
class DataPaths:
    root: Path
    datasets: Path
    benchmark: Path
    weights: Path
    cache: Path
    outputs: Path

    def ensure_all(self) -> "DataPaths":
        for p in (
            self.root,
            self.datasets,
            self.benchmark,
            self.weights,
            self.cache,
            self.outputs,
        ):
            p.mkdir(parents=True, exist_ok=True)
        return self


def get_data_paths(root: Optional[str | Path] = None, create: bool = True) -> DataPaths:
    """Build structured ASCII-safe paths for datasets, weights, cache, and outputs."""
    base = Path(root) if root is not None else default_data_root()
    paths = DataPaths(
        root=base,
        datasets=base / "datasets",
        benchmark=base / "datasets" / "egypt_benchmark",
        weights=base / "weights",
        cache=base / "cache",
        outputs=base / "outputs",
    )
    if create:
        paths.ensure_all()
    return paths


def resolve_project_path(raw_path: str | Path, repo_root: Optional[Path] = None) -> Path:
    """Resolve a path, automatically remapping legacy D:\\مدرب\\ paths to current repo root."""
    root = repo_root or get_repo_root()
    raw_str = str(raw_path)
    direct = Path(raw_str)
    if direct.exists():
        return direct

    for legacy in LEGACY_ARABIC_ROOTS:
        if raw_str.startswith(legacy):
            suffix = raw_str[len(legacy) :].lstrip("\\/")
            candidate = root / Path(suffix)
            if candidate.exists():
                return candidate

    # Fallback: search by filename in standard video directories
    name = direct.name
    if name:
        search_dirs = [
            root / "scout5" / "data" / "videos",
            root / "egy-tactical-scout" / "backend" / "data" / "videos",
            get_data_paths(create=False).root / "videos",
        ]
        for sdir in search_dirs:
            cand = sdir / name
            if cand.exists():
                return cand

    return direct


def imread_unicode(
    path: str | Path, flags: int = cv2.IMREAD_COLOR
) -> Optional[np.ndarray]:
    """Read an image from any Unicode path safely via np.fromfile + cv2.imdecode."""
    p = Path(path)
    if not p.is_file():
        return None
    buf = np.fromfile(str(p), dtype=np.uint8)
    if buf.size == 0:
        return None
    return cv2.imdecode(buf, flags)


def imwrite_unicode(
    path: str | Path,
    image: np.ndarray,
    params: Optional[list[int]] = None,
) -> bool:
    """Write an image to any Unicode path safely via cv2.imencode + ndarray.tofile."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    ext = p.suffix.lower() or ".jpg"
    ok, encoded = cv2.imencode(ext, image, params or [])
    if not ok:
        return False
    encoded.tofile(str(p))
    return True


def open_video_unicode(path: str | Path) -> tuple[cv2.VideoCapture, Optional[Path]]:
    """Open a video with cv2.VideoCapture safely even if the path contains Unicode.

    Returns (capture, temp_proxy_path). If temp_proxy_path is not None, the caller
    should delete it when done (or use SafeVideoCapture context manager).
    """
    p = Path(path)
    cap = cv2.VideoCapture(str(p))
    if cap.isOpened():
        return cap, None

    # Fallback for FFmpeg/OpenCV builds that fail on non-ASCII Windows paths
    cap.release()
    if not p.is_file():
        return cv2.VideoCapture(), None

    tmp_dir = Path(tempfile.gettempdir()) / "egy_scout_video_proxy"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    proxy = tmp_dir / f"proxy_{abs(hash(str(p)))}{p.suffix or '.mp4'}"
    if not proxy.exists():
        try:
            os.link(str(p), str(proxy))
        except OSError:
            shutil.copy2(str(p), str(proxy))
    cap = cv2.VideoCapture(str(proxy))
    return cap, proxy
