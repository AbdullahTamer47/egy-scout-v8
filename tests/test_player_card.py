"""TDD unit tests for EGY-SCOUT Pro Studio 10 player cards, honesty guards, and URL security."""
from __future__ import annotations

import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import pandas as pd


class TestPlayerCardEngine(unittest.TestCase):
    def _make_track_df(
        self,
        speed_ms: float = 5.0,
        duration_s: float = 10.0,
        fps: float = 25.0,
        start_x: float = 20.0,
        y_m: float = 34.0,
        track_id: int = 7,
        role: str = "player",
    ) -> pd.DataFrame:
        n = int(round(duration_s * fps))
        fids = np.arange(n, dtype=np.int32)
        times = fids / fps
        xs = start_x + speed_ms * times
        ys = np.full(n, y_m, dtype=np.float32)
        return pd.DataFrame(
            {
                "frame_id": fids,
                "time_s": times,
                "track_id": np.full(n, track_id, dtype=np.int32),
                "role": [role] * n,
                "team": ["team_a"] * n,
                "x_m": xs.astype(np.float32),
                "y_m": ys,
            }
        )

    def test_constant_speed_track_metrics_and_no_ovr(self) -> None:
        from packages.scouting_core.player_card import build_player_card_stats

        df = self._make_track_df(speed_ms=5.0, duration_s=10.0, fps=25.0)
        stats = build_player_card_stats(df, fps=25.0, attack_right=True)
        self.assertNotIn("rating", stats)
        self.assertNotIn("ovr", stats)
        self.assertEqual(stats["kind"], "measured")
        self.assertAlmostEqual(stats["distance_m"], 50.0, delta=2.0)
        self.assertAlmostEqual(stats["top_speed_kmh"], 18.0, delta=1.5)
        self.assertAlmostEqual(stats["avg_speed_kmh"], 18.0, delta=1.5)
        self.assertEqual(stats["sprints"], 0)
        self.assertEqual(stats["tier"], "bronze")
        self.assertTrue(stats["quality"]["low_sample"])

    def test_teleport_jump_excluded_and_sprint_detected(self) -> None:
        from packages.scouting_core.player_card import build_player_card_stats

        # 8 m/s = 28.8 km/h (>= 25 km/h sprint) for 3.0 s -> 24 m, 1 sprint
        df = self._make_track_df(speed_ms=8.0, duration_s=3.0, fps=25.0, start_x=10.0)
        # Inject a 30 m single-frame teleport jump at frame 30 (impossible > 36 km/h)
        df.loc[df["frame_id"] >= 30, "x_m"] = df.loc[df["frame_id"] >= 30, "x_m"] + 30.0
        stats = build_player_card_stats(df, fps=25.0, attack_right=True)
        self.assertLess(stats["distance_m"], 30.0)
        self.assertGreaterEqual(stats["sprints"], 1)
        self.assertLessEqual(stats["top_speed_kmh"], 36.0)

    def test_uncalibrated_all_nan_returns_none_stats(self) -> None:
        from packages.scouting_core.player_card import build_player_card_stats

        df = self._make_track_df(duration_s=5.0, fps=25.0)
        df["x_m"] = np.nan
        df["y_m"] = np.nan
        stats = build_player_card_stats(df, fps=25.0, attack_right=True)
        self.assertIsNone(stats["distance_m"])
        self.assertIsNone(stats["top_speed_kmh"])
        self.assertIsNone(stats["avg_speed_kmh"])
        self.assertEqual(stats["reason"], "uncalibrated")

    def test_heatmap_sums_to_one_and_flips_attack_direction(self) -> None:
        from packages.scouting_core.player_card import build_player_card_stats

        df = self._make_track_df(speed_ms=2.0, duration_s=4.0, fps=25.0, start_x=10.0, y_m=15.0)
        s_right = build_player_card_stats(df, fps=25.0, attack_right=True)
        s_left = build_player_card_stats(df, fps=25.0, attack_right=False)
        hm_r = np.array(s_right["heatmap"], dtype=float)
        hm_l = np.array(s_left["heatmap"], dtype=float)
        self.assertAlmostEqual(float(hm_r.sum()), 1.0, places=3)
        self.assertAlmostEqual(float(hm_l.sum()), 1.0, places=3)
        # When attack_right=True, x~14m is in left columns (<6); when flipped, it's in right columns (>=6)
        self.assertGreater(float(hm_r[:, :4].sum()), 0.8)
        self.assertGreater(float(hm_l[:, 8:].sum()), 0.8)

    def test_percentiles_and_tier_thresholds(self) -> None:
        from packages.scouting_core.player_card import compute_card_tier, compute_match_percentiles

        self.assertEqual(compute_card_tier(0.85, 65.0), "gold")
        self.assertEqual(compute_card_tier(0.60, 25.0), "silver")
        self.assertEqual(compute_card_tier(0.95, 10.0), "bronze")

        pool = [
            {"track_id": 1, "is_gk": False, "top_speed_kmh": 31.0, "distance_m": 600.0, "work_rate_m_per_min": 120.0, "sprints": 4, "avg_speed_kmh": 14.0, "observed_s": 90.0},
            {"track_id": 2, "is_gk": False, "top_speed_kmh": 24.0, "distance_m": 400.0, "work_rate_m_per_min": 95.0, "sprints": 1, "avg_speed_kmh": 10.0, "observed_s": 60.0},
            {"track_id": 3, "is_gk": False, "top_speed_kmh": 19.0, "distance_m": 250.0, "work_rate_m_per_min": 70.0, "sprints": 0, "avg_speed_kmh": 7.0, "observed_s": 40.0},
            {"track_id": 4, "is_gk": False, "top_speed_kmh": None, "distance_m": 300.0, "work_rate_m_per_min": 80.0, "sprints": 0, "avg_speed_kmh": 8.0, "observed_s": 50.0},
        ]
        pcts = compute_match_percentiles(pool)
        self.assertGreaterEqual(pcts[1]["spd"], 90)
        self.assertIsNone(pcts[4]["spd"])
        for tid, pmap in pcts.items():
            for val in pmap.values():
                if val is not None:
                    self.assertIsInstance(val, int)
                    self.assertGreaterEqual(val, 0)
                    self.assertLessEqual(val, 99)

    def test_url_validation_blocks_ssrf_and_local_addresses(self) -> None:
        from apps.api.service import _validate_remote_url

        for bad in (
            "file:///c:/windows/win.ini",
            "http://127.0.0.1:8080/secret",
            "http://localhost/test.m3u8",
            "http://192.168.1.5/stream.m3u8",
            "ftp://example.com/a.mp4",
            "",
        ):
            with self.assertRaises(ValueError, msg=f"Expected rejection for {bad}"):
                _validate_remote_url(bad)

        public_addr = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        with patch("socket.getaddrinfo", return_value=public_addr):
            clean = _validate_remote_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
            self.assertTrue(clean.startswith("https://"))

    def test_photo_upload_validation_and_fallback_identity_none(self) -> None:
        from dataclasses import replace
        from apps.api.service import ScoutV8Service, _fallback_identity

        fb = _fallback_identity("team_a", "الأهلي", 42)
        self.assertIsNone(fb["jersey_number"])
        self.assertIsNone(fb["verified_name"])
        self.assertFalse(fb["verified"])
        self.assertIn("T42", fb["display_label"])

        svc = ScoutV8Service()
        with tempfile.TemporaryDirectory() as tmpdir:
            svc.data_paths = replace(svc.data_paths, outputs=Path(tmpdir))
            with self.assertRaises(ValueError):
                svc.save_player_photo("test_tenant", "m2_ahly_enppi", 1, b"not an image at all")
            with self.assertRaises(ValueError):
                svc.save_player_photo("test_tenant", "m2_ahly_enppi", 1, b"\x00" * (5 * 1024 * 1024 + 10))

            img = np.zeros((480, 640, 3), dtype=np.uint8)
            img[:, :, 1] = 180
            ok, buf = cv2.imencode(".png", img)
            self.assertTrue(ok)
            saved_path = svc.save_player_photo("test_tenant", "m2_ahly_enppi", 1, buf.tobytes())
            self.assertTrue(saved_path.is_file())
            loaded = cv2.imread(str(saved_path))
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded.shape[0], 720)

    def test_player_routes_rbac_photo_upload_models_and_ssrf(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        h_analyst = {"X-User-Role": "analyst", "X-Tenant-Id": "test_card_tenant"}
        h_board = {"X-User-Role": "board", "X-Tenant-Id": "test_card_tenant"}

        r_list = client.get("/api/matches/m2_ahly_enppi/players", headers=h_analyst)
        self.assertEqual(r_list.status_code, 200, r_list.text)
        body = r_list.json()
        self.assertGreater(len(body["players"]), 0)
        first_p = body["players"][0]
        self.assertNotIn("rating", first_p)
        self.assertNotIn("ovr", first_p)
        self.assertIn(first_p["tier"], ("gold", "silver", "bronze"))
        self.assertIn("percentiles", first_p)
        tid = int(first_p["track_id"])

        r_card = client.get(f"/api/matches/m2_ahly_enppi/players/{tid}/card", headers=h_analyst)
        self.assertEqual(r_card.status_code, 200)
        self.assertIn("heatmap", r_card.json())

        r_photo = client.get(f"/api/matches/m2_ahly_enppi/players/{tid}/photo", headers=h_analyst)
        self.assertEqual(r_photo.status_code, 200)
        self.assertEqual(r_photo.headers.get("content-type"), "image/jpeg")
        self.assertGreater(len(r_photo.content), 2000)

        img = np.zeros((300, 300, 3), dtype=np.uint8)
        img[:, :, 2] = 200
        ok, buf = cv2.imencode(".png", img)
        self.assertTrue(ok)

        r_board = client.post(
            f"/api/matches/m2_ahly_enppi/players/{tid}/photo",
            headers=h_board,
            files={"file": ("p.png", buf.tobytes(), "image/png")},
        )
        self.assertEqual(r_board.status_code, 403)

        r_bad = client.post(
            f"/api/matches/m2_ahly_enppi/players/{tid}/photo",
            headers=h_analyst,
            files={"file": ("bad.txt", b"hello world", "text/plain")},
        )
        self.assertEqual(r_bad.status_code, 400)

        r_up = client.post(
            f"/api/matches/m2_ahly_enppi/players/{tid}/photo",
            headers=h_analyst,
            files={"file": ("p.png", buf.tobytes(), "image/png")},
        )
        self.assertEqual(r_up.status_code, 200, r_up.text)

        r_del = client.delete(f"/api/matches/m2_ahly_enppi/players/{tid}/photo", headers=h_analyst)
        self.assertEqual(r_del.status_code, 200)

        r_models = client.get("/api/chat/models", headers=h_analyst)
        self.assertEqual(r_models.status_code, 200)
        self.assertGreater(len(r_models.json()["models"]), 0)

        r_ssrf = client.post(
            "/api/matches/ingest-url",
            headers=h_analyst,
            json={"url": "http://127.0.0.1/x.m3u8"},
        )
        self.assertEqual(r_ssrf.status_code, 400)

    def test_no_world_cup_players_in_scouting_players(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_epl_only"}
        resp = client.get("/api/scouting/players?match_id=m2_ahly_enppi", headers=h)
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        bench = data.get("benchmark_players", [])
        self.assertGreater(len(bench), 0)
        self.assertIn("league_translation_pct", bench[0])

        forbidden = {
            "Sofyan Amrabat",
            "Achraf Hakimi",
            "Azzedine Ounahi",
            "Alexis Mac Allister",
            "Enzo Fernández",
            "Joško Gvardiol",
        }
        names = {str(p.get("display_name", "")) for p in bench}
        self.assertTrue(names.isdisjoint(forbidden), f"Foreign WC2022 players leaked: {names & forbidden}")

        first_pid = bench[0]["player_id"]
        dos = client.get(f"/api/scouting/players/{first_pid}/dossier?match_id=m2_ahly_enppi", headers=h)
        self.assertEqual(dos.status_code, 200)
        self.assertGreater(len(dos.json().get("rating_breakdown", [])), 0)

    def test_verified_rosters_json_and_consolidated_22_match_cards(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_rosters_tenant"}
        r_ros = client.get("/api/rosters", headers=h)
        self.assertEqual(r_ros.status_code, 200, r_ros.text)
        clubs = r_ros.json().get("clubs", {})
        self.assertIn("al_ahly", clubs)
        self.assertIn("enppi", clubs)
        self.assertIn("bayer_leverkusen_alonso", clubs)
        for cid in ("al_ahly", "enppi"):
            self.assertTrue(clubs[cid].get("season"))
            self.assertTrue(clubs[cid].get("source"))
            self.assertTrue(clubs[cid].get("verified_at"))

        r_pl = client.get("/api/matches/m2_ahly_enppi/players", headers=h)
        self.assertEqual(r_pl.status_code, 200, r_pl.text)
        players = r_pl.json()["players"]
        self.assertGreater(len(players), 0)
        self.assertLessEqual(len(players), 22)
        p0 = players[0]
        self.assertIn(p0.get("identity_source"), ("qa_verified", "ocr_verified", "gk_role_match", "unverified"))
        self.assertIn("display_label_en", p0)
        self.assertIn("crop_is_low_res", p0)
        self.assertIsInstance(p0["crop_is_low_res"], bool)
        # Unverified outfield track without OCR must NEVER invent a star player's jersey number or name
        unver_out = [
            p for p in players
            if p.get("identity_source") == "unverified" and p.get("role") != "goalkeeper"
        ]
        self.assertGreater(len(unver_out), 0)
        for u in unver_out:
            self.assertIsNone(u["jersey_number"])
            self.assertIsNone(u["verified_name"])

    def test_pitch_calibrator_penalty_box_not_rejected_by_collinearity(self) -> None:
        from services.cv_worker.stages.pitch_calib import FIFA_KEYPOINTS, KeypointPitchCalibrator

        cal = KeypointPitchCalibrator(conf=0.30, imgsz=960, max_err_m=3.5)
        # Synthetic penalty-box homography: H_m2px maps FIFA meters (x=0..16.5m) -> 1280x720 pixels
        idx = [1, 2, 3, 4, 9, 12]
        dst = FIFA_KEYPOINTS[idx]
        H_m2px = np.array([[22.0, 2.0, 220.0], [0.5, 14.0, 40.0], [0.0001, 0.0002, 1.0]], dtype=np.float64)
        src = cv2.perspectiveTransform(dst.reshape(-1, 1, 2), H_m2px).reshape(-1, 2).astype(np.float32)
        H_est = cal.solve_homography_from_correspondences(src, dst, frame_shape=(720, 1280))
        self.assertIsNotNone(H_est)

    def test_club_kit_color_matching_never_swaps_ahly_red_or_masry_green(self) -> None:
        from services.cv_worker.local_pipeline import resolve_team_cluster_mapping

        # Cluster 0 is Blue (10, 70, 210 RGB), Cluster 1 is Red (210, 35, 35 RGB)
        c0_rgb = np.array([10.0, 70.0, 210.0], dtype=np.float32)
        c1_rgb = np.array([210.0, 35.0, 35.0], dtype=np.float32)
        mapping = resolve_team_cluster_mapping(c0_rgb, c1_rgb, "الأهلي (بناء هجومي)", "طلائع الجيش / المنافس")
        self.assertEqual(mapping[1], "team_a")  # Red MUST map to Al Ahly (team_a)
        self.assertEqual(mapping[0], "team_b")  # Blue MUST map to opponent (team_b)

        # Cluster 0 is Green (25, 195, 95 RGB), Cluster 1 is Sky/Navy (20, 120, 210 RGB)
        g_rgb = np.array([25.0, 195.0, 95.0], dtype=np.float32)
        b_rgb = np.array([20.0, 120.0, 210.0], dtype=np.float32)
        mapping2 = resolve_team_cluster_mapping(g_rgb, b_rgb, "بيراميدز", "المصري البورسعيدي")
        self.assertEqual(mapping2[1], "team_a")  # Sky/Navy -> Pyramids
        self.assertEqual(mapping2[0], "team_b")  # Green -> Al Masry

    def test_every_formation_and_plan_draws_lines_passes_and_xpass_probabilities(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_all_formations"}
        for f_code in ("4-2-3-1", "4-3-3", "3-4-2-1", "3-5-2", "4-4-2", "5-3-2", "4-1-4-1", "4-2-2-2", "3-2-4-1", "433", "4231"):
            r = client.get(f"/api/matches/m2_ahly_enppi/formation-blueprint?formation_code={f_code}", headers=h)
            self.assertEqual(r.status_code, 200, f"Failed for {f_code}: {r.text}")
            bp = r.json()
            self.assertEqual(len(bp.get("nodes", [])), 11, f"Nodes != 11 for {f_code}")
            self.assertGreaterEqual(len(bp.get("lines", [])), 3, f"Lines < 3 for {f_code}")
            arrows = bp.get("passing_arrows", [])
            self.assertGreaterEqual(len(arrows), 4, f"Passing arrows < 4 for {f_code}")
            for arr in arrows:
                self.assertIn("xpass_pct", arr, f"Missing xpass_pct for {f_code}")
                self.assertIn("obv_delta", arr, f"Missing obv_delta for {f_code}")
                self.assertGreaterEqual(int(arr["xpass_pct"]), 15)
                self.assertLessEqual(int(arr["xpass_pct"]), 98)

        for prompt in (
            "خطة 4-3-3 ضغط عالي عكسي كلوب بالخطوط والتمريرات",
            "خطة انزاجي 3-5-2 التحولات السريعة",
        ):
            r_ai = client.post("/api/matches/m2_ahly_enppi/ai-draw", headers=h, json={"prompt": prompt})
            self.assertEqual(r_ai.status_code, 200, r_ai.text)
            bp_ai = r_ai.json()
            self.assertGreaterEqual(len(bp_ai.get("lines", [])), 3)
            self.assertGreaterEqual(len(bp_ai.get("passing_arrows", [])), 4)
            self.assertIn("xpass_pct", bp_ai["passing_arrows"][0])

    def test_cloud_compute_status_and_contact_sheet(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app
        from services.cv_worker.cloud_cv_engine import build_jersey_contact_sheet

        c_a = np.full((60, 40, 3), 80, dtype=np.uint8)
        sheet, tids = build_jersey_contact_sheet({101: c_a, 202: c_a})
        self.assertIsNotNone(sheet)
        self.assertEqual(tids, [101, 202])

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_cloud_tenant"}
        r_st = client.get("/api/compute/status", headers=h)
        self.assertEqual(r_st.status_code, 200, r_st.text)
        st = r_st.json()
        self.assertIn("active_mode", st)
        self.assertIn("recommended_cloud_options", st)

        r_ssrf = client.post(
            "/api/compute/config",
            headers=h,
            json={"cloud_worker_url": "http://127.0.0.1:9000/analyze"},
        )
        self.assertEqual(r_ssrf.status_code, 400)

    def test_ai_draw_leverkusen_3421_returns_lines_passes_and_xpass_probabilities(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_alonso_tenant"}
        resp = client.post(
            "/api/matches/m2_ahly_enppi/ai-draw",
            headers=h,
            json={"prompt": "خطة باير ليفركوزن تشابي ألونسو 3-4-2-1 بالخطوط والباصات والاحتمالات"},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        bp = resp.json()
        self.assertEqual(bp.get("formation_code"), "3-4-2-1")
        self.assertEqual(len(bp.get("nodes", [])), 11)
        self.assertEqual(len(bp.get("opponent_nodes", [])), 11)
        self.assertGreaterEqual(len(bp.get("lines", [])), 3)
        arrows = bp.get("passing_arrows", [])
        self.assertGreaterEqual(len(arrows), 4)
        for arr in arrows:
            self.assertIn("xpass_pct", arr)
            self.assertIn("obv_delta", arr)
            self.assertGreaterEqual(int(arr["xpass_pct"]), 15)
            self.assertLessEqual(int(arr["xpass_pct"]), 98)

    def test_optimal_position_assignment_zero_striker_at_lb_or_dm_at_st(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_pos_assign"}

        # 1. Bayer Leverkusen 3-4-2-1: Xhaka/Palacios at LDM/RDM, Wirtz/Hofmann at LAM/RAM, Boniface at ST
        r_lev = client.post(
            "/api/matches/m2_ahly_enppi/ai-draw",
            headers=h,
            json={"prompt": "خطة باير ليفركوزن تشابي ألونسو 3-4-2-1 بالخطوط والباصات والاحتمالات"},
        )
        self.assertEqual(r_lev.status_code, 200, r_lev.text)
        bp_lev = r_lev.json()
        slot_to_label = {n["slot"]: n["player_label"] for n in bp_lev["nodes"]}
        self.assertIn("هراديكي", slot_to_label.get("GK", ""))
        self.assertIn("جريمالدو", slot_to_label.get("LWB", ""))
        self.assertIn("فريمبونج", slot_to_label.get("RWB", ""))
        self.assertIn("بونيفاس", slot_to_label.get("ST", ""))
        dm_names = slot_to_label.get("LDM", "") + " " + slot_to_label.get("RDM", "")
        am_names = slot_to_label.get("LAM", "") + " " + slot_to_label.get("RAM", "")
        self.assertIn("تشاكا", dm_names)
        self.assertIn("بالاسيوس", dm_names)
        self.assertIn("فيرتز", am_names)
        self.assertIn("هوفمان", am_names)

        # 2. All formations on m2_ahly_enppi & m1_ahly_sekka must never place ST at LB/RB/CB or DM at ST
        for mid in ("m2_ahly_enppi", "m1_ahly_sekka"):
            for f_a, f_b in (("4-2-3-1", "4-4-2"), ("3-4-2-1", "4-3-3"), ("3-5-2", "5-3-2")):
                r_bp = client.get(
                    f"/api/matches/{mid}/formation-blueprint?formation_code={f_a}&opponent_formation_code={f_b}",
                    headers=h,
                )
                self.assertEqual(r_bp.status_code, 200)
                bp = r_bp.json()
                for n in bp["nodes"] + bp["opponent_nodes"]:
                    sl = n["slot"].upper()
                    lbl = n["player_label"]
                    if sl in ("LB", "RB", "CB", "LCB", "RCB", "CCB"):
                        self.assertNotIn("شريف", lbl)
                        self.assertNotIn("النحاس", lbl)
                        self.assertNotIn("لبيب", lbl)
                    if sl in ("ST", "LST", "RST"):
                        self.assertNotIn("زياد كمال", lbl)
                        self.assertNotIn("مروان عطية", lbl)

    def test_realistic_kinematics_team_relative_positions_and_short_clip_honesty(self) -> None:
        import statistics
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        h = {"X-User-Role": "analyst", "X-Tenant-Id": "test_realism_guard"}
        for mid in ("m2_ahly_enppi", "m1_ahly_sekka"):
            r = client.get(f"/api/matches/{mid}/players", headers=h)
            self.assertEqual(r.status_code, 200, r.text)
            players = r.json()["players"]
            self.assertGreater(len(players), 0)

            for p in players:
                if float(p["observed_s"]) < 300.0:
                    self.assertIsNone(p["percentiles"]["spd"])
                    self.assertIsNone(p["work_rate_m_per_min"])

            spds = [p["top_speed_kmh"] for p in players if p["top_speed_kmh"] is not None]
            self.assertGreater(len(spds), 0)
            self.assertLess(statistics.median(spds), 29.0)

            for t_key in ("team_a", "team_b"):
                outfield = [p for p in players if p["team"] == t_key and p["position_label"]["code"] != "GK"]
                if len(outfield) >= 6:
                    st_cnt = sum(1 for p in outfield if p["position_label"]["code"] == "ST")
                    def_cnt = sum(1 for p in outfield if p["position_label"]["code"] in ("LB", "CB", "RB"))
                    self.assertLessEqual(st_cnt, 2, f"Too many STs in {mid} {t_key}")
                    self.assertGreaterEqual(def_cnt, 1, f"No defenders in {mid} {t_key}")


if __name__ == "__main__":
    unittest.main()
