"""Open-Formula Advanced Event & Possession Models (100% Free — StatsBomb-Inspired).

Computes deterministic, transparent football analytics strictly from tracked pitch coordinates:
  1. Expected Pass (xPass) & Completion Above Expected (CxP):
     Logistic difficulty model using pass distance, progressive angle toward goal,
     defensive pressure on passer, defenders inside passing lane, and target zone.
  2. On-Ball Value (OBV):
     Net Possession State Value = Delta P(Score) - Delta P(Concede) using a 12x8 Expected
     Threat (xT) surface + counter-attack vulnerability surface across passes, carries & recoveries.
  3. Defensive Responsibility Score:
     Assigns accountability (0..100) to the nearest defender / backline marker whenever an
     opponent enters Zone 14 or the penalty box unopposed.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from packages.scouting_core.fair_engine import compute_xt_value


def _sigmoid(z: float) -> float:
    z = float(np.clip(z, -12.0, 12.0))
    return 1.0 / (1.0 + math.exp(-z))


def compute_xpass_probability(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    attack_right: bool,
    passer_pressure_m: float,
    lane_defenders: int,
) -> float:
    """Open logistic xPass probability (0.08..0.97) calibrated to open-play football physics."""
    dist = math.hypot(x2 - x1, y2 - y1)
    prog_dx = (x2 - x1) if attack_right else (x1 - x2)
    target_att_x = x2 if attack_right else (105.0 - x2)

    # Higher distance, forward progression into final third, tight pressure, and blockers lower xPass
    logit = (
        2.65
        - 0.052 * dist
        - 0.028 * max(0.0, prog_dx)
        - 0.85 * lane_defenders
        - (0.65 if passer_pressure_m < 2.2 else 0.0)
        - (0.45 if target_att_x >= 88.5 and 13.8 <= y2 <= 54.2 else 0.0)
    )
    return round(float(np.clip(_sigmoid(logit), 0.08, 0.97)), 3)


def _state_score_concede_probs(x_m: float, y_m: float, attack_right: bool) -> tuple[float, float]:
    """Return (P_score, P_concede) for possessing the ball at (x_m, y_m)."""
    ax = x_m if attack_right else (105.0 - x_m)
    p_score = compute_xt_value(ax, y_m)
    # Concede risk rises when possessing deep in own defensive third near center
    own_danger = compute_xt_value(105.0 - ax, y_m) * 0.42
    return float(p_score), float(own_danger)


def compute_obv_delta(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    attack_right: bool,
    retained_possession: bool = True,
) -> dict[str, float]:
    """Compute On-Ball Value (OBV) = (P_score_after - P_score_before) - (P_concede_after - P_concede_before)."""
    ps0, pc0 = _state_score_concede_probs(x1, y1, attack_right)
    if retained_possession:
        ps1, pc1 = _state_score_concede_probs(x2, y2, attack_right)
    else:
        # Turnover flips possession to opponent at (x2, y2)
        opp_ps, _ = _state_score_concede_probs(x2, y2, not attack_right)
        ps1, pc1 = 0.0, opp_ps
    obv = (ps1 - ps0) - (pc1 - pc0)
    return {
        "obv": round(float(obv), 4),
        "delta_score": round(float(ps1 - ps0), 4),
        "delta_concede": round(float(pc1 - pc0), 4),
    }


def _count_defenders_in_lane(
    x1: float, y1: float, x2: float, y2: float, defenders_xy: list[tuple[float, float]], corridor_m: float = 2.6
) -> int:
    vx, vy = x2 - x1, y2 - y1
    seg_len2 = vx * vx + vy * vy
    if seg_len2 < 1.0:
        return 0
    cnt = 0
    for dx, dy in defenders_xy:
        t = ((dx - x1) * vx + (dy - y1) * vy) / seg_len2
        if 0.08 <= t <= 0.92:
            proj_x = x1 + t * vx
            proj_y = y1 + t * vy
            if math.hypot(dx - proj_x, dy - proj_y) <= corridor_m:
                cnt += 1
    return cnt


def analyze_match_advanced_events(
    v8_df: pd.DataFrame,
    team_a_name: str,
    team_b_name: str,
    team_a_attacks_right: bool = True,
) -> dict[str, Any]:
    """Extract deterministic Pass xPass, Carry/Pass OBV, and Defensive Responsibility from tracking Parquet."""
    if v8_df.empty:
        return {
            "passes_detected": 0,
            "carries_detected": 0,
            "team_summary": {},
            "top_obv_players": [],
            "defensive_responsibility_alerts": [],
            "recent_passes": [],
        }

    # Build lightweight per-frame carrier & player lookup (sample every 2nd frame for snappy sub-30ms run)
    fids = sorted(int(f) for f in v8_df["frame_id"].unique())
    sampled_fids = fids[::2] if len(fids) > 120 else fids

    frame_carriers: list[dict[str, Any]] = []
    def_alerts: list[dict[str, Any]] = []
    seen_alert_sec: set[int] = set()

    for fid in sampled_fids:
        sub = v8_df[v8_df["frame_id"] == fid]
        players = sub[sub["role"].isin(["player", "goalkeeper"])].dropna(subset=["x_m", "y_m"])
        if len(players) < 4:
            continue
        ball_rows = sub[sub["role"] == "ball"].dropna(subset=["x_m", "y_m"])
        if not ball_rows.empty:
            bx = float(ball_rows.iloc[0]["x_m"])
            by = float(ball_rows.iloc[0]["y_m"])
        else:
            bx = float(players["x_m"].median())
            by = float(players["y_m"].median())

        t_s = float(sub["time_s"].iloc[0]) if "time_s" in sub.columns else fid / 25.0
        pxs = players["x_m"].to_numpy(dtype=np.float64)
        pys = players["y_m"].to_numpy(dtype=np.float64)
        dists = np.hypot(pxs - bx, pys - by)
        min_idx = int(np.argmin(dists))
        if dists[min_idx] <= 4.8:
            c_row = players.iloc[min_idx]
            c_team = str(c_row["team"])
            if c_team in ("team_a", "team_b"):
                opps = players[players["team"] != c_team]
                opp_xy = [(float(r["x_m"]), float(r["y_m"])) for _, r in opps.iterrows()]
                press_m = min((math.hypot(ox - float(c_row["x_m"]), oy - float(c_row["y_m"])) for ox, oy in opp_xy), default=12.0)
                frame_carriers.append(
                    {
                        "frame_id": fid,
                        "time_s": round(t_s, 2),
                        "track_id": int(c_row["track_id"]),
                        "team": c_team,
                        "x_m": float(c_row["x_m"]),
                        "y_m": float(c_row["y_m"]),
                        "press_m": round(press_m, 1),
                        "opp_xy": opp_xy,
                        "label": str(c_row.get("verified_name") or f"#{int(c_row['track_id'])}"),
                    }
                )

                # Defensive Responsibility check inside dangerous attacking zone (Zone 14 or Box)
                att_r = team_a_attacks_right if c_team == "team_a" else (not team_a_attacks_right)
                cx_att = float(c_row["x_m"]) if att_r else (105.0 - float(c_row["x_m"]))
                sec_bucket = int(t_s // 3)
                if cx_att >= 72.0 and press_m >= 4.2 and sec_bucket not in seen_alert_sec and len(opps) > 0:
                    seen_alert_sec.add(sec_bucket)
                    opp_dists = [
                        (math.hypot(float(r["x_m"]) - float(c_row["x_m"]), float(r["y_m"]) - float(c_row["y_m"])), r)
                        for _, r in opps.iterrows()
                    ]
                    nearest_d, resp_row = min(opp_dists, key=lambda kv: kv[0])
                    resp_score = round(float(np.clip((nearest_d - 2.0) * 14.0, 25.0, 98.0)), 1)
                    def_alerts.append(
                        {
                            "time_s": round(t_s, 1),
                            "frame_id": fid,
                            "defender_track_id": int(resp_row["track_id"]),
                            "defender_label": str(resp_row.get("verified_name") or f"#{int(resp_row['track_id'])}"),
                            "defending_team": str(resp_row["team"]),
                            "gap_m": round(nearest_d, 1),
                            "responsibility_pct": resp_score,
                            "note_ar": f"تأخر إغلاق المساحة ({nearest_d:.1f}م) أمام {c_row.get('verified_name') or '#' + str(int(c_row['track_id']))} داخل الثلث الخطير",
                            "note_en": f"Delayed closure ({nearest_d:.1f}m gap) in danger zone",
                        }
                    )

    # Detect Passes & Carries from carrier transitions
    passes: list[dict[str, Any]] = []
    carries_count = 0
    player_obv: dict[tuple[str, int], dict[str, Any]] = {}

    def _acc(team: str, tid: int, lbl: str) -> dict[str, Any]:
        key = (team, tid)
        if key not in player_obv:
            player_obv[key] = {
                "track_id": tid,
                "team": team,
                "team_name": team_a_name if team == "team_a" else team_b_name,
                "label": lbl,
                "obv_total": 0.0,
                "pass_obv": 0.0,
                "carry_obv": 0.0,
                "passes_attempted": 0,
                "passes_completed": 0,
                "xpass_sum": 0.0,
            }
        return player_obv[key]

    for a, b in zip(frame_carriers, frame_carriers[1:]):
        dt = b["time_s"] - a["time_s"]
        if dt <= 0 or dt > 3.5:
            continue
        dist = math.hypot(b["x_m"] - a["x_m"], b["y_m"] - a["y_m"])
        att_r = team_a_attacks_right if a["team"] == "team_a" else (not team_a_attacks_right)
        rec = _acc(a["team"], a["track_id"], a["label"])

        if a["track_id"] == b["track_id"] and dist >= 3.0:
            # Progressive Carry
            carries_count += 1
            obv_res = compute_obv_delta(a["x_m"], a["y_m"], b["x_m"], b["y_m"], att_r, True)
            rec["carry_obv"] += obv_res["obv"]
            rec["obv_total"] += obv_res["obv"]
        elif a["track_id"] != b["track_id"] and dist >= 3.5:
            completed = a["team"] == b["team"]
            lane_defs = _count_defenders_in_lane(a["x_m"], a["y_m"], b["x_m"], b["y_m"], a["opp_xy"])
            xp = compute_xpass_probability(a["x_m"], a["y_m"], b["x_m"], b["y_m"], att_r, a["press_m"], lane_defs)
            obv_res = compute_obv_delta(a["x_m"], a["y_m"], b["x_m"], b["y_m"], att_r, completed)
            rec["passes_attempted"] += 1
            rec["passes_completed"] += 1 if completed else 0
            rec["xpass_sum"] += xp
            rec["pass_obv"] += obv_res["obv"]
            rec["obv_total"] += obv_res["obv"]
            passes.append(
                {
                    "time_s": b["time_s"],
                    "from_label": a["label"],
                    "to_label": b["label"],
                    "team": a["team"],
                    "distance_m": round(dist, 1),
                    "completed": completed,
                    "xpass": xp,
                    "obv": obv_res["obv"],
                    "lane_defenders": lane_defs,
                }
            )

    # Summarize per-team & top OBV/CxP players
    team_summary = {}
    for tk, tname in (("team_a", team_a_name), ("team_b", team_b_name)):
        tp = [p for p in passes if p["team"] == tk]
        att = len(tp)
        comp = sum(1 for p in tp if p["completed"])
        exp_comp = sum(p["xpass"] for p in tp)
        obv_sum = sum(v["obv_total"] for (tm, _), v in player_obv.items() if tm == tk)
        team_summary[tk] = {
            "team_name": tname,
            "passes_attempted": att,
            "passes_completed": comp,
            "pass_accuracy_pct": round((comp / att) * 100.0, 1) if att else 0.0,
            "expected_pass_pct": round((exp_comp / att) * 100.0, 1) if att else 0.0,
            "cxp_above_expected_pct": round(((comp - exp_comp) / att) * 100.0, 1) if att else 0.0,
            "net_obv": round(obv_sum, 4),
        }

    top_players = []
    for v in player_obv.values():
        att = v["passes_attempted"]
        cxp = round(((v["passes_completed"] - v["xpass_sum"]) / att) * 100.0, 1) if att else 0.0
        top_players.append(
            {
                **v,
                "obv_total": round(v["obv_total"], 4),
                "pass_obv": round(v["pass_obv"], 4),
                "carry_obv": round(v["carry_obv"], 4),
                "xpass_avg_pct": round((v["xpass_sum"] / att) * 100.0, 1) if att else 0.0,
                "cxp_pct": cxp,
            }
        )
    top_players.sort(key=lambda x: x["obv_total"], reverse=True)

    return {
        "passes_detected": len(passes),
        "carries_detected": carries_count,
        "team_summary": team_summary,
        "top_obv_players": top_players[:10],
        "defensive_responsibility_alerts": def_alerts[:8],
        "recent_passes": passes[:12],
    }
