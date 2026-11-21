"""V6 Honest Player Identity Engine: Cross-Shot Re-ID, Jersey OCR, and Close-Up Portrait Extraction.

Important transparency note:
On standard wide-angle broadcast football footage (720p/1080p), a player's face spans only
6-14 pixels — far below the >= 60px threshold needed for reliable biometric face recognition.
Professional platforms (SkillCorner, Second Spectrum, TRACAB) therefore combine:
  1. Cross-Shot Appearance + Spatial Zone Re-ID stitching
  2. Jersey Number OCR on sharp/close-up torso crops
  3. Upper-body / close-up portrait extraction
  4. 1-Click Roster Identity Binding persisted in the club database
"""
from __future__ import annotations

import os
import re
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

EASYOCR_CACHE = Path(r"D:\مدرب\.cache\easyocr")
_OCR_READER = None
_FACE_CASCADE = None


def _get_face_cascade():
    global _FACE_CASCADE
    if _FACE_CASCADE is None:
        try:
            xml = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
            if xml.exists():
                _FACE_CASCADE = cv2.CascadeClassifier(str(xml))
        except Exception:
            _FACE_CASCADE = False
    return _FACE_CASCADE if _FACE_CASCADE is not False else None


def _get_ocr_reader():
    """Lazy-load EasyOCR strictly into D:\\مدرب\\.cache\\easyocr (never filling C:)."""
    global _OCR_READER
    if _OCR_READER is None:
        try:
            EASYOCR_CACHE.mkdir(parents=True, exist_ok=True)
            os.environ["EASYOCR_MODULE_PATH"] = str(EASYOCR_CACHE)
            import easyocr  # noqa: PLC0415

            _OCR_READER = easyocr.Reader(
                ["en"],
                gpu=False,
                model_storage_directory=str(EASYOCR_CACHE),
                user_network_directory=str(EASYOCR_CACHE),
                verbose=False,
            )
        except Exception:
            _OCR_READER = False
    return _OCR_READER if _OCR_READER is not False else None


