"""Tactical analytics computed from real pitch coordinates (meters, 105x68):
attack direction, Voronoi space control, possession & event inference, formations, unit lines,
team shape metrics, expected threat (xT, Markov value iteration on open StatsBomb event data)."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from shapely import MultiPoint, Point, box as shp_box, voronoi_polygons
from shapely.geometry import LineString
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score

from core.config import (
    OFFBALL_RUN_SPEED_KMH,
    PITCH_LENGTH as L,
    PITCH_WIDTH as W,
    PRESSING_RADIUS_M,
    PRESSING_SPEED_KMH,
)

PITCH_BOX = shp_box(0.0, 0.0, L, W)
XT_COLS, XT_ROWS = 12, 8
POSSESSION_RADIUS_M = 4.5
MIN_POSSESSION_FRAMES = 2


# ---------------------------------------------------------------- attack direction
def attack_directions(people: pd.DataFrame, chunk_frames: int = 1500) -> dict[int, dict[int, int]]:
    """For each time chunk, the team whose players sit deeper on the left attacks +X (dir=+1).
    Returns {chunk_index: {team_id: +1/-1}}. Handles half-time switches across a full match."""
    out: dict[int, dict[int, int]] = {}
    df = people[people["team_id"].isin([0, 1])]
    if df.empty:
        return out
    df = df.assign(chunk=(df["frame_id"] // chunk_frames).astype(int))
    global_med = df.groupby("team_id")["x_m"].median()
    g_dir = {0: 1, 1: -1}
    if len(global_med) == 2:
        g_dir = {0: 1, 1: -1} if global_med[0] <= global_med[1] else {0: -1, 1: 1}
    for chunk, g in df.groupby("chunk"):
        med = g.groupby("team_id")["x_m"].median()
        if len(med) == 2 and abs(med[0] - med[1]) > 3.0:
            out[int(chunk)] = {0: 1, 1: -1} if med[0] < med[1] else {0: -1, 1: 1}
        else:
            out[int(chunk)] = dict(g_dir)
    return out


def team_dir(dirs: dict[int, dict[int, int]], frame_id: int, team: int, chunk_frames: int = 1500) -> int:
    d = dirs.get(int(frame_id // chunk_frames))
    if d is None:
        return 1 if team == 0 else -1
    return d.get(team, 1)


def att_x(x: np.ndarray | float, direction: int):
    """X re-oriented so the team always attacks towards 105."""
    return x if direction == 1 else L - x


# ---------------------------------------------------------------- voronoi
def voronoi_areas(points: np.ndarray) -> np.ndarray:
    """Area (m^2) of each point's Voronoi cell clipped to the pitch."""
    n = len(points)
    if n == 0:
        return np.array([])
    if n == 1:
        return np.array([L * W])
    pts = np.asarray(points, dtype=float)
    # jitter exact duplicates
    _, inv, cnt = np.unique(np.round(pts, 3), axis=0, return_inverse=True, return_counts=True)
    if (cnt > 1).any():
        pts = pts + np.arange(n)[:, None] * 1e-3
    cells = voronoi_polygons(MultiPoint([tuple(p) for p in pts]), extend_to=PITCH_BOX)
    areas = np.zeros(n)
    for cell in cells.geoms:
        clipped = cell.intersection(PITCH_BOX)
        if clipped.is_empty:
            continue
        for i, p in enumerate(pts):
            if areas[i] == 0 and cell.covers(Point(p)):
                areas[i] = clipped.area
                break
    return areas


