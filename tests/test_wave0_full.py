"""Strict Anti-Hallucination & Full Wave 0 Verification Suite for EGY-SCOUT V8."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from packages.scouting_core.fair_engine import (
    MAX_PHYSICAL_SPEED_KMH,
    build_profiles_from_match_parquet,
    import_external_scouting_csv,
)
from packages.scouting_core.input_gate import assess_video_input_mode
from packages.shared_contracts.config import get_repo_root
from packages.shared_contracts.match_setup import (
    BenchSubstitutionManager,
    MatchSetupConfig,
    compute_four_point_homography,
    project_pixels_with_homography,
)
from packages.shared_contracts.schemas import load_legacy_scout5_telemetry
from packages.tactics_engine.counterfactual import (
    compute_dynamic_pitch_control,
    simulate_ghost_move,
)
from packages.tactics_engine.matchup_optimizer import recommend_matchup_plan
from packages.tactics_engine.playbook import diagnose_frame_tactics
from services.cv_worker.stages.referee_shield import ZeroRefereeLeakShield


class TestWave0Full(unittest.TestCase):
    def test_goalkeeper_spatial_box_separation(self) -> None:
        rows = []
        for fid in range(100, 110):
            rows.append({"match_id": "gk_test", "frame_id": fid, "time_s": fid / 25.0, "track_id": 100, "role": "player", "team": "team_a", "role_conf": 0.9, "team_conf": 0.25, "x_m": 6.0, "y_m": 34.0, "on_pitch": True})
            rows.append({"match_id": "gk_test", "frame_id": fid, "time_s": fid / 25.0, "track_id": 101, "role": "player", "team": "team_a", "role_conf": 0.9, "team_conf": 0.92, "x_m": 25.0, "y_m": 30.0, "on_pitch": True})
            rows.append({"match_id": "gk_test", "frame_id": fid, "time_s": fid / 25.0, "track_id": 102, "role": "player", "team": "team_b", "role_conf": 0.9, "team_conf": 0.92, "x_m": 78.0, "y_m": 35.0, "on_pitch": True})
            rows.append({"match_id": "gk_test", "frame_id": fid, "time_s": fid / 25.0, "track_id": 103, "role": "player", "team": "team_b", "role_conf": 0.9, "team_conf": 0.20, "x_m": 52.0, "y_m": 34.0, "on_pitch": True})
        res = ZeroRefereeLeakShield().apply(pd.DataFrame(rows))
        self.assertEqual(res[res["track_id"] == 100].iloc[0]["role"], "goalkeeper")
        self.assertEqual(res[res["track_id"] == 100].iloc[0]["team"], "team_a")
        self.assertEqual(res[res["track_id"] == 103].iloc[0]["role"], "referee")
        self.assertEqual(res[res["track_id"] == 103].iloc[0]["team"], "none")

    def test_match_setup_6v6_rolling_subs_and_4point_homography(self) -> None:
        cfg = MatchSetupConfig.from_format("6v6", "u12", match_id="acad_u12")
        self.assertFalse(cfg.offside_enabled)
        self.assertTrue(cfg.rolling_subs)
        self.assertTrue(cfg.auto_face_blur)
        self.assertEqual(cfg.speed_thresholds()["sprint_kmh"], 18.0)

        mgr = BenchSubstitutionManager(cfg)
        mgr.set_starting_lineup("team_a", ["p1", "p2", "p3", "p4", "p5", "p6"], ["p7"])
        self.assertTrue(mgr.substitute("team_a", "p6", "p7", minute=15.0))
        self.assertIn("p6", mgr.bench["team_a"])
        self.assertEqual(mgr.record_red_card("team_a", "p5", minute=20.0), 5)

        H = compute_four_point_homography([[0, 0], [440, 0], [440, 280], [0, 280]], 44.0, 28.0)
        pt = project_pixels_with_homography(H, [[220, 140]])[0]
        self.assertAlmostEqual(float(pt[0]), 22.0, places=1)
        self.assertAlmostEqual(float(pt[1]), 14.0, places=1)

    def test_anti_hallucination_physics_referee_cap_and_no_short_clip_ratings(self) -> None:
        legacy_p = get_repo_root() / "scout5" / "data" / "matches" / "m2_ahly_enppi" / "telemetry.parquet"
        v8_df = ZeroRefereeLeakShield().apply(load_legacy_scout5_telemetry(legacy_p, "m2_ahly_enppi"))

        # (1) Realistic referee cardinality cap: <= 4 unique official tracks in the match
        official_tracks = v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()
        self.assertLessEqual(official_tracks, 4, f"Too many referees: {official_tracks}")
        self.assertGreaterEqual(official_tracks, 2)

        # Verify T9 & T20 on Frame 1250 remain accurately isolated
        f1250 = v8_df[v8_df["frame_id"] == 1250]
        self.assertEqual(f1250[f1250["track_id"] == 9].iloc[0]["role"], "referee")
        self.assertEqual(f1250[f1250["track_id"] == 20].iloc[0]["role"], "assistant_referee")

        # (2) Physical speed <= 36.0 km/h & (3) ZERO /10 ratings for short (< 15 min) video tracks
        profiles = build_profiles_from_match_parquet(v8_df, "m2_ahly_enppi")
        self.assertGreater(len(profiles), 5)
        for p in profiles:
            self.assertLessEqual(p.max_speed_kmh, MAX_PHYSICAL_SPEED_KMH)
            self.assertIsNone(p.rating_10, f"Short clip track {p.player_id} must NOT have rating_10")
            self.assertIn("عينة غير كافية للتقييم", p.rating_status_ar)

        # StatsBomb Open Data CSV benchmark (>= 500 min) DOES receive valid ratings
        sb_csv = get_repo_root() / "datasets" / "open_samples" / "statsbomb_open_wc2022_sample.csv"
        sb_players = import_external_scouting_csv(sb_csv)
        self.assertGreaterEqual(len(sb_players), 5)
        for sp in sb_players:
            self.assertIsNotNone(sp.rating_10)
            self.assertLessEqual(sp.max_speed_kmh, MAX_PHYSICAL_SPEED_KMH)

    def test_tactics_playbook_zero_fabrication_and_counterfactual(self) -> None:
        players = [
            {"track_id": 1, "role": "player", "team": "team_a", "x_m": 84.0, "y_m": 34.0},
            {"track_id": 2, "role": "player", "team": "team_a", "x_m": 79.0, "y_m": 26.0},
            {"track_id": 10, "role": "player", "team": "team_b", "x_m": 92.0, "y_m": 40.0},
            {"track_id": 11, "role": "player", "team": "team_b", "x_m": 88.0, "y_m": 22.0},
            {"track_id": 12, "role": "player", "team": "team_b", "x_m": 87.0, "y_m": 48.0},
        ]
        diags = diagnose_frame_tactics(pd.DataFrame(players), defending_team="team_b", frame_id=1250)
        self.assertGreaterEqual(len(diags), 1)

        pc = compute_dynamic_pitch_control(players, ball_xy=(84.0, 34.0), attacking_team="team_a")
        self.assertIn("box_control_pct", pc)
        sim = simulate_ghost_move(players, (84.0, 34.0), target_track_id=10, dx_m=-4.0, dy_m=-5.0)
        self.assertLessEqual(sim["after_xg"], sim["before_xg"])

        plan = recommend_matchup_plan(
            [{"player_id": f"p{i}", "display_name": f"P{i}", "position": "CM", "rating_10": 7.0 + i * 0.1, "xt_per90": 0.2, "max_speed_kmh": 30.0, "archetype_ar": "وسط"} for i in range(13)],
            ["zone_14_exposure"],
        )
        self.assertEqual(len(plan["recommended_formations"]), 2)
        self.assertNotEqual(
            plan["recommended_formations"][0]["fit_score"],
            plan["recommended_formations"][1]["fit_score"],
        )

    def test_fastapi_board_readonly_crops_206_and_realistic_economics(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)

        # (6) Board role MUST get 200 OK on ALL GET endpoints (Read-Only mode)
        board_headers = {"X-User-Role": "board", "X-Tenant-Id": "club_demo_egypt"}
        board_get_paths = [
            "/api/health",
            "/api/matches",
            "/api/matches/m2_ahly_enppi/before-after?frame_id=1250",
            "/api/matches/m2_ahly_enppi/timeline",
            "/api/matches/m2_ahly_enppi/qa-sheet",
            "/api/matches/m2_ahly_enppi/positioning-analysis?frame_id=1250",
            "/api/scouting/players?match_id=m2_ahly_enppi",
            "/api/tactics/matchup?match_id=m2_ahly_enppi",
            "/api/match-setup/m2_ahly_enppi",
        ]
        for path in board_get_paths:
            r = client.get(path, headers=board_headers)
            self.assertEqual(r.status_code, 200, f"Board GET failed on {path}: {r.text}")

        # Board MUST get 403 on mutating POST endpoints
        self.assertEqual(
            client.post("/api/matches/m2_ahly_enppi/lineup", headers=board_headers, json={}).status_code,
            403,
        )
        self.assertEqual(client.post("/api/live-proof", headers=board_headers).status_code, 403)

        # (5) Real player crop image endpoint returns 200 OK JPEG
        crop_r = client.get("/api/matches/m2_ahly_enppi/track/9/crop")
        self.assertEqual(crop_r.status_code, 200)
        self.assertTrue(crop_r.headers["content-type"].startswith("image/jpeg"))
        self.assertGreater(len(crop_r.content), 1000)

        # Honest positioning analysis title (no fake goal claim)
        pos = client.get("/api/matches/m2_ahly_enppi/positioning-analysis?frame_id=1250").json()
        self.assertFalse(pos["has_verified_goal"])
        self.assertIn("بدون هدف مسجل", pos["analysis_title_ar"])

        # HTTP 206 Partial Content video streaming
        vr = client.get("/api/matches/m2_ahly_enppi/video", headers={"Range": "bytes=0-65535"})
        self.assertEqual(vr.status_code, 206)
        self.assertEqual(vr.headers.get("accept-ranges"), "bytes")
        self.assertEqual(len(vr.content), 65536)

        # Dynamic kit_colors + highlight_track frame image + live-proof Parquet download
        ba = client.get("/api/matches/m2_ahly_enppi/before-after?frame_id=1250").json()
        self.assertIn("kit_colors", ba)
        self.assertTrue(str(ba["kit_colors"].get("team_a_hex", "")).startswith("#"))
        self.assertTrue(str(ba["kit_colors"].get("team_b_hex", "")).startswith("#"))
        self.assertEqual(ba["after"]["referees_in_frame"], 2)
        self.assertLessEqual(ba["after"]["unique_official_tracks"], 4)
        det_by_id = {d["track_id"]: d for d in ba["after"]["detections"]}
        self.assertEqual(det_by_id[9]["role"], "referee")
        self.assertEqual(det_by_id[20]["role"], "assistant_referee")

        tl = client.get("/api/matches/m2_ahly_enppi/timeline").json()
        self.assertIn("kit_colors", tl)

        hl_img = client.get("/api/matches/m2_ahly_enppi/frame/1250/image?highlight_track=9")
        self.assertEqual(hl_img.status_code, 200)
        self.assertTrue(hl_img.headers["content-type"].startswith("image/jpeg"))
        self.assertGreater(len(hl_img.content), 5000)

        analyst_headers = {"X-User-Role": "analyst", "X-Tenant-Id": "club_demo_egypt"}
        lp_r = client.post("/api/live-proof", headers=analyst_headers)
        self.assertEqual(lp_r.status_code, 200, f"live-proof failed: {lp_r.text}")
        lp = lp_r.json()
        dl_url = lp.get("parquet_download_url", "")
        self.assertTrue(dl_url.startswith("/api/live-proof/"))
        pq_r = client.get(dl_url)
        self.assertEqual(pq_r.status_code, 200)
        self.assertTrue(pq_r.content.startswith(b"PAR1"))

    def test_pro_wiring_ball_kalman_moments_crm_bench_and_clip_export(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_suite_tenant"}

        # 1. Enriched timeline: Kalman ball, momentum, velocity/speed
        tl = client.get("/api/matches/m2_ahly_enppi/timeline", headers=h).json()
        f0 = tl["frames"][0]
        self.assertIsNotNone(f0.get("ball"))
        self.assertIn("z_m", f0["ball"])
        self.assertIn("momentum", f0)
        self.assertIn("speed_kmh", f0["players"][0])

        # 2. Moments & Grounded Brief (zero fabricated goals)
        mb_r = client.get("/api/matches/m2_ahly_enppi/moments-and-brief", headers=h)
        self.assertEqual(mb_r.status_code, 200)
        mb = mb_r.json()
        self.assertEqual(mb["verified_goals"], [])
        self.assertGreaterEqual(len(mb["events"]), 1)
        self.assertGreaterEqual(len(mb["coach_brief"]), 2)
        self.assertGreaterEqual(len(mb["pose_assessments"]), 1)

        # 3. Scouting CRM shortlist roundtrip + D2->PL translation
        sc = client.get("/api/scouting/players?match_id=m2_ahly_enppi", headers=h).json()
        self.assertIn("league_translation_pct", sc["benchmark_players"][0])
        client.post(
            "/api/scouting/shortlist",
            headers=h,
            json={"player_id": "sb_test_1", "display_name": "Test Player", "position": "CM", "status": "priority"},
        )
        sl_list = client.get("/api/scouting/shortlist", headers=h).json()["items"]
        self.assertTrue(any(it["player_id"] == "sb_test_1" for it in sl_list))
        client.delete("/api/scouting/shortlist/sb_test_1", headers=h)

        # 4. Bench/Sub/Red-Card state + apply-scoresheet + clip & white-label report export
        client.post("/api/matches/m2_ahly_enppi/bench-state", headers=h, json={"action": "reset", "team": "team_a"})
        bs0 = client.get("/api/matches/m2_ahly_enppi/bench-state", headers=h).json()
        self.assertEqual(bs0["active_cap_team_a"], 11)
        bs_sub = client.post(
            "/api/matches/m2_ahly_enppi/bench-state", headers=h, json={"action": "substitute", "team": "team_a", "minute": 60}
        ).json()
        self.assertEqual(len(bs_sub["events"]), 1)
        bs_red = client.post(
            "/api/matches/m2_ahly_enppi/bench-state", headers=h, json={"action": "red_card", "team": "team_a", "minute": 70}
        ).json()
        self.assertEqual(bs_red["active_cap_team_a"], 10)
        client.post("/api/matches/m2_ahly_enppi/bench-state", headers=h, json={"action": "reset", "team": "team_a"})

        ap = client.post(
            "/api/matches/m2_ahly_enppi/apply-scoresheet",
            headers=h,
            json={"raw_text": "1 - الشناوي (GK)\n10 - إمام عاشور"},
        ).json()
        self.assertEqual(ap["count"], 2)

        clip_r = client.post(
            "/api/matches/m2_ahly_enppi/export-clip",
            headers=h,
            json={"start_s": 50.0, "end_s": 52.5, "auto_face_blur": True},
        )
        self.assertEqual(clip_r.status_code, 200)
        self.assertGreater(len(clip_r.content), 5000)

        rep_r = client.get("/api/matches/m2_ahly_enppi/export-report", headers=h)
        self.assertEqual(rep_r.status_code, 200)
        self.assertIn("Grounded Coach Brief", rep_r.text)

    def test_ui_has_zero_debug_or_investor_text(self) -> None:
        web_src = get_repo_root() / "apps" / "web" / "src"
        forbidden_tokens = [
            "layer4_temporal_vote",
            "Provider: local",
            "Status: ok",
            "Roles: {'",
            "fundraising_allocation_pct",
            "InvestorHubScreen",
        ]
        for tsx in web_src.rglob("*.tsx"):
            txt = tsx.read_text(encoding="utf-8")
            for tok in forbidden_tokens:
                self.assertNotIn(tok, txt, f"Found forbidden token {tok!r} in {tsx}")

    def test_direction_inference_clean_ball_benchmark_and_ingest(self) -> None:
        import shutil
        import tempfile
        import cv2
        from fastapi.testclient import TestClient
        from apps.api.main import app, service
        from packages.shared_contracts.config import open_video_unicode

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_dir_ball_tenant"}

        # 1. Dynamic GK-verified attacking direction on m2 (team_b GK at x~5.7m -> team_a attacks LEFT 0.0m)
        tl_m2 = client.get("/api/matches/m2_ahly_enppi/timeline", headers=h).json()
        self.assertFalse(tl_m2["team_a_attacks_right"])
        self.assertEqual(tl_m2["team_a_goal_x"], 0.0)
        self.assertEqual(tl_m2["direction_source"], "goalkeeper_position")

        pos_m2 = client.get("/api/matches/m2_ahly_enppi/positioning-analysis?frame_id=1250", headers=h).json()
        self.assertEqual(pos_m2["attack_goal_x"], 0.0)

        # Ensure m3_enppi_mokawloon flips automatically to team_a attacking RIGHT (105.0m)
        tl_m3 = client.get("/api/matches/m3_enppi_mokawloon/timeline", headers=h).json()
        self.assertTrue(tl_m3["team_a_attacks_right"])
        self.assertEqual(tl_m3["team_a_goal_x"], 105.0)

        # 2. Ball Kalman velocity cap, camera-compensated left motion on f=1382, & zero cut sliding (1286..1325)
        f1382 = next((fr for fr in tl_m2["frames"] if fr["frame_id"] == 1382), None)
        self.assertIsNotNone(f1382)
        self.assertIsNotNone(f1382.get("ball"))
        self.assertLess(float(f1382["ball"]["vx_px"]), -50.0)
        for fr in tl_m2["frames"]:
            b = fr.get("ball")
            if b is not None:
                self.assertLessEqual(float(np.hypot(b["vx_ms"], b["vy_ms"])), 36.0)
            if 1286 <= fr["frame_id"] <= 1325 and b is not None:
                self.assertIsNone(b["u"])

        # 3. Benchmark scorecard endpoint
        bm_r = client.get("/api/matches/m2_ahly_enppi/benchmark", headers=h)
        self.assertEqual(bm_r.status_code, 200)
        bm = bm_r.json()
        self.assertTrue(bm["speed_cap_compliant"])
        self.assertGreater(bm["official_leakage_reduction_pct"], 50.0)

        # 4. Real custom clip ingestion -> selectable match -> timeline & cleanup
        src_video = service.get_video_path("m2_ahly_enppi")
        cap, proxy = open_video_unicode(src_video)
        tmp_mp4 = Path(tempfile.gettempdir()) / "egy_scout_test_ingest.mp4"
        created_mid = None
        try:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 1250)
            ok, first = cap.read()
            self.assertTrue(ok and first is not None)
            hh, ww = first.shape[:2]
            writer = cv2.VideoWriter(str(tmp_mp4), cv2.VideoWriter_fourcc(*"mp4v"), 25.0, (ww, hh))
            writer.write(first)
            for _ in range(14):
                ok_n, frm = cap.read()
                if not ok_n or frm is None:
                    break
                writer.write(frm)
            writer.release()

            with tmp_mp4.open("rb") as fh:
                ing = client.post(
                    "/api/matches/ingest",
                    headers=h,
                    data={"team_a_name": "Custom Red", "team_b_name": "Custom Blue", "match_format": "11v11"},
                    files={"file": ("test_clip.mp4", fh, "video/mp4")},
                )
            self.assertEqual(ing.status_code, 200, ing.text)
            ing_j = ing.json()
            created_mid = ing_j["match_id"]
            self.assertGreater(ing_j["players_tracked"], 0)
            matches_after = client.get("/api/matches", headers=h).json()["matches"]
            self.assertTrue(any(m["match_id"] == created_mid for m in matches_after))
            tl_custom = client.get(f"/api/matches/{created_mid}/timeline", headers=h)
            self.assertEqual(tl_custom.status_code, 200)
            self.assertGreater(len(tl_custom.json()["frames"]), 0)
        finally:
            cap.release()
            if proxy is not None and proxy.exists():
                proxy.unlink(missing_ok=True)
            tmp_mp4.unlink(missing_ok=True)
            if created_mid:
                cdir = service.data_paths.outputs / "custom_matches" / created_mid
                shutil.rmtree(cdir, ignore_errors=True)
                service._meta_cache.pop(created_mid, None)
                service._legacy_cache.pop(created_mid, None)
                service._v8_cache.pop(created_mid, None)


if __name__ == "__main__":
    unittest.main()
