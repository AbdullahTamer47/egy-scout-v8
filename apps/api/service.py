"""Core backend service wiring V8 contracts, physics-safe Shield, real crops, Scouting & Tactics."""
from __future__ import annotations

import base64
from bisect import bisect_right
import ipaddress
import json
import os
import re
import shutil
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
import pandas as pd

from packages.scouting_core.fair_engine import (
    MAX_PHYSICAL_SPEED_KMH,
    build_profiles_from_match_parquet,
    import_external_scouting_csv,
)
from packages.scouting_core.input_gate import assess_video_input_mode
from packages.scouting_core.player_card import (
    MIN_WORK_RATE_SECONDS,
    assign_team_relative_positions,
    build_player_card_stats,
    compute_clean_trajectory_kinematics,
    compute_match_percentiles,
    get_position_label_dict,
    stabilize_dataframe_homography_drift,
)
from packages.shared_contracts.config import (
    get_data_paths,
    get_repo_root,
    imread_unicode,
    imwrite_unicode,
    open_video_unicode,
    resolve_project_path,
)
from packages.shared_contracts.lineup_connector import parse_scoresheet_text
from packages.shared_contracts.match_setup import (
    BenchSubstitutionManager,
    MatchSetupConfig,
    compute_four_point_homography,
    project_pixels_with_homography,
)
from packages.shared_contracts.providers import get_compute_provider
from packages.shared_contracts.schemas import (
    build_match_track_metadata,
    load_legacy_scout5_telemetry,
    read_tracking_parquet,
    write_tracking_parquet,
)
from packages.tactics_engine.counterfactual import (
    compute_dynamic_pitch_control,
    compute_shot_xg,
    find_optimal_ghost_move,
    simulate_ghost_move,
)
from packages.tactics_engine.matchup_optimizer import recommend_matchup_plan
from packages.tactics_engine.moment_analyzer import (
    _assign_roster_by_position,
    _slot_position_compatibility,
    analyze_frame_moment_state,
    build_formation_blueprint,
    detect_live_team_formation,
    enrich_arrows_with_probabilities,
    match_masterclass_preset,
)
from packages.tactics_engine.playbook import diagnose_frame_tactics
from services.cv_worker.local_pipeline import (
    detect_clip_with_football_yolo,
    download_video_from_url,
    ingest_clip_with_football_yolo,
    refine_match_locally,
)
from services.cv_worker.lazy_engines.event_pose import (
    evaluate_pose_with_resolution_gate,
    run_event_pose_on_video,
)
from services.cv_worker.lazy_engines.video_export import (
    export_watermarked_clip,
    transcode_gop_hls,
)
from services.cv_worker.stages.ball_tracker import track_and_inpaint_ball
from services.cv_worker.stages.referee_shield import (
    SigLIPThreeClassClusterer,
    ZeroRefereeLeakShield,
)
from tools.benchmark_evaluator.evaluate import evaluate_predictions
from tools.phase0_annotator.extract_frames import discover_scout5_matches

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")

# Human-readable Arabic/English reason labels (never expose raw internal layer names to UI)
ROLE_REASON_LABELS = {
    "layer4_verified_main_referee": ("حكم ساحة معزول بصرياً وزمنياً", "Isolated main referee"),
    "layer4_verified_touchline_ar": ("مساعد حكم على خط التماس", "Touchline assistant referee"),
    "layer4_spatial_gk_box": ("حارس مرمى داخل منطقة الجزاء", "Penalty-box goalkeeper"),
    "layer4_temporal_vote": ("تصويت زمني على كامل المسار", "Track-level temporal lock"),
    "layer4_unassigned_low_conf": ("مستبعد لضعف الثقة", "Excluded (low confidence)"),
    "layer4_short_track_filtered": ("مسار قصير غير مكتمل", "Short track filtered"),
}


FRIENDLY_TEAM_NAMES: dict[str, tuple[str, str]] = {
    "m1_ahly_sekka": ("El Sekka", "Al Ahly"),
    "m2_ahly_enppi": ("Al Ahly", "ENPPI"),
    "m3_enppi_mokawloon": ("Al Mokawloon", "ENPPI"),
}

FRIENDLY_TEAM_NAMES_AR: dict[str, tuple[str, str, str]] = {
    "m1_ahly_sekka": ("السكة الحديد", "الأهلي", "السكة الحديد × الأهلي (3-0)"),
    "m2_ahly_enppi": ("الأهلي", "إنبي", "الأهلي × إنبي (الدوري المصري)"),
    "m3_enppi_mokawloon": ("المقاولون العرب", "إنبي", "المقاولون العرب × إنبي (الدوري المصري)"),
}

_PERSON_SEG_MODEL: Any = False


def _get_person_seg_model(data_dir: Path) -> Any:
    """Lazy-load yolo11n-seg.pt when available on disk to isolate target player portraits from background clutter."""
    global _PERSON_SEG_MODEL
    if _PERSON_SEG_MODEL is not False:
        return _PERSON_SEG_MODEL
    seg_path = data_dir / "weights" / "yolo11n-seg.pt"
    if not seg_path.is_file():
        _PERSON_SEG_MODEL = None
        return None
    try:
        from ultralytics import YOLO

        _PERSON_SEG_MODEL = YOLO(str(seg_path))
    except Exception:
        _PERSON_SEG_MODEL = None
    return _PERSON_SEG_MODEL

_CLUBS_ROSTER_CACHE: Optional[dict[str, Any]] = None


def _load_clubs_rosters_json() -> dict[str, Any]:
    """Load verified club squads from datasets/rosters/clubs_2025_26.json."""
    global _CLUBS_ROSTER_CACHE
    if _CLUBS_ROSTER_CACHE is not None:
        return _CLUBS_ROSTER_CACHE
    json_path = Path(__file__).resolve().parents[2] / "datasets" / "rosters" / "clubs_2025_26.json"
    if json_path.is_file():
        data = json.loads(json_path.read_text(encoding="utf-8"))
        _CLUBS_ROSTER_CACHE = data
        return data
    return {"schema_version": "10.5", "updated_at": "", "clubs": {}}


def _squad_from_clubs_json(club_id: str, club_tag_ar: Optional[str] = None) -> list[dict[str, Any]]:
    clubs = _load_clubs_rosters_json().get("clubs", {})
    club = clubs.get(club_id, {})
    out: list[dict[str, Any]] = []
    for p in club.get("players", []):
        nar = str(p.get("name_ar") or p.get("name") or "").strip()
        nen = str(p.get("name_en") or nar).strip()
        pos = str(p.get("position") or "CM").strip().upper()
        tag = f"({club_tag_ar} {pos})" if club_tag_ar else f"({pos})"
        out.append(
            {
                "jersey_number": int(p.get("jersey_number") or 0),
                "name": f"{nar} {tag}",
                "name_ar": nar,
                "name_en": nen,
                "position": pos,
                "is_starter": bool(p.get("is_starter", True)),
            }
        )
    return out


AL_AHLY_2025_26 = _squad_from_clubs_json("al_ahly")
ENPPI_2025_26 = _squad_from_clubs_json("enppi", "إنبي")
PYRAMIDS_2025_26 = _squad_from_clubs_json("pyramids", "بيراميدز")
AL_MASRY_2025_26 = _squad_from_clubs_json("al_masry", "المصري")
EL_GAISH_2025_26 = _squad_from_clubs_json("el_gaish", "طلائع الجيش")
MOKAWLOON_2025_26 = _squad_from_clubs_json("mokawloon", "المقاولون")
EL_SEKKA_2025_26 = _squad_from_clubs_json("el_sekka")


def _tag_team(squad: list[dict[str, Any]], team_key: str) -> list[dict[str, Any]]:
    return [{**p, "team": team_key} for p in squad]


DEFAULT_MATCH_ROSTERS: dict[str, list[dict[str, Any]]] = {
    "m2_ahly_enppi": _tag_team(AL_AHLY_2025_26, "team_a") + _tag_team(ENPPI_2025_26, "team_b"),
    "custom_1795438320857": _tag_team(AL_AHLY_2025_26, "team_a") + _tag_team(EL_GAISH_2025_26, "team_b"),
    "custom_1795439012452": _tag_team(PYRAMIDS_2025_26, "team_a") + _tag_team(AL_MASRY_2025_26, "team_b"),
    "m1_ahly_sekka": _tag_team(EL_SEKKA_2025_26, "team_a") + _tag_team(AL_AHLY_2025_26, "team_b"),
    "m3_enppi_mokawloon": _tag_team(MOKAWLOON_2025_26, "team_a") + _tag_team(ENPPI_2025_26, "team_b"),
}

DEFAULT_MATCH_CLUB_IDS: dict[str, tuple[str, str]] = {
    "m2_ahly_enppi": ("al_ahly", "enppi"),
    "custom_1795438320857": ("al_ahly", "el_gaish"),
    "custom_1795439012452": ("pyramids", "al_masry"),
    "m1_ahly_sekka": ("el_sekka", "al_ahly"),
    "m3_enppi_mokawloon": ("mokawloon", "enppi"),
}

_PLAYER_NATIONALITY_MAP: dict[str, str] = {
    "yahia attiyat allah": "MA",
    "achraf dari": "MA",
    "mohamed chibi": "MA",
    "walid el karti": "MA",
    "walid ben bella": "TN",
    "hossam souissi": "TN",
    "abderrahim deghmoum": "DZ",
    "blati toure": "BF",
    "fiston mayele": "CD",
    "joseph ochaya": "UG",
    "amadou niass": "MR",
    "ismail ouro-agoro": "TG",
    "lukas hradecky": "FI",
    "edmond tapsoba": "BF",
    "jonathan tah": "DE",
    "florian wirtz": "DE",
    "jonas hofmann": "DE",
    "odilon kossounou": "CI",
    "alejandro grimaldo": "ES",
    "granit xhaka": "CH",
    "exequiel palacios": "AR",
    "jeremie frimpong": "NL",
    "victor boniface": "NG",
}


def _infer_nationality_code(name_en: str, club_id: str = "") -> str:
    low = (name_en or "").strip().lower()
    for key, code in _PLAYER_NATIONALITY_MAP.items():
        if key in low:
            return code
    if club_id == "bayer_leverkusen_alonso":
        return "DE"
    return "EG"


DEFAULT_GROQ_MODELS: list[dict[str, str]] = [
    {"id": "auto", "ar": "تلقائي ذكي", "en": "Auto Smart Router"},
    {"id": "openai/gpt-oss-120b", "ar": "GPT-OSS 120B (للخطط المعقدة)", "en": "GPT-OSS 120B (Deep Tactical)"},
    {"id": "qwen/qwen3.8-27b", "ar": "Qwen 3.8 27B (سريع بالعربي)", "en": "Qwen 3.8 27B (Fast Arabic)"},
    {"id": "openai/gpt-oss-20b", "ar": "GPT-OSS 20B (فائق السرعة)", "en": "GPT-OSS 20B (Turbo)"},
    {"id": "allam-2-7b", "ar": "ALLaM 2 7B (عربي)", "en": "ALLaM 2 7B (Arabic)"},
]


def _fallback_identity(team: str, team_ar: str, base_track_id: int) -> dict[str, Any]:
    """Return an honest unverified track identity without inventing jersey numbers or player names."""
    return {
        "jersey_number": None,
        "verified_name": None,
        "verified": False,
        "display_label": f"{team_ar} • T{int(base_track_id)}",
    }


def _validate_remote_url(url: str) -> str:
    """Strict URL allowlist blocking file://, localhost, and private/loopback/link-local IPs (SSRF guard)."""
    clean_url = (url or "").strip()
    if not clean_url:
        raise ValueError("Empty URL")
    parsed = urllib.parse.urlparse(clean_url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https", "rtsp", "rtmp"):
        raise ValueError(f"Unsupported URL scheme: {scheme or 'none'}")
    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise ValueError("URL must contain a valid hostname")
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Localhost and internal hostnames are not allowed")
    port = parsed.port or (443 if scheme == "https" else (554 if scheme == "rtsp" else (1935 if scheme == "rtmp" else 80)))
    try:
        infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError(f"Cannot resolve hostname: {hostname}") from exc
    if not infos:
        raise ValueError(f"No IP addresses resolved for {hostname}")
    for info in infos:
        ip_str = info[4][0].split("%")[0]
        ip_obj = ipaddress.ip_address(ip_str)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_reserved
            or ip_obj.is_multicast
            or ip_obj.is_unspecified
        ):
            raise ValueError(f"Blocked private or loopback IP address for {hostname}")
    return clean_url