# ---------------------------------------------------------------- expected threat
class ExpectedThreat:
    """12x8 xT grid solved by Markov value iteration on StatsBomb open-data events (cached)."""

    SB_BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data"

    def __init__(self, grid: np.ndarray | None):
        self.grid = grid  # shape (XT_COLS, XT_ROWS), indexed [col(x), row(y)]

    @property
    def available(self) -> bool:
        return self.grid is not None

    @classmethod
    def load_or_build(cls, cache_dir: Path, n_matches: int = 12, competition: int = 43, season: int = 3) -> ExpectedThreat:
        path = cache_dir / "xt_grid.json"
        if path.exists():
            return cls(np.array(json.loads(path.read_text())["grid"]))
        try:
            grid = cls._build(n_matches, competition, season)
        except Exception:
            return cls(None)
        path.write_text(json.dumps({"grid": grid.tolist(), "source": f"statsbomb open-data comp {competition} season {season}",
                                    "matches": n_matches}))
        return cls(grid)

    @classmethod
    def _cell(cls, x: float, y: float) -> tuple[int, int]:
        # StatsBomb pitch is 120x80
        c = min(XT_COLS - 1, max(0, int(x / 120.0 * XT_COLS)))
        r = min(XT_ROWS - 1, max(0, int(y / 80.0 * XT_ROWS)))
        return c, r

    @classmethod
    def _build(cls, n_matches: int, competition: int, season: int) -> np.ndarray:
        shots = np.zeros((XT_COLS, XT_ROWS))
        goals = np.zeros((XT_COLS, XT_ROWS))
        moves = np.zeros((XT_COLS, XT_ROWS))
        trans = np.zeros((XT_COLS, XT_ROWS, XT_COLS, XT_ROWS))
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            matches = client.get(f"{cls.SB_BASE}/matches/{competition}/{season}.json").json()
            for m in matches[:n_matches]:
                events = client.get(f"{cls.SB_BASE}/events/{m['match_id']}.json").json()
                for e in events:
                    t = e.get("type", {}).get("name")
                    loc = e.get("location")
                    if not loc:
                        continue
                    c, r = cls._cell(loc[0], loc[1])
                    if t == "Shot":
                        shots[c, r] += 1
                        if e.get("shot", {}).get("outcome", {}).get("name") == "Goal":
                            goals[c, r] += 1
                    elif t in ("Pass", "Carry"):
                        key = "pass" if t == "Pass" else "carry"
                        end = e.get(key, {}).get("end_location")
                        if not end:
                            continue
                        moves[c, r] += 1
                        if t == "Carry" or "outcome" not in e.get("pass", {}):
                            ec, er = cls._cell(end[0], end[1])
                            trans[c, r, ec, er] += 1
        total = shots + moves
        with np.errstate(divide="ignore", invalid="ignore"):
            s = np.where(total > 0, shots / total, 0.0)
            mv = np.where(total > 0, moves / total, 0.0)
            g = np.where(shots > 0, goals / shots, 0.0)
            T = np.where(moves[:, :, None, None] > 0, trans / moves[:, :, None, None], 0.0)
        xt = np.zeros((XT_COLS, XT_ROWS))
        for _ in range(50):
            new = s * g + mv * np.einsum("abcd,cd->ab", T, xt)
            if np.abs(new - xt).max() < 1e-7:
                xt = new
                break
            xt = new
        return xt

    def value(self, ax: float, y: float) -> float:
        """xT at an attack-normalised position (team attacks towards X=105)."""
        if self.grid is None:
            return float("nan")
        c = min(XT_COLS - 1, max(0, int(ax / L * XT_COLS)))
        r = min(XT_ROWS - 1, max(0, int(y / W * XT_ROWS)))
        return float(self.grid[c, r])


