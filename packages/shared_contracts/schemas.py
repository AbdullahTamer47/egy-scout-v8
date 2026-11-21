"""Unified data contracts for EGY-SCOUT V8 (Apache Parquet + Phase 0 Annotations).

Design rule from master_plan_v8.md:
- Frame-by-frame coordinates & tracking rows are stored ONLY in Apache Parquet (Zstd).
- PostgreSQL MATCH_TRACK table stores track-level metadata ONLY (never frame rows).
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

VALID_ROLES = ("player", "goalkeeper", "referee", "assistant_referee", "staff", "ball")
VALID_TEAMS = ("team_a", "team_b", "none")

TRACKING_PARQUET_SCHEMA = pa.schema(
    [
        ("match_id", pa.string()),
        ("frame_id", pa.int32()),
        ("time_s", pa.float32()),
        ("track_id", pa.int32()),
        ("role", pa.string()),
        ("team", pa.string()),
        ("role_conf", pa.float32()),
        ("team_conf", pa.float32()),
        ("x1", pa.float32()),
        ("y1", pa.float32()),
        ("x2", pa.float32()),
        ("y2", pa.float32()),
        ("u", pa.float32()),
        ("v", pa.float32()),
        ("x_m", pa.float32()),
        ("y_m", pa.float32()),
        ("on_pitch", pa.bool_()),
        ("jersey_number", pa.int16()),
        ("jersey_conf", pa.float32()),
        ("source_layer", pa.string()),
    ]
)

MATCH_TRACK_FIELDS = (
    "match_id",
    "track_id",
    "role",
    "team",
    "role_conf",
    "team_conf",
    "first_frame",
    "last_frame",
    "frame_count",
    "jersey_number",
    "jersey_conf",
    "parquet_uri",
)


@dataclass
class MatchTrackMetadata:
    """Metadata-only contract for PostgreSQL MATCH_TRACK (no frame-by-frame coords)."""

    match_id: str
    track_id: int
    role: str
    team: str
    role_conf: float
    team_conf: float
    first_frame: int
    last_frame: int
    frame_count: int
    jersey_number: Optional[int] = None
    jersey_conf: float = 0.0
    parquet_uri: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PersonAnnotation:
    """Single annotated person in a Phase 0 benchmark frame."""

    ann_id: int
    bbox: list[float]  # [x1, y1, x2, y2] in pixels
    role: str = "player"  # player | goalkeeper | referee | assistant_referee
    team: str = "none"  # team_a | team_b | none
    jersey_number: Optional[int] = None
    track_id: Optional[int] = None
    x_m: Optional[float] = None
    y_m: Optional[float] = None
    verified: bool = False
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class FrameAnnotation:
    """All annotated persons for a single extracted frame."""

    frame_id: int
    time_s: float
    image_rel_path: str
    width: int
    height: int
    persons: list[PersonAnnotation] = field(default_factory=list)
    completed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_id": self.frame_id,
            "time_s": self.time_s,
            "image_rel_path": self.image_rel_path,
            "width": self.width,
            "height": self.height,
            "completed": self.completed,
            "persons": [p.to_dict() for p in self.persons],
        }


@dataclass
class MatchAnnotationFile:
    """Phase 0 benchmark annotation file for one match."""

    schema_version: str = "v8.phase0.1"
    match_id: str = ""
    video_path: str = ""
    fps: float = 25.0
    team_a_name: str = "Team A"
    team_b_name: str = "Team B"
    frames: list[FrameAnnotation] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "match_id": self.match_id,
            "video_path": self.video_path,
            "fps": self.fps,
            "team_a_name": self.team_a_name,
            "team_b_name": self.team_b_name,
            "frames": [f.to_dict() for f in self.frames],
        }

    def save(self, path: str | Path) -> Path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return p

    @classmethod
    def load(cls, path: str | Path) -> "MatchAnnotationFile":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        frames: list[FrameAnnotation] = []
        for f in data.get("frames", []):
            persons = [PersonAnnotation(**p) for p in f.get("persons", [])]
            frames.append(
                FrameAnnotation(
                    frame_id=int(f["frame_id"]),
                    time_s=float(f.get("time_s", 0.0)),
                    image_rel_path=str(f.get("image_rel_path", "")),
                    width=int(f.get("width", 0)),
                    height=int(f.get("height", 0)),
                    persons=persons,
                    completed=bool(f.get("completed", False)),
                )
            )
        return cls(
            schema_version=data.get("schema_version", "v8.phase0.1"),
            match_id=data.get("match_id", ""),
            video_path=data.get("video_path", ""),
            fps=float(data.get("fps", 25.0)),
            team_a_name=data.get("team_a_name", "Team A"),
            team_b_name=data.get("team_b_name", "Team B"),
            frames=frames,
        )


def _normalize_tracking_df(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce a tracking DataFrame to match TRACKING_PARQUET_SCHEMA cleanly."""
    out = df.copy()
    defaults: dict[str, Any] = {
        "match_id": "",
        "frame_id": 0,
        "time_s": 0.0,
        "track_id": -1,
        "role": "player",
        "team": "none",
        "role_conf": 0.0,
        "team_conf": 0.0,
        "x1": 0.0,
        "y1": 0.0,
        "x2": 0.0,
        "y2": 0.0,
        "u": 0.0,
        "v": 0.0,
        "x_m": np.nan,
        "y_m": np.nan,
        "on_pitch": True,
        "jersey_number": -1,
        "jersey_conf": 0.0,
        "source_layer": "unknown",
    }
    for col, val in defaults.items():
        if col not in out.columns:
            out[col] = val

    out["match_id"] = out["match_id"].astype(str)
    out["frame_id"] = out["frame_id"].fillna(0).astype("int32")
    out["time_s"] = out["time_s"].fillna(0.0).astype("float32")
    out["track_id"] = out["track_id"].fillna(-1).astype("int32")
    out["role"] = out["role"].fillna("player").astype(str)
    out["team"] = out["team"].fillna("none").astype(str)
    for fcol in ("role_conf", "team_conf", "x1", "y1", "x2", "y2", "u", "v", "x_m", "y_m", "jersey_conf"):
        out[fcol] = pd.to_numeric(out[fcol], errors="coerce").astype("float32")
    out["on_pitch"] = out["on_pitch"].fillna(True).astype(bool)
    out["jersey_number"] = pd.to_numeric(out["jersey_number"], errors="coerce").fillna(-1).astype("int16")
    out["source_layer"] = out["source_layer"].fillna("unknown").astype(str)

    ordered_cols = [field.name for field in TRACKING_PARQUET_SCHEMA]
    return out[ordered_cols]


