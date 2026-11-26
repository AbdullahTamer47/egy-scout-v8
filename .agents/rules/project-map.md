---
trigger: model_decision
description: Lightweight architecture map of D:\manger (EGY-SCOUT V8 Full Monorepo Waves 0-5) — read first to locate backend/frontend/CV/orchestrator directories, entry points, and exact verification commands.
---

# Project Map (`D:\manger`)

## Active EGY-SCOUT Pro Studio Architecture
- **Plan & Decisions:** `docs/PLAN_PRO_STUDIO_10.md`, `docs/KNOWN_LIMITS.md`.
- **One-Click Local Launch:** `start_egy_scout.bat` (auto venv/node/build/port-cleanup) + `start_investor_demo.ps1`.
- **Shared Contracts & Infra (`packages/shared_contracts/`):**
  - `config.py`, `schemas.py` (`Apache Parquet Zstd` + metadata-only `MATCH_TRACK`), `providers.py` (`local/kaggle/colab/modal_l4`), `match_setup.py` (`11v11..5v5`, `4-Point Homography`), `lineup_connector.py` (Scoresheet Parser + API-Football), `r2_storage.py` (Cloudflare R2 + HMAC Video DRM), `db_schema.sql` (PostgreSQL + TimescaleDB + RLS).
- **CV Worker & Orchestrator (`services/`):**
  - `services/orchestrator/chunk_pipeline.py`: 18-Chunk Map-Reduce + Cross-Chunk Re-ID Stitcher.
  - `services/cv_worker/cloud_cv_engine.py` & `modal_gpu_app.py`: Cloud-First CV (`Groq Cloud Vision qwen/qwen3.8-27b` multi-crop voting + `224x272` Lanczos4 contact-sheet OCR with 429 retry/chunking, scoreboard OCR, `Roboflow Serverless GPU`, and `Modal NVIDIA L4` remote worker) with SSRF guard + lightweight edge fallback.
  - `services/cv_worker/stages/`: `referee_shield.py` (4-Layer Shield + unpromoted candidate rescue to `player` + GK Box + Cap `<= 4` + Smoothing `<= 36 km/h`), `one_euro.py` (dtype-safe 1-Euro smoothing), `pitch_calib.py` (centered 2D SVD penalty-box homography + LK optical flow fallback), `jersey_ocr.py`, `reid_embedder.py`, `ball_tracker.py`, `events_spotting.py`.
  - `services/cv_worker/local_pipeline.py`: Unified Cloud-First + calibrated local refinement (`_learn_team_color_protos`, `<25`-frame homography propagation, `YOLO 960px conf=0.18` missed-player recovery, upper-72% multi-crop Groq OCR) with club kit RGB clustering (`resolve_team_cluster_mapping`) and zero fake `u/w` coordinate fallback.
  - `services/cv_worker/lazy_engines/`: `event_pose.py` (`±2s` + `75px` Resolution Gate), `video_export.py` (GOP HLS `keyint=15` + Watermarked/Face-Blurred H.264 `yuv420p` AR Broadcast MP4 renderer with double ground rings, passing lanes, carrier spotlight & 2D FIFA radar minimap).
- **Intelligence Packages (`packages/`):**
  - `scouting_core/`: `input_gate.py`, `fair_engine.py` (EPL 2025/26 reference pool, zero mixed WC2022), `player_card.py` (homography-drift stabilization, biomechanical accel cap `5.5 m/s²`, sustained `1.0s` rolling-window top speed `<= 34.5 km/h`, goal-line GK promotion & relative team lines `m>=7`, `<=22` consolidated tracks, Gold/Silver/Bronze data-confidence tier, strict `>=300s` gate on `0–99` match percentiles & `m/min` work rate).
  - `tactics_engine/`: `playbook.py`, `counterfactual.py` (calibrated open-play xG without 24m distance floor), `matchup_optimizer.py`, `moment_analyzer.py` (any-formation parser `433/3-4-2-1/3-2-4-1`, Hungarian `scipy.optimize.linear_sum_assignment` natural-position roster matching, adaptive 5-link passing network + `xPass %` & `+OBV`, Alonso/Pep/Klopp/Inzaghi masterclasses), `event_models.py` (real ball detections only, stint consolidation), `plan_validator.py`.
  - `datasets/rosters/`: `clubs_2025_26.json` (verified EPL & Egyptian Premier League positional squads) & `epl_2025_26_scouting_reference.csv`.
  - `innovation_lab/kinematic_sandbox.py`: 2D Kinematic Sandbox + Set-Piece Self-Play Optimizer.
