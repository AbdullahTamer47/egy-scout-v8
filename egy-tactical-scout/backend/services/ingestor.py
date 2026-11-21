"""Video ingestion, fast pre-merged YouTube clip downloading & FFmpeg normalization.

Fixes all V1 stalling/failed ingest issues by explicitly wiring imageio_ffmpeg into both yt-dlp
(`ffmpeg_location`) and subprocess transcoding, selecting fast pre-merged MP4 streams,
and validating decoded frames with OpenCV before creating/updating Match records.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import uuid
from collections.abc import Callable
from pathlib import Path

import cv2
import imageio_ffmpeg
import yt_dlp
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import find_ffmpeg, get_settings
from core.database import SessionLocal
from models.schema import Club, Match

FFMPEG_BIN = find_ffmpeg() or imageio_ffmpeg.get_ffmpeg_exe()

EGYPTIAN_SEARCH_QUERIES = [
    "ملخص مباراة الأهلي اليوم الدوري المصري",
    "ملخص مباراة الزمالك اليوم الدوري المصري",
    "ملخص مباراة بيراميدز المصري الدوري المصري",
    "أهداف مباريات دوري المحترفين المصري الدرجة الثانية",
]

ARABIC_CLUB_ALIASES: dict[str, list[str]] = {
    "egy1-alahly": ["الأهلي", "الاهلي", "alahly", "al ahly"],
    "egy1-zamalek": ["الزمالك", "zamalek"],
    "egy1-pyramids": ["بيراميدز", "pyramids"],
    "egy1-masry": ["المصري", "البورسعيدي", "masry"],
    "egy1-ismaily": ["الإسماعيلي", "الاسماعيلي", "ismaily"],
    "egy1-ittihad": ["الاتحاد السكندري", "ittihad"],
    "egy1-ceramica": ["سيراميكا", "ceramica"],
    "egy1-modern": ["مودرن", "فيوتشر", "modern sport"],
    "egy1-zed": ["زد", "zed"],
    "egy1-smouha": ["سموحة", "smouha"],
    "egy1-enppi": ["إنبي", "انبي", "enppi"],
    "egy1-talaea": ["طلائع الجيش", "الطلائع"],
    "egy1-nbank": ["البنك الأهلي", "البنك الاهلي"],
    "egy1-gouna": ["الجونة", "gouna"],
    "egy1-pharco": ["فاركو", "pharco"],
    "egy1-mahalla": ["غزل المحلة", "المحلة"],
    "egy1-petrojet": ["بتروجيت", "petrojet"],
    "egy1-haras": ["حرس الحدود"],
    "egy2-wadidegla": ["وادي دجلة", "دجلة"],
    "egy2-arabcontractors": ["المقاولون", "المقاولون العرب"],
    "egy2-tersana": ["الترسانة"],
    "egy2-sekka": ["السكة الحديد"],
}


def parse_match_title(title: str) -> dict[str, str | None]:
    clean = re.sub(r"\s+", " ", title or "").strip()
    found_clubs: list[str] = []
    lower = clean.lower()
    for ext_id, aliases in ARABIC_CLUB_ALIASES.items():
        if any(a.lower() in lower for a in aliases):
            found_clubs.append(ext_id)
            if len(found_clubs) == 2:
                break
    return {
        "home_ext_id": found_clubs[0] if len(found_clubs) >= 1 else None,
        "away_ext_id": found_clubs[1] if len(found_clubs) >= 2 else None,
    }


def _club_id_by_ext(db: Session, ext_id: str | None) -> int | None:
    if not ext_id:
        return None
    return db.scalar(select(Club.id).where(Club.external_id == ext_id))


def probe_video_readable(video_path: Path) -> dict | None:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None
    ok, frame = cap.read()
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or (frame.shape[1] if ok and frame is not None else 0))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or (frame.shape[0] if ok and frame is not None else 0))
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    if not ok or frame is None or w <= 0 or h <= 0:
        return None
    if fps <= 1.0 or fps > 120.0:
        fps = 25.0
    return {
        "fps": fps,
        "width": w,
        "height": h,
        "frame_count": frames,
        "duration_s": round(frames / fps, 2) if frames > 0 else 0.0,
    }


def normalize_video(
    src: Path,
    dst: Path,
    max_height: int = 720,
    target_fps: float = 25.0,
    max_sec: int | None = None,
) -> dict:
    """Normalize any local/downloaded video to constant-FPS H.264 MP4 cleanly using imageio_ffmpeg."""
    if not FFMPEG_BIN:
        raise RuntimeError("لم يتم العثور على ffmpeg لتوحيد صيغة الفيديو")
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp_dst = dst.with_suffix(".norm.tmp.mp4")

    # Even width/height filter capped at max_height
    vf = f"scale=-2:'min({int(max_height)},ih)'"
    cmd = [
        FFMPEG_BIN,
        "-y",
        "-err_detect",
        "ignore_err",
        "-fflags",
        "+genpts",
        "-i",
        str(src),
    ]
    if max_sec and max_sec > 0:
        cmd.extend(["-t", str(int(max_sec))])
    cmd.extend(
        [
            "-vf",
            vf,
            "-r",
            str(int(round(target_fps))),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            str(tmp_dst),
        ]
    )
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0 or not tmp_dst.exists() or tmp_dst.stat().st_size < 1024:
        err_tail = (proc.stderr or "")[-400:]
        if tmp_dst.exists():
            tmp_dst.unlink(missing_ok=True)
        raise RuntimeError(f"فشل معالجة الفيديو عبر ffmpeg: {err_tail}")

    tmp_dst.replace(dst)
    meta = probe_video_readable(dst)
    if not meta:
        raise RuntimeError(f"ملف الفيديو الناتج غير قابل للقراءة: {dst}")
    return meta


def _ensure_ytdlp_ffmpeg_dir() -> str | None:
    """Provide a directory containing `ffmpeg.exe` on PATH for yt-dlp `download_ranges`."""
    if not FFMPEG_BIN:
        return None
    src = Path(FFMPEG_BIN)
    if not src.exists():
        return None
    if src.stem.lower() == "ffmpeg":
        bin_dir = src.parent
    else:
        bin_dir = get_settings().cache_dir / "bin"
        bin_dir.mkdir(parents=True, exist_ok=True)
        alias = bin_dir / ("ffmpeg.exe" if src.suffix.lower() == ".exe" else "ffmpeg")
        if not alias.exists() or alias.stat().st_size != src.stat().st_size:
            shutil.copy2(src, alias)
    dir_str = str(bin_dir)
    cur_path = os.environ.get("PATH", "")
    if dir_str.lower() not in cur_path.lower():
        os.environ["PATH"] = f"{dir_str}{os.pathsep}{cur_path}" if cur_path else dir_str
    return dir_str


FFMPEG_YTDLP_DIR = _ensure_ytdlp_ffmpeg_dir()


def download_egyptian_match_clip(
    query_or_url: str,
    out_dir: Path,
    max_sec: int = 60,
    progress_cb: Callable[[float, str], None] | None = None,
) -> dict:
    """Download fast pre-merged <=720p MP4 clip via yt-dlp with explicit imageio_ffmpeg location."""
    out_dir.mkdir(parents=True, exist_ok=True)
    target = query_or_url.strip()
    if not target.startswith("http"):
        target = f"ytsearch1:{target}"

    def _hook(d: dict) -> None:
        if not progress_cb:
            return
        if d.get("status") == "downloading":
            total = float(d.get("total_bytes") or d.get("total_bytes_estimate") or 0.0)
            done = float(d.get("downloaded_bytes") or 0.0)
            frac = min(0.85, (done / total) * 0.85) if total > 0 else 0.2
            progress_cb(frac, "جاري سحب الفيديو عبر yt-dlp...")

    base_opts = {
        "format": "best[ext=mp4][height<=720]/18/bestvideo[ext=mp4][vcodec^=avc1][height<=720]/bestvideo[ext=mp4][height<=720]/136/135/134/best",
        "ffmpeg_location": FFMPEG_YTDLP_DIR or FFMPEG_BIN,
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "overwrites": True,
        "socket_timeout": 25,
        "retries": 3,
        "progress_hooks": [_hook],
    }

    opts = dict(base_opts)
    used_ranges = False
    if max_sec and max_sec > 0:
        opts["download_ranges"] = yt_dlp.utils.download_range_func(None, [(0, int(max_sec))])
        opts["force_keyframes_at_cuts"] = False
        used_ranges = True

    info = None
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(target, download=True)
    except Exception:
        if not used_ranges:
            raise
        # Retry full stream without byte-range slicing and trim locally with ffmpeg
        with yt_dlp.YoutubeDL(base_opts) as ydl:
            info = ydl.extract_info(target, download=True)

    entry = info["entries"][0] if (info and "entries" in info and info["entries"]) else info
    if not entry:
        raise RuntimeError("لم يتم العثور على أي فيديو مطابق لرابط أو عبارة البحث")

    vid_id = entry.get("id") or uuid.uuid4().hex[:10]
    ext = entry.get("ext") or "mp4"
    cand = out_dir / f"{vid_id}.{ext}"
    if not cand.exists():
        matches = sorted(out_dir.glob(f"{vid_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not matches:
            raise RuntimeError(f"فشل حفظ ملف الفيديو المحمل للمعرف {vid_id}")
        cand = matches[0]

    return {
        "video_id": vid_id,
        "title": entry.get("title") or "مباراة الدوري المصري",
        "channel": entry.get("channel") or entry.get("uploader"),
        "source_url": entry.get("webpage_url") or query_or_url,
        "file_path": str(cand),
        "duration": entry.get("duration") or max_sec,
    }


class AutonomousMatchHarvester:
    """Handles local MP4 ingestion and autonomous YouTube match harvesting without stalls."""

    def __init__(self) -> None:
        self.settings = get_settings()

    def search_recent(self, queries: list[str] | None = None, max_results: int = 3) -> list[dict]:
        qs = queries or EGYPTIAN_SEARCH_QUERIES[:2]
        out: list[dict] = []
        seen: set[str] = set()
        opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
            "ignoreerrors": True,
            "socket_timeout": 15,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            for q in qs:
                try:
                    res = ydl.extract_info(f"ytsearch{max_results}:{q}", download=False)
                    for e in (res or {}).get("entries") or []:
                        if not e or not e.get("id") or e["id"] in seen:
                            continue
                        seen.add(e["id"])
                        out.append(
                            {
                                "video_id": e["id"],
                                "title": e.get("title") or q,
                                "url": e.get("url") or f"https://www.youtube.com/watch?v={e['id']}",
                                "channel": e.get("channel") or e.get("uploader"),
                                "duration": e.get("duration"),
                            }
                        )
                except Exception:
                    continue
        return out

    def ingest_youtube(
        self,
        url_or_query: str,
        competition: str | None = "الدوري المصري الممتاز",
        max_sec: int = 60,
        progress_cb: Callable[[float, str], None] | None = None,
    ) -> Match:
        raw_info = download_egyptian_match_clip(
            url_or_query,
            self.settings.raw_dir,
            max_sec=max_sec,
            progress_cb=progress_cb,
        )
        raw_file = Path(raw_info["file_path"])
        vid_id = raw_info["video_id"]
        norm_path = self.settings.videos_dir / f"{vid_id}.mp4"
        if progress_cb:
            progress_cb(0.88, "جاري توحيد معدل الإطارات (25 FPS) وتأمين جودة الفيديو...")
        meta = normalize_video(
            raw_file,
            norm_path,
            max_height=self.settings.max_video_height,
            target_fps=self.settings.target_fps,
            max_sec=max_sec,
        )

        parsed = parse_match_title(raw_info["title"])
        with SessionLocal() as db:
            existing = db.scalar(select(Match).where(Match.source_video_id == vid_id))
            home_id = _club_id_by_ext(db, parsed["home_ext_id"])
            away_id = _club_id_by_ext(db, parsed["away_ext_id"])
            if existing:
                existing.title = raw_info["title"]
                existing.source_url = raw_info["source_url"]
                existing.channel = raw_info.get("channel")
                existing.competition = competition or existing.competition
                existing.video_path = str(norm_path)
                existing.fps = meta["fps"]
                existing.width = meta["width"]
                existing.height = meta["height"]
                existing.frame_count = meta["frame_count"]
                existing.duration_s = meta["duration_s"]
                existing.status = "downloaded"
                existing.error = None
                db.commit()
                db.refresh(existing)
                return existing

            m = Match(
                title=raw_info["title"],
                source_url=raw_info["source_url"],
                source_video_id=vid_id,
                channel=raw_info.get("channel"),
                competition=competition,
                home_club_id=home_id,
                away_club_id=away_id,
                video_path=str(norm_path),
                fps=meta["fps"],
                width=meta["width"],
                height=meta["height"],
                frame_count=meta["frame_count"],
                duration_s=meta["duration_s"],
                status="downloaded",
            )
            db.add(m)
            db.commit()
            db.refresh(m)
            return m

    def ingest_local_file(
        self,
        src_path: Path,
        title: str,
        competition: str | None = "تحليل محلي خاص",
        home_team_name: str | None = None,
        away_team_name: str | None = None,
        max_sec: int | None = None,
    ) -> Match:
        vid_id = uuid.uuid4().hex[:10]
        dst = self.settings.videos_dir / f"{vid_id}.mp4"
        # First normalize cleanly so FPS and H.264 keyframes lock 1:1 with canvas
        meta = normalize_video(
            src_path,
            dst,
            max_height=self.settings.max_video_height,
            target_fps=self.settings.target_fps,
            max_sec=max_sec,
        )
        parsed = parse_match_title(title)
        with SessionLocal() as db:
            m = Match(
                title=title,
                source_video_id=vid_id,
                competition=competition,
                home_team_name=home_team_name,
                away_team_name=away_team_name,
                home_club_id=_club_id_by_ext(db, parsed["home_ext_id"]),
                away_club_id=_club_id_by_ext(db, parsed["away_ext_id"]),
                video_path=str(dst),
                fps=meta["fps"],
                width=meta["width"],
                height=meta["height"],
                frame_count=meta["frame_count"],
                duration_s=meta["duration_s"],
                status="downloaded",
            )
            db.add(m)
            db.commit()
            db.refresh(m)
            return m
