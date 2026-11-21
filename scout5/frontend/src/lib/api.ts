export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface TeamKit {
  family?: string;
  label_ar?: string;
  ring?: string;
  primary?: string;
  rgb?: [number, number, number];
  hex?: string;
}

export interface CalibrationReport {
  processed_frames: number;
  wide_frames: number;
  calibrated_frames: number;
  keyframe_solves: number;
  propagated_frames: number;
  wide_cal_coverage_pct: number;
  median_rep_err_px: number | null;
  ball_detected_frames: number;
  ball_calibrated_frames: number;
}

export interface IdentityDiagnostics {
  method?: string;
  face_recognition_note_ar?: string;
  total_raw_tracks?: number;
  stitched_identities?: number;
  portraits_extracted?: number;
  closeup_faces_detected?: number;
  jersey_ocr_hits?: number;
}

export type IdentityStatus = "confirmed_manual" | "confirmed_ocr" | "auto_lineup" | "unidentified";

export interface BoundPlayerInfo {
  link_id?: number;
  player_id: number;
  name: string;
  club_name: string;
  division: string;
  position: string;
  jersey_number: number | null;
  age: number | null;
  market_value_egp: number;
  notes?: string | null;
  identity_status?: IdentityStatus;
  status_label_ar?: string;
}

export interface PlayerScorecard {
  overall_score: number;
  physical_score: number;
  workrate_score: number;
  tactical_space_score: number;
  progression_score: number;
}

export interface PlayerMistake {
  type: string;
  severity: "high" | "medium" | "low";
  time_s: number | null;
  frame_id: number | null;
  title_ar: string;
  detail_ar: string;
  coaching_fix_ar?: string;
}

export interface PlayerStrength {
  type: string;
  time_s: number | null;
  frame_id: number | null;
  title_ar: string;
  detail_ar: string;
}

export interface CompatibilityItem {
  code: string;
  name_ar: string;
  fit_pct: number;
  verdict_ar: string;
  tier: "elite" | "conditional" | "mismatch";
  reasons: string[];
}

export interface CompatibilityMatrix {
  archetype_ar: string;
  archetype_en: string;
  best_formation: string;
  best_formation_pct: number;
  worst_formation: string;
  worst_formation_pct: number;
  best_system: string;
  best_system_pct: number;
  strengths_ar: string[];
  watchouts_ar: string[];
  formations: CompatibilityItem[];
  systems: CompatibilityItem[];
}

export interface PlayerPortfolio {
  identity_key: string;
  track_id: number;
  shot_id: number;
  source_track_ids: number[];
  n_tracklets_merged: number;
  n_shots: number;
  role: string;
  inferred_role_code: string;
  inferred_role_ar: string;
  team_id: number;
  jersey_ocr: number | null;
  jersey_ocr_conf: number;
  portrait_url: string | null;
  portrait_type: string;
  face_px_est: number;
  n_cal_frames: number;
  n_kin_steps: number;
  seconds_tracked: number;
  sample_reliability_ar: string;
  distance_m: number;
  distance_per_min_m: number;
  hir_distance_m: number;
  sprint_distance_m: number;
  sprint_count: number;
  max_speed_kmh: number;
  peak_speed_kmh: number;
  avg_speed_kmh: number;
  mean_x_m: number;
  mean_y_m: number;
  roaming_m: number;
  avg_voronoi_m2: number;
  ball_carrier_frames: number;
  line_breaking_options: number;
  scorecard: PlayerScorecard;
  heatmap_12x8: number[][];
  speed_series: { t: number; kmh: number }[];
  scouting_profile: Record<string, number>;
  compatibility: CompatibilityMatrix;
  match_strengths?: PlayerStrength[];
  match_mistakes?: PlayerMistake[];
  highlights_count?: number;
  mistakes_count?: number;
  coaching_fix_ar?: string;
  display_name?: string;
  display_jersey?: number | null;
  identity_status?: IdentityStatus;
  status_label_ar?: string;
  bound_player?: BoundPlayerInfo;
  auto_player?: BoundPlayerInfo;
}

export interface MatchSequence {
  id: string;
  sequence_type: "goal" | "box_entry" | "defensive_breakdown" | "dangerous_counter" | "big_chance";
  title_ar: string;
  time_s: number;
  start_time_s: number;
  frame_id: number;
  attacking_team_id: number;
  attacking_team_name: string;
  defending_team_id: number;
  defending_team_name: string;
  xg_estimate: number;
  distance_to_goal_m: number;
  blocking_defenders: number;
  stages: { step: number; label_ar: string; detail_ar: string }[];
  attacking_heroes: { identity_key: string; name: string; role_ar: string; reason_ar: string; identity_status?: IdentityStatus }[];
  defensive_faults: { identity_key: string; name: string; role_ar: string; fault_ar: string; fix_ar: string; identity_status?: IdentityStatus }[];
  ball_path_m: [number, number][];
  gap_segment_m: [[number, number], [number, number]] | null;
  key_players_m: { team_id: number; x_m: number; y_m: number; identity_key: string }[];
}

