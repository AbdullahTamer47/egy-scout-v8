# ScoutZero - System Architecture & Build Status Document
**المنظومة الاستكشافية والذكاء التكتيكي لنادي كرة قدم مصري**

## System Overview
ScoutZero (Codename: Moneyball-EG) is an internal, self-hosted football scouting and tactical intelligence platform tailored for discovering, evaluating, and shortlisting talent from the Egyptian Premier League, Second Division (Professionals and Regional Groups A/B/C/D), Third Division, and Republic Youth competitions (U17/U19/U21/U23).

---

## Current Status: Phase 0 to Phase 6 Complete ✅
**Last Updated**: October 2026

### 1. What is REAL (الانظمة الحقيقية العاملة بالكامل)
- **Monorepo & Docker Architecture**: `docker-compose.yml` orchestrating PostgreSQL (16), Redis (7), MinIO (S3 compatible), Next.js 14 Web Frontend, and Python FastAPI/Celery Media Worker.
- **Full Database Schema (Drizzle ORM & PostgreSQL)**:
  - 14 tables: `users`, `players`, `teams`, `leagues`, `seasons`, `matches`, `videoAssets`, `events`, `clips`, `evaluations`, `metricSnapshots`, `archetypes`, `shortlists`, `shortlistCandidates`, `activityLog`.
  - Enums for roles (`head_coach`, `scout`, `analyst`, `viewer`), 15 positions, preferred foot, pipeline statuses, event types, and data provenance.
- **Authentication & RBAC (Principle 8)**:
  - Multi-role NextAuth credentials engine with bcrypt hashing.
  - Role-based permissions: Guardian and agent contact details for minors are strictly visible only to Head Coach and Scout.
  - Quick-login presets for all 4 club roles on login screen for fast testing.
- **Internationalization (i18n & RTL)**:
  - Full Arabic (RTL) first-class support and English toggle via `next-intl`.
  - Comprehensive football scouting dictionary in Arabic.
- **Ultra-Dark Tactical Design System**:
  - Base `#0B0F17`, emerald accent `#10B981`, cyan `#06B6D4`, glassmorphism cards, and Bento Grid layout.
- **Proprietary Moneyball Undervalued Index (MUI) Engine (F8)**:
  - Rescaled 0-100 score: $\text{MUI} = (\text{Performance} \times \text{AgeFactor} \times \text{PressureFactor}) / \text{CostDivider}$.
  - Bayesian shrinkage toward group mean ($\mu = 50$) for sample sizes below threshold minutes.
  - Configurable youth curve (higher multipliers for ages 16-21).
  - Safe logarithmic cost divider preventing division by zero or explosion on free transfers.
  - 29/29 unit tests passing (`src/tests/scoring-engine.test.ts`).
- **Tactical DNA & Archetype Matcher (F9)**:
  - Multi-dimensional Cosine Similarity on normalized vectors.
  - Global elite benchmarks: Rodri (Deep-lying Playmaker), N'Golo Kanté (Disruptor), Mohamed Salah (Inverted Winger), Virgil van Dijk (Ball-playing CB), Erling Haaland (Target Striker), Achraf Hakimi (Dynamic Wingback).
  - Multi-player interactive radar overlay (Recharts).
- **Core Scouting Pages**:
  - `/dashboard`: Bento grid executive view with prospect of the week, top 5 MUI leaderboard, and geographic coverage by Egyptian governorates.
  - `/players`: Youth-first database with filters by position, tier, age, foot, U-category, MUI score, and governorate, plus CSV export and manual player creation modal.
  - `/players/[id]`: Deep-dive profile with radar, MUI breakdown, evaluations, and video clips.
  - `/players/compare`: Multi-player side-by-side comparison for up to 4 players.
  - `/recruitment`: Club needs board and 6-stage interactive Kanban pipeline (`Spotted` > `Monitoring` > `Contacted` > `Trial` > `Negotiating` > `Signed`).
  - `/studio`: Video ingestion, interactive timeline player, live telestration overlay (spotlight circle and vector arrow), manual tagging buttons with hotkeys `[P]`, `[T]`, `[D]`, `[B]`, and review queue with hotkeys `[C]` / `[R]`.
  - `/matches`: Processed match catalog and clip statistics.
  - `/reports`: One-click print-ready and PDF-exportable executive scouting dossier.
  - `/settings`: Reference leagues and tiers, external source adapter toggles, and synthetic data reset.

---

### 2. What is HEURISTIC (الأنظمة القائمة على التقدير الإحصائي)
- **Pressure Factor Estimation**: Heuristic weighting combining actions under pressure success rate and composure ratings.
- **Event Spotting Heuristics**: Time-window bounding for progressive passes, tackles, dribbles, and box penetrations before feeding the review queue.
- **Bayesian Prior Shrinkage**: Linear empirical Bayes weighting function shrinking small minutes samples towards league mean (50.0).

---

### 3. What is MOCKED (البيانات التجريبية المعلمة)
- **Synthetic Seed Data (Flagged `SYNTHETIC`)**:
  - ~300 Egyptian players, 30 teams across Premier League, 2nd Division, and 3rd Division, matches, and scouting evaluations.
  - **Removable with one command**: `npm run db:seed -- --clear` or via the reset button in `/settings`.
- **MockDetector**:
  - Labeled `MOCK` in UI for simulated event spotting during demo sessions.
  - Real `YoloByteTrackDetector` structure implemented in `services/media-worker/app/tasks/detection.py` for GPU/CPU video processing.

---

### 4. Non-Negotiable Engineering Principles Verified
1. **Manual Workflow is Core**: Scouts can add players, rate them from mobile stands, tag video events, and manage needs 100% manually without any automation required.
2. **Every Automated Feature has Manual Fallback**: Manual player entry, manual rating, manual event tagging buttons with hotkeys, manual CSV export.
3. **Human in the Loop**: AI-suggested events in `/studio` are saved as `suggested` with confidence; never auto-confirmed into metrics until approved by scout (`[C]` or `[R]`).
4. **Provenance Everywhere**: Every metric displays source (`manual`, `auto`, `imported`, `synthetic`), date, and confidence badge.
5. **Statistical Honesty**: Sample minutes played and confidence levels shown prominently next to every percentile and MUI score.
6. **Minors' Data Privacy**: Sensitive guardian and agent contact information hidden from viewer and analyst roles, strictly reserved for Head Coach and Scout.