# ---------------------------------------------------------------- possession & events
def infer_possession(people: pd.DataFrame, ball: pd.DataFrame, stride: int) -> pd.DataFrame:
    """Per-frame possessor = nearest player to the ball within POSSESSION_RADIUS_M, with hysteresis."""
    if ball.empty or people.empty:
        return pd.DataFrame(columns=["frame_id", "possessor", "team_id", "ball_x", "ball_y"])
    b = ball.sort_values("frame_id").drop_duplicates("frame_id").set_index("frame_id")[["x_m", "y_m"]]
    all_frames = np.sort(people["frame_id"].unique())
    b = b.reindex(all_frames).interpolate(limit=int(10 / max(1, stride)), limit_area="inside")
    rows = []
    by_frame = {f: g for f, g in people[people["team_id"].isin([0, 1])].groupby("frame_id")}
    for f, (bx, by) in b.iterrows():
        g = by_frame.get(f)
        if g is None or np.isnan(bx):
            rows.append((f, None, -1, bx, by))
            continue
        d = np.hypot(g["x_m"].to_numpy() - bx, g["y_m"].to_numpy() - by)
        i = int(np.argmin(d))
        if d[i] <= POSSESSION_RADIUS_M:
            rows.append((f, g["identity"].iloc[i], int(g["team_id"].iloc[i]), bx, by))
        else:
            rows.append((f, None, -1, bx, by))
    pos = pd.DataFrame(rows, columns=["frame_id", "possessor", "team_id", "ball_x", "ball_y"])
    # hysteresis: a possessor must hold for MIN_POSSESSION_FRAMES processed frames
    stable_p: list = []
    stable_t: list = []
    cur_p, cur_t, cand, cand_n = None, -1, None, 0
    for p, t in zip(pos["possessor"], pos["team_id"]):
        if p is not None and p == cand:
            cand_n += 1
        else:
            cand, cand_n = p, 1
        if cand is not None and cand_n >= MIN_POSSESSION_FRAMES:
            cur_p, cur_t = cand, t
        stable_p.append(cur_p)
        stable_t.append(cur_t)
    pos["possessor"] = stable_p
    pos["team_id"] = stable_t
    return pos


def extract_events(pos: pd.DataFrame, positions: dict, dirs: dict, xt: ExpectedThreat, lines_at,
                   fps: float) -> pd.DataFrame:
    """Passes, line-breaking/progressive passes, losses/recoveries and progressive carries.
    positions: {(frame, identity): (x, y)}. lines_at(frame, team) -> list of LineString for that team's units."""
    events = []
    if pos.empty:
        return pd.DataFrame(events)
    seq = pos.dropna(subset=["possessor"])
    if seq.empty:
        return pd.DataFrame(events)
    seq = seq.assign(block=(seq["possessor"] != seq["possessor"].shift()).cumsum())
    blocks = []
    for _, g in seq.groupby("block"):
        blocks.append({"identity": g["possessor"].iloc[0], "team": int(g["team_id"].iloc[0]),
                       "start": int(g["frame_id"].iloc[0]), "end": int(g["frame_id"].iloc[-1])})

    def loc(frame, ident):
        return positions.get((frame, ident))

    for i, blk in enumerate(blocks):
        team, ident = blk["team"], blk["identity"]
        p0, p1 = loc(blk["start"], ident), loc(blk["end"], ident)
        # progressive carry: player moved the ball >= 10 m towards goal while in possession
        if p0 and p1:
            d = team_dir(dirs, blk["start"], team)
            fwd = att_x(p1[0], d) - att_x(p0[0], d)
            if fwd >= 10.0:
                xt_d = xt.value(att_x(p1[0], d), p1[1]) - xt.value(att_x(p0[0], d), p0[1])
                events.append({"type": "progressive_carry", "frame_id": blk["start"], "end_frame": blk["end"],
                               "identity": ident, "team_id": team, "x": p0[0], "y": p0[1], "end_x": p1[0],
                               "end_y": p1[1], "xt_delta": xt_d, "receiver": None})
        if i + 1 >= len(blocks):
            continue
        nxt = blocks[i + 1]
        if (nxt["start"] - blk["end"]) / fps > 4.0:
            continue  # ball lost track for too long - not a single action
        a, b = loc(blk["end"], ident), loc(nxt["start"], nxt["identity"])
        if not a or not b:
            continue
        d = team_dir(dirs, blk["end"], team)
        ax0, ax1 = att_x(a[0], d), att_x(b[0], d)
        if nxt["team"] == team:
            fwd = ax1 - ax0
            goal = np.array([L, W / 2])
            d0 = np.hypot(*(goal - np.array([ax0, a[1]])))
            d1 = np.hypot(*(goal - np.array([ax1, b[1]])))
            progressive = fwd >= 10.0 and d1 <= 0.75 * d0
            line_breaking = False
            if fwd > 10.0:
                seg = LineString([a, b])
                for line in lines_at(blk["end"], 1 - team):
                    if seg.intersects(line):
                        line_breaking = True
                        break
            xt_d = xt.value(ax1, b[1]) - xt.value(ax0, a[1])
            events.append({"type": "pass", "frame_id": blk["end"], "end_frame": nxt["start"], "identity": ident,
                           "team_id": team, "x": a[0], "y": a[1], "end_x": b[0], "end_y": b[1],
                           "receiver": nxt["identity"], "completed": True, "progressive": progressive,
                           "line_breaking": line_breaking, "xt_delta": xt_d})
        else:
            events.append({"type": "pass", "frame_id": blk["end"], "end_frame": nxt["start"], "identity": ident,
                           "team_id": team, "x": a[0], "y": a[1], "end_x": b[0], "end_y": b[1],
                           "receiver": None, "completed": False, "progressive": False, "line_breaking": False,
                           "xt_delta": 0.0})
            events.append({"type": "recovery", "frame_id": nxt["start"], "end_frame": nxt["start"],
                           "identity": nxt["identity"], "team_id": nxt["team"], "x": b[0], "y": b[1],
                           "end_x": b[0], "end_y": b[1], "receiver": None, "xt_delta": 0.0})
    return pd.DataFrame(events)


