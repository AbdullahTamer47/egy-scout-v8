"""V4.0 Pro Dynamic Tactical Intelligence & Coaching Analytics Engine.

Implements:
- 4-Phase Game State Detector (In-Possession, Positive Transition, Out-of-Possession Block, Negative Transition)
- Hungarian-Matched Canonical Football Formation Recognition (4-2-3-1, 4-3-3, 3-2-4-1, 2-3-5, etc.)
- Team-Relative Positional Fluidity vs Discipline Index
- Real-Time Passing Lanes & Cover Shadows (xPass %, perpendicular margin, line-breaking detection)
- Accurate Egyptian Tactical Doctor (Effective Play Time, Tempo, Hold Spells, Second-Ball, Fatigue, Low-Block Breaker)
- Head Coach Pro KPIs (xG, xT, PPDA, Field Tilt %, Passing Network, 18-Zone Control incl. Zone 14, Automated Match Plan)
"""
from __future__ import annotations

from collections import Counter

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from scipy.spatial import Delaunay

from core.config import PITCH_LENGTH, PITCH_WIDTH

# Normalized 10-outfielder tactical formation templates in (depth [0=GK -> 1=OppGK], width [0=Left -> 1=Right])
FORMATION_TEMPLATES: dict[str, tuple[list[int], list[tuple[float, float]]]] = {
    "4-2-3-1": (
        [4, 2, 3, 1],
        [
            (0.24, 0.14), (0.20, 0.38), (0.20, 0.62), (0.24, 0.86),
            (0.45, 0.36), (0.45, 0.64),
            (0.67, 0.18), (0.65, 0.50), (0.67, 0.82),
            (0.86, 0.50),
        ],
    ),
    "4-3-3": (
        [4, 3, 3],
        [
            (0.24, 0.14), (0.20, 0.38), (0.20, 0.62), (0.24, 0.86),
            (0.46, 0.50), (0.55, 0.30), (0.55, 0.70),
            (0.80, 0.17), (0.86, 0.50), (0.80, 0.83),
        ],
    ),
    "4-4-2": (
        [4, 4, 2],
        [
            (0.24, 0.14), (0.20, 0.38), (0.20, 0.62), (0.24, 0.86),
            (0.54, 0.15), (0.50, 0.38), (0.50, 0.62), (0.54, 0.85),
            (0.84, 0.37), (0.84, 0.63),
        ],
    ),
    "4-1-4-1": (
        [4, 1, 4, 1],
        [
            (0.24, 0.14), (0.20, 0.38), (0.20, 0.62), (0.24, 0.86),
            (0.40, 0.50),
            (0.62, 0.15), (0.58, 0.38), (0.58, 0.62), (0.62, 0.85),
            (0.86, 0.50),
        ],
    ),
    "3-2-4-1": (
        [3, 2, 4, 1],
        [
            (0.22, 0.26), (0.20, 0.50), (0.22, 0.74),
            (0.44, 0.36), (0.44, 0.64),
            (0.68, 0.13), (0.64, 0.37), (0.64, 0.63), (0.68, 0.87),
            (0.87, 0.50),
        ],
    ),
    "3-4-2-1": (
        [3, 4, 2, 1],
        [
            (0.20, 0.26), (0.18, 0.50), (0.20, 0.74),
            (0.48, 0.14), (0.45, 0.38), (0.45, 0.62), (0.48, 0.86),
            (0.68, 0.34), (0.68, 0.66),
            (0.86, 0.50),
        ],
    ),
    "3-5-2": (
        [3, 5, 2],
        [
            (0.20, 0.26), (0.18, 0.50), (0.20, 0.74),
            (0.48, 0.13), (0.44, 0.34), (0.48, 0.50), (0.44, 0.66), (0.48, 0.87),
            (0.83, 0.36), (0.83, 0.64),
        ],
    ),
    "5-3-2": (
        [5, 3, 2],
        [
            (0.25, 0.12), (0.20, 0.32), (0.18, 0.50), (0.20, 0.68), (0.25, 0.88),
            (0.50, 0.30), (0.47, 0.50), (0.50, 0.70),
            (0.82, 0.37), (0.82, 0.63),
        ],
    ),
    "5-4-1": (
        [5, 4, 1],
        [
            (0.24, 0.12), (0.20, 0.32), (0.18, 0.50), (0.20, 0.68), (0.24, 0.88),
            (0.52, 0.16), (0.49, 0.38), (0.49, 0.62), (0.52, 0.84),
            (0.82, 0.50),
        ],
    ),
    "2-3-5": (
        [2, 3, 5],
        [
            (0.24, 0.35), (0.24, 0.65),
            (0.48, 0.25), (0.46, 0.50), (0.48, 0.75),
            (0.76, 0.12), (0.72, 0.32), (0.84, 0.50), (0.72, 0.68), (0.76, 0.88),
        ],
    ),
    "3-2-5": (
        [3, 2, 5],
        [
            (0.24, 0.28), (0.22, 0.50), (0.24, 0.72),
            (0.48, 0.36), (0.48, 0.64),
            (0.76, 0.12), (0.72, 0.33), (0.86, 0.50), (0.72, 0.67), (0.76, 0.88),
        ],
    ),
    "3-4-3": (
        [3, 4, 3],
        [
            (0.22, 0.27), (0.20, 0.50), (0.22, 0.73),
            (0.50, 0.14), (0.48, 0.38), (0.48, 0.62), (0.50, 0.86),
            (0.80, 0.20), (0.86, 0.50), (0.80, 0.80),
        ],
    ),
}

DEFENSIVE_CANDIDATES = ["4-2-3-1", "4-3-3", "4-4-2", "4-1-4-1", "5-3-2", "5-4-1", "3-4-2-1", "3-5-2"]
ATTACKING_CANDIDATES = ["3-2-4-1", "4-3-3", "4-2-3-1", "2-3-5", "3-2-5", "3-4-3", "3-5-2", "4-4-2"]


def _partition_counts(n_players: int, template_counts: list[int]) -> list[int]:
    """Scale template line counts smoothly when fewer than 10 outfielders are visible in a broadcast frame."""
    if n_players >= 10:
        return list(template_counts)
    scaled = [max(1, int(round(c * n_players / 10.0))) for c in template_counts]
    while sum(scaled) > n_players:
        idx = int(np.argmax(scaled))
        if scaled[idx] > 1:
            scaled[idx] -= 1
        else:
            scaled.pop()
    while sum(scaled) < n_players and scaled:
        idx = int(np.argmin(scaled))
        scaled[idx] += 1
    return scaled


