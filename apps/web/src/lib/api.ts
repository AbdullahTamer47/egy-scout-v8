export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080";

export type UserRole = "coach" | "analyst" | "scout" | "board" | "player";

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  tenantId = "club_demo_egypt",
  role: UserRole = "analyst"
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("X-Tenant-Id", tenantId);
  headers.set("X-User-Role", role);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return res.json() as Promise<T>;
}

export function frameImageUrl(
  matchId: string,
  frameId: number,
  highlightTrack?: number
): string {
  const base = `${API_BASE}/api/matches/${encodeURIComponent(matchId)}/frame/${frameId}/image`;
  return highlightTrack !== undefined
    ? `${base}?highlight_track=${encodeURIComponent(String(highlightTrack))}`
    : base;
}

export function trackCropUrl(matchId: string, trackId: number): string {
  return `${API_BASE}/api/matches/${encodeURIComponent(matchId)}/track/${trackId}/crop`;
}

export function matchVideoUrl(matchId: string): string {
  return `${API_BASE}/api/matches/${encodeURIComponent(matchId)}/video`;
}

export interface DetectionRow {
  track_id: number;
  display_id?: string;
  base_track_id?: number;
  shot_id?: number;
  role: string;
  team: string;
  jersey_number?: number | null;
  verified_name?: string | null;
  verified?: boolean;
  role_conf: number;
  team_conf: number;
  bbox: [number, number, number, number];
  x_m: number | null;
  y_m: number | null;
  on_pitch: boolean;
  reason_ar: string;
  reason_en: string;
}

export interface KitColors {
  team_a_hex: string;
  team_b_hex: string;
}

export interface BeforeAfterPayload {
  match_id: string;
  team_a_name: string;
  team_b_name: string;
  team_a_name_ar?: string;
  team_b_name_ar?: string;
  kit_colors: KitColors;
  frame_id: number;
  available_frames: number[];
  before: {
    detections: DetectionRow[];
    referees_in_frame: number;
    track_role_stability_pct: number;
  };
  after: {
    detections: DetectionRow[];
    referees_in_frame: number;
    unique_official_tracks: number;
    unassigned_filtered_tracks: number;
    goalkeepers_in_frame: number;
    track_role_stability_pct: number;
  };
  max_speed_cap_kmh: number;
  match_tracks_count: number;
}

export interface QASheetTrack {
  track_id: number;
  display_id?: string;
  base_track_id?: number;
  shot_id?: number;
  role: string;
  team: string;
  team_name_ar?: string;
  kit_hex?: string;
  role_conf: number;
  frame_count: number;
  observed_s?: number;
  first_frame: number;
  in_current_frame?: boolean;
  in_active_shot?: boolean;
  x_m?: number | null;
  y_m?: number | null;
  bbox_in_frame?: [number, number, number, number] | null;
  jersey_number: number | null;
  verified_name: string | null;
  verified: boolean;
  crop_url: string;
}

export interface PositioningAnalysisPayload {
  match_id: string;
  frame_id: number;
  has_verified_goal: boolean;
  analysis_title_ar: string;
  analysis_title_en: string;
  kit_colors: KitColors;
  attacking_team: string;
  defending_team: string;
  attack_goal_x?: number;
  team_a_attacks_right?: boolean;
  direction_source?: string;
  ball_xy: [number, number];
  players: Array<{
    track_id: number;
    role: string;
    team: string;
    x_m: number;
    y_m: number;
    bbox: [number, number, number, number];
    vx_ms: number;
    vy_ms: number;
  }>;
  pitch_control: {
    nx: number;
    ny: number;
    overall_control_pct: number;
    box_control_pct: number;
    grid: number[][];
  };
  shot_xg: {
    xg: number;
    distance_m: number;
    goal_angle_deg: number;
    blockers_in_cone: number;
  };
  diagnoses: Array<{
    code: string;
    severity: string;
    title_ar: string;
    title_en: string;
    evidence_ar: string;
    evidence_en: string;
    options: Array<{
      style: string;
      title_ar: string;
      title_en: string;
      action_ar: string;
      action_en: string;
      risk_ar: string;
      risk_en: string;
    }>;
  }>;
  suggested_ghost_move: {
    target_track_id: number;
    dx_m: number;
    dy_m: number;
    before_box_control_pct: number;
    after_box_control_pct: number;
    before_xg: number;
    after_xg: number;
    delta_xg: number;
  } | null;
}