def _read_jersey_digits(crop_bgr: np.ndarray, reader) -> tuple[int | None, float]:
    """Run targeted jersey-number OCR on upper-back/chest torso sub-crop."""
    if reader is None or crop_bgr is None or crop_bgr.size == 0:
        return None, 0.0
    h, w = crop_bgr.shape[:2]
    if h < 48 or w < 22:
        return None, 0.0
    # Focus on central torso (jersey number region)
    y1, y2 = int(h * 0.16), int(h * 0.66)
    x1, x2 = int(w * 0.12), int(w * 0.88)
    torso = crop_bgr[y1:y2, x1:x2]
    if torso.size == 0:
        return None, 0.0

    # Upscale small broadcast crops & boost local contrast for readable digits
    scale = max(1.0, min(3.0, 96.0 / max(1, torso.shape[0])))
    if scale > 1.05:
        torso = cv2.resize(torso, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    lab = cv2.cvtColor(torso, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(4, 4))
    enh = cv2.cvtColor(cv2.merge([clahe.apply(l_ch), a_ch, b_ch]), cv2.COLOR_LAB2BGR)

    try:
        results = reader.readtext(enh, allowlist="0123456789", detail=1, paragraph=False)
    except Exception:
        return None, 0.0

    best_num: int | None = None
    best_conf = 0.0
    for _bbox, txt, conf in results:
        digits = re.sub(r"[^0-9]", "", str(txt or ""))
        if not digits or len(digits) > 2:
            continue
        num = int(digits)
        if 1 <= num <= 99 and float(conf) >= 0.44 and float(conf) > best_conf:
            best_num = num
            best_conf = float(conf)
    return best_num, round(best_conf, 3)


def _crop_portrait_and_check_face(frame_bgr: np.ndarray, row: pd.Series) -> tuple[np.ndarray | None, str, int]:
    """Extract a clean upper-body / portrait JPEG crop and honestly measure head/face resolution."""
    fh, fw = frame_bgr.shape[:2]
    x1, y1, x2, y2 = float(row["x1"]), float(row["y1"]), float(row["x2"]), float(row["y2"])
    bw = max(8.0, x2 - x1)
    bh = max(12.0, y2 - y1)
    est_face_px = int(round(bh * 0.14))

    # Padded upper-body framing (head + shoulders + jersey torso)
    pad_x = bw * 0.35
    pad_top = bh * 0.18
    cx1 = max(0, int(round(x1 - pad_x)))
    cx2 = min(fw, int(round(x2 + pad_x)))
    cy1 = max(0, int(round(y1 - pad_top)))
    cy2 = min(fh, int(round(y1 + bh * 0.78)))
    crop = frame_bgr[cy1:cy2, cx1:cx2]
    if crop.size == 0 or crop.shape[0] < 12 or crop.shape[1] < 10:
        return None, "broadcast_crop", est_face_px

    portrait_type = "upper_body_broadcast"
    if bh >= 115.0:
        cascade = _get_face_cascade()
        if cascade is not None:
            gray = cv2.cvtColor(crop[: max(20, int(crop.shape[0] * 0.55)), :], cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=4, minSize=(22, 22))
            if len(faces) > 0:
                _, _, f_w, f_h = max(faces, key=lambda r: r[2] * r[3])
                est_face_px = int(max(f_w, f_h))
                if est_face_px >= 28:
                    portrait_type = "face_closeup"

    # Resize nicely to crisp 160x184 portrait card with subtle unsharp mask
    target_w, target_h = 160, 184
    interp = cv2.INTER_CUBIC if crop.shape[0] < target_h else cv2.INTER_AREA
    resized = cv2.resize(crop, (target_w, target_h), interpolation=interp)
    blur = cv2.GaussianBlur(resized, (0, 0), 1.0)
    sharp = cv2.addWeighted(resized, 1.25, blur, -0.25, 0)
    return sharp, portrait_type, est_face_px


def stitch_match_identities(
    df_dets: pd.DataFrame,
    video_path: str | Path,
    portraits_dir: Path,
    enable_ocr: bool = True,
) -> tuple[pd.DataFrame, dict[str, dict], dict]:
    """Stitch fragmented (shot_id, track_id) tracklets into persistent match identities + extract portraits/OCR.

    Returns:
      - df_dets updated with `identity_key` column
      - identity_meta: dict[identity_key -> {portrait_file, portrait_type, face_px_est, jersey_ocr, jersey_ocr_conf, source_track_ids, n_shots}]
      - diagnostics: transparent identity pipeline stats
    """
    df = df_dets.copy()
    if df.empty:
        df["identity_key"] = ""
        return df, {}, {"method": "reid_ocr_portrait", "total_raw_tracks": 0, "stitched_identities": 0}

    df["identity_key"] = ""
    kf_cols = [f"kf{i}" for i in range(11)]
    has_kf = all(c in df.columns for c in kf_cols)

    person_mask = df["role"].isin(["player", "goalkeeper", "referee"])
    persons = df.loc[person_mask]
    if persons.empty:
        return df, {}, {"method": "reid_ocr_portrait", "total_raw_tracks": 0, "stitched_identities": 0}

    # 1. Summarize every raw (shot_id, track_id) tracklet
    tracklets: list[dict] = []
    for (sid, tid), grp in persons.groupby(["shot_id", "track_id"]):
        grp_s = grp.sort_values("frame_id")
        role = grp_s["role"].mode().iloc[0]
        team_id = int(grp_s["team_id"].mode().iloc[0])
        cal = grp_s[grp_s["on_pitch"]] if "on_pitch" in grp_s.columns else grp_s.iloc[0:0]
        n_cal = int(len(cal))
        f_min, f_max = int(grp_s["frame_id"].min()), int(grp_s["frame_id"].max())
        t_min, t_max = float(grp_s["time_s"].min()), float(grp_s["time_s"].max())
        kf_vec = None
        if has_kf:
            valid_kf = grp_s[kf_cols].dropna()
            if not valid_kf.empty:
                kf_vec = valid_kf.mean(axis=0).to_numpy(dtype=np.float32)

        start_xy = (float(cal.iloc[0]["x_m"]), float(cal.iloc[0]["y_m"])) if n_cal > 0 else None
        end_xy = (float(cal.iloc[-1]["x_m"]), float(cal.iloc[-1]["y_m"])) if n_cal > 0 else None
        mean_xy = (float(cal["x_m"].mean()), float(cal["y_m"].mean())) if n_cal > 0 else None

        # Pick up to 3 temporally-spaced sharp frames for multi-frame jersey OCR + portrait
        score_s = grp_s["bh_norm"].fillna(0.05) * grp_s["conf"].fillna(0.4)
        best_idx = score_s.idxmax()
        best_row = grp_s.loc[best_idx]
        ocr_rows = [best_row]
        if len(grp_s) >= 6:
            ranked_idxs = score_s.sort_values(ascending=False).index.tolist()
            picked_fids = {int(best_row["frame_id"])}
            for ridx in ranked_idxs:
                cand_r = grp_s.loc[ridx]
                cfid = int(cand_r["frame_id"])
                if all(abs(cfid - pf) >= 12 for pf in picked_fids):
                    ocr_rows.append(cand_r)
                    picked_fids.add(cfid)
                    if len(ocr_rows) >= 3:
                        break

        tracklets.append(
            {
                "key": (int(sid), int(tid)),
                "shot_id": int(sid),
                "track_id": int(tid),
                "role": str(role),
                "team_id": team_id,
                "n_frames": int(len(grp_s)),
                "n_cal": n_cal,
                "f_min": f_min,
                "f_max": f_max,
                "t_min": t_min,
                "t_max": t_max,
                "frame_set": set(int(x) for x in grp_s["frame_id"].tolist()),
                "kf": kf_vec,
                "start_xy": start_xy,
                "end_xy": end_xy,
                "mean_xy": mean_xy,
                "best_fid": int(best_row["frame_id"]),
                "best_bh_px": float(best_row["y2"] - best_row["y1"]),
                "best_row": best_row,
                "ocr_rows": ocr_rows,
            }
        )

    # Sort longest/most calibrated tracklets first as canonical identity anchors
    tracklets.sort(key=lambda t: (t["n_cal"], t["n_frames"]), reverse=True)

    # 2. Agglomerative cross-shot & post-occlusion Re-ID stitching (zero temporal overlap)
    clusters: list[dict] = []
    for trk in tracklets:
        best_c = None
        best_cost = 1e9
        for cl in clusters:
            if cl["team_id"] != trk["team_id"] or cl["role"] != trk["role"]:
                continue
            # Hard physical constraint: same person cannot occupy two detections in the same frame
            if cl["frame_set"] & trk["frame_set"]:
                continue

            # Keep squad count realistic (max ~15 outfield identities per team, 2 GKs)
            # Check spatial continuity or zone coherence
            spatial_cost = None
            same_shot = trk["shot_id"] in cl["shots"]
            if same_shot and cl["members"]:
                # Find temporally adjacent member in same shot
                adj_costs = []
                for m in cl["members"]:
                    if m["shot_id"] != trk["shot_id"]:
                        continue
                    if m["f_max"] < trk["f_min"]:
                        dt = max(0.08, trk["t_min"] - m["t_max"])
                        if dt <= 4.0 and m["end_xy"] and trk["start_xy"]:
                            d = float(np.hypot(trk["start_xy"][0] - m["end_xy"][0], trk["start_xy"][1] - m["end_xy"][1]))
                            if d <= max(4.5, dt * 10.5):
                                adj_costs.append(d / max(1.0, dt * 6.5))
                    elif trk["f_max"] < m["f_min"]:
                        dt = max(0.08, m["t_min"] - trk["t_max"])
                        if dt <= 4.0 and trk["end_xy"] and m["start_xy"]:
                            d = float(np.hypot(m["start_xy"][0] - trk["end_xy"][0], m["start_xy"][1] - trk["end_xy"][1]))
                            if d <= max(4.5, dt * 10.5):
                                adj_costs.append(d / max(1.0, dt * 6.5))
                if adj_costs:
                    spatial_cost = min(adj_costs)

            if spatial_cost is None and cl["mean_xy"] and trk["mean_xy"]:
                d_zone = float(np.hypot(trk["mean_xy"][0] - cl["mean_xy"][0], trk["mean_xy"][1] - cl["mean_xy"][1]))
                if trk["role"] == "goalkeeper":
                    if d_zone <= 22.0:
                        spatial_cost = d_zone / 20.0
                elif d_zone <= 15.0:
                    spatial_cost = 0.55 + d_zone / 18.0

            if spatial_cost is None:
                continue

            # Appearance similarity from torso LAB/HSV/RGB descriptor
            app_cost = 0.45
            if cl["kf"] is not None and trk["kf"] is not None:
                # L2 distance normalized
                diff = float(np.linalg.norm(cl["kf"] - trk["kf"])) / 85.0
                if diff > 1.45:
                    continue
                app_cost = diff * 0.45

            total_cost = spatial_cost + app_cost
            if total_cost < 1.35 and total_cost < best_cost:
                best_cost = total_cost
                best_c = cl

        if best_c is not None:
            best_c["members"].append(trk)
            best_c["frame_set"].update(trk["frame_set"])
            best_c["shots"].add(trk["shot_id"])
            best_c["n_cal"] += trk["n_cal"]
            best_c["n_frames"] += trk["n_frames"]
            if trk["mean_xy"] and best_c["mean_xy"]:
                w_old = max(1, best_c["n_cal"] - trk["n_cal"])
                w_new = max(1, trk["n_cal"])
                best_c["mean_xy"] = (
                    (best_c["mean_xy"][0] * w_old + trk["mean_xy"][0] * w_new) / (w_old + w_new),
                    (best_c["mean_xy"][1] * w_old + trk["mean_xy"][1] * w_new) / (w_old + w_new),
                )
            elif trk["mean_xy"]:
                best_c["mean_xy"] = trk["mean_xy"]
            if trk["best_bh_px"] > best_c["best_bh_px"]:
                best_c["best_bh_px"] = trk["best_bh_px"]
                best_c["best_fid"] = trk["best_fid"]
                best_c["best_row"] = trk["best_row"]
            best_c["ocr_rows"] = (best_c.get("ocr_rows") or []) + (trk.get("ocr_rows") or [])
        else:
            clusters.append(
                {
                    "team_id": trk["team_id"],
                    "role": trk["role"],
                    "members": [trk],
                    "frame_set": set(trk["frame_set"]),
                    "shots": {trk["shot_id"]},
                    "n_cal": trk["n_cal"],
                    "n_frames": trk["n_frames"],
                    "kf": trk["kf"].copy() if trk["kf"] is not None else None,
                    "mean_xy": trk["mean_xy"],
                    "best_fid": trk["best_fid"],
                    "best_bh_px": trk["best_bh_px"],
                    "best_row": trk["best_row"],
                    "ocr_rows": list(trk.get("ocr_rows") or []),
                }
            )

    # 3. Assign clean human-readable persistent identity keys
    clusters.sort(key=lambda c: (c["n_cal"], c["n_frames"]), reverse=True)
    counters: dict[tuple[int, str], int] = defaultdict(int)
    track_to_id: dict[tuple[int, int], str] = {}
    id_clusters: dict[str, dict] = {}

    for cl in clusters:
        t = cl["team_id"]
        role = cl["role"]
        counters[(t, role)] += 1
        idx = counters[(t, role)]
        if role == "referee":
            ikey = f"ref_{idx}"
        elif role == "goalkeeper":
            ikey = f"t{max(0, t)}_gk{idx}"
        elif t in (0, 1):
            ikey = f"t{t}_p{idx}"
        else:
            ikey = f"unk_p{idx}"
        cl["identity_key"] = ikey
        id_clusters[ikey] = cl
        for m in cl["members"]:
            track_to_id[m["key"]] = ikey

    # Map back onto df_dets
    keys_series = list(zip(df["shot_id"].astype(int), df["track_id"].astype(int)))
    df["identity_key"] = [track_to_id.get(k, "") for k in keys_series]

    # 4. Single sequential pass over video to extract crisp portraits + jersey OCR for top identities
    portraits_dir.mkdir(parents=True, exist_ok=True)
    # Pick up to 36 main identities (all players/GKs with >= 4 frames)
    eligible = [
        cl for cl in clusters
        if cl["role"] in ("player", "goalkeeper") and cl["team_id"] in (0, 1) and (cl["n_cal"] >= 3 or cl["n_frames"] >= 5)
    ][:36]

    wanted_portrait: dict[int, list[dict]] = defaultdict(list)
    wanted_ocr: dict[int, list[tuple[str, pd.Series]]] = defaultdict(list)
    for cl in eligible:
        wanted_portrait[int(cl["best_fid"])].append(cl)
        # Queue up to 3 temporally spaced sharp crops per identity for multi-frame OCR voting
        cand_rows = sorted(cl.get("ocr_rows") or [cl["best_row"]], key=lambda r: float(r["y2"] - r["y1"]), reverse=True)
        picked_f = set()
        for r in cand_rows:
            rfid = int(r["frame_id"])
            if float(r["y2"] - r["y1"]) >= 50.0 and rfid not in picked_f:
                wanted_ocr[rfid].append((cl["identity_key"], r))
                picked_f.add(rfid)
                if len(picked_f) >= 3:
                    break

    identity_meta: dict[str, dict] = {}
    for ikey, cl in id_clusters.items():
        identity_meta[ikey] = {
            "identity_key": ikey,
            "team_id": cl["team_id"],
            "role": cl["role"],
            "source_track_ids": sorted({m["track_id"] for m in cl["members"]}),
            "n_tracklets_merged": len(cl["members"]),
            "n_shots": len(cl["shots"]),
            "portrait_file": None,
            "portrait_type": "none",
            "face_px_est": int(round(cl["best_bh_px"] * 0.14)),
            "jersey_ocr": None,
            "jersey_ocr_conf": 0.0,
        }

    ocr_reader = _get_ocr_reader() if enable_ocr else None
    ocr_votes: dict[str, list[tuple[int, float]]] = defaultdict(list)
    n_portraits = 0
    n_closeup_faces = 0
    n_ocr_hits = 0

    all_wanted_fids = set(wanted_portrait.keys()) | (set(wanted_ocr.keys()) if ocr_reader is not None else set())
    vpath = Path(video_path)
    if all_wanted_fids and vpath.exists():
        cap = cv2.VideoCapture(str(vpath))
        try:
            max_f = max(all_wanted_fids)
            cur = 0
            while cur <= max_f:
                if not cap.grab():
                    break
                if cur in all_wanted_fids:
                    ok, frame_bgr = cap.retrieve()
                    if ok and frame_bgr is not None:
                        fh, fw = frame_bgr.shape[:2]
                        for cl in wanted_portrait.get(cur, []):
                            ikey = cl["identity_key"]
                            row = cl["best_row"]
                            portrait, ptype, fpx = _crop_portrait_and_check_face(frame_bgr, row)
                            if portrait is not None:
                                fname = f"{ikey}.jpg"
                                cv2.imwrite(str(portraits_dir / fname), portrait, [cv2.IMWRITE_JPEG_QUALITY, 88])
                                identity_meta[ikey]["portrait_file"] = fname
                                identity_meta[ikey]["portrait_type"] = ptype
                                identity_meta[ikey]["face_px_est"] = fpx
                                n_portraits += 1
                                if ptype == "face_closeup":
                                    n_closeup_faces += 1

                        if ocr_reader is not None:
                            for ikey, row in wanted_ocr.get(cur, []):
                                x1 = max(0, int(round(float(row["x1"]))))
                                y1 = max(0, int(round(float(row["y1"]))))
                                x2 = min(fw, int(round(float(row["x2"]))))
                                y2 = min(fh, int(round(float(row["y2"]))))
                                num, nconf = _read_jersey_digits(frame_bgr[y1:y2, x1:x2], ocr_reader)
                                if num is not None:
                                    ocr_votes[ikey].append((num, nconf))
                cur += 1
        finally:
            cap.release()

    for ikey, votes in ocr_votes.items():
        if not votes:
            continue
        # Confidence-weighted vote across frames
        num_scores: dict[int, float] = defaultdict(float)
        num_maxc: dict[int, float] = defaultdict(float)
        for num, conf in votes:
            num_scores[num] += conf
            num_maxc[num] = max(num_maxc[num], conf)
        best_num = max(num_scores.keys(), key=lambda k: num_scores[k])
        identity_meta[ikey]["jersey_ocr"] = best_num
        identity_meta[ikey]["jersey_ocr_conf"] = round(num_maxc[best_num], 3)
        n_ocr_hits += 1

    diagnostics = {
        "method": "Cross-Shot Appearance & Spatial Re-ID + Multi-Frame Jersey OCR + Auto-Lineup Club Matching + Portrait Extraction",
        "face_recognition_note_ar": (
            "في البث التلفزيوني الواسع يبلغ حجم وجه اللاعب 6 إلى 14 بكسل فقط، لذا تعتمد الأنظمة العالمية "
            "(SkillCorner / Second Spectrum) على 4 مراحل شبه تلقائية: "
            "(1) دمج الهوية عبر اللقطات Re-ID، "
            "(2) قراءة أرقام القمصان OCR عبر عدة لقطات، "
            "(3) مطابقة التشكيلة تلقائياً مع قائمة النادي في قاعدة البيانات عبر المركز والرقم (مع علامة صريحة تميّز المؤكد عن المرشّح تلقائياً)، "
            "(4) تعديل أو تأكيد أي اسم بضغطة واحدة من ورقة التشكيلة."
        ),
        "total_raw_tracks": len(tracklets),
        "stitched_identities": len(clusters),
        "portraits_extracted": n_portraits,
        "closeup_faces_detected": n_closeup_faces,
        "jersey_ocr_hits": n_ocr_hits,
    }
    return df, identity_meta, diagnostics


def _pos_family(pos: str | None) -> str:
    p = (pos or "CM").upper()
    if p == "GK":
        return "GK"
    if p == "CB":
        return "CB"
    if p in ("LB", "RB"):
        return "FB"
    if p in ("DM", "CM", "AM"):
        return "MID"
    return "ATT"


def auto_match_squad_to_identities(
    portfolios: list[dict],
    squad_by_team: dict[int, list[dict]],
    bound_map: dict[str, dict] | None = None,
) -> dict[str, dict]:
    """Semi-automatic Hungarian matching of stitched video identities to each club's real Egyptian squad.

    Never overrides manual coach confirmations in `bound_map`. Clearly distinguishes:
      - `confirmed_ocr`: exact jersey number OCR match with club roster
      - `auto_lineup`: Hungarian positional/zone match against club Starting XI
    """
    bound_map = bound_map or {}
    auto_map: dict[str, dict] = {}

    for team_id in (0, 1):
        roster = squad_by_team.get(team_id) or []
        if not roster:
            continue
        # Exclude players already manually bound for this match
        used_pids = {int(b["player_id"]) for b in bound_map.values() if b.get("player_id")}
        avail_roster = [r for r in roster if int(r["id"]) not in used_pids]
        if not avail_roster:
            continue

        # Take top 12 reliable identities for this team (excluding already manually bound ones)
        t_identities = [
            p for p in portfolios
            if int(p.get("team_id", -1)) == team_id
            and p.get("identity_key") not in bound_map
            and p.get("role") in ("player", "goalkeeper")
        ]
        t_identities.sort(key=lambda x: (x.get("jersey_ocr") is not None, x.get("n_cal_frames", 0)), reverse=True)
        t_identities = t_identities[: min(12, len(avail_roster))]
        if not t_identities:
            continue

        n_id = len(t_identities)
        n_pl = len(avail_roster)
        cost = np.full((n_id, n_pl), 1.6, dtype=np.float64)

        for i, vp in enumerate(t_identities):
            v_ocr = vp.get("jersey_ocr")
            v_pos = str(vp.get("inferred_role_code") or "CM").upper()
            v_fam = _pos_family(v_pos)
            for j, rp in enumerate(avail_roster):
                r_num = rp.get("jersey_number")
                r_pos = str(rp.get("position") or "CM").upper()
                r_fam = _pos_family(r_pos)
                if v_ocr is not None and r_num is not None and int(v_ocr) == int(r_num):
                    cost[i, j] = 0.01  # Exact jersey OCR lock!
                elif v_pos == "GK" and r_pos == "GK":
                    cost[i, j] = 0.12
                elif (v_pos == "GK") != (r_pos == "GK"):
                    cost[i, j] = 3.5  # Never match GK to outfielder
                elif v_pos == r_pos:
                    cost[i, j] = 0.25
                elif v_fam == r_fam:
                    cost[i, j] = 0.58
                else:
                    cost[i, j] = 1.15 + (j * 0.01)

        row_ind, col_ind = linear_sum_assignment(cost)
        for ri, ci in zip(row_ind, col_ind):
            cval = float(cost[ri, ci])
            if cval >= 2.0:
                continue
            vp = t_identities[ri]
            rp = avail_roster[ci]
            is_ocr = cval <= 0.05
            auto_map[vp["identity_key"]] = {
                "player_id": int(rp["id"]),
                "name": rp["name"],
                "club_name": rp.get("club_name", ""),
                "division": rp.get("division", ""),
                "position": rp.get("position", ""),
                "jersey_number": rp.get("jersey_number"),
                "age": rp.get("age"),
                "market_value_egp": rp.get("market_value_egp", 0),
                "identity_status": "confirmed_ocr" if is_ocr else "auto_lineup",
                "status_label_ar": "مؤكد تلقائياً برقم القميص OCR" if is_ocr else "مرشّح تلقائياً من تشكيلة النادي",
            }

    return auto_map