def detect_pressing(people: pd.DataFrame, pos: pd.DataFrame, positions: dict) -> pd.DataFrame:
    """Pressing action: opponent closes the ball carrier within 4 m at >= 18 km/h (once per possession block)."""
    out = []
    if pos.empty:
        return pd.DataFrame(out)
    pmap = pos.set_index("frame_id")
    seen: set = set()
    block_id = (pos["possessor"] != pos["possessor"].shift()).cumsum()
    block_of = dict(zip(pos["frame_id"], block_id))
    for f, g in people[people["team_id"].isin([0, 1])].groupby("frame_id"):
        if f not in pmap.index:
            continue
        carrier, cteam = pmap.at[f, "possessor"], pmap.at[f, "team_id"]
        if carrier is None or cteam not in (0, 1):
            continue
        c = positions.get((f, carrier))
        if not c:
            continue
        opp = g[(g["team_id"] == 1 - cteam) & (g["speed_kmh"] >= PRESSING_SPEED_KMH)]
        if opp.empty:
            continue
        d = np.hypot(opp["x_m"].to_numpy() - c[0], opp["y_m"].to_numpy() - c[1])
        for ident, dist in zip(opp["identity"], d):
            key = (ident, block_of[f])
            if dist <= PRESSING_RADIUS_M and key not in seen:
                seen.add(key)
                out.append({"type": "pressing", "frame_id": int(f), "end_frame": int(f), "identity": ident,
                            "team_id": int(1 - cteam), "x": c[0], "y": c[1], "end_x": c[0], "end_y": c[1],
                            "receiver": carrier, "xt_delta": 0.0})
    return pd.DataFrame(out)


