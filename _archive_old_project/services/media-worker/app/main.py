from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
import os

app = FastAPI(title="ScoutZero Media Worker", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "gpu": settings.gpu_enabled}

@app.on_event("startup")
async def startup():
    for d in [settings.upload_dir, settings.clips_dir, settings.thumbnails_dir]:
        os.makedirs(d, exist_ok=True)