export interface ScoutingPlayer {
  player_id: string;
  display_name: string;
  team_name: string;
  position: string;
  archetype_en: string;
  archetype_ar: string;
  data_source: string;
  minutes_analyzed: number;
  observed_seconds: number;
  observed_frames: number;
  sample_confidence: string;
  rating_10: number | null;
  rating_status_ar: string;
  rating_status_en: string;
  in_frame_distance_m: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  active_movements: number;
  vaep_per90: number | null;
  xt_per90: number | null;
  team_xt_share_pct: number | null;
  padj_defensive_actions_per90: number | null;
  hir_distance_m_per90: number | null;
  positional_discipline_score: number;
  league_translation_pct?: number;
  evidence_clips: Array<{
    clip_id: string;
    match_id: string;
    frame_id: number;
    start_s: number;
    end_s: number;
    kind: string;
    title_ar: string;
    title_en: string;
    metric_proof: string;
    track_id?: number;
  }>;
}

export interface TimelineTrack {
  track_id: number;
  role: string;
  team: string;
  x_m: number;
  y_m: number;
  vx_ms?: number;
  vy_ms?: number;
  speed_kmh?: number;
  verified_name?: string | null;
  jersey_number?: number | null;
  bbox: [number, number, number, number];
}

export interface TimelineBall {
  x_m: number;
  y_m: number;
  z_m: number;
  u: number | null;
  v: number | null;
  vx_ms: number;
  vy_ms: number;
  vx_px?: number;
  vy_px?: number;
  j_mat?: [number, number, number, number];
  inpainted: boolean;
}

export interface TimelineFrame {
  frame_id: number;
  time_s: number;
  calibrated: boolean;
  ball?: TimelineBall | null;
  ball_carrier_id?: number | null;
  possession_team?: string;
  momentum?: number;
  players: TimelineTrack[];
}

export interface TimelinePayload {
  match_id: string;
  team_a_name?: string;
  team_b_name?: string;
  fps: number;
  t_start: number;
  t_end: number;
  kit_colors?: KitColors;
  team_a_attacks_right?: boolean;
  team_a_goal_x?: number;
  team_b_goal_x?: number;
  direction_source?: string;
  frames: TimelineFrame[];
}

export interface MatchListItem {
  match_id: string;
  team_a_name: string;
  team_b_name: string;
  team_a_name_ar?: string;
  team_b_name_ar?: string;
  title_ar?: string;
  kit_colors?: KitColors;
  fps: number;
  has_video: boolean;
  has_telemetry: boolean;
  spotlight_frame?: number | null;
  is_custom?: boolean;
}

export interface MatchBenchmarkPayload {
  match_id: string;
  legacy_official_tracks: number;
  v8_official_tracks: number;
  official_leakage_reduction_pct: number;
  legacy_role_stability_pct: number;
  v8_role_stability_pct: number;
  total_frames: number;
  calibrated_frames: number;
  ball_raw_detections: number;
  ball_clean_detections: number;
  ball_kalman_coverage_pct: number;
  max_observed_speed_kmh: number;
  max_speed_cap_kmh: number;
  speed_cap_compliant: boolean;
  goalkeepers_count?: number;
  jerseys_detected_count?: number;
  team_a_attacks_right: boolean;
  team_a_goal_x: number;
  team_b_goal_x: number;
  direction_source: string;
}

export interface MomentsAndBriefPayload {
  match_id: string;
  verified_goals: Array<Record<string, unknown>>;
  scoreboard_latest?: string | null;
  events: Array<{
    frame_id: number;
    time_s: number;
    event_type: string;
    moment_phase: string;
    team: string;
    track_id: number | null;
    title_ar: string;
    title_en: string;
    metric_proof: string;
  }>;
  pose_assessments: Array<{
    track_id: number;
    frame_id: number;
    bbox_height_px: number;
    torso_orientation: string;
    torso_angle_deg: number;
    head_scanning_enabled: boolean;
    head_scan_count: number | null;
    gate_note: string;
    pose_engine?: string;
  }>;
  coach_brief: Array<{
    id: string;
    title_ar: string;
    title_en: string;
    detail_ar: string;
    detail_en: string;
  }>;
  metrics: {
    calibrated_frames?: number;
    team_a_possession_pct?: number;
    avg_compactness_m?: number;
    events_detected?: number;
  };
}

