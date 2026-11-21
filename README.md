# EGY-SCOUT V8 ⚽
### Egyptian Premier League AI Tactical Analytics & Fair Scouting Platform

[![Next.js 16](https://img.shields.io/badge/Next.js-16.0-black?style=flat&logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?style=flat&logo=python)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Overview

**EGY-SCOUT V8** is an end-to-end, enterprise-grade AI tactical analytics and talent scouting monorepo tailored for the **Egyptian Premier League (EPL)** and regional competitions. Designed to bridge the gap between computer vision engineering and tactical coaching staff, EGY-SCOUT delivers real-time 60FPS broadcast overlays, calibrated pitch control heatmaps, 3D ball trajectory vectors, counterfactual ("What-If") tactical simulation, and zero-bias scouting metrics.

---

## 🏛️ Monorepo Architecture

```
manger/
├── apps/
│   ├── api/                     # FastAPI ASGI microservice (RBAC, telemetry streams, player crops, DRM)
│   └── web/                     # Next.js 16 App Router UI (Broadcast Studio, QA Sheet, Fair Scouting)
├── packages/
│   ├── shared_contracts/        # Apache Parquet schemas, R2 storage, lineup parser, DB models
│   ├── tactics_engine/          # Pitch control Voronoi/Spearman, counterfactual simulator, playbook
│   ├── scouting_core/           # Zero-bias scouting engine (StatsBomb benchmark vs. raw tracks)
│   └── innovation_lab/          # 2D Kinematic sandbox & set-piece optimizer
├── services/
│   ├── cv_worker/               # Multi-stage CV worker (Referee shield, Jersey OCR, Ball tracker, Re-ID)
│   └── orchestrator/            # 18-chunk map-reduce pipeline & cross-chunk stitcher
├── notebooks/                   # Kaggle / Google Colab L4 & T4 zero-budget inference workflows
├── tests/                       # Complete automated unit and integration test suite
├── tools/                       # Benchmark evaluator & Phase 0 annotator
└── docs/                        # Master plan v8, pitch deck, and architecture specifications
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