def write_tracking_parquet(
    df: pd.DataFrame, path: str | Path, compression: str = "zstd"
) -> Path:
    """Write frame-by-frame tracking rows to Apache Parquet (Zstd) with strict schema."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    norm = _normalize_tracking_df(df)
    table = pa.Table.from_pandas(norm, schema=TRACKING_PARQUET_SCHEMA, preserve_index=False)
    pq.write_table(table, str(p), compression=compression)
    return p


def read_tracking_parquet(path: str | Path) -> pd.DataFrame:
    """Read a V8 tracking Parquet file into a DataFrame."""
    return pd.read_parquet(str(path))


def load_legacy_scout5_telemetry(
    parquet_path: str | Path, match_id: Optional[str] = None
) -> pd.DataFrame:
    """Adapt legacy scout5 telemetry.parquet into V8 TRACKING_PARQUET_SCHEMA."""
    p = Path(parquet_path)
    raw = pd.read_parquet(str(p))
    mid = match_id or p.parent.name

    team_map = {0: "team_a", 1: "team_b"}
    if "team_id" in raw.columns:
        teams = raw["team_id"].map(lambda t: team_map.get(int(t), "none") if pd.notna(t) else "none")
    elif "team" in raw.columns:
        teams = raw["team"].astype(str)
    else:
        teams = pd.Series(["none"] * len(raw))

    df = pd.DataFrame(
        {
            "match_id": mid,
            "frame_id": raw["frame_id"],
            "time_s": raw.get("time_s", 0.0),
            "track_id": raw["track_id"],
            "role": raw.get("role", "player"),
            "team": teams,
            "role_conf": raw.get("conf", 0.5),
            "team_conf": raw.get("team_conf", 0.0),
            "x1": raw["x1"],
            "y1": raw["y1"],
            "x2": raw["x2"],
            "y2": raw["y2"],
            "u": raw.get("u", (raw["x1"] + raw["x2"]) / 2.0),
            "v": raw.get("v", raw["y2"]),
            "x_m": raw.get("x_m", np.nan),
            "y_m": raw.get("y_m", np.nan),
            "on_pitch": raw.get("on_pitch", True),
            "jersey_number": -1,
            "jersey_conf": 0.0,
            "source_layer": "legacy_scout5",
        }
    )
    return _normalize_tracking_df(df)


def build_match_track_metadata(
    df: pd.DataFrame, parquet_uri: str = ""
) -> list[MatchTrackMetadata]:
    """Summarize frame-level Parquet rows into PostgreSQL MATCH_TRACK metadata records."""
    if df.empty:
        return []
    records: list[MatchTrackMetadata] = []
    for (match_id, track_id), grp in df.groupby(["match_id", "track_id"], sort=True):
        mode_role = grp["role"].mode()
        mode_team = grp["team"].mode()
        valid_jerseys = grp.loc[grp["jersey_number"] >= 0, "jersey_number"]
        jersey_num = int(valid_jerseys.mode().iloc[0]) if not valid_jerseys.empty else None
        records.append(
            MatchTrackMetadata(
                match_id=str(match_id),
                track_id=int(track_id),
                role=str(mode_role.iloc[0]) if not mode_role.empty else "player",
                team=str(mode_team.iloc[0]) if not mode_team.empty else "none",
                role_conf=float(grp["role_conf"].mean()),
                team_conf=float(grp["team_conf"].mean()),
                first_frame=int(grp["frame_id"].min()),
                last_frame=int(grp["frame_id"].max()),
                frame_count=int(len(grp)),
                jersey_number=jersey_num,
                jersey_conf=float(grp["jersey_conf"].max()) if jersey_num is not None else 0.0,
                parquet_uri=parquet_uri,
            )
        )
    return records
