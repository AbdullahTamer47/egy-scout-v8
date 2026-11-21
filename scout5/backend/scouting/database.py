"""SQLite persistence setup for EGY-SCOUT V5."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATA_ROOT = Path(r"D:\مدرب\scout5\data")
DATA_ROOT.mkdir(parents=True, exist_ok=True)
DB_URL = f"sqlite:///{(DATA_ROOT / 'scout5.db').as_posix()}"

engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import scouting.models  # noqa: F401
    Base.metadata.create_all(bind=engine)
