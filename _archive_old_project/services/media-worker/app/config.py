from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "scoutzero"
    upload_dir: str = "/tmp/scoutzero/uploads"
    clips_dir: str = "/tmp/scoutzero/clips"
    thumbnails_dir: str = "/tmp/scoutzero/thumbnails"
    gpu_enabled: bool = False
    yolo_model: str = "yolov8n.pt"
    frame_skip_cpu: int = 5
    
    class Config:
        env_file = ".env"

settings = Settings()
