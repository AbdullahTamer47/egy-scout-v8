"""V5 clean analysis pipeline: team assignment, honest sample-counted metrics, and visual audit."""
from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

from engine.analytics import build_tactical_analytics
from engine.detector import track_and_calibrate_video
from engine.identity import stitch_match_identities
from engine.pitch import PITCH_L, PITCH_W, draw_pitch_overlay
from engine.teams import KitTeamSeparator, assign_goalkeeper_team

DATA_DIR = Path(r"D:\مدرب\scout5\data\matches")


def _hex_to_bgr(hex_str: str, fallback=(56, 189, 248)) -> tuple[int, int, int]:
    s = (hex_str or "").lstrip("#")
    if len(s) != 6:
        return fallback
    try:
        return (int(s[4:6], 16), int(s[2:4], 16), int(s[0:2], 16))
    except ValueError:
        return fallback


def assign_teams_and_roles(df_dets: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Cluster outfielders on calibrated pitch into Team 0/1, assign GK spatially, keep Referees=-1."""
    df = df_dets.copy()
    if df.empty:
        return df, {}

    df["team_id"] = -1
    df["team_conf"] = 0.0
    df["on_pitch"] = (
        (df["cal_src"] != "none")
        & df["x_m"].between(-2.5, PITCH_L + 2.5)
        & df["y_m"].between(-2.5, PITCH_W + 2.5)
    )

    kf_cols = [f"kf{i}" for i in range(11)]
    valid_kf = df[kf_cols].notna().all(axis=1)
    fit_mask = (
        (df["role"] == "player")
        & df["on_pitch"]
        & (df["bh_norm"] <= 0.24)
        & valid_kf
    )

    # Fallback only to wide grass players if video has very few calibrated frames
    fit_df = df.loc[fit_mask]
    if len(fit_df) < 16:
        fit_df = df.loc[(df["role"] == "player") & (df["bh_norm"] <= 0.24) & valid_kf]

    palettes: dict = {}
    if len(fit_df) >= 12:
        step = max(1, len(fit_df) // 500)
        sample_X = fit_df.iloc[::step][kf_cols].to_numpy(dtype=np.float32)[:500]
        sep = KitTeamSeparator()
        sep.fit(sample_X)
        palettes = sep.palettes

        pred_mask = (df["role"] == "player") & valid_kf
        if pred_mask.any():
            X_all = df.loc[pred_mask, kf_cols].to_numpy(dtype=np.float32)
            lbls, confs = sep.predict(X_all)
            df.loc[pred_mask, "team_id"] = lbls
            df.loc[pred_mask, "team_conf"] = confs

        # Track-level confidence-weighted majority smoothing per (shot_id, track_id)
        for (sid, tid), grp_idx in df.loc[df["role"] == "player"].groupby(["shot_id", "track_id"]).groups.items():
            grp = df.loc[grp_idx]
            valid = grp[grp["team_id"].isin([0, 1])]
            if len(valid) == 0:
                continue
            w0 = float(valid.loc[valid["team_id"] == 0, "team_conf"].sum())
            w1 = float(valid.loc[valid["team_id"] == 1, "team_conf"].sum())
            maj = 0 if w0 >= w1 else 1
            df.loc[grp_idx, "team_id"] = maj

    # Assign goalkeepers per frame by nearest team outfield centroid, smoothed per track
    gk_mask = (df["role"] == "goalkeeper") & df["on_pitch"]
    if gk_mask.any():
        by_fid = df[df["on_pitch"] & df["team_id"].isin([0, 1])].groupby("frame_id")
        gk_votes: dict[tuple[int, int], list[int]] = defaultdict(list)
        for idx, row in df.loc[gk_mask].iterrows():
            fid = int(row["frame_id"])
            if fid not in by_fid.groups:
                continue
            f_rows = df.loc[by_fid.groups[fid]]
            t0_xy = f_rows.loc[f_rows["team_id"] == 0, ["x_m", "y_m"]].to_numpy(dtype=np.float32)
            t1_xy = f_rows.loc[f_rows["team_id"] == 1, ["x_m", "y_m"]].to_numpy(dtype=np.float32)
            t_gk = assign_goalkeeper_team(np.array([row["x_m"], row["y_m"]], dtype=np.float32), t0_xy, t1_xy)
            if t_gk in (0, 1):
                df.at[idx, "team_id"] = t_gk
                gk_votes[(int(row["shot_id"]), int(row["track_id"]))].append(t_gk)

        for (sid, tid), votes in gk_votes.items():
            maj = 0 if votes.count(0) >= votes.count(1) else 1
            df.loc[(df["shot_id"] == sid) & (df["track_id"] == tid) & (df["role"] == "goalkeeper"), "team_id"] = maj

    return df, palettes


def compute_core_metrics(
    df_frames: pd.DataFrame,
    df_dets: pd.DataFrame,
    team_palettes: dict,
    fps: float,
) -> dict:
    """Compute Stage 2+3 quality report and core match metrics with explicit sample sizes."""
    wide_df = df_frames[df_frames["is_wide"]] if not df_frames.empty else df_frames
    cal_df = df_frames[df_frames["cal_src"] != "none"] if not df_frames.empty else df_frames
    kp_df = df_frames[df_frames["cal_src"] == "keypoints"] if not df_frames.empty else df_frames
    prop_df = df_frames[df_frames["cal_src"] == "propagated"] if not df_frames.empty else df_frames
    cal_wide = df_frames[df_frames["is_wide"] & (df_frames["cal_src"] != "none")] if not df_frames.empty else df_frames

    rep_vals = kp_df["cal_err_px"].dropna().to_numpy(dtype=float) if not kp_df.empty else np.array([])
    ball_rows = df_dets[df_dets["role"] == "ball"] if not df_dets.empty else pd.DataFrame()
    ball_cal = ball_rows[ball_rows["on_pitch"]] if not ball_rows.empty else pd.DataFrame()

    cal_quality = {
        "processed_frames": int(len(df_frames)),
        "wide_frames": int(len(wide_df)),
        "calibrated_frames": int(len(cal_df)),
        "keyframe_solves": int(len(kp_df)),
        "propagated_frames": int(len(prop_df)),
        "wide_cal_coverage_pct": round(100.0 * len(cal_wide) / max(1, len(wide_df)), 1),
        "median_rep_err_px": round(float(np.median(rep_vals)), 3) if len(rep_vals) else None,
        "ball_detected_frames": int(ball_rows["frame_id"].nunique()) if not ball_rows.empty else 0,
        "ball_calibrated_frames": int(ball_cal["frame_id"].nunique()) if not ball_cal.empty else 0,
    }

    # Filtered track kinematics ONLY across consecutive calibrated on-pitch frames inside same shot
    players_out: list[dict] = []
    if not df_dets.empty:
        person_cal = df_dets[(df_dets["role"] != "ball") & df_dets["on_pitch"]].copy()
        for (sid, tid), grp in person_cal.groupby(["shot_id", "track_id"]):
            grp = grp.sort_values("frame_id")
            if len(grp) < 5:
                continue
            xs = grp["x_m"].rolling(3, min_periods=1, center=True).median().to_numpy(dtype=np.float64)
            ys = grp["y_m"].rolling(3, min_periods=1, center=True).median().to_numpy(dtype=np.float64)
            ts = grp["time_s"].to_numpy(dtype=np.float64)

            step_dists: list[float] = []
            step_speeds: list[float] = []
            for k in range(1, len(ts)):
                dt = ts[k] - ts[k - 1]
                if dt <= 0.01 or dt > 0.40:
                    continue
                d = float(np.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]))
                v_kmh = (d / dt) * 3.6
                if v_kmh > 38.0:  # reject instantaneous homography/ID jump outliers
                    continue
                step_dists.append(d)
                step_speeds.append(v_kmh)

            if len(step_speeds) < 4:
                continue
            roles = grp["role"].tolist()
            role = max(set(roles), key=roles.count)
            tids = grp["team_id"].tolist()
            team_id = max(set(tids), key=tids.count)
            players_out.append(
                {
                    "track_id": int(tid),
                    "shot_id": int(sid),
                    "role": role,
                    "team_id": int(team_id),
                    "n_cal_frames": int(len(grp)),
                    "n_kin_steps": int(len(step_speeds)),
                    "distance_m": round(float(sum(step_dists)), 1),
                    "max_speed_kmh": round(float(np.percentile(step_speeds, 95)), 1),
                    "avg_speed_kmh": round(float(np.mean(step_speeds)), 1),
                    "mean_x_m": round(float(np.mean(xs)), 2),
                    "mean_y_m": round(float(np.mean(ys)), 2),
                }
            )
    players_out.sort(key=lambda r: r["distance_m"], reverse=True)

    # Honest possession over calibrated frames with ball inside 4.5 m of a player
    t0_poss, t1_poss = 0, 0
    if not ball_cal.empty:
        pl_cal = df_dets[(df_dets["role"].isin(["player", "goalkeeper"])) & df_dets["on_pitch"] & df_dets["team_id"].isin([0, 1])]
        pl_by_fid = pl_cal.groupby("frame_id")
        for _, brow in ball_cal.iterrows():
            fid = int(brow["frame_id"])
            if fid not in pl_by_fid.groups:
                continue
            prows = df_dets.loc[pl_by_fid.groups[fid]]
            d_m = np.hypot(prows["x_m"].to_numpy() - float(brow["x_m"]), prows["y_m"].to_numpy() - float(brow["y_m"]))
            nearest_i = int(np.argmin(d_m))
            if float(d_m[nearest_i]) <= 4.5:
                t_own = int(prows.iloc[nearest_i]["team_id"])
                if t_own == 0:
                    t0_poss += 1
                else:
                    t1_poss += 1

    poss_n = t0_poss + t1_poss
    possession = {
        "n_ball_cal_frames": int(poss_n),
        "team_0_frames": int(t0_poss),
        "team_1_frames": int(t1_poss),
        "team_0_pct": round(100.0 * t0_poss / poss_n, 1) if poss_n >= 3 else None,
        "team_1_pct": round(100.0 * t1_poss / poss_n, 1) if poss_n >= 3 else None,
    }

    # Per-team tactical geometry over calibrated frames with >= 4 outfielders
    teams_summary: dict[str, dict] = {}
    outfield = df_dets[(df_dets["role"] == "player") & df_dets["on_pitch"] & df_dets["team_id"].isin([0, 1])] if not df_dets.empty else pd.DataFrame()
    for t in (0, 1):
        widths, lengths, def_lines, high_lines = [], [], [], []
        if not outfield.empty:
            sub = outfield[outfield["team_id"] == t]
            for _, grp in sub.groupby("frame_id"):
                if len(grp) < 4:
                    continue
                xs = np.sort(grp["x_m"].to_numpy(dtype=float))
                ys = grp["y_m"].to_numpy(dtype=float)
                widths.append(float(ys.max() - ys.min()))
                lengths.append(float(xs.max() - xs.min()))
                def_lines.append(float(xs[0]))
                high_lines.append(float(xs[-1]))
        teams_summary[str(t)] = {
            "kit": team_palettes.get(str(t), {}),
            "n_geom_frames": int(len(widths)),
            "avg_width_m": round(float(np.mean(widths)), 1) if widths else None,
            "avg_length_m": round(float(np.mean(lengths)), 1) if lengths else None,
            "min_x_m_mean": round(float(np.mean(def_lines)), 1) if def_lines else None,
            "max_x_m_mean": round(float(np.mean(high_lines)), 1) if high_lines else None,
        }

    return {
        "fps": round(float(fps), 2),
        "calibration": cal_quality,
        "possession": possession,
        "teams": teams_summary,
        "tracked_players": players_out,
    }


def render_verification_grid(
    video_path: str | Path,
    df_frames: pd.DataFrame,
    df_dets: pd.DataFrame,
    team_palettes: dict,
    out_path: str | Path,
    label: str = "",
) -> Path | None:
    """Render a 2x2 visual audit grid with calibrated FIFA chalk lines, foot rings, and NO-CAL indicator."""
    if df_frames.empty:
        return None
    kp_rows = df_frames[df_frames["cal_src"] == "keypoints"]
    prop_rows = df_frames[df_frames["cal_src"] == "propagated"]
    none_rows = df_frames[df_frames["cal_src"] == "none"]

    picks: list[pd.Series] = []
    if not kp_rows.empty:
        picks.append(kp_rows.iloc[0])
        if len(kp_rows) >= 3:
            picks.append(kp_rows.iloc[len(kp_rows) // 2])
    if not prop_rows.empty:
        picks.append(prop_rows.iloc[len(prop_rows) // 2])
    if not none_rows.empty and len(picks) < 4:
        picks.append(none_rows.iloc[len(none_rows) // 2])
    for extra in (kp_rows, prop_rows, none_rows):
        step_i = max(1, len(extra) // 4)
        for j in range(0, len(extra), step_i):
            if len(picks) >= 4:
                break
            cand = extra.iloc[j]
            if not any(int(p["frame_id"]) == int(cand["frame_id"]) for p in picks):
                picks.append(cand)
    if not picks:
        picks.append(df_frames.iloc[0])

    wanted = {int(r["frame_id"]): r for r in picks}
    frames_bgr: dict[int, np.ndarray] = {}
    cap = cv2.VideoCapture(str(video_path))
    try:
        max_f = max(wanted.keys())
        cur = 0
        while cur <= max_f:
            if not cap.grab():
                break
            if cur in wanted:
                ok, fr = cap.retrieve()
                if ok and fr is not None:
                    frames_bgr[cur] = fr
            cur += 1
    finally:
        cap.release()

    c0 = _hex_to_bgr(team_palettes.get("0", {}).get("ring", "#f43f5e"), (94, 63, 244))
    c1 = _hex_to_bgr(team_palettes.get("1", {}).get("ring", "#38bdf8"), (248, 189, 56))

    tiles: list[np.ndarray] = []
    for r in picks:
        fid = int(r["frame_id"])
        fr = frames_bgr.get(fid)
        if fr is None:
            continue
        cal_src = str(r["cal_src"])
        if cal_src != "none":
            H = np.array([r[f"h{i}"] for i in range(9)], dtype=np.float64).reshape(3, 3)
            vis = draw_pitch_overlay(fr, H, color=(0, 255, 255), thickness=2)
        else:
            vis = fr.copy()

        f_dets = df_dets[df_dets["frame_id"] == fid] if not df_dets.empty else pd.DataFrame()
        for _, d in f_dets.iterrows():
            role = str(d["role"])
            u, v = int(round(float(d["u"]))), int(round(float(d["v"])))
            if role == "ball":
                cv2.circle(vis, (u, v), 9, (0, 255, 255), 2)
                cv2.putText(vis, "BALL", (u + 8, v - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
                continue
            tid = int(d["team_id"])
            col = (0, 140, 255) if role == "referee" else (c0 if tid == 0 else (c1 if tid == 1 else (160, 160, 160)))
            cv2.ellipse(vis, (u, v), (14, 6), 0, 0, 360, col, 2)
            tag_txt = "REF" if role == "referee" else (f"GK{tid}" if role == "goalkeeper" else f"#{int(d['track_id'])}")
            if cal_src != "none" and pd.notna(d["x_m"]):
                tag_txt += f" ({float(d['x_m']):.0f},{float(d['y_m']):.0f})"
            cv2.putText(vis, tag_txt, (u - 16, max(14, v - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.38, col, 1, cv2.LINE_AA)

        err_s = f"err={float(r['cal_err_px']):.1f}px" if pd.notna(r["cal_err_px"]) else ""
        hud = f"{label} f={fid} shot={int(r['shot_id'])} | cal={cal_src} {err_s}".strip()
        hud_col = (0, 255, 255) if cal_src != "none" else (0, 80, 255)
        cv2.rectangle(vis, (8, 8), (min(vis.shape[1] - 8, 560), 38), (15, 20, 30), -1)
        cv2.putText(vis, hud, (14, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.58, hud_col, 2, cv2.LINE_AA)
        tiles.append(cv2.resize(vis, (640, 360)))

    if not tiles:
        return None
    while len(tiles) < 4:
        tiles.append(np.zeros_like(tiles[0]))
    grid = np.vstack([np.hstack([tiles[0], tiles[1]]), np.hstack([tiles[2], tiles[3]])])
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), grid, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return out


def run_match_v5(
    match_slug: str,
    video_path: str | Path,
    stride: int = 2,
    pnl_interval: int = 12,
    max_frames: int | None = None,
    start_frame: int = 0,
    progress_cb: Callable[[float, str], None] | None = None,
) -> dict:
    """Execute Stages 1+2+3 cleanly on one match video and save telemetry + frame_tactics + visual audit."""
    out_dir = DATA_DIR / match_slug
    out_dir.mkdir(parents=True, exist_ok=True)

    df_frames, df_dets, meta = track_and_calibrate_video(
        video_path=video_path,
        stride=stride,
        pnl_interval=pnl_interval,
        max_frames=max_frames,
        start_frame=start_frame,
        progress_cb=progress_cb,
    )
    return finalize_match_v5(match_slug, video_path, df_frames, df_dets, meta, progress_cb=progress_cb)


def finalize_match_v5(
    match_slug: str,
    video_path: str | Path,
    df_frames: pd.DataFrame,
    df_dets: pd.DataFrame,
    meta: dict,
    progress_cb: Callable[[float, str], None] | None = None,
    enable_ocr: bool = True,
) -> dict:
    """Re-run V6 Stage 2+3 identity stitching, portraits/OCR, 3D AR tactics & visual audit."""
    out_dir = DATA_DIR / match_slug
    out_dir.mkdir(parents=True, exist_ok=True)

    df_dets, palettes = assign_teams_and_roles(df_dets)
    if progress_cb:
        progress_cb(0.84, "ربط الهويات عبر اللقطات واستخراج البورتريه والأرقام...")
    df_dets, id_meta, id_diag = stitch_match_identities(
        df_dets=df_dets,
        video_path=video_path,
        portraits_dir=out_dir / "portraits",
        enable_ocr=enable_ocr,
    )
    if progress_cb:
        progress_cb(0.92, "حساب Voronoi والفجوات الدفاعية وبروفايلات اللاعبين...")
    summary, frame_tactics, df_dets = build_tactical_analytics(
        df_frames,
        df_dets,
        palettes,
        meta["fps"],
        match_slug=match_slug,
        identity_meta=id_meta,
        identity_diagnostics=id_diag,
    )
    summary["match_slug"] = match_slug
    summary["video_path"] = str(video_path)
    summary["meta"] = meta

    df_frames.to_parquet(out_dir / "frames.parquet", index=False)
    df_dets.to_parquet(out_dir / "telemetry.parquet", index=False)
    (out_dir / "frame_tactics.json").write_text(
        json.dumps({str(k): v for k, v in frame_tactics.items()}, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    render_verification_grid(
        video_path=video_path,
        df_frames=df_frames,
        df_dets=df_dets,
        team_palettes=palettes,
        out_path=out_dir / "audit_grid.jpg",
        label=match_slug,
    )
    if progress_cb:
        progress_cb(1.0, "اكتمل التحليل التنفيذي V6 بنجاح")
    return summary
