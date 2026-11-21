"""SQLAlchemy engine (SQLite WAL by default) and Parquet telemetry storage helpers."""
from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from core.config import get_settings

settings = get_settings()

_connect_args = {"check_same_thread": False} if settings.db_url.startswith("sqlite") else {}
engine = create_engine(settings.db_url, connect_args=_connect_args, pool_pre_ping=True)

if settings.db_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_columns() -> None:
    """Safely add newly introduced columns when upgrading an existing SQLite DB."""
    if not settings.db_url.startswith("sqlite"):
        return
    migrations = {
        "players": {
            "name_ar": "VARCHAR(128)",
            "division": "VARCHAR(32)",
            "market_value_egp": "INTEGER",
            "scouting_profile": "JSON",
        },
        "player_match_stats": {
            "fluidity_score": "FLOAT",
            "discipline_score": "FLOAT",
            "roaming_radius_m": "FLOAT",
            "avg_time_on_ball_sec": "FLOAT",
            "tactical_role_ar": "VARCHAR(128)",
        },
    }
    with engine.begin() as conn:
        for table, cols in migrations.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()}
            for col_name, col_type in cols.items():
                if col_name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"))


def init_db() -> None:
    from models import schema  # noqa: F401  (register models)

    Base.metadata.create_all(engine)
    _ensure_sqlite_columns()


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------- Parquet / JSON artifact storage ----------------
class MatchStorage:
    """File layout for a single match's heavy artifacts."""

    def __init__(self, match_id: int):
        self.match_id = match_id
        self.root = settings.telemetry_dir / str(match_id)
        self.root.mkdir(parents=True, exist_ok=True)

    @property
    def raw_path(self) -> Path:
        return self.root / "raw_detections.parquet"

    @property
    def camera_path(self) -> Path:
        return self.root / "camera_motion.parquet"

    @property
    def telemetry_path(self) -> Path:
        return self.root / "telemetry.parquet"

    @property
    def events_path(self) -> Path:
        return self.root / "events.parquet"

    @property
    def summary_path(self) -> Path:
        return self.root / "summary.json"

    @property
    def calibration_path(self) -> Path:
        return self.root / "calibration.json"

    @property
    def keyframes_dir(self) -> Path:
        d = self.root / "keyframes"
        d.mkdir(exist_ok=True)
        return d

    def write_df(self, path: Path, df: pd.DataFrame) -> None:
        df.to_parquet(path, compression="zstd", index=False)

    def read_df(self, path: Path) -> pd.DataFrame:
        if not path.exists():
            return pd.DataFrame()
        return pd.read_parquet(path)

    def write_json(self, path: Path, data: Any) -> None:
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    def read_json(self, path: Path, default: Any = None) -> Any:
        if not path.exists():
            return default
        return json.loads(path.read_text(encoding="utf-8"))

