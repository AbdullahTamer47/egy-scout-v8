export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      msg = err.detail || err.message || msg;
    } catch {
      /* ignore json error */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface MatchListItem {
  id: number;
  title: string;
  source_url?: string | null;
  competition?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  home_club_id?: number | null;
  away_club_id?: number | null;
  home_team_cluster?: number | null;
  fps: number;
  width: number;
  height: number;
  duration_s: number;
  frame_count: number;
  status: string;
  has_pitch_coords: boolean;
  pitch_coverage: number;
  error?: string | null;
  created_at?: string | null;
  video_url?: string | null;
}

export interface TrackedPlayerRow {
  id: number;
  identity_key: string;
  player_id?: number | null;
  player_name: string;
  position?: string | null;
  team_cluster: number;
  jersey_number?: number | null;
  role: string;
  minutes_tracked: number;
  total_distance_m: number;
  distance_per_min_m: number;
  max_speed_kmh: number;
  avg_speed_kmh: number;
  hir_distance_m: number;
  sprint_distance_m: number;
  sprint_count: number;
  passes: number;
  passes_completed: number;
  progressive_passes: number;
  line_breaking_passes: number;
  progressive_carries: number;
  xt_generated: number;
  pressing_actions: number;
  recoveries: number;
  avg_space_m2?: number | null;
  avg_attacking_space_m2?: number | null;
  space_created_m2?: number | null;
  offball_runs: number;
  tactical_deviation_m?: number | null;
  fluidity_score?: number | null;
  discipline_score?: number | null;
  roaming_radius_m?: number | null;
  avg_time_on_ball_sec?: number | null;
  tactical_role_ar?: string | null;
  scout_score?: number | null;
  score_breakdown?: Record<string, number> | null;
  verdict?: string | null;
}

export interface TimelineTag {
  category: "line_breaking" | "positive_transition" | "defensive_gap" | "high_recovery";
  label_ar: string;
  time_s: number;
  team_cluster: number;
  detail: string;
}

export interface TeamKitPalette {
  family: string;
  label_ar: string;
  ring: string;
  primary: string;
  hex: string;
  rgb?: number[];
}

export interface TelemetryPlayer {
  track_id: number;
  identity_key: string;
  player_name?: string | null;
  team_cluster: number;
  jersey_number?: number | null;
  role: string;
  u_norm: number;
  v_norm: number;
  x1_norm: number;
  y1_norm: number;
  x2_norm: number;
  y2_norm: number;
  x_m: number;
  y_m: number;
  vx: number;
  vy: number;
  speed_kmh: number;
  voronoi_m2?: number | null;
}

export interface PassingLane {
  target_track_id: number;
  from_m: [number, number];
  to_m: [number, number];
  from_uv?: [number, number];
  to_uv?: [number, number];
  distance_m: number;
  xpass_pct: number;
  xt_gain: number;
  opponents_bypassed: number;
  is_line_breaking: boolean;
  status: "line_breaking" | "safe_open" | "blocked";
}

export interface CoverShadow {
  polygon_m: [number, number][];
}

export interface VoronoiPoly {
  team_cluster: number;
  points_m: [number, number][];
}

export interface FrameFormation {
  formation_str: string;
  lines: [number, number][][];
  lines_uv?: [number, number][][];
  def_line_sync_std: number;
  team_width_m: number;
  team_length_m: number;
}

export interface FrameGamePhase {
  phase: string;
  phase_ar: string;
  block_code: string;
  block_ar: string;
  centroid_depth_m: number;
  rest_defense_players: number;
  rest_defense_width_m: number;
}

export interface TelemetryFrame {
  frame_id: number;
  time_s: number;
  is_tactical_wide?: boolean;
  camera_fov_m?: [number, number][];
  h_inv?: number[] | null;
  poss_team?: number | null;
  ball_carrier_track_id: number;
  game_phase: Record<string, FrameGamePhase>;
  formations: Record<string, FrameFormation>;
  gaps_gt_16m: {
    line_index: number;
    from_m: [number, number];
    to_m: [number, number];
    from_uv?: [number, number];
    to_uv?: [number, number];
    distance_m: number;
    team_cluster: number;
  }[];
  passing_lanes: PassingLane[];
  cover_shadows: CoverShadow[];
  voronoi_polys: VoronoiPoly[];
  players: TelemetryPlayer[];
  ball?: { u_norm: number; v_norm: number; x_m: number; y_m: number } | null;
}

export interface ProCoachTeamMetrics {
  xg_estimated: number;
  xt_total: number;
  ppda: number;
  field_tilt_pct: number;
  avg_def_line_height_m: number;
  compactness_area_m2: number;
  passes_total: number;
  passes_completed: number;
  pass_accuracy_pct: number;
  progressive_passes: number;
  line_breaking_passes: number;
  progressive_carries: number;
  pressing_actions: number;
  high_recoveries: number;
}

export interface PassingNetworkNode {
  identity_key: string;
  player_name: string;
  jersey_number?: number | null;
  avg_x_m: number;
  avg_y_m: number;
  passes: number;
  xt_generated: number;
  scout_score?: number | null;
}

export interface PassingNetworkLink {
  source: string;
  target: string;
  count: number;
  progressive_count: number;
  avg_xt: number;
}

export interface PassingNetworkData {
  nodes: PassingNetworkNode[];
  links: PassingNetworkLink[];
}

export interface ZoneControlCell {
  col: number;
  row: number;
  x0_m: number;
  x1_m: number;
  y0_m: number;
  y1_m: number;
  label_ar: string;
  is_zone_14: boolean;
  team_0_pct: number;
  team_1_pct: number;
}

export interface CoachDrill {
  title: string;
  duration_min: number;
  target_group: string;
  description: string;
}

export interface CoachReportTeam {
  strengths_ar: string[];
  weaknesses_ar: string[];
  in_game_adjustments_ar: string[];
  weekly_drills_ar: CoachDrill[];
}

export interface MatchDetail extends MatchListItem {
  summary: {
    possession?: Record<string, number>;
    team_kits?: Record<string, TeamKitPalette>;
    teams?: Record<
      string,
      {
        possession_pct: number;
        formation: string;
        in_possession_formation: string;
        out_of_possession_formation: string;
        def_line_sync_std: number;
        team_width_m: number;
        team_length_m: number;
        fluidity_score: number;
        discipline_score: number;
        role_shifts?: { identity_key: string; role: string; label_ar: string }[];
      }
    >;
    pro_coach_metrics?: Record<string, ProCoachTeamMetrics>;
    passing_network?: Record<string, PassingNetworkData>;
    zone_control_18?: ZoneControlCell[];
    coach_report?: Record<string, CoachReportTeam>;
    egyptian_doctor?: {
      effective_play_time_pct: number;
      pass_tempo_per_min: number;
      avg_time_on_ball_sec: number;
      slow_releasers: { identity_key: string; avg_hold_sec: number }[];
      second_ball_win_rate: {
        team_0_pct: number;
        team_1_pct: number;
        contested_zones: { x_m: number; y_m: number; team_cluster: number; time_s: number }[];
      };
      fatigue_dropoff_index: number;
      fatigue_alerts: { identity_key: string; team_cluster: number; early_kmh: number; late_kmh: number; drop_pct: number }[];
      low_block_breaker: Record<
        string,
        {
          opp_low_block_pct: number;
          opp_mid_block_pct?: number;
          opp_high_press_pct?: number;
          left_half_space_open_pct: number;
          central_open_pct: number;
          right_half_space_open_pct: number;
          recommended_overload_ar: string;
        }
      >;
      recommendations_ar: string[];
    };
    timeline_tags?: TimelineTag[];
  };
  players: TrackedPlayerRow[];
}

export interface ClubOption {
  id: number;
  name: string;
  external_id?: string | null;
  division?: string | null;
  league_name?: string | null;
}

export interface ClubSquadPlayerRow {
  id: number;
  name: string;
  position: string;
  jersey_number?: number | null;
  age?: number | null;
  preferred_foot?: string | null;
  market_value_eur: number;
  market_value_egp: number;
  overall_rating: number;
  style_fit_pct: number;
  scouting_profile: Record<string, number>;
}

export interface ClubStartingXISlot extends ClubSquadPlayerRow {
  slot_idx: number;
  slot_code: string;
  slot_label_ar: string;
  x_m: number;
  y_m: number;
}

export interface ClubTransferTarget {
  id: number;
  name: string;
  club_name: string;
  division: string;
  position: string;
  target_slot_ar: string;
  replaces_player: string;
  age?: number | null;
  market_value_eur: number;
  market_value_egp: number;
  style_fit_pct: number;
  fit_upgrade_pct: number;
}

export interface ClubSquadAnalysis {
  club: { id: number; name: string; division: string; league_name: string };
  style: string;
  avg_style_fit_pct: number;
  squad: ClubSquadPlayerRow[];
  starting_xi: ClubStartingXISlot[];
  weakest_positions: string[];
  weakest_slots: ClubStartingXISlot[];
  transfer_targets: ClubTransferTarget[];
}

export interface TelemetryResponse {
  match_id: number;
  fps: number;
  width: number;
  height: number;
  frame_count: number;
  has_pitch_coords: boolean;
  team_kits?: Record<string, TeamKitPalette>;
  frames: TelemetryFrame[];
}

export interface JobItem {
  id: number;
  match_id?: number | null;
  kind: string;
  status: string;
  progress: number;
  message?: string | null;
  result?: Record<string, unknown> | null;
}

export interface SeedPlayer {
  id: number;
  name: string;
  club_id?: number | null;
  club_name: string;
  division: string;
  league_name: string;
  position: string;
  position_family: string;
  jersey_number?: number | null;
  age?: number | null;
  height_cm?: number | null;
  preferred_foot?: string | null;
  market_value_eur: number;
  market_value_egp: number;
  overall_rating: number;
  scouting_profile: Record<string, number>;
}