export interface ShortlistItem {
  player_id: string;
  display_name: string;
  team_name: string;
  position: string;
  rating_10: number | null;
  league_translation_pct?: number | null;
  status: string;
  note: string;
}

export interface BenchStatePayload {
  match_id: string;
  match_format: string;
  age_group: string;
  rolling_subs: boolean;
  red_cards_team_a: number;
  red_cards_team_b: number;
  active_cap_team_a: number;
  active_cap_team_b: number;
  on_pitch: { team_a: string[]; team_b: string[] };
  bench: { team_a: string[]; team_b: string[] };
  events: Array<{
    type: string;
    team: string;
    minute: number;
    player_out?: string;
    player_in?: string;
    player_id?: string;
    new_cap?: number;
  }>;
}

export interface RosterPlayer {
  jersey_number: number;
  name: string;
  is_starter?: boolean;
  is_captain?: boolean;
  position: string;
  team?: string;
}

export interface TeamFormationLine {
  line_type: "backline" | "midfield" | "attack";
  label_ar: string;
  count: number;
  mean_x_m: number;
  max_lateral_gap_m: number;
  points: Array<{
    track_id: number;
    x_m: number;
    y_m: number;
    label: string;
    jersey_number?: number | null;
    speed_kmh: number;
  }>;
}

export interface LiveTeamFormation {
  team: string;
  detected_shape: string;
  inferred_full_formation: string;
  visible_outfield_count: number;
  width_m: number;
  depth_m: number;
  compactness_m2: number;
  defensive_line_x_m: number;
  line_gap_def_mid_m: number;
  line_gap_mid_att_m: number;
  lines: TeamFormationLine[];
  convex_hull: Array<{ x_m: number; y_m: number }>;
}

export interface PassingChannelItem {
  from_x_m: number;
  from_y_m: number;
  to_x_m: number;
  to_y_m: number;
  target_track_id: number;
  target_label: string;
  distance_m: number;
  lane_clearance_m: number;
  progressive_gain_m: number;
  is_blocked: boolean;
  blocker_track_id: number | null;
  quality_score: number;
}

export interface TacticalCorrectionArrow {
  track_id: number;
  team: string;
  player_label: string;
  action_type: string;
  label_ar: string;
  from_x_m: number;
  from_y_m: number;
  to_x_m: number;
  to_y_m: number;
  delta_m: number;
  urgency: "critical" | "high" | "medium";
}

export interface PlayerMomentState {
  track_id: number;
  player_label: string;
  team: string;
  team_name: string;
  role: string;
  jersey_number?: number | null;
  x_m: number;
  y_m: number;
  opt_x_m: number;
  opt_y_m: number;
  speed_kmh: number;
  dist_to_ball_m: number;
  dist_to_nearest_opponent_m: number;
  dist_to_nearest_teammate_m: number;
  zone_ar: string;
  status_tag: string;
  severity_score: number;
  did_ar: string;
  did_not_ar: string;
  where_and_why_ar: string;
}

export interface MomentStatePayload {
  match_id: string;
  team_a_name: string;
  team_b_name: string;
  team_a_name_ar: string;
  team_b_name_ar: string;
  kit_colors: KitColors;
  attack_goal_x: number;
  moment_summary: {
    frame_id: number;
    time_s: number;
    ball_x_m: number;
    ball_y_m: number;
    ball_zone_ar: string;
    attacking_team: string;
    defending_team: string;
    attacking_team_name: string;
    defending_team_name: string;
    attacking_formation_live: string;
    defending_formation_live: string;
    attacking_pitch_control_pct: number;
    shot_xg_before: number;
    shot_xg_after_correction: number;
    risk_reduction_if_corrected_pct: number;
    open_passing_channels_count: number;
    headline_did_ar: string;
    headline_did_not_ar: string;
    headline_where_and_why_ar: string;
    focal_player: PlayerMomentState | null;
    team_a_focal_player?: PlayerMomentState | null;
    team_b_focal_player?: PlayerMomentState | null;
  };
  formations: Record<string, LiveTeamFormation>;
  passing_channels: PassingChannelItem[];
  correction_arrows: TacticalCorrectionArrow[];
  player_states: PlayerMomentState[];
}

