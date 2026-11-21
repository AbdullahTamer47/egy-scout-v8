"""Targeted local verification suite for EGY-SCOUT V8 — Wave 0 / Sprint 0.1."""
from __future__ import annotations

import ast
import json
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from packages.shared_contracts.config import (
    get_data_paths,
    get_repo_root,
    imread_unicode,
    imwrite_unicode,
    resolve_project_path,
)
from packages.shared_contracts.providers import (
    ColabComputeProvider,
    KaggleComputeProvider,
    LocalComputeProvider,
    ModalComputeProvider,
    get_compute_provider,
)
from packages.shared_contracts.schemas import (
    MATCH_TRACK_FIELDS,
    TRACKING_PARQUET_SCHEMA,
    FrameAnnotation,
    MatchAnnotationFile,
    PersonAnnotation,
    build_match_track_metadata,
    load_legacy_scout5_telemetry,
    read_tracking_parquet,
    write_tracking_parquet,
)
from services.cv_worker.stages.referee_shield import (
    RefereeShieldConfig,
    SigLIPThreeClassClusterer,
    ZeroRefereeLeakShield,
)
from tools.benchmark_evaluator.evaluate import (
    evaluate_predictions,
    format_comparison_markdown,
)
from tools.phase0_annotator.extract_frames import (
    discover_scout5_matches,
    extract_match_benchmark_frames,
    select_representative_frame_ids,
)
from tools.phase0_annotator.server import create_app


