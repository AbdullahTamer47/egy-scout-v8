# EGY-SCOUT V8 ⚽
### Egyptian Premier League AI Tactical Analytics & Fair Scouting Platform

[![Next.js 16](https://img.shields.io/badge/Next.js-16.0-black?style=flat&logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?style=flat&logo=python)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Overview

**EGY-SCOUT V8** is an end-to-end AI tactical analytics, coaching, and talent scouting platform tailored for the **Egyptian Premier League (2026/27)** alongside Europe's Big 5 leagues (`Premier League`, `LaLiga`, `Bundesliga`, `Serie A`, `Ligue 1`), `UEFA CL`, and `CAF CL`.

### 1. EGY-SCOUT Coach Pro — Standalone Mobile-First App (`coach-pro-app/`)
- **Live Production URL:** https://egy-scout-coach-pro.vercel.app
- Independent mobile-optimized Next.js + FastAPI serverless deployment:
  - Live auto-synced standings, schedules, and squads across Egypt & Europe's Big 5 with official modern HD logos.
  - AI-powered 3-phase tactical workspace (`In Possession`, `Attacking`, `Defense & Recovery`) with pure tactical formations (`3-4-2-1`, `3-2-4-1`, `4-3-3`, `3-5-2`, `4-2-3-1`), smooth multi-phase animation, `5×5..11×11` boards, editable positions/roles, touch pitch controls, training session planner, and matchday squad administration.

### 2. Full Video Analysis Studio — Alpha / Beta (`apps/`, `packages/`, `services/`)
- Broadcast match video upload & CV analysis studio (Alpha / Beta under active development) featuring player & ball tracking, live `2D` tactical radar twin, passing lane `xPass%`, pressing momentum charts, AR telestrator tools (`Spotlight`, `3D Arrow`, `Zone`, `Ghost`), and automated moment tagging.

### 3. Explainer Video Studio Pipeline (`scripts/video_studio/`)
- Automated live-UI capture (`capture_live_clips.mjs`), ElevenLabs `eleven_v4` voiceover synthesis (`generate_vo.py`), and `1920×1080` 30fps Lovio-style stage composition (`scene_stage.html`, `render_videos.mjs`).

---

## 🏛️ Monorepo Architecture

```
manger/
├── coach-pro-app/               # Standalone mobile-first Coach Pro app (deployed on Vercel)
├── apps/
│   ├── api/                     # FastAPI ASGI service (Coach Pro API, telemetry streams, RBAC)
│   └── web/                     # Full Next.js 16 workspace (/ Video Studio Beta + /coach)
├── packages/
│   ├── coach_engine/            # Live Football Data Hub (Big 5 + Egypt), AI Assistant, Training & Admin
│   ├── shared_contracts/        # Config, schemas, lineup parser, storage connectors
│   ├── tactics_engine/          # 3-phase tactical blueprints, counterfactual simulator, xPass/OBV
│   ├── scouting_core/           # Zero-bias scouting metrics & benchmark evaluation
│   └── innovation_lab/          # Kinematic sandbox & set-piece optimizer
├── services/
│   ├── cv_worker/               # CV tracking worker (Jersey OCR, ball tracker, calibration, Re-ID)
│   └── orchestrator/            # Map-reduce video analysis pipeline
├── scripts/
│   └── video_studio/            # Automated live capture, VO generation & 1080p video renderer
├── notebooks/                   # Colab/Kaggle inference notebooks
├── tests/                       # Automated unit and integration test suite
└── docs/                        # Architecture briefs and roadmaps
```

---

## 🚀 Key Features

### 1. 60FPS Broadcast Studio & Tactical Canvas
- **Temporal EMA & One-Euro Smoothing:** Zero-jitter player tracking with sub-millisecond interpolation.
- **Perspective 3D Ground Rings:** Projected perspective ellipses (`ry = rx * 0.32`) under player feet.
- **True Green-Turf Chroma Occlusion:** Dynamic pixel mask ensuring graphical overlays stay on the pitch grass under players' legs and boots.
- **Dynamic Ball Comet & Reticle:** Pitch-to-screen Jacobian matrix (`j_mat`) compensating for camera pan/tilt illusion.

### 2. Counterfactual "What-If" Simulator
- Real-time tactical re-simulation: drag any defender to observe instantaneous recalculations of Expected Goals (`xG`) and pitch control dominance.
- Dynamic 25-point grid search providing automated optimal defender positioning.

### 3. Fair Talent Scouting Engine
- Normalized per-90 metrics comparing emerging regional talent directly against benchmark datasets.
- Track filtering to eliminate noisy, short camera fragments and highlight verified profiles.

### 4. 2-Minute QA Sheet
- High-resolution padded crops (20% margin) with role classification (`حكم ساحة`, `حكم مساعد`, `حارس مرمى`, `لاعب`).
- Automated detection confidence metrics and scoreboard dual-lock validation.

---

## 🛠️ Quickstart

### Prerequisites
- Python 3.10+
- Node.js 18+ & npm
- FFmpeg (for video processing)

### 1. Backend Service
```bash
# Set environment variables
$env:EGY_SCOUT_DATA_DIR = "D:\egy-scout-data"

# Run FastAPI API server
python -m uvicorn apps.api.main:app --host 127.0.0.1 --port 8080
```

### 2. Frontend Web Application
```bash
cd apps/web
npm install
npm run build
npm run start -- -p 3000
```

### 3. Run Automated Tests
```bash
# Python test suite
python -m unittest discover -s tests -p "test_*.py" -v

# Web typecheck
cd apps/web
npx tsc --noEmit
```

---

## 📄 License
This project is licensed under the MIT License.
