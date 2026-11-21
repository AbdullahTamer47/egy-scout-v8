-- EGY-SCOUT V8 Production Multi-Tenant PostgreSQL + TimescaleDB + RLS Schema (Section 18.3)
-- Note: Frame-by-frame tracking coordinates are stored ONLY in Apache Parquet (Cloudflare R2).
-- MATCH_TRACK stores track-level metadata ONLY.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS club (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    tier            TEXT NOT NULL DEFAULT 'pro',
    logo_uri        TEXT,
    primary_color   TEXT DEFAULT '#10B981',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_user (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    email           TEXT UNIQUE NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('coach', 'analyst', 'scout', 'board', 'player')),
    locale          TEXT NOT NULL DEFAULT 'ar',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    match_slug      TEXT NOT NULL,
    match_format    TEXT NOT NULL DEFAULT '11v11',
    age_group       TEXT NOT NULL DEFAULT 'senior',
    team_a_name     TEXT NOT NULL,
    team_b_name     TEXT NOT NULL,
    hls_manifest_uri TEXT,
    parquet_uri     TEXT,
    calibration_mode TEXT NOT NULL DEFAULT 'pnlcalib',
    auto_face_blur  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (club_id, match_slug)
);

CREATE TABLE IF NOT EXISTS player (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    full_name       TEXT NOT NULL,
    position        TEXT,
    birth_year      INT,
    external_id     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_lineup (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    player_id       UUID REFERENCES player(id),
    team_side       TEXT NOT NULL CHECK (team_side IN ('team_a', 'team_b')),
    jersey_number   SMALLINT NOT NULL,
    player_name     TEXT NOT NULL,
    is_starter      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Metadata-ONLY track table (NO frame-by-frame coordinates!)
CREATE TABLE IF NOT EXISTS match_track (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    track_id        INT NOT NULL,
    player_id       UUID REFERENCES player(id),
    role            TEXT NOT NULL,
    team            TEXT NOT NULL,
    role_conf       REAL NOT NULL,
    team_conf       REAL NOT NULL,
    first_frame     INT NOT NULL,
    last_frame      INT NOT NULL,
    frame_count     INT NOT NULL,
    jersey_number   SMALLINT,
    jersey_conf     REAL DEFAULT 0.0,
    parquet_uri     TEXT NOT NULL,
    UNIQUE (match_id, track_id)
);

CREATE TABLE IF NOT EXISTS match_event (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    frame_id        INT NOT NULL,
    time_s          REAL NOT NULL,
    team            TEXT NOT NULL,
    confidence      REAL NOT NULL,
    verified_scoreboard BOOLEAN NOT NULL DEFAULT FALSE,
    metadata_json   JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS goal_forensic (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    event_id        UUID REFERENCES match_event(id) ON DELETE CASCADE,
    start_s         REAL NOT NULL,
    end_s           REAL NOT NULL,
    xg              REAL,
    psxg            REAL,
    breakdown_code  TEXT,
    summary_json    JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS player_match_metrics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    player_id       UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    minutes_played  REAL NOT NULL,
    vaep_per90      REAL,
    xt_per90        REAL,
    padj_def_per90  REAL,
    hir_m_per90     REAL,
    rating_10       REAL,
    data_source     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scout_shortlist (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    player_id       UUID NOT NULL REFERENCES player(id) ON DELETE CASCADE,
    budget_tier     TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_clip_evidence (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    club_id         UUID NOT NULL REFERENCES club(id) ON DELETE CASCADE,
    match_id        UUID NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    event_id        UUID REFERENCES match_event(id) ON DELETE SET NULL,
    player_id       UUID REFERENCES player(id) ON DELETE SET NULL,
    start_s         REAL NOT NULL,
    end_s           REAL NOT NULL,
    clip_uri        TEXT NOT NULL,
    metric_proof    TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    club_id         UUID NOT NULL,
    actor_role      TEXT NOT NULL,
    action          TEXT NOT NULL,
    resource        TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-Level Security (Strict Multi-Tenant Club Isolation)
ALTER TABLE match ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_track ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE player ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_shortlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_match ON match
    USING (club_id::text = current_setting('app.current_club_id', true));
CREATE POLICY tenant_isolation_track ON match_track
    USING (club_id::text = current_setting('app.current_club_id', true));
CREATE POLICY tenant_isolation_event ON match_event
    USING (club_id::text = current_setting('app.current_club_id', true));
CREATE POLICY tenant_isolation_player ON player
    USING (club_id::text = current_setting('app.current_club_id', true));
CREATE POLICY tenant_isolation_shortlist ON scout_shortlist
    USING (club_id::text = current_setting('app.current_club_id', true));
