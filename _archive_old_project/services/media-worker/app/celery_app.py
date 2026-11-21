from celery import Celery
from .config import settings

celery_app = Celery(
    "scoutzero",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks.video", "app.tasks.detection"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Africa/Cairo",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_retry_delay=30,
    task_max_retries=3,
)