- **API & Web Studio (`apps/`):**
  - `apps/api/`: `main.py`, `routes_pro.py` (includes `POST /render-ar-video`, `GET /rendered-ar-video`), `routes_v9.py`, `routes_players.py` (`/players` filtering `<3s` short fragments into `short_tracks_count`, `/card`, `/identity-candidates`, `/identity` 1-click assignment, `POST /reanalyze-online`, `/photo` GET/POST/DELETE/fetch-photo + `club_portrait` MediaWiki cache, `/batch-photos`, `/rosters`, `/import-roster`, `/plans/pass-probabilities`, `/api/compute/status|config`, `/api/chat/models`), `service.py` (strict Zero-Fake identity: `ocr_verified` requires `jersey_conf >= 0.70` + role match, timeline `x_m/y_m` inside-gap interpolation `<=12` frames, zero spatial guessing), `storage_db.py`, `rbac.py`.
  - `apps/web/`: Next.js 16 + TypeScript (`Cairo` RTL/LTR, Mobile `390x844` PWA `manifest.json`) — 4-tab navigation (`studio`, `players`, `quick`, `accuracy`): `BroadcastStudioScreen.tsx` (`arDensity="all"` default with `>=2` timeline interpolation, closest-center `<canvas>` player hit-testing, passing lanes, backline chain, 2D FIFA radar minimap & Online H.264 AR Render toggle), `FormationBlueprintBoard.tsx` (compact `xPass %` canvas pills + passing lanes legend), `PlayersScreen.tsx` (1-click `"Assign Player"` candidate picker & short-track footer), `PlayerCard.tsx` (EA FC 25 scalloped-crown shield, diagonal gold/silver/bronze foil shards, chest-up portrait cutouts, 6-column horizontal stat strip, Flag+League+Club badges only when verified, `1080x1560` & `420x604` Canvas export `playerCardPng.ts`), `CompetitorBenchmarkModal.tsx`, `FairScoutingScreen.tsx`, `QuickAnalysisScreen.tsx`, `AccuracyProofScreen.tsx`, `EstimateBadge.tsx`.
- **Verification & Tests (`tests/`, `scripts/`):**
  - `tests/`: `test_sprint01.py`, `test_wave0_full.py`, `test_waves_1_to_5.py`, `test_player_card.py` (**42 tests total**).
  - `scripts/verify.ps1`: Full verification runner (compileall + unittest + `tsc` + `npm run build`).
  - `scripts/rebuild_all_matches_v108.py`: Full 5-match parquet rebuild with `YOLO 960px` player recovery, `ZeroRefereeLeakShield` rescue, and online `Groq Cloud Vision` OCR.
  - `scripts/prefetch_club_portraits.py`: Batch MediaWiki `pageimages` club portrait prefetcher (`36/84` cached in `D:\egy-scout-data\cache\club_portraits\`).

## Exact Verification Commands (PowerShell 5.1 — no `&&`)
- **All-in-one verification:** `Set-Location "D:\manger"; & ".\scripts\verify.ps1"`
- **Python full suite (42 tests):** `Set-Location "D:\manger"; & "D:\manger\egy-tactical-scout\backend\venv\Scripts\python.exe" -m compileall -q packages services tools apps/api tests; if ($LASTEXITCODE -eq 0) { & "D:\manger\egy-tactical-scout\backend\venv\Scripts\python.exe" -m unittest discover -s tests -p "test_*.py" -v }`
- **Web typecheck + build:** `Set-Location "D:\manger\apps\web"; npx tsc --noEmit; if ($LASTEXITCODE -eq 0) { npm run build }`