def detect_offball_runs(people: pd.DataFrame, pos: pd.DataFrame, fps: float, stride: int) -> pd.DataFrame:
    """High-speed (>21 km/h) runs without the ball while the team has possession; flags runs that
    dragged the nearest opponent > 3 m and measures the team Voronoi space gained during the run."""
    out = []
    if pos.empty:
        return pd.DataFrame(out)
    poss_team = dict(zip(pos["frame_id"], pos["team_id"]))
    possessor = dict(zip(pos["frame_id"], pos["possessor"]))
    by_frame = {f: g for f, g in people.groupby("frame_id")}
    team_space = people.groupby(["frame_id", "team_id"])["voronoi_m2"].sum().to_dict()
    min_len = max(2, int(0.5 * fps / max(1, stride)))
    for ident, g in people[people["team_id"].isin([0, 1])].groupby("identity"):
        g = g.sort_values("frame_id")
        team = int(g["team_id"].iloc[0])
        mask = ((g["speed_kmh"] > OFFBALL_RUN_SPEED_KMH)
                & (g["frame_id"].map(poss_team) == team)
                & (g["frame_id"].map(possessor) != ident)).to_numpy()
        frames = g["frame_id"].to_numpy()
        i = 0
        while i < len(mask):
            if not mask[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(mask) and mask[j + 1] and frames[j + 1] - frames[j] <= 3 * stride:
                j += 1
            if j - i + 1 >= min_len:
                f0, f1 = int(frames[i]), int(frames[j])
                x0, y0 = g["x_m"].iloc[i], g["y_m"].iloc[i]
                dragged = False
                g0, g1 = by_frame.get(f0), by_frame.get(f1)
                if g0 is not None and g1 is not None:
                    opp0 = g0[g0["team_id"] == 1 - team]
                    if not opp0.empty:
                        d = np.hypot(opp0["x_m"].to_numpy() - x0, opp0["y_m"].to_numpy() - y0)
                        k = int(np.argmin(d))
                        if d[k] <= 10.0:
                            oid = opp0["identity"].iloc[k]
                            o1 = g1[g1["identity"] == oid]
                            if not o1.empty:
                                moved = np.hypot(o1["x_m"].iloc[0] - opp0["x_m"].iloc[k],
                                                 o1["y_m"].iloc[0] - opp0["y_m"].iloc[k])
                                dragged = bool(moved > 3.0)
                gain = team_space.get((f1, team), np.nan) - team_space.get((f0, team), np.nan)
                out.append({"type": "offball_run", "frame_id": f0, "end_frame": f1, "identity": ident,
                            "team_id": team, "x": x0, "y": y0, "end_x": g["x_m"].iloc[j], "end_y": g["y_m"].iloc[j],
                            "receiver": None, "xt_delta": 0.0, "dragged_defender": dragged,
                            "space_gain_m2": float(gain) if np.isfinite(gain) else 0.0})
            i = j + 1
    return pd.DataFrame(out)


# ---------------------------------------------------------------- formations
def detect_formation(avg_ax: dict[str, float]) -> tuple[str, dict[str, int]]:
    """Cluster outfield average attack-normalised X positions into 3 or 4 lines.
    Returns (formation string, {identity: line_index (0 = defence)})."""
    if len(avg_ax) < 7:
        return "", {}
    ids = list(avg_ax.keys())
    X = np.array([avg_ax[i] for i in ids]).reshape(-1, 1)
    best = None
    for k in (3, 4):
        if len(ids) <= k:
            continue
        km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(X)
        if len(set(km.labels_)) < k:
            continue
        score = silhouette_score(X, km.labels_)
        sizes = np.bincount(km.labels_)
        if sizes.min() < 1:
            continue
        if k == 4:
            score -= 0.03  # prefer simpler structure unless 4 lines are clearly separated
        if best is None or score > best[0]:
            best = (score, km)
    if best is None:
        return "", {}
    km = best[1]
    order = np.argsort(km.cluster_centers_.reshape(-1))
    rank = {int(c): r for r, c in enumerate(order)}
    lines = {ids[i]: rank[int(l)] for i, l in enumerate(km.labels_)}
    counts = np.bincount([lines[i] for i in ids], minlength=len(order))
    return "-".join(str(int(c)) for c in counts), lines


# ---------------------------------------------------------------- team shape per frame
def team_shape(ax: np.ndarray, y: np.ndarray) -> dict:
    if len(ax) < 6:
        return {}
    order = np.sort(ax)
    deep = order[:4]
    hull_area = MultiPoint(list(zip(ax, y))).convex_hull.area
    return {"def_line_height_m": float(deep.mean()), "width_m": float(y.max() - y.min()),
            "length_m": float(ax.max() - ax.min()), "compactness_m2": float(hull_area)}


def unit_lines_for_frame(frame_people: pd.DataFrame, line_map: dict[str, int]) -> list[dict]:
    """Chains of players per tactical line (sorted across the pitch width)."""
    out = []
    for team in (0, 1):
        g = frame_people[frame_people["team_id"] == team]
        lm = line_map.get(team, {})
        buckets: dict[int, list] = defaultdict(list)
        for _, r in g.iterrows():
            li = lm.get(r["identity"])
            if li is not None:
                buckets[li].append(r)
        for li, members in buckets.items():
            if len(members) < 2:
                continue
            members.sort(key=lambda r: r["y_m"])
            out.append({"team": team, "line": int(li),
                        "points": [{"u_norm": float(r["u_norm"]), "v_norm": float(r["v_norm"]),
                                    "x_m": float(r["x_m"]), "y_m": float(r["y_m"])} for r in members]})
    return out