export interface ForensicsResponse {
  match_slug: string;
  team_names: Record<string, string>;
  team_kits: Record<string, TeamKit>;
  sequences: MatchSequence[];
  player_audits: {
    identity_key: string;
    team_id: number;
    team_name: string;
    display_name: string;
    display_jersey: number | null;
    identity_status: IdentityStatus;
    status_label_ar: string;
    inferred_role_ar: string;
    portrait_url: string | null;
    overall_score: number;
    mistakes_count: number;
    highlights_count: number;
    match_strengths: PlayerStrength[];
    match_mistakes: PlayerMistake[];
    coaching_fix_ar: string;
  }[];
  totals: {
    sequences_count: number;
    total_mistakes_flagged: number;
    total_highlights_flagged: number;
  };
}

export interface LineupResponse {
  match_slug: string;
  confirmed_count: number;
  auto_matched_count: number;
  teams: Record<
    string,
    {
      team_name: string;
      kit: TeamKit;
      squad_roster: {
        id: number;
        name: string;
        position: string;
        jersey_number: number | null;
        age: number | null;
      }[];
      identities: {
        identity_key: string;
        portrait_url: string | null;
        inferred_role_code: string;
        inferred_role_ar: string;
        jersey_ocr: number | null;
        n_cal_frames: number;
        overall_score: number;
        display_name: string;
        display_jersey: number | null;
        identity_status: IdentityStatus;
        status_label_ar: string;
        matched_player_id: number | null;
      }[];
    }
  >;
}

export interface TimelineEvent {
  type: "sprint" | "line_breaking_pass" | "defensive_gap" | "possession_shift";
  frame_id: number;
  time_s: number;
  team_id: number;
  identity_key?: string;
  value?: number;
  label_ar: string;
}

export interface MatchSummary {
  version?: string;
  fps: number;
  calibration: CalibrationReport;
  possession: {
    n_ball_cal_frames: number;
    team_0_frames: number;
    team_1_frames: number;
    team_0_pct: number | null;
    team_1_pct: number | null;
  };
  pitch_control?: {
    n_frames: number;
    team_0_pct: number | null;
    team_1_pct: number | null;
  };
  identity_diagnostics?: IdentityDiagnostics;
  teams: Record<
    string,
    {
      kit: TeamKit;
      attack_dir: number;
      formation: string | null;
      n_formation_frames: number;
      n_geom_frames: number;
      avg_width_m: number | null;
      avg_length_m: number | null;
      avg_def_line_m: number | null;
      avg_voronoi_pct?: number | null;
    }
  >;
  timeline_events?: TimelineEvent[];
  key_sequences?: MatchSequence[];
  player_portfolios?: PlayerPortfolio[];
  tracked_players: PlayerPortfolio[];
  bound_players?: Record<string, BoundPlayerInfo>;
  resolved_identities?: Record<string, BoundPlayerInfo>;
}

export interface MatchItem {
  id: number;
  slug: string;
  title: string;
  competition?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  home_team_cluster?: number | null;
  fps: number;
  width: number;
  height: number;
  duration_s: number;
  frame_count: number;
  status: string;
  cal_coverage_pct: number;
  median_rep_err_px: number | null;
  ball_calibrated_frames: number;
  video_url: string;
  audit_grid_url: string;
  summary?: MatchSummary | null;
}

export interface FramePlayer {
  track_id: number;
  identity_key?: string;
  role: string;
  team_id: number;
  u_norm: number;
  v_norm: number;
  x1_norm: number;
  y1_norm: number;
  x2_norm: number;
  y2_norm: number;
  x_m: number | null;
  y_m: number | null;
  vx_ms?: number;
  vy_ms?: number;
  speed_kmh?: number;
  jersey_ocr?: number | null;
  inferred_role_code?: string | null;
  overall_score?: number | null;
  bound_name?: string | null;
  bound_jersey?: number | null;
  identity_status?: IdentityStatus;
  on_pitch: boolean;
}

export interface PassingLane {
  target_track_id: number;
  target_identity_key?: string;
  from_m: [number, number];
  to_m: [number, number];
  from_uv: [number, number];
  to_uv: [number, number];
  distance_m: number;
  clearance_m: number;
  opponents_bypassed: number;
  xpass_pct?: number;
  status: string;
}

