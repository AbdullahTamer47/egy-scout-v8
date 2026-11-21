---
trigger: model_decision
description: Lightweight architecture map of D:\manger (EGY-SCOUT V8 Full Monorepo Waves 0-5) — read first to locate backend/frontend/CV/orchestrator directories, entry points, and exact verification commands.
---

# Project Map (`D:\manger`)

## Active EGY-SCOUT V8 Architecture (`docs/master_plan_v8.md`)
- **Frozen Master Plan:** `docs/master_plan_v8.md` (Sections 1–21).
- **One-Click Local Launch:** `start_investor_demo.ps1` + `.env.example`.
- **Shared Contracts & Infra (`packages/shared_contracts/`):**
  - `config.py`, `schemas.py` (`Apache Parquet Zstd` + metadata-only `MATCH_TRACK`), `providers.py` (`local/kaggle/colab/modal_l4`), `match_setup.py` (`11v11..5v5`, `4-Point Homography`), `lineup_connector.py` (Scoresheet Parser + API-Football), `r2_storage.py` (Cloudflare R2 + HMAC Video DRM), `db_schema.sql` (PostgreSQL + TimescaleDB + RLS).
- **CV Worker & Orchestrator (`services/`):**
  - `services/orchestrator/chunk_pipeline.py`: 18-Chunk Map-Reduce + Cross-Chunk Re-ID Stitcher.
  - `services/cv_worker/stages/`: `referee_shield.py` (4-Layer Shield + GK Box + Cap `<= 4` + Smoothing `<= 36 km/h`), `jersey_ocr.py` (Legibility Gate + PARSeq + Voting), `reid_embedder.py`, `ball_tracker.py` (SAHI + Kalman + 3D Ball Arc), `events_spotting.py` (Shot/Replay Gatekeeper + Scoreboard Dual-Lock).
  - `services/cv_worker/lazy_engines/`: `event_pose.py` (`±2s` + `75px` Resolution Gate), `video_export.py` (GOP HLS `keyint=15` + Watermarked/Face-Blurred MP4).
- **Intelligence Packages (`packages/`):**
  - `scouting_core/`: `input_gate.py`, `fair_engine.py` (StatsBomb Open Data CSV separated from raw video tracks).
  - `tactics_engine/`: `playbook.py`, `counterfactual.py`, `matchup_optimizer.py`.
  - `innovation_lab/kinematic_sandbox.py`: Wave 5 2D Kinematic Sandbox + Set-Piece Self-Play Optimizer (`250ms` human realism).
- **API & Web Studio (`apps/`):**
  - `apps/api/`: `main.py`, `routes_pro.py`, `service.py`, `rbac.py` (`Board` Read-Only, HTTP 206 Video, Player Crops, White-Label Report, DRM Token), `Dockerfile`.
  - `apps/web/`: Next.js 16 + TypeScript (`Cairo` RTL/LTR) — `AccuracyProofScreen.tsx`, `BroadcastStudioScreen.tsx` (60FPS One-Euro + GPU Turf Occlusion + SkyPad), `FairScoutingScreen.tsx`, `QuickAnalysisScreen.tsx`.
- **Phase 0 & Cloud GPU Notebooks:**
  - `tools/phase0_annotator/`, `tools/benchmark_evaluator/`.
  - `notebooks/kaggle_zero_budget/egy_scout_v8_colab_l4_full.ipynb` (Colab L4/T4: SigLIP + PARSeq + Parquet export) & `egy_scout_v8_sprint01_referee_shield.ipynb`.
- **Tests (`tests/`):** `test_sprint01.py`, `test_wave0_full.py`, `test_waves_1_to_5.py`.

## Exact Verification Commands (PowerShell 5.1 — no `&&`)
- **Python full suite (18 tests):** `Set-Location "D:\manger"; & "D:\manger\egy-tactical-scout\backend\venv\Scripts\python.exe" -m compileall -q packages services tools apps/api tests; if ($LASTEXITCODE -eq 0) { & "D:\manger\egy-tactical-scout\backend\venv\Scripts\python.exe" -m unittest discover -s tests -p "test_*.py" -v }`
- **Web typecheck + build:** `Set-Location "D:\manger\apps\web"; npx tsc --noEmit; if ($LASTEXITCODE -eq 0) { npm run build }`