class DynamicTacticalIntelligence:
    """Computes phase-aware tactical structures, passing lanes, fluidity/discipline, and pro coaching KPIs."""

    def __init__(self, pitch_length: float = PITCH_LENGTH, pitch_width: float = PITCH_WIDTH):
        self.L = float(pitch_length)
        self.W = float(pitch_width)

    def detect_dynamic_formation(
        self,
        xy_outfield: np.ndarray,
        attack_dir: int = 1,
        is_in_possession: bool | None = None,
    ) -> dict:
        """Identify authentic football formation via 2D Hungarian template matching and build real unit chains."""
        if xy_outfield is None or len(xy_outfield) < 4:
            return {
                "formation_str": "4-2-3-1",
                "lines": [],
                "line_heights_m": [],
                "def_line_sync_std": 0.0,
                "team_width_m": 0.0,
                "team_length_m": 0.0,
                "delaunay_edges": [],
                "gaps_gt_16m": [],
            }

        pts = np.asarray(xy_outfield, dtype=np.float64).copy()
        if attack_dir == -1:
            pts[:, 0] = self.L - pts[:, 0]
            pts[:, 1] = self.W - pts[:, 1]

        # Exclude deepest goalkeeper if > 10 players or deep inside box region
        order_x = np.argsort(pts[:, 0])
        if len(pts) > 10 or (len(pts) >= 7 and pts[order_x[0], 0] < 18.0 and (pts[order_x[1], 0] - pts[order_x[0], 0]) > 4.5):
            outfield_idx = order_x[1:11]
        else:
            outfield_idx = order_x[:10]
        outfield_pts = pts[outfield_idx]

        if len(outfield_pts) < 4:
            return {
                "formation_str": "4-2-3-1",
                "lines": [],
                "line_heights_m": [],
                "def_line_sync_std": 0.0,
                "team_width_m": 0.0,
                "team_length_m": 0.0,
                "delaunay_edges": [],
                "gaps_gt_16m": [],
            }

        # Normalize visible outfielder block to [0..1] x [0..1]
        min_x, max_x = float(outfield_pts[:, 0].min()), float(outfield_pts[:, 0].max())
        min_y, max_y = float(outfield_pts[:, 1].min()), float(outfield_pts[:, 1].max())
        span_x = max(18.0, max_x - min_x)
        span_y = max(16.0, max_y - min_y)
        cx_mid, cy_mid = 0.5 * (min_x + max_x), 0.5 * (min_y + max_y)

        norm_d = np.clip(0.5 + ((outfield_pts[:, 0] - cx_mid) / span_x) * 0.72, 0.08, 0.92)
        norm_w = np.clip(0.5 + ((outfield_pts[:, 1] - cy_mid) / span_y) * 0.78, 0.08, 0.92)
        norm_obs = np.column_stack([norm_d, norm_w])

        if is_in_possession is True:
            cand_names = ATTACKING_CANDIDATES
        elif is_in_possession is False:
            cand_names = DEFENSIVE_CANDIDATES
        else:
            cand_names = list(FORMATION_TEMPLATES.keys())

        best_name = cand_names[0]
        best_cost = 1e9
        for fname in cand_names:
            _, tmpl_coords = FORMATION_TEMPLATES[fname]
            tmpl_arr = np.asarray(tmpl_coords, dtype=np.float64)
            # Cost matrix: [n_obs x 10] emphasizing longitudinal depth structure
            dx_mat = norm_obs[:, 0:1] - tmpl_arr[:, 0:1].T
            dy_mat = norm_obs[:, 1:2] - tmpl_arr[:, 1:2].T
            cost = np.sqrt((1.35 * dx_mat) ** 2 + dy_mat**2)
            r_ind, c_ind = linear_sum_assignment(cost)
            mean_cost = float(cost[r_ind, c_ind].sum()) / max(1, len(r_ind))
            # Mild prior preferring standard formations unless shape strongly fits back-5 / 2-3-5
            prior = -0.015 if fname in ("4-2-3-1", "4-3-3", "4-4-2", "3-2-4-1") else 0.0
            total_c = mean_cost + prior
            if total_c < best_cost:
                best_cost = total_c
                best_name = fname

        tmpl_counts, _ = FORMATION_TEMPLATES[best_name]
        counts = _partition_counts(len(outfield_pts), tmpl_counts)

        # Partition depth-sorted outfield points into the formation's tactical lines
        depth_sorted = np.argsort(outfield_pts[:, 0])
        line_groups: list[np.ndarray] = []
        cursor = 0
        for cnt in counts:
            if cursor >= len(depth_sorted):
                break
            line_groups.append(depth_sorted[cursor : cursor + cnt])
            cursor += cnt

        line_heights = [round(float(outfield_pts[grp, 0].mean()), 1) for grp in line_groups if len(grp) > 0]
        deepest = line_groups[0] if line_groups else np.array([0])
        def_sync_std = float(np.std(outfield_pts[deepest, 0])) if len(deepest) >= 2 else 0.0

        # Build unit line chains sorted laterally (Y-axis) in original pitch coordinates
        unit_chains: list[list[list[float]]] = []
        gaps_gt_16m: list[dict] = []
        for l_idx, grp in enumerate(line_groups):
            line_pts = outfield_pts[grp].copy()
            y_order = np.argsort(line_pts[:, 1])
            sorted_pts = line_pts[y_order]
            if attack_dir == -1:
                sorted_pts[:, 0] = self.L - sorted_pts[:, 0]
                sorted_pts[:, 1] = self.W - sorted_pts[:, 1]
            chain = [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in sorted_pts]
            unit_chains.append(chain)
            for k in range(len(sorted_pts) - 1):
                gap_m = float(np.linalg.norm(sorted_pts[k + 1] - sorted_pts[k]))
                if gap_m > 16.0:
                    gaps_gt_16m.append(
                        {
                            "line_index": l_idx,
                            "from_m": chain[k],
                            "to_m": chain[k + 1],
                            "distance_m": round(gap_m, 1),
                        }
                    )

        orig_pts = outfield_pts.copy()
        if attack_dir == -1:
            orig_pts[:, 0] = self.L - orig_pts[:, 0]
            orig_pts[:, 1] = self.W - orig_pts[:, 1]
        delaunay_edges: list[list[list[float]]] = []
        if len(orig_pts) >= 4:
            try:
                tri = Delaunay(orig_pts)
                seen = set()
                for simplex in tri.simplices:
                    for a, b in ((0, 1), (1, 2), (2, 0)):
                        i1, i2 = int(simplex[a]), int(simplex[b])
                        edge_key = (min(i1, i2), max(i1, i2))
                        if edge_key not in seen:
                            seen.add(edge_key)
                            dist = float(np.linalg.norm(orig_pts[i1] - orig_pts[i2]))
                            if dist <= 32.0:
                                delaunay_edges.append(
                                    [
                                        [round(float(orig_pts[i1, 0]), 2), round(float(orig_pts[i1, 1]), 2)],
                                        [round(float(orig_pts[i2, 0]), 2), round(float(orig_pts[i2, 1]), 2)],
                                    ]
                                )
            except Exception:
                pass

        return {
            "formation_str": best_name,
            "lines": unit_chains,
            "line_heights_m": line_heights,
            "def_line_sync_std": round(def_sync_std, 2),
            "team_width_m": round(float(outfield_pts[:, 1].max() - outfield_pts[:, 1].min()), 1),
            "team_length_m": round(float(outfield_pts[:, 0].max() - outfield_pts[:, 0].min()), 1),
            "delaunay_edges": delaunay_edges,
            "gaps_gt_16m": gaps_gt_16m,
        }

    def classify_frame_game_state(
        self,
        poss_team: int | None,
        team_frames_since_gain: dict[int, float],
        team_frames_since_loss: dict[int, float],
        ball_vx: float,
        ball_x: float,
        team_centroids_x: dict[int, float],
        attack_dirs: dict[int, int],
        opponents_xy_by_team: dict[int, np.ndarray],
        team_xy_by_team: dict[int, np.ndarray],
    ) -> dict[int, dict]:
        """Classify each team into the 4 moments of football + Rest Defense & Block Height."""
        out: dict[int, dict] = {}
        for t in (0, 1):
            adir = attack_dirs.get(t, 1 if t == 0 else -1)
            t_pts = team_xy_by_team.get(t, np.empty((0, 2)))
            cent_x = team_centroids_x.get(t, 52.5)
            norm_cent_x = cent_x if adir == 1 else (self.L - cent_x)

            # Evaluate defensive block using deepest outfield defensive line depth (excludes GK)
            if len(t_pts) >= 3:
                norm_xs = np.sort(t_pts[:, 0] if adir == 1 else (self.L - t_pts[:, 0]))
                # Second deepest is first outfield defender if GK present
                def_line_x = float(norm_xs[1] if (len(norm_xs) > 4 and norm_xs[0] < 16.0) else norm_xs[0])
            else:
                def_line_x = norm_cent_x - 12.0

            if def_line_x >= 44.0 or norm_cent_x >= 60.0:
                block_ar = "ضغط عالي"
                block_code = "high_press"
            elif def_line_x >= 28.0:
                block_ar = "كتلة متوسطة"
                block_code = "mid_block"
            else:
                block_ar = "تكتل دفاعي منخفض"
                block_code = "low_block"

            if len(t_pts) > 0:
                behind = t_pts[t_pts[:, 0] < ball_x - 2.0] if adir == 1 else t_pts[t_pts[:, 0] > ball_x + 2.0]
                rest_def_count = int(len(behind))
                rest_def_width = round(float(behind[:, 1].max() - behind[:, 1].min()), 1) if len(behind) >= 2 else 0.0
            else:
                rest_def_count, rest_def_width = 0, 0.0

            t_gain = team_frames_since_gain.get(t, 999.0)
            t_loss = team_frames_since_loss.get(t, 999.0)
            fwd_ball_vx = ball_vx * adir

            if poss_team == t:
                if t_gain <= 6.0 and fwd_ball_vx > 3.2:
                    phase = "positive_transition"
                    phase_ar = "تحول هجومي سريع"
                else:
                    phase = "in_possession"
                    phase_ar = "بناء واستحواذ منظم"
            else:
                if t_loss <= 5.0:
                    phase = "negative_transition"
                    phase_ar = "تحول دفاعي وارتداد"
                else:
                    phase = "out_of_possession"
                    phase_ar = f"دفاع منظم ({block_ar})"

            out[t] = {
                "phase": phase,
                "phase_ar": phase_ar,
                "block_code": block_code,
                "block_ar": block_ar,
                "def_line_height_m": round(def_line_x, 1),
                "centroid_depth_m": round(float(norm_cent_x), 1),
                "rest_defense_players": rest_def_count,
                "rest_defense_width_m": rest_def_width,
            }
        return out

    def compute_phase_formations(
        self,
        df_players: pd.DataFrame,
        frame_poss: dict[int, int | None],
        attack_dirs: dict[int, int],
        frame_formations: dict[int, dict[int, dict]] | None = None,
    ) -> dict[int, dict]:
        """Compute Phase-Split In-Possession vs Out-of-Possession formations and bout-accurate Role Shifts."""
        results: dict[int, dict] = {}
        for t in (0, 1):
            adir = attack_dirs.get(t, 1 if t == 0 else -1)
            sub_t = df_players[df_players["team_cluster"] == t]
            if sub_t.empty:
                results[t] = {
                    "in_possession_formation": "4-2-3-1",
                    "out_of_possession_formation": "4-4-2",
                    "in_possession_details": {},
                    "out_of_possession_details": {},
                    "role_shifts": [],
                }
                continue

            in_frames = [fid for fid, pt in frame_poss.items() if pt == t]
            out_frames = [fid for fid, pt in frame_poss.items() if pt == (1 - t)]

            def _mean_xy_for_frames(fids: list[int]) -> tuple[np.ndarray, pd.DataFrame]:
                if not fids:
                    return np.empty((0, 2)), pd.DataFrame()
                part = sub_t[sub_t["frame_id"].isin(fids)]
                if part.empty:
                    return np.empty((0, 2)), pd.DataFrame()
                med = part.groupby("identity_key")[["x_smooth", "y_smooth"]].median().reset_index()
                if len(med) > 11:
                    counts = part.groupby("identity_key")["frame_id"].count().reindex(med["identity_key"]).values
                    top_idx = np.argsort(counts)[-11:]
                    med = med.iloc[top_idx]
                return med[["x_smooth", "y_smooth"]].to_numpy(dtype=np.float64), med

            all_fids = sorted(sub_t["frame_id"].unique().tolist())
            in_xy, in_df = _mean_xy_for_frames(in_frames)
            out_xy, out_df = _mean_xy_for_frames(out_frames)
            if len(in_xy) < 4:
                in_xy, in_df = _mean_xy_for_frames(all_fids)
            if len(out_xy) < 4:
                out_xy, out_df = in_xy.copy(), in_df.copy()

            in_form = self.detect_dynamic_formation(in_xy, attack_dir=adir, is_in_possession=True)
            out_form = self.detect_dynamic_formation(out_xy, attack_dir=adir, is_in_possession=False)

            # Use modal frame classification if plentiful frames exist for greater stability
            if frame_formations:
                in_votes = [
                    frame_formations[f][t]["formation_str"]
                    for f in in_frames
                    if f in frame_formations and t in frame_formations[f]
                ]
                out_votes = [
                    frame_formations[f][t]["formation_str"]
                    for f in out_frames
                    if f in frame_formations and t in frame_formations[f]
                ]
                if len(in_votes) >= 12:
                    in_form["formation_str"] = Counter(in_votes).most_common(1)[0][0]
                if len(out_votes) >= 12:
                    out_form["formation_str"] = Counter(out_votes).most_common(1)[0][0]

            role_shifts: list[dict] = []
            if not in_df.empty and not out_df.empty:
                merged = pd.merge(out_df, in_df, on="identity_key", suffixes=("_out", "_in"))
                for _, r in merged.iterrows():
                    y_out, y_in = float(r["y_smooth_out"]), float(r["y_smooth_in"])
                    x_out = float(r["x_smooth_out"]) if adir == 1 else (self.L - float(r["x_smooth_out"]))
                    x_in = float(r["x_smooth_in"]) if adir == 1 else (self.L - float(r["x_smooth_in"]))
                    if (y_out < 18.0 or y_out > 50.0) and (21.0 <= y_in <= 47.0) and x_out < 55.0:
                        role_shifts.append(
                            {
                                "identity_key": str(r["identity_key"]),
                                "role": "inverted_fullback",
                                "label_ar": "ظهير وهمي للداخل (Inverted FB)",
                            }
                        )
                    elif x_out > 62.0 and (x_out - x_in) > 8.5 and (38.0 <= x_in <= 64.0):
                        role_shifts.append(
                            {
                                "identity_key": str(r["identity_key"]),
                                "role": "dropping_false_9",
                                "label_ar": "مهاجم ساقط بين الخطوط (False-9)",
                            }
                        )

            # Distinct sprint bouts (>21.5 km/h) per identity (rising-edge count, not frame count!)
            sprint_bouts: list[tuple[str, int]] = []
            for id_key, grp in sub_t.sort_values("frame_id").groupby("identity_key"):
                flag = (grp["speed_kmh"].to_numpy() > 21.5).astype(int)
                bouts = int(np.sum(np.diff(flag, prepend=0) == 1))
                if bouts >= 2:
                    sprint_bouts.append((str(id_key), bouts))
            sprint_bouts.sort(key=lambda x: x[1], reverse=True)
            for id_key, bouts in sprint_bouts[:2]:
                role_shifts.append(
                    {
                        "identity_key": id_key,
                        "role": "third_man_run",
                        "label_ar": f"اللاعب الثالث المخترق ({bouts} انطلاقات سريعة)",
                    }
                )

            results[t] = {
                "in_possession_formation": in_form["formation_str"],
                "out_of_possession_formation": out_form["formation_str"],
                "in_possession_details": in_form,
                "out_of_possession_details": out_form,
                "role_shifts": role_shifts[:6],
            }
        return results

    def compute_passing_lanes_and_shadows(
        self,
        carrier_xy: np.ndarray,
        teammates_xy: np.ndarray,
        teammate_ids: list[int],
        opponents_xy: np.ndarray,
        attack_dir: int = 1,
    ) -> dict:
        """Calculate opponent Cover Shadow cones and rank open/line-breaking passing lanes by xPass %."""
        lanes: list[dict] = []
        shadows: list[dict] = []

        if carrier_xy is None or len(carrier_xy) < 2:
            return {"passing_lanes": [], "cover_shadows": []}

        c_xy = np.asarray(carrier_xy, dtype=np.float64)
        opps = np.asarray(opponents_xy, dtype=np.float64) if len(opponents_xy) > 0 else np.empty((0, 2))
        tms = np.asarray(teammates_xy, dtype=np.float64) if len(teammates_xy) > 0 else np.empty((0, 2))

        for opp in opps:
            vec = opp - c_xy
            dist = float(np.linalg.norm(vec))
            if 1.0 < dist < 24.0:
                unit_v = vec / dist
                perp_v = np.array([-unit_v[1], unit_v[0]])
                shadow_length = min(18.0, 28.0 - dist * 0.6)
                half_width = 1.8 + 0.22 * shadow_length
                far_center = opp + unit_v * shadow_length
                shadows.append(
                    {
                        "polygon_m": [
                            [round(float(opp[0]), 2), round(float(opp[1]), 2)],
                            [round(float(far_center[0] + perp_v[0] * half_width), 2), round(float(far_center[1] + perp_v[1] * half_width), 2)],
                            [round(float(far_center[0] - perp_v[0] * half_width), 2), round(float(far_center[1] - perp_v[1] * half_width), 2)],
                        ]
                    }
                )

        opp_x_sorted = np.sort(opps[:, 0]) if len(opps) > 0 else np.array([])

        for tid, tm_xy in zip(teammate_ids, tms):
            pass_vec = tm_xy - c_xy
            pass_dist = float(np.linalg.norm(pass_vec))
            if pass_dist < 2.5 or pass_dist > 48.0:
                continue

            pass_dir = pass_vec / pass_dist
            min_margin = 99.0
            for opp in opps:
                to_opp = opp - c_xy
                proj = float(np.dot(to_opp, pass_dir))
                if 0.5 < proj < pass_dist - 0.5:
                    closest_pt = c_xy + proj * pass_dir
                    perp_dist = float(np.linalg.norm(opp - closest_pt))
                    opp_reach_time = max(0.0, (perp_dist - 1.1) / 6.5)
                    time_at_proj = proj / 18.5
                    margin = opp_reach_time - time_at_proj
                    if margin < min_margin:
                        min_margin = margin

            xpass_prob = float(1.0 / (1.0 + np.exp(-3.2 * (min_margin + 0.15))))
            dx_prog = float((tm_xy[0] - c_xy[0]) * attack_dir)

            if len(opp_x_sorted) > 0:
                if attack_dir == 1:
                    bypassed = int(np.sum((opp_x_sorted > c_xy[0] + 1.5) & (opp_x_sorted < tm_xy[0] - 1.0)))
                else:
                    bypassed = int(np.sum((opp_x_sorted < c_xy[0] - 1.5) & (opp_x_sorted > tm_xy[0] + 1.0)))
            else:
                bypassed = 0

            is_line_breaking = bool(dx_prog > 7.5 and bypassed >= 2 and xpass_prob >= 0.48)
            lane_status = "line_breaking" if is_line_breaking else ("safe_open" if xpass_prob >= 0.68 else "blocked")
            xt_gain = round(max(0.0, (dx_prog / 20.0) * 0.05 + bypassed * 0.025), 3)

            lanes.append(
                {
                    "target_track_id": int(tid),
                    "from_m": [round(float(c_xy[0]), 2), round(float(c_xy[1]), 2)],
                    "to_m": [round(float(tm_xy[0]), 2), round(float(tm_xy[1]), 2)],
                    "distance_m": round(pass_dist, 1),
                    "xpass_pct": round(xpass_prob * 100.0, 1),
                    "xt_gain": xt_gain,
                    "opponents_bypassed": bypassed,
                    "is_line_breaking": is_line_breaking,
                    "status": lane_status,
                    "tactical_value_score": round(xpass_prob * (1.0 + 0.35 * bypassed + max(0.0, dx_prog / 15.0)), 3),
                }
            )

        lanes.sort(key=lambda x: x["tactical_value_score"], reverse=True)
        return {"passing_lanes": lanes[:4], "cover_shadows": shadows[:6]}

    def evaluate_fluidity_vs_discipline(self, df_team_tracks: pd.DataFrame) -> dict:
        """Separate coordinated rotations (Fluidity) from uncovered positional abandonment using team-relative coordinates."""
        if df_team_tracks.empty:
            return {"team_fluidity_score": 62.0, "team_discipline_score": 74.0, "player_roles": {}}

        key_col = "identity_key" if "identity_key" in df_team_tracks.columns else "track_id"
        df = df_team_tracks.copy()
        team_cent = df.groupby("frame_id")[["x_smooth", "y_smooth"]].transform("mean")
        df["rel_x"] = df["x_smooth"] - team_cent["x_smooth"]
        df["rel_y"] = df["y_smooth"] - team_cent["y_smooth"]

        anchors = df.groupby(key_col)[["rel_x", "rel_y"]].median().to_dict("index")
        player_metrics: dict[str, dict] = {}

        for id_val, group in df.groupby(key_col):
            ax, ay = float(anchors[id_val]["rel_x"]), float(anchors[id_val]["rel_y"])
            deviations = np.sqrt((group["rel_x"] - ax) ** 2 + (group["rel_y"] - ay) ** 2)
            roaming_radius_m = float(np.percentile(deviations, 75)) if len(deviations) > 0 else 0.0

            away_frames = group[deviations > 7.5]["frame_id"].values
            covered_count = 0
            if len(away_frames) > 0:
                sub = df[df["frame_id"].isin(away_frames) & (df[key_col] != id_val)]
                if not sub.empty:
                    dist_to_anchor = np.sqrt((sub["rel_x"] - ax) ** 2 + (sub["rel_y"] - ay) ** 2)
                    covered_count = int(sub[dist_to_anchor < 7.2]["frame_id"].nunique())

            rotation_coverage_ratio = (covered_count / len(away_frames)) if len(away_frames) > 0 else 0.72
            fluidity = min(94.0, max(38.0, 38.0 + roaming_radius_m * 3.1 * (0.45 + 0.55 * rotation_coverage_ratio)))
            discipline = min(
                94.0,
                max(42.0, 92.0 - max(0.0, roaming_radius_m - 6.0) * 3.4 * (1.0 - 0.65 * rotation_coverage_ratio)),
            )

            role_ar = (
                "حر الحركة / تبادل مراكز منظم"
                if fluidity >= 68 and discipline >= 66
                else "ملتزم تكتيكياً بوحدة الخط"
                if discipline >= 76
                else "يترك مساحات خلفه عند التقدم"
                if discipline < 58
                else "متوازن بين التدرج والتغطية"
            )
            player_metrics[str(id_val)] = {
                "roaming_radius_m": round(roaming_radius_m, 1),
                "rotation_coverage_pct": round(rotation_coverage_ratio * 100.0, 1),
                "fluidity_score": round(fluidity, 1),
                "discipline_score": round(discipline, 1),
                "tactical_role_ar": role_ar,
            }

        avg_fluidity = float(np.mean([m["fluidity_score"] for m in player_metrics.values()])) if player_metrics else 62.0
        avg_discipline = float(np.mean([m["discipline_score"] for m in player_metrics.values()])) if player_metrics else 74.0
        return {
            "team_fluidity_score": round(avg_fluidity, 1),
            "team_discipline_score": round(avg_discipline, 1),
            "player_roles": player_metrics,
        }

    def compute_egyptian_diagnostics(
        self,
        df_players: pd.DataFrame,
        df_ball: pd.DataFrame,
        events: list[dict],
        poss_frames: dict[int, int | None],
        phase_by_frame: dict[int, dict[int, dict]],
        attack_dirs: dict[int, int],
        fps: float,
    ) -> dict:
        """Compute accurate Coach Tactical Doctor metrics grounded in active play & true touch spells."""
        total_frames = max(1, df_players["frame_id"].nunique() if not df_players.empty else 1)
        frame_ids = sorted(df_players["frame_id"].unique()) if not df_players.empty else []

        # 1. Accurate Effective Play Time %: exclude cutscenes, stagnant dead balls, and slow walks
        active_frames_set: set[int] = set()
        if not df_players.empty:
            f_counts = df_players.groupby("frame_id")["identity_key"].nunique()
            f_med_spd = df_players.groupby("frame_id")["speed_kmh"].median()
            ball_spd_map = (
                df_ball.drop_duplicates("frame_id").set_index("frame_id")["speed_kmh"].to_dict()
                if (not df_ball.empty and "speed_kmh" in df_ball.columns)
                else {}
            )
            for fid in frame_ids:
                n_vis = int(f_counts.get(fid, 0))
                p_spd = float(f_med_spd.get(fid, 0.0))
                b_spd = float(ball_spd_map.get(fid, 0.0))
                if n_vis >= 8 and (p_spd >= 2.8 or b_spd >= 2.2):
                    active_frames_set.add(int(fid))

        active_frames = len(active_frames_set) if active_frames_set else max(1, int(total_frames * 0.58))
        effective_play_time_pct = round(min(92.0, max(32.0, (active_frames / total_frames) * 100.0)), 1)

        total_dur_min = max(0.15, (frame_ids[-1] - frame_ids[0]) / max(1.0, fps) / 60.0) if len(frame_ids) >= 2 else 0.5
        effective_play_min = max(0.10, total_dur_min * (effective_play_time_pct / 100.0))
        pass_events = [e for e in events if e.get("type") == "pass"]
        pass_tempo_per_min = round(len(pass_events) / effective_play_min, 1)

        # Measure continuous ball-hold touch spells per player (allowing 0.45s occlusion bridges, ignoring <0.32s blips)
        hold_streaks: dict[str, list[float]] = {}
        if not df_players.empty and not df_ball.empty:
            ball_lookup = df_ball.set_index("frame_id")[["x_smooth", "y_smooth"]].to_dict("index")
            current_holder: str | None = None
            streak_start_t: float = 0.0
            last_t: float = 0.0
            for fid in frame_ids:
                bpos = ball_lookup.get(fid)
                if not bpos:
                    continue
                sub_f = df_players[df_players["frame_id"] == fid]
                if sub_f.empty:
                    continue
                dists = np.sqrt((sub_f["x_smooth"] - bpos["x_smooth"]) ** 2 + (sub_f["y_smooth"] - bpos["y_smooth"]) ** 2)
                idx_min = int(dists.idxmin())
                min_d = float(dists.loc[idx_min])
                t_val = float(sub_f.loc[idx_min, "time_s"])
                holder_key = str(sub_f.loc[idx_min, "identity_key"]) if min_d < 4.0 else None
                if holder_key is not None and holder_key == current_holder:
                    last_t = t_val
                elif holder_key is None and current_holder is not None and (t_val - last_t) <= 0.45:
                    # Brief occlusion bridge
                    continue
                else:
                    if current_holder is not None:
                        dur = last_t - streak_start_t
                        if 0.32 <= dur <= 12.0:
                            hold_streaks.setdefault(current_holder, []).append(dur)
                    current_holder = holder_key
                    streak_start_t = t_val
                    last_t = t_val
            if current_holder is not None:
                dur = last_t - streak_start_t
                if 0.32 <= dur <= 12.0:
                    hold_streaks.setdefault(current_holder, []).append(dur)

        all_holds = [d for arr in hold_streaks.values() for d in arr]
        avg_time_on_ball_sec = round(float(np.mean(all_holds)), 2) if all_holds else 1.55
        avg_hold_by_player = {k: round(float(np.mean(v)), 2) for k, v in hold_streaks.items()}
        slow_releasers = [
            {"identity_key": k, "avg_hold_sec": v}
            for k, v in sorted(avg_hold_by_player.items(), key=lambda x: x[1], reverse=True)
            if v > 2.4
        ][:6]

        # 2. Second-Ball Win Rate (8m contested zones)
        rec_events = [e for e in events if e.get("type") == "recovery"]
        sb_wins = {0: 0, 1: 0}
        sb_zones: list[dict] = []
        if not df_players.empty:
            for ev in rec_events:
                t_c = ev.get("team_cluster")
                ex, ey = float(ev.get("x_m", 52.5)), float(ev.get("y_m", 34.0))
                fid = int(ev.get("frame_id", 0))
                near = df_players[df_players["frame_id"] == fid]
                if not near.empty and t_c in (0, 1):
                    d_arr = np.sqrt((near["x_smooth"] - ex) ** 2 + (near["y_smooth"] - ey) ** 2)
                    in_8m = near[d_arr <= 8.0]
                    if len(in_8m) >= 2:
                        sb_wins[int(t_c)] += 1
                        sb_zones.append(
                            {"x_m": round(ex, 1), "y_m": round(ey, 1), "team_cluster": int(t_c), "time_s": float(ev.get("time_s", 0))}
                        )
        total_sb = max(1, sb_wins[0] + sb_wins[1])
        second_ball_win_rate = {
            "team_0_pct": round((sb_wins[0] / total_sb) * 100.0, 1) if (sb_wins[0] + sb_wins[1]) > 0 else 50.0,
            "team_1_pct": round((sb_wins[1] / total_sb) * 100.0, 1) if (sb_wins[0] + sb_wins[1]) > 0 else 50.0,
            "contested_zones": sb_zones[:20],
        }

        # 3. Fatigue Drop-off Index (early 35% vs late 35% high-intensity speed)
        fatigue_alerts: list[dict] = []
        fatigue_dropoff_pct = 0.0
        if len(frame_ids) >= 12 and not df_players.empty:
            split_early = frame_ids[max(1, int(len(frame_ids) * 0.35))]
            split_late = frame_ids[min(len(frame_ids) - 2, int(len(frame_ids) * 0.65))]
            dropoffs = []
            for id_key, grp in df_players.groupby("identity_key"):
                early_spd = grp[grp["frame_id"] <= split_early]["speed_kmh"]
                late_spd = grp[grp["frame_id"] >= split_late]["speed_kmh"]
                if len(early_spd) >= 4 and len(late_spd) >= 4:
                    e_top = float(np.percentile(early_spd, 85))
                    l_top = float(np.percentile(late_spd, 85))
                    if e_top > 9.0:
                        drop_pct = ((e_top - l_top) / e_top) * 100.0
                        dropoffs.append(drop_pct)
                        if drop_pct > 18.0:
                            fatigue_alerts.append(
                                {
                                    "identity_key": str(id_key),
                                    "team_cluster": int(grp["team_cluster"].mode().iloc[0]),
                                    "early_kmh": round(e_top, 1),
                                    "late_kmh": round(l_top, 1),
                                    "drop_pct": round(drop_pct, 1),
                                }
                            )
            if dropoffs:
                fatigue_dropoff_pct = round(float(max(0.0, np.mean(dropoffs))), 1)

        # 4. Accurate Low-Block Breaker (evaluate defending team ONLY on opposing possession frames!)
        def_frames_cnt = {0: 0, 1: 0}
        block_counts = {0: {"low": 0, "mid": 0, "high": 0}, 1: {"low": 0, "mid": 0, "high": 0}}
        half_space_pockets: dict[int, dict[str, float]] = {
            0: {"left_half_space": 0.0, "central": 0.0, "right_half_space": 0.0},
            1: {"left_half_space": 0.0, "central": 0.0, "right_half_space": 0.0},
        }
        for fid in frame_ids:
            pt = poss_frames.get(fid)
            if pt not in (0, 1):
                continue
            att_team = pt
            def_team = 1 - pt
            st = phase_by_frame.get(fid, {}).get(def_team)
            if not st:
                continue
            def_frames_cnt[def_team] += 1
            bcode = st.get("block_code", "mid_block")
            if bcode == "low_block":
                block_counts[def_team]["low"] += 1
            elif bcode == "mid_block":
                block_counts[def_team]["mid"] += 1
            else:
                block_counts[def_team]["high"] += 1

            def_sub = df_players[(df_players["frame_id"] == fid) & (df_players["team_cluster"] == def_team)]
            if not def_sub.empty:
                l_cnt = int(((def_sub["y_smooth"] >= 10.0) & (def_sub["y_smooth"] <= 24.0)).sum())
                c_cnt = int(((def_sub["y_smooth"] > 24.0) & (def_sub["y_smooth"] < 44.0)).sum())
                r_cnt = int(((def_sub["y_smooth"] >= 44.0) & (def_sub["y_smooth"] <= 58.0)).sum())
                half_space_pockets[att_team]["left_half_space"] += max(0.0, 3.0 - l_cnt)
                half_space_pockets[att_team]["central"] += max(0.0, 4.0 - c_cnt)
                half_space_pockets[att_team]["right_half_space"] += max(0.0, 3.0 - r_cnt)

        low_block_summary = {}
        for t in (0, 1):
            opp = 1 - t
            n_f = max(1, def_frames_cnt[opp])
            bc = block_counts[opp]
            pock = half_space_pockets[t]
            l_score = round(min(96.0, (pock["left_half_space"] / n_f) * 32.0), 1)
            c_score = round(min(96.0, (pock["central"] / n_f) * 24.0), 1)
            r_score = round(min(96.0, (pock["right_half_space"] / n_f) * 32.0), 1)
            best_zone = max(
                [("نصف المساحة الأيسر", l_score), ("العمق المركزي (Zone 14)", c_score), ("نصف المساحة الأيمن", r_score)],
                key=lambda x: x[1],
            )[0]
            low_block_summary[str(t)] = {
                "opp_low_block_pct": round((bc["low"] / n_f) * 100.0, 1),
                "opp_mid_block_pct": round((bc["mid"] / n_f) * 100.0, 1),
                "opp_high_press_pct": round((bc["high"] / n_f) * 100.0, 1),
                "left_half_space_open_pct": l_score,
                "central_open_pct": c_score,
                "right_half_space_open_pct": r_score,
                "recommended_overload_ar": f"زيادة عددية في {best_zone} مع تغيير زاوية اللعب السريع",
            }

        recommendations: list[str] = []
        if avg_time_on_ball_sec > 2.2 or slow_releasers:
            recommendations.append(
                f"تسريع تحرير الكرة: متوسط زمن الاحتفاظ {avg_time_on_ball_sec}ث ({len(slow_releasers)} لاعبين يحتفظون بالكرة > 2.4ث)."
            )
        if effective_play_time_pct < 62.0:
            recommendations.append(
                f"الوقت الفعلي للعب {effective_play_time_pct}% (توقفات متكررة): استغلال الرميات والضربات الحرة السريعة لرفع رتم التمرير ({pass_tempo_per_min}/د)."
            )
        if fatigue_alerts:
            recommendations.append(
                f"مؤشر الإجهاد البدني: هبوط سرعة الارتداد بأكثر من 18% لدى {len(fatigue_alerts)} لاعبين — يُنصح بتبديل تنشيطي في الخط الأمامي."
            )
        if not recommendations:
            recommendations.append(
                f"إيقاع تمرير متوازن ({pass_tempo_per_min} تمريرة/د فعلي) ووقت لعب فعلي {effective_play_time_pct}% — ركز الاختراق عبر أنصاف المساحات المفتوحة."
            )

        return {
            "effective_play_time_pct": effective_play_time_pct,
            "pass_tempo_per_min": pass_tempo_per_min,
            "avg_time_on_ball_sec": avg_time_on_ball_sec,
            "slow_releasers": slow_releasers,
            "avg_hold_by_player": avg_hold_by_player,
            "second_ball_win_rate": second_ball_win_rate,
            "fatigue_dropoff_index": fatigue_dropoff_pct,
            "fatigue_alerts": fatigue_alerts[:8],
            "low_block_breaker": low_block_summary,
            "recommendations_ar": recommendations,
        }

    def compute_pro_coach_analytics(
        self,
        df_players: pd.DataFrame,
        df_ball: pd.DataFrame,
        events: list[dict],
        poss_frames: dict[int, int | None],
        phase_by_frame: dict[int, dict[int, dict]],
        attack_dirs: dict[int, int],
        stats_df: pd.DataFrame,
        player_name_map: dict[str, str],
        team_formations: dict[str, dict],
        fps: float = 25.0,
    ) -> dict:
        """Compute Head Coach KPIs (xG, xT, PPDA, Field Tilt), Passing Networks, 18-Zone Control & Match Plan."""
        # 1. Final-third entries / Box shots -> estimated xG + Passing Network + PPDA + Field Tilt
        f3_touches = {0: 0, 1: 0}
        for fid, pt in poss_frames.items():
            if pt not in (0, 1):
                continue
            b_sub = df_ball[df_ball["frame_id"] == fid] if not df_ball.empty else pd.DataFrame()
            if b_sub.empty:
                continue
            bx = float(b_sub["x_smooth"].iloc[0])
            adir = attack_dirs.get(pt, 1 if pt == 0 else -1)
            ax = bx if adir == 1 else (self.L - bx)
            if ax >= 70.0:
                f3_touches[pt] += 1
        f3_sum = max(1, f3_touches[0] + f3_touches[1])
        field_tilt = {
            "0": round((f3_touches[0] / f3_sum) * 100.0, 1) if (f3_touches[0] + f3_touches[1]) > 0 else 50.0,
            "1": round((f3_touches[1] / f3_sum) * 100.0, 1) if (f3_touches[0] + f3_touches[1]) > 0 else 50.0,
        }

        pro_metrics: dict[str, dict] = {}
        passing_network: dict[str, dict] = {}
        frame_ids = sorted(df_players["frame_id"].unique()) if not df_players.empty else []

        # Track box threat sequences for realistic xG estimation
        for tc in (0, 1):
            adir = attack_dirs.get(tc, 1 if tc == 0 else -1)
            opp = 1 - tc
            t_ev = [e for e in events if e.get("team_cluster") == tc]
            o_ev = [e for e in events if e.get("team_cluster") == opp]

            t_passes = [e for e in t_ev if e.get("type") == "pass"]
            o_passes = [e for e in o_ev if e.get("type") == "pass"]
            t_comp = [e for e in t_passes if e.get("completed")]
            t_prog = [e for e in t_passes if e.get("progressive")]
            t_lb = [e for e in t_passes if e.get("line_breaking")]
            t_carries = [e for e in t_ev if e.get("type") == "progressive_carry"]
            t_press = [e for e in t_ev if e.get("type") == "pressing"]
            t_rec = [e for e in t_ev if e.get("type") == "recovery"]
            high_recs = [
                e for e in t_rec if ((e.get("x_m", 52.5) if adir == 1 else (self.L - e.get("x_m", 52.5))) >= 55.0)
            ]

            xt_total = round(float(sum(max(0.0, float(e.get("xt_delta") or 0.0)) for e in t_ev)), 2)

            # xG estimate from penalty-area entries & progressive box threat (realistic 0.04–0.32 per danger sequence)
            danger_frames = []
            if not df_ball.empty:
                for fid in frame_ids:
                    if poss_frames.get(fid) == tc:
                        b_sub = df_ball[df_ball["frame_id"] == fid]
                        if not b_sub.empty:
                            bx, by = float(b_sub["x_smooth"].iloc[0]), float(b_sub["y_smooth"].iloc[0])
                            ax = bx if adir == 1 else (self.L - bx)
                            if ax >= 86.0 and 16.0 <= by <= 52.0:
                                danger_frames.append((fid, ax, by))
            xg_est = 0.0
            last_shot_f = -999
            for dfid, dax, dby in danger_frames:
                if dfid - last_shot_f >= int(fps * 3.5):
                    last_shot_f = dfid
                    dist_goal = np.hypot(self.L - dax, abs(dby - 34.0))
                    xg_est += max(0.05, min(0.38, 0.42 * np.exp(-dist_goal / 14.0)))
            xg_est = round(xg_est + xt_total * 0.28, 2)

            def_actions = max(1, len(t_press) + len(high_recs))
            ppda = round(min(28.0, max(3.5, (len(o_passes) / def_actions) if o_passes else 10.5)), 1)

            def_heights = [
                phase_by_frame[fid][tc]["def_line_height_m"]
                for fid in frame_ids
                if fid in phase_by_frame and tc in phase_by_frame[fid]
            ]
            avg_def_h = round(float(np.mean(def_heights)), 1) if def_heights else 36.0
            tf = team_formations.get(str(tc), {})
            comp_area = round(float(tf.get("team_width_m", 44.0)) * float(tf.get("team_length_m", 32.0)), 0)
            pass_acc = round((len(t_comp) / len(t_passes) * 100.0), 1) if t_passes else 78.0

            pro_metrics[str(tc)] = {
                "xg_estimated": xg_est,
                "xt_total": xt_total,
                "ppda": ppda,
                "field_tilt_pct": field_tilt[str(tc)],
                "avg_def_line_height_m": avg_def_h,
                "compactness_area_m2": int(comp_area),
                "passes_total": len(t_passes),
                "passes_completed": len(t_comp),
                "pass_accuracy_pct": pass_acc,
                "progressive_passes": len(t_prog),
                "line_breaking_passes": len(t_lb),
                "progressive_carries": len(t_carries),
                "pressing_actions": len(t_press),
                "high_recoveries": len(high_recs),
            }

            # Passing Network nodes & links for this team's consolidated slots
            sub_t = df_players[df_players["team_cluster"] == tc]
            nodes: list[dict] = []
            if not sub_t.empty:
                stat_lookup = (
                    stats_df[stats_df["team_cluster"] == tc].set_index("identity_key").to_dict("index")
                    if not stats_df.empty
                    else {}
                )
                for id_key, grp in sub_t.groupby("identity_key"):
                    if len(grp) < 3:
                        continue
                    id_str = str(id_key)
                    srow = stat_lookup.get(id_str, {})
                    jn = srow.get("jersey_number")
                    nodes.append(
                        {
                            "identity_key": id_str,
                            "player_name": player_name_map.get(id_str, f"لاعب #{jn}" if jn else id_str),
                            "jersey_number": int(jn) if jn is not None and not pd.isna(jn) else None,
                            "avg_x_m": round(float(grp["x_smooth"].median()), 1),
                            "avg_y_m": round(float(grp["y_smooth"].median()), 1),
                            "passes": int(srow.get("passes", 0)),
                            "xt_generated": round(float(srow.get("xt_generated", 0.0)), 2),
                            "scout_score": srow.get("scout_score"),
                        }
                    )

            pair_counts: dict[tuple[str, str], dict] = {}
            for ev in t_comp:
                src = str(ev.get("identity") or "")
                dst = str(ev.get("receiver") or "")
                if src and dst and src != dst:
                    key = (src, dst)
                    item = pair_counts.setdefault(key, {"count": 0, "progressive_count": 0, "xt_sum": 0.0})
                    item["count"] += 1
                    if ev.get("progressive"):
                        item["progressive_count"] += 1
                    item["xt_sum"] += max(0.0, float(ev.get("xt_delta") or 0.0))

            links = [
                {
                    "source": src,
                    "target": dst,
                    "count": d["count"],
                    "progressive_count": d["progressive_count"],
                    "avg_xt": round(d["xt_sum"] / max(1, d["count"]), 3),
                }
                for (src, dst), d in sorted(pair_counts.items(), key=lambda x: x[1]["count"], reverse=True)[:18]
            ]
            passing_network[str(tc)] = {"nodes": nodes[:11], "links": links}

        # 2. 18-Zone Territorial Control Grid (6 longitudinal x 3 lateral zones)
        zone_control_18: list[dict] = []
        zone_names = [
            ["بناء أيسر", "عمق بناء أمام المرمى (Z2)", "بناء أيمن"],
            ["جبهة يسرى خلفية", "ارتكاز الوسط (Z5)", "جبهة يمنى خلفية"],
            ["نصف مساحة وسط أيسر", "قلب الملعب (Z8)", "نصف مساحة وسط أيمن"],
            ["نصف مساحة هجومي أيسر", "Zone 14 (منطقة الخطورة)", "نصف مساحة هجومي أيمن"],
            ["جناح ثلث أخير أيسر", "عمق الثلث الأخير (Z14+)", "جناح ثلث أخير أيمن"],
            ["منطقة جزاء يسرى", "صندوق الـ 6 ياردات", "منطقة جزاء يمنى"],
        ]
        if not df_players.empty:
            cols_idx = np.clip((df_players["x_smooth"].to_numpy() / self.L * 6).astype(int), 0, 5)
            rows_idx = np.clip((df_players["y_smooth"].to_numpy() / self.W * 3).astype(int), 0, 2)
            tcs = df_players["team_cluster"].to_numpy()
            for col in range(6):
                for row in range(3):
                    mask = (cols_idx == col) & (rows_idx == row)
                    c0 = int(np.sum(mask & (tcs == 0)))
                    c1 = int(np.sum(mask & (tcs == 1)))
                    tot = c0 + c1
                    p0 = round((c0 / tot) * 100.0, 1) if tot > 0 else 50.0
                    p1 = round(100.0 - p0, 1) if tot > 0 else 50.0
                    zone_control_18.append(
                        {
                            "col": col,
                            "row": row,
                            "x0_m": round(col * (self.L / 6.0), 1),
                            "x1_m": round((col + 1) * (self.L / 6.0), 1),
                            "y0_m": round(row * (self.W / 3.0), 1),
                            "y1_m": round((row + 1) * (self.W / 3.0), 1),
                            "label_ar": zone_names[col][row],
                            "is_zone_14": bool(col in (3, 4) and row == 1),
                            "team_0_pct": p0,
                            "team_1_pct": p1,
                        }
                    )

        # 3. Automated Head Coach Report (SWOT + Adjustments + Drills)
        coach_report: dict[str, dict] = {}
        for tc in (0, 1):
            m = pro_metrics[str(tc)]
            tf = team_formations.get(str(tc), {})
            strengths: list[str] = []
            weaknesses: list[str] = []
            adjustments: list[str] = []
            drills: list[dict] = []

            if m["field_tilt_pct"] >= 54.0:
                strengths.append(f"هيمنة ميدانية في الثلث الهجومي (Field Tilt {m['field_tilt_pct']}%) مع توليد xT {m['xt_total']}.")
            if m["line_breaking_passes"] >= 3 or m["progressive_passes"] >= 6:
                strengths.append(f"فعالية اختراق خطوط المنافس بـ {m['progressive_passes']} تمريرة تقدمية و {m['line_breaking_passes']} تمريرة كاسرة للخطوط.")
            if m["ppda"] <= 10.5:
                strengths.append(f"ضغط متقدم شرس ومؤثر (PPDA = {m['ppda']}) مع {m['high_recoveries']} استخلاص بالثلث العالي.")
            if float(tf.get("discipline_score", 70)) >= 75:
                strengths.append(f"انضباط خطي عالي ({tf.get('discipline_score')}% — خط دفاع {tf.get('def_line_sync_std')}م انحراف).")
            if not strengths:
                strengths.append(f"تنظيم دفاعي متحول ({tf.get('out_of_possession_formation', '4-4-2')} ➔ {tf.get('in_possession_formation', '3-2-4-1')}) بدقة تمرير {m['pass_accuracy_pct']}%.")

            if m["ppda"] > 13.5:
                weaknesses.append(f"تأخر ردة فعل الضغط (PPDA مرتفع = {m['ppda']}) يسمح للخصم بالبناء المريح من الخلف.")
                adjustments.append("تقديم محور الوسط الارتكاز بـ 6 أمتار أثناء تدوير الخصم لإغلاق زاوية تمريرة العمق (Cover Shadow).")
                drills.append({
                    "title": "تمرين مصيدة الضغط العكسي (6 ضد 6 + 2 محايد)",
                    "duration_min": 20,
                    "target_group": "خط الوسط والهجوم",
                    "description": "استعادة الكرة خلال 5 ثوانٍ فور فقدانها مع تقليص عرض الفريق لأقل من 32 متراً.",
                })
            if m["pass_accuracy_pct"] < 75.0:
                weaknesses.append(f"فقدان الكرة تحت الضغط (دقة التمرير {m['pass_accuracy_pct']}%) يرفع فرص التحولات العكسية للخصم.")
                adjustments.append("توفير خيار دعم ثالث بزاوية مثلث بمسافة 10–14 متراً لحامل الكرة عند الخروج بالكرة.")
                drills.append({
                    "title": "تمرين بناء اللعب تحت الضغط العالي (Rondo 4+3 ضد 5)",
                    "duration_min": 18,
                    "target_group": "المدافعون ولاعبو الوسط",
                    "description": "التمرير من لمستين للخروج عبر أنصاف المساحات وكسر خط الضغط الأول.",
                })
            if float(tf.get("team_width_m", 42)) > 48.0:
                weaknesses.append(f"اتساع العرض الدفاعي ({tf.get('team_width_m')}م) يفتح ثغرات بين قلب الدفاع والظهير.")
                adjustments.append("ترحيل الجناح العكسي للداخل وتقارب قلبي الدفاع لتقليل الفجوات الأفقية تحت 14 متراً.")
            if not weaknesses:
                weaknesses.append("الحاجة لتكثيف الزيادة العددية في Zone 14 لتحويل الاستحواذ إلى فرص محققة (xG).")
                adjustments.append(f"الدفع بالظهير أو لاعب الوسط المتقدم في أنصاف المساحات أثناء التحول من {tf.get('out_of_possession_formation', '4-2-3-1')} إلى {tf.get('in_possession_formation', '3-2-4-1')}.")

            if len(drills) < 2:
                drills.append({
                    "title": "تمرين استغلال أنصاف المساحات وكسر التكتل (Low-Block Breaker)",
                    "duration_min": 22,
                    "target_group": "الفريق بالكامل",
                    "description": "تحريك الكرة بسرعة عبر العرض لجذب التكتل ثم ضرب المساحة النصفية بتمريرة بينية للـ Third-Man Runner.",
                })

            coach_report[str(tc)] = {
                "strengths_ar": strengths[:3],
                "weaknesses_ar": weaknesses[:3],
                "in_game_adjustments_ar": adjustments[:3],
                "weekly_drills_ar": drills[:3],
            }

        return {
            "pro_coach_metrics": pro_metrics,
            "passing_network": passing_network,
            "zone_control_18": zone_control_18,
            "coach_report": coach_report,
        }

    def build_timeline_tags(
        self,
        events: list[dict],
        phase_by_frame: dict[int, dict[int, dict]],
        gaps_by_frame: dict[int, list[dict]],
        fps: float,
    ) -> list[dict]:
        """Build Hudl Sportscode-style clickable timeline tags for instant video scrubbing."""
        tags: list[dict] = []

        for ev in events:
            if ev.get("type") == "pass" and ev.get("line_breaking"):
                tags.append(
                    {
                        "category": "line_breaking",
                        "label_ar": "تمريرة كاسرة للخطوط",
                        "time_s": round(float(ev["time_s"]), 2),
                        "team_cluster": int(ev.get("team_cluster", 0)),
                        "detail": f"xT +{ev.get('xt', 0):.2f}",
                    }
                )

        for ev in events:
            if ev.get("type") == "recovery":
                tc = int(ev.get("team_cluster", 0))
                xm = float(ev.get("x_m", 52.5))
                if (tc == 0 and xm > 55.0) or (tc == 1 and xm < 50.0):
                    tags.append(
                        {
                            "category": "high_recovery",
                            "label_ar": "ضغط عالي ناجح",
                            "time_s": round(float(ev["time_s"]), 2),
                            "team_cluster": tc,
                            "detail": "استخلاص بالثلث المتقدم",
                        }
                    )

        last_tr_t = {0: -10.0, 1: -10.0}
        for fid in sorted(phase_by_frame.keys()):
            t_s = fid / max(1.0, fps)
            for tc in (0, 1):
                if phase_by_frame[fid].get(tc, {}).get("phase") == "positive_transition":
                    if t_s - last_tr_t[tc] >= 3.0:
                        last_tr_t[tc] = t_s
                        tags.append(
                            {
                                "category": "positive_transition",
                                "label_ar": "تحول هجومي سريع",
                                "time_s": round(t_s, 2),
                                "team_cluster": tc,
                                "detail": "انطلاق هجومي",
                            }
                        )

        last_gap_t = -10.0
        for fid in sorted(gaps_by_frame.keys()):
            gaps = gaps_by_frame[fid]
            if gaps:
                t_s = fid / max(1.0, fps)
                if t_s - last_gap_t >= 3.0:
                    last_gap_t = t_s
                    worst = max(gaps, key=lambda g: g.get("distance_m", 0))
                    tags.append(
                        {
                            "category": "defensive_gap",
                            "label_ar": f"ثغرة دفاعية {worst['distance_m']}م",
                            "time_s": round(t_s, 2),
                            "team_cluster": int(worst.get("team_cluster", 0)),
                            "detail": f"تباعد >16م ({worst['distance_m']}م)",
                        }
                    )

        tags.sort(key=lambda x: x["time_s"])
        return tags[:120]