export interface VoronoiCell {
  team_id: number;
  identity_key: string;
  track_id: number;
  area_m2: number;
  poly_m: [number, number][];
}

export interface DefensiveGap {
  team_id: number;
  gap_m: number;
  from_m: [number, number];
  to_m: [number, number];
  from_uv: [number, number];
  to_uv: [number, number];
}

export interface FrameFormation {
  formation: string | null;
  n_players: number;
  width_m: number;
  length_m: number;
  def_line_m: number;
  def_line_x_m?: number;
  def_wall_m?: [number, number][];
  def_wall_uv?: [number, number][];
  hull_m?: [number, number][];
  hull_uv?: [number, number][];
  bands_uv: Record<string, [number, number][]>;
}

export interface TelemetryFrame {
  frame_id: number;
  time_s: number;
  shot_id: number;
  is_wide: boolean;
  cal_src: "keypoints" | "propagated" | "none";
  cal_err_px: number | null;
  kp_count: number;
  h_inv_norm: number[][] | null;
  camera_fov_m: [number, number][];
  poss_team: number | null;
  ball_carrier_track_id: number | null;
  ball_carrier_identity?: string | null;
  formations: Record<string, FrameFormation>;
  passing_lanes: PassingLane[];
  voronoi_cells?: VoronoiCell[];
  pitch_control?: Record<string, number>;
  defensive_gaps?: DefensiveGap[];
  players: FramePlayer[];
  ball: {
    u_norm: number;
    v_norm: number;
    x_m: number | null;
    y_m: number | null;
    conf: number;
  } | null;
}

export interface TelemetryResponse {
  slug: string;
  meta: { fps: number; width: number; height: number; total_video_frames: number; stride: number };
  team_kits: Record<string, TeamKit>;
  calibration: CalibrationReport;
  timeline_events?: TimelineEvent[];
  bound_players?: Record<string, BoundPlayerInfo>;
  frames: TelemetryFrame[];
}

export interface SeedPlayer {
  id: number;
  name: string;
  club_name: string;
  division: string;
  position: string;
  position_family: string;
  jersey_number: number | null;
  age: number | null;
  preferred_foot?: string | null;
  market_value_eur: number;
  market_value_egp: number;
  overall_rating: number;
  video_matches_count?: number;
  scouting_profile: Record<string, number>;
}

export interface DbPlayerPortfolio extends SeedPlayer {
  club_id?: number | null;
  height_cm?: number | null;
  nationality?: string | null;
  moneyball_index: number;
  acquisition_verdict_ar: string;
  acquisition_tier: "strong_buy" | "ready" | "prospect" | "monitor";
  compatibility: CompatibilityMatrix;
  linked_video_matches: {
    match_slug: string;
    identity_key: string;
    jersey_number: number | null;
    overall_score: number | null;
    max_speed_kmh: number | null;
    distance_m: number | null;
    avg_voronoi_m2: number | null;
    portrait_url: string | null;
    notes: string | null;
  }[];
}

export interface TacticalBrief {
  match_slug: string;
  headline_ar: string;
  executive_summary_ar: string;
  kpis: {
    home_name: string;
    away_name: string;
    home_formation: string | null;
    away_formation: string | null;
    home_poss_pct: number | null;
    away_poss_pct: number | null;
    home_voronoi_pct: number | null;
    away_voronoi_pct: number | null;
    defensive_gaps_count: number;
    line_breaking_lanes_count: number;
    high_sprints_count: number;
    cal_err_px: number | null;
    cal_coverage_pct: number | null;
  };
  vulnerabilities: {
    severity: "high" | "medium";
    team_name: string;
    title_ar: string;
    detail_ar: string;
    time_s?: number;
    frame_id?: number;
  }[];
  recommendations: {
    category: string;
    target_team: string;
    title_ar: string;
    action_ar: string;
    suggested_formation: string;
  }[];
  standout_players: {
    identity_key: string;
    display_name?: string;
    team_id: number;
    team_name: string;
    inferred_role_ar: string;
    jersey_ocr: number | null;
    portrait_url: string | null;
    overall_score: number;
    max_speed_kmh: number;
    distance_m: number;
    avg_voronoi_m2: number;
    archetype_ar: string;
    best_formation: string;
    sample_reliability_ar: string;
    mistakes_count?: number;
    highlights_count?: number;
  }[];
  recruitment_memo: {
    id: number;
    name: string;
    club_name: string;
    division: string;
    position: string;
    age: number | null;
    market_value_eur: number;
    market_value_egp: number;
    overall_rating: number;
    archetype_ar: string;
    best_formation: string;
    best_formation_pct: number;
  }[];
}
