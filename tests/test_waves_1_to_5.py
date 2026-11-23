"""Comprehensive test suite for Waves 1-5 engineering modules & Colab L4 Full Notebook."""
from __future__ import annotations

import ast
import json
import unittest

import numpy as np
import pandas as pd

from packages.innovation_lab.kinematic_sandbox import optimize_set_piece_self_play
from packages.shared_contracts.config import get_repo_root
from packages.shared_contracts.lineup_connector import parse_scoresheet_text
from packages.shared_contracts.r2_storage import (
    generate_signed_video_token,
    verify_signed_video_token,
)
from services.cv_worker.lazy_engines.event_pose import (
    evaluate_pose_with_resolution_gate,
    select_event_pose_windows,
)
from services.cv_worker.lazy_engines.video_export import build_hls_ffmpeg_command
from services.cv_worker.stages.ball_tracker import (
    generate_sahi_tiles,
    track_and_inpaint_ball,
)
from services.cv_worker.stages.events_spotting import (
    classify_shot_gate,
    detect_scoreboard_goal_changes,
    extract_goal_forensics_window,
)
from services.cv_worker.stages.jersey_ocr import (
    check_jersey_legibility,
    vote_track_jersey_number,
)
from services.cv_worker.stages.reid_embedder import merge_fragmented_tracks_reid
from services.orchestrator.chunk_pipeline import (
    plan_video_chunks,
    stitch_chunk_dataframes,
)


