"""FastAPI local server for EGY-SCOUT Phase 0 Fast Keyboard Annotator.

Run with:
    python -m tools.phase0_annotator.server --port 8765
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import BaseModel

from packages.shared_contracts.config import get_data_paths
from packages.shared_contracts.schemas import (
    FrameAnnotation,
    MatchAnnotationFile,
    PersonAnnotation,
)

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")


class PropagateTrackRequest(BaseModel):
    track_id: int
    role: str
    team: str
    jersey_number: Optional[int] = None


def create_app(benchmark_dir: Optional[str | Path] = None) -> FastAPI:
    bench_root = (
        Path(benchmark_dir)
        if benchmark_dir is not None
        else get_data_paths().benchmark
    )
    ann_dir = bench_root / "annotations"
    ann_dir.mkdir(parents=True, exist_ok=True)
    static_index = Path(__file__).resolve().parent / "static" / "index.html"

    app = FastAPI(title="EGY-SCOUT Phase 0 Annotator", version="8.0.1")

    def _safe_ann_path(match_id: str) -> Path:
        if not SAFE_ID_RE.match(match_id):
            raise HTTPException(status_code=400, detail="Invalid match_id")
        return ann_dir / f"{match_id}.json"

    @app.get("/", response_class=HTMLResponse)
    def serve_ui() -> HTMLResponse:
        if not static_index.is_file():
            raise HTTPException(status_code=500, detail="Annotator UI missing")
        return HTMLResponse(static_index.read_text(encoding="utf-8"))

    @app.get("/api/matches")
    def list_matches() -> dict[str, Any]:
        items = []
        total_frames = 0
        completed_frames = 0
        for p in sorted(ann_dir.glob("*.json")):
            mf = MatchAnnotationFile.load(p)
            n_frames = len(mf.frames)
            n_done = sum(1 for f in mf.frames if f.completed)
            total_frames += n_frames
            completed_frames += n_done
            items.append(
                {
                    "match_id": mf.match_id,
                    "team_a_name": mf.team_a_name,
                    "team_b_name": mf.team_b_name,
                    "total_frames": n_frames,
                    "completed_frames": n_done,
                }
            )
        return {
            "benchmark_dir": str(bench_root),
            "target_frames": 300,
            "total_frames": total_frames,
            "completed_frames": completed_frames,
            "matches": items,
        }

    @app.get("/api/matches/{match_id}")
    def get_match(match_id: str) -> dict[str, Any]:
        p = _safe_ann_path(match_id)
        if not p.is_file():
            raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
        return MatchAnnotationFile.load(p).to_dict()

    @app.put("/api/matches/{match_id}")
    def save_match(match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        p = _safe_ann_path(match_id)
        frames: list[FrameAnnotation] = []
        for f in payload.get("frames", []):
            persons = [PersonAnnotation(**person) for person in f.get("persons", [])]
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
        mf = MatchAnnotationFile(
            schema_version=str(payload.get("schema_version", "v8.phase0.1")),
            match_id=match_id,
            video_path=str(payload.get("video_path", "")),
            fps=float(payload.get("fps", 25.0)),
            team_a_name=str(payload.get("team_a_name", "Team A")),
            team_b_name=str(payload.get("team_b_name", "Team B")),
            frames=frames,
        )
        mf.save(p)
        return {
            "status": "saved",
            "match_id": match_id,
            "completed_frames": sum(1 for f in mf.frames if f.completed),
            "total_frames": len(mf.frames),
        }

    @app.post("/api/matches/{match_id}/propagate_track")
    def propagate_track(match_id: str, req: PropagateTrackRequest) -> dict[str, Any]:
        """Propagate role/team/jersey to all frames sharing track_id in this match."""
        p = _safe_ann_path(match_id)
        if not p.is_file():
            raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
        mf = MatchAnnotationFile.load(p)
        updated = 0
        for f in mf.frames:
            for person in f.persons:
                if person.track_id == req.track_id:
                    person.role = req.role
                    person.team = req.team
                    if req.jersey_number is not None:
                        person.jersey_number = req.jersey_number
                    person.verified = True
                    updated += 1
        mf.save(p)
        return {"status": "propagated", "track_id": req.track_id, "updated_instances": updated}

    @app.get("/api/matches/{match_id}/frame/{frame_id}/image")
    def get_frame_image(match_id: str, frame_id: int) -> Response:
        if not SAFE_ID_RE.match(match_id):
            raise HTTPException(status_code=400, detail="Invalid match_id")
        img_path = bench_root / "frames" / match_id / f"frame_{frame_id:06d}.jpg"
        if not img_path.is_file():
            raise HTTPException(status_code=404, detail="Frame image not found")
        return FileResponse(str(img_path), media_type="image/jpeg")

    return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description="Run EGY-SCOUT Phase 0 Fast Annotator UI.")
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=str, default="")
    args = parser.parse_args()

    bench_dir = (
        Path(args.data_dir) / "datasets" / "egypt_benchmark"
        if args.data_dir
        else get_data_paths().benchmark
    )
    app = create_app(bench_dir)
    print(f"[EGY-SCOUT Phase 0 Annotator] Open http://{args.host}:{args.port} (data: {bench_dir})")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