export interface BlueprintNode {
  team?: string;
  slot: string;
  role_ar: string;
  player_label: string;
  track_id: number | null;
  jersey_number: number | null;
  x_m: number;
  y_m: number;
  move_to_x_m: number;
  move_to_y_m: number;
  duty_ar: string;
}

export interface BlueprintLine {
  team?: string;
  line_type: string;
  label_ar: string;
  points: Array<{ slot: string; x_m: number; y_m: number }>;
}

export interface BlueprintPassingArrow {
  team?: string;
  from_slot?: string;
  to_slot?: string;
  from_x_m: number;
  from_y_m: number;
  to_x_m: number;
  to_y_m: number;
  kind?: "run" | "pass" | "press" | "freehand";
  color?: string;
  label_ar: string;
}

export interface BlueprintCustomZone {
  x1_m: number;
  y1_m: number;
  x2_m: number;
  y2_m: number;
  color?: string;
  label_ar: string;
}

export interface FormationBlueprintPayload {
  match_id: string;
  team: string;
  kit_colors: KitColors;
  formation_code: string;
  opponent_formation_code?: string;
  title_ar: string;
  philosophy_ar: string;
  team_name: string;
  opponent_name: string;
  tactical_mode: string;
  opponent_tactical_mode?: string;
  ai_provider?: string;
  nodes: BlueprintNode[];
  lines: BlueprintLine[];
  passing_arrows?: BlueprintPassingArrow[];
  opponent_nodes?: BlueprintNode[];
  opponent_lines?: BlueprintLine[];
  opponent_passing_arrows?: BlueprintPassingArrow[];
  custom_arrows?: BlueprintPassingArrow[];
  custom_zones?: BlueprintCustomZone[];
  tactical_zones: Array<{
    zone_id: string;
    label_ar: string;
    x1_m: number;
    y1_m: number;
    x2_m: number;
    y2_m: number;
  }>;
  execution_steps_ar: string[];
  math_validation?: MathValidationResult;
}

export interface TacticalChatResponse {
  match_id: string;
  frame_id: number;
  time_s: number;
  engine: string;
  has_external_api_key: boolean;
  question: string;
  answer_ar: string;
  moment_summary: MomentStatePayload["moment_summary"];
  ai_drawing_blueprint?: FormationBlueprintPayload | null;
  structured_cards: Array<Record<string, unknown>>;
  suggested_actions: Array<{
    action: string;
    track_id?: number;
    formation_code?: string;
    layer?: string;
    time_s?: number;
    label_ar: string;
  }>;
  follow_up_questions: string[];
}

export interface MatchupPlanPayload {
  recommended_formations: Array<{
    formation: string;
    fit_score: number;
    style_ar: string;
    style_en: string;
    counters_matched?: string[];
  }>;
  starting_xi?: Array<{
    player_id: string;
    display_name: string;
    position: string;
    rating_10: number;
    archetype_ar: string;
  }>;
  synergy_pairs?: Array<{
    pair: [string, string];
    combined_xt_per90: number;
    note_ar: string;
    note_en: string;
  }>;
  substitution_plan?: Array<{
    minute: number;
    player_in: string;
    reason_ar: string;
    reason_en: string;
  }>;
}

export interface ScoutingResponse {
  match_id: string;
  input_gate: {
    mode: string;
    duration_s: number;
    warning_ar: string;
    warning_en: string;
  };
  video_tracks: ScoutingPlayer[];
  benchmark_source_badge_ar: string;
  benchmark_source_badge_en: string;
  benchmark_players: ScoutingPlayer[];
}