class TestWaves1To5(unittest.TestCase):
    def test_wave1_18_chunk_orchestrator_and_cross_chunk_stitcher(self) -> None:
        chunks = plan_video_chunks(duration_s=5400.0, fps=25.0, chunk_duration_s=300.0, overlap_s=5.0)
        self.assertEqual(len(chunks), 18)
        self.assertEqual(chunks[0].start_s, 0.0)
        self.assertEqual(chunks[1].overlap_s, 5.0)

        # Stitch two overlapping chunks where local track 7 in chunk 2 is the same player as track 1 in chunk 1
        c1 = pd.DataFrame([
            {"frame_id": 100, "track_id": 1, "role": "player", "x1": 100, "y1": 100, "x2": 130, "y2": 180, "x_m": 40.0, "y_m": 30.0},
            {"frame_id": 101, "track_id": 1, "role": "player", "x1": 102, "y1": 100, "x2": 132, "y2": 180, "x_m": 40.3, "y_m": 30.1},
        ])
        c2 = pd.DataFrame([
            {"frame_id": 101, "track_id": 7, "role": "player", "x1": 103, "y1": 100, "x2": 133, "y2": 180, "x_m": 40.4, "y_m": 30.1},
            {"frame_id": 102, "track_id": 7, "role": "player", "x1": 105, "y1": 100, "x2": 135, "y2": 180, "x_m": 40.7, "y_m": 30.2},
        ])
        stitched = stitch_chunk_dataframes([c1, c2])
        self.assertEqual(len(stitched), 3)
        self.assertTrue((stitched["track_id"] == 1).all())

    def test_wave1_jersey_legibility_voting_reid_and_scoresheet(self) -> None:
        tiny = np.zeros((10, 10, 3), dtype=np.uint8)
        self.assertFalse(check_jersey_legibility(tiny).is_legible)

        num, conf = vote_track_jersey_number([(10, 0.85), (10, 0.90), (18, 0.40)], official_roster_numbers={10, 9})
        self.assertEqual(num, 10)
        self.assertGreater(conf, 0.7)

        # Re-ID merges fragmented same-player tracks across a short gap
        df = pd.DataFrame([
            {"frame_id": 10, "time_s": 0.4, "track_id": 2, "role": "player", "team": "team_a", "x_m": 30.0, "y_m": 25.0},
            {"frame_id": 25, "time_s": 1.0, "track_id": 99, "role": "player", "team": "team_a", "x_m": 32.0, "y_m": 26.0},
        ])
        merged, remap = merge_fragmented_tracks_reid(
            df, {2: np.array([1.0, 0.2, 0.1]), 99: np.array([0.99, 0.21, 0.11])}
        )
        self.assertEqual(remap.get(99), 2)
        self.assertEqual(merged["track_id"].nunique(), 1)

        roster = parse_scoresheet_text("1 - محمد الشناوي (GK) (C)\n10 إمام عاشور\n--- احتياط ---\n14 - حسين الشحات")
        self.assertEqual(len(roster), 3)
        self.assertTrue(roster[0].is_captain and roster[0].position == "GK")
        self.assertFalse(roster[2].is_starter)

    def test_wave2_ball_sahi_kalman_3d_arc_events_and_hls(self) -> None:
        tiles = generate_sahi_tiles(1280, 720)
        self.assertGreaterEqual(len(tiles), 4)

        # Long aerial pass at ~18 m/s with a 2-frame occlusion gap
        dets = [(i, i * 0.04, None if i in (5, 6) else (20.0 + i * 0.72, 34.0)) for i in range(20)]
        states = track_and_inpaint_ball(dets)
        self.assertEqual(len(states), 20)
        self.assertTrue(any(s.inpainted for s in states))
        self.assertTrue(any(s.z_m > 0.5 for s in states))  # parabolic 3D flight height computed

        # Teleportation spike rejection + cut-gap reset
        dets_spike = [
            (0, 0.00, (48.0, 18.0)),
            (4, 0.16, (48.5, 17.5)),
            (8, 0.32, (21.6, 55.0)),   # impossible ~430 km/h teleport spike -> rejected!
            (12, 0.48, (49.2, 16.8)),
            (90, 3.60, (12.0, 40.0)),  # new shot after 3.1s cut -> resets cleanly
        ]
        st_spike = track_and_inpaint_ball(dets_spike)
        self.assertEqual([s.frame_id for s in st_spike], [0, 4, 8, 12, 90])
        self.assertTrue(st_spike[2].inpainted)
        self.assertAlmostEqual(st_spike[4].x_m, 12.0, delta=0.5)

        # Scoreboard dual-lock ignores replay wipes and confirms real goal
        self.assertEqual(classify_shot_gate(14, 0.1, False), "tactical_wide")
        self.assertEqual(classify_shot_gate(14, 0.1, True), "replay")
        readings = [
            (100, 4.0, 0, 0, "tactical_wide"),
            (101, 4.1, 1, 0, "replay"),  # ignored replay!
            (102, 4.2, 1, 0, "tactical_wide"),
            (103, 4.3, 1, 0, "tactical_wide"),
            (104, 4.4, 1, 0, "tactical_wide"),
        ]
        goals = detect_scoreboard_goal_changes(readings, confirm_frames=3)
        self.assertEqual(len(goals), 1)
        self.assertEqual(goals[0].team, "team_a")

        win = extract_goal_forensics_window([s.to_dict() for s in states], goal_time_s=0.76)
        self.assertGreater(win["ball_travel_m"], 5.0)

        cmd = build_hls_ffmpeg_command("in.mp4", "out_hls", keyint=15)
        self.assertIn("15", cmd)

    def test_wave3_drm_schema_and_waves4_5_pose_and_innovation_lab(self) -> None:
        schema_sql = (get_repo_root() / "packages" / "shared_contracts" / "db_schema.sql").read_text(encoding="utf-8")
        self.assertIn("ENABLE ROW LEVEL SECURITY", schema_sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS match_track", schema_sql)

        tok = generate_signed_video_token("matches/m2/master.m3u8", "club_ahly", ttl_seconds=600)
        self.assertTrue(verify_signed_video_token("matches/m2/master.m3u8", "club_ahly", int(tok["expires"]), str(tok["sig"])))
        self.assertFalse(verify_signed_video_token("matches/m2/master.m3u8", "other_club", int(tok["expires"]), str(tok["sig"])))

        # Wave 4 Event-Triggered Pose Resolution Gate (<75px skips head scanning, >=75px enables it)
        windows = select_event_pose_windows([10.0, 11.5, 40.0], window_half_s=2.0)
        self.assertEqual(len(windows), 2)
        small_p = evaluate_pose_with_resolution_gate(1, 100, [10, 10, 30, 60], (1.0, 0.2), [0, 40, -30])
        self.assertFalse(small_p.head_scanning_enabled)
        big_p = evaluate_pose_with_resolution_gate(1, 100, [10, 10, 50, 110], (1.0, 0.2), [0, 40, -30])
        self.assertTrue(big_p.head_scanning_enabled)
        self.assertEqual(big_p.head_scan_count, 2)

        # Wave 5 Tactical Innovation Lab
        sim = optimize_set_piece_self_play(n_candidates=10, rollouts_per_candidate=200)
        self.assertGreaterEqual(sim.optimized_goal_prob_pct, sim.baseline_goal_prob_pct)
        self.assertEqual(sim.human_realism_constraints["reaction_time_ms"], 250)

    def test_pro_api_routes_and_colab_l4_notebook_syntax(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)
        p_res = client.post("/api/lineups/parse-scoresheet", json={"raw_text": "10 - Emam Ashour\n9 - Wessam"})
        self.assertEqual(p_res.status_code, 200)
        self.assertEqual(p_res.json()["count"], 2)

        drm = client.get("/api/matches/m2_ahly_enppi/drm-token")
        self.assertEqual(drm.status_code, 200)
        self.assertIn("sig", drm.json())

        inn = client.post("/api/tactics/innovation/simulate", json={"n_candidates": 8, "rollouts_per_candidate": 150})
        self.assertEqual(inn.status_code, 200)
        self.assertIn("optimized_goal_prob_pct", inn.json())

        rep = client.get("/api/matches/m2_ahly_enppi/export-report")
        self.assertEqual(rep.status_code, 200)
        self.assertIn("تقرير المباراة الموثّق", rep.text)

        nb_p = get_repo_root() / "notebooks" / "kaggle_zero_budget" / "egy_scout_v8_colab_l4_full.ipynb"
        self.assertTrue(nb_p.is_file())
        nb = json.loads(nb_p.read_text(encoding="utf-8"))
        for i, cell in enumerate(nb["cells"]):
            if cell["cell_type"] == "code":
                ast.parse("".join(cell["source"]), filename=f"colab_l4_cell_{i}")

        # Verify new V8 Pro endpoints: Phase-0 Ground-Truth Eval, Opponent Dossier, Player Dossier
        p0 = client.get("/api/matches/m2_ahly_enppi/phase0-eval")
        self.assertEqual(p0.status_code, 200)
        self.assertTrue(p0.json()["available"])
        self.assertGreater(p0.json()["annotated_frames"], 0)

        od = client.get("/api/matches/m2_ahly_enppi/opponent-dossier")
        self.assertEqual(od.status_code, 200)
        self.assertIn("summary_ar", od.json())

        sc = client.get("/api/scouting/players?match_id=m2_ahly_enppi")
        self.assertEqual(sc.status_code, 200)
        first_pid = sc.json()["benchmark_players"][0]["player_id"]
        pdos = client.get(f"/api/scouting/players/{first_pid}/dossier?match_id=m2_ahly_enppi")
        self.assertEqual(pdos.status_code, 200)
        self.assertGreater(len(pdos.json()["rating_breakdown"]), 0)

        # Verify Moment State Analyzer (Did / Did Not / Where & Why) + Formation Blueprint + AI Tactical Chatbot + QA Sheet
        ms_resp = client.get("/api/matches/m2_ahly_enppi/moment-state?frame_id=1250")
        self.assertEqual(ms_resp.status_code, 200)
        ms_data = ms_resp.json()
        self.assertIn("moment_summary", ms_data)
        self.assertGreater(len(ms_data["player_states"]), 0)
        self.assertIn("did_ar", ms_data["player_states"][0])
        self.assertIn("did_not_ar", ms_data["player_states"][0])
        self.assertIn("where_and_why_ar", ms_data["player_states"][0])

        bp_resp = client.get("/api/matches/m2_ahly_enppi/formation-blueprint?formation_code=4-2-3-1")
        self.assertEqual(bp_resp.status_code, 200)
        self.assertEqual(len(bp_resp.json()["nodes"]), 11)

        chat_resp = client.post(
            "/api/chat/ask",
            json={"match_id": "m2_ahly_enppi", "question": "ارسم خطة 4-2-3-1 واشرح كل لاعب عمل إيه ومعملش إيه"},
        )
        self.assertEqual(chat_resp.status_code, 200)
        self.assertIn("answer_ar", chat_resp.json())
        self.assertGreater(len(chat_resp.json()["structured_cards"]), 0)

        qa_resp = client.get("/api/matches/m2_ahly_enppi/qa-sheet?frame_id=1250")
        self.assertEqual(qa_resp.status_code, 200)
        self.assertGreater(qa_resp.json()["in_frame_count"], 0)
        self.assertTrue(qa_resp.json()["tracks"][0]["in_current_frame"])

    def test_v8_upgraded_cv_engines_scoreboard_gk_cap_and_pitch_calib(self) -> None:
        from services.cv_worker.stages.events_spotting import parse_scoreboard_text
        from services.cv_worker.stages.pitch_calib import FIFA_KEYPOINTS
        from services.cv_worker.lazy_engines.video_export import resolve_ffmpeg_binary

        self.assertEqual(FIFA_KEYPOINTS.shape, (32, 2))
        self.assertEqual(parse_scoreboard_text(["AHL", "2", "-", "1", "ENP", "67:14"]), (2, 1))
        self.assertEqual(parse_scoreboard_text(["0-0", "12:05"]), (0, 0))
        self.assertIsNotNone(resolve_ffmpeg_binary())

    def test_v9_math_validator_sqlite_xml_h2h_share_and_rbac(self) -> None:
        from fastapi.testclient import TestClient
        from apps.api.main import app

        client = TestClient(app)

        # 1. Tactical Math Validator (Math-First audit on crazy sweeper-keeper 2-1-6-1 shape)
        val_resp = client.post(
            "/api/plans/validate",
            json={
                "formation_code": "2-1-6-1",
                "nodes_a": [
                    {"slot": "GK", "x_m": 38.0, "y_m": 34.0},
                    {"slot": "CB1", "x_m": 25.0, "y_m": 20.0},
                    {"slot": "CB2", "x_m": 25.0, "y_m": 48.0},
                    {"slot": "DM", "x_m": 46.0, "y_m": 22.0},
                    {"slot": "M1", "x_m": 65.0, "y_m": 8.0},
                    {"slot": "M2", "x_m": 68.0, "y_m": 16.0},
                    {"slot": "M3", "x_m": 70.0, "y_m": 22.0},
                    {"slot": "M4", "x_m": 72.0, "y_m": 28.0},
                    {"slot": "M5", "x_m": 74.0, "y_m": 36.0},
                    {"slot": "M6", "x_m": 70.0, "y_m": 46.0},
                    {"slot": "ST", "x_m": 88.0, "y_m": 34.0},
                ],
                "nodes_b": [
                    {"slot": "GK", "x_m": 99.0, "y_m": 34.0},
                    {"slot": "ST1", "x_m": 50.0, "y_m": 26.0},
                    {"slot": "ST2", "x_m": 52.0, "y_m": 42.0},
                ],
            },
        )
        self.assertEqual(val_resp.status_code, 200)
        vdata = val_resp.json()
        self.assertEqual(vdata["risk_level"], "high")
        self.assertEqual(len(vdata["corridors"]), 5)
        self.assertTrue(any("الحارس المتقدم" in v for v in vdata["vulnerabilities_ar"]))

        # 2. SQLite Server Persistence for Saved Plans + RBAC read-only check for Board/Player
        save_resp = client.post(
            "/api/plans",
            json={"match_id": "m2_ahly_enppi", "name": "Test Plan V9", "formationA": "3-5-2", "formationB": "5-3-2", "nodesA": [], "nodesB": []},
            headers={"X-User-Role": "analyst"},
        )
        self.assertEqual(save_resp.status_code, 200)
        plan_id = save_resp.json()["plan"]["id"]
        list_resp = client.get("/api/plans?match_id=m2_ahly_enppi", headers={"X-User-Role": "board"})
        self.assertEqual(list_resp.status_code, 200)
        self.assertTrue(any(p["id"] == plan_id for p in list_resp.json()["plans"]))
        # Board must be blocked (403) from mutating plans
        board_block = client.post(
            "/api/plans",
            json={"match_id": "m2_ahly_enppi", "name": "Blocked"},
            headers={"X-User-Role": "board"},
        )
        self.assertEqual(board_block.status_code, 403)
        del_resp = client.delete(f"/api/plans/{plan_id}?match_id=m2_ahly_enppi", headers={"X-User-Role": "analyst"})
        self.assertEqual(del_resp.status_code, 200)

        # 3. Clip Tagging + Sportscode / Nacsport XML Export & Import Round-Trip
        t_resp = client.post(
            "/api/matches/m2_ahly_enppi/tags",
            json={"category": "high_press", "label_ar": "ضغط عالٍ", "label_en": "High Press", "time_s": 54.0, "pre_roll_s": 3, "post_roll_s": 3},
        )
        self.assertEqual(t_resp.status_code, 200)
        tag_id = t_resp.json()["tag"]["id"]
        xml_resp = client.get("/api/matches/m2_ahly_enppi/tags/export-xml")
        self.assertEqual(xml_resp.status_code, 200)
        self.assertIn(b"<ALL_INSTANCES>", xml_resp.content)
        imp_resp = client.post(
            "/api/matches/m2_ahly_enppi/tags/import-xml",
            json={"xml_text": xml_resp.text},
        )
        self.assertEqual(imp_resp.status_code, 200)
        self.assertGreaterEqual(imp_resp.json()["imported_count"], 1)
        # Clean up test tags
        for tg in imp_resp.json()["tags"]:
            if tg["id"] == tag_id or tg.get("playlist_name") in ("محاضرة غرفة الملابس", "مستورد من XML"):
                client.delete(f"/api/matches/m2_ahly_enppi/tags/{tg['id']}")

        # 4. Head-to-Head Fair Comparison & Multi-Match Trends
        h2h_resp = client.get("/api/scouting/compare?match_id=m2_ahly_enppi")
        self.assertEqual(h2h_resp.status_code, 200)
        self.assertGreaterEqual(len(h2h_resp.json()["players"]), 2)
        tr_resp = client.get("/api/scouting/multi-match-trends")
        self.assertEqual(tr_resp.status_code, 200)
        self.assertGreaterEqual(tr_resp.json()["total_matches_in_archive"], 3)

        # 5. Role-Aware Mobile Player Share Portal (Redacts internal board notes)
        sh_resp = client.post(
            "/api/share/player",
            json={"match_id": "m2_ahly_enppi", "player_name": "إمام عاشور", "position": "CM", "rating_10": 8.4},
        )
        self.assertEqual(sh_resp.status_code, 200)
        self.assertTrue(sh_resp.json()["redacted_internal_notes"])
        portal = client.get(sh_resp.json()["share_url"])
        self.assertEqual(portal.status_code, 200)
        self.assertIn("إمام عاشور", portal.text)

    def test_v9_5_free_pro_studio_and_data_integrity(self):
        """Verify V9.5 100%-free features & strict football data integrity invariants."""
        import numpy as np
        import pandas as pd
        from fastapi.testclient import TestClient
        from apps.api.main import app
        from packages.scouting_core.fair_engine import import_external_scouting_csv
        from packages.tactics_engine.moment_analyzer import build_formation_blueprint
        from services.cv_worker.stages.one_euro import smooth_tracks_one_euro

        # 1. Casiez 2012 One-Euro Filter reduces jitter while preserving signal
        rng = np.random.default_rng(42)
        n = 40
        true_x = np.linspace(20.0, 28.0, n)  # realistic 5 m/s (18 km/h) run over 1.6s
        noisy_x = true_x + rng.normal(0.0, 0.45, n)
        df_jitter = pd.DataFrame({
            "frame_id": np.arange(n),
            "time_s": np.arange(n) / 25.0,
            "track_id": [101] * n,
            "role": ["player"] * n,
            "team": ["team_a"] * n,
            "x_m": noisy_x,
            "y_m": np.full(n, 34.0) + rng.normal(0.0, 0.45, n),
            "x1": noisy_x * 10,
            "y1": np.full(n, 200.0),
            "x2": noisy_x * 10 + 30,
            "y2": np.full(n, 280.0),
        })
        df_smooth = smooth_tracks_one_euro(df_jitter, fps=25.0)
        raw_err = float(np.std(df_jitter["x_m"].to_numpy() - true_x))
        smooth_err = float(np.std(df_smooth["x_m"].to_numpy() - true_x))
        self.assertLess(smooth_err, raw_err)
        self.assertLess(float(np.std(np.diff(df_smooth["x_m"]))), float(np.std(np.diff(df_jitter["x_m"]))))

        # 2. Position-Aware Roster Mapping & Verified 2025/2026 Squads (NO LB-at-CB, NO CM-at-ST, NO stale names)
        client = TestClient(app)
        bp_resp = client.get("/api/matches/m2_ahly_enppi/formation-blueprint?formation_a=4-2-3-1&formation_b=4-4-2")
        self.assertEqual(bp_resp.status_code, 200)
        bp = bp_resp.json()
        nodes_a = {n["slot"]: n["player_label"] for n in bp["nodes"]}
        nodes_b = {n["slot"]: n["player_label"] for n in bp["opponent_nodes"]}
        self.assertIn("الشناوي", nodes_a["GK"])
        self.assertIn("سمير", nodes_b["GK"])
        self.assertIn("شريف", nodes_a["ST"])
        # Left-back must never be placed in CB slot
        for cb_slot in ("LCB", "RCB", "CB1", "CB2"):
            if cb_slot in nodes_a:
                self.assertNotIn("عطية الله", nodes_a[cb_slot])
                self.assertNotIn("هاني", nodes_a[cb_slot])
        # Outdated 2023/2024 names must not leak into 2025/2026 default squad
        all_names_blob = " ".join(list(nodes_a.values()) + list(nodes_b.values()))
        for stale in ("علي معلول", "بيرسي تاو", "أليو ديانج", "كهربا"):
            self.assertNotIn(stale, all_names_blob)

        # 3. Head-to-Head Scouting Isolation (NO Morocco WC 2022 players unless explicit opt-in)
        h2h_default = client.get("/api/scouting/compare?match_id=m2_ahly_enppi")
        self.assertEqual(h2h_default.status_code, 200)
        default_players = h2h_default.json()["players"]
        self.assertGreaterEqual(len(default_players), 2)
        for p in default_players:
            self.assertNotIn("Amrabat", p["display_name"])
            self.assertNotIn("Hakimi", p["display_name"])
            self.assertNotEqual(p.get("source_type"), "statsbomb_external")

        # 4. Auto-Detecting Catapult GPS & Wyscout CSV Importer
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmpdir:
            cat_path = Path(tmpdir) / "catapult.csv"
            cat_path.write_text(
                "Player Name,Position Name,Total Distance (m),Max Velocity (km/h),High Speed Running (m),Accelerations\n"
                "Emam Ashour,CM,11240,32.6,820,42\n"
                "Mohamed Sherif,ST,9850,33.4,910,36\n",
                encoding="utf-8",
            )
            cat_res = import_external_scouting_csv(cat_path)
            self.assertEqual(len(cat_res), 2)
            self.assertEqual(cat_res[0].data_source, "Catapult / STATSports GPS")
            self.assertGreater(cat_res[0].max_speed_kmh, 30.0)

            wy_path = Path(tmpdir) / "wyscout.csv"
            wy_path.write_text(
                "Player,Pos,xG,Accurate passes, %,Minutes played,Progressive passes per 90\n"
                "Marwan Attia,DM,0.12,89.4,90,7.5\n",
                encoding="utf-8",
            )
            wy_res = import_external_scouting_csv(wy_path)
            self.assertEqual(len(wy_res), 1)
            self.assertEqual(wy_res[0].data_source, "Wyscout Export")

        # 5. Open-Formula OBV / xPass / CxP / Defensive Responsibility + Windowed Parquet Predicate Pushdown
        adv_resp = client.get("/api/matches/m2_ahly_enppi/advanced-metrics?start_s=50&end_s=58")
        self.assertEqual(adv_resp.status_code, 200)
        adv = adv_resp.json()
        self.assertTrue(adv["windowed_parquet_pushdown"])
        self.assertIn("team_a", adv["team_summary"])
        self.assertIn("net_obv", adv["team_summary"]["team_a"])
        self.assertIn("expected_pass_pct", adv["team_summary"]["team_a"])
        self.assertIn("defensive_responsibility_alerts", adv)
        self.assertIn("top_obv_players", adv)

        # 6. Role-Aware Club Report (admin vs player audience redaction)
        rep_admin = client.get("/api/matches/m2_ahly_enppi/export-report?audience=admin")
        rep_player = client.get("/api/matches/m2_ahly_enppi/export-report?audience=player")
        self.assertEqual(rep_admin.status_code, 200)
        self.assertEqual(rep_player.status_code, 200)
        self.assertIn("نسخة اللاعب", rep_player.text)
        self.assertIn("المخاطرة الداخلية", rep_admin.text)
        self.assertNotIn("المخاطرة الداخلية", rep_player.text)

        # 7. Full SQLite Bench Persistence with Verified 2025/2026 Player Names
        bench_resp = client.get("/api/matches/m2_ahly_enppi/bench-state")
        self.assertEqual(bench_resp.status_code, 200)
        on_pitch_a = " ".join(bench_resp.json()["on_pitch"]["team_a"])
        self.assertIn("الشناوي", on_pitch_a)

        # 8. Free Local ffmpeg Merged Locker-Room Lecture MP4 Export
        tag_resp = client.post(
            "/api/matches/m2_ahly_enppi/tags",
            json={"category": "transition", "label_ar": "تحول سريع اختباري", "label_en": "Test Transition", "time_s": 53.0, "pre_roll_s": 1.5, "post_roll_s": 1.5},
        )
        self.assertEqual(tag_resp.status_code, 200)
        tmp_tag_id = tag_resp.json()["tag"]["id"]
        try:
            mp4_resp = client.post(
                "/api/matches/m2_ahly_enppi/tags/export-playlist-mp4",
                json={"tag_ids": [tmp_tag_id]},
            )
            self.assertEqual(mp4_resp.status_code, 200)
            self.assertEqual(mp4_resp.headers.get("content-type"), "video/mp4")
            self.assertGreater(len(mp4_resp.content), 5000)
        finally:
            client.delete(f"/api/matches/m2_ahly_enppi/tags/{tmp_tag_id}")


if __name__ == "__main__":
    unittest.main()
