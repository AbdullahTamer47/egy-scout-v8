"""Modal Serverless Cloud GPU Worker (NVIDIA L4 24GB VRAM, Scale-to-Zero).

Deploy online once with:
    pip install modal && modal setup
    modal deploy services/cv_worker/modal_gpu_app.py

Then paste the printed HTTPS endpoint URL into EGY-SCOUT -> Import Match -> Cloud GPU Settings
or set EGY_SCOUT_CLOUD_WORKER_URL in `.env`. End-users run zero heavy CV compute on their laptops/phones.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

try:
    import modal  # type: ignore
except ImportError:  # pragma: no cover - optional runtime dependency
    modal = None


if modal is not None:
    image = (
        modal.Image.debian_slim(python_version="3.11")
        .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
        .pip_install(
            "fastapi",
            "python-multipart",
            "ultralytics",
            "supervision",
            "opencv-python-headless",
            "numpy",
            "pandas",
            "scikit-learn",
            "transformers",
            "umap-learn",
            "torch",
            "torchvision",
        )
        .add_local_dir("packages", remote_path="/root/app/packages")
        .add_local_dir("services", remote_path="/root/app/services")
        .add_local_dir("egy-tactical-scout/backend/weights", remote_path="/root/app/egy-tactical-scout/backend/weights")
    )

    app = modal.App("egy-scout-cv-worker", image=image)

    @app.function(gpu="L4", timeout=600, scaledown_window=120)
    @modal.fastapi_endpoint(method="POST")
    async def analyze_clip(file: Any, meta: str = "{}") -> dict[str, Any]:
        import sys
        sys.path.insert(0, "/root/app")
        os.environ["EGY_SCOUT_COMPUTE_PROVIDER"] = "modal_l4"

        from services.cv_worker.local_pipeline import ingest_clip_with_football_yolo

        parsed_meta = json.loads(meta) if meta else {}
        raw_bytes = await file.read()
        with tempfile.TemporaryDirectory() as tmpdir:
            vid_path = Path(tmpdir) / "input.mp4"
            vid_path.write_bytes(raw_bytes)
            raw_df, v8_df, _, kit_colors, fps, extra_meta = ingest_clip_with_football_yolo(
                video_path=vid_path,
                run_id=str(parsed_meta.get("run_id") or "modal_run"),
                max_sample_frames=int(parsed_meta.get("max_sample_frames") or 240),
                stride=int(parsed_meta.get("stride") or 2),
                use_siglip=True,
                use_pitch_calib=True,
                use_sahi_ball=True,
                team_a_name=str(parsed_meta.get("team_a_name") or "Team A"),
                team_b_name=str(parsed_meta.get("team_b_name") or "Team B"),
                run_jersey_ocr=True,
            )
        extra_meta["compute_mode"] = "modal_l4_cloud_gpu"
        return {
            "raw_rows": raw_df.to_dict(orient="records"),
            "v8_rows": v8_df.to_dict(orient="records"),
            "kit_colors": kit_colors,
            "fps": fps,
            "extra_meta": extra_meta,
        }
