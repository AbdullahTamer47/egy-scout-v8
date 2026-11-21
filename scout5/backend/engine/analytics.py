"""Stage 3 V6 Honest Broadcast 3D AR & Tactical Analytics powered strictly by PnLCalib coordinates."""
from __future__ import annotations

from collections import Counter, defaultdict

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from scipy.spatial import ConvexHull, Voronoi
from shapely.geometry import Polygon, box

from engine.forensics import enrich_portfolios_with_mistakes_and_strengths, extract_key_match_sequences
from engine.pitch import PITCH_L, PITCH_W, to_metres
from engine.tactical_director import evaluate_6x4_compatibility, video_metrics_to_scouting_vector

PITCH_BOX = box(0.0, 0.0, PITCH_L, PITCH_W)

# Canonical 10-outfielder shapes in normalized (depth [0=GK -> 1=ST], width [0=Left -> 1=Right])
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
    "3-5-2": (
        [3, 5, 2],
        [
            (0.20, 0.26), (0.18, 0.50), (0.20, 0.74),
            (0.48, 0.13), (0.44, 0.34), (0.48, 0.50), (0.44, 0.66), (0.48, 0.87),
            (0.83, 0.36), (0.83, 0.64),
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
}


def compute_h_inv_norm(H: np.ndarray, fw: int, fh: int) -> np.ndarray | None:
    """Return 3x3 matrix mapping FIFA metric (x_m, y_m) -> normalized canvas [0..1] (u, v)."""
    try:
        Hi = np.linalg.inv(H)
    except np.linalg.LinAlgError:
        return None
    S = np.array([[1.0 / max(1, fw), 0.0, 0.0], [0.0, 1.0 / max(1, fh), 0.0], [0.0, 0.0, 1.0]], dtype=np.float64)
    Hn = S @ Hi
    if abs(Hn[2, 2]) < 1e-12:
        return None
    return Hn / Hn[2, 2]


def _proj_uv(H_inv_norm: np.ndarray | None, xy_m: tuple[float, float]) -> list[float] | None:
    if H_inv_norm is None:
        return None
    v = H_inv_norm @ np.array([xy_m[0], xy_m[1], 1.0], dtype=np.float64)
    if v[2] <= 1e-6:
        return None
    u, w = float(v[0] / v[2]), float(v[1] / v[2])
    if -0.35 <= u <= 1.35 and -0.35 <= w <= 1.35:
        return [round(u, 5), round(w, 5)]
    return None


def compute_camera_fov_m(H: np.ndarray, fw: int, fh: int) -> list[list[float]]:
    """Project lower 72% broadcast trapezoid corners to FIFA metres for 2D/3D minimap FOV cone."""
    corners = np.array(
        [[0.0, fh * 0.28], [float(fw), fh * 0.28], [float(fw), fh * 0.97], [0.0, fh * 0.97]],
        dtype=np.float32,
    )
    pts = to_metres(H, corners)
    out: list[list[float]] = []
    for x, y in pts:
        if np.isfinite(x) and np.isfinite(y):
            out.append([round(float(np.clip(x, -8.0, PITCH_L + 8.0)), 2), round(float(np.clip(y, -5.0, PITCH_W + 5.0)), 2)])
    return out if len(out) == 4 else []


def infer_attack_dir(df_dets: pd.DataFrame) -> dict[int, int]:
    """Infer primary attack direction (+1 attacks right goal x=105, -1 attacks left goal x=0) per team."""
    dirs = {0: 1, 1: -1}
    if df_dets.empty:
        return dirs
    gks = df_dets[(df_dets["role"] == "goalkeeper") & df_dets["on_pitch"] & df_dets["team_id"].isin([0, 1])]
    gk_x: dict[int, float] = {}
    for t in (0, 1):
        sub = gks[gks["team_id"] == t]
        if len(sub) >= 2:
            gk_x[t] = float(sub["x_m"].median())
    if 0 in gk_x and 1 not in gk_x:
        dirs[0] = 1 if gk_x[0] < PITCH_L * 0.5 else -1
        dirs[1] = -dirs[0]
    elif 1 in gk_x and 0 not in gk_x:
        dirs[1] = 1 if gk_x[1] < PITCH_L * 0.5 else -1
        dirs[0] = -dirs[1]
    elif 0 in gk_x and 1 in gk_x and abs(gk_x[0] - gk_x[1]) > 10.0:
        dirs[0] = 1 if gk_x[0] < gk_x[1] else -1
        dirs[1] = -dirs[0]
    else:
        of = df_dets[(df_dets["role"] == "player") & df_dets["on_pitch"] & df_dets["team_id"].isin([0, 1])]
        m0 = float(of.loc[of["team_id"] == 0, "x_m"].mean()) if (of["team_id"] == 0).any() else 45.0
        m1 = float(of.loc[of["team_id"] == 1, "x_m"].mean()) if (of["team_id"] == 1).any() else 60.0
        dirs[0] = 1 if m0 <= m1 else -1
        dirs[1] = -dirs[0]
    return dirs


def attach_per_frame_velocities(df_dets: pd.DataFrame) -> pd.DataFrame:
    """Attach smoothed calibrated (vx_ms, vy_ms, speed_kmh) to every detection row."""
    df = df_dets.copy()
    df["vx_ms"] = 0.0
    df["vy_ms"] = 0.0
    df["speed_kmh"] = 0.0
    if df.empty:
        return df

    cal_person = df[(df["role"] != "ball") & df["on_pitch"]]
    for (_sid, _tid), grp_idx in cal_person.groupby(["shot_id", "track_id"]).groups.items():
        grp = df.loc[grp_idx].sort_values("frame_id")
        if len(grp) < 3:
            continue
        idxs = grp.index.to_numpy()
        xs = grp["x_m"].rolling(3, min_periods=1, center=True).median().to_numpy(dtype=np.float64)
        ys = grp["y_m"].rolling(3, min_periods=1, center=True).median().to_numpy(dtype=np.float64)
        ts = grp["time_s"].to_numpy(dtype=np.float64)

        vx = np.zeros(len(ts), dtype=np.float64)
        vy = np.zeros(len(ts), dtype=np.float64)
        spd = np.zeros(len(ts), dtype=np.float64)
        for k in range(1, len(ts)):
            dt = ts[k] - ts[k - 1]
            if dt <= 0.01 or dt > 0.45:
                continue
            dx, dy = xs[k] - xs[k - 1], ys[k] - ys[k - 1]
            v_ms = float(np.hypot(dx, dy)) / dt
            v_kmh = v_ms * 3.6
            if v_kmh > 38.0:
                continue
            vx[k] = dx / dt
            vy[k] = dy / dt
            spd[k] = v_kmh
        if len(ts) >= 2:
            vx[0], vy[0], spd[0] = vx[1], vy[1], spd[1]

        # 3-tap velocity smoothing for crisp broadcast speedometer display
        vx_s = pd.Series(vx).rolling(3, min_periods=1, center=True).mean().to_numpy()
        vy_s = pd.Series(vy).rolling(3, min_periods=1, center=True).mean().to_numpy()
        spd_s = np.clip(np.hypot(vx_s, vy_s) * 3.6, 0.0, 38.0)
        df.loc[idxs, "vx_ms"] = np.round(vx_s, 3)
        df.loc[idxs, "vy_ms"] = np.round(vy_s, 3)
        df.loc[idxs, "speed_kmh"] = np.round(spd_s, 1)

    return df


def compute_voronoi_pitch_control(
    pl_rows: pd.DataFrame,
) -> tuple[list[dict], dict[str, float], dict[str, float]]:
    """Compute exact 105x68m bounded Voronoi polygons + team pitch control % + per-identity areas."""
    if len(pl_rows) < 6:
        return [], {}, {}

    pts = pl_rows[["x_m", "y_m"]].to_numpy(dtype=np.float64)
    # Deduplicate near-identical points within 0.25m to keep Voronoi well-conditioned
    keep_mask = np.ones(len(pts), dtype=bool)
    for i in range(len(pts)):
        if not keep_mask[i]:
            continue
        for j in range(i + 1, len(pts)):
            if keep_mask[j] and np.hypot(pts[i, 0] - pts[j, 0], pts[i, 1] - pts[j, 1]) < 0.25:
                keep_mask[j] = False

    sub = pl_rows.iloc[np.where(keep_mask)[0]]
    pts = sub[["x_m", "y_m"]].to_numpy(dtype=np.float64)
    n = len(pts)
    if n < 5:
        return [], {}, {}

    # Mirror points across the 4 FIFA boundaries so every Voronoi cell is bounded inside the pitch
    mirrored = np.vstack(
        [
            pts,
            np.column_stack([-pts[:, 0], pts[:, 1]]),
            np.column_stack([2.0 * PITCH_L - pts[:, 0], pts[:, 1]]),
            np.column_stack([pts[:, 0], -pts[:, 1]]),
            np.column_stack([pts[:, 0], 2.0 * PITCH_W - pts[:, 1]]),
        ]
    )
    try:
        vor = Voronoi(mirrored)
    except Exception:
        return [], {}, {}

    cells: list[dict] = []
    team_area = {0: 0.0, 1: 0.0}
    id_areas: dict[str, float] = {}

    # Clip Voronoi to active play zone (bounding box of tracked players +/- 12m, inside 105x68 FIFA pitch)
    # so unfilmed empty halves outside the broadcast camera do not distort pitch control or player m²!
    ax0 = max(0.0, float(pts[:, 0].min()) - 12.0)
    ax1 = min(PITCH_L, float(pts[:, 0].max()) + 12.0)
    ay0 = max(0.0, float(pts[:, 1].min()) - 10.0)
    ay1 = min(PITCH_W, float(pts[:, 1].max()) + 10.0)
    active_box = box(ax0, ay0, ax1, ay1)

    for i in range(n):
        reg_idx = vor.point_region[i]
        verts_idx = vor.regions[reg_idx]
        if not verts_idx or -1 in verts_idx:
            continue
        raw_poly = Polygon(vor.vertices[verts_idx])
        if not raw_poly.is_valid:
            raw_poly = raw_poly.buffer(0)
        clipped = raw_poly.intersection(active_box)
        if clipped.is_empty or clipped.geom_type != "Polygon":
            continue
        area = float(clipped.area)
        row = sub.iloc[i]
        tid = int(row["team_id"])
        ikey = str(row.get("identity_key") or f"t{tid}_trk{int(row['track_id'])}")
        if tid in (0, 1):
            team_area[tid] += area
        id_areas[ikey] = round(area, 1)

        coords = list(clipped.exterior.coords)[:-1]
        if len(coords) >= 3:
            # Simplify slightly for smooth, compact JSON transfer
            poly_m = [[round(float(x), 1), round(float(y), 1)] for x, y in coords[:10]]
            cells.append(
                {
                    "team_id": tid,
                    "identity_key": ikey,
                    "track_id": int(row["track_id"]),
                    "area_m2": round(area, 1),
                    "poly_m": poly_m,
                }
            )

    tot = team_area[0] + team_area[1]
    pct = {}
    if tot > 100.0:
        pct = {
            "0": round(100.0 * team_area[0] / tot, 1),
            "1": round(100.0 * team_area[1] / tot, 1),
        }
    return cells, pct, id_areas


def detect_formation_and_lines(
    pts_xy_m: np.ndarray,
    uv_norm: np.ndarray,
    attack_dir: int,
    h_inv_norm: np.ndarray | None,
    team_id: int,
) -> tuple[dict | None, list[dict]]:
    """Match 4-10 calibrated outfielders to formations, tactical bands, hull, 3D def wall, and gaps >16m."""
    # Filter touchline sideline linesman artifact (y < 1.2 or y > 66.8) when >=5 other outfielders exist
    in_mask = (pts_xy_m[:, 1] >= 1.2) & (pts_xy_m[:, 1] <= PITCH_W - 1.2)
    if int(in_mask.sum()) >= 5:
        pts_xy_m = pts_xy_m[in_mask]
        uv_norm = uv_norm[in_mask]

    n = len(pts_xy_m)
    if n < 4:
        return None, []
    x = pts_xy_m[:, 0]
    y = pts_xy_m[:, 1]
    depth = x if attack_dir >= 0 else (PITCH_L - x)
    width = y if attack_dir >= 0 else (PITCH_W - y)

    d_min, d_max = float(depth.min()), float(depth.max())
    w_min, w_max = float(width.min()), float(width.max())
    d_span = max(12.0, d_max - d_min)
    w_span = max(16.0, w_max - w_min)

    team_width = round(float(y.max() - y.min()), 1)
    team_length = round(float(x.max() - x.min()), 1)
    sorted_d = np.sort(depth)
    def_line = round(float(sorted_d[0]), 1)
    def_line_x_m = float(sorted_d[0]) if attack_dir >= 0 else float(PITCH_L - sorted_d[0])

    # 3D Defensive Line AR Wall projected across pitch width (y = 3m .. 65m)
    def_wall_m = [[round(def_line_x_m, 2), 3.0], [round(def_line_x_m, 2), round(PITCH_W - 3.0, 2)]]
    p_start_uv = _proj_uv(h_inv_norm, (def_line_x_m, 3.0))
    p_end_uv = _proj_uv(h_inv_norm, (def_line_x_m, PITCH_W - 3.0))
    def_wall_uv = [p_start_uv, p_end_uv] if (p_start_uv and p_end_uv) else []

    # Team Convex Hull in metric & video UV coordinates
    hull_m: list[list[float]] = []
    hull_uv: list[list[float]] = []
    if n >= 4:
        try:
            hull = ConvexHull(pts_xy_m)
            for vi in hull.vertices:
                hull_m.append([round(float(pts_xy_m[vi, 0]), 1), round(float(pts_xy_m[vi, 1]), 1)])
                hull_uv.append([round(float(uv_norm[vi, 0]), 5), round(float(uv_norm[vi, 1]), 5)])
        except Exception:
            pass

    # DEF / MID / FWD bands + Defensive Gaps > 16.0m between adjacent defenders
    order = np.argsort(depth)
    bands: dict[str, list[list[float]]] = {}
    gaps: list[dict] = []
    if n >= 6:
        def_idx = order[: max(3, min(4, n // 3 + 1))]
        idx_groups = {
            "DEF": def_idx,
            "MID": order[max(3, n // 3) : max(4, n - max(1, n // 4))],
            "FWD": order[max(4, n - max(1, n // 4)) :],
        }
        for bname, g_idx in idx_groups.items():
            if len(g_idx) >= 2:
                g_sorted = g_idx[np.argsort(uv_norm[g_idx, 0])]
                bands[bname] = [[round(float(uv_norm[i, 0]), 5), round(float(uv_norm[i, 1]), 5)] for i in g_sorted]

        # Check lateral gaps along back line sorted by y_m
        def_by_y = def_idx[np.argsort(y[def_idx])]
        for k in range(len(def_by_y) - 1):
            i1, i2 = int(def_by_y[k]), int(def_by_y[k + 1])
            gap_m = float(np.hypot(x[i2] - x[i1], y[i2] - y[i1]))
            if 16.0 <= gap_m <= 36.0:
                gaps.append(
                    {
                        "team_id": team_id,
                        "gap_m": round(gap_m, 1),
                        "from_m": [round(float(x[i1]), 1), round(float(y[i1]), 1)],
                        "to_m": [round(float(x[i2]), 1), round(float(y[i2]), 1)],
                        "from_uv": [round(float(uv_norm[i1, 0]), 5), round(float(uv_norm[i1, 1]), 5)],
                        "to_uv": [round(float(uv_norm[i2, 0]), 5), round(float(uv_norm[i2, 1]), 5)],
                    }
                )

    formation_str = None
    if n >= 7:
        norm_pts = np.column_stack([(depth - d_min) / d_span, (width - w_min) / w_span])
        best_cost = 1e9
        for fname, (_, tpl_pts) in FORMATION_TEMPLATES.items():
            tpl = np.asarray(tpl_pts, dtype=np.float64)
            cost_mat = np.linalg.norm(norm_pts[:, None, :] - tpl[None, :, :], axis=2) ** 2
            r_ind, c_ind = linear_sum_assignment(cost_mat)
            mse = float(cost_mat[r_ind, c_ind].mean())
            if mse < best_cost:
                best_cost = mse
                formation_str = fname

    return (
        {
            "formation": formation_str,
            "n_players": int(n),
            "width_m": team_width,
            "length_m": team_length,
            "def_line_m": def_line,
            "def_line_x_m": round(def_line_x_m, 1),
            "def_wall_m": def_wall_m,
            "def_wall_uv": def_wall_uv,
            "hull_m": hull_m,
            "hull_uv": hull_uv,
            "bands_uv": bands,
        },
        gaps,
    )


def compute_passing_lanes(
    carrier_row: pd.Series,
    team_rows: pd.DataFrame,
    opp_rows: pd.DataFrame,
    attack_dir: int,
    h_inv_norm: np.ndarray | None,
) -> list[dict]:
    """Evaluate open & line-breaking pass lanes with calibrated xPass% completion probability."""
    cx, cy = float(carrier_row["x_m"]), float(carrier_row["y_m"])
    c_tid = int(carrier_row["track_id"])
    c_uv = [round(float(carrier_row["u_norm"]), 5), round(float(carrier_row["v_norm"]), 5)]

    opp_xy = opp_rows[["x_m", "y_m"]].to_numpy(dtype=np.float64) if not opp_rows.empty else np.empty((0, 2))
    lanes: list[dict] = []

    for _, trow in team_rows.iterrows():
        t_tid = int(trow["track_id"])
        if t_tid == c_tid:
            continue
        tx, ty = float(trow["x_m"]), float(trow["y_m"])
        vec = np.array([tx - cx, ty - cy], dtype=np.float64)
        dist_m = float(np.linalg.norm(vec))
        if dist_m < 4.0 or dist_m > 45.0:
            continue

        clearance = 15.0
        bypassed = 0
        if len(opp_xy) > 0:
            v_len_sq = dist_m * dist_m
            rel = opp_xy - np.array([cx, cy])
            proj = np.clip((rel @ vec) / v_len_sq, 0.0, 1.0)
            closest = np.array([cx, cy]) + proj[:, None] * vec[None, :]
            d_perp = np.linalg.norm(opp_xy - closest, axis=1)
            clearance = float(np.min(d_perp))
            c_depth = cx * attack_dir
            t_depth = tx * attack_dir
            if t_depth > c_depth + 2.0:
                opp_d = opp_xy[:, 0] * attack_dir
                bypassed = int(np.sum((opp_d > c_depth + 1.0) & (opp_d < t_depth - 1.0)))

        # Calibrated xPass% model (clearance +, distance -, bypassed difficulty -)
        raw_xp = 94.0 - dist_m * 0.65 - max(0.0, 4.0 - clearance) * 11.5 - bypassed * 3.0
        xpass_pct = round(float(np.clip(raw_xp, 28.0, 96.0)), 0)

        if clearance < 1.3:
            status = "blocked"
        elif bypassed >= 2 and clearance >= 2.1:
            status = "line_breaking"
        elif clearance >= 2.3:
            status = "open"
        else:
            status = "pressured"

        t_uv = [round(float(trow["u_norm"]), 5), round(float(trow["v_norm"]), 5)]
        if not t_uv or h_inv_norm is not None:
            proj_t = _proj_uv(h_inv_norm, (tx, ty))
            if proj_t is not None:
                t_uv = proj_t

        lanes.append(
            {
                "target_track_id": t_tid,
                "target_identity_key": str(trow.get("identity_key") or ""),
                "from_m": [round(cx, 2), round(cy, 2)],
                "to_m": [round(tx, 2), round(ty, 2)],
                "from_uv": c_uv,
                "to_uv": t_uv,
                "distance_m": round(dist_m, 1),
                "clearance_m": round(clearance, 1),
                "opponents_bypassed": bypassed,
                "xpass_pct": int(xpass_pct),
                "status": status,
            }
        )

    lanes.sort(key=lambda x: (x["status"] == "line_breaking", x["status"] == "open", x["opponents_bypassed"], x["xpass_pct"]), reverse=True)
    return lanes[:6]


def _infer_role_from_zone(mean_x: float, mean_y: float, attack_dir: int, role: str) -> tuple[str, str]:
    if role == "goalkeeper":
        return "GK", "حارس مرمى"
    if role == "referee":
        return "REF", "حكم"
    depth = mean_x if attack_dir >= 0 else (PITCH_L - mean_x)
    width = mean_y if attack_dir >= 0 else (PITCH_W - mean_y)

    if depth < 36.0:
        if width < 18.0:
            return "LB", "ظهير أيسر"
        if width > 50.0:
            return "RB", "ظهير أيمن"
        return "CB", "قلب دفاع"
    if depth < 54.0:
        if width < 16.0:
            return "LB", "ظهير/جناح أيسر"
        if width > 52.0:
            return "RB", "ظهير/جناح أيمن"
        return "DM", "ارتكاز دفاعي 6"
    if depth < 72.0:
        if width < 17.0:
            return "LW", "طرف أيسر"
        if width > 51.0:
            return "RW", "طرف أيمن"
        return "CM", "وسط محور 8"
    if depth < 84.0:
        if width < 20.0:
            return "LW", "جناح أيسر"
        if width > 48.0:
            return "RW", "جناح أيمن"
        return "AM", "صانع لعب 10"
    if width < 21.0:
        return "LW", "جناح هجومي أيسر"
    if width > 47.0:
        return "RW", "جناح هجومي أيمن"
    return "ST", "مهاجم صريح 9"


def _compute_heatmap_12x8(xs: np.ndarray, ys: np.ndarray) -> list[list[float]]:
    """Compute normalized 8-row x 12-col calibrated pitch occupancy matrix (0..1)."""
    grid = np.zeros((8, 12), dtype=np.float64)
    for x, y in zip(xs, ys):
        c = int(np.clip(np.floor((x / PITCH_L) * 12.0), 0, 11))
        r = int(np.clip(np.floor((y / PITCH_W) * 8.0), 0, 7))
        grid[r, c] += 1.0
    mx = float(grid.max())
    if mx > 0:
        grid = grid / mx
    return [[round(float(v), 3) for v in row] for row in grid]


def build_tactical_analytics(
    df_frames: pd.DataFrame,
    df_dets: pd.DataFrame,
    team_palettes: dict,
    fps: float,
    match_slug: str = "",
    identity_meta: dict[str, dict] | None = None,
    identity_diagnostics: dict | None = None,
) -> tuple[dict, dict[int, dict], pd.DataFrame]:
    """Compute V6 Stage 3 calibrated AR tactics, Voronoi control, gaps, events & full player portfolios."""
    df_dets = attach_per_frame_velocities(df_dets)
    if "identity_key" not in df_dets.columns:
        df_dets["identity_key"] = [
            f"t{int(t)}_trk{int(k)}" if r != "ball" else ""
            for t, k, r in zip(df_dets["team_id"], df_dets["track_id"], df_dets["role"])
        ]

    identity_meta = identity_meta or {}
    attack_dirs = infer_attack_dir(df_dets)
    frame_tactics: dict[int, dict] = {}
    form_votes: dict[int, list[str]] = {0: [], 1: []}
    geom_stats: dict[int, dict[str, list[float]]] = {
        0: {"width": [], "length": [], "def_line": []},
        1: {"width": [], "length": [], "def_line": []},
    }
    vor_team_pcts: dict[int, list[float]] = {0: [], 1: []}
    vor_by_identity: dict[str, list[float]] = defaultdict(list)
    carrier_frames_by_id: dict[str, int] = defaultdict(int)
    lbp_by_id: dict[str, int] = defaultdict(int)
    timeline_events: list[dict] = []

    t0_poss, t1_poss = 0, 0
    prev_poss_team: int | None = None
    last_event_t: dict[str, float] = {}
    dets_by_fid = {int(fid): df_dets.loc[idx] for fid, idx in df_dets.groupby("frame_id").groups.items()} if not df_dets.empty else {}

    for _, frow in df_frames.iterrows():
        fid = int(frow["frame_id"])
        time_s = round(float(frow["time_s"]), 2)
        cal_src = str(frow["cal_src"])
        fw = int(frow["width"])
        fh = int(frow["height"])
        f_dets = dets_by_fid.get(fid, pd.DataFrame())

        if cal_src == "none":
            frame_tactics[fid] = {
                "frame_id": fid,
                "time_s": time_s,
                "shot_id": int(frow["shot_id"]),
                "cal_src": "none",
                "cal_err_px": None,
                "h_inv_norm": None,
                "camera_fov_m": [],
                "poss_team": None,
                "ball_carrier_track_id": None,
                "ball_carrier_identity": None,
                "formations": {},
                "passing_lanes": [],
                "voronoi_cells": [],
                "pitch_control": {},
                "defensive_gaps": [],
            }
            continue

        H = np.array([frow[f"h{i}"] for i in range(9)], dtype=np.float64).reshape(3, 3)
        h_inv_norm = compute_h_inv_norm(H, fw, fh)
        cam_fov = compute_camera_fov_m(H, fw, fh)

        teams_frame: dict[str, dict] = {}
        frame_gaps: list[dict] = []
        on_pitch_players = f_dets[(f_dets["role"] == "player") & f_dets["on_pitch"] & f_dets["team_id"].isin([0, 1])] if not f_dets.empty else pd.DataFrame()
        for t in (0, 1):
            t_sub = on_pitch_players[on_pitch_players["team_id"] == t] if not on_pitch_players.empty else pd.DataFrame()
            if len(t_sub) >= 4:
                res_f, t_gaps = detect_formation_and_lines(
                    t_sub[["x_m", "y_m"]].to_numpy(dtype=np.float64),
                    t_sub[["u_norm", "v_norm"]].to_numpy(dtype=np.float64),
                    attack_dirs[t],
                    h_inv_norm,
                    t,
                )
                if res_f:
                    teams_frame[str(t)] = res_f
                    geom_stats[t]["width"].append(res_f["width_m"])
                    geom_stats[t]["length"].append(res_f["length_m"])
                    geom_stats[t]["def_line"].append(res_f["def_line_m"])
                    if res_f["formation"]:
                        form_votes[t].append(res_f["formation"])
                if t_gaps:
                    frame_gaps.extend(t_gaps)
                    worst_g = max(t_gaps, key=lambda g: g["gap_m"])
                    ekey = f"gap_{t}"
                    if worst_g["gap_m"] >= 16.5 and time_s - last_event_t.get(ekey, -99.0) >= 3.2:
                        last_event_t[ekey] = time_s
                        timeline_events.append(
                            {
                                "type": "defensive_gap",
                                "frame_id": fid,
                                "time_s": time_s,
                                "team_id": t,
                                "value": worst_g["gap_m"],
                                "label_ar": f"ثغرة دفاعية {worst_g['gap_m']}م",
                            }
                        )

        # Voronoi Pitch Control across all calibrated players + GKs
        pl_all = (
            f_dets[f_dets["role"].isin(["player", "goalkeeper"]) & f_dets["on_pitch"] & f_dets["team_id"].isin([0, 1])]
            if not f_dets.empty
            else pd.DataFrame()
        )
        vor_cells, pitch_ctrl, id_areas = compute_voronoi_pitch_control(pl_all)
        if "0" in pitch_ctrl and "1" in pitch_ctrl:
            vor_team_pcts[0].append(pitch_ctrl["0"])
            vor_team_pcts[1].append(pitch_ctrl["1"])
        for ikey, area in id_areas.items():
            vor_by_identity[ikey].append(area)

        # Sprint event detection (>= 25.2 km/h)
        if not pl_all.empty and "speed_kmh" in pl_all.columns:
            fast = pl_all[pl_all["speed_kmh"] >= 25.2]
            if not fast.empty:
                top_f = fast.sort_values("speed_kmh", ascending=False).iloc[0]
                ikey = str(top_f.get("identity_key") or "")
                ekey = f"sprint_{ikey}"
                if time_s - last_event_t.get(ekey, -99.0) >= 4.0:
                    last_event_t[ekey] = time_s
                    timeline_events.append(
                        {
                            "type": "sprint",
                            "frame_id": fid,
                            "time_s": time_s,
                            "team_id": int(top_f["team_id"]),
                            "identity_key": ikey,
                            "value": float(top_f["speed_kmh"]),
                            "label_ar": f"انطلاقة سريعة {float(top_f['speed_kmh']):.1f} كم/س",
                        }
                    )

        # Possession & passing lanes from calibrated ball
        poss_team = None
        carrier_tid = None
        carrier_id = None
        lanes: list[dict] = []
        if not f_dets.empty:
            b_sub = f_dets[(f_dets["role"] == "ball") & f_dets["on_pitch"]]
            if not b_sub.empty and not pl_all.empty:
                bx, by = float(b_sub.iloc[0]["x_m"]), float(b_sub.iloc[0]["y_m"])
                d_m = np.hypot(pl_all["x_m"].to_numpy() - bx, pl_all["y_m"].to_numpy() - by)
                ni = int(np.argmin(d_m))
                if float(d_m[ni]) <= 4.5:
                    c_row = pl_all.iloc[ni]
                    poss_team = int(c_row["team_id"])
                    carrier_tid = int(c_row["track_id"])
                    carrier_id = str(c_row.get("identity_key") or "")
                    if carrier_id:
                        carrier_frames_by_id[carrier_id] += 1
                    if poss_team == 0:
                        t0_poss += 1
                    else:
                        t1_poss += 1
                    if prev_poss_team is not None and poss_team != prev_poss_team and time_s - last_event_t.get("poss", -99.0) >= 2.5:
                        last_event_t["poss"] = time_s
                        timeline_events.append(
                            {
                                "type": "possession_shift",
                                "frame_id": fid,
                                "time_s": time_s,
                                "team_id": poss_team,
                                "label_ar": "تحول استحواذ",
                            }
                        )
                    prev_poss_team = poss_team
                    lanes = compute_passing_lanes(
                        c_row,
                        pl_all[pl_all["team_id"] == poss_team],
                        pl_all[pl_all["team_id"] != poss_team],
                        attack_dirs[poss_team],
                        h_inv_norm,
                    )
                    lbp = [ln for ln in lanes if ln["status"] == "line_breaking"]
                    if lbp:
                        if carrier_id:
                            lbp_by_id[carrier_id] += 1
                        if time_s - last_event_t.get("lbp", -99.0) >= 2.8:
                            last_event_t["lbp"] = time_s
                            best_l = lbp[0]
                            timeline_events.append(
                                {
                                    "type": "line_breaking_pass",
                                    "frame_id": fid,
                                    "time_s": time_s,
                                    "team_id": poss_team,
                                    "identity_key": carrier_id,
                                    "value": best_l["opponents_bypassed"],
                                    "label_ar": f"ممر كاسر لـ {best_l['opponents_bypassed']} خصوم (xPass {best_l['xpass_pct']}%)",
                                }
                            )

        frame_tactics[fid] = {
            "frame_id": fid,
            "time_s": time_s,
            "shot_id": int(frow["shot_id"]),
            "cal_src": cal_src,
            "cal_err_px": round(float(frow["cal_err_px"]), 3) if pd.notna(frow["cal_err_px"]) else None,
            "kp_count": int(frow["kp_count"]),
            "h_inv_norm": [[round(float(x), 7) for x in r] for r in h_inv_norm.tolist()] if h_inv_norm is not None else None,
            "camera_fov_m": cam_fov,
            "poss_team": poss_team,
            "ball_carrier_track_id": carrier_tid,
            "ball_carrier_identity": carrier_id,
            "formations": teams_frame,
            "passing_lanes": lanes,
            "voronoi_cells": vor_cells,
            "pitch_control": pitch_ctrl,
            "defensive_gaps": frame_gaps,
        }

    # ---------------- Persistent Individual Player Portfolios (Grouped by Stitched identity_key) ----------------
    portfolios_out: list[dict] = []
    if not df_dets.empty:
        person_cal = df_dets[(df_dets["role"] != "ball") & df_dets["on_pitch"] & (df_dets["identity_key"] != "")].copy()
        for ikey, grp_id in person_cal.groupby("identity_key"):
            grp_id = grp_id.sort_values("frame_id")
            if len(grp_id) < 4:
                continue

            role = str(grp_id["role"].mode().iloc[0])
            team_id = int(grp_id["team_id"].mode().iloc[0])
            if role == "referee" or team_id not in (0, 1):
                continue

            # Compute kinematics safely within each (shot_id, track_id) sub-segment so shot jumps never add fake distance
            step_dists: list[float] = []
            step_speeds: list[float] = []
            hir_dist = 0.0
            sprint_dist = 0.0
            sprint_count = 0
            in_sprint = False
            speed_series: list[dict] = []
            total_dt_s = 0.0

            for (_sid, _tid), sub in grp_id.groupby(["shot_id", "track_id"]):
                sub = sub.sort_values("frame_id")
                if len(sub) < 2:
                    continue
                xs = sub["x_m"].rolling(3, min_periods=1, center=True).median().to_numpy(dtype=np.float64)
                ys = sub["y_m"].rolling(3, min_periods=1, center=True).median().to_numpy(dtype=np.float64)
                ts = sub["time_s"].to_numpy(dtype=np.float64)
                for k in range(1, len(ts)):
                    dt = ts[k] - ts[k - 1]
                    if dt <= 0.01 or dt > 0.45:
                        in_sprint = False
                        continue
                    d = float(np.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]))
                    v_kmh = (d / dt) * 3.6
                    if v_kmh > 38.0:
                        continue
                    step_dists.append(d)
                    step_speeds.append(v_kmh)
                    total_dt_s += dt
                    if v_kmh >= 19.8:
                        hir_dist += d
                    if v_kmh >= 25.2:
                        sprint_dist += d
                        if not in_sprint:
                            sprint_count += 1
                            in_sprint = True
                    else:
                        in_sprint = False
                    speed_series.append({"t": round(float(ts[k]), 2), "kmh": round(v_kmh, 1)})

            if len(step_speeds) < 3:
                continue

            all_xs = grp_id["x_m"].to_numpy(dtype=np.float64)
            all_ys = grp_id["y_m"].to_numpy(dtype=np.float64)
            mean_x, mean_y = float(np.mean(all_xs)), float(np.mean(all_ys))
            roaming = float(np.hypot(np.std(all_xs), np.std(all_ys)))
            dist_m = float(sum(step_dists))
            dist_per_min = (dist_m / max(1.0, total_dt_s)) * 60.0
            max_v = float(np.percentile(step_speeds, 95))
            peak_v = float(np.max(step_speeds))
            avg_v = float(np.mean(step_speeds))
            avg_vor = float(np.mean(vor_by_identity[ikey])) if vor_by_identity.get(ikey) else 135.0
            c_frames = int(carrier_frames_by_id.get(ikey, 0))
            lbp_cnt = int(lbp_by_id.get(ikey, 0))

            role_code, role_ar = _infer_role_from_zone(mean_x, mean_y, attack_dirs.get(team_id, 1), role)
            n_steps = len(step_speeds)
            reliability = "عالية" if n_steps >= 30 else ("متوسطة" if n_steps >= 14 else "محدودة (مقطع قصير)")

            # Transparent 0-100 Scorecard grounded strictly in real calibrated KPIs with Bayesian sample-size shrinkage
            phys_s = float(np.clip(48.0 + (max_v - 13.0) * 2.1 + min(12.0, hir_dist * 0.30), 40.0, 94.0))
            work_s = float(np.clip(48.0 + (dist_per_min - 60.0) * 0.45 + (avg_v - 5.5) * 1.8, 40.0, 94.0))
            vor_capped = min(340.0, avg_vor)
            space_s = float(np.clip(52.0 + (vor_capped - 85.0) * 0.14 + min(10.0, roaming * 0.6), 42.0, 92.0))
            prog_s = float(np.clip(54.0 + c_frames * 2.2 + lbp_cnt * 6.0, 46.0, 94.0))
            raw_overall = 0.28 * phys_s + 0.26 * work_s + 0.24 * space_s + 0.22 * prog_s
            rel_w = min(1.0, n_steps / 20.0)
            overall_s = round(63.0 * (1.0 - rel_w) + raw_overall * rel_w, 1)

            im = identity_meta.get(ikey) or {}
            portrait_file = im.get("portrait_file")
            portrait_url = f"/api/matches/{match_slug}/portraits/{portrait_file}" if (portrait_file and match_slug) else None

            # Sort speed series chronologically across merged tracklets and downsample cleanly to max 36 points
            speed_series.sort(key=lambda pt: pt["t"])
            if len(speed_series) > 36:
                step_ss = max(1, len(speed_series) // 36)
                speed_series = speed_series[::step_ss][:36]

            base_rec = {
                "identity_key": ikey,
                "track_id": int(grp_id["track_id"].mode().iloc[0]),
                "shot_id": int(grp_id["shot_id"].mode().iloc[0]),
                "source_track_ids": im.get("source_track_ids") or sorted(grp_id["track_id"].astype(int).unique().tolist()),
                "n_tracklets_merged": int(im.get("n_tracklets_merged", 1)),
                "n_shots": int(im.get("n_shots", grp_id["shot_id"].nunique())),
                "role": role,
                "inferred_role_code": role_code,
                "inferred_role_ar": role_ar,
                "team_id": team_id,
                "jersey_ocr": im.get("jersey_ocr"),
                "jersey_ocr_conf": im.get("jersey_ocr_conf", 0.0),
                "portrait_url": portrait_url,
                "portrait_type": im.get("portrait_type", "none"),
                "face_px_est": int(im.get("face_px_est", 10)),
                "n_cal_frames": int(len(grp_id)),
                "n_kin_steps": n_steps,
                "seconds_tracked": round(total_dt_s, 1),
                "sample_reliability_ar": reliability,
                "distance_m": round(dist_m, 1),
                "distance_per_min_m": round(dist_per_min, 1),
                "hir_distance_m": round(hir_dist, 1),
                "sprint_distance_m": round(sprint_dist, 1),
                "sprint_count": int(sprint_count),
                "max_speed_kmh": round(max_v, 1),
                "peak_speed_kmh": round(peak_v, 1),
                "avg_speed_kmh": round(avg_v, 1),
                "mean_x_m": round(mean_x, 2),
                "mean_y_m": round(mean_y, 2),
                "roaming_m": round(roaming, 1),
                "avg_voronoi_m2": round(avg_vor, 1),
                "ball_carrier_frames": c_frames,
                "line_breaking_options": lbp_cnt,
                "scorecard": {
                    "overall_score": overall_s,
                    "physical_score": round(phys_s, 1),
                    "workrate_score": round(work_s, 1),
                    "tactical_space_score": round(space_s, 1),
                    "progression_score": round(prog_s, 1),
                },
                "heatmap_12x8": _compute_heatmap_12x8(all_xs, all_ys),
                "speed_series": speed_series,
            }
            sc_vec = video_metrics_to_scouting_vector(base_rec)
            compat = evaluate_6x4_compatibility(sc_vec, role_code, video_telemetry=base_rec)
            base_rec["scouting_profile"] = sc_vec
            base_rec["compatibility"] = compat
            # Keep backwards-compatible tactical_fits list for any legacy consumer
            base_rec["tactical_fits"] = [
                {"system": f["name_ar"], "fit": f["verdict_ar"], "reason": " ".join(f["reasons"][:1])}
                for f in compat["formations"][:3]
            ]
            portfolios_out.append(base_rec)

    portfolios_out.sort(key=lambda r: (r["n_kin_steps"] >= 12, r["scorecard"]["overall_score"], r["distance_m"]), reverse=True)

    # V7 Individual Player Mistakes/Strengths Audit + Automatic Goal/Chance/Breakdown Forensics
    portfolios_out, gap_blame_by_fid = enrich_portfolios_with_mistakes_and_strengths(
        df_dets=df_dets,
        frame_tactics=frame_tactics,
        portfolios=portfolios_out,
        attack_dirs=attack_dirs,
    )
    key_sequences = extract_key_match_sequences(
        df_frames=df_frames,
        df_dets=df_dets,
        frame_tactics=frame_tactics,
        portfolios=portfolios_out,
        team_names={"0": "الفريق 1", "1": "الفريق 2"},
        attack_dirs=attack_dirs,
        gap_blame_by_fid=gap_blame_by_fid,
    )

    wide_df = df_frames[df_frames["is_wide"]] if not df_frames.empty else df_frames
    cal_df = df_frames[df_frames["cal_src"] != "none"] if not df_frames.empty else df_frames
    kp_df = df_frames[df_frames["cal_src"] == "keypoints"] if not df_frames.empty else df_frames
    prop_df = df_frames[df_frames["cal_src"] == "propagated"] if not df_frames.empty else df_frames
    cal_wide = df_frames[df_frames["is_wide"] & (df_frames["cal_src"] != "none")] if not df_frames.empty else df_frames
    rep_vals = kp_df["cal_err_px"].dropna().to_numpy(dtype=float) if not kp_df.empty else np.array([])
    ball_rows = df_dets[df_dets["role"] == "ball"] if not df_dets.empty else pd.DataFrame()
    ball_cal = ball_rows[ball_rows["on_pitch"]] if not ball_rows.empty else pd.DataFrame()

    poss_n = t0_poss + t1_poss
    teams_summary = {}
    for t in (0, 1):
        gs = geom_stats[t]
        fv = form_votes[t]
        dom_form = Counter(fv).most_common(1)[0][0] if fv else None
        teams_summary[str(t)] = {
            "kit": team_palettes.get(str(t), {}),
            "attack_dir": attack_dirs[t],
            "formation": dom_form,
            "n_formation_frames": int(len(fv)),
            "n_geom_frames": int(len(gs["width"])),
            "avg_width_m": round(float(np.mean(gs["width"])), 1) if gs["width"] else None,
            "avg_length_m": round(float(np.mean(gs["length"])), 1) if gs["length"] else None,
            "avg_def_line_m": round(float(np.mean(gs["def_line"])), 1) if gs["def_line"] else None,
            "avg_voronoi_pct": round(float(np.mean(vor_team_pcts[t])), 1) if vor_team_pcts[t] else None,
        }

    pitch_control_summary = {
        "n_frames": int(len(vor_team_pcts[0])),
        "team_0_pct": round(float(np.mean(vor_team_pcts[0])), 1) if vor_team_pcts[0] else None,
        "team_1_pct": round(float(np.mean(vor_team_pcts[1])), 1) if vor_team_pcts[1] else None,
    }

    summary = {
        "version": "7.0",
        "fps": round(float(fps), 2),
        "calibration": {
            "processed_frames": int(len(df_frames)),
            "wide_frames": int(len(wide_df)),
            "calibrated_frames": int(len(cal_df)),
            "keyframe_solves": int(len(kp_df)),
            "propagated_frames": int(len(prop_df)),
            "wide_cal_coverage_pct": round(100.0 * len(cal_wide) / max(1, len(wide_df)), 1),
            "median_rep_err_px": round(float(np.median(rep_vals)), 3) if len(rep_vals) else None,
            "ball_detected_frames": int(ball_rows["frame_id"].nunique()) if not ball_rows.empty else 0,
            "ball_calibrated_frames": int(ball_cal["frame_id"].nunique()) if not ball_cal.empty else 0,
        },
        "possession": {
            "n_ball_cal_frames": int(poss_n),
            "team_0_frames": int(t0_poss),
            "team_1_frames": int(t1_poss),
            "team_0_pct": round(100.0 * t0_poss / poss_n, 1) if poss_n >= 3 else None,
            "team_1_pct": round(100.0 * t1_poss / poss_n, 1) if poss_n >= 3 else None,
        },
        "pitch_control": pitch_control_summary,
        "identity_diagnostics": identity_diagnostics or {},
        "teams": teams_summary,
        "timeline_events": sorted(timeline_events, key=lambda e: e["time_s"])[:48],
        "key_sequences": key_sequences,
        "player_portfolios": portfolios_out,
        "tracked_players": portfolios_out,
    }
    return summary, frame_tactics, df_dets
