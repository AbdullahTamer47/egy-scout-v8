"""Central configuration: environment variables, pitch geometry and storage paths."""
from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

# ---- Pitch geometry (FIFA standard, meters) ----
PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0
PENALTY_BOX_LENGTH = 16.5
PENALTY_BOX_WIDTH = 40.32
GOAL_BOX_LENGTH = 5.5
GOAL_BOX_WIDTH = 18.32
PENALTY_SPOT = 11.0
CENTRE_CIRCLE_RADIUS = 9.15

# ---- Physical thresholds (km/h) ----
MAX_HUMAN_SPEED_KMH = 39.5
HIR_SPEED_KMH = 19.8
SPRINT_SPEED_KMH = 25.2
SPRINT_MIN_DURATION_S = 1.0
PRESSING_SPEED_KMH = 18.0
PRESSING_RADIUS_M = 4.0
OFFBALL_RUN_SPEED_KMH = 21.0

# ---- Camera filter ----
GRASS_HSV_LOWER = (25, 25, 25)
GRASS_HSV_UPPER = (92, 255, 255)
MIN_GREEN_RATIO = 0.22


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BACKEND_DIR / ".env"), env_prefix="EGY_", extra="ignore")

    data_dir: Path = BACKEND_DIR / "data"
    database_url: str = ""

    # Football-specific open-source detector (roboflow/sports dataset): {ball, goalkeeper, player, referee}
    detector_weights: str = "weights/yolo-football-player-detection.pt"
    detector_conf: float = 0.25
    detector_imgsz: int = 1280
    # Open-source 32-keypoint pitch model (roboflow/sports layout) for real camera calibration
    pitch_keypoint_weights: str = "weights/yolo-football-pitch-detection.pt"
    keypoint_conf: float = 0.5
    keypoint_every_n: int = 2  # run keypoint model every N processed frames, propagate with optical flow between

    target_fps: float = 25.0
    max_video_height: int = 720
    frame_stride: int = 2  # process every Nth frame (CPU friendly)
    ocr_every_n_frames: int = 15
    ocr_enabled: bool = True
    team_fit_samples: int = 400

    enable_auto_harvest: bool = False
    auto_harvest_interval_hours: int = 12
    auto_harvest_max_results: int = 2
    auto_harvest_max_seconds: int = 600

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def videos_dir(self) -> Path:
        return self.data_dir / "videos"

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw_matches"

    @property
    def telemetry_dir(self) -> Path:
        return self.data_dir / "telemetry"

    @property
    def renders_dir(self) -> Path:
        return self.data_dir / "renders"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def db_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'egy_scout.db').as_posix()}"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.videos_dir, self.raw_dir, self.telemetry_dir, self.renders_dir, self.cache_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s


def find_ffmpeg() -> str | None:
    """Locate ffmpeg on PATH or in the default winget links directory (Windows)."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    candidates = []
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates.append(Path(local) / "Microsoft" / "WinGet" / "Links" / "ffmpeg.exe")
        pkg_root = Path(local) / "Microsoft" / "WinGet" / "Packages"
        if pkg_root.exists():
            candidates.extend(pkg_root.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"))
    for c in candidates:
        if Path(c).exists():
            return str(c)
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None
