from ..celery_app import celery_app
from ..config import settings
import subprocess
import os
import json
import logging

logger = logging.getLogger(__name__)

@celery_app.task(bind=True, name="video.ingest")
def ingest_video(self, url: str, match_id: str, quality: str = "best"):
    """Download video from URL using yt-dlp"""
    self.update_state(state="RUNNING", meta={"progress": 0, "stage": "downloading"})
    output_path = os.path.join(settings.upload_dir, f"{match_id}.mp4")
    
    cmd = [
        "yt-dlp",
        "-f", f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]" if quality != "best" else "bestvideo+bestaudio/best",
        "--merge-output-format", "mp4",
        "-o", output_path,
        "--no-playlist",
        "--socket-timeout", "30",
        url
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
        if result.returncode != 0:
            raise Exception(f"yt-dlp failed: {result.stderr}")
        
        # Extract metadata
        meta_cmd = ["yt-dlp", "--dump-json", "--no-download", url]
        meta_result = subprocess.run(meta_cmd, capture_output=True, text=True, timeout=60)
        metadata = json.loads(meta_result.stdout) if meta_result.returncode == 0 else {}
        
        # Generate thumbnail
        thumb_path = os.path.join(settings.thumbnails_dir, f"{match_id}_thumb.jpg")
        subprocess.run([
            "ffmpeg", "-i", output_path, "-ss", "00:00:30",
            "-vframes", "1", "-q:v", "2", thumb_path, "-y"
        ], capture_output=True, timeout=60)
        
        return {
            "status": "done",
            "path": output_path,
            "thumbnail": thumb_path,
            "duration": metadata.get("duration"),
            "title": metadata.get("title"),
            "match_id": match_id
        }
    except Exception as e:
        logger.error(f"Ingest failed for {url}: {e}")
        raise self.retry(exc=e)


@celery_app.task(bind=True, name="video.clip")
def generate_clip(self, video_path: str, event_id: str, start_time: float, end_time: float, pre_roll: float = 3.0, post_roll: float = 3.0):
    """Cut a clip from video for a tagged event"""
    self.update_state(state="RUNNING", meta={"progress": 0, "stage": "clipping"})
    
    clip_start = max(0, start_time - pre_roll)
    clip_end = end_time + post_roll
    output_path = os.path.join(settings.clips_dir, f"clip_{event_id}.mp4")
    thumb_path = os.path.join(settings.thumbnails_dir, f"clip_{event_id}_thumb.jpg")
    
    try:
        # Cut clip
        subprocess.run([
            "ffmpeg", "-i", video_path,
            "-ss", str(clip_start), "-to", str(clip_end),
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            output_path, "-y"
        ], capture_output=True, check=True, timeout=120)
        
        # Generate thumbnail at midpoint
        mid = (clip_end - clip_start) / 2
        subprocess.run([
            "ffmpeg", "-i", output_path, "-ss", str(mid),
            "-vframes", "1", "-q:v", "2", thumb_path, "-y"
        ], capture_output=True, timeout=30)
        
        return {
            "status": "done",
            "clip_path": output_path,
            "thumbnail_path": thumb_path,
            "event_id": event_id,
            "duration": clip_end - clip_start
        }
    except Exception as e:
        logger.error(f"Clip generation failed for event {event_id}: {e}")
        raise self.retry(exc=e)
