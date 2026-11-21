"""Clean SQLAlchemy schema for EGY-SCOUT V5: Leagues, Clubs, Players, Matches, Jobs."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from scouting.database import Base


def _now() -> datetime:
    return datetime.utcnow()


class League(Base):
    __tablename__ = "leagues"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    country: Mapped[str] = mapped_column(String(64), default="Egypt")
    tier: Mapped[int] = mapped_column(Integer, default=1)
    clubs: Mapped[list[Club]] = relationship(back_populates="league")


class Club(Base):
    __tablename__ = "clubs"
    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int | None] = mapped_column(ForeignKey("leagues.id"))
    name: Mapped[str] = mapped_column(String(128), index=True)
    name_ar: Mapped[str | None] = mapped_column(String(128))
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    league: Mapped[League | None] = relationship(back_populates="clubs")
    players: Mapped[list[Player]] = relationship(back_populates="club")


class Player(Base):
    __tablename__ = "players"
    id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id"), index=True)
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    name_ar: Mapped[str | None] = mapped_column(String(128))
    division: Mapped[str | None] = mapped_column(String(32), index=True)
    jersey_number: Mapped[int | None] = mapped_column(Integer)
    position: Mapped[str | None] = mapped_column(String(64))
    birth_date: Mapped[date | None] = mapped_column(Date)
    age: Mapped[int | None] = mapped_column(Integer)
    height_cm: Mapped[int | None] = mapped_column(Integer)
    preferred_foot: Mapped[str | None] = mapped_column(String(16))
    nationality: Mapped[str | None] = mapped_column(String(64), default="Egypt")
    market_value_eur: Mapped[int | None] = mapped_column(Integer)
    market_value_egp: Mapped[int | None] = mapped_column(Integer)
    scouting_profile: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    club: Mapped[Club | None] = relationship(back_populates="players")


class MatchRecord(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(512))
    source_url: Mapped[str | None] = mapped_column(String(1024))
    competition: Mapped[str | None] = mapped_column(String(128))
    home_team_name: Mapped[str | None] = mapped_column(String(128))
    away_team_name: Mapped[str | None] = mapped_column(String(128))
    home_club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id"))
    away_club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id"))
    home_team_cluster: Mapped[int | None] = mapped_column(Integer, default=0)
    video_path: Mapped[str] = mapped_column(String(1024))
    fps: Mapped[float] = mapped_column(Float, default=25.0)
    width: Mapped[int] = mapped_column(Integer, default=1280)
    height: Mapped[int] = mapped_column(Integer, default=720)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    frame_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="created")
    cal_coverage_pct: Mapped[float] = mapped_column(Float, default=0.0)
    median_rep_err_px: Mapped[float | None] = mapped_column(Float)
    ball_calibrated_frames: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class JobRecord(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_slug: Mapped[str | None] = mapped_column(String(128), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class PlayerMatchLink(Base):
    """Persistent binding connecting a stitched video identity_key in a match to a DB Player portfolio."""
    __tablename__ = "player_match_links"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_slug: Mapped[str] = mapped_column(String(128), index=True)
    identity_key: Mapped[str] = mapped_column(String(64), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    team_id: Mapped[int | None] = mapped_column(Integer)
    jersey_number: Mapped[int | None] = mapped_column(Integer)
    overall_score: Mapped[float | None] = mapped_column(Float)
    max_speed_kmh: Mapped[float | None] = mapped_column(Float)
    distance_m: Mapped[float | None] = mapped_column(Float)
    avg_voronoi_m2: Mapped[float | None] = mapped_column(Float)
    portrait_url: Mapped[str | None] = mapped_column(String(256))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
