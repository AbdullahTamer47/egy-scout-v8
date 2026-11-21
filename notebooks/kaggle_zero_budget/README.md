# EGY-SCOUT V8 — Zero-Budget GPU Notebook (Wave 0 / Sprint 0.1)

Notebook: [`egy_scout_v8_sprint01_referee_shield.ipynb`](./egy_scout_v8_sprint01_referee_shield.ipynb)

## Supported Free / Low-Cost Runtimes
- **Kaggle Free GPU (NVIDIA T4 / P100 — 30 hrs/week, $0):** Auto-detected, runs `fp16` with `batch_size=32`.
- **Google Colab (NVIDIA L4 via Google AI Pro):** Auto-detected, runs `bf16` with `batch_size=64` and logs peak VRAM & per-stage runtime.
- **Future Wave 1 Migration:** Same `Pluggable Provider` contract switches to `Modal L4` via `EGY_SCOUT_COMPUTE_PROVIDER=modal_l4` without rewriting pipeline logic.

## Outputs Exported
1. `<match_id>_tracking_v8.parquet` — Apache Parquet (Zstd) with frame-by-frame coordinates & 4-layer shield outputs.
2. `<match_id>_summary.json` — `MATCH_TRACK` metadata (for PostgreSQL), role/team counts, runtime & peak VRAM profiling.
3. `<match_id>_frame1250_before_after.jpg` & `<match_id>_investor_before_after.mp4` — Investor-ready side-by-side comparison.