export interface Phase0EvalPayload {
  available: boolean;
  verified_human_gt?: boolean;
  match_id: string;
  annotated_frames?: number;
  total_prelabels?: number;
  verified_persons?: number;
  active_learning_queue_size?: number;
  before?: {
    referee_accuracy?: number;
    referee_leakage_rate?: number;
    team_accuracy?: number;
    track_role_stability: number;
    official_tracks?: number;
    goalkeeper_tracks?: number;
    total_tracks?: number;
    gate_referee_pass?: boolean;
    gate_team_pass?: boolean;
  };
  after?: {
    referee_accuracy?: number;
    referee_leakage_rate?: number;
    team_accuracy?: number;
    track_role_stability: number;
    official_tracks?: number;
    goalkeeper_tracks?: number;
    total_tracks?: number;
    gate_referee_pass?: boolean;
    gate_team_pass?: boolean;
  };
}

export interface OpponentDossierPayload {
  match_id: string;
  team_a_name: string;
  team_b_name: string;
  grounded_source: string;
  summary_ar: string;
  summary_en: string;
  vulnerabilities: PositioningAnalysisPayload["diagnoses"];
  attacking_patterns: MomentsAndBriefPayload["events"];
  defensive_transitions: MomentsAndBriefPayload["events"];
  coach_brief: MomentsAndBriefPayload["coach_brief"];
  scoreboard_latest?: string | null;
  verified_goals: Array<Record<string, unknown>>;
}

export interface PlayerDossierPayload {
  player: ScoutingPlayer;
  is_video_track: boolean;
  rating_breakdown: Array<{
    metric: string;
    weight_pct: number;
    score_10: number;
    raw: string;
  }>;
  strengths_ar: string[];
  strengths_en: string[];
  watchouts_ar: string[];
  watchouts_en: string[];
  evidence_clips: ScoutingPlayer["evidence_clips"];
}

export type WorkspaceMode = "coach" | "analyst" | "scout";

export interface MathValidationResult {
  overall_balance_score: number;
  rest_defense_score: number;
  half_spaces_score: number;
  rest_defenders_count: number;
  attacking_players_count: number;
  vertical_length_m: number;
  horizontal_width_m: number;
  corridors: Array<{
    id: string;
    label_ar: string;
    label_en: string;
    count: number;
    status: "overload" | "covered" | "empty";
  }>;
  strengths_ar: string[];
  strengths_en: string[];
  vulnerabilities_ar: string[];
  vulnerabilities_en: string[];
  risk_level: "low" | "medium" | "high";
}

export interface ClipTagItem {
  id: string;
  match_id: string;
  category: string;
  label_ar: string;
  label_en: string;
  time_s: number;
  start_s: number;
  end_s: number;
  playlist_name: string;
  player_label: string;
  note: string;
  created_at?: string;
}

export interface HeadToHeadComparisonPayload {
  match_id: string;
  players: Array<{
    player_id: string;
    display_name: string;
    team_name: string;
    position: string;
    archetype_ar: string;
    rating_10: number | null;
    minutes_analyzed: number;
    sample_confidence: string;
    radar: {
      attack_impact: number;
      progression_xt: number;
      defensive_work: number;
      physical_hir: number;
      tactical_discipline: number;
    };
    metrics: {
      vaep_per90: number | null;
      xt_per90: number | null;
      padj_def_per90: number | null;
      hir_m_per90: number | null;
      max_speed_kmh: number;
      discipline: number;
    };
    evidence_clips: ScoutingPlayer["evidence_clips"];
  }>;
  fairness_note_ar: string;
  fairness_note_en: string;
}

export interface MultiMatchTrendsPayload {
  total_matches_in_archive: number;
  player_progression: Array<{
    player_name: string;
    matches_count: number;
    sample_warning_ar: string;
    series: Array<{
      match_id: string;
      match_title_ar: string;
      max_speed_kmh: number;
      avg_speed_kmh: number;
      discipline: number;
      observed_s: number;
      confidence: string;
    }>;
  }>;
  opponent_scouting: Array<{
    opponent_name: string;
    matches_analyzed: number;
    total_observed_s: number;
    sample_warning_ar: string;
    avg_box_control_conceded_pct: number;
    recurring_vulnerabilities_ar: string[];
    coach_focus_points_ar: string[];
  }>;
}
