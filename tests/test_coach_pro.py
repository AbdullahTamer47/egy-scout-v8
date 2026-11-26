"""Unit & API Integration Tests for EGY-SCOUT Coach Pro."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from packages.coach_engine.director_admin import (
    CoachProStore,
    build_official_matchday_sheet,
    build_squad_depth_report,
    compute_foreign_quota,
    evaluate_squad_availability,
)
from packages.coach_engine.live_data_hub import (
    EGYPTIAN_CLUB_PRESETS,
    load_all_coach_clubs,
    parse_fs_player_wikitext,
)
from packages.coach_engine.training_planner import (
    PRO_DRILLS_CATALOG,
    compute_session_load,
    evaluate_weekly_microcycle_safety,
    generate_custom_session_plan,
)


SAMPLE_WIKI_TEXT = """
{{Fs player|no=1|nat=EGY|name=[[Mohamed El Shenawy]]|pos=GK|other=[[Captain (association football)|captain]]}}
{{Fs player|no=3|nat=MAR|name=[[Mahmoud Bentayg]]|pos=DF|other=}}
{{Fs player|no=17|nat=EGY|name=[[Emam Ashour]]|pos=MF|other=}}
{{Fs player|no=9|nat=EGY|name=[[Nasser Mansi]]|pos=FW|other=}}
"""

SAMPLE_AR_WIKI_TEXT = """
{{تشكيلة لاعب|الرقم=1|دولة=مصر|مركز=حارس|اسم=[[الهاني سليمان]]}}
{{تشكيلة لاعب|الرقم=2|دولة=مصر|مركز=دفاع|اسم=[[خالد عبد الفتاح]]}}
{{تشكيلة لاعب|الرقم=3|دولة=فلسطين|مركز=وسط|اسم=[[محمد باسم رشيد]]}}
{{تشكيلة لاعب|الرقم=7|دولة=غينيا|مركز=هجوم|اسم=[[أليا سيلا]]}}
"""


class TestCoachPro(unittest.TestCase):
    def test_wikitext_en_and_ar_parsers(self) -> None:
        en_players = parse_fs_player_wikitext(SAMPLE_WIKI_TEXT)
        self.assertEqual(len(en_players), 4)
        self.assertEqual(en_players[0]["position"], "GK")
        self.assertTrue(en_players[0]["is_captain"])
        self.assertEqual(en_players[1]["nationality"], "MAR")

        ar_players = parse_fs_player_wikitext(SAMPLE_AR_WIKI_TEXT, wiki_lang="ar")
        self.assertEqual(len(ar_players), 4)
        self.assertEqual(ar_players[0]["name_ar"], "الهاني سليمان")
        self.assertEqual(ar_players[0]["position"], "GK")
        self.assertEqual(ar_players[2]["nationality"], "PLE")

    def test_full_egyptian_league_catalog_present(self) -> None:
        self.assertGreaterEqual(len(EGYPTIAN_CLUB_PRESETS), 20)
        clubs = load_all_coach_clubs()
        for cid in ("pyramids", "zamalek", "al_ahly", "ceramica", "enppi", "al_masry"):
            self.assertIn(cid, clubs)
            self.assertGreaterEqual(len(clubs[cid]["players"]), 11)

    def test_training_load_and_drill_bounds(self) -> None:
        load = compute_session_load(80, 7.5)
        self.assertEqual(load["srpe_au"], 600.0)
        self.assertEqual(load["intensity"], "high")

        overload = evaluate_weekly_microcycle_safety(
            [{"md_code": "MD-4", "srpe_au": 1800, "target_rpe": 8.5}, {"md_code": "MD-3", "srpe_au": 1600, "target_rpe": 8.0}]
        )
        self.assertEqual(overload["status"], "warning")
        self.assertGreaterEqual(len(overload["warnings_ar"]), 2)

        for drill in PRO_DRILLS_CATALOG:
            for p in drill["players"]:
                self.assertGreaterEqual(p["x_m"], 0.0)
                self.assertLessEqual(p["x_m"], 105.0)
                self.assertGreaterEqual(p["y_m"], 0.0)
                self.assertLessEqual(p["y_m"], 68.0)

        sess = generate_custom_session_plan("الأهلي", md_code="MD-2", focus_topic="اختراق المنطقة 14")
        self.assertEqual(len(sess["phases"]), 4)
        self.assertGreater(sess["srpe_au"], 0.0)

    def test_admin_yellow_cards_and_injury_exclude_from_xi(self) -> None:
        clubs = load_all_coach_clubs()
        ahly = list(clubs["al_ahly"]["players"])
        self.assertGreaterEqual(len(ahly), 11)

        with tempfile.TemporaryDirectory() as tmp:
            store = CoachProStore(Path(tmp) / "coach_test.sqlite3")
            prof = store.save_coach_profile("t1", "كابتن حسام", "head_coach", "al_ahly", "zamalek", "4-2-3-1")
            self.assertEqual(prof["coach_name"], "كابتن حسام")

            first_num = int(ahly[0]["jersey_number"])
            second_num = int(ahly[1]["jersey_number"])
            store.upsert_admin_status("t1", "al_ahly", first_num, status="injured", readiness_pct=20, return_date="2026-12-10")
            store.upsert_admin_status("t1", "al_ahly", second_num, status="fit", yellow_cards=3)

            evaluated = evaluate_squad_availability(ahly, store.get_admin_statuses("t1", "al_ahly"))
            by_num = {int(p["jersey_number"]): p for p in evaluated}
            self.assertFalse(by_num[first_num]["is_eligible_starter"])
            self.assertFalse(by_num[second_num]["is_eligible_starter"])
            self.assertEqual(by_num[second_num]["status"], "suspended")

            depth = build_squad_depth_report(evaluated, "4-2-3-1")
            self.assertEqual(depth["unavailable_count"], 2)

            sheet = build_official_matchday_sheet("الأهلي", "الزمالك", evaluated, "4-2-3-1")
            starter_nums = {int(p["jersey_number"]) for p in sheet["starters"]}
            self.assertNotIn(first_num, starter_nums)
            self.assertNotIn(second_num, starter_nums)
            self.assertEqual(len(sheet["excluded"]), 2)

    def test_coach_api_end_to_end_routes(self) -> None:
        from apps.coach_api.main import app as coach_app

        client = TestClient(coach_app)
        hdrs = {"X-Tenant-Id": "test_coach_e2e", "X-User-Role": "coach"}

        r_hp = client.get("/api/health")
        self.assertEqual(r_hp.status_code, 200)
        self.assertEqual(r_hp.json()["edition"], "coach_pro")

        r_prof = client.post(
            "/api/coach/profile",
            headers=hdrs,
            json={"coach_name": "كابتن اختبار", "coach_role": "head_coach", "club_id": "zamalek", "opponent_id": "al_ahly", "formation": "3-4-2-1"},
        )
        self.assertEqual(r_prof.status_code, 200)
        self.assertEqual(r_prof.json()["profile"]["coach_name"], "كابتن اختبار")

        r_clubs = client.get("/api/coach/clubs", headers=hdrs)
        self.assertEqual(r_clubs.status_code, 200)
        self.assertGreaterEqual(len(r_clubs.json()["clubs"]), 20)

        r_ov = client.get("/api/coach/overview?club_id=zamalek&opponent_id=al_ahly&formation=3-4-2-1", headers=hdrs)
        self.assertEqual(r_ov.status_code, 200)
        self.assertIn("squad_depth", r_ov.json())
        self.assertIn("matchday_sheet", r_ov.json())

        r_chat = client.post(
            "/api/coach/chat",
            headers=hdrs,
            json={"question": "ارسم خطة 3-4-2-1 تشابي ألونسو", "club_id": "zamalek", "opponent_id": "al_ahly", "formation": "3-4-2-1"},
        )
        self.assertEqual(r_chat.status_code, 200)
        self.assertEqual(r_chat.json()["action_executed"], "apply_tactics")
        self.assertIsNotNone(r_chat.json()["ai_drawing_blueprint"])
        self.assertEqual(len(r_chat.json()["ai_drawing_blueprint"]["nodes"]), 11)

        r_trn = client.post(
            "/api/coach/chat",
            headers=hdrs,
            json={"question": "صمم وحدة تدريبية MD-2 للضغط العالي", "club_id": "zamalek", "opponent_id": "al_ahly"},
        )
        self.assertEqual(r_trn.status_code, 200)
        self.assertEqual(r_trn.json()["action_executed"], "apply_training")
        self.assertIsNotNone(r_trn.json()["ai_training_session"])

        # V2: 3-phase tactical blueprint & All-Egypt League Search
        r_bp = client.post(
            "/api/coach/tactics/blueprint",
            headers=hdrs,
            json={"club_id": "al_ahly", "opponent_id": "zamalek", "formation_code": "4-2-3-1"},
        )
        self.assertEqual(r_bp.status_code, 200)
        phases = r_bp.json().get("phase_states") or {}
        self.assertEqual(set(phases.keys()), {"possession", "attack", "defense"})
        pos_x = sum(n["x_m"] for n in phases["possession"]["nodes"])
        att_x = sum(n["x_m"] for n in phases["attack"]["nodes"])
        def_x = sum(n["x_m"] for n in phases["defense"]["nodes"])
        self.assertGreater(att_x, pos_x)
        self.assertLess(def_x, pos_x)
        for ph in phases.values():
            for n in ph["nodes"] + ph["opponent_nodes"]:
                self.assertGreaterEqual(n["x_m"], 0.0)
                self.assertLessEqual(n["x_m"], 105.0)
                self.assertGreaterEqual(n["y_m"], 0.0)
                self.assertLessEqual(n["y_m"], 68.0)

        r_lp = client.get("/api/coach/league-players?nationality_type=foreign&limit=50", headers=hdrs)
        self.assertEqual(r_lp.status_code, 200)
        self.assertGreater(r_lp.json()["count"], 0)
        for lp in r_lp.json()["players"]:
            self.assertNotEqual(lp["nationality"], "EGY")

        # V4: Multi-format small-sided tactical blueprints (5v5 & 7v7) with real Arabic player names
        for tsize, form_code in [(5, "1-2-1"), (7, "2-3-1")]:
            r_small = client.post(
                "/api/coach/tactics/blueprint",
                headers=hdrs,
                json={"club_id": "al_ahly", "opponent_id": "zamalek", "team_size": tsize, "formation_code": form_code},
            )
            self.assertEqual(r_small.status_code, 200)
            bdata = r_small.json()
            self.assertEqual(len(bdata["nodes"]), tsize)
            self.assertEqual(len(bdata["opponent_nodes"]), tsize)
            self.assertEqual(set(bdata["phase_states"].keys()), {"possession", "attack", "defense"})
            for nd in bdata["nodes"]:
                self.assertTrue(nd.get("player_label"))
                self.assertNotIn("[[", nd["player_label"])

    def test_zero_wikilink_leaks_and_wikidata_bio_coverage(self) -> None:
        clubs = load_all_coach_clubs()
        all_p = [p for c in clubs.values() for p in (c.get("players") or [])]
        self.assertGreaterEqual(len(all_p), 700)
        for p in all_p:
            self.assertNotIn("[[", str(p.get("name_en") or ""))
            self.assertNotIn("[[", str(p.get("name_ar") or ""))
            self.assertNotIn("]]", str(p.get("name_en") or ""))
        with_age = sum(1 for p in all_p if isinstance(p.get("age"), int) and p["age"] >= 15)
        with_ht = sum(1 for p in all_p if isinstance(p.get("height_cm"), int) and p["height_cm"] >= 155)
        self.assertGreater(with_age, 100)
        self.assertGreater(with_ht, 50)

        fq = compute_foreign_quota(clubs["al_ahly"]["players"])
        self.assertEqual(fq["limit"], 5)
        self.assertIn(fq["status"], ("ok", "warning", "over_limit"))


if __name__ == "__main__":
    unittest.main()
