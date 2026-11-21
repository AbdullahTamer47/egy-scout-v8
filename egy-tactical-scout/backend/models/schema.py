"""SQLAlchemy models: leagues, clubs, players, matches, per-match player stats, jobs, Phase-2 talent submissions."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


def _now() -> datetime:
    return datetime.utcnow()


class League(Base):
    __tablename__ = "leagues"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)  # e.g. EGY1, EGY2
    name: Mapped[str] = mapped_column(String(128))
    country: Mapped[str] = mapped_column(String(64), default="Egypt")
    tier: Mapped[int] = mapped_column(Integer, default=1)
    source_url: Mapped[str | None] = mapped_column(String(512))
    clubs: Mapped[list[Club]] = relationship(back_populates="league")


class Club(Base):
    __tablename__ = "clubs"
    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int | None] = mapped_column(ForeignKey("leagues.id"))
    name: Mapped[str] = mapped_column(String(128), index=True)
    name_ar: Mapped[str | None] = mapped_column(String(128))
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    source_url: Mapped[str | None] = mapped_column(String(512))
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
    nationality: Mapped[str | None] = mapped_column(String(64))
    market_value_eur: Mapped[int | None] = mapped_column(Integer)
    market_value_egp: Mapped[int | None] = mapped_column(Integer)
    scouting_profile: Mapped[dict | None] = mapped_column(JSON)
    source_url: Mapped[str | None] = mapped_column(String(512))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    club: Mapped[Club | None] = relationship(back_populates="players")
    match_stats: Mapped[list[PlayerMatchStats]] = relationship(back_populates="player")


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(512))
    source_url: Mapped[str | None] = mapped_column(String(1024))
    source_video_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    channel: Mapped[str | None] = mapped_column(String(256))
    competition: Mapped[str | None] = mapped_column(String(128))
    match_date: Mapped[date | None] = mapped_column(Date)
    home_team_name: Mapped[str | None] = mapped_column(String(128))
    away_team_name: Mapped[str | None] = mapped_column(String(128))
    home_club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id"))
    away_club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id"))
    # which tracked colour cluster (0/1) is the home side; None = unknown
    home_team_cluster: Mapped[int | None] = mapped_column(Integer)
    video_path: Mapped[str | None] = mapped_column(String(1024))
    fps: Mapped[float] = mapped_column(Float, default=25.0)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_s: Mapped[float | None] = mapped_column(Float)
    frame_count: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="created")
    # created | downloading | downloaded | tracking | tracked | analyzing | ready | failed
    has_pitch_coords: Mapped[bool] = mapped_column(Boolean, default=False)
    pitch_coverage: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    player_stats: Mapped[list[PlayerMatchStats]] = relationship(back_populates="match", cascade="all, delete-orphan")


class PlayerMatchStats(Base):
    """One row per tracked identity (team cluster + jersey, or fragment track) in a match."""

    __tablename__ = "player_match_stats"
    __table_args__ = (UniqueConstraint("match_id", "identity_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), index=True)
    identity_key: Mapped[str] = mapped_column(String(64))
    track_ids: Mapped[list] = mapped_column(JSON, default=list)
    team_cluster: Mapped[int] = mapped_column(Integer)
    jersey_number: Mapped[int | None] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(16), default="player")
    minutes_tracked: Mapped[float] = mapped_column(Float, default=0.0)
    total_distance_m: Mapped[float] = mapped_column(Float, default=0.0)
    distance_per_min_m: Mapped[float] = mapped_column(Float, default=0.0)
    max_speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    avg_speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    hir_distance_m: Mapped[float] = mapped_column(Float, default=0.0)
    sprint_distance_m: Mapped[float] = mapped_column(Float, default=0.0)
    hir_count: Mapped[int] = mapped_column(Integer, default=0)
    sprint_count: Mapped[int] = mapped_column(Integer, default=0)
    passes: Mapped[int] = mapped_column(Integer, default=0)
    passes_completed: Mapped[int] = mapped_column(Integer, default=0)
    progressive_passes: Mapped[int] = mapped_column(Integer, default=0)
    line_breaking_passes: Mapped[int] = mapped_column(Integer, default=0)
    progressive_carries: Mapped[int] = mapped_column(Integer, default=0)
    xt_generated: Mapped[float] = mapped_column(Float, default=0.0)
    pressing_actions: Mapped[int] = mapped_column(Integer, default=0)
    recoveries: Mapped[int] = mapped_column(Integer, default=0)
    avg_space_m2: Mapped[float | None] = mapped_column(Float)
    avg_attacking_space_m2: Mapped[float | None] = mapped_column(Float)
    space_created_m2: Mapped[float | None] = mapped_column(Float)
    offball_runs: Mapped[int] = mapped_column(Integer, default=0)
    tactical_deviation_m: Mapped[float | None] = mapped_column(Float)
    avg_x_m: Mapped[float | None] = mapped_column(Float)
    avg_y_m: Mapped[float | None] = mapped_column(Float)
    heatmap: Mapped[list | None] = mapped_column(JSON)  # 12x8 occupancy fractions
    scout_score: Mapped[float | None] = mapped_column(Float)
    score_breakdown: Mapped[dict | None] = mapped_column(JSON)
    fluidity_score: Mapped[float | None] = mapped_column(Float)
    discipline_score: Mapped[float | None] = mapped_column(Float)
    roaming_radius_m: Mapped[float | None] = mapped_column(Float)
    avg_time_on_ball_sec: Mapped[float | None] = mapped_column(Float)
    tactical_role_ar: Mapped[str | None] = mapped_column(String(128))
    verdict: Mapped[str | None] = mapped_column(String(128))
    match: Mapped[Match] = relationship(back_populates="player_stats")
    player: Mapped[Player | None] = relationship(back_populates="match_stats")


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))  # ingest | track | analyze | render | scrape | harvest
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued | running | done | failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str | None] = mapped_column(Text)
    result: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class TalentSubmission(Base):
    """Phase 2: public self-upload talent portal. Present in schema, disabled in the Phase-1 UI."""

    __tablename__ = "talent_submissions"
    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(128))
    birth_date: Mapped[date | None] = mapped_column(Date)
    governorate: Mapped[str | None] = mapped_column(String(64))
    position: Mapped[str | None] = mapped_column(String(64))
    preferred_foot: Mapped[str | None] = mapped_column(String(16))
    height_cm: Mapped[int | None] = mapped_column(Integer)
    current_club: Mapped[str | None] = mapped_column(String(128))
    contact_phone: Mapped[str | None] = mapped_column(String(32))
    contact_email: Mapped[str | None] = mapped_column(String(128))
    video_path: Mapped[str | None] = mapped_column(String(1024))
    linked_match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.id"))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    reviewer_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