class TestSprint01(unittest.TestCase):
    def test_unicode_image_io_and_legacy_path_remap(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            arabic_path = Path(tmp) / "مجلد_عربي" / "فريم_١٢٥٠.jpg"
            img = np.full((64, 96, 3), (30, 180, 90), dtype=np.uint8)
            self.assertTrue(imwrite_unicode(arabic_path, img))
            self.assertTrue(arabic_path.is_file())
            loaded = imread_unicode(arabic_path)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.shape, (64, 96, 3))

        remapped = resolve_project_path(
            r"D:\مدرب\egy-tactical-scout\backend\data\videos\9OcELOXQg2c.mp4"
        )
        self.assertTrue(remapped.is_file(), f"Expected remapped video to exist: {remapped}")

    def test_env_data_dir_and_pluggable_providers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            old = os.environ.get("EGY_SCOUT_DATA_DIR")
            os.environ["EGY_SCOUT_DATA_DIR"] = tmp
            try:
                paths = get_data_paths(create=True)
                self.assertEqual(paths.root, Path(tmp))
                self.assertTrue(paths.benchmark.is_dir())
                self.assertTrue(paths.weights.is_dir())
            finally:
                if old is None:
                    os.environ.pop("EGY_SCOUT_DATA_DIR", None)
                else:
                    os.environ["EGY_SCOUT_DATA_DIR"] = old

        self.assertIsInstance(get_compute_provider("local"), LocalComputeProvider)
        self.assertIsInstance(get_compute_provider("kaggle"), KaggleComputeProvider)
        self.assertIsInstance(get_compute_provider("colab"), ColabComputeProvider)
        modal = get_compute_provider("modal_l4")
        self.assertIsInstance(modal, ModalComputeProvider)
        self.assertEqual(modal.get_device_info().recommended_precision, "bf16")

    def test_parquet_roundtrip_and_match_track_metadata_only(self) -> None:
        df = pd.DataFrame(
            [
                {
                    "match_id": "m2_ahly_enppi",
                    "frame_id": 1250,
                    "time_s": 50.0,
                    "track_id": 9,
                    "role": "referee",
                    "team": "none",
                    "role_conf": 0.92,
                    "team_conf": 0.0,
                    "x1": 100.0,
                    "y1": 200.0,
                    "x2": 130.0,
                    "y2": 280.0,
                    "u": 115.0,
                    "v": 280.0,
                    "x_m": 33.7,
                    "y_m": 43.7,
                    "on_pitch": True,
                    "jersey_number": -1,
                    "jersey_conf": 0.0,
                    "source_layer": "layer4_temporal_vote",
                }
            ]
        )
        with tempfile.TemporaryDirectory() as tmp:
            pq_path = Path(tmp) / "track_test.parquet"
            write_tracking_parquet(df, pq_path)
            loaded = read_tracking_parquet(pq_path)
            self.assertEqual(list(loaded.columns), [f.name for f in TRACKING_PARQUET_SCHEMA])
            self.assertEqual(loaded.iloc[0]["role"], "referee")

            meta = build_match_track_metadata(loaded, parquet_uri=str(pq_path))
            self.assertEqual(len(meta), 1)
            meta_dict = meta[0].to_dict()
            self.assertEqual(tuple(meta_dict.keys()), MATCH_TRACK_FIELDS)
            # Ensure frame-level coordinates are NOT in PostgreSQL MATCH_TRACK metadata
            for forbidden in ("x1", "y1", "x2", "y2", "x_m", "y_m"):
                self.assertNotIn(forbidden, meta_dict)

    def test_4layer_referee_shield_fixes_frame_1250_leaks(self) -> None:
        legacy_p = get_repo_root() / "scout5" / "data" / "matches" / "m2_ahly_enppi" / "telemetry.parquet"
        self.assertTrue(legacy_p.is_file())
        legacy_df = load_legacy_scout5_telemetry(legacy_p, match_id="m2_ahly_enppi")

        # Verify legacy BEFORE really has the leak on frame 1250 track 9 & track 20
        f1250_before = legacy_df[legacy_df["frame_id"] == 1250]
        t9_before = f1250_before[f1250_before["track_id"] == 9].iloc[0]
        t20_before = f1250_before[f1250_before["track_id"] == 20].iloc[0]
        self.assertEqual(t9_before["role"], "player")
        self.assertEqual(t20_before["role"], "player")

        # Apply 4-layer shield (layers 1+2 low-conf rejection + layer 3 touchline + layer 4 temporal vote)
        shield = ZeroRefereeLeakShield(config=RefereeShieldConfig(min_team_conf=0.65))
        v8_df = shield.apply(legacy_df)

        f1250_after = v8_df[v8_df["frame_id"] == 1250]
        t9_after = f1250_after[f1250_after["track_id"] == 9].iloc[0]
        t20_after = f1250_after[f1250_after["track_id"] == 20].iloc[0]

        self.assertEqual(t9_after["role"], "referee")
        self.assertEqual(t9_after["team"], "none")
        self.assertEqual(t20_after["role"], "assistant_referee")
        self.assertEqual(t20_after["team"], "none")
        self.assertFalse(bool(t20_after["on_pitch"]))

        # Verify 100% track-level role stability across all tracks
        for _, grp in v8_df[v8_df["track_id"] >= 0].groupby("track_id"):
            self.assertEqual(grp["role"].nunique(), 1)

    def test_siglip_3class_clusterer_lab_backend(self) -> None:
        # Synthetic torso crops: 10 red (team_a), 10 blue (team_b), 3 neon-yellow (referee)
        rng = np.random.default_rng(7)
        crops: list[np.ndarray] = []
        for _ in range(10):
            crops.append(np.clip(np.full((32, 32, 3), [30, 30, 210]) + rng.integers(-8, 8, (32, 32, 3)), 0, 255).astype(np.uint8))
        for _ in range(10):
            crops.append(np.clip(np.full((32, 32, 3), [210, 40, 30]) + rng.integers(-8, 8, (32, 32, 3)), 0, 255).astype(np.uint8))
        for _ in range(3):
            crops.append(np.clip(np.full((32, 32, 3), [40, 240, 240]) + rng.integers(-8, 8, (32, 32, 3)), 0, 255).astype(np.uint8))

        clusterer = SigLIPThreeClassClusterer(backend="lab_hist")
        clusterer.fit(crops)
        preds = clusterer.predict(crops)
        ref_roles = [p[0] for p in preds[20:]]
        self.assertTrue(all(r == "referee" for r in ref_roles), f"Expected all refs, got {ref_roles}")

    def test_phase0_extractor_and_annotator_api_and_evaluator(self) -> None:
        matches = discover_scout5_matches()
        self.assertGreaterEqual(len(matches), 1)
        m2 = next(m for m in matches if m["match_id"] == "m2_ahly_enppi")

        # Ensure pinned frame 1250 is always included (stride-4 grid containing 1250)
        selected = select_representative_frame_ids(list(range(1002, 1500, 4)), 5, [1250])
        self.assertIn(1250, selected)
        self.assertEqual(len(selected), 5)

        with tempfile.TemporaryDirectory() as tmp:
            bench_dir = Path(tmp) / "egypt_benchmark"
            ann_path = extract_match_benchmark_frames(
                match_id="m2_ahly_enppi",
                video_path=m2["video_path"],
                telemetry_path=m2["telemetry_path"],
                output_benchmark_dir=bench_dir,
                frames_count=3,
            )
            self.assertTrue(ann_path.is_file())

            # Test FastAPI Annotator Server endpoints
            from fastapi.testclient import TestClient

            app = create_app(bench_dir)
            client = TestClient(app)
            self.assertEqual(client.get("/").status_code, 200)
            res = client.get("/api/matches")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["matches"][0]["match_id"], "m2_ahly_enppi")

            # Correct track 9 -> referee, track 20 -> assistant_referee via propagate_track API
            p1 = client.post(
                "/api/matches/m2_ahly_enppi/propagate_track",
                json={"track_id": 9, "role": "referee", "team": "none"},
            )
            self.assertEqual(p1.status_code, 200)
            p2 = client.post(
                "/api/matches/m2_ahly_enppi/propagate_track",
                json={"track_id": 20, "role": "assistant_referee", "team": "none"},
            )
            self.assertEqual(p2.status_code, 200)

            # Frame image endpoint works
            img_res = client.get("/api/matches/m2_ahly_enppi/frame/1250/image")
            self.assertEqual(img_res.status_code, 200)
            self.assertEqual(img_res.headers["content-type"], "image/jpeg")

            # Run Benchmark Evaluator: Before (legacy) vs After (V8 Shield)
            gt = MatchAnnotationFile.load(ann_path)
            before_df = load_legacy_scout5_telemetry(m2["telemetry_path"], match_id="m2_ahly_enppi")
            after_df = ZeroRefereeLeakShield().apply(before_df)

            before_m = evaluate_predictions(gt, before_df, label="before", only_verified=True)
            after_m = evaluate_predictions(gt, after_df, label="after", only_verified=True)

            self.assertEqual(before_m.referee_recall, 0.0)
            self.assertEqual(before_m.referee_leakage_rate, 1.0)
            self.assertEqual(after_m.referee_recall, 1.0)
            self.assertEqual(after_m.referee_leakage_rate, 0.0)
            self.assertEqual(after_m.track_role_stability, 1.0)

            md = format_comparison_markdown(before_m, after_m, "m2_ahly_enppi")
            self.assertIn("Critical Case Spotlight", md)
            self.assertIn("1250", md)

    def test_notebook_valid_json_and_python_syntax(self) -> None:
        nb_path = (
            get_repo_root()
            / "notebooks"
            / "kaggle_zero_budget"
            / "egy_scout_v8_sprint01_referee_shield.ipynb"
        )
        self.assertTrue(nb_path.is_file())
        nb = json.loads(nb_path.read_text(encoding="utf-8"))
        self.assertEqual(nb["nbformat"], 4)
        self.assertGreaterEqual(len(nb["cells"]), 6)

        for idx, cell in enumerate(nb["cells"]):
            if cell["cell_type"] == "code":
                src = "".join(cell["source"])
                # Ignore commented pip lines; parse valid Python
                ast.parse(src, filename=f"notebook_cell_{idx}")


if __name__ == "__main__":
    unittest.main()