class ScoutV8Service:
    """Orchestrator over Parquet artifacts, real video crops, Scouting & Tactics."""

    def __init__(self) -> None:
        self.repo_root = get_repo_root()
        self._load_env_file()
        self.data_paths = get_data_paths(create=True)
        self.provider = get_compute_provider()
        from apps.api.storage_db import ScoutSQLiteStore
        self.sqlite_store = ScoutSQLiteStore(self.data_paths.outputs / "egy_scout_v9.db")
        self._v8_cache: dict[str, pd.DataFrame] = {}
        self._legacy_cache: dict[str, pd.DataFrame] = {}
        self._meta_cache: dict[str, dict[str, Any]] = {}
        self._match_json_meta: dict[str, dict[str, Any]] = {}
        self._phase0_cache: dict[str, dict[str, Any]] = {}
        self._player_card_pool_cache: dict[tuple[str, float], dict[str, Any]] = {}
        self._groq_models_cache: tuple[float, list[dict[str, str]], str] | None = None

    def _load_env_file(self) -> None:
        """Auto-load backend .env variables (GROQ_API_KEY, GEMINI_API_KEY, etc.) silently."""
        env_p = self.repo_root / ".env"
        if not env_p.is_file():
            return
        try:
            for line in env_p.read_text(encoding="utf-8").splitlines():
                clean = line.strip()
                if not clean or clean.startswith("#") or "=" not in clean:
                    continue
                k, v = clean.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and v and not os.environ.get(k):
                    os.environ[k] = v
        except Exception:
            pass

    def _validate_id(self, val: str) -> str:
        if not SAFE_ID_RE.match(val):
            raise ValueError(f"Invalid identifier: {val!r}")
        return val

    def _tenant_dir(self, tenant_id: str) -> Path:
        d = self.data_paths.outputs / "tenants" / self._validate_id(tenant_id)
        d.mkdir(parents=True, exist_ok=True)
        return d

    def list_matches(self) -> list[dict[str, Any]]:
        matches = discover_scout5_matches(self.repo_root)
        result = []
        for m in matches:
            mid = m["match_id"]
            if mid in FRIENDLY_TEAM_NAMES:
                ta, tb = FRIENDLY_TEAM_NAMES[mid]
                if m.get("team_a_name") in (None, "", "Team A", "فريق أ"):
                    m["team_a_name"] = ta
                if m.get("team_b_name") in (None, "", "Team B", "فريق ب"):
                    m["team_b_name"] = tb
            ta_ar, tb_ar, title_ar = FRIENDLY_TEAM_NAMES_AR.get(
                mid, (m["team_a_name"], m["team_b_name"], f"{m['team_a_name']} × {m['team_b_name']}")
            )
            m["team_a_name_ar"] = ta_ar
            m["team_b_name_ar"] = tb_ar
            m["title_ar"] = title_ar
            m["is_custom"] = False
            self._meta_cache[mid] = m
            result.append(
                {
                    "match_id": mid,
                    "team_a_name": m["team_a_name"],
                    "team_b_name": m["team_b_name"],
                    "team_a_name_ar": ta_ar,
                    "team_b_name_ar": tb_ar,
                    "title_ar": title_ar,
                    "kit_colors": self.get_match_kit_colors(mid),
                    "fps": float(m["fps"]),
                    "has_video": Path(m["video_path"]).is_file(),
                    "has_telemetry": Path(m["telemetry_path"]).is_file(),
                    "spotlight_frame": 1250 if mid == "m2_ahly_enppi" else None,
                    "is_custom": False,
                }
            )

        custom_root = self.data_paths.outputs / "custom_matches"
        if custom_root.is_dir():
            for meta_p in sorted(custom_root.glob("*/meta.json"), reverse=True):
                try:
                    cm = json.loads(meta_p.read_text(encoding="utf-8"))
                    mid = str(cm["match_id"])
                    if not SAFE_ID_RE.match(mid):
                        continue
                    cm["is_custom"] = True
                    ta_c = cm.get("team_a_name", "Team A")
                    tb_c = cm.get("team_b_name", "Team B")
                    cm["team_a_name_ar"] = ta_c
                    cm["team_b_name_ar"] = tb_c
                    cm["title_ar"] = f"{ta_c} × {tb_c} (مقطع مخصّص)"
                    self._meta_cache[mid] = cm
                    self._match_json_meta[mid] = cm
                    result.append(
                        {
                            "match_id": mid,
                            "team_a_name": ta_c,
                            "team_b_name": tb_c,
                            "team_a_name_ar": ta_c,
                            "team_b_name_ar": tb_c,
                            "title_ar": cm["title_ar"],
                            "kit_colors": self.get_match_kit_colors(mid),
                            "fps": float(cm.get("fps", 25.0) or 25.0),
                            "has_video": Path(cm.get("video_path", "")).is_file(),
                            "has_telemetry": Path(cm.get("v8_parquet_path", "")).is_file(),
                            "spotlight_frame": cm.get("spotlight_frame"),
                            "is_custom": True,
                        }
                    )
                except Exception:
                    continue
        return result

    def _get_match_meta(self, match_id: str) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        if mid not in self._meta_cache:
            self.list_matches()
        if mid not in self._meta_cache:
            raise FileNotFoundError(f"Match not found: {mid}")
        return self._meta_cache[mid]

    def get_legacy_and_v8_frames(self, match_id: str) -> tuple[pd.DataFrame, pd.DataFrame]:
        mid = self._validate_id(match_id)
        meta = self._get_match_meta(mid)
        if meta.get("is_custom"):
            if mid not in self._legacy_cache:
                self._legacy_cache[mid] = read_tracking_parquet(meta["raw_parquet_path"])
            if mid not in self._v8_cache:
                self._v8_cache[mid] = read_tracking_parquet(meta["v8_parquet_path"])
            return self._legacy_cache[mid], self._v8_cache[mid]

        if mid not in self._legacy_cache:
            self._legacy_cache[mid] = load_legacy_scout5_telemetry(
                meta["telemetry_path"], match_id=mid
            )
        if mid not in self._v8_cache:
            pq_cache = self.data_paths.outputs / "v8_4_parquet" / f"{mid}_v8.parquet"
            meta_json = self.data_paths.outputs / "v8_4_parquet" / f"{mid}_meta.json"
            if pq_cache.is_file():
                self._v8_cache[mid] = read_tracking_parquet(pq_cache)
                if meta_json.is_file():
                    self._match_json_meta[mid] = json.loads(meta_json.read_text(encoding="utf-8"))
            else:
                v8_df, m_out = refine_match_locally(
                    match_id=mid,
                    video_path=meta["video_path"],
                    legacy_parquet_path=meta["telemetry_path"],
                    run_ocr=True,
                )
                write_tracking_parquet(v8_df, pq_cache)
                meta_json.parent.mkdir(parents=True, exist_ok=True)
                meta_json.write_text(json.dumps(m_out, ensure_ascii=False, indent=2), encoding="utf-8")
                self._v8_cache[mid] = v8_df
                self._match_json_meta[mid] = m_out
        return self._legacy_cache[mid], self._v8_cache[mid]

    def get_match_kit_colors(self, match_id: str) -> dict[str, str]:
        mid = self._validate_id(match_id)
        if mid not in self._match_json_meta:
            custom_meta = self.data_paths.outputs / "custom_matches" / mid / "meta.json"
            meta_json = self.data_paths.outputs / "v8_4_parquet" / f"{mid}_meta.json"
            if custom_meta.is_file():
                self._match_json_meta[mid] = json.loads(custom_meta.read_text(encoding="utf-8"))
            elif meta_json.is_file():
                self._match_json_meta[mid] = json.loads(meta_json.read_text(encoding="utf-8"))
        kc = self._match_json_meta.get(mid, {}).get("kit_colors")
        if isinstance(kc, dict) and "team_a_hex" in kc and "team_b_hex" in kc:
            return {"team_a_hex": str(kc["team_a_hex"]), "team_b_hex": str(kc["team_b_hex"])}
        return {"team_a_hex": "#EF4444", "team_b_hex": "#38BDF8"}

    def _infer_attack_direction(self, v8_df: pd.DataFrame) -> dict[str, Any]:
        """Infer true attacking goal side robustly (rejects stray false-GK boxes inside opponent halves)."""
        pa = v8_df[(v8_df["team"] == "team_a") & v8_df["role"].isin(["player", "goalkeeper"]) & v8_df["x_m"].notna()]
        pb = v8_df[(v8_df["team"] == "team_b") & v8_df["role"].isin(["player", "goalkeeper"]) & v8_df["x_m"].notna()]
        pa_med = float(pa["x_m"].median()) if not pa.empty else 52.5
        pb_med = float(pb["x_m"].median()) if not pb.empty else 52.5

        gk_a = v8_df[(v8_df["team"] == "team_a") & (v8_df["role"] == "goalkeeper") & v8_df["x_m"].notna()]
        gk_b = v8_df[(v8_df["team"] == "team_b") & (v8_df["role"] == "goalkeeper") & v8_df["x_m"].notna()]

        def _gk_sane(gk_df: pd.DataFrame, own_med: float, opp_med: float) -> Optional[bool]:
            if len(gk_df) < 15:
                return None
            gk_x = float(gk_df["x_m"].median())
            # A true goalkeeper stands near his own goal mouth (<= 28m or >= 77m) and never ahead of all opponents
            if gk_x < 28.0 and gk_x <= opp_med + 2.0:
                return False  # Defends x=0 -> own team defends left
            if gk_x > 77.0 and gk_x >= opp_med - 2.0:
                return True   # Defends x=105 -> own team defends right
            return None

        gk_b_def_right = _gk_sane(gk_b, pb_med, pa_med)
        gk_a_def_right = _gk_sane(gk_a, pa_med, pb_med)

        if gk_b_def_right is not None:
            team_a_right = gk_b_def_right
            source = "goalkeeper_position"
        elif gk_a_def_right is not None:
            team_a_right = not gk_a_def_right
            source = "goalkeeper_position"
        elif not pa.empty and not pb.empty:
            all_x = pd.concat([pa["x_m"], pb["x_m"]])
            if float(all_x.median()) > 66.0:
                # Action inside x=105 goal area: whichever team has deepest players nearest x=105 is defending 105
                team_a_right = bool(float(pb["x_m"].quantile(0.90)) >= float(pa["x_m"].quantile(0.90)))
            elif float(all_x.median()) < 39.0:
                # Action inside x=0 goal area: whichever team has deepest players nearest x=0 is defending 0
                team_a_right = bool(float(pa["x_m"].quantile(0.10)) <= float(pb["x_m"].quantile(0.10)))
            else:
                team_a_right = bool(pa_med < pb_med)
            source = "team_centroid"
        else:
            team_a_right = True
            source = "team_centroid"
        return {
            "team_a_attacks_right": team_a_right,
            "team_a_goal_x": 105.0 if team_a_right else 0.0,
            "team_b_goal_x": 0.0 if team_a_right else 105.0,
            "direction_source": source,
        }

    def get_video_path(self, match_id: str) -> Path:
        meta = self._get_match_meta(match_id)
        vpath = resolve_project_path(meta["video_path"], self.repo_root)
        if not vpath.is_file():
            raise FileNotFoundError(f"Video file not found for match {match_id}: {vpath}")
        return vpath

    def render_frame_jpeg(
        self, match_id: str, frame_id: int, highlight_track: Optional[int] = None
    ) -> bytes:
        vpath = self.get_video_path(match_id)
        cap, proxy = open_video_unicode(vpath)
        try:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_id))
            ok, frame = cap.read()
            if not ok or frame is None:
                raise FileNotFoundError(f"Cannot read frame {frame_id} from {vpath}")
            if highlight_track is not None:
                _, v8_df = self.get_legacy_and_v8_frames(match_id)
                hit = v8_df[(v8_df["frame_id"] == int(frame_id)) & (v8_df["track_id"] == int(highlight_track))]
                if not hit.empty:
                    r = hit.iloc[0]
                    x1, y1, x2, y2 = int(r["x1"]), int(r["y1"]), int(r["x2"]), int(r["y2"])
                    cv2.rectangle(frame, (x1 - 4, y1 - 4), (x2 + 4, y2 + 4), (129, 185, 16), 3, cv2.LINE_AA)
                    cv2.ellipse(
                        frame,
                        ((x1 + x2) // 2, y2),
                        (max(16, int((x2 - x1) * 0.65)), max(6, int((x2 - x1) * 0.22))),
                        0, 0, 360, (129, 185, 16), 3, cv2.LINE_AA,
                    )
                    cv2.putText(
                        frame,
                        f"#{int(highlight_track)}",
                        (x1, max(22, y1 - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        (129, 185, 16),
                        2,
                        cv2.LINE_AA,
                    )
            ok_enc, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
            if not ok_enc:
                raise RuntimeError("JPEG encode failed")
            return buf.tobytes()
        finally:
            cap.release()
            if proxy is not None and proxy.exists():
                try:
                    proxy.unlink()
                except OSError:
                    pass

    def render_track_crop_jpeg(
        self, match_id: str, track_id: int, frame_id: Optional[int] = None, portrait: bool = False
    ) -> bytes:
        """Extract a clean, unoccluded, head-safe portrait crop JPEG from the match video."""
        mid = self._validate_id(match_id)
        if portrait:
            cache_tag = f"t{int(track_id)}_p{int(frame_id) if frame_id is not None else 'best'}"
            cache_path = self.data_paths.cache / "crops_v4" / mid / f"{cache_tag}.jpg"
            if cache_path.is_file():
                return cache_path.read_bytes()

        _, v8_df = self.get_legacy_and_v8_frames(mid)
        t_rows = v8_df[v8_df["track_id"] == int(track_id)]
        if t_rows.empty:
            raise FileNotFoundError(f"Track {track_id} not found in {mid}")

        if not portrait and frame_id is not None and (t_rows["frame_id"] == int(frame_id)).any():
            fid_exact = int(frame_id)
            legacy_cache = self.data_paths.cache / "crops_v3" / mid / f"t{int(track_id)}_f{fid_exact}.jpg"
            if legacy_cache.is_file():
                return legacy_cache.read_bytes()

        vpath = self.get_video_path(mid)
        cap, proxy = open_video_unicode(vpath)
        try:
            vid_w = max(320, int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280)
            vid_h = max(240, int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720)
            margin_x = max(12.0, vid_w * 0.015)
            margin_top = max(20.0, vid_h * 0.035)
            margin_bot = max(12.0, vid_h * 0.025)

            if frame_id is not None and (t_rows["frame_id"] == int(frame_id)).any():
                candidates = [t_rows[t_rows["frame_id"] == int(frame_id)].iloc[0]]
            else:
                # Vectorized/grouped candidate scoring: reward large centered boxes, penalize border clipping & neighbor IoU
                frame_groups = {
                    int(fid_k): grp[["track_id", "x1", "y1", "x2", "y2"]].to_numpy(dtype=np.float64)
                    for fid_k, grp in v8_df[v8_df["frame_id"].isin(t_rows["frame_id"].unique())].groupby("frame_id")
                }
                scored: list[tuple[float, Any]] = []
                tid_f = float(track_id)
                for _, cand in t_rows.iterrows():
                    cx1, cy1, cx2, cy2 = float(cand["x1"]), float(cand["y1"]), float(cand["x2"]), float(cand["y2"])
                    area = max(1.0, (cx2 - cx1) * (cy2 - cy1))
                    border_ok = (
                        1.0
                        if (cx1 > margin_x and cy1 > margin_top and cx2 < (vid_w - margin_x) and cy2 < (vid_h - margin_bot))
                        else 0.2
                    )
                    arr = frame_groups.get(int(cand["frame_id"]))
                    max_iou = 0.0
                    if arr is not None and len(arr) > 1:
                        others = arr[arr[:, 0] != tid_f]
                        if len(others) > 0:
                            ix1 = np.maximum(cx1, others[:, 1])
                            iy1 = np.maximum(cy1, others[:, 2])
                            ix2 = np.minimum(cx2, others[:, 3])
                            iy2 = np.minimum(cy2, others[:, 4])
                            inter = np.maximum(0.0, ix2 - ix1) * np.maximum(0.0, iy2 - iy1)
                            max_iou = float(np.max(inter / area))
                    isolation = 1.0 if max_iou < 0.05 else max(0.1, 1.0 - max_iou * 2.5)
                    scored.append((area * border_ok * isolation, cand))
                scored.sort(key=lambda item: item[0], reverse=True)
                candidates = [c for _, c in scored[: (8 if portrait else 1)]]

            def _extract_padded_crop(frame_bgr: np.ndarray, row_obj: Any, is_portrait: bool) -> np.ndarray:
                fh, fw = frame_bgr.shape[:2]
                x1, y1, x2, y2 = float(row_obj["x1"]), float(row_obj["y1"]), float(row_obj["x2"]), float(row_obj["y2"])
                bw = max(12.0, x2 - x1)
                bh = max(20.0, y2 - y1)
                if is_portrait:
                    pad_x = max(18.0, bw * 0.42)
                    pad_top = max(28.0, bh * 0.38)
                    pad_bot = max(14.0, bh * 0.16)
                else:
                    pad_x = max(16.0, bw * 0.36)
                    pad_top = max(24.0, bh * 0.34)
                    pad_bot = max(14.0, bh * 0.16)
                cx1 = int(max(0, round(x1 - pad_x)))
                cy1 = int(max(0, round(y1 - pad_top)))
                cx2 = int(min(fw, round(x2 + pad_x)))
                cy2 = int(min(fh, round(y2 + pad_bot)))
                crop_img = frame_bgr[cy1:cy2, cx1:cx2]
                if crop_img.size == 0:
                    crop_img = frame_bgr[0 : min(180, fh), 0 : min(140, fw)]
                return crop_img

            best_crop = None
            best_fid = int(candidates[0]["frame_id"])
            if not portrait:
                fid = int(candidates[0]["frame_id"])
                cache_path = self.data_paths.cache / "crops_v3" / mid / f"t{int(track_id)}_f{fid}.jpg"
                if cache_path.is_file():
                    return cache_path.read_bytes()
                cap.set(cv2.CAP_PROP_POS_FRAMES, fid)
                ok, frame = cap.read()
                if not ok or frame is None:
                    raise FileNotFoundError(f"Frame {fid} unreadable")
                crop = _extract_padded_crop(frame, candidates[0], is_portrait=False)
                target_h = 220
                scale = target_h / max(1, crop.shape[0])
                target_w = max(80, min(220, int(round(crop.shape[1] * scale))))
                resized = cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_CUBIC)
                imwrite_unicode(cache_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 92])
                return cache_path.read_bytes()

            best_sharp_score = -1.0
            for cand in candidates:
                fid_c = int(cand["frame_id"])
                cap.set(cv2.CAP_PROP_POS_FRAMES, fid_c)
                ok, frame = cap.read()
                if not ok or frame is None:
                    continue
                crop_c = _extract_padded_crop(frame, cand, is_portrait=True)
                gray = cv2.cvtColor(crop_c, cv2.COLOR_BGR2GRAY)
                lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                area_c = max(1.0, (float(cand["x2"]) - float(cand["x1"])) * (float(cand["y2"]) - float(cand["y1"])))
                sharp_score = lap_var * (area_c ** 0.5)
                if sharp_score > best_sharp_score or best_crop is None:
                    best_sharp_score = sharp_score
                    best_crop = crop_c
                    best_fid = fid_c

            if best_crop is None:
                raise FileNotFoundError(f"Frame {best_fid} unreadable")

            target_h = 360
            scale = target_h / max(1, best_crop.shape[0])
            target_w = max(160, min(320, int(round(best_crop.shape[1] * scale))))
            resized = cv2.resize(best_crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

            # Isolate central player with yolo11n-seg when available so neighbouring limbs/grass are softly dimmed
            seg_model = _get_person_seg_model(self.data_paths.root)
            if seg_model is not None:
                try:
                    s_res = seg_model.predict(resized, classes=[0], conf=0.25, imgsz=320, verbose=False)[0]
                    if s_res.masks is not None and len(s_res.masks.data) > 0:
                        masks_np = s_res.masks.data.cpu().numpy()
                        boxes_np = s_res.boxes.xyxy.cpu().numpy()
                        cx_t, cy_t = target_w * 0.5, target_h * 0.52
                        best_m_idx = int(
                            np.argmin(
                                [
                                    np.hypot(0.5 * (b[0] + b[2]) - cx_t, 0.5 * (b[1] + b[3]) - cy_t)
                                    for b in boxes_np
                                ]
                            )
                        )
                        raw_mask = cv2.resize(
                            masks_np[best_m_idx].astype(np.float32),
                            (target_w, target_h),
                            interpolation=cv2.INTER_LINEAR,
                        )
                        soft_mask = cv2.GaussianBlur(np.clip(raw_mask, 0.0, 1.0), (11, 11), 3.0)[..., None]
                        bg_dim = (cv2.GaussianBlur(resized, (13, 13), 4.0).astype(np.float32) * 0.34)
                        resized = np.clip(resized.astype(np.float32) * soft_mask + bg_dim * (1.0 - soft_mask), 0, 255).astype(np.uint8)
                except Exception:
                    pass

            blurred = cv2.GaussianBlur(resized, (0, 0), 1.1)
            sharpened = cv2.addWeighted(resized, 1.22, blurred, -0.22, 0)
            cache_tag = f"t{int(track_id)}_p{int(frame_id) if frame_id is not None else 'best'}"
            cache_path = self.data_paths.cache / "crops_v5" / mid / f"{cache_tag}.jpg"
            imwrite_unicode(cache_path, sharpened, [cv2.IMWRITE_JPEG_QUALITY, 92])
            return cache_path.read_bytes()
        finally:
            cap.release()
            if proxy is not None and proxy.exists():
                try:
                    proxy.unlink()
                except OSError:
                    pass

    def _player_photo_path(self, tenant_id: str, match_id: str, track_id: int) -> Path:
        return (
            self.data_paths.outputs
            / "player_photos"
            / self._validate_id(tenant_id)
            / self._validate_id(match_id)
            / f"t{int(track_id)}.jpg"
        )

    def save_player_photo(self, tenant_id: str, match_id: str, track_id: int, raw: bytes) -> Path:
        """Validate, center-crop 3:4, resize to 720px height, and strip EXIF metadata as JPEG."""
        if not raw:
            raise ValueError("Empty image file")
        if len(raw) > 5 * 1024 * 1024:
            raise ValueError("Image size exceeds 5 MB limit")
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None or img.size == 0:
            raise ValueError("Invalid or unsupported image format")

        h, w = img.shape[:2]
        target_ratio = 3.0 / 4.0
        cur_ratio = w / max(1, h)
        if cur_ratio > target_ratio:
            new_w = max(1, int(round(h * target_ratio)))
            x0 = (w - new_w) // 2
            cropped = img[:, x0 : x0 + new_w]
        else:
            new_h = max(1, int(round(w / target_ratio)))
            y0 = max(0, (h - new_h) // 4)
            cropped = img[y0 : min(h, y0 + new_h), :]

        out_img = cv2.resize(cropped, (540, 720), interpolation=cv2.INTER_LANCZOS4)
        dest = self._player_photo_path(tenant_id, match_id, track_id)
        imwrite_unicode(dest, out_img, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return dest

    def delete_player_photo(self, tenant_id: str, match_id: str, track_id: int) -> bool:
        dest = self._player_photo_path(tenant_id, match_id, track_id)
        if dest.is_file():
            dest.unlink()
            return True
        return False

    def _find_cached_club_portrait(
        self, player_name_en: str = "", club_id: str = "", jersey_number: Optional[int] = None
    ) -> Optional[Path]:
        """Resolve pre-cached real player portrait JPEG for official club squad players."""
        p_dir = self.data_paths.cache / "club_portraits"
        if not p_dir.is_dir():
            return None
        if club_id and jersey_number:
            c_path = p_dir / f"{club_id}_{int(jersey_number)}.jpg"
            if c_path.is_file():
                return c_path
        clean_en = re.sub(r"[^a-z0-9]+", "_", (player_name_en or "").lower()).strip("_")
        if clean_en:
            s_path = p_dir / f"{clean_en}.jpg"
            if s_path.is_file():
                return s_path
        return None

    def _lookup_squad_entry_meta(
        self, tenant_id: str, match_id: str, team: str, jersey_number: Optional[int], name_ar: str
    ) -> dict[str, Any]:
        saved_lineup = self._load_qa_lineup(tenant_id, match_id)
        roster_lookup = saved_lineup.get("official_roster") or DEFAULT_MATCH_ROSTERS.get(match_id, [])
        for rr in roster_lookup:
            if rr.get("team") == team and (
                (jersey_number and int(rr.get("jersey_number") or 0) == int(jersey_number))
                or (name_ar and name_ar in str(rr.get("name_ar") or rr.get("name") or ""))
            ):
                return rr
        return {}

    def _resolve_team_club_id(self, tenant_id: str, match_id: str, team: str) -> str:
        saved_lineup = self._load_qa_lineup(tenant_id, match_id)
        if isinstance(saved_lineup, dict):
            k = "club_a_id" if team == "team_a" else "club_b_id"
            if saved_lineup.get(k):
                return str(saved_lineup[k])
        pair = DEFAULT_MATCH_CLUB_IDS.get(match_id)
        if pair:
            return pair[0] if team == "team_a" else pair[1]
        return ""

    def get_player_photo_jpeg(self, tenant_id: str, match_id: str, track_id: int) -> tuple[bytes, str]:
        dest = self._player_photo_path(tenant_id, match_id, track_id)
        if dest.is_file():
            return dest.read_bytes(), "upload"
        card = self.get_player_card(tenant_id, match_id, track_id)
        if card.get("photo_source") == "club_portrait":
            c_path = self._find_cached_club_portrait(
                str(card.get("display_label_en") or ""),
                club_id=str(card.get("club_id") or ""),
                jersey_number=card.get("jersey_number"),
            )
            if c_path is not None:
                return c_path.read_bytes(), "club_portrait"
        pool = self._compute_match_card_pool(match_id)
        entry = pool["all_tracks"].get(int(track_id))
        peak_fid = entry.get("peak_frame_id") if isinstance(entry, dict) else None
        return self.render_track_crop_jpeg(match_id, track_id, frame_id=peak_fid, portrait=True), "video"

    def list_verified_rosters(self) -> dict[str, Any]:
        """Return verified club squads from datasets/rosters/clubs_2025_26.json."""
        return _load_clubs_rosters_json()

    def import_match_roster(self, tenant_id: str, match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Bind verified club rosters or custom player list to a match and refresh consolidated cards."""
        mid = self._validate_id(match_id)
        clubs = _load_clubs_rosters_json().get("clubs", {})
        club_a_id = str(payload.get("club_a_id") or "").strip()
        club_b_id = str(payload.get("club_b_id") or "").strip()
        custom_players = payload.get("custom_players") if isinstance(payload.get("custom_players"), list) else []

        roster_entries: list[dict[str, Any]] = []
        if club_a_id and club_a_id in clubs:
            roster_entries.extend(_tag_team(_squad_from_clubs_json(club_a_id), "team_a"))
        if club_b_id and club_b_id in clubs:
            tag_ar = str(clubs[club_b_id].get("name_ar") or "")
            roster_entries.extend(_tag_team(_squad_from_clubs_json(club_b_id, tag_ar), "team_b"))
        for cp in custom_players:
            if not isinstance(cp, dict):
                continue
            nar = str(cp.get("name_ar") or cp.get("name") or "").strip()
            if not nar:
                continue
            nen = str(cp.get("name_en") or nar).strip()
            pos = str(cp.get("position") or "CM").strip().upper()
            t_key = "team_b" if str(cp.get("team") or "team_a") == "team_b" else "team_a"
            roster_entries.append(
                {
                    "jersey_number": int(cp.get("jersey_number") or 0),
                    "name": f"{nar} ({pos})",
                    "name_ar": nar,
                    "name_en": nen,
                    "position": pos,
                    "team": t_key,
                    "is_starter": bool(cp.get("is_starter", True)),
                }
            )
        if not roster_entries:
            raise ValueError("No valid club_a_id, club_b_id, or custom_players supplied")

        saved_lineup = self._load_qa_lineup(tenant_id, mid)
        saved_lineup["official_roster"] = roster_entries
        if club_a_id and club_a_id in clubs:
            saved_lineup["club_a_id"] = club_a_id
        if club_b_id and club_b_id in clubs:
            saved_lineup["club_b_id"] = club_b_id
        if payload.get("reset_overrides"):
            saved_lineup["track_overrides"] = {}
        self._save_qa_lineup(tenant_id, mid, saved_lineup)
        self._player_card_pool_cache.clear()
        cards_res = self.list_player_cards(tenant_id, mid)
        return {"status": "imported", "roster_count": len(roster_entries), **cards_res}

    def save_batch_player_photos(
        self,
        tenant_id: str,
        match_id: str,
        team: str,
        items: list[tuple[str, bytes]],
    ) -> dict[str, Any]:
        """Bulk-match uploaded filenames (by jersey number or player name) to team tracks and save crops."""
        mid = self._validate_id(match_id)
        team_filter = "team_b" if str(team) == "team_b" else "team_a"
        cards_res = self.list_player_cards(tenant_id, mid)
        team_cards = [c for c in cards_res.get("players", []) if c.get("team") == team_filter]

        uploaded: list[dict[str, Any]] = []
        unmatched: list[str] = []
        for fname, raw in items:
            stem = Path(fname).stem.lower()
            norm_stem = re.sub(r"[^a-z0-9\u0600-\u06ff]+", " ", stem).strip()
            matched_card = None

            nums = re.findall(r"\d+", stem)
            if nums:
                j_num = int(nums[0])
                for c in team_cards:
                    if c.get("jersey_number") == j_num:
                        matched_card = c
                        break

            if matched_card is None and norm_stem:
                for c in team_cards:
                    candidates_txt = " ".join(
                        [
                            str(c.get("display_label") or "").lower(),
                            str(c.get("display_label_en") or "").lower(),
                            str(c.get("verified_name") or "").lower(),
                        ]
                    )
                    if all(tok in candidates_txt for tok in norm_stem.split()[:2]):
                        matched_card = c
                        break

            if matched_card is None:
                unmatched.append(fname)
                continue

            tid = int(matched_card["track_id"])
            self.save_player_photo(tenant_id, mid, tid, raw)
            card = self.get_player_card(tenant_id, mid, tid)
            uploaded.append(
                {
                    "filename": fname,
                    "track_id": tid,
                    "jersey_number": card.get("jersey_number"),
                    "display_label": card.get("display_label"),
                    "photo_url": card.get("photo_url"),
                }
            )
        return {"uploaded": uploaded, "unmatched": unmatched, "uploaded_count": len(uploaded)}

    def _lookup_public_player_photo_bytes(self, player_name_en: str, player_name_ar: str = "") -> Optional[bytes]:
        """Fetch real official player portrait via Wikimedia MediaWiki API or cached club portraits."""
        cached_p = self._find_cached_club_portrait(player_name_en=player_name_en)
        if cached_p is not None and cached_p.is_file():
            return cached_p.read_bytes()

        headers = {"User-Agent": "EGYScoutSportsAnalytics/10.6 (https://localhost; dev@egyscout.local)"}
        queries = [q.strip() for q in (player_name_en, player_name_ar) if q and q.strip() and not re.search(r"\bT\d+\b", q)]

        for q in queries:
            for wiki_lang in ("en", "ar"):
                try:
                    w_url = f"https://{wiki_lang}.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
                        {
                            "action": "query",
                            "titles": q,
                            "prop": "pageimages",
                            "pithumbsize": "600",
                            "redirects": "1",
                            "format": "json",
                        }
                    )
                    req = urllib.request.Request(w_url, headers=headers)
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        w_data = json.loads(resp.read().decode("utf-8"))
                    pages = (w_data.get("query") or {}).get("pages") or {}
                    for page in pages.values():
                        thumb_u = str((page.get("thumbnail") or {}).get("source") or "").strip()
                        if thumb_u.startswith("https://") and "upload.wikimedia.org" in thumb_u:
                            img_req = urllib.request.Request(thumb_u, headers=headers)
                            with urllib.request.urlopen(img_req, timeout=6) as ir:
                                raw = ir.read(5 * 1024 * 1024)
                            if len(raw) > 2048:
                                return raw
                except Exception:
                    pass
        return None

    def fetch_verified_player_photo(self, tenant_id: str, match_id: str, track_id: int) -> dict[str, Any]:
        """Auto-fetch real headshot for a verified/GK-matched player from TheSportsDB/Wikimedia."""
        mid = self._validate_id(match_id)
        card = self.get_player_card(tenant_id, mid, track_id)
        if card.get("identity_source") == "unverified":
            raise ValueError("وثّق هوية اللاعب أولاً (من مراجعة الهويات) قبل جلب صورته الرسمية.")
        raw = self._lookup_public_player_photo_bytes(
            str(card.get("display_label_en") or ""),
            str(card.get("display_label") or ""),
        )
        if not raw:
            raise ValueError("لم يتم العثور على صورة عامة للاعب — يمكنك رفع صورته مباشرة.")
        self.save_player_photo(tenant_id, mid, int(track_id), raw)
        updated = self.get_player_card(tenant_id, mid, int(track_id))
        return {"status": "fetched", "card": updated}

    def fetch_all_verified_photos(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        cards = self.list_player_cards(tenant_id, mid).get("players", [])
        fetched_count = 0
        for c in cards:
            if c.get("identity_source") == "unverified" or c.get("photo_source") == "upload":
                continue
            raw = self._lookup_public_player_photo_bytes(
                str(c.get("display_label_en") or ""),
                str(c.get("display_label") or ""),
            )
            if raw:
                try:
                    self.save_player_photo(tenant_id, mid, int(c["track_id"]), raw)
                    fetched_count += 1
                except Exception:
                    pass
        return {"fetched_count": fetched_count, **self.list_player_cards(tenant_id, mid)}

    def get_compute_status(self) -> dict[str, Any]:
        """Report Cloud-First acceleration readiness without ever exposing API secrets."""
        dev = get_compute_provider().get_device_info()
        has_groq = bool(os.environ.get("GROQ_API_KEY", "").strip().startswith("gsk_"))
        has_rf = bool(os.environ.get("ROBOFLOW_API_KEY", "").strip())
        worker_url = os.environ.get("EGY_SCOUT_CLOUD_WORKER_URL", "").strip()
        if worker_url:
            mode = "cloud_gpu_worker"
        elif has_rf:
            mode = "roboflow_serverless_gpu + groq_vision" if has_groq else "roboflow_serverless_gpu"
        elif dev.device == "cuda":
            mode = "local_cuda_gpu + groq_vision" if has_groq else "local_cuda_gpu"
        elif has_groq:
            mode = "groq_cloud_vision + edge_light"
        else:
            mode = "local_edge_cpu"

        return {
            "active_mode": mode,
            "has_groq_vision": has_groq,
            "has_roboflow_key": has_rf,
            "has_cloud_worker_url": bool(worker_url),
            "cloud_worker_host": urllib.parse.urlparse(worker_url).hostname if worker_url else None,
            "local_cuda_available": dev.device == "cuda",
            "gpu_name": dev.gpu_name,
            "recommended_cloud_options": [
                {
                    "id": "modal_l4",
                    "name": "Modal NVIDIA L4 GPU ($30/mo Free Tier)",
                    "desc_ar": "معالجة كاملة بـ GPU سحابي (4-Class YOLO + 32-KP + SigLIP + OCR) عبر modal deploy services/cv_worker/modal_gpu_app.py",
                },
                {
                    "id": "roboflow",
                    "name": "Roboflow Serverless Football API (Free Tier)",
                    "desc_ar": "كشف اللاعبين والكرة ومعايرة الملعب 32 نقطة أونلاين بدون تشغيل PyTorch على جهاز المستخدم.",
                },
                {
                    "id": "groq_vision",
                    "name": "Groq Cloud Vision LPU (qwen/qwen3.8-27b)",
                    "desc_ar": "قراءة أرقام القمصان ولوحة النتيجة سحابياً خلال ~1 ثانية.",
                },
            ],
        }

    def configure_cloud_compute(self, tenant_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Safely validate and apply runtime Cloud GPU Worker URL or Roboflow API key."""
        from services.cv_worker.cloud_cv_engine import _validate_cloud_endpoint_url

        cfg_path = self._tenant_dir(tenant_id) / "cloud_compute.json"
        existing = {}
        if cfg_path.is_file():
            try:
                existing = json.loads(cfg_path.read_text(encoding="utf-8"))
            except Exception:
                existing = {}

        if "cloud_worker_url" in payload:
            raw_u = str(payload.get("cloud_worker_url") or "").strip()
            if raw_u:
                clean_u = _validate_cloud_endpoint_url(raw_u)
                os.environ["EGY_SCOUT_CLOUD_WORKER_URL"] = clean_u
                existing["cloud_worker_url"] = clean_u
            else:
                os.environ.pop("EGY_SCOUT_CLOUD_WORKER_URL", None)
                existing["cloud_worker_url"] = ""

        if "roboflow_api_key" in payload:
            raw_k = str(payload.get("roboflow_api_key") or "").strip()
            if raw_k:
                if len(raw_k) < 8 or any(ch.isspace() for ch in raw_k):
                    raise ValueError("Invalid Roboflow API key format.")
                os.environ["ROBOFLOW_API_KEY"] = raw_k
                existing["has_roboflow_key"] = True
            else:
                os.environ.pop("ROBOFLOW_API_KEY", None)
                existing["has_roboflow_key"] = False

        cfg_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"status": "configured", **self.get_compute_status()}

    def _get_v8_parquet_mtime(self, match_id: str) -> float:
        meta = self._get_match_meta(match_id)
        candidates = []
        if meta.get("v8_parquet_path"):
            candidates.append(Path(meta["v8_parquet_path"]))
        candidates.append(self.data_paths.outputs / "custom_matches" / match_id / "v8.parquet")
        candidates.append(self.data_paths.outputs / "v8_4_parquet" / f"{match_id}_v8.parquet")
        for p in candidates:
            if p.is_file():
                return float(p.stat().st_mtime)
        return 0.0

    @staticmethod
    def _clean_player_name_only(raw_name: Optional[str]) -> str:
        s = str(raw_name or "").strip()
        if not s:
            return ""
        return re.sub(r"\s*\([^)]*\)\s*$", "", s).strip() or s

    def _consolidate_track_fragments(
        self, raw_entries: list[dict[str, Any]], max_per_team: int = 11
    ) -> list[dict[str, Any]]:
        """Merge non-overlapping broadcast-cut fragments of the same player and pick top 11 per team."""
        from packages.scouting_core.player_card import MAX_PHYSICAL_SPEED_KMH

        selected: list[dict[str, Any]] = []
        for team_key in ("team_a", "team_b"):
            t_items = sorted(
                [e for e in raw_entries if e.get("team") == team_key],
                key=lambda x: float(x.get("observed_s") or 0.0),
                reverse=True,
            )
            clusters: list[dict[str, Any]] = []
            for frag in t_items:
                f_tid = int(frag["track_id"])
                f_shot = f_tid // 1000
                f_gk = bool(frag.get("is_gk"))
                f_pos = frag.get("avg_position")
                merged_into = None
                for cl in clusters:
                    if bool(cl.get("is_gk")) != f_gk:
                        continue
                    if f_gk:
                        merged_into = cl
                        break
                    if f_shot in cl["_shots"] and not (
                        frag["first_frame"] > cl["_last_frame"] or frag["last_frame"] < cl["first_frame"]
                    ):
                        continue
                    c_pos = cl.get("avg_position")
                    if f_pos is None or c_pos is None:
                        continue
                    dist = float(np.hypot(float(f_pos["x_m"]) - float(c_pos["x_m"]), float(f_pos["y_m"]) - float(c_pos["y_m"])))
                    if dist <= 14.0:
                        merged_into = cl
                        break

                if merged_into is None:
                    clusters.append(
                        {
                            **frag,
                            "_shots": {f_shot},
                            "_last_frame": int(frag.get("last_frame", frag["first_frame"])),
                            "merged_track_ids": [f_tid],
                        }
                    )
                else:
                    cl = merged_into
                    w1 = max(0.05, float(cl.get("observed_s") or 0.0))
                    w2 = max(0.05, float(frag.get("observed_s") or 0.0))
                    w_sum = w1 + w2
                    cl["_shots"].add(f_shot)
                    cl["_last_frame"] = max(int(cl["_last_frame"]), int(frag.get("last_frame", frag["first_frame"])))
                    cl["merged_track_ids"].append(f_tid)
                    cl["observed_s"] = round(float(cl.get("observed_s") or 0.0) + float(frag.get("observed_s") or 0.0), 2)
                    cl["observed_min"] = round(cl["observed_s"] / 60.0, 2)
                    if cl.get("distance_m") is not None or frag.get("distance_m") is not None:
                        cl["distance_m"] = round(float(cl.get("distance_m") or 0.0) + float(frag.get("distance_m") or 0.0), 1)
                    if cl.get("sprints") is not None or frag.get("sprints") is not None:
                        cl["sprints"] = int(cl.get("sprints") or 0) + int(frag.get("sprints") or 0)
                    ts_candidates = [v for v in (cl.get("top_speed_kmh"), frag.get("top_speed_kmh")) if v is not None]
                    if ts_candidates:
                        cl["top_speed_kmh"] = round(min(MAX_PHYSICAL_SPEED_KMH, max(float(v) for v in ts_candidates)), 1)
                    if cl.get("avg_speed_kmh") is not None and frag.get("avg_speed_kmh") is not None:
                        cl["avg_speed_kmh"] = round((float(cl["avg_speed_kmh"]) * w1 + float(frag["avg_speed_kmh"]) * w2) / w_sum, 1)
                    if cl.get("distance_m") is not None and cl["observed_s"] >= MIN_WORK_RATE_SECONDS:
                        cl["work_rate_m_per_min"] = round(float(cl["distance_m"]) / max(cl["observed_s"] / 60.0, 1e-6), 1)
                    else:
                        cl["work_rate_m_per_min"] = None
                    if cl.get("avg_position") is not None and f_pos is not None:
                        cl["avg_position"] = {
                            "x_m": round((float(cl["avg_position"]["x_m"]) * w1 + float(f_pos["x_m"]) * w2) / w_sum, 1),
                            "y_m": round((float(cl["avg_position"]["y_m"]) * w1 + float(f_pos["y_m"]) * w2) / w_sum, 1),
                        }
                    if cl.get("heatmap") and frag.get("heatmap"):
                        hm1 = np.array(cl["heatmap"], dtype=np.float64) * w1
                        hm2 = np.array(frag["heatmap"], dtype=np.float64) * w2
                        comb = hm1 + hm2
                        s_tot = float(comb.sum())
                        if s_tot > 0:
                            comb /= s_tot
                        cl["heatmap"] = [[round(float(v), 4) for v in row] for row in comb]
                    cl["crop_is_low_res"] = bool(cl.get("crop_is_low_res", True) and frag.get("crop_is_low_res", True))
                    if not frag.get("crop_is_low_res", True) and frag.get("peak_frame_id") is not None:
                        cl["peak_frame_id"] = int(frag["peak_frame_id"])
                    if cl.get("parquet_jersey") is None and frag.get("parquet_jersey") is not None:
                        if float(frag.get("parquet_jersey_conf") or 0.0) >= 0.70:
                            cl["parquet_jersey"] = frag.get("parquet_jersey")
                            cl["parquet_jersey_conf"] = frag.get("parquet_jersey_conf")

            gks = [c for c in clusters if c.get("is_gk")][:1]
            outfields = [c for c in clusters if not c.get("is_gk")][: max(1, max_per_team - len(gks))]
            for cl in gks + outfields:
                cl.pop("_shots", None)
                cl.pop("_last_frame", None)
                selected.append(cl)
        return selected

    def _compute_match_card_pool(
        self, match_id: str, min_observed_s: float = 0.5, consolidate: bool = True
    ) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        pq_mtime = self._get_v8_parquet_mtime(mid)
        cache_key = (mid, pq_mtime, bool(consolidate))
        if cache_key in self._player_card_pool_cache:
            return self._player_card_pool_cache[cache_key]

        meta = self._get_match_meta(mid)
        fps = float(meta.get("fps") or 25.0)
        _, v8_df = self.get_legacy_and_v8_frames(mid)
        v8_stab = stabilize_dataframe_homography_drift(v8_df)
        dir_info = self._infer_attack_direction(v8_df)
        team_a_attacks_right = bool(dir_info.get("team_a_attacks_right", True))

        eligible = v8_stab[v8_stab["role"].isin(["player", "goalkeeper"]) & (v8_stab["track_id"] >= 0)]
        raw_entries: list[dict[str, Any]] = []
        for tid_val, t_df in eligible.groupby("track_id"):
            tid = int(tid_val)
            role_mode = str(t_df["role"].mode().iloc[0]) if not t_df["role"].dropna().empty else "player"
            team_mode = str(t_df["team"].mode().iloc[0]) if not t_df["team"].dropna().empty else "none"
            if team_mode not in ("team_a", "team_b"):
                continue
            atk_right = team_a_attacks_right if team_mode == "team_a" else (not team_a_attacks_right)
            stats = build_player_card_stats(t_df, fps=fps, attack_right=atk_right)
            first_frame = int(t_df["frame_id"].min())
            last_frame = int(t_df["frame_id"].max())
            first_time_s = round(float(t_df["time_s"].min()), 2) if "time_s" in t_df.columns else round(first_frame / max(1.0, fps), 2)
            raw_j = None
            raw_j_conf = 0.0
            if "jersey_number" in t_df.columns:
                vj = t_df.loc[t_df["jersey_number"] > 0, "jersey_number"]
                if not vj.empty:
                    cand_j = int(vj.mode().iloc[0])
                    if "jersey_conf" in t_df.columns:
                        jc_s = t_df.loc[t_df["jersey_number"] == cand_j, "jersey_conf"].dropna()
                        raw_j_conf = float(jc_s.max()) if not jc_s.empty else 0.0
                    if raw_j_conf >= 0.70:
                        raw_j = cand_j
            raw_entries.append(
                {
                    "track_id": tid,
                    "role": role_mode,
                    "is_gk": role_mode == "goalkeeper",
                    "team": team_mode,
                    "first_frame": first_frame,
                    "last_frame": last_frame,
                    "first_time_s": first_time_s,
                    "parquet_jersey": raw_j,
                    "parquet_jersey_conf": raw_j_conf,
                    **stats,
                }
            )

        filtered = [e for e in raw_entries if float(e.get("observed_s") or 0.0) >= min_observed_s]
        if len(filtered) < 6 and raw_entries:
            filtered = [e for e in raw_entries if float(e.get("observed_s") or 0.0) >= 0.3] or raw_entries

        if consolidate:
            pool_entries = self._consolidate_track_fragments(filtered, max_per_team=11)
        else:
            pool_entries = filtered

        assign_team_relative_positions(pool_entries, team_a_attacks_right=team_a_attacks_right)
        # Never invent 0-99 FIFA percentiles on short clips (< 5 min / 300s)
        pcts = compute_match_percentiles(pool_entries, min_pool_size=3, min_observed_s=300.0)
        by_tid = {int(e["track_id"]): {**e, "percentiles": pcts.get(int(e["track_id"]), {})} for e in pool_entries}
        raw_pcts = compute_match_percentiles(raw_entries, min_pool_size=3, min_observed_s=300.0)
        all_by_tid = {int(e["track_id"]): {**e, "percentiles": raw_pcts.get(int(e["track_id"]), {})} for e in raw_entries}
        for e in pool_entries:
            all_by_tid[int(e["track_id"])] = by_tid[int(e["track_id"])]
        pool_obj = {
            "match_id": mid,
            "fps": fps,
            "filtered_tracks": by_tid,
            "all_tracks": all_by_tid,
        }
        self._player_card_pool_cache[cache_key] = pool_obj
        return pool_obj

    def _resolve_match_auto_roster_map(
        self, tenant_id: str, match_id: str, entries: list[dict[str, Any]], overrides: dict[str, Any]
    ) -> dict[int, dict[str, Any]]:
        """Honest Position-Aware Roster Resolver:
        1) Priority: OCR-verified jersey matches ('ocr_verified').
        2) Lone GK track ('gk_role_match').
        3) For official club rosters, match remaining consolidated outfield tracks to starters
           only when Hungarian position compatibility >= 72 ('squad_spatial_match').
           Empty/unknown rosters stay strictly 'unverified' with zero hallucinated names!
        """
        saved_lineup = self._load_qa_lineup(tenant_id, match_id)
        roster_all = saved_lineup.get("official_roster") or DEFAULT_MATCH_ROSTERS.get(match_id, [])
        if not roster_all:
            return {}

        used_jerseys: dict[str, set[int]] = {"team_a": set(), "team_b": set()}
        for _, ov in overrides.items():
            if isinstance(ov, dict) and ov.get("verified") and ov.get("jersey_number"):
                t_k = str(ov.get("team") or "team_a")
                if t_k in used_jerseys:
                    used_jerseys[t_k].add(int(ov["jersey_number"]))

        auto_map: dict[int, dict[str, Any]] = {}
        for team_key in ("team_a", "team_b"):
            pool_by_jersey = {
                int(r["jersey_number"]): r
                for r in roster_all
                if str(r.get("team") or "team_a") == team_key and int(r.get("jersey_number") or 0) > 0
            }
            gk_starters = [
                r for r in roster_all
                if str(r.get("team") or "team_a") == team_key and str(r.get("position") or "").upper() == "GK"
            ]
            team_entries = [
                e for e in entries
                if str((overrides.get(str(e["track_id"])) or {}).get("team") or e.get("team")) == team_key
                and not ((overrides.get(str(e["track_id"])) or {}).get("verified") and (overrides.get(str(e["track_id"])) or {}).get("verified_name"))
            ]
            gk_assigned = False
            for e in team_entries:
                tid_i = int(e["track_id"])
                pq_j = e.get("parquet_jersey")
                pq_conf = float(e.get("parquet_jersey_conf") or 0.0)
                if pq_j is not None and pq_conf >= 0.70 and int(pq_j) in pool_by_jersey and int(pq_j) not in used_jerseys[team_key]:
                    matched_r = pool_by_jersey[int(pq_j)]
                    is_roster_gk = str(matched_r.get("position") or "").upper() == "GK"
                    if is_roster_gk == bool(e.get("is_gk")):
                        auto_map[tid_i] = {**matched_r, "_source": "ocr_verified"}
                        used_jerseys[team_key].add(int(pq_j))
                        if is_roster_gk:
                            gk_assigned = True
                elif e.get("is_gk") and not gk_assigned and len(gk_starters) >= 1:
                    gk_r = gk_starters[0]
                    gk_j = int(gk_r.get("jersey_number") or 0)
                    if gk_j not in used_jerseys[team_key]:
                        auto_map[tid_i] = {**gk_r, "_source": "gk_role_match"}
                        used_jerseys[team_key].add(gk_j)
                        gk_assigned = True
        return auto_map

    def _resolve_track_display_identity_map(self, tenant_id: str, match_id: str) -> dict[int, dict[str, Any]]:
        """Map every sub-track_id in timeline/moments to its consolidated player name and jersey."""
        mid = self._validate_id(match_id)
        pool = self._compute_match_card_pool(mid, min_observed_s=0.5, consolidate=True)
        saved_lineup = self._load_qa_lineup(tenant_id, mid)
        overrides = saved_lineup.get("track_overrides", {}) if isinstance(saved_lineup, dict) else {}
        entries = list(pool["filtered_tracks"].values())
        auto_map = self._resolve_match_auto_roster_map(tenant_id, mid, entries, overrides)
        id_map: dict[int, dict[str, Any]] = {}
        for entry in entries:
            tid = int(entry["track_id"])
            card = self._hydrate_player_card(
                tenant_id,
                mid,
                entry,
                include_heatmap=False,
                overrides=overrides,
                auto_roster_entry=auto_map.get(tid),
            )
            info = {
                "display_label": card["display_label"],
                "display_label_en": card.get("display_label_en") or card["display_label"],
                "verified_name": card.get("verified_name") or (
                    card["display_label"] if card.get("identity_source") in ("squad_spatial_match", "gk_role_match", "ocr_verified", "qa_verified") else None
                ),
                "verified_name_en": card.get("display_label_en") if card.get("identity_source") in ("squad_spatial_match", "gk_role_match", "ocr_verified", "qa_verified") else None,
                "jersey_number": card.get("jersey_number"),
                "position_code": (card.get("position_label") or {}).get("code"),
            }
            for sub_tid in entry.get("merged_track_ids", [tid]):
                id_map[int(sub_tid)] = info
        return id_map

    def _hydrate_player_card(
        self,
        tenant_id: str,
        match_id: str,
        entry: dict[str, Any],
        include_heatmap: bool = True,
        overrides: Optional[dict[str, Any]] = None,
        auto_roster_entry: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        meta = self._get_match_meta(match_id)
        kit_colors = self.get_match_kit_colors(match_id)
        if overrides is None:
            saved_lineup = self._load_qa_lineup(tenant_id, match_id)
            overrides = saved_lineup.get("track_overrides", {}) if isinstance(saved_lineup, dict) else {}

        tid = int(entry["track_id"])
        ov = overrides.get(str(tid), {}) if isinstance(overrides, dict) else {}
        team = str(ov.get("team", entry["team"]))
        role = str(ov.get("role", entry["role"]))
        if role == "goalkeeper" and entry.get("position_label", {}).get("code") != "GK":
            pos_label = {"code": "GK", "ar": "حارس مرمى", "en": "Goalkeeper"}
        else:
            pos_label = entry["position_label"]

        ta_ar = meta.get("team_a_name_ar", meta["team_a_name"])
        tb_ar = meta.get("team_b_name_ar", meta["team_b_name"])
        ta_en = meta.get("team_a_name", "Team A")
        tb_en = meta.get("team_b_name", "Team B")
        team_ar = ta_ar if team == "team_a" else tb_ar
        team_en = ta_en if team == "team_a" else tb_en
        kit_hex = kit_colors.get("team_a_hex", "#EF4444") if team == "team_a" else kit_colors.get("team_b_hex", "#38BDF8")
        team_club_id = self._resolve_team_club_id(tenant_id, match_id, team)

        _, base_id, _ = self._clean_display_track_id(tid)
        v_name = ov.get("verified_name")
        manual_name = str(v_name).strip() if v_name and str(v_name).strip() else None
        raw_j = ov.get("jersey_number", entry.get("parquet_jersey"))
        jersey_number = int(raw_j) if (raw_j is not None and int(raw_j) > 0) else None

        if ov.get("verified") and (manual_name is not None or jersey_number is not None):
            identity_source = "qa_verified"
            verified = True
            clean_ar = self._clean_player_name_only(manual_name) if manual_name else f"{team_ar} #{jersey_number}"
            clean_en = clean_ar
            saved_lineup_ref = self._load_qa_lineup(tenant_id, match_id)
            roster_lookup = saved_lineup_ref.get("official_roster") or DEFAULT_MATCH_ROSTERS.get(match_id, [])
            for rr in roster_lookup:
                if rr.get("team") == team and (
                    (jersey_number and int(rr.get("jersey_number") or 0) == jersey_number)
                    or (clean_ar and clean_ar in str(rr.get("name_ar") or rr.get("name") or ""))
                ):
                    if rr.get("name_en"):
                        clean_en = str(rr["name_en"])
                    mapped_pos = get_position_label_dict(rr.get("position"))
                    if mapped_pos is not None:
                        pos_label = mapped_pos
                    break
            display_label = clean_ar
            display_label_en = clean_en
            verified_name = clean_ar
        elif auto_roster_entry is not None:
            src_tag = str(auto_roster_entry.get("_source") or "ocr_verified")
            identity_source = (
                src_tag if src_tag in ("ocr_verified", "gk_role_match", "squad_spatial_match") else "ocr_verified"
            )
            verified = identity_source == "ocr_verified"
            r_ar = self._clean_player_name_only(auto_roster_entry.get("name_ar") or auto_roster_entry.get("name"))
            r_en = str(auto_roster_entry.get("name_en") or r_ar).strip()
            r_j = int(auto_roster_entry.get("jersey_number") or 0)
            if jersey_number is None and r_j > 0:
                jersey_number = r_j
            mapped_pos = get_position_label_dict(auto_roster_entry.get("position"))
            if mapped_pos is not None:
                pos_label = mapped_pos
            display_label = r_ar or f"{team_ar} • T{base_id}"
            display_label_en = r_en or f"{team_en} • T{base_id}"
            verified_name = r_ar if verified else None
        else:
            identity_source = "unverified"
            verified = False
            pos_ar = pos_label.get("ar", "لاعب")
            pos_code = pos_label.get("code", "PL")
            j_prefix = f"#{jersey_number} • " if jersey_number else ""
            display_label = f"{team_ar} • {j_prefix}{pos_ar} (T{base_id})"
            display_label_en = f"{team_en} • {j_prefix}{pos_code} (T{base_id})"
            verified_name = None

        photo_path = self._player_photo_path(tenant_id, match_id, tid)
        crop_low_res = bool(entry.get("crop_is_low_res", True))
        if photo_path.is_file():
            photo_source = "upload"
            crop_low_res = False
            ver = int(photo_path.stat().st_mtime)
        else:
            c_portrait = (
                self._find_cached_club_portrait(
                    display_label_en,
                    club_id=team_club_id,
                    jersey_number=jersey_number,
                )
                if identity_source != "unverified"
                else None
            )
            if c_portrait is not None:
                photo_source = "club_portrait"
                crop_low_res = False
                ver = int(c_portrait.stat().st_mtime)
            else:
                photo_source = "video"
                ver = int(entry.get("peak_frame_id", entry["first_frame"]))
        photo_url = f"/api/matches/{match_id}/players/{tid}/photo?v={ver}"

        pcts = dict(entry.get("percentiles") or {})
        for pk in ("spd", "dst", "wrk", "spr", "avg", "min"):
            pcts.setdefault(pk, None)

        out = {
            "match_id": match_id,
            "track_id": tid,
            "base_track_id": base_id,
            "team": team,
            "club_id": team_club_id,
            "nationality_code": _infer_nationality_code(display_label_en, team_club_id)
            if identity_source != "unverified"
            else None,
            "team_name_ar": team_ar,
            "team_name_en": team_en,
            "kit_hex": kit_hex,
            "role": role,
            "jersey_number": jersey_number,
            "verified_name": verified_name,
            "verified": verified,
            "identity_source": identity_source,
            "display_label": display_label,
            "display_label_en": display_label_en,
            "position_label": pos_label,
            "photo_url": photo_url,
            "photo_source": photo_source,
            "crop_is_low_res": crop_low_res,
            "peak_frame_id": int(entry.get("peak_frame_id", entry["first_frame"])),
            "first_frame": entry["first_frame"],
            "first_time_s": entry["first_time_s"],
            "merged_track_ids": entry.get("merged_track_ids", [tid]),
            "kind": entry["kind"],
            "tier": entry["tier"],
            "observed_s": entry["observed_s"],
            "observed_min": entry["observed_min"],
            "distance_m": entry["distance_m"],
            "top_speed_kmh": entry["top_speed_kmh"],
            "avg_speed_kmh": entry["avg_speed_kmh"],
            "work_rate_m_per_min": entry["work_rate_m_per_min"],
            "sprints": entry["sprints"],
            "avg_position": entry["avg_position"],
            "percentiles": pcts,
            "quality": entry["quality"],
            "reason": entry.get("reason"),
        }
        if include_heatmap:
            out["heatmap"] = entry["heatmap"]
        return out

    def list_player_cards(
        self, tenant_id: str, match_id: str, min_observed_s: float = 0.5, consolidate: bool = True
    ) -> dict[str, Any]:
        """List consolidated honest FIFA/Fantasy style player cards for both teams in a match."""
        mid = self._validate_id(match_id)
        pool = self._compute_match_card_pool(mid, min_observed_s=min_observed_s, consolidate=consolidate)
        meta = self._get_match_meta(mid)
        saved_lineup = self._load_qa_lineup(tenant_id, mid)
        overrides = saved_lineup.get("track_overrides", {}) if isinstance(saved_lineup, dict) else {}
        entries = list(pool["filtered_tracks"].values())
        auto_map = self._resolve_match_auto_roster_map(tenant_id, mid, entries, overrides)
        cards = [
            self._hydrate_player_card(
                tenant_id,
                mid,
                entry,
                include_heatmap=False,
                overrides=overrides,
                auto_roster_entry=auto_map.get(int(entry["track_id"])),
            )
            for entry in entries
        ]
        kept_cards = [
            c
            for c in cards
            if float(c.get("observed_s") or 0.0) >= 3.0
            or c.get("identity_source") in ("qa_verified", "ocr_verified", "gk_role_match")
        ]
        short_tracks_count = len(cards) - len(kept_cards)
        team_a = sorted([c for c in kept_cards if c["team"] == "team_a"], key=lambda x: float(x["observed_s"] or 0.0), reverse=True)
        team_b = sorted([c for c in kept_cards if c["team"] == "team_b"], key=lambda x: float(x["observed_s"] or 0.0), reverse=True)
        if consolidate:
            team_a = team_a[:11]
            team_b = team_b[:11]
        else:
            team_a = team_a[:30]
            team_b = team_b[:30]
        combined = team_a + team_b
        return {
            "match_id": mid,
            "consolidated": bool(consolidate),
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "team_a_name_ar": meta.get("team_a_name_ar", meta["team_a_name"]),
            "team_b_name_ar": meta.get("team_b_name_ar", meta["team_b_name"]),
            "kit_colors": self.get_match_kit_colors(mid),
            "players": combined,
            "count": len(combined),
            "short_tracks_count": short_tracks_count,
        }

    def get_identity_candidates(self, tenant_id: str, match_id: str, track_id: int) -> dict[str, Any]:
        """Return official roster candidates for manual 1-click assignment sorted by positional compatibility."""
        mid = self._validate_id(match_id)
        card = self.get_player_card(tenant_id, mid, track_id)
        team = str(card["team"])
        pos_code = str((card.get("position_label") or {}).get("code") or "CM").upper()
        merged_ids = {str(x) for x in (card.get("merged_track_ids") or [track_id])}
        saved_lineup = self._load_qa_lineup(tenant_id, mid)
        roster_all = saved_lineup.get("official_roster") or DEFAULT_MATCH_ROSTERS.get(mid, [])
        overrides = saved_lineup.get("track_overrides", {}) if isinstance(saved_lineup, dict) else {}

        used_jerseys: set[int] = set()
        for tid_k, ov in overrides.items():
            if tid_k in merged_ids or not isinstance(ov, dict):
                continue
            if ov.get("verified") and str(ov.get("team") or "team_a") == team and ov.get("jersey_number"):
                used_jerseys.add(int(ov["jersey_number"]))

        candidates: list[dict[str, Any]] = []
        for r in roster_all:
            if str(r.get("team") or "team_a") != team:
                continue
            r_j = int(r.get("jersey_number") or 0)
            r_pos = str(r.get("position") or "CM").upper()
            r_ar = self._clean_player_name_only(r.get("name_ar") or r.get("name"))
            r_en = str(r.get("name_en") or r_ar).strip()
            candidates.append(
                {
                    "jersey_number": r_j,
                    "name_ar": r_ar,
                    "name_en": r_en,
                    "position": r_pos,
                    "compat": int(_slot_position_compatibility(pos_code, r_pos)),
                    "already_assigned": r_j in used_jerseys,
                }
            )
        candidates.sort(key=lambda item: (-item["compat"], item["already_assigned"], item["jersey_number"]))
        return {
            "match_id": mid,
            "track_id": int(track_id),
            "team": team,
            "candidates": candidates,
        }

    def assign_track_identity(
        self,
        tenant_id: str,
        match_id: str,
        track_id: int,
        team: str,
        jersey_number: Optional[int],
    ) -> dict[str, Any]:
        """Assign or clear a verified squad player identity on all merged sub-tracks of a player card."""
        mid = self._validate_id(match_id)
        if team not in ("team_a", "team_b"):
            raise ValueError("Invalid team; must be team_a or team_b")
        card = self.get_player_card(tenant_id, mid, track_id)
        target_tids = [int(x) for x in (card.get("merged_track_ids") or [track_id])]
        saved_lineup = self._load_qa_lineup(tenant_id, mid)
        if not isinstance(saved_lineup, dict):
            saved_lineup = {}
        overrides = dict(saved_lineup.get("track_overrides") or {})

        if jersey_number is None:
            for t in target_tids:
                overrides.pop(str(t), None)
        else:
            j_int = int(jersey_number)
            if j_int < 1 or j_int > 99:
                raise ValueError("jersey_number must be between 1 and 99")
            roster_all = saved_lineup.get("official_roster") or DEFAULT_MATCH_ROSTERS.get(mid, [])
            matched_r = None
            for r in roster_all:
                if str(r.get("team") or "team_a") == team and int(r.get("jersey_number") or 0) == j_int:
                    matched_r = r
                    break
            if matched_r is None:
                raise ValueError(f"Jersey #{j_int} not found in {team} roster")
            name_ar = self._clean_player_name_only(matched_r.get("name_ar") or matched_r.get("name"))
            r_role = "goalkeeper" if str(matched_r.get("position") or "").upper() == "GK" else "player"
            for t in target_tids:
                overrides[str(t)] = {
                    "verified": True,
                    "verified_name": name_ar,
                    "jersey_number": j_int,
                    "team": team,
                    "role": r_role,
                }

        saved_lineup["track_overrides"] = overrides
        self._save_qa_lineup(tenant_id, mid, saved_lineup)
        self._player_card_pool_cache.clear()
        return {"card": self.get_player_card(tenant_id, mid, track_id)}

    def get_player_card(self, tenant_id: str, match_id: str, track_id: int) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        pool = self._compute_match_card_pool(mid, consolidate=True)
        entry = pool["filtered_tracks"].get(int(track_id)) or pool["all_tracks"].get(int(track_id))
        if entry is None:
            raise FileNotFoundError(f"Track {track_id} not found in {mid}")
        saved_lineup = self._load_qa_lineup(tenant_id, mid)
        overrides = saved_lineup.get("track_overrides", {}) if isinstance(saved_lineup, dict) else {}
        entries = list(pool["filtered_tracks"].values())
        auto_map = self._resolve_match_auto_roster_map(tenant_id, mid, entries, overrides)
        return self._hydrate_player_card(
            tenant_id,
            mid,
            entry,
            include_heatmap=True,
            overrides=overrides,
            auto_roster_entry=auto_map.get(int(entry["track_id"])),
        )

    def get_groq_models(self) -> dict[str, Any]:
        """Fetch live Groq models from /openai/v1/models with a 10-min cache and clean fallback."""
        key = os.environ.get("GROQ_API_KEY", "").strip()
        if not key or not key.startswith("gsk_"):
            return {"models": DEFAULT_GROQ_MODELS, "source": "fallback", "has_key": False, "live_ids": []}

        now = time.time()
        if self._groq_models_cache is not None and (now - self._groq_models_cache[0]) < 600.0:
            _, models, source = self._groq_models_cache
            return {"models": models, "source": source, "has_key": True}

        try:
            req = urllib.request.Request(
                "https://api.groq.com/openai/v1/models",
                headers={
                    "Authorization": f"Bearer {key}",
                    "User-Agent": "EGY-SCOUT-Pro-Studio/10.0",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            raw_list = data.get("data", []) if isinstance(data, dict) else []
            live_ids = {str(m.get("id")) for m in raw_list if isinstance(m, dict) and m.get("id")}
            if live_ids:
                curated = [DEFAULT_GROQ_MODELS[0]]
                known_ids = set()
                for item in DEFAULT_GROQ_MODELS[1:]:
                    if item["id"] in live_ids:
                        curated.append(item)
                        known_ids.add(item["id"])
                for mid_id in sorted(live_ids):
                    if mid_id not in known_ids and not any(
                        x in mid_id.lower() for x in ("whisper", "guard", "tts", "orpheus", "safeguard", "playai")
                    ):
                        curated.append({"id": mid_id, "ar": mid_id, "en": mid_id})
                self._groq_models_cache = (now, curated, "live")
                return {"models": curated, "source": "live", "has_key": True}
        except Exception:
            pass

        self._groq_models_cache = (now, DEFAULT_GROQ_MODELS, "fallback")
        return {"models": DEFAULT_GROQ_MODELS, "source": "fallback", "has_key": True}

    def _load_qa_lineup(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        """Load QA lineup & overrides from SQLite first, migrating legacy JSON seamlessly."""
        row = self.sqlite_store.get_qa_lineup(tenant_id, match_id)
        if row is not None:
            return row
        p = self._tenant_dir(tenant_id) / f"{match_id}_lineup.json"
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                self.sqlite_store.save_qa_lineup(tenant_id, match_id, data)
                return data
            except Exception:
                pass
        return {"official_roster": [], "track_overrides": {}}

    def _save_qa_lineup(self, tenant_id: str, match_id: str, data: dict[str, Any]) -> None:
        self.sqlite_store.save_qa_lineup(tenant_id, match_id, data)
        p = self._tenant_dir(tenant_id) / f"{match_id}_lineup.json"
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def get_match_timeline(self, match_id: str, tenant_id: str = "club_demo_egypt") -> dict[str, Any]:
        """Return enriched per-frame tracking timeline with Kalman ball arc, velocities & momentum."""
        mid = self._validate_id(match_id)
        meta = self._get_match_meta(mid)
        _, v8_df = self.get_legacy_and_v8_frames(mid)

        saved_lineup = self._load_qa_lineup(tenant_id, mid)
        overrides = saved_lineup.get("track_overrides", {})

        all_fids = sorted(int(f) for f in v8_df["frame_id"].unique().tolist())
        fid_to_time = {
            int(fid): float(grp["time_s"].iloc[0])
            for fid, grp in v8_df.groupby("frame_id", sort=True)
        }
        dir_info = self._infer_attack_direction(v8_df)
        dir_sign_a = 1.0 if dir_info["team_a_attacks_right"] else -1.0

        # Extract observed ball detections with confidence gate & teleportation spike rejection
        ball_df = v8_df[
            (v8_df["role"] == "ball")
            & v8_df["x_m"].notna()
            & v8_df["y_m"].notna()
            & (v8_df["role_conf"].fillna(0.0) >= 0.22)
        ].sort_values(["frame_id", "role_conf"], ascending=[True, False])
        raw_ball_m: dict[int, Optional[tuple[float, float]]] = {}
        raw_ball_uv: dict[int, tuple[float, float]] = {}
        last_clean_obs: Optional[tuple[float, float, float, float, float]] = None
        for _, br in ball_df.iterrows():
            bfid = int(br["frame_id"])
            if bfid in raw_ball_m:
                continue
            bx_m, by_m = float(br["x_m"]), float(br["y_m"])
            if pd.notna(br["u"]) and pd.notna(br["v"]):
                bu, bv = float(br["u"]), float(br["v"])
            elif pd.notna(br["x1"]) and pd.notna(br["y1"]):
                bu = 0.5 * (float(br["x1"]) + float(br["x2"]))
                bv = 0.5 * (float(br["y1"]) + float(br["y2"]))
            else:
                continue
            bts = fid_to_time.get(bfid, float(br["time_s"]))
            if last_clean_obs is not None:
                pt, pxm, pym, pu, pv = last_clean_obs
                dt_obs = bts - pt
                if 0.0 < dt_obs <= 0.65:
                    spd_m = float(np.hypot(bx_m - pxm, by_m - pym)) / dt_obs
                    spd_px = float(np.hypot(bu - pu, bv - pv)) / dt_obs
                    if spd_m > 38.0 or spd_px > 1600.0:
                        continue
            raw_ball_m[bfid] = (bx_m, by_m)
            raw_ball_uv[bfid] = (bu, bv)
            last_clean_obs = (bts, bx_m, by_m, bu, bv)

        ball_inputs = [(fid, fid_to_time[fid], raw_ball_m.get(fid)) for fid in all_fids]
        ball_states = {b.frame_id: b for b in track_and_inpaint_ball(ball_inputs, max_gap_frames=12)}

        # Identify calibrated frames so pixel interpolation NEVER bridges across close-ups or shot cuts
        valid = v8_df[v8_df["role"].isin(["player", "goalkeeper", "referee", "assistant_referee"])].copy()
        cal_fid_set: set[int] = set()
        for fid, grp in valid.groupby("frame_id", sort=False):
            if int((grp["x_m"].notna() & grp["y_m"].notna()).sum()) >= 4:
                cal_fid_set.add(int(fid))

        obs_uv_fids = sorted(raw_ball_uv.keys())
        # Precompute clean trajectory velocities & speeds (stabilize homography drift + local regression)
        vel_map: dict[tuple[int, int], tuple[float, float, float]] = {}
        fps_tl = float(meta.get("fps") or 25.0)
        v8_tl_stab = stabilize_dataframe_homography_drift(v8_df)
        people_df = v8_tl_stab[
            v8_tl_stab["role"].isin(["player", "goalkeeper", "referee", "assistant_referee"])
            & v8_tl_stab["x_m"].notna()
            & v8_tl_stab["y_m"].notna()
        ].sort_values(["track_id", "frame_id"])
        for tid, grp in people_df.groupby("track_id", sort=False):
            fids_t = grp["frame_id"].to_numpy(dtype=np.int32)
            ts_t = grp["time_s"].to_numpy(dtype=np.float64)
            xs_t = grp["x_m"].to_numpy(dtype=np.float64)
            ys_t = grp["y_m"].to_numpy(dtype=np.float64)
            kin = compute_clean_trajectory_kinematics(fids_t, ts_t, xs_t, ys_t, fps=fps_tl)
            vx_arr = kin["vx_ms"]
            vy_arr = kin["vy_ms"]
            spds_arr = kin["speeds_kmh"]
            for idx in range(len(fids_t)):
                vel_map[(int(tid), int(fids_t[idx]))] = (
                    round(float(vx_arr[idx]), 2),
                    round(float(vy_arr[idx]), 2),
                    round(float(spds_arr[idx]), 1),
                )

        track_identity_map = self._resolve_track_display_identity_map(tenant_id, mid)

        frames_out = []
        for fid, grp in valid.groupby("frame_id", sort=True):
            fid_int = int(fid)
            time_s = round(float(grp["time_s"].iloc[0]), 3)
            cal = grp[grp["x_m"].notna() & grp["y_m"].notna()]
            players = []
            for _, r in cal.iterrows():
                tid = int(r["track_id"])
                ov = overrides.get(str(tid), {})
                id_info = track_identity_map.get(tid, {})
                raw_j = ov.get("jersey_number", r["jersey_number"] if "jersey_number" in r else None)
                clean_j = int(raw_j) if (raw_j is not None and pd.notna(raw_j) and int(raw_j) > 0) else id_info.get("jersey_number")
                vx_ms, vy_ms, speed_kmh = vel_map.get((tid, fid_int), (0.0, 0.0, 0.0))
                players.append(
                    {
                        "track_id": tid,
                        "role": str(ov.get("role", r["role"])),
                        "team": str(ov.get("team", r["team"])),
                        "x_m": round(float(r["x_m"]), 2),
                        "y_m": round(float(r["y_m"]), 2),
                        "vx_ms": vx_ms,
                        "vy_ms": vy_ms,
                        "speed_kmh": speed_kmh,
                        "verified_name": ov.get("verified_name") or id_info.get("verified_name"),
                        "verified_name_en": id_info.get("verified_name_en"),
                        "jersey_number": clean_j,
                        "bbox": [
                            round(float(r["x1"]), 1),
                            round(float(r["y1"]), 1),
                            round(float(r["x2"]), 1),
                            round(float(r["y2"]), 1),
                        ],
                    }
                )

            calibrated = fid_int in cal_fid_set
            b_state = ball_states.get(fid_int)
            ball_payload = None
            if calibrated and b_state is not None:
                bu: Optional[float] = None
                bv: Optional[float] = None
                if fid_int in raw_ball_uv:
                    bu, bv = raw_ball_uv[fid_int]
                elif obs_uv_fids:
                    pos = bisect_right(obs_uv_fids, fid_int)
                    if 0 < pos < len(obs_uv_fids):
                        f_prev, f_next = obs_uv_fids[pos - 1], obs_uv_fids[pos]
                        t_span = fid_to_time[f_next] - fid_to_time[f_prev]
                        u_prev, v_prev = raw_ball_uv[f_prev]
                        u_next, v_next = raw_ball_uv[f_next]
                        px_dist = float(np.hypot(u_next - u_prev, v_next - v_prev))
                        has_uncal_gap = any(
                            f not in cal_fid_set for f in all_fids if f_prev < f < f_next
                        )
                        if (
                            (f_next - f_prev) <= 16
                            and t_span <= 0.70
                            and px_dist <= 320.0
                            and not has_uncal_gap
                        ):
                            frac = (fid_int - f_prev) / max(1, f_next - f_prev)
                            bu = u_prev + (u_next - u_prev) * frac
                            bv = v_prev + (v_next - v_prev) * frac
                ball_payload = {
                    "x_m": b_state.x_m,
                    "y_m": b_state.y_m,
                    "z_m": b_state.z_m,
                    "u": round(bu, 1) if bu is not None else None,
                    "v": round(bv, 1) if bv is not None else None,
                    "vx_ms": b_state.vx_ms,
                    "vy_ms": b_state.vy_ms,
                    "vx_px": 0.0,
                    "vy_px": 0.0,
                    "inpainted": b_state.inpainted,
                }

            # Possession & Oracle Match Momentum index [-100..+100] reflecting BOTH possession & territory tilt
            ball_carrier_id = None
            possession_team = "contested"
            momentum = 0.0
            if calibrated and players:
                field_players = [p for p in players if p["role"] in ("player", "goalkeeper")]
                poss_bias = 0.0
                if ball_payload is not None and field_players:
                    nearest = min(
                        field_players,
                        key=lambda p: np.hypot(p["x_m"] - ball_payload["x_m"], p["y_m"] - ball_payload["y_m"]),
                    )
                    if np.hypot(nearest["x_m"] - ball_payload["x_m"], nearest["y_m"] - ball_payload["y_m"]) <= 5.5:
                        ball_carrier_id = nearest["track_id"]
                        possession_team = nearest["team"]
                        poss_bias = 54.0 if possession_team == "team_a" else (-54.0 if possession_team == "team_b" else 0.0)
                    ball_tilt = ((ball_payload["x_m"] - 52.5) / 52.5) * 32.0 * dir_sign_a
                else:
                    ball_tilt = 0.0
                avg_x = sum(p["x_m"] for p in field_players) / max(1, len(field_players))
                line_tilt = ((avg_x - 52.5) / 52.5) * 18.0 * dir_sign_a
                momentum = round(float(np.clip(poss_bias + ball_tilt + line_tilt, -100.0, 100.0)), 1)

            frames_out.append(
                {
                    "frame_id": fid_int,
                    "time_s": time_s,
                    "calibrated": calibrated,
                    "ball": ball_payload,
                    "ball_carrier_id": ball_carrier_id,
                    "possession_team": possession_team,
                    "momentum": momentum,
                    "players": players,
                }
            )

        # Compute camera-pan-compensated pitch->screen Jacobian & ball velocity vector per calibrated frame
        for fr in frames_out:
            b = fr.get("ball")
            if b is None or b.get("u") is None or b.get("v") is None or not fr.get("calibrated"):
                continue
            pts = [
                (
                    float(p["x_m"]),
                    float(p["y_m"]),
                    0.5 * (float(p["bbox"][0]) + float(p["bbox"][2])),
                    float(p["bbox"][3]),
                )
                for p in fr["players"]
                if p["role"] in ("player", "goalkeeper")
            ]
            dudx, dudy, dvdx, dvdy = 28.0, 0.0, 0.0, 8.0
            if len(pts) >= 4:
                A = np.array([[x, y, 1.0] for x, y, _, _ in pts], dtype=np.float64)
                U = np.array([u for _, _, u, _ in pts], dtype=np.float64)
                V = np.array([v for _, _, _, v in pts], dtype=np.float64)
                cu, *_ = np.linalg.lstsq(A, U, rcond=None)
                cv, *_ = np.linalg.lstsq(A, V, rcond=None)
                if 5.0 <= abs(float(cu[0])) <= 95.0 and 2.0 <= abs(float(cv[1])) <= 45.0:
                    dudx, dudy = float(cu[0]), float(cu[1])
                    dvdx, dvdy = float(cv[0]), float(cv[1])

            vx_px = dudx * float(b["vx_ms"]) + dudy * float(b["vy_ms"])
            vy_px = dvdx * float(b["vx_ms"]) + dvdy * float(b["vy_ms"])
            spd_px = float(np.hypot(vx_px, vy_px))
            if spd_px > 1200.0 and spd_px > 1e-6:
                sc = 1200.0 / spd_px
                vx_px *= sc
                vy_px *= sc
            b["vx_px"] = round(vx_px, 1)
            b["vy_px"] = round(vy_px, 1)
            b["j_mat"] = [round(dudx, 2), round(dudy, 2), round(dvdx, 2), round(dvdy, 2)]

        cal_times = [f["time_s"] for f in frames_out if f["calibrated"]]
        return {
            "match_id": mid,
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "fps": float(meta.get("fps", 25.0) or 25.0),
            "t_start": cal_times[0] if cal_times else 0.0,
            "t_end": cal_times[-1] if cal_times else 0.0,
            "kit_colors": self.get_match_kit_colors(mid),
            **dir_info,
            "frames": frames_out,
        }

    @staticmethod
    def _clean_display_track_id(tid: int) -> tuple[str, int, int]:
        """Convert shot-scoped track_id (e.g. 8014) into clean human-friendly (#14, base_id=14, shot_id=8)."""
        t = int(tid)
        if t >= 1000:
            return f"#{t % 1000}", t % 1000, t // 1000
        return f"#{t}", t, 1

    @staticmethod
    def _pick_best_tactical_frame(
        v8_df: pd.DataFrame, requested_fid: Optional[int] = None, match_id: str = ""
    ) -> tuple[int, list[int]]:
        """Pick the requested frame if it has good two-team presence, otherwise pick the richest two-team tactical frame."""
        avail = sorted(int(x) for x in v8_df["frame_id"].unique().tolist())
        if not avail:
            return int(requested_fid or 1250), []
        if match_id == "m2_ahly_enppi" and requested_fid == 1250 and 1250 in avail:
            return 1250, avail

        p_rows = v8_df[v8_df["role"].isin(["player", "goalkeeper"]) & v8_df["team"].isin(["team_a", "team_b"])]
        if p_rows.empty:
            fid = int(requested_fid) if (requested_fid is not None and int(requested_fid) in avail) else avail[0]
            return fid, avail

        # Score each frame by number of players + strong bonus when BOTH team_a and team_b have >= 3 players
        frame_scores: dict[int, float] = {}
        for fid_val, grp in p_rows.groupby("frame_id"):
            vc = grp["team"].value_counts()
            ca = int(vc.get("team_a", 0))
            cb = int(vc.get("team_b", 0))
            both_bonus = 20.0 if (ca >= 3 and cb >= 3) else (10.0 if (ca >= 1 and cb >= 1) else 0.0)
            frame_scores[int(fid_val)] = float(ca + cb) + both_bonus + min(ca, cb) * 2.5

        ranked_fids = [f for f, _ in sorted(frame_scores.items(), key=lambda kv: kv[1], reverse=True)]
        best_fid = ranked_fids[0] if ranked_fids else avail[0]

        if requested_fid is not None and int(requested_fid) in avail:
            req_i = int(requested_fid)
            # If user explicitly picked a non-default frame OR if req_i has good two-team presence, honor it
            if req_i != 1250 or frame_scores.get(req_i, 0.0) >= 24.0:
                return req_i, ranked_fids[:60] if len(ranked_fids) >= 10 else avail[:60]

        return best_fid, ranked_fids[:60] if len(ranked_fids) >= 10 else avail[:60]

    def get_before_after(
        self, match_id: str, frame_id: int = 1250, tenant_id: str = "al_ahly_sc"
    ) -> dict[str, Any]:
        legacy_df, v8_df = self.get_legacy_and_v8_frames(match_id)
        fid, avail = self._pick_best_tactical_frame(v8_df, frame_id, match_id=match_id)

        saved_lineup = self._load_qa_lineup(tenant_id, match_id)
        overrides = saved_lineup.get("track_overrides", {})

        b_sub = legacy_df[legacy_df["frame_id"] == fid]
        a_sub = v8_df[v8_df["frame_id"] == fid]

        def _rows(sub: pd.DataFrame, apply_ov: bool = False) -> list[dict[str, Any]]:
            items = []
            for _, r in sub.iterrows():
                tid = int(r["track_id"])
                ov = overrides.get(str(tid), {}) if apply_ov else {}
                src_key = str(r["source_layer"])
                reason_ar, reason_en = ROLE_REASON_LABELS.get(src_key, ("تصنيف تلقائي", "Auto classified"))
                disp_id, base_id, shot_id = self._clean_display_track_id(tid)
                raw_j = ov.get("jersey_number", r["jersey_number"] if "jersey_number" in r else None)
                clean_j = int(raw_j) if (raw_j is not None and pd.notna(raw_j) and int(raw_j) > 0) else None
                items.append(
                    {
                        "track_id": tid,
                        "display_id": disp_id,
                        "base_track_id": base_id,
                        "shot_id": shot_id,
                        "role": str(ov.get("role", r["role"])),
                        "team": str(ov.get("team", r["team"])),
                        "jersey_number": clean_j,
                        "verified_name": ov.get("verified_name"),
                        "verified": bool(ov.get("verified", False)),
                        "role_conf": round(float(r["role_conf"]), 3),
                        "team_conf": round(float(r["team_conf"]), 3),
                        "bbox": [round(float(r["x1"]), 1), round(float(r["y1"]), 1), round(float(r["x2"]), 1), round(float(r["y2"]), 1)],
                        "x_m": round(float(r["x_m"]), 2) if pd.notna(r["x_m"]) else None,
                        "y_m": round(float(r["y_m"]), 2) if pd.notna(r["y_m"]) else None,
                        "on_pitch": bool(r["on_pitch"]),
                        "reason_ar": "مؤكّد يدوياً في ورقة الهويات" if ov.get("verified") else reason_ar,
                        "reason_en": "Manually verified in QA Sheet" if ov.get("verified") else reason_en,
                    }
                )
            return items

        def _stability(df: pd.DataFrame) -> float:
            valid = df[df["track_id"] >= 0]
            if valid.empty:
                return 0.0
            n_tracks = valid["track_id"].nunique()
            stable = sum(1 for _, g in valid.groupby("track_id") if g["role"].nunique() == 1)
            return round((stable / max(1, n_tracks)) * 100.0, 1)

        meta = self._get_match_meta(match_id)
        official_tracks = v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()
        unassigned_tracks = v8_df[v8_df["role"] == "unassigned"]["track_id"].nunique()
        after_rows = _rows(a_sub, apply_ov=True)

        return {
            "match_id": match_id,
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "team_a_name_ar": meta.get("team_a_name_ar", meta["team_a_name"]),
            "team_b_name_ar": meta.get("team_b_name_ar", meta["team_b_name"]),
            "kit_colors": self.get_match_kit_colors(match_id),
            "frame_id": int(fid),
            "available_frames": avail[:60],
            "before": {
                "detections": _rows(b_sub, apply_ov=False),
                "referees_in_frame": int(b_sub["role"].isin(["referee", "assistant_referee"]).sum()),
                "track_role_stability_pct": _stability(legacy_df),
            },
            "after": {
                "detections": after_rows,
                "referees_in_frame": sum(1 for d in after_rows if d["role"] in ("referee", "assistant_referee")),
                "unique_official_tracks": int(official_tracks),
                "unassigned_filtered_tracks": int(unassigned_tracks),
                "goalkeepers_in_frame": sum(1 for d in after_rows if d["role"] == "goalkeeper"),
                "track_role_stability_pct": _stability(v8_df),
            },
            "max_speed_cap_kmh": MAX_PHYSICAL_SPEED_KMH,
            "match_tracks_count": len(build_match_track_metadata(v8_df)),
        }

    def get_qa_sheet(
        self, tenant_id: str, match_id: str, frame_id: Optional[int] = 1250
    ) -> dict[str, Any]:
        meta = self._get_match_meta(match_id)
        kit_colors = self.get_match_kit_colors(match_id)
        fps = float(meta.get("fps", 25.0) or 25.0)
        _, v8_df = self.get_legacy_and_v8_frames(match_id)
        active_fid, _ = self._pick_best_tactical_frame(v8_df, frame_id, match_id=match_id)

        # Tracks visible in the active frame (or within +/- 8 frames so brief occlusions don't hide a player)
        exact_frame_df = v8_df[v8_df["frame_id"] == active_fid]
        near_frame_df = v8_df[(v8_df["frame_id"] >= active_fid - 8) & (v8_df["frame_id"] <= active_fid + 8)]
        exact_tids: dict[int, dict[str, Any]] = {}
        for _, r in exact_frame_df.iterrows():
            tid_i = int(r["track_id"])
            if tid_i >= 0:
                exact_tids[tid_i] = {
                    "bbox": [round(float(r["x1"]), 1), round(float(r["y1"]), 1), round(float(r["x2"]), 1), round(float(r["y2"]), 1)],
                    "x_m": round(float(r["x_m"]), 1) if pd.notna(r["x_m"]) else None,
                    "y_m": round(float(r["y_m"]), 1) if pd.notna(r["y_m"]) else None,
                }
        near_tids = set(int(x) for x in near_frame_df["track_id"].unique() if int(x) >= 0)

        tracks = build_match_track_metadata(v8_df)
        saved_lineup = self._load_qa_lineup(tenant_id, match_id)
        official_roster = saved_lineup.get("official_roster") or DEFAULT_MATCH_ROSTERS.get(match_id, [])
        overrides = saved_lineup.get("track_overrides", {})
        ta_ar = meta.get("team_a_name_ar", meta["team_a_name"])
        tb_ar = meta.get("team_b_name_ar", meta["team_b_name"])

        items = []
        for t in tracks:
            if t.role in ("unassigned", "ball", "staff") or t.track_id < 0:
                continue
            ov = overrides.get(str(t.track_id), {})
            role_val = str(ov.get("role", t.role))
            team_val = str(ov.get("team", t.team))
            raw_j = ov.get("jersey_number", t.jersey_number)
            clean_j = int(raw_j) if (raw_j is not None and int(raw_j) > 0) else None
            disp_id, base_id, shot_id = self._clean_display_track_id(t.track_id)
            in_exact = t.track_id in exact_tids
            in_near = in_exact or (t.track_id in near_tids)
            f_info = exact_tids.get(t.track_id, {})

            if role_val in ("referee", "assistant_referee"):
                team_label_ar = "طاقم التحكيم (Shield)"
                kit_hex = "#10B981"
            elif team_val == "team_a":
                team_label_ar = ta_ar
                kit_hex = kit_colors.get("team_a_hex", "#EF4444")
            elif team_val == "team_b":
                team_label_ar = tb_ar
                kit_hex = kit_colors.get("team_b_hex", "#38BDF8")
            else:
                team_label_ar = "غير محدد"
                kit_hex = "#94A3B8"

            crop_q = f"?frame_id={active_fid}" if in_exact else ""
            items.append(
                {
                    "track_id": t.track_id,
                    "display_id": disp_id,
                    "base_track_id": base_id,
                    "shot_id": shot_id,
                    "role": role_val,
                    "team": team_val,
                    "team_name_ar": team_label_ar,
                    "kit_hex": kit_hex,
                    "role_conf": round(t.role_conf, 3),
                    "frame_count": t.frame_count,
                    "observed_s": round(t.frame_count / max(1.0, fps), 1),
                    "first_frame": t.first_frame,
                    "in_current_frame": in_exact,
                    "in_active_shot": in_near,
                    "x_m": f_info.get("x_m"),
                    "y_m": f_info.get("y_m"),
                    "bbox_in_frame": f_info.get("bbox"),
                    "jersey_number": clean_j,
                    "verified_name": ov.get("verified_name"),
                    "verified": bool(ov.get("verified", False)),
                    "crop_url": f"/api/matches/{match_id}/track/{t.track_id}/crop{crop_q}",
                }
            )

        # Prioritize: 1) Visible in exact active frame, 2) Active shot, 3)Verified/Jersey, 4) Frame count
        items.sort(
            key=lambda x: (
                1 if x["in_current_frame"] else 0,
                1 if x["in_active_shot"] else 0,
                1 if x["verified"] else 0,
                x["frame_count"],
            ),
            reverse=True,
        )
        in_frame_count = sum(1 for x in items if x["in_current_frame"])
        return {
            "match_id": match_id,
            "active_frame_id": active_fid,
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "team_a_name_ar": ta_ar,
            "team_b_name_ar": tb_ar,
            "kit_colors": kit_colors,
            "official_roster": official_roster,
            "tracks": items,
            "in_frame_count": in_frame_count,
            "verified_count": sum(1 for x in items if x["verified"]),
            "unverified_count": sum(
                1 for x in items if not x["verified"] and x["role"] in ("player", "goalkeeper")
            ),
        }

    def auto_assign_roster_to_qa(
        self, tenant_id: str, match_id: str, frame_id: int = 1250
    ) -> dict[str, Any]:
        """1-Click Smart Roster Auto-Assignment for the 2-Minute Identity QA Sheet.

        Matches visible and sustained tracks in the match to the official match roster strictly by team and role
        (never cross-assigning Team A players to Team B tracks!), then persists verified names and jersey numbers.
        """
        qa = self.get_qa_sheet(tenant_id, match_id, frame_id=frame_id)
        default_roster = DEFAULT_MATCH_ROSTERS.get(match_id, [])
        saved_roster = qa["official_roster"] or []
        # Merge saved_roster with default_roster so both Team A and Team B always have full team-tagged pools
        merged_map: dict[tuple[str, int], dict[str, Any]] = {}
        for r in default_roster + saved_roster:
            t_key = str(r.get("team") or "team_a")
            j_key = int(r.get("jersey_number") or 0)
            if j_key > 0:
                merged_map[(t_key, j_key)] = {**r, "team": t_key}
        roster = list(merged_map.values()) if merged_map else list(default_roster)

        saved_lineup = self._load_qa_lineup(tenant_id, match_id)
        if not saved_lineup.get("official_roster"):
            saved_lineup["official_roster"] = roster
        overrides: dict[str, Any] = dict(saved_lineup.get("track_overrides", {}))

        roster_a = [r for r in roster if r.get("team", "team_a") == "team_a"]
        roster_b = [r for r in roster if r.get("team") == "team_b"]

        used_names: set[str] = set()
        assigned_count = 0

        # Prioritize tracks visible in current frame + top sustained tracks
        target_tracks = [
            t for t in qa["tracks"] if t["in_current_frame"] or t["frame_count"] >= 25
        ][:24]

        for idx, tr in enumerate(target_tracks):
            tid_s = str(tr["track_id"])
            role = tr["role"]
            team = tr["team"]
            if role in ("referee", "assistant_referee"):
                ref_label = "حكم الساحة الرئيسي" if role == "referee" else "حكم مساعد (خط التماس)"
                overrides[tid_s] = {
                    "role": role,
                    "team": "referee",
                    "jersey_number": None,
                    "verified_name": ref_label,
                    "verified": True,
                }
                assigned_count += 1
                continue

            # Strictly restrict to the track's own team pool (never assign Team A names to Team B!)
            pool = roster_a if team == "team_a" else roster_b
            avail_pool = [p for p in pool if str(p.get("name")) not in used_names]

            chosen = None
            if role == "goalkeeper":
                chosen = next((p for p in avail_pool if p.get("position") == "GK"), None)
            else:
                chosen = next((p for p in avail_pool if p.get("position") != "GK"), None)
            if chosen is None and avail_pool:
                chosen = avail_pool[0]

            if chosen is not None:
                used_names.add(str(chosen["name"]))
                overrides[tid_s] = {
                    "role": role,
                    "team": team,
                    "jersey_number": int(chosen["jersey_number"]),
                    "verified_name": str(chosen["name"]),
                    "verified": True,
                }
                assigned_count += 1
            else:
                team_ar = qa["team_a_name_ar"] if team == "team_a" else qa["team_b_name_ar"]
                fb = _fallback_identity(team, team_ar, int(tr["base_track_id"]))
                overrides[tid_s] = {
                    "role": role,
                    "team": team,
                    "jersey_number": fb["jersey_number"],
                    "verified_name": fb["verified_name"],
                    "verified": fb["verified"],
                }
                assigned_count += 1

        payload_to_save = {
            "official_roster": roster,
            "track_overrides": overrides,
        }
        self.save_lineup_and_qa(tenant_id, match_id, payload_to_save)
        return {
            "status": "auto_assigned",
            "assigned_count": assigned_count,
            "qa_sheet": self.get_qa_sheet(tenant_id, match_id, frame_id=frame_id),
        }

    def save_lineup_and_qa(
        self, tenant_id: str, match_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self._validate_id(match_id)
        self._save_qa_lineup(tenant_id, match_id, payload)

        # Sec 18.4 Active-Learning Flywheel: persist anonymized verified role/jersey corrections
        al_count = 0
        overrides = payload.get("track_overrides", {})
        if isinstance(overrides, dict) and overrides:
            al_path = self.data_paths.datasets / "egypt_benchmark" / "active_learning_queue.jsonl"
            al_path.parent.mkdir(parents=True, exist_ok=True)
            lines = []
            ts_now = int(time.time())
            for tid_s, ov in overrides.items():
                if not isinstance(ov, dict) or not ov.get("verified"):
                    continue
                lines.append(
                    json.dumps(
                        {
                            "ts": ts_now,
                            "match_id": match_id,
                            "track_id": int(tid_s) if tid_s.lstrip("-").isdigit() else tid_s,
                            "verified_role": ov.get("role"),
                            "verified_team": ov.get("team"),
                            "verified_jersey": ov.get("jersey_number"),
                        },
                        ensure_ascii=False,
                    )
                )
            if lines:
                with al_path.open("a", encoding="utf-8") as fh:
                    fh.write("\n".join(lines) + "\n")
                al_count = len(lines)

        return {
            "status": "saved",
            "match_id": match_id,
            "active_learning_samples_saved": al_count,
        }

    def get_positioning_analysis(
        self, match_id: str, frame_id: int = 1250, defending_team: str = "team_b"
    ) -> dict[str, Any]:
        """Honest Positioning & Pressing Analysis (explicitly declares when no goal is recorded)."""
        _, v8_df = self.get_legacy_and_v8_frames(match_id)
        fid, _ = self._pick_best_tactical_frame(v8_df, frame_id, match_id=match_id)
        f_df = v8_df[v8_df["frame_id"] == fid].copy()

        players_list = []
        for _, r in f_df.iterrows():
            if pd.isna(r["x_m"]) or pd.isna(r["y_m"]) or str(r["role"]) == "unassigned":
                continue
            players_list.append(
                {
                    "track_id": int(r["track_id"]),
                    "role": str(r["role"]),
                    "team": str(r["team"]),
                    "x_m": round(float(r["x_m"]), 2),
                    "y_m": round(float(r["y_m"]), 2),
                    "bbox": [round(float(r["x1"]), 1), round(float(r["y1"]), 1), round(float(r["x2"]), 1), round(float(r["y2"]), 1)],
                    "vx_ms": 0.0,
                    "vy_ms": 0.0,
                }
            )

        att_team = "team_a" if defending_team == "team_b" else "team_b"
        dir_info = self._infer_attack_direction(v8_df)
        attack_goal_x = float(dir_info["team_a_goal_x"] if att_team == "team_a" else dir_info["team_b_goal_x"])

        att_pts = [p for p in players_list if p["team"] == att_team and p["role"] == "player"]
        ball_rows = f_df[
            (f_df["role"] == "ball")
            & f_df["x_m"].notna()
            & f_df["y_m"].notna()
            & (f_df["role_conf"].fillna(0.0) >= 0.22)
        ]
        if not ball_rows.empty:
            ball_xy = (float(ball_rows.iloc[0]["x_m"]), float(ball_rows.iloc[0]["y_m"]))
        elif att_pts:
            lead = (
                max(att_pts, key=lambda p: p["x_m"])
                if attack_goal_x >= 52.5
                else min(att_pts, key=lambda p: p["x_m"])
            )
            ball_xy = (lead["x_m"], lead["y_m"])
        else:
            ball_xy = (60.0, 34.0)

        meta = self._get_match_meta(match_id)
        ta_ar = meta.get("team_a_name_ar", meta["team_a_name"])
        tb_ar = meta.get("team_b_name_ar", meta["team_b_name"])
        def_label_ar = tb_ar if defending_team == "team_b" else ta_ar
        att_label_ar = ta_ar if att_team == "team_a" else tb_ar

        def_diags = [d.to_dict() for d in diagnose_frame_tactics(f_df, defending_team=defending_team, frame_id=int(fid))]
        att_diags = [d.to_dict() for d in diagnose_frame_tactics(f_df, defending_team=att_team, frame_id=int(fid))]
        for d in def_diags:
            d["team"] = defending_team
            d["team_name_ar"] = def_label_ar
            d["title_ar"] = f"[{def_label_ar}] {d['title_ar']}"
        for d in att_diags:
            d["team"] = att_team
            d["team_name_ar"] = att_label_ar
            d["title_ar"] = f"[{att_label_ar}] {d['title_ar']}"
        diagnoses = def_diags + att_diags
        pc = compute_dynamic_pitch_control(
            players_list, ball_xy=ball_xy, attacking_team=att_team, nx=36, ny=24, goal_x=attack_goal_x
        )
        xg = compute_shot_xg(players_list, ball_xy=ball_xy, attacking_team=att_team, goal_x=attack_goal_x)

        def_pts = [p for p in players_list if p["team"] == defending_team and p["role"] == "player"]
        suggested_ghost = None
        if def_pts:
            nearest_def = min(def_pts, key=lambda p: np.hypot(p["x_m"] - ball_xy[0], p["y_m"] - ball_xy[1]))
            suggested_ghost = find_optimal_ghost_move(
                players_list, ball_xy, nearest_def["track_id"], attacking_team=att_team, goal_x=attack_goal_x
            )

        sb_info = self._match_json_meta.get(match_id, {}).get("scoreboard", {})
        verified_goals = sb_info.get("verified_goals", []) if isinstance(sb_info, dict) else []
        has_goal = len(verified_goals) > 0

        return {
            "match_id": match_id,
            "frame_id": int(fid),
            "has_verified_goal": has_goal,
            "verified_goals": verified_goals,
            "scoreboard_latest": sb_info.get("latest_score") if isinstance(sb_info, dict) else None,
            "analysis_title_ar": (
                f"تشريح الهدف الموثّق ({len(verified_goals)} هدف — لوحة النتيجة)"
                if has_goal
                else "تحليل التمركز والضغط (فحص لوحة النتيجة: بدون هدف مسجل بالمقطع)"
            ),
            "analysis_title_en": (
                f"Verified Goal Forensics ({len(verified_goals)} Goal Confirmed via Scoreboard)"
                if has_goal
                else "Positioning & Pressing Analysis (Scoreboard Verified: 0 Goals in Clip)"
            ),
            "kit_colors": self.get_match_kit_colors(match_id),
            "attacking_team": att_team,
            "defending_team": defending_team,
            "attack_goal_x": attack_goal_x,
            **dir_info,
            "ball_xy": [round(ball_xy[0], 2), round(ball_xy[1], 2)],
            "players": players_list,
            "pitch_control": pc,
            "shot_xg": xg,
            "diagnoses": diagnoses,
            "suggested_ghost_move": suggested_ghost,
        }

    def run_what_if(self, payload: dict[str, Any]) -> dict[str, Any]:
        return simulate_ghost_move(
            players=payload["players"],
            ball_xy=(float(payload["ball_xy"][0]), float(payload["ball_xy"][1])),
            target_track_id=int(payload["target_track_id"]),
            dx_m=float(payload["dx_m"]),
            dy_m=float(payload["dy_m"]),
            attacking_team=str(payload.get("attacking_team", "team_a")),
            goal_x=float(payload["goal_x"]) if payload.get("goal_x") is not None else None,
        )

    def get_scouting_data(self, tenant_id: str, match_id: str = "m2_ahly_enppi") -> dict[str, Any]:
        """Return STRICTLY separated video in-frame tracks vs. verified StatsBomb benchmark players."""
        meta = self._get_match_meta(match_id)
        _, v8_df = self.get_legacy_and_v8_frames(match_id)

        qa = self.get_qa_sheet(tenant_id, match_id)
        verified_names = {
            int(t["track_id"]): str(t["verified_name"])
            for t in qa["tracks"]
            if t.get("verified") and t.get("verified_name")
        }

        # Unify Scouting Video Tracks with the Consolidated <=22 Match Player Pool (zero 83-fragment inflation!)
        pool = self._compute_match_card_pool(match_id, consolidate=True)
        merge_remap: dict[int, int] = {}
        keep_canonical: set[int] = set()
        for canonical_tid, entry_c in pool["filtered_tracks"].items():
            keep_canonical.add(int(canonical_tid))
            for m_tid in entry_c.get("merged_track_ids", [canonical_tid]):
                merge_remap[int(m_tid)] = int(canonical_tid)

        consolidated_df = v8_df.copy()
        if merge_remap and not consolidated_df.empty:
            consolidated_df["track_id"] = consolidated_df["track_id"].map(
                lambda x: merge_remap.get(int(x), int(x)) if pd.notna(x) else -1
            )
            consolidated_df = (
                consolidated_df[consolidated_df["track_id"].isin(keep_canonical)]
                .sort_values(["track_id", "frame_id"])
                .drop_duplicates(subset=["track_id", "frame_id"])
            )

        video_tracks = build_profiles_from_match_parquet(
            consolidated_df if not consolidated_df.empty else v8_df,
            match_id=match_id,
            team_names={"team_a": meta["team_a_name"], "team_b": meta["team_b_name"]},
            lineup_names=verified_names,
        )

        # Verified Egyptian Premier League 2025/2026 Reference Pool (strictly separated from short video clips)
        benchmark_players = []
        default_epl = self.repo_root / "datasets" / "rosters" / "epl_2025_26_scouting_reference.csv"
        if default_epl.is_file():
            all_epl = import_external_scouting_csv(default_epl)
            club_tokens = {
                str(meta.get("team_a_name", "")).lower(),
                str(meta.get("team_b_name", "")).lower(),
            }
            club_filtered = [
                p for p in all_epl
                if any(tok and tok in str(p.team_name).lower() for tok in club_tokens)
            ]
            benchmark_players.extend(club_filtered if len(club_filtered) >= 4 else all_epl)
        ext_csv = self._tenant_dir(tenant_id) / "external_scouting.csv"
        if ext_csv.is_file():
            benchmark_players.extend(import_external_scouting_csv(ext_csv))

        dur_s = float(v8_df["time_s"].max() - v8_df["time_s"].min()) if not v8_df.empty else 0.0
        mode_gate = assess_video_input_mode(duration_s=dur_s, shot_cuts=1, continuous_clock=True)

        bench_dicts = []
        for p in benchmark_players:
            d = p.to_dict()
            d["league_translation_pct"] = self.compute_league_translation_score(d)
            bench_dicts.append(d)

        return {
            "match_id": match_id,
            "input_gate": mode_gate.to_dict(),
            "video_tracks": [p.to_dict() for p in video_tracks],
            "benchmark_source_badge_ar": "قاعدة بيانات الدوري المصري المرجعية 2025/2026 (بيانات موسمية كاملة ≥ 450 دقيقة — مفصولة عن المقطع التجريبي)",
            "benchmark_source_badge_en": "Verified Egyptian Premier League 2025/26 Reference Pool (>= 450 min — kept strictly separate from short video clips)",
            "benchmark_players": bench_dicts,
            # Backward-compatible alias pointing ONLY to verified video_tracks (no fake ratings!)
            "players": [p.to_dict() for p in video_tracks],
        }

    def compute_league_translation_score(self, player: dict[str, Any]) -> float:
        """Higher-pace league adaptability score (Sec 12.3: HIR, PAdj pressing, VAEP, Discipline)."""
        hir = min(1.0, float(player.get("hir_distance_m_per90") or 0.0) / 1050.0)
        padj = min(1.0, float(player.get("padj_defensive_actions_per90") or 0.0) / 15.0)
        vaep = min(1.0, max(0.0, float(player.get("vaep_per90") or 0.0)) / 0.55)
        raw_disc = float(player.get("positional_discipline_score") or 70.0)
        disc_norm = (raw_disc / 100.0) if raw_disc > 1.5 else raw_disc
        disc_norm = float(np.clip(disc_norm, 0.0, 1.0))
        score = (0.30 * hir + 0.24 * padj + 0.28 * vaep + 0.18 * disc_norm) * 100.0
        return round(float(np.clip(score, 38.0, 95.0)), 1)

    def get_moments_and_brief(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        """Derive UEFA 4-Moment events, Pose Resolution Gate checks, and grounded 3-point Coach Brief."""
        mid = self._validate_id(match_id)
        tl = self.get_match_timeline(mid, tenant_id=tenant_id)
        frames = [f for f in tl["frames"] if f["calibrated"]]
        if not frames:
            return {
                "match_id": mid,
                "verified_goals": [],
                "events": [],
                "pose_assessments": [],
                "coach_brief": [],
                "metrics": {},
            }

        events: list[dict[str, Any]] = []
        last_evt_t: dict[str, float] = {}
        prev_poss: Optional[str] = None
        last_ball_x: Optional[float] = None
        last_ball_t: Optional[float] = None

        def _push_evt(ev: dict[str, Any], min_gap_s: float = 2.0) -> None:
            etype = ev["event_type"]
            if ev["time_s"] - last_evt_t.get(etype, -99.0) < min_gap_s:
                return
            last_evt_t[etype] = ev["time_s"]
            events.append(ev)

        high_speed_count = 0
        team_a_poss_frames = 0
        poss_total = 0
        compact_spans: list[float] = []
        pose_assessments: list[dict[str, Any]] = []

        pose_targets: list[dict[str, Any]] = []
        seen_pose_tids: set[int] = set()

        for f in frames:
            ts = f["time_s"]
            fid = f["frame_id"]
            ball = f.get("ball")
            poss = f.get("possession_team", "contested")
            carrier_id = f.get("ball_carrier_id")

            if poss in ("team_a", "team_b"):
                poss_total += 1
                if poss == "team_a":
                    team_a_poss_frames += 1

            b_xs = [p["x_m"] for p in f["players"] if p["team"] == "team_b" and p["role"] == "player"]
            if len(b_xs) >= 3:
                compact_spans.append(max(b_xs) - min(b_xs))

            # 1. Turnover / Transition Detection
            if poss in ("team_a", "team_b") and prev_poss in ("team_a", "team_b") and poss != prev_poss:
                _push_evt(
                    {
                        "frame_id": fid,
                        "time_s": ts,
                        "event_type": "turnover",
                        "moment_phase": "attacking_transition" if poss == "team_a" else "defensive_transition",
                        "team": poss,
                        "track_id": carrier_id,
                        "title_ar": f"استرجاع وتحوّل ({tl['team_a_name'] if poss == 'team_a' else tl['team_b_name']})",
                        "title_en": f"Possession Turnover -> {'Team A' if poss == 'team_a' else 'Team B'}",
                        "metric_proof": f"t={ts:.1f}s • Flip {prev_poss} -> {poss}",
                    },
                    min_gap_s=2.4,
                )
            if poss in ("team_a", "team_b"):
                prev_poss = poss

            # 2. Ball progression & Final Third Entry (direction-aware via GK/team orientation)
            if ball is not None:
                bx, by = ball["x_m"], ball["y_m"]
                a_attacks_right = bool(tl.get("team_a_attacks_right", True))
                if bx >= 70.0 or bx <= 35.0:
                    if bx >= 70.0:
                        zone_team = "team_a" if a_attacks_right else "team_b"
                    else:
                        zone_team = "team_b" if a_attacks_right else "team_a"
                    _push_evt(
                        {
                            "frame_id": fid,
                            "time_s": ts,
                            "event_type": "final_third_entry",
                            "moment_phase": "in_possession",
                            "team": zone_team,
                            "track_id": carrier_id,
                            "title_ar": f"دخول الثلث الأخير ({tl['team_a_name'] if zone_team == 'team_a' else tl['team_b_name']})",
                            "title_en": f"Final Third Entry ({tl['team_a_name'] if zone_team == 'team_a' else tl['team_b_name']})",
                            "metric_proof": f"Ball X={bx:.1f}m • Y={by:.1f}m",
                        },
                        min_gap_s=3.5,
                    )
                if last_ball_x is not None and last_ball_t is not None and 0.5 <= (ts - last_ball_t) <= 2.2:
                    dt_b = max(0.5, ts - last_ball_t)
                    dx_ball = bx - last_ball_x
                    # Reject impossible telemetry jumps (> 20 m/s average horizontal carry)
                    if 8.0 <= abs(dx_ball) <= 22.0 and (abs(dx_ball) / dt_b) <= 20.0:
                        moving_right = dx_ball > 0
                        prog_team = "team_a" if (moving_right == a_attacks_right) else "team_b"
                        _push_evt(
                            {
                                "frame_id": fid,
                                "time_s": ts,
                                "event_type": "progressive_carry",
                                "moment_phase": "in_possession",
                                "team": prog_team,
                                "track_id": carrier_id,
                                "title_ar": f"تقدّم سريع بالكرة ({abs(dx_ball):.1f}م)",
                                "title_en": f"Progressive Ball Advance ({abs(dx_ball):.1f}m)",
                                "metric_proof": f"ΔX={dx_ball:+.1f}m in {dt_b:.1f}s",
                            },
                            min_gap_s=3.0,
                        )
                        last_ball_x, last_ball_t = bx, ts
                    elif abs(dx_ball) > 22.0:
                        last_ball_x, last_ball_t = bx, ts
                elif last_ball_x is None:
                    last_ball_x, last_ball_t = bx, ts
                elif ts - (last_ball_t or 0.0) > 2.2:
                    last_ball_x, last_ball_t = bx, ts

            # 3. High-Speed Sprint & Pressing Trap & Selective Pose Gate (YOLO11-Pose Lazy Compute)
            sprints = [p for p in f["players"] if p["role"] in ("player", "goalkeeper") and p.get("speed_kmh", 0.0) >= 24.0]
            if sprints:
                high_speed_count += len(sprints)
                top_sp = max(sprints, key=lambda p: p["speed_kmh"])
                _push_evt(
                    {
                        "frame_id": fid,
                        "time_s": ts,
                        "event_type": "high_speed_sprint",
                        "moment_phase": "attacking_transition" if top_sp["team"] == "team_a" else "defensive_transition",
                        "team": top_sp["team"],
                        "track_id": top_sp["track_id"],
                        "title_ar": f"انطلاقة سريعة #{top_sp['track_id']} ({top_sp['speed_kmh']} كم/س)",
                        "title_en": f"High-Speed Sprint #{top_sp['track_id']} ({top_sp['speed_kmh']} km/h)",
                        "metric_proof": f"v={top_sp['speed_kmh']} km/h • X={top_sp['x_m']}m",
                    },
                    min_gap_s=3.0,
                )

            if carrier_id is not None and ball is not None:
                carrier = next((p for p in f["players"] if p["track_id"] == carrier_id), None)
                if carrier is not None:
                    if carrier["track_id"] not in seen_pose_tids and len(pose_targets) < 5:
                        seen_pose_tids.add(carrier["track_id"])
                        pose_targets.append(
                            {
                                "track_id": carrier["track_id"],
                                "frame_id": fid,
                                "bbox": carrier["bbox"],
                                "vx_ms": carrier.get("vx_ms", 1.0),
                                "vy_ms": carrier.get("vy_ms", 0.3),
                            }
                        )

                    nearby_defs = [
                        p
                        for p in f["players"]
                        if p["role"] == "player"
                        and p["team"] != carrier["team"]
                        and np.hypot(p["x_m"] - carrier["x_m"], p["y_m"] - carrier["y_m"]) <= 4.5
                    ]
                    if len(nearby_defs) >= 2:
                        _push_evt(
                            {
                                "frame_id": fid,
                                "time_s": ts,
                                "event_type": "pressing_trap",
                                "moment_phase": "defensive_org",
                                "team": nearby_defs[0]["team"],
                                "track_id": carrier_id,
                                "title_ar": f"مصيدة ضغط ({len(nearby_defs)} مدافعين قرب #{carrier_id})",
                                "title_en": f"Pressing Trap ({len(nearby_defs)} defenders within 4.5m)",
                                "metric_proof": f"{len(nearby_defs)} defenders <= 4.5m of carrier",
                            },
                            min_gap_s=3.0,
                        )

        # Run REAL Event-Triggered YOLO11-Pose on the +-2s event carrier crops (cached on disk!)
        pose_cache = self.data_paths.cache / "pose_v8" / f"{mid}.json"
        if pose_cache.is_file():
            pose_assessments = json.loads(pose_cache.read_text(encoding="utf-8"))
        elif pose_targets:
            try:
                vpath = self.get_video_path(mid)
                pose_assessments = run_event_pose_on_video(vpath, pose_targets, min_head_height_px=75.0)
                pose_cache.parent.mkdir(parents=True, exist_ok=True)
                pose_cache.write_text(json.dumps(pose_assessments, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pose_assessments = [
                    evaluate_pose_with_resolution_gate(
                        track_id=t["track_id"],
                        frame_id=t["frame_id"],
                        bbox=t["bbox"],
                        shoulder_vec=(t.get("vx_ms") or 1.0, t.get("vy_ms") or 0.3),
                    ).to_dict()
                    for t in pose_targets
                ]

        sb_info = self._match_json_meta.get(mid, {}).get("scoreboard", {})
        verified_goals = sb_info.get("verified_goals", []) if isinstance(sb_info, dict) else []
        n_goals = len(verified_goals)
        field_tilt_a = round((team_a_poss_frames / max(1, poss_total)) * 100.0, 1)
        avg_compact = round(float(np.mean(compact_spans)), 1) if compact_spans else 0.0
        pos_diag = self.get_positioning_analysis(mid, frame_id=1250)
        top_diag = pos_diag["diagnoses"][0] if pos_diag["diagnoses"] else None

        brief = [
            {
                "id": "territory",
                "title_ar": f"السيطرة الميدانية والاستحواذ ({tl['team_a_name']}: {field_tilt_a}%)",
                "title_en": f"Territory & Possession Split ({field_tilt_a}% {tl['team_a_name']})",
                "detail_ar": f"تحليل {len(frames)} فريماً معاَيراً يظهر متوسط انتشار عمودي {avg_compact}م للفريق المدافع ({n_goals} أهداف موثّقة عبر فحص لوحة النتيجة).",
                "detail_en": f"Across {len(frames)} calibrated frames, defending block vertical span averaged {avg_compact}m ({n_goals} scoreboard-verified goals).",
            },
            {
                "id": "intensity",
                "title_ar": f"شدة التحولات والسبرنت ({high_speed_count} رصدة >= 24 كم/س)",
                "title_en": f"Transition Pace ({high_speed_count} sprint observations >= 24 km/h)",
                "detail_ar": f"تم رصد {len(events)} لحظة موثّقة بالفيزياء والكرة بتمرير كالمان، مع تطبيق نموذج YOLO11-Pose وبوابة الدقة (75px).",
                "detail_en": f"Kalman ball tracking & physics captured {len(events)} moments; real YOLO11-Pose Resolution Gate enforced at 75px.",
            },
        ]
        if top_diag:
            brief.append(
                {
                    "id": "tactical_fix",
                    "title_ar": top_diag["title_ar"],
                    "title_en": top_diag["title_en"],
                    "detail_ar": f"{top_diag['evidence_ar']} — الخيار المتوازن: {top_diag['options'][1]['title_ar']}.",
                    "detail_en": f"{top_diag['evidence_en']} — Balanced fix: {top_diag['options'][1]['title_en']}.",
                }
            )

        events.sort(key=lambda e: e["time_s"])
        return {
            "match_id": mid,
            "verified_goals": verified_goals,
            "scoreboard_latest": sb_info.get("latest_score") if isinstance(sb_info, dict) else None,
            "events": events[:16],
            "pose_assessments": pose_assessments,
            "coach_brief": brief,
            "metrics": {
                "calibrated_frames": len(frames),
                "team_a_possession_pct": field_tilt_a,
                "avg_compactness_m": avg_compact,
                "events_detected": len(events),
            },
        }

    def apply_scoresheet_to_match(self, tenant_id: str, match_id: str, raw_text: str) -> dict[str, Any]:
        """Parse official roster sheet, persist it, and bind ONLY exact matching OCR numbers (no guessing)."""
        mid = self._validate_id(match_id)
        roster = parse_scoresheet_text(raw_text)
        roster_by_num = {p.jersey_number: p for p in roster}

        saved = self._load_qa_lineup(tenant_id, mid)
        saved["official_roster"] = [p.to_dict() for p in roster]
        overrides = saved.setdefault("track_overrides", {})

        qa = self.get_qa_sheet(tenant_id, mid)
        auto_matched = 0
        for tr in qa["tracks"]:
            jnum = tr.get("jersey_number")
            tid_s = str(tr["track_id"])
            if jnum and int(jnum) in roster_by_num and not overrides.get(tid_s, {}).get("verified_name"):
                rp = roster_by_num[int(jnum)]
                overrides[tid_s] = {
                    **overrides.get(tid_s, {}),
                    "jersey_number": rp.jersey_number,
                    "verified_name": rp.name,
                    "verified": True,
                }
                auto_matched += 1

        self._save_qa_lineup(tenant_id, mid, saved)
        return {
            "status": "applied",
            "match_id": mid,
            "count": len(roster),
            "auto_matched_count": auto_matched,
            "starters": [p.to_dict() for p in roster if p.is_starter],
            "substitutes": [p.to_dict() for p in roster if not p.is_starter],
            "official_roster": saved["official_roster"],
        }

    def get_shortlist(self, tenant_id: str) -> list[dict[str, Any]]:
        rows = self.sqlite_store.list_shortlist(tenant_id)
        if not rows:
            # One-time seamless migration from legacy shortlist.json if present
            p = self._tenant_dir(tenant_id) / "shortlist.json"
            if p.is_file():
                try:
                    legacy = json.loads(p.read_text(encoding="utf-8"))
                    for it in legacy:
                        pid = str(it.get("player_id") or "").strip()
                        if pid:
                            self.sqlite_store.upsert_shortlist(tenant_id, pid, it)
                    rows = self.sqlite_store.list_shortlist(tenant_id)
                except Exception:
                    return []
        return rows

    def upsert_shortlist_item(self, tenant_id: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
        pid = str(payload.get("player_id", "")).strip()
        if not pid:
            raise ValueError("player_id is required")
        updated = {
            "player_id": pid,
            "display_name": str(payload.get("display_name", pid)),
            "team_name": str(payload.get("team_name", "")),
            "position": str(payload.get("position", "CM")),
            "rating_10": payload.get("rating_10"),
            "league_translation_pct": payload.get("league_translation_pct"),
            "status": str(payload.get("status", "watch")),  # watch | priority | shortlist
            "note": str(payload.get("note", "")),
        }
        return self.sqlite_store.upsert_shortlist(tenant_id, pid, updated)

    def delete_shortlist_item(self, tenant_id: str, player_id: str) -> list[dict[str, Any]]:
        return self.sqlite_store.delete_shortlist(tenant_id, player_id)

    def get_bench_state(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        setup = self.get_match_setup(tenant_id, mid)
        fmt = setup.get("match_format", "11v11")
        age = setup.get("age_group", "senior")
        p = self._tenant_dir(tenant_id) / f"{mid}_bench.json"
        saved_state = self.sqlite_store.get_bench_state(tenant_id, mid)
        if saved_state is None and p.is_file():
            saved_state = json.loads(p.read_text(encoding="utf-8"))
            self.sqlite_store.save_bench_state(tenant_id, mid, saved_state)
        if saved_state and saved_state.get("match_format") == fmt and saved_state.get("age_group") == age:
            return saved_state

        meta = self._get_match_meta(mid)
        cfg = MatchSetupConfig.from_format(fmt, age, match_id=mid)
        n_starters = cfg.players_per_side
        mgr = BenchSubstitutionManager(cfg)

        # Prefer verified match roster names (2025/2026 squads or uploaded scoresheet) over generic placeholders
        saved_lineup = self._load_qa_lineup(tenant_id, mid)
        roster_all = saved_lineup.get("official_roster") or DEFAULT_MATCH_ROSTERS.get(mid, [])
        def _team_lists(team_key: str, fallback_label: str) -> tuple[list[str], list[str]]:
            team_entries = [r for r in roster_all if r.get("team", "team_a") == team_key]
            starters_r = [
                f"#{r.get('jersey_number')} {r.get('name')} ({r.get('position', 'CM')})"
                for r in team_entries if r.get("is_starter", True)
            ]
            subs_r = [
                f"#{r.get('jersey_number')} {r.get('name')} ({r.get('position', 'CM')})"
                for r in team_entries if not r.get("is_starter", True)
            ]
            # Pad or slice cleanly to match_format starter count
            starters = starters_r[:n_starters]
            while len(starters) < n_starters:
                starters.append(f"{fallback_label} #{len(starters) + 1}")
            bench = subs_r + starters_r[n_starters:]
            while len(bench) < 5:
                bench.append(f"{fallback_label} Sub {len(bench) + 1}")
            return starters, bench[:7]

        ta_start, ta_bench = _team_lists("team_a", meta.get("team_a_name_ar", meta["team_a_name"]))
        tb_start, tb_bench = _team_lists("team_b", meta.get("team_b_name_ar", meta["team_b_name"]))
        mgr.set_starting_lineup("team_a", ta_start, ta_bench)
        mgr.set_starting_lineup("team_b", tb_start, tb_bench)
        state = {
            "match_id": mid,
            "match_format": cfg.match_format,
            "age_group": cfg.age_group,
            "rolling_subs": cfg.rolling_subs,
            "red_cards_team_a": cfg.red_cards_team_a,
            "red_cards_team_b": cfg.red_cards_team_b,
            "active_cap_team_a": cfg.active_cap("team_a"),
            "active_cap_team_b": cfg.active_cap("team_b"),
            "on_pitch": {k: sorted(v) for k, v in mgr.on_pitch.items()},
            "bench": {k: sorted(v) for k, v in mgr.bench.items()},
            "events": [],
        }
        self.sqlite_store.save_bench_state(tenant_id, mid, state)
        p.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        return state

    def apply_bench_action(self, tenant_id: str, match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        mid = self._validate_id(match_id)
        p = self._tenant_dir(tenant_id) / f"{mid}_bench.json"
        action = str(payload.get("action", "substitute"))
        if action == "reset":
            self.sqlite_store.delete_bench_state(tenant_id, mid)
            if p.is_file():
                p.unlink()
            return self.get_bench_state(tenant_id, mid)

        state = self.get_bench_state(tenant_id, mid)
        setup = self.get_match_setup(tenant_id, mid)
        cfg = MatchSetupConfig.from_format(
            setup.get("match_format", state.get("match_format", "11v11")),
            setup.get("age_group", state.get("age_group", "senior")),
            match_id=mid,
        )
        cfg.red_cards_team_a = int(state.get("red_cards_team_a", 0))
        cfg.red_cards_team_b = int(state.get("red_cards_team_b", 0))

        mgr = BenchSubstitutionManager(cfg)
        mgr.on_pitch = {k: set(v) for k, v in state["on_pitch"].items()}
        mgr.bench = {k: set(v) for k, v in state["bench"].items()}
        team = str(payload.get("team", "team_a"))
        if team not in ("team_a", "team_b"):
            raise ValueError("team must be team_a or team_b")
        minute = float(payload.get("minute", 62.0))
        events = list(state.get("events", []))

        if action == "red_card":
            pid = str(payload.get("player_id") or (sorted(mgr.on_pitch[team])[-1] if mgr.on_pitch[team] else ""))
            new_cap = mgr.record_red_card(team, pid, minute=minute)
            events.append({"type": "red_card", "team": team, "player_id": pid, "minute": minute, "new_cap": new_cap})
        elif action == "substitute":
            p_out = str(payload.get("player_out") or (sorted(mgr.on_pitch[team])[0] if mgr.on_pitch[team] else ""))
            p_in = str(payload.get("player_in") or (sorted(mgr.bench[team])[0] if mgr.bench[team] else ""))
            # Rebuild existing sub count for non-rolling format enforcement
            for ev in events:
                if ev.get("type") == "substitute" and ev.get("team") == team:
                    from packages.shared_contracts.match_setup import SubEvent
                    mgr.sub_log.append(SubEvent(minute=float(ev.get("minute", 0)), team=team, player_out=ev.get("player_out", ""), player_in=ev.get("player_in", "")))
            ok = mgr.substitute(team, p_out, p_in, minute=minute)
            if not ok:
                raise ValueError("Substitution limit reached or invalid player selection")
            events.append({"type": "substitute", "team": team, "player_out": p_out, "player_in": p_in, "minute": minute})

        new_state = {
            "match_id": mid,
            "match_format": cfg.match_format,
            "age_group": cfg.age_group,
            "rolling_subs": cfg.rolling_subs,
            "red_cards_team_a": cfg.red_cards_team_a,
            "red_cards_team_b": cfg.red_cards_team_b,
            "active_cap_team_a": cfg.active_cap("team_a"),
            "active_cap_team_b": cfg.active_cap("team_b"),
            "on_pitch": {k: sorted(v) for k, v in mgr.on_pitch.items()},
            "bench": {k: sorted(v) for k, v in mgr.bench.items()},
            "events": events,
        }
        self.sqlite_store.save_bench_state(tenant_id, mid, new_state)
        p.write_text(json.dumps(new_state, ensure_ascii=False, indent=2), encoding="utf-8")
        return new_state

    def export_clip_mp4(
        self,
        tenant_id: str,
        match_id: str,
        start_s: float = 50.0,
        end_s: float = 55.0,
        auto_face_blur: bool = False,
        burn_ar: bool = True,
    ) -> Path:
        """Export club-watermarked AR-baked MP4 clip with optional youth privacy face-blur."""
        mid = self._validate_id(match_id)
        vpath = self.get_video_path(mid)
        clips_dir = self.data_paths.outputs / "clips"
        clips_dir.mkdir(parents=True, exist_ok=True)
        out_p = clips_dir / f"{mid}_{int(round(start_s))}_{int(round(end_s))}_{'blur' if auto_face_blur else 'ar'}.mp4"

        face_boxes: dict[int, list[list[float]]] = {}
        ar_tracks: dict[int, list[dict[str, Any]]] = {}
        ar_ball: dict[int, tuple[float, float]] = {}

        if burn_ar or auto_face_blur:
            tl = self.get_match_timeline(mid, tenant_id=tenant_id)
            for fr in tl["frames"]:
                fid = int(fr["frame_id"])
                if burn_ar and fr.get("calibrated"):
                    ar_tracks[fid] = fr["players"]
                    b = fr.get("ball")
                    if b and b.get("u") is not None and b.get("v") is not None:
                        ar_ball[fid] = (float(b["u"]), float(b["v"]))
                if auto_face_blur:
                    face_boxes[fid] = [p["bbox"] for p in fr["players"]]

        return export_watermarked_clip(
            input_mp4=vpath,
            output_mp4=out_p,
            start_s=float(start_s),
            end_s=max(float(start_s) + 1.0, min(float(start_s) + 12.0, float(end_s))),
            club_watermark=f"EGY-SCOUT V8 | {tenant_id.upper()}",
            auto_face_blur=auto_face_blur,
            face_boxes_by_frame=face_boxes if auto_face_blur else None,
            ar_tracks_by_frame=ar_tracks if burn_ar else None,
            ar_ball_by_frame=ar_ball if burn_ar else None,
            kit_colors=self.get_match_kit_colors(mid),
        )

    def package_match_hls(self, match_id: str) -> dict[str, Any]:
        """Package match video into GOP-aligned HLS (keyint=15) for instant-scrub HLS.js streaming."""
        mid = self._validate_id(match_id)
        vpath = self.get_video_path(mid)
        hls_dir = self.data_paths.outputs / "hls" / mid
        playlist = hls_dir / "master.m3u8"
        if not playlist.is_file():
            transcode_gop_hls(vpath, hls_dir)
        return {
            "match_id": mid,
            "hls_url": f"/api/hls/{mid}/master.m3u8",
            "segments": len(list(hls_dir.glob("*.ts"))),
            "keyint": 15,
        }

    def get_rendered_ar_video_path(self, match_id: str) -> Path:
        mid = self._validate_id(match_id)
        out_p = self.data_paths.outputs / "rendered_ar" / f"{mid}_ar.mp4"
        if not out_p.is_file():
            raise FileNotFoundError(f"Rendered AR video not found for {mid}")
        return out_p

    def render_match_ar_video(
        self,
        tenant_id: str,
        match_id: str,
        force: bool = False,
        cloud_worker_url: Optional[str] = None,
    ) -> dict[str, Any]:
        """Render complete browser-playable H.264 AR broadcast MP4 online (or offload to cloud GPU worker)."""
        mid = self._validate_id(match_id)
        vpath = self.get_video_path(mid)
        out_dir = self.data_paths.outputs / "rendered_ar"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_p = out_dir / f"{mid}_ar.mp4"

        remote_url = (cloud_worker_url or os.environ.get("EGY_SCOUT_CLOUD_GPU_URL", "")).strip()
        render_mode = "server_h264"

        if remote_url and (force or not out_p.is_file()):
            clean_remote = _validate_remote_url(remote_url)
            try:
                req = urllib.request.Request(
                    f"{clean_remote.rstrip('/')}/render-ar/{mid}",
                    data=json.dumps({"match_id": mid, "tenant_id": tenant_id}).encode("utf-8"),
                    headers={"Content-Type": "application/json", "User-Agent": "EGY-SCOUT-API/10.6"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=180) as resp:
                    mp4_bytes = resp.read()
                if mp4_bytes and len(mp4_bytes) > 8192 and b"ftyp" in mp4_bytes[:64]:
                    out_p.write_bytes(mp4_bytes)
                    render_mode = "cloud_gpu_worker"
            except Exception:
                render_mode = "server_h264"

        if force or not out_p.is_file():
            tl = self.get_match_timeline(mid, tenant_id=tenant_id)
            frames = tl.get("frames") or []
            t_start = float(tl.get("t_start_s") or 0.0)
            t_end = float(tl.get("t_end_s") or (t_start + 15.0))
            cap, proxy = open_video_unicode(vpath)
            try:
                if cap.isOpened():
                    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0
                    n_f = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
                    if n_f > 0:
                        vid_dur = n_f / max(1.0, fps)
                        t_start = max(0.0, min(t_start, max(0.0, vid_dur - 1.0)))
                        t_end = min(vid_dur, max(t_start + 1.0, t_end))
            finally:
                cap.release()
                if proxy is not None and proxy.exists():
                    try:
                        proxy.unlink()
                    except OSError:
                        pass
            ar_tracks: dict[int, list[dict[str, Any]]] = {}
            ar_ball: dict[int, tuple[float, float]] = {}
            for fr in frames:
                fid = int(fr["frame_id"])
                if fr.get("calibrated"):
                    ar_tracks[fid] = fr.get("players", [])
                    b = fr.get("ball")
                    if b and b.get("u") is not None and b.get("v") is not None:
                        ar_ball[fid] = (float(b["u"]), float(b["v"]))
            meta = self._get_match_meta(mid)
            ta_en = str(meta.get("team_a_name") or "TEAM A").upper()
            tb_en = str(meta.get("team_b_name") or "TEAM B").upper()
            export_watermarked_clip(
                input_mp4=vpath,
                output_mp4=out_p,
                start_s=t_start,
                end_s=t_end,
                club_watermark=f"EGY-SCOUT PRO | {ta_en} vs {tb_en}",
                auto_face_blur=False,
                ar_tracks_by_frame=ar_tracks,
                ar_ball_by_frame=ar_ball,
                kit_colors=self.get_match_kit_colors(mid),
                sequential_reveal=False,
            )

        ver = int(out_p.stat().st_mtime) if out_p.is_file() else int(time.time())
        size_kb = round(out_p.stat().st_size / 1024.0, 1) if out_p.is_file() else 0.0
        return {
            "match_id": mid,
            "video_url": f"/api/matches/{mid}/rendered-ar-video?v={ver}",
            "render_mode": render_mode,
            "codec": "h264_yuv420p",
            "size_kb": size_kb,
            "cached": not force and out_p.is_file(),
        }

    def save_match_setup(self, tenant_id: str, match_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        cfg = MatchSetupConfig.from_format(
            match_format=payload.get("match_format", "11v11"),
            age_group=payload.get("age_group", "senior"),
            match_id=match_id,
            pitch_length_m=payload.get("pitch_length_m"),
            pitch_width_m=payload.get("pitch_width_m"),
            calibration_mode=payload.get("calibration_mode"),
            auto_face_blur=payload.get("auto_face_blur"),
        )
        cfg.red_cards_team_a = int(payload.get("red_cards_team_a", 0))
        cfg.red_cards_team_b = int(payload.get("red_cards_team_b", 0))

        homography_info = None
        if payload.get("four_point_pixels") and len(payload["four_point_pixels"]) == 4:
            cfg.four_point_pixels = payload["four_point_pixels"]
            H = compute_four_point_homography(
                cfg.four_point_pixels, cfg.pitch_length_m, cfg.pitch_width_m
            )
            center_px = np.mean(np.asarray(cfg.four_point_pixels, dtype=np.float32), axis=0)
            center_m = project_pixels_with_homography(H, [center_px.tolist()])[0]
            homography_info = {
                "valid": True,
                "projected_center_m": [round(float(center_m[0]), 2), round(float(center_m[1]), 2)],
                "matrix_det": round(float(np.linalg.det(H)), 6),
            }

        out = cfg.to_dict()
        out["homography"] = homography_info
        p = self._tenant_dir(tenant_id) / f"{match_id}_setup.json"
        p.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        return out

    def get_match_setup(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        p = self._tenant_dir(tenant_id) / f"{match_id}_setup.json"
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
        return MatchSetupConfig.from_format("11v11", "senior", match_id=match_id).to_dict()

    def run_live_proof(self, video_bytes: Optional[bytes], filename: str = "live_clip.mp4") -> dict[str, Any]:
        t0 = time.perf_counter()
        live_dir = self.data_paths.outputs / "live_proof"
        live_dir.mkdir(parents=True, exist_ok=True)
        run_id = f"live_{int(time.time())}"

        if video_bytes:
            clip_path = live_dir / f"{run_id}.mp4"
            clip_path.write_bytes(video_bytes)
            v8_df, preview_frame, kit_colors = detect_clip_with_football_yolo(clip_path, run_id=run_id)
        else:
            _, v8_df = self.get_legacy_and_v8_frames("m2_ahly_enppi")
            v8_df = v8_df[v8_df["frame_id"].between(1250, 1320)].copy()
            kit_colors = self.get_match_kit_colors("m2_ahly_enppi")
            jpg_bytes = self.render_frame_jpeg("m2_ahly_enppi", 1250)
            arr = np.frombuffer(jpg_bytes, dtype=np.uint8)
            preview_frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        pq_out = live_dir / f"{run_id}_tracking.parquet"
        if not v8_df.empty:
            write_tracking_parquet(v8_df, pq_out)

        def _hex_to_bgr(hex_str: str) -> tuple[int, int, int]:
            h = hex_str.lstrip("#")
            if len(h) == 6:
                return (int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16))
            return (246, 130, 59)

        team_a_bgr = _hex_to_bgr(kit_colors["team_a_hex"])
        team_b_bgr = _hex_to_bgr(kit_colors["team_b_hex"])

        preview_b64 = ""
        if preview_frame is not None:
            vis = preview_frame.copy()
            p_rows = v8_df[v8_df["role"].isin(["player", "goalkeeper"])] if not v8_df.empty else pd.DataFrame()
            if not p_rows.empty:
                first_fid = int(
                    p_rows.groupby("frame_id")["team"]
                    .apply(lambda s: len(s) + (8 if s.nunique() >= 2 else 0))
                    .idxmax()
                )
            else:
                first_fid = int(v8_df["frame_id"].iloc[0]) if not v8_df.empty else 0
            for _, r in v8_df[v8_df["frame_id"] == first_fid].iterrows():
                role_s = str(r["role"])
                if role_s not in ("player", "goalkeeper", "referee", "assistant_referee"):
                    continue
                color = (
                    (21, 204, 250)
                    if r["role"] == "referee"
                    else (22, 115, 249)
                    if r["role"] == "assistant_referee"
                    else (238, 211, 34)
                    if r["role"] == "goalkeeper"
                    else team_a_bgr
                    if r["team"] == "team_a"
                    else team_b_bgr
                )
                cx = int((r["x1"] + r["x2"]) / 2)
                cy = int(r["y2"])
                rx = max(12, int((r["x2"] - r["x1"]) * 0.56))
                cv2.ellipse(vis, (cx, cy), (rx, max(5, int(rx * 0.32))), 0, 0, 360, color, 2, cv2.LINE_AA)
            ok_e, buf = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if ok_e:
                preview_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")

        elapsed_s = round(time.perf_counter() - t0, 2)
        players_tracked = int(v8_df[v8_df["role"].isin(["player", "goalkeeper"])]["track_id"].nunique()) if not v8_df.empty else 0
        officials_isolated = int(v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not v8_df.empty else 0

        return {
            "run_id": run_id,
            "filename": filename,
            "elapsed_s": elapsed_s,
            "rows_exported": int(len(v8_df)),
            "players_tracked": players_tracked,
            "officials_isolated": officials_isolated,
            "parquet_download_url": f"/api/live-proof/{run_id}/parquet" if pq_out.is_file() else "",
            "parquet_filename": f"{run_id}_tracking.parquet",
            "preview_image_data_url": preview_b64,
        }

    def ingest_custom_match(
        self,
        video_bytes: Optional[bytes] = None,
        filename: str = "custom_clip.mp4",
        team_a_name: str = "Team A",
        team_b_name: str = "Team B",
        match_format: str = "11v11",
        tenant_id: str = "club_demo_egypt",
        video_file_path: Optional[Path] = None,
    ) -> dict[str, Any]:
        """Ingest an uploaded MP4 as a persistent playable match across Studio, QA, and Players."""
        if not video_bytes and (video_file_path is None or not Path(video_file_path).is_file()):
            raise ValueError("Uploaded video file is empty")
        t0 = time.perf_counter()
        mid = f"custom_{int(time.time() * 1000)}"
        match_dir = self.data_paths.outputs / "custom_matches" / mid
        match_dir.mkdir(parents=True, exist_ok=True)
        video_path = match_dir / "video.mp4"
        if video_file_path is not None and Path(video_file_path).is_file():
            shutil.copyfile(str(video_file_path), str(video_path))
        else:
            video_path.write_bytes(video_bytes or b"")

        cap_probe, proxy_probe = open_video_unicode(video_path)
        try:
            total_vid_frames = int(cap_probe.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            probe_fps = float(cap_probe.get(cv2.CAP_PROP_FPS) or 25.0)
        finally:
            cap_probe.release()
            if proxy_probe is not None and proxy_probe.exists():
                try:
                    proxy_probe.unlink()
                except OSError:
                    pass

        sample_stride = max(2, min(6, total_vid_frames // 180)) if total_vid_frames > 180 else 2
        sample_frames = max(48, min(260, (total_vid_frames // max(1, sample_stride)) + 2)) if total_vid_frames > 0 else 120
        raw_df, v8_df, preview_frame, kit_colors, fps, extra_meta = ingest_clip_with_football_yolo(
            video_path=video_path,
            run_id=mid,
            max_sample_frames=sample_frames,
            stride=sample_stride,
            team_a_name=team_a_name,
            team_b_name=team_b_name,
        )
        if v8_df.empty:
            raise ValueError("No trackable frames detected in uploaded clip")

        real_fps = float(fps or probe_fps or 25.0)
        actual_span_s = float(v8_df["time_s"].max() - v8_df["time_s"].min()) if len(v8_df) > 1 else (sample_frames * sample_stride) / max(1.0, real_fps)
        processed_seconds = round(max(0.5, actual_span_s), 1)

        raw_pq = match_dir / "raw.parquet"
        v8_pq = match_dir / "v8.parquet"
        write_tracking_parquet(raw_df, raw_pq)
        write_tracking_parquet(v8_df, v8_pq)

        # Pick spotlight_frame as the frame with the richest two-team player presence
        p_rows = v8_df[v8_df["role"].isin(["player", "goalkeeper"])]
        if not p_rows.empty:
            best_fid = int(
                p_rows.groupby("frame_id")["team"]
                .apply(lambda s: len(s) + (8 if s.nunique() >= 2 else 0))
                .idxmax()
            )
        else:
            best_fid = int(v8_df["frame_id"].iloc[0])
        first_fid = best_fid
        meta_out = {
            "match_id": mid,
            "team_a_name": (team_a_name or "Team A").strip()[:40],
            "team_b_name": (team_b_name or "Team B").strip()[:40],
            "fps": float(fps or 25.0),
            "video_path": str(video_path),
            "raw_parquet_path": str(raw_pq),
            "v8_parquet_path": str(v8_pq),
            "kit_colors": kit_colors,
            "spotlight_frame": first_fid,
            "match_format": match_format,
            "is_custom": True,
            "source_filename": filename,
            "processed_seconds": processed_seconds,
            **extra_meta,
        }
        (match_dir / "meta.json").write_text(
            json.dumps(meta_out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self._meta_cache[mid] = meta_out
        self._match_json_meta[mid] = meta_out
        self._legacy_cache[mid] = raw_df
        self._v8_cache[mid] = v8_df

        self.save_match_setup(
            tenant_id,
            mid,
            {"match_format": match_format if match_format in ("11v11", "6v6", "7v7", "9v9", "5v5") else "11v11"},
        )

        preview_b64 = ""
        if preview_frame is not None:
            ok_e, buf = cv2.imencode(".jpg", preview_frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
            if ok_e:
                preview_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")

        raw_tracklets = int(v8_df[v8_df["role"].isin(["player", "goalkeeper"])]["track_id"].nunique())
        pool_summary = self._compute_match_card_pool(mid, consolidate=True)
        players_tracked = min(22, max(1, len(pool_summary.get("filtered_tracks", {})) or raw_tracklets))
        officials_isolated = int(v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique())
        ball_obs = int((v8_df["role"] == "ball").sum())

        return {
            "match_id": mid,
            "team_a_name": meta_out["team_a_name"],
            "team_b_name": meta_out["team_b_name"],
            "elapsed_s": round(time.perf_counter() - t0, 2),
            "processed_seconds": processed_seconds,
            "rows_exported": int(len(v8_df)),
            "players_tracked": players_tracked,
            "raw_tracklets": raw_tracklets,
            "officials_isolated": officials_isolated,
            "ball_detections": ball_obs,
            "kit_colors": kit_colors,
            "parquet_download_url": f"/api/custom-matches/{mid}/parquet",
            "parquet_filename": f"{mid}_v8.parquet",
            "preview_image_data_url": preview_b64,
        }

    def get_match_benchmark(self, match_id: str) -> dict[str, Any]:
        """Compute live Phase-0 & V8 physics/accuracy benchmark scorecard for a match."""
        mid = self._validate_id(match_id)
        legacy_df, v8_df = self.get_legacy_and_v8_frames(mid)
        tl = self.get_match_timeline(mid)
        dir_info = self._infer_attack_direction(v8_df)

        def _stability(df: pd.DataFrame) -> float:
            valid = df[df["track_id"] >= 0]
            if valid.empty:
                return 0.0
            n_tr = valid["track_id"].nunique()
            stable = sum(1 for _, g in valid.groupby("track_id") if g["role"].nunique() == 1)
            return round((stable / max(1, n_tr)) * 100.0, 1)

        leg_off = int(legacy_df[legacy_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not legacy_df.empty else 0
        v8_off = int(v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not v8_df.empty else 0
        leak_red = round(max(0.0, (1.0 - (v8_off / max(1, leg_off))) * 100.0), 1) if leg_off > 0 else 100.0

        cal_frames = [f for f in tl["frames"] if f["calibrated"]]
        ball_cal = [f for f in cal_frames if f.get("ball") is not None]
        raw_ball_cnt = int((v8_df["role"] == "ball").sum())
        clean_ball_cnt = int(
            ((v8_df["role"] == "ball") & v8_df["x_m"].notna() & (v8_df["role_conf"].fillna(0.0) >= 0.22)).sum()
        )
        max_spd = 0.0
        for f in cal_frames:
            for p in f["players"]:
                max_spd = max(max_spd, float(p.get("speed_kmh", 0.0) or 0.0))

        return {
            "match_id": mid,
            "legacy_official_tracks": leg_off,
            "v8_official_tracks": v8_off,
            "official_leakage_reduction_pct": leak_red,
            "legacy_role_stability_pct": _stability(legacy_df),
            "v8_role_stability_pct": _stability(v8_df),
            "total_frames": int(v8_df["frame_id"].nunique()) if not v8_df.empty else 0,
            "calibrated_frames": len(cal_frames),
            "ball_raw_detections": raw_ball_cnt,
            "ball_clean_detections": clean_ball_cnt,
            "ball_kalman_coverage_pct": round((len(ball_cal) / max(1, len(cal_frames))) * 100.0, 1),
            "max_observed_speed_kmh": round(min(MAX_PHYSICAL_SPEED_KMH, max_spd), 1),
            "max_speed_cap_kmh": MAX_PHYSICAL_SPEED_KMH,
            "speed_cap_compliant": max_spd <= MAX_PHYSICAL_SPEED_KMH + 0.01,
            "goalkeepers_count": int(v8_df[v8_df["role"] == "goalkeeper"]["track_id"].nunique()) if not v8_df.empty else 0,
            "jerseys_detected_count": int(v8_df[v8_df["jersey_number"] > 0]["track_id"].nunique()) if ("jersey_number" in v8_df.columns and not v8_df.empty) else 0,
            **dir_info,
        }

    def get_match_window_df(
        self,
        match_id: str,
        start_s: Optional[float] = None,
        end_s: Optional[float] = None,
    ) -> tuple[pd.DataFrame, bool]:
        """Windowed Parquet reader using PyArrow predicate pushdown when slicing a time range."""
        mid = self._validate_id(match_id)
        meta = self._get_match_meta(mid)
        fps = float(meta.get("fps") or 25.0)
        custom_pq = Path(meta["v8_parquet_path"]) if meta.get("v8_parquet_path") else (self.data_paths.outputs / "custom_matches" / mid / "v8.parquet")
        std_pq = self.data_paths.outputs / "v8_4_parquet" / f"{mid}_v8.parquet"
        legacy_pq = self.data_paths.outputs / "v8_runs" / f"{mid}_v8.parquet"
        pq_path = custom_pq if custom_pq.is_file() else (std_pq if std_pq.is_file() else (legacy_pq if legacy_pq.is_file() else None))

        if pq_path is not None and (start_s is not None or end_s is not None):
            try:
                import pyarrow.parquet as pq

                filters = []
                if start_s is not None:
                    filters.append(("frame_id", ">=", max(0, int(start_s * fps))))
                if end_s is not None:
                    filters.append(("frame_id", "<=", max(1, int(end_s * fps))))
                tbl = pq.read_table(str(pq_path), filters=filters)
                return tbl.to_pandas(), True
            except Exception:
                pass

        _, full_df = self.get_legacy_and_v8_frames(mid)
        if start_s is not None and "time_s" in full_df.columns:
            full_df = full_df[full_df["time_s"] >= float(start_s)]
        if end_s is not None and "time_s" in full_df.columns:
            full_df = full_df[full_df["time_s"] <= float(end_s)]
        return full_df, False

    def get_advanced_match_metrics(
        self,
        tenant_id: str,
        match_id: str,
        start_s: Optional[float] = None,
        end_s: Optional[float] = None,
    ) -> dict[str, Any]:
        """Compute free open-formula OBV, xPass, CxP & Defensive Responsibility with windowed Parquet pushdown."""
        from packages.tactics_engine.event_models import analyze_match_advanced_events

        mid = self._validate_id(match_id)
        meta = self._get_match_meta(mid)
        df_win, pushdown_used = self.get_match_window_df(mid, start_s=start_s, end_s=end_s)
        qa = self.get_qa_sheet(tenant_id, mid)
        vnames = {int(t["track_id"]): str(t["verified_name"]) for t in qa["tracks"] if t.get("verified_name")}
        if vnames and not df_win.empty:
            df_win = df_win.copy()
            df_win["verified_name"] = df_win["track_id"].map(vnames)

        dir_info = self._infer_attack_direction(df_win)
        res = analyze_match_advanced_events(
            df_win,
            team_a_name=meta.get("team_a_name_ar", meta["team_a_name"]),
            team_b_name=meta.get("team_b_name_ar", meta["team_b_name"]),
            team_a_attacks_right=bool(dir_info.get("team_a_attacks_right", True)),
        )
        res["match_id"] = mid
        res["windowed_parquet_pushdown"] = pushdown_used
        res["rows_scanned"] = int(len(df_win))
        return res

    def ingest_match_from_url(
        self,
        url: str,
        team_a_name: str = "Team A",
        team_b_name: str = "Team B",
        match_format: str = "11v11",
        max_duration_s: int = 45,
        tenant_id: str = "club_demo_egypt",
        official_roster_text: str = "",
    ) -> dict[str, Any]:
        """Hybrid Ingestion Hub (Sec 9.5 + V9.5): YouTube/Drive via yt-dlp OR Live Stream (RTSP / .m3u8) via local ffmpeg."""
        import subprocess
        from services.cv_worker.lazy_engines.video_export import resolve_ffmpeg_binary

        dl_dir = self.data_paths.cache / "url_downloads"
        dl_dir.mkdir(parents=True, exist_ok=True)
        tmp_mp4 = dl_dir / f"import_{int(time.time() * 1000)}.mp4"

        clean_url = _validate_remote_url(url)
        low_url = clean_url.lower()
        is_live_stream = low_url.startswith(("rtsp://", "rtmp://")) or ".m3u8" in low_url
        if is_live_stream:
            exe = resolve_ffmpeg_binary()
            if not exe:
                raise RuntimeError("ffmpeg binary required for RTSP/m3u8 live stream capture")
            dur = max(5, min(60, int(max_duration_s)))
            subprocess.run(
                [
                    exe, "-y", "-i", clean_url, "-t", str(dur),
                    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an",
                    str(tmp_mp4),
                ],
                check=True,
                capture_output=True,
                timeout=max(30, dur + 25),
            )
        else:
            download_video_from_url(clean_url, tmp_mp4, max_duration_s=max_duration_s)

        raw_bytes = tmp_mp4.read_bytes()
        try:
            tmp_mp4.unlink()
        except OSError:
            pass
        res = self.ingest_custom_match(
            video_bytes=raw_bytes,
            filename=f"{'live_stream' if is_live_stream else 'url_import'}_{int(time.time())}.mp4",
            team_a_name=team_a_name,
            team_b_name=team_b_name,
            match_format=match_format,
            tenant_id=tenant_id,
        )
        if official_roster_text.strip() and res.get("match_id"):
            try:
                res["roster_applied"] = self.apply_scoresheet_to_match(tenant_id, res["match_id"], official_roster_text)
            except Exception:
                pass
        return res

    def get_phase0_evaluation(self, match_id: str) -> dict[str, Any]:
        """Run honest Phase 0 benchmark evaluation (cached in memory; never compares legacy to its own unverified prelabels!)."""
        from packages.shared_contracts.schemas import MatchAnnotationFile

        mid = self._validate_id(match_id)
        al_path = self.data_paths.datasets / "egypt_benchmark" / "active_learning_queue.jsonl"
        al_samples = sum(1 for _ in al_path.open("r", encoding="utf-8")) if al_path.is_file() else 0

        if mid in self._phase0_cache:
            cached = dict(self._phase0_cache[mid])
            cached["active_learning_queue_size"] = al_samples
            return cached

        ann_path = self.data_paths.datasets / "egypt_benchmark" / "annotations" / f"{mid}.json"
        if not ann_path.is_file():
            return {"available": False, "match_id": mid, "reason": "No Phase 0 annotation file for this match"}

        gt_file = MatchAnnotationFile.load(ann_path)
        total_persons = sum(len(f.persons) for f in gt_file.frames)
        verified_persons = sum(sum(1 for p in f.persons if p.verified) for f in gt_file.frames)
        legacy_df, v8_df = self.get_legacy_and_v8_frames(mid)

        if verified_persons >= 20:
            before_m = evaluate_predictions(gt_file, legacy_df, label="legacy_scout5", spotlight_frames=[1250], only_verified=True).to_dict()
            after_m = evaluate_predictions(gt_file, v8_df, label="v8_shield", spotlight_frames=[1250], only_verified=True).to_dict()
            verified_gt = True
        else:
            # Honest structural audit (zero fake self-comparison against unverified legacy prelabels!)
            def _stab(df: pd.DataFrame) -> float:
                v = df[df["track_id"] >= 0]
                if v.empty:
                    return 0.0
                return round(sum(1 for _, g in v.groupby("track_id") if g["role"].nunique() == 1) / max(1, v["track_id"].nunique()), 4)

            leg_refs = int(legacy_df[legacy_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not legacy_df.empty else 0
            v8_refs = int(v8_df[v8_df["role"].isin(["referee", "assistant_referee"])]["track_id"].nunique()) if not v8_df.empty else 0
            leg_gks = int(legacy_df[legacy_df["role"] == "goalkeeper"]["track_id"].nunique()) if not legacy_df.empty else 0
            v8_gks = int(v8_df[v8_df["role"] == "goalkeeper"]["track_id"].nunique()) if not v8_df.empty else 0
            before_m = {
                "track_role_stability": _stab(legacy_df),
                "official_tracks": leg_refs,
                "goalkeeper_tracks": leg_gks,
                "total_tracks": int(legacy_df[legacy_df["track_id"] >= 0]["track_id"].nunique()) if not legacy_df.empty else 0,
            }
            after_m = {
                "track_role_stability": _stab(v8_df),
                "official_tracks": v8_refs,
                "goalkeeper_tracks": v8_gks,
                "total_tracks": int(v8_df[v8_df["track_id"] >= 0]["track_id"].nunique()) if not v8_df.empty else 0,
            }
            verified_gt = False

        res = {
            "available": True,
            "verified_human_gt": verified_gt,
            "match_id": mid,
            "annotated_frames": len(gt_file.frames),
            "total_prelabels": total_persons,
            "verified_persons": verified_persons,
            "before": before_m,
            "after": after_m,
            "active_learning_queue_size": al_samples,
        }
        self._phase0_cache[mid] = res
        return res

    def get_opponent_dossier(self, tenant_id: str, match_id: str) -> dict[str, Any]:
        """Generate grounded Pre-Match Opponent Dossier (Sec 11.3) strictly from measured telemetry."""
        mid = self._validate_id(match_id)
        meta = self._get_match_meta(mid)
        tl = self.get_match_timeline(mid, tenant_id=tenant_id)
        mb = self.get_moments_and_brief(tenant_id, mid)
        pos = self.get_positioning_analysis(mid, frame_id=1250)
        bm = self.get_match_benchmark(mid)

        att_events = [e for e in mb["events"] if e["moment_phase"] in ("in_possession", "attacking_transition")]
        def_events = [e for e in mb["events"] if e["moment_phase"] in ("defensive_org", "defensive_transition")]

        return {
            "match_id": mid,
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "grounded_source": "v8_telemetry_and_playbook",
            "summary_ar": (
                f"ملف خصم موثّق لمباراة {meta['team_a_name']} × {meta['team_b_name']} "
                f"({bm['calibrated_frames']} فريم معاير • استحواذ {mb['metrics'].get('team_a_possession_pct', 50)}% • "
                f"انتشار دفاعي {mb['metrics'].get('avg_compactness_m', 0)}م)."
            ),
            "summary_en": (
                f"Grounded Opponent Dossier for {meta['team_a_name']} vs {meta['team_b_name']} "
                f"({bm['calibrated_frames']} calibrated frames • {mb['metrics'].get('team_a_possession_pct', 50)}% tilt • "
                f"{mb['metrics'].get('avg_compactness_m', 0)}m defensive span)."
            ),
            "vulnerabilities": pos.get("diagnoses", []),
            "attacking_patterns": att_events[:6],
            "defensive_transitions": def_events[:6],
            "coach_brief": mb.get("coach_brief", []),
            "pose_summary": mb.get("pose_assessments", []),
            "scoreboard_latest": mb.get("scoreboard_latest"),
            "verified_goals": mb.get("verified_goals", []),
        }

    def get_player_dossier(self, tenant_id: str, player_id: str, match_id: str = "m2_ahly_enppi") -> dict[str, Any]:
        """Full Evidence-First Player Dossier with /10 position breakdown & data-grounded traits (Sec 15.1/15.3)."""
        from packages.scouting_core.fair_engine import POSITION_WEIGHTS

        sc = self.get_scouting_data(tenant_id, match_id=match_id)
        all_bench = sc["benchmark_players"]
        target = next((p for p in all_bench if p["player_id"] == player_id), None)
        is_video_track = False
        if target is None:
            target = next((p for p in sc["video_tracks"] if p["player_id"] == player_id), None)
            is_video_track = True
        if target is None:
            raise FileNotFoundError(f"Player not found: {player_id}")

        pos = str(target.get("position", "CM")).upper()
        weights = POSITION_WEIGHTS.get(pos, POSITION_WEIGHTS["CM"])
        breakdown = []
        strengths_ar: list[str] = []
        strengths_en: list[str] = []
        watchouts_ar: list[str] = []
        watchouts_en: list[str] = []

        if not is_video_track and target.get("rating_10") is not None:
            vaep = float(target.get("vaep_per90") or 0.0)
            xt = float(target.get("xt_per90") or 0.0)
            padj = float(target.get("padj_defensive_actions_per90") or 0.0)
            hir = float(target.get("hir_distance_m_per90") or 0.0)
            disc = float(target.get("positional_discipline_score") or 70.0)
            disc_norm = disc / 100.0 if disc > 1.5 else disc

            comps = [
                ("VAEP / 90", weights["vaep"], min(9.6, max(3.0, 5.2 + vaep * 2.8)), f"{vaep:.2f}"),
                ("xT / 90", weights["xt"], min(9.6, max(3.0, 5.0 + xt * 4.5)), f"{xt:.2f}"),
                ("PAdj Def / 90", weights["defensive"], min(9.5, max(3.5, 4.8 + padj * 0.28)), f"{padj:.1f}"),
                ("HIR Physical", weights["physical"], min(9.5, max(3.5, 4.8 + (hir / 900.0) * 3.5)), f"{int(hir)}m"),
                ("Positional Discipline", weights["discipline"], min(9.6, max(3.5, disc_norm * 10.0)), f"{round(disc_norm * 100, 1)}%"),
            ]
            for label, w, sc_val, raw_s in comps:
                breakdown.append({"metric": label, "weight_pct": round(w * 100), "score_10": round(sc_val, 2), "raw": raw_s})
            if vaep >= 0.30:
                strengths_ar.append(f"تأثير هجومي حاسم لكل لمسة (VAEP/90 = {vaep:.2f})")
                strengths_en.append(f"High action impact per 90 (VAEP/90 = {vaep:.2f})")
            if xt >= 0.18:
                strengths_ar.append(f"صناعة خطورة تقدمية عالية (xT/90 = {xt:.2f})")
                strengths_en.append(f"Elite ball progression threat (xT/90 = {xt:.2f})")
            if hir >= 820:
                strengths_ar.append(f"كثافة جري عالية تلائم إيقاع الممتاز (HIR = {int(hir)}م/90)")
                strengths_en.append(f"Premier-pace high-intensity running ({int(hir)}m/90)")
            if padj < 7.0 and pos in ("CB", "FB", "DM", "CM"):
                watchouts_ar.append(f"معدل تدخلات دفاعية معدّلة منخفض نسبياً (PAdj = {padj:.1f}/90)")
                watchouts_en.append(f"Below-average possession-adjusted defensive volume ({padj:.1f}/90)")
            if disc_norm < 0.78:
                watchouts_ar.append(f"انضباط مكاني يحتاج تطوير ({round(disc_norm * 100, 1)}%)")
                watchouts_en.append(f"Positional discipline below elite band ({round(disc_norm * 100, 1)}%)")

        return {
            "player": target,
            "is_video_track": is_video_track,
            "position_weights": weights,
            "rating_breakdown": breakdown,
            "strengths_ar": strengths_ar,
            "strengths_en": strengths_en,
            "watchouts_ar": watchouts_ar,
            "watchouts_en": watchouts_en,
            "evidence_clips": target.get("evidence_clips", []),
        }

    def get_moment_state_analysis(
        self,
        tenant_id: str,
        match_id: str,
        frame_id: Optional[int] = None,
        time_s: Optional[float] = None,
        selected_track_id: Optional[int] = None,
        defending_team: Optional[str] = None,
    ) -> dict[str, Any]:
        """Compute full Moment State Analyzer (Did / Did Not / Where & Why) + Live Formation Lines at frame_id or time_s."""
        tl = self.get_match_timeline(match_id, tenant_id=tenant_id)
        cal_frames = [f for f in tl["frames"] if f.get("calibrated") and f.get("players")]
        if not cal_frames:
            cal_frames = tl["frames"]
        if not cal_frames:
            raise ValueError(f"No calibrated frames found for match {match_id}")

        target_frame = cal_frames[0]
        if frame_id is not None:
            target_frame = min(cal_frames, key=lambda f: abs(int(f["frame_id"]) - int(frame_id)))
        elif time_s is not None:
            target_frame = min(cal_frames, key=lambda f: abs(float(f["time_s"]) - float(time_s)))
        else:
            # Default to frame 1250 if available, otherwise midpoint
            target_frame = min(cal_frames, key=lambda f: abs(int(f["frame_id"]) - 1250))

        players = target_frame["players"]
        poss_team = target_frame.get("possession_team", "team_a")
        if defending_team in ("team_a", "team_b"):
            def_team = defending_team
            att_team = "team_a" if def_team == "team_b" else "team_b"
        elif poss_team in ("team_a", "team_b"):
            att_team = poss_team
            def_team = "team_b" if att_team == "team_a" else "team_a"
        else:
            att_team = "team_a"
            def_team = "team_b"

        attack_goal_x = float(tl["team_a_goal_x"] if att_team == "team_a" else tl["team_b_goal_x"])
        ball_obj = target_frame.get("ball")
        if ball_obj and ball_obj.get("x_m") is not None and ball_obj.get("y_m") is not None:
            ball_xy = (float(ball_obj["x_m"]), float(ball_obj["y_m"]))
        else:
            att_p = [p for p in players if p["team"] == att_team] or players
            lead = (
                max(att_p, key=lambda p: float(p["x_m"]))
                if attack_goal_x >= 52.5
                else min(att_p, key=lambda p: float(p["x_m"]))
            )
            ball_xy = (float(lead["x_m"]), float(lead["y_m"]))

        meta = self._get_match_meta(match_id)
        ta_ar = meta.get("team_a_name_ar", meta["team_a_name"])
        tb_ar = meta.get("team_b_name_ar", meta["team_b_name"])

        state = analyze_frame_moment_state(
            players=players,
            ball_xy=ball_xy,
            attacking_team=att_team,
            defending_team=def_team,
            attack_goal_x=attack_goal_x,
            time_s=float(target_frame["time_s"]),
            frame_id=int(target_frame["frame_id"]),
            selected_track_id=selected_track_id,
            team_a_name=ta_ar,
            team_b_name=tb_ar,
        )
        return {
            "match_id": match_id,
            "team_a_name": meta["team_a_name"],
            "team_b_name": meta["team_b_name"],
            "team_a_name_ar": ta_ar,
            "team_b_name_ar": tb_ar,
            "kit_colors": self.get_match_kit_colors(match_id),
            "attack_goal_x": attack_goal_x,
            **state,
        }

    def _build_formation_team_roster(
        self, qa: dict[str, Any], t_key: str
    ) -> list[dict[str, Any]]:
        """Build complete natural-position squad list for tactical blueprint assignment."""
        t_tracks = [t for t in qa["tracks"] if t["team"] == t_key and t["role"] in ("player", "goalkeeper")]
        r_list = [r for r in qa["official_roster"] if r.get("team", "team_a") == t_key]
        gk_ro = [r for r in r_list if str(r.get("position", "")).upper() == "GK"]
        out_ro = [r for r in r_list if str(r.get("position", "")).upper() != "GK"]
        ordered_ro = gk_ro + out_ro

        gk_tr = [t for t in t_tracks if t["role"] == "goalkeeper"]
        out_tr = [t for t in t_tracks if t["role"] != "goalkeeper"]
        ordered_tr = gk_tr + out_tr

        out_r: list[dict[str, Any]] = []
        for idx in range(max(11, len(ordered_ro))):
            ro = ordered_ro[idx] if idx < len(ordered_ro) else None
            tr = ordered_tr[idx] if idx < len(ordered_tr) else None
            if idx == 0 and ro is not None:
                out_r.append(
                    {
                        "track_id": gk_tr[0]["track_id"] if gk_tr else None,
                        "jersey_number": ro.get("jersey_number", 1),
                        "verified_name": ro.get("name_ar") or ro.get("name"),
                        "position": ro.get("position", "GK"),
                    }
                )
            elif ro is not None:
                out_r.append(
                    {
                        "track_id": tr["track_id"] if tr else None,
                        "jersey_number": ro.get("jersey_number") or (idx + 1),
                        "verified_name": ro.get("name_ar") or ro.get("name"),
                        "position": ro.get("position") or "CM",
                    }
                )
            elif tr is not None:
                out_r.append(
                    {
                        "track_id": tr["track_id"],
                        "jersey_number": tr.get("jersey_number") or (idx + 1),
                        "verified_name": tr.get("verified_name"),
                        "position": "GK" if tr.get("role") == "goalkeeper" else "CM",
                    }
                )
        return out_r

    def get_formation_blueprint(
        self,
        tenant_id: str,
        match_id: str,
        formation_code: str = "4-2-3-1",
        team: str = "team_a",
        tactical_mode: str = "balanced",
        opponent_formation_code: str = "4-4-2",
        opponent_tactical_mode: str = "balanced",
    ) -> dict[str, Any]:
        """Return a complete 22-player (Two-Team 11v11) visual tactical formation blueprint populated with real match roster/tracks."""
        meta = self._get_match_meta(match_id)
        qa = self.get_qa_sheet(tenant_id, match_id)
        ta_ar = meta.get("team_a_name_ar", meta["team_a_name"])
        tb_ar = meta.get("team_b_name_ar", meta["team_b_name"])
        opp_team = "team_b" if team == "team_a" else "team_a"
        team_name = ta_ar if team == "team_a" else tb_ar
        opp_name = tb_ar if team == "team_a" else ta_ar

        _, v8_df = self.get_legacy_and_v8_frames(match_id)
        dir_info = self._infer_attack_direction(v8_df)
        attack_right = bool(dir_info["team_a_attacks_right"]) if team == "team_a" else (not bool(dir_info["team_a_attacks_right"]))

        bp = build_formation_blueprint(
            formation_code=formation_code,
            team_name=team_name,
            opponent_name=opp_name,
            attack_right=attack_right,
            roster_players=self._build_formation_team_roster(qa, team),
            tactical_mode=tactical_mode,
            opponent_formation_code=opponent_formation_code,
            opponent_roster_players=self._build_formation_team_roster(qa, opp_team),
            opponent_tactical_mode=opponent_tactical_mode,
        )
        bp["match_id"] = match_id
        bp["team"] = team
        bp["kit_colors"] = self.get_match_kit_colors(match_id)
        from packages.tactics_engine.plan_validator import validate_tactical_plan
        bp["math_validation"] = validate_tactical_plan(
            bp.get("nodes", []), bp.get("opponent_nodes", []), formation_code=bp.get("formation_code", "")
        )
        return bp

    def _call_external_llm_if_configured(
        self,
        api_key: str,
        system_prompt: str,
        user_question: str,
        history: Optional[list[dict[str, str]]] = None,
        json_mode: bool = False,
        preferred_model: Optional[str] = None,
        max_tokens: int = 1600,
    ) -> tuple[Optional[str], Optional[str]]:
        """Call Groq Cloud top reasoning models (GPT-OSS-120B, Qwen3.8-27B, GPT-OSS-20B, ALLaM-2) with full history."""
        self._load_env_file()
        key = (
            api_key.strip()
            or os.environ.get("GROQ_API_KEY", "").strip()
            or os.environ.get("GEMINI_API_KEY", "").strip()
        )
        if not key:
            return None, None
        try:
            if key.startswith("gsk_"):
                url = "https://api.groq.com/openai/v1/chat/completions"
                msgs: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
                if history:
                    for h in history[-8:]:
                        r_role = "assistant" if h.get("sender") == "ai" or h.get("role") == "assistant" else "user"
                        txt = str(h.get("text") or h.get("content") or "").strip()
                        if txt:
                            msgs.append({"role": r_role, "content": txt[:1200]})
                msgs.append({"role": "user", "content": user_question})

                default_order = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "allam-2-7b"]
                pm = (preferred_model or "").strip()
                if pm == "auto" or not pm:
                    # V8.3 Auto Smart Router: 120B for complex tactical geometry/JSON, Qwen 3.8 / 20B for snappy Arabic chat
                    if json_mode or len(user_question) > 65:
                        model_order = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "allam-2-7b"]
                    else:
                        model_order = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b", "allam-2-7b"]
                elif pm in default_order:
                    model_order = [pm] + [m for m in default_order if m != pm]
                else:
                    model_order = default_order

                for groq_model in model_order:
                    # ALLaM-2 does not support strict response_format=json_object on some calls
                    use_json_fmt = json_mode and groq_model != "allam-2-7b"
                    payload_dict: dict[str, Any] = {
                        "model": groq_model,
                        "temperature": 0.45 if not json_mode else 0.25,
                        "max_tokens": max_tokens,
                        "messages": msgs,
                    }
                    if use_json_fmt:
                        payload_dict["response_format"] = {"type": "json_object"}
                    body = json.dumps(payload_dict).encode("utf-8")
                    req = urllib.request.Request(
                        url,
                        data=body,
                        headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {key}",
                            "User-Agent": "Mozilla/5.0 (EGY-SCOUT-V8/8.7)",
                        },
                        method="POST",
                    )
                    try:
                        with urllib.request.urlopen(req, timeout=22) as resp:
                            data = json.loads(resp.read().decode("utf-8"))
                            text = data["choices"][0]["message"]["content"]
                            if text:
                                return str(text).strip(), f"Groq AI ({groq_model})"
                    except Exception:
                        continue
            else:
                for model_name in ("gemini-2.5-flash", "gemini-2.0-flash"):
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={key}"
                    body = json.dumps(
                        {
                            "system_instruction": {"parts": [{"text": system_prompt}]},
                            "contents": [{"role": "user", "parts": [{"text": user_question}]}],
                            "generationConfig": {"temperature": 0.35, "maxOutputTokens": max_tokens},
                        }
                    ).encode("utf-8")
                    req = urllib.request.Request(
                        url,
                        data=body,
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    try:
                        with urllib.request.urlopen(req, timeout=16) as resp:
                            data = json.loads(resp.read().decode("utf-8"))
                            candidates = data.get("candidates", [])
                            if candidates:
                                parts = candidates[0].get("content", {}).get("parts", [])
                                if parts and "text" in parts[0]:
                                    return str(parts[0]["text"]).strip(), f"Google Gemini ({model_name})"
                    except urllib.error.HTTPError:
                        continue
        except Exception:
            return None, None
        return None, None

    def generate_ai_tactical_drawing(
        self,
        tenant_id: str,
        match_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Synthesize ANY custom, innovative, or crazy 22-player tactical plan with exact AI-computed coordinates (x_m, y_m),
        custom run vectors, custom connected shapes (rings, pyramids, asymmetrical overloads, sweeper-keeper at midfield), arrows, and zones!"""
        prompt = str(payload.get("prompt", "")).strip()
        preferred_model = str(payload.get("model", "")).strip() or None
        base_f_a = str(payload.get("formation_code", "4-2-3-1")).strip()
        base_f_b = str(payload.get("opponent_formation_code", "4-4-2")).strip()
        base_style = str(payload.get("tactical_mode", "balanced")).strip()
        meta = self._get_match_meta(match_id)
        ta_ar = meta.get("team_a_name_ar", meta["team_a_name"])
        tb_ar = meta.get("team_b_name_ar", meta["team_b_name"])

        from packages.tactics_engine.moment_analyzer import _normalize_formation_digits

        found_formations = [
            _normalize_formation_digits(tok)
            for tok in re.findall(r"\b([1-9](?:-[1-9]){1,4}|[2-5][1-6][1-6][1-4]?)\b", prompt)
        ]
        if len(found_formations) >= 2:
            base_f_a, base_f_b = found_formations[0], found_formations[1]
        elif len(found_formations) == 1:
            base_f_a = found_formations[0]

        preset = match_masterclass_preset(prompt)
        ai_spec: dict[str, Any] = {}
        provider = "EGY-SCOUT Tactical Geometry Engine"

        if preset is not None:
            ai_spec = {
                "team_a_formation": preset["formation_code"],
                "team_b_formation": preset.get("opponent_formation_code", base_f_b),
                "team_a_style": preset.get("style", base_style),
                "team_b_style": "balanced",
                "title_ar": preset["title_ar"],
                "coach_explanation_ar": preset["philosophy_ar"],
                "team_a_nodes": preset["nodes"],
                "team_a_lines": preset.get("lines", []),
                "passing_arrows": preset.get("passes", []),
                "execution_steps_ar": [
                    "1. بدء التدرج عبر ثلاثي الدفاع مع ثنائي الارتكاز لاستدراج الضغط العالي.",
                    "2. تمرير كاسر للخطوط نحو المنطقة 14 واستغلال تحرك الأجنحة العكسية.",
                    "3. التحول العرضي السريع للجبهة الفارغة وإنهاء الهجمة داخل الصندوق.",
                ],
            }
            provider = "EGY-SCOUT Masterclass Tactical Engine (Xabi / Pep Geometry)"
        else:
            sys_json = (
                f"أنت عبقري تكتيك كرة قدم ومهندس رسم خطط حر 100% على ملعب FIFA أبعاده:\n"
                f"- محور الطول X من 0 (مرمى {ta_ar}) إلى 105 متر (مرمى {tb_ar}).\n"
                f"- محور العرض Y من 0 (خط التماس العلوي) إلى 68 متر (خط التماس السفلي)، ووسط الملعب عند Y=34.\n"
                f"- الفريق الأول (team_a — نادينا): {ta_ar} يهاجم من اليسار إلى اليمين (نحو X=105).\n"
                f"- الفريق الثاني (team_b — الخصم): {tb_ar} يهاجم من اليمين إلى اليسار (نحو X=0).\n\n"
                "قواعد صارمة لتنفيذ أي خطة تكتيكية (تقليدية أو مبتكرة):\n"
                "1. ثبّت حارس المرمى (GK) دائماً داخل منطقة الجزاء (x_m=6.0 و y_m=34.0 للفريق الأول، و x_m=99.0 و y_m=34.0 للخصم) بدون سهم حركة (move_to_x_m=x_m) إلا إذا طلب المستخدم صراحةً تقدم الحارس!\n"
                "2. اجعل أسهم تحرك اللاعبين (move_to_x_m, move_to_y_m) قصيرة ومنطقية (بحد أقصى 8 إلى 10 أمتار في اتجاه التحرك التكتيكي) ولا ترسم أسهماً عشوائية متقاطعة عبر الملعب.\n"
                "3. إذا طلب المستخدم خطة جديدة أو مبتكرة أو غير متماثلة (مثل 3-4-2-1 أو 3-2-4-1 أو 2-1-6-1)، وزّع اللاعبين الـ 10 الميدانيين بدقة هندسية واضحة بدون تداخل وأضف مسارات التمرير المتوقعة في passing_arrows.\n"
                "4. أخرج كائن JSON صالحاً فقط بهذا الشكل بالضبط:\n"
                "{\n"
                '  "team_a_formation": "رمز التشكيل مثل 4-2-3-1 أو 3-4-2-1 أو 3-2-4-1",\n'
                '  "team_b_formation": "تشكيل الخصم مثل 4-4-2 أو 5-4-1",\n'
                '  "team_a_style": "balanced | aggressive | conservative | tiki_taka | counter_attack | inverted_fullbacks | wing_overload",\n'
                '  "team_b_style": "balanced | aggressive | conservative | tiki_taka | counter_attack | inverted_fullbacks | wing_overload",\n'
                '  "title_ar": "اسم واضح للخطة التكتيكية بالعربية",\n'
                '  "coach_explanation_ar": "شرح تكتيكي واضح ومباشر لكيفية عمل الخطة وتوزيع الأدوار",\n'
                '  "team_a_nodes": [\n'
                '    {"slot": "GK", "role_ar": "حارس مرمى", "x_m": 6.0, "y_m": 34.0, "move_to_x_m": 6.0, "move_to_y_m": 34.0, "duty_ar": "حماية المرمى وبناء اللعب الآمن"},\n'
                '    "... (11 لاعباً بالضبط لـ team_a بإحداثيات منظمة)"\n'
                "  ],\n"
                '  "team_a_lines": [\n'
                '    {"line_type": "backline", "label_ar": "خط الدفاع", "slots": ["LB", "LCB", "RCB", "RB"]},\n'
                '    {"line_type": "midfield", "label_ar": "خط الوسط", "slots": ["LDM", "RDM", "CAM"]},\n'
                '    {"line_type": "attack", "label_ar": "خط الهجوم", "slots": ["LW", "ST", "RW"]}\n'
                "  ],\n"
                '  "team_b_nodes": [\n'
                '    {"slot": "GK", "role_ar": "حارس الخصم", "x_m": 99.0, "y_m": 34.0, "move_to_x_m": 99.0, "move_to_y_m": 34.0, "duty_ar": "حماية المرمى"},\n'
                '    "... (11 لاعباً بالضبط للخصم team_b)"\n'
                "  ],\n"
                '  "passing_arrows": [\n'
                '    {"from_slot": "CB", "to_slot": "LDM", "label_ar": "تدرج البناء"},\n'
                '    {"from_slot": "LDM", "to_slot": "CAM", "label_ar": "كسر الخطوط"},\n'
                '    {"from_slot": "CAM", "to_slot": "RW", "label_ar": "تغيير اللعب"},\n'
                '    {"from_slot": "RW", "to_slot": "ST", "label_ar": "تمريرة حاسمة"}\n'
                "  ],\n"
                '  "custom_zones": [\n'
                '    {"x1_m": 66.0, "y1_m": 18.0, "x2_m": 88.0, "y2_m": 50.0, "color": "#F59E0B", "label_ar": "منطقة التفوق العددي"}\n'
                "  ],\n"
                '  "execution_steps_ar": ["1. ...", "2. ...", "3. ..."]\n'
                "}\n"
                "مهم جداً: أعطِ 11 لاعباً كاملين في team_a_nodes و11 لاعباً في team_b_nodes مع 4 إلى 6 تمريرات أساسية في passing_arrows!"
            )

            llm_raw, provider = self._call_external_llm_if_configured(
                api_key="",
                system_prompt=sys_json,
                user_question=prompt or f"ارسم خطة {base_f_a} بأسلوب {base_style} ضد {base_f_b}",
                json_mode=True,
                preferred_model=preferred_model,
                max_tokens=3600,
            )

            if llm_raw:
                try:
                    ai_spec = json.loads(llm_raw)
                except Exception:
                    m_j = re.search(r"\{[\s\S]*\}", llm_raw)
                    if m_j:
                        try:
                            ai_spec = json.loads(m_j.group(0))
                        except Exception:
                            ai_spec = {}

        final_f_a = str(ai_spec.get("team_a_formation") or base_f_a)
        final_f_b = str(ai_spec.get("team_b_formation") or base_f_b)
        final_style_a = str(ai_spec.get("team_a_style") or base_style)
        final_style_b = str(ai_spec.get("team_b_style") or "balanced")

        bp = self.get_formation_blueprint(
            tenant_id=tenant_id,
            match_id=match_id,
            formation_code=final_f_a,
            team="team_a",
            tactical_mode=final_style_a,
            opponent_formation_code=final_f_b,
            opponent_tactical_mode=final_style_b,
        )

        wants_sweeper_gk = any(
            kw in (prompt or "").lower()
            for kw in ("حارس متقدم", "تقدم الحارس", "حارس ليبرو", "طلع الحارس", "sweeper")
        )
        wants_leverkusen_names = any(
            kw in (prompt or "").lower()
            for kw in ("ليفركوزن", "ليفيركوزن", "بايرنليفيركوزن", "leverkusen", "ألونسو", "الونسو", "المونسو", "alonso", "3421")
        )
        qa_ai = self.get_qa_sheet(tenant_id, match_id)
        override_roster_a = _squad_from_clubs_json("bayer_leverkusen_alonso") if wants_leverkusen_names else None

        def _merge_ai_nodes(
            ai_list: Any, base_nodes: list[dict[str, Any]], team_key: str
        ) -> list[dict[str, Any]]:
            if not isinstance(ai_list, list) or len(ai_list) < 6:
                return base_nodes
            valid_raw = [nd for nd in ai_list[:11] if isinstance(nd, dict)]
            ai_slots = [str(nd.get("slot") or f"P{i+1}")[:8] for i, nd in enumerate(valid_raw)]
            if ai_slots:
                ai_slots[0] = "GK"
            if team_key == "team_a" and override_roster_a:
                roster_pool = [
                    {
                        "verified_name": self._clean_player_name_only(r.get("name_ar") or r.get("name")),
                        "jersey_number": r.get("jersey_number"),
                        "track_id": base_nodes[i].get("track_id") if i < len(base_nodes) else None,
                        "position": r.get("position"),
                    }
                    for i, r in enumerate(override_roster_a)
                ]
            else:
                roster_pool = self._build_formation_team_roster(qa_ai, team_key)
                if not roster_pool:
                    roster_pool = [
                        {
                            "verified_name": bn.get("player_label"),
                            "jersey_number": bn.get("jersey_number"),
                            "track_id": bn.get("track_id"),
                            "position": bn.get("slot"),
                        }
                        for bn in base_nodes
                    ]
            pos_matched = _assign_roster_by_position(ai_slots, roster_pool)

            merged: list[dict[str, Any]] = []
            for idx, raw_nd in enumerate(valid_raw):
                base_nd = base_nodes[idx] if idx < len(base_nodes) else {}
                matched = pos_matched[idx] if idx < len(pos_matched) and pos_matched[idx] else {}
                slot_code = ai_slots[idx].upper()
                is_gk = (idx == 0) or (slot_code == "GK")

                if is_gk and not wants_sweeper_gk:
                    # Strictly lock goalkeeper inside penalty box with ZERO movement arrow
                    xm = 6.0 if team_key == "team_a" else 99.0
                    ym = 34.0
                    mx, my = xm, ym
                else:
                    min_x = 12.0 if (team_key == "team_a" and not is_gk) else 4.0
                    max_x = 93.0 if (team_key == "team_b" and not is_gk) else 101.0
                    xm = float(np.clip(float(raw_nd.get("x_m", base_nd.get("x_m", 52.5))), min_x, max_x))
                    ym = float(np.clip(float(raw_nd.get("y_m", base_nd.get("y_m", 34.0))), 5.0, 63.0))
                    raw_mx = float(np.clip(float(raw_nd.get("move_to_x_m", xm)), min_x, max_x))
                    raw_my = float(np.clip(float(raw_nd.get("move_to_y_m", ym)), 5.0, 63.0))
                    # Clamp movement vector length so AI never draws wild 40m arrows across the pitch
                    dx, dy = raw_mx - xm, raw_my - ym
                    dist = float(np.hypot(dx, dy))
                    max_run = 4.5 if ("CB" in slot_code and not wants_sweeper_gk) else 14.5
                    if dist > max_run and dist > 0:
                        scale = max_run / dist
                        mx = xm + dx * scale
                        my = ym + dy * scale
                    else:
                        mx, my = raw_mx, raw_my

                # Prevent two players on the same team from sitting directly on top of each other
                for prev_nd in merged:
                    if float(np.hypot(xm - prev_nd["x_m"], ym - prev_nd["y_m"])) < 3.8:
                        xm = float(np.clip(xm + (4.2 if team_key == "team_a" else -4.2), 5.0, 100.0))
                        ym = float(np.clip(ym + (4.0 if ym < 34.0 else -4.0), 5.0, 63.0))
                merged.append(
                    {
                        "team": team_key,
                        "slot": ai_slots[idx],
                        "role_ar": str(raw_nd.get("role_ar") or base_nd.get("role_ar") or "دور تكتيكي"),
                        "player_label": str(matched.get("verified_name") or base_nd.get("player_label") or ai_slots[idx]),
                        "track_id": matched.get("track_id") if matched else base_nd.get("track_id"),
                        "jersey_number": matched.get("jersey_number") or base_nd.get("jersey_number") or (idx + 1),
                        "x_m": round(xm, 1),
                        "y_m": round(ym, 1),
                        "move_to_x_m": round(mx, 1),
                        "move_to_y_m": round(my, 1),
                        "duty_ar": str(raw_nd.get("duty_ar") or base_nd.get("duty_ar") or "واجب تكتيكي"),
                    }
                )
            while len(merged) < len(base_nodes):
                merged.append(base_nodes[len(merged)])
            return merged if len(merged) >= 6 else base_nodes

        def _rebuild_clean_lines(nodes_list: list[dict[str, Any]], team_key: str, spec_lines: Any = None) -> list[dict[str, Any]]:
            """Build tactical shape lines from explicit slot bands when given, else depth-clustered bands."""
            slot_map = {str(n.get("slot", "")).upper(): n for n in nodes_list}
            if isinstance(spec_lines, list) and spec_lines:
                explicit: list[dict[str, Any]] = []
                for ln in spec_lines:
                    if not isinstance(ln, dict):
                        continue
                    pts = [
                        {"slot": slot_map[str(sl).upper()]["slot"], "x_m": slot_map[str(sl).upper()]["x_m"], "y_m": slot_map[str(sl).upper()]["y_m"]}
                        for sl in (ln.get("slots") or [])
                        if str(sl).upper() in slot_map
                    ]
                    if len(pts) >= 2:
                        explicit.append(
                            {
                                "team": team_key,
                                "line_type": str(ln.get("line_type") or "midfield"),
                                "label_ar": str(ln.get("label_ar") or "خط تكتيكي"),
                                "points": pts,
                            }
                        )
                if len(explicit) >= 2:
                    return explicit

            outfield = [n for n in nodes_list if str(n.get("slot", "")).upper() != "GK"]
            if len(outfield) < 4:
                return []
            ordered_x = sorted(outfield, key=lambda n: n["x_m"] if team_key == "team_a" else -n["x_m"])
            n_def = min(4, max(2, len(ordered_x) // 3))
            n_mid = min(4, max(2, (len(ordered_x) - n_def) // 2))
            bands = [
                ("backline", "خط الدفاع", ordered_x[:n_def]),
                ("midfield", "خط الوسط", ordered_x[n_def : n_def + n_mid]),
                ("attack", "خط الهجوم", ordered_x[n_def + n_mid :]),
            ]
            clean_lines = []
            for ltype, lbl, grp in bands:
                pts = sorted(
                    [{"slot": g["slot"], "x_m": g["x_m"], "y_m": g["y_m"]} for g in grp],
                    key=lambda p: p["y_m"],
                )
                if len(pts) >= 2:
                    clean_lines.append({"team": team_key, "line_type": ltype, "label_ar": lbl, "points": pts})
            return clean_lines

        bp["nodes"] = _merge_ai_nodes(ai_spec.get("team_a_nodes"), bp["nodes"], "team_a")
        bp["opponent_nodes"] = _merge_ai_nodes(
            ai_spec.get("team_b_nodes"), bp.get("opponent_nodes", []), "team_b"
        )
        bp["lines"] = _rebuild_clean_lines(bp["nodes"], "team_a", ai_spec.get("team_a_lines"))
        bp["opponent_lines"] = _rebuild_clean_lines(bp["opponent_nodes"], "team_b")

        bp["formation_code"] = final_f_a
        bp["opponent_formation_code"] = final_f_b
        if ai_spec.get("title_ar"):
            bp["title_ar"] = str(ai_spec["title_ar"])
        if ai_spec.get("coach_explanation_ar"):
            bp["philosophy_ar"] = str(ai_spec["coach_explanation_ar"])
        if isinstance(ai_spec.get("execution_steps_ar"), list) and ai_spec["execution_steps_ar"]:
            bp["execution_steps_ar"] = [str(s) for s in ai_spec["execution_steps_ar"]]

        raw_passing = ai_spec.get("passing_arrows") if isinstance(ai_spec.get("passing_arrows"), list) else []
        if not raw_passing:
            outfield_a = sorted(
                [n for n in bp["nodes"] if str(n.get("slot", "")).upper() != "GK"],
                key=lambda n: n["x_m"],
            )
            if len(outfield_a) >= 9:
                for i1, i2, lbl in (
                    (1, 3, "بناء من الخط الخلفي"),
                    (3, 5, "تدرج لمحور الارتكاز"),
                    (4, 7, "كسر الخطوط للمنطقة 14"),
                    (6, 8, "تحول سريع للطرف"),
                    (7, 9 if len(outfield_a) > 9 else 8, "تمريرة حاسمة بالصندوق"),
                ):
                    n1, n2 = outfield_a[i1], outfield_a[i2]
                    raw_passing.append(
                        {
                            "team": "team_a",
                            "from_slot": n1["slot"],
                            "to_slot": n2["slot"],
                            "from_x_m": n1["x_m"],
                            "from_y_m": n1["y_m"],
                            "to_x_m": n2["x_m"],
                            "to_y_m": n2["y_m"],
                            "label_ar": lbl,
                        }
                    )

        enriched_passes = enrich_arrows_with_probabilities(
            raw_passing, bp["nodes"], bp["opponent_nodes"], attack_right=True
        )
        bp["passing_arrows"] = enriched_passes

        raw_custom = ai_spec.get("custom_arrows") if isinstance(ai_spec.get("custom_arrows"), list) else []
        if not raw_custom:
            raw_custom = [
                {
                    "from_slot": p.get("from_slot"),
                    "to_slot": p.get("to_slot"),
                    "from_x_m": p["from_x_m"],
                    "from_y_m": p["from_y_m"],
                    "to_x_m": p["to_x_m"],
                    "to_y_m": p["to_y_m"],
                    "kind": "pass",
                    "color": "#38BDF8" if idx % 2 == 0 else "#10B981",
                    "label_ar": p.get("label_ar", "تمريرة"),
                }
                for idx, p in enumerate(enriched_passes[:4])
            ]
        bp["custom_arrows"] = enrich_arrows_with_probabilities(
            raw_custom, bp["nodes"], bp["opponent_nodes"], attack_right=True
        )
        if isinstance(ai_spec.get("custom_zones"), list) and ai_spec["custom_zones"]:
            bp["custom_zones"] = ai_spec["custom_zones"]
        else:
            # Highlight the densest attacking cluster of Team A automatically
            att_nodes = sorted(bp["nodes"], key=lambda n: -n["x_m"])[:5]
            if att_nodes:
                xs = [n["x_m"] for n in att_nodes]
                ys = [n["y_m"] for n in att_nodes]
                bp["custom_zones"] = [{
                    "x1_m": round(max(10.0, min(xs) - 5.0), 1),
                    "y1_m": round(max(4.0, min(ys) - 5.0), 1),
                    "x2_m": round(min(101.0, max(xs) + 5.0), 1),
                    "y2_m": round(min(64.0, max(ys) + 5.0), 1),
                    "color": "#F59E0B",
                    "label_ar": "منطقة الكثافة والتفوق الهجومي",
                }]
        from packages.tactics_engine.plan_validator import validate_tactical_plan
        bp["math_validation"] = validate_tactical_plan(
            bp.get("nodes", []), bp.get("opponent_nodes", []), formation_code=bp.get("formation_code", "")
        )
        bp["ai_provider"] = provider or "EGY-SCOUT Tactical Geometry Engine"
        return bp

    def answer_tactical_chat(
        self,
        tenant_id: str,
        match_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Conversational Grounded AI Tactical Analyst powered by Groq Multi-Model AI + Two-Team Live Telemetry + Live AI Pitch Drawing."""
        question = str(payload.get("question", "")).strip()
        preferred_model = str(payload.get("model", "")).strip() or None
        history = payload.get("history") if isinstance(payload.get("history"), list) else []
        time_s = payload.get("time_s")
        frame_id = payload.get("frame_id")
        selected_track_id = payload.get("selected_track_id")
        defending_team = payload.get("defending_team")

        moment = self.get_moment_state_analysis(
            tenant_id=tenant_id,
            match_id=match_id,
            frame_id=int(frame_id) if frame_id is not None else None,
            time_s=float(time_s) if time_s is not None else None,
            selected_track_id=int(selected_track_id) if selected_track_id is not None else None,
            defending_team=str(defending_team) if defending_team else None,
        )
        ms = moment["moment_summary"]
        active_fid = int(ms["frame_id"])
        pos_analysis = self.get_positioning_analysis(
            match_id, frame_id=active_fid, defending_team=ms["defending_team"]
        )
        scouting = self.get_scouting_data(tenant_id, match_id=match_id)

        ta_name = moment["team_a_name_ar"]
        tb_name = moment["team_b_name_ar"]
        form_a = moment["formations"].get("team_a", {})
        form_b = moment["formations"].get("team_b", {})

        # Separate player states for BOTH teams so the AI always analyzes Team A AND Team B
        team_a_players = [p for p in moment["player_states"] if p["team"] == "team_a"]
        team_b_players = [p for p in moment["player_states"] if p["team"] == "team_b"]

        q_lower = question.lower()
        wants_drawing = match_masterclass_preset(q_lower) is not None or any(
            kw in q_lower
            for kw in (
                "ارسم",
                "رسم",
                "خطة",
                "خطه",
                "تشكيل",
                "تكتيك",
                "ستايل",
                "اسلوب",
                "أسلوب",
                "مجنون",
                "مبتكر",
                "جديد",
                "مختلف",
                "غريب",
                "متعملتش",
                "اخترع",
                "ابتكر",
                "فكرة",
                "فكره",
                "تيكي تاكا",
                "ضغط عالي",
                "مرتد",
                "4-2-3-1",
                "4-3-3",
                "3-5-2",
                "3-4-2-1",
                "3421",
                "3-2-4-1",
                "3241",
                "4-4-2",
                "5-3-2",
                "4-1-4-1",
                "ليفركوزن",
                "ليفيركوزن",
                "بايرنليفيركوزن",
                "المونسو",
                "ألونسو",
                "الونسو",
                "alonso",
                "leverkusen",
            )
        )

        # Build a rich, compact Two-Team Telemetry Context for Llama-3.3-70B (so it answers freely without repeating a template!)
        telemetry_context = {
            "match": f"{ta_name} ضد {tb_name}",
            "time_s": ms["time_s"],
            "frame_id": active_fid,
            "ball": {"x_m": ms["ball_x_m"], "y_m": ms["ball_y_m"], "zone_ar": ms["ball_zone_ar"]},
            "pitch_control_pct": {
                ms["attacking_team_name"]: ms["attacking_pitch_control_pct"],
                ms["defending_team_name"]: round(100.0 - float(ms["attacking_pitch_control_pct"]), 1),
            },
            "shot_xg": {
                "current": ms["shot_xg_before"],
                "after_defensive_correction": ms["shot_xg_after_correction"],
                "risk_reduction_pct": ms["risk_reduction_if_corrected_pct"],
            },
            "team_a_live_formation": {
                "team_name": ta_name,
                "detected_shape": form_a.get("detected_shape"),
                "width_m": form_a.get("width_m"),
                "depth_m": form_a.get("depth_m"),
                "defensive_line_x_m": form_a.get("defensive_line_x_m"),
                "line_gap_def_mid_m": form_a.get("line_gap_def_mid_m"),
                "players": [
                    {
                        "label": p["player_label"],
                        "track_id": p["track_id"],
                        "pos_xy": [p["x_m"], p["y_m"]],
                        "opt_xy": [p["opt_x_m"], p["opt_y_m"]],
                        "speed_kmh": p["speed_kmh"],
                        "dist_ball_m": p["dist_to_ball_m"],
                        "zone": p["zone_ar"],
                        "did": p["did_ar"],
                        "did_not": p["did_not_ar"],
                        "where_and_why": p["where_and_why_ar"],
                    }
                    for p in team_a_players[:8]
                ],
            },
            "team_b_live_formation": {
                "team_name": tb_name,
                "detected_shape": form_b.get("detected_shape"),
                "width_m": form_b.get("width_m"),
                "depth_m": form_b.get("depth_m"),
                "defensive_line_x_m": form_b.get("defensive_line_x_m"),
                "line_gap_def_mid_m": form_b.get("line_gap_def_mid_m"),
                "players": [
                    {
                        "label": p["player_label"],
                        "track_id": p["track_id"],
                        "pos_xy": [p["x_m"], p["y_m"]],
                        "opt_xy": [p["opt_x_m"], p["opt_y_m"]],
                        "speed_kmh": p["speed_kmh"],
                        "dist_ball_m": p["dist_to_ball_m"],
                        "zone": p["zone_ar"],
                        "did": p["did_ar"],
                        "did_not": p["did_not_ar"],
                        "where_and_why": p["where_and_why_ar"],
                    }
                    for p in team_b_players[:8]
                ],
            },
            "passing_channels": moment["passing_channels"][:4],
            "tactical_correction_arrows": moment["correction_arrows"][:4],
            "two_team_diagnoses": [
                {"team": d.get("team_name_ar"), "issue": d["title_ar"], "evidence": d["evidence_ar"]}
                for d in pos_analysis.get("diagnoses", [])
            ],
            "fastest_video_tracks": [
                {
                    "player": vt.get("display_name"),
                    "team": vt.get("team_name"),
                    "max_speed_kmh": vt.get("max_speed_kmh"),
                    "distance_m": vt.get("in_frame_distance_m"),
                }
                for vt in sorted(scouting["video_tracks"], key=lambda x: float(x.get("max_speed_kmh") or 0.0), reverse=True)[:5]
            ],
        }

        sys_prompt = (
            "أنت المحلل التكتيكي الذكي العبقري لنظام EGY-SCOUT V8.\n"
            "قواعد صارمة جداً:\n"
            "1. إياك أن تكرر قوالب محفوظة أو ديباجات ثابتة! أجب مباشرة وبذكاء وإبداع وحرية كاملة على سؤال المستخدم تحديداً.\n"
            "2. إذا طلب المستخدم خطة مجنونة أو جديدة أو مبتكرة لم تُلعب من قبل، لا تعتذر ولا تعيده للتشكيلات التقليدية! ابتكرها فعلياً بجرأة واشرح تفاصيلها الهندسية على الملعب لكل لاعب!\n"
            "3. حلّل الفريقين معاً دائماً ("
            + f"{ta_name} و {tb_name}"
            + ") عندما يكون السؤال عن المباراة أو اللقطة أو التكتيك، ولا تقتصر على فريق واحد أبداً.\n"
            "4. استند إلى الأرقام الحقيقية من بيانات القياس الحية المرفقة (الإحداثيات بالمتر، السرعات كم/س، المسافات، ماذا فعل اللاعب DID، ماذا لم يفعل DID NOT، وأين ولماذا أخطأ WHERE & WHY) عندما تتحدث عن اللقطة الحالية.\n\n"
            "بيانات القياس الحية للقطة الحالية (Two-Team Live Telemetry JSON):\n"
            + json.dumps(telemetry_context, ensure_ascii=False)
        )

        llm_text, llm_provider = self._call_external_llm_if_configured(
            api_key="",
            system_prompt=sys_prompt,
            user_question=question or "حلل موقف الفريقين في هذه اللقطة بالتفصيل.",
            history=history,
            json_mode=False,
            preferred_model=preferred_model,
            max_tokens=1800,
        )

        structured_cards: list[dict[str, Any]] = []
        suggested_actions: list[dict[str, Any]] = []
        drawn_blueprint: Optional[dict[str, Any]] = None

        # If the user asked to draw a formation/plan/crazy idea, generate the live 22-player custom-coordinate AI drawing blueprint!
        if wants_drawing:
            drawn_blueprint = self.generate_ai_tactical_drawing(
                tenant_id=tenant_id,
                match_id=match_id,
                payload={"prompt": question, "model": preferred_model},
            )
            structured_cards.append(
                {
                    "card_type": "formation_blueprint",
                    "title_ar": f"🎨 مرسم الذكاء الاصطناعي الحي (22 لاعباً): {drawn_blueprint['title_ar']}",
                    "formation_code": drawn_blueprint["formation_code"],
                    "opponent_formation_code": drawn_blueprint.get("opponent_formation_code", "4-4-2"),
                    "philosophy_ar": drawn_blueprint["philosophy_ar"],
                    "nodes_count": len(drawn_blueprint["nodes"]) + len(drawn_blueprint.get("opponent_nodes", [])),
                    "blueprint": drawn_blueprint,
                }
            )
            suggested_actions.append(
                {
                    "action": "apply_ai_blueprint",
                    "formation_code": drawn_blueprint["formation_code"],
                    "label_ar": f"تطبيق رسم ({drawn_blueprint['formation_code']} ضد {drawn_blueprint.get('opponent_formation_code', '4-4-2')}) في مرسم الخطط الكبير",
                }
            )

        # Attach both teams' focal player cards when discussing the moment or mistakes
        if not wants_drawing or "لاعب" in q_lower or "عمل" in q_lower or "غلط" in q_lower:
            for fp in [ms.get("team_a_focal_player"), ms.get("team_b_focal_player")]:
                if fp is not None:
                    structured_cards.append(
                        {
                            "card_type": "moment_did_didnot",
                            "title_ar": f"تشريح حالة {fp['team_name']} — {fp['player_label']}",
                            "track_id": fp["track_id"],
                            "speed_kmh": fp["speed_kmh"],
                            "dist_to_ball_m": fp["dist_to_ball_m"],
                            "x_m": fp["x_m"],
                            "y_m": fp["y_m"],
                            "opt_x_m": fp["opt_x_m"],
                            "opt_y_m": fp["opt_y_m"],
                            "did_ar": fp["did_ar"],
                            "did_not_ar": fp["did_not_ar"],
                            "where_and_why_ar": fp["where_and_why_ar"],
                        }
                    )

        if llm_text and llm_provider:
            final_answer_ar = llm_text
            engine_label = llm_provider
        else:
            # Fallback only if offline (no internet)
            engine_label = "محرك EGY-SCOUT التكتيكي (Offline Fallback)"
            final_answer_ar = (
                f"### تحليل الفريقين: **{ta_name}** (`{form_a.get('detected_shape')}`) × **{tb_name}** (`{form_b.get('detected_shape')}`)\n"
                f"- **موقع الكرة:** `{ms['ball_zone_ar']}` عند `(X={ms['ball_x_m']}م، Y={ms['ball_y_m']}م)` • **السيطرة:** `{ms['attacking_pitch_control_pct']}%` • **xG:** `{ms['shot_xg_before']}`\n"
                + (
                    f"- **موقف {ta_name} ({ms['team_a_focal_player']['player_label']}):** {ms['team_a_focal_player']['did_ar']} | {ms['team_a_focal_player']['did_not_ar']}\n"
                    if ms.get("team_a_focal_player")
                    else ""
                )
                + (
                    f"- **موقف {tb_name} ({ms['team_b_focal_player']['player_label']}):** {ms['team_b_focal_player']['did_ar']} | {ms['team_b_focal_player']['did_not_ar']}"
                    if ms.get("team_b_focal_player")
                    else ""
                )
            )

        shape_a = str(form_a.get("detected_shape") or "4-3-3")
        shape_b = str(form_b.get("detected_shape") or "4-4-2")
        fa_label = ms["team_a_focal_player"]["player_label"] if ms.get("team_a_focal_player") else ta_name
        fb_label = ms["team_b_focal_player"]["player_label"] if ms.get("team_b_focal_player") else tb_name
        follow_ups = [
            f"قارن تمركز {ta_name} ({shape_a}) مع {tb_name} ({shape_b}) في الثانية {ms['time_s']}",
            f"تشريح قرار {fa_label} ({ta_name}) و{fb_label} ({tb_name}) عند {ms['ball_zone_ar']}",
            f"ارسم خطة {shape_a} لـ {ta_name} ضد {shape_b} لـ {tb_name} بناءً على هذه اللقطة",
            "ماذا لو تحرك المدافع الأقرب لإغلاق زاوية التمرير؟ كم ينخفض xG؟",
        ]

        has_ext_key = bool(
            os.environ.get("GROQ_API_KEY", "").strip()
            or os.environ.get("GEMINI_API_KEY", "").strip()
        )

        return {
            "match_id": match_id,
            "frame_id": active_fid,
            "time_s": ms["time_s"],
            "engine": engine_label,
            "has_external_api_key": has_ext_key,
            "question": question,
            "answer_ar": final_answer_ar,
            "moment_summary": ms,
            "ai_drawing_blueprint": drawn_blueprint,
            "structured_cards": structured_cards,
            "suggested_actions": suggested_actions,
            "follow_up_questions": follow_ups,
        }
