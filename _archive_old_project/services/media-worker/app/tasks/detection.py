from ..celery_app import celery_app
from ..config import settings
import logging
from typing import Protocol, Any
import numpy as np

logger = logging.getLogger(__name__)


class Detector(Protocol):
    """Detector interface: detect(frames) -> boxes, track(boxes) -> tracks, spot(tracks, frames) -> suggested events"""
    def detect(self, frames: list[np.ndarray]) -> list[dict]: ...
    def track(self, detections: list[dict]) -> list[dict]: ...
    def spot(self, tracks: list[dict], frames: list[np.ndarray]) -> list[dict]: ...


class MockDetector:
    """MOCK detector for demo purposes. Generates synthetic events. Labeled MOCK in UI."""
    
    def detect(self, frames: list[np.ndarray]) -> list[dict]:
        import random
        return [
            {"frame_idx": i, "boxes": [{"x": random.randint(100, 1800), "y": random.randint(100, 900), "w": 40, "h": 80, "confidence": round(random.uniform(0.6, 0.95), 2), "class": "player"} for _ in range(random.randint(5, 15))]}
            for i in range(0, len(frames), max(1, settings.frame_skip_cpu))
        ]
    
    def track(self, detections: list[dict]) -> list[dict]:
        tracks = []
        for i, det in enumerate(detections):
            for j, box in enumerate(det.get("boxes", [])):
                tracks.append({"track_id": j, "frame_idx": det["frame_idx"], **box})
        return tracks
    
    def spot(self, tracks: list[dict], frames: list[np.ndarray]) -> list[dict]:
        import random
        event_types = ["progressive_pass", "interception", "dribble_under_pressure", "box_entry", "shot", "tackle"]
        events = []
        total_frames = len(frames)
        fps = 25
        
        for _ in range(random.randint(3, 8)):
            frame_idx = random.randint(0, max(0, total_frames - 50))
            events.append({
                "type": random.choice(event_types),
                "start_time": round(frame_idx / fps, 2),
                "end_time": round((frame_idx + random.randint(25, 75)) / fps, 2),
                "confidence": round(random.uniform(0.4, 0.85), 2),
                "source": "auto",
                "status": "suggested",
                "detector": "MOCK",
                "track_id": random.randint(0, 14)
            })
        return events


class YoloByteTrackDetector:
    """Real detector using YOLOv8 + ByteTrack. GPU optional, CPU fallback with frame skipping."""
    
    def __init__(self):
        self._model = None
    
    def _load_model(self):
        if self._model is None:
            try:
                from ultralytics import YOLO
                self._model = YOLO(settings.yolo_model)
                logger.info(f"Loaded YOLO model: {settings.yolo_model}")
            except Exception as e:
                logger.error(f"Failed to load YOLO model: {e}")
                raise
        return self._model
    
    def detect(self, frames: list[np.ndarray]) -> list[dict]:
        model = self._load_model()
        results = []
        skip = 1 if settings.gpu_enabled else settings.frame_skip_cpu
        
        for i in range(0, len(frames), skip):
            preds = model(frames[i], verbose=False, classes=[0])  # class 0 = person
            boxes = []
            for box in preds[0].boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                boxes.append({
                    "x": int(x1), "y": int(y1),
                    "w": int(x2 - x1), "h": int(y2 - y1),
                    "confidence": round(float(box.conf[0]), 3),
                    "class": "player"
                })
            results.append({"frame_idx": i, "boxes": boxes})
        return results
    
    def track(self, detections: list[dict]) -> list[dict]:
        # ByteTrack integration - placeholder for Phase 5
        tracks = []
        for det in detections:
            for j, box in enumerate(det.get("boxes", [])):
                tracks.append({"track_id": j, "frame_idx": det["frame_idx"], **box})
        return tracks
    
    def spot(self, tracks: list[dict], frames: list[np.ndarray]) -> list[dict]:
        # Heuristic event spotting - placeholder for Phase 5
        return []


def get_detector(use_mock: bool = False) -> Detector:
    if use_mock:
        logger.info("Using MOCK detector")
        return MockDetector()
    try:
        det = YoloByteTrackDetector()
        det._load_model()
        return det
    except Exception:
        logger.warning("YOLO not available, falling back to MOCK detector")
        return MockDetector()


@celery_app.task(bind=True, name="detection.run")
def run_detection(self, video_path: str, match_id: str, use_mock: bool = True):
    """Run detection pipeline on a video"""
    import cv2
    
    self.update_state(state="RUNNING", meta={"progress": 0, "stage": "loading_video"})
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise Exception(f"Cannot open video: {video_path}")
    
    frames = []
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame)
        if len(frames) % 100 == 0:
            self.update_state(state="RUNNING", meta={"progress": int(len(frames)/total*30), "stage": "reading_frames"})
    cap.release()
    
    detector = get_detector(use_mock=use_mock)
    
    self.update_state(state="RUNNING", meta={"progress": 30, "stage": "detecting"})
    detections = detector.detect(frames)
    
    self.update_state(state="RUNNING", meta={"progress": 60, "stage": "tracking"})
    tracks = detector.track(detections)
    
    self.update_state(state="RUNNING", meta={"progress": 80, "stage": "spotting_events"})
    events = detector.spot(tracks, frames)
    
    return {
        "status": "done",
        "match_id": match_id,
        "total_frames": total,
        "fps": fps,
        "detections_count": len(detections),
        "tracks_count": len(tracks),
        "suggested_events": events,
        "detector_type": "MOCK" if use_mock else "YoloByteTrack"
    }
