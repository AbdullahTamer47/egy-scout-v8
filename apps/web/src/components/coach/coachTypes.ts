export type CoachRoleType = "head_coach" | "assistant_coach" | "technical_director" | "team_admin";

export interface CoachProfile {
  tenant_id?: string;
  coach_name: string;
  coach_role: CoachRoleType;
  club_id: string;
  opponent_id: string;
  formation: string;
  updated_at?: string;
}

export interface CoachClubListItem {
  club_id: string;
  name_ar: string;
  name_en: string;
  kit_hex: string;
  stadium_ar?: string;
  city_ar?: string;
  league_id: string;
  season: string;
  source: string;
  player_count: number;
  live_rank?: number | null;
  live_points?: number | null;
  live_played?: number | null;
  logo_url?: string;
  wiki_page?: string;
}

export interface CoachPlayer {
  jersey_number: number;
  name_en: string;
  name_ar: string;
  position: string;
  nationality?: string;
  nationality_flag?: string;
  nationality_ar?: string;
  age?: number | null;
  photo_url?: string | null;
  is_captain?: boolean;
  is_vice_captain?: boolean;
  is_on_loan?: boolean;
  is_starter?: boolean;
  status: "fit" | "rehab" | "injured" | "suspended" | "load_managed";
  readiness_pct: number;
  yellow_cards: number;
  red_cards: number;
  return_date?: string;
  minutes_season?: number;
  contract_until?: string;
  admin_note?: string;
  is_eligible_starter: boolean;
  block_reason_ar?: string;
  block_reason_en?: string;
  warning_ar?: string;
  source?: string;
  live_stats?: {
    appearances?: number | null;
    goals?: number | null;
    assists?: number | null;
    yellow_cards?: number | null;
  };
  assigned_slot?: string;
  assigned_role_ar?: string;
}

export interface CoachClubDetail {
  club_id: string;
  name_ar: string;
  name_en: string;
  kit_hex: string;
  stadium_ar?: string;
  city_ar?: string;
  league_id?: string;
  season?: string;
  source?: string;
  verified_at?: string;
  is_live?: boolean;
  logo_url?: string;
  players: CoachPlayer[];
}

export interface SquadDepthSlot {
  slot: string;
  role_ar: string;
  x_norm: number;
  y_norm: number;
  starter: CoachPlayer | null;
  backups: CoachPlayer[];
}

export interface SquadDepthReport {
  formation_code: string;
  fit_count: number;
  unavailable_count: number;
  total_count: number;
  slots: SquadDepthSlot[];
  unavailable_players: CoachPlayer[];
  shortage_alerts_ar: string[];
}

export interface DrillSetup {
  drill_id: string;
  title_ar: string;
  title_en: string;
  category_ar: string;
  category_en: string;
  pitch_view: "full" | "half" | "corner";
  area_m: string;
  duration_min: number;
  target_rpe: number;
  coaching_points_ar: string[];
  players: Array<{ id: string; team: "a" | "b" | "joker"; label: string; x_m: number; y_m: number; player_name?: string; jersey_number?: number }>;
  props: Array<{ id: string; kind: "cone" | "mini_goal" | "mannequin" | "ball"; x_m: number; y_m: number }>;
  arrows: Array<{ from_x_m: number; from_y_m: number; to_x_m: number; to_y_m: number; kind: "pass" | "run" | "press" }>;
  zones: Array<{ x1_m: number; y1_m: number; x2_m: number; y2_m: number; label: string }>;
}

export interface TrainingSessionPlan {
  session_id: string;
  club_name: string;
  md_code: string;
  title_ar: string;
  title_en: string;
  session_date: string;
  tactical_formation: string;
  focus_ar: string;
  available_players_count: number;
  duration_min: number;
  target_rpe: number;
  srpe_au: number;
  intensity: string;
  intensity_ar: string;
  phases: Array<{ phase: string; title_ar: string; duration_min: number; notes_ar: string }>;
  drill_setup: DrillSetup;
  coaching_points_ar: string[];
}

export interface MatchdaySheetPayload {
  sheet_id?: string;
  club_name_ar: string;
  opponent_name_ar: string;
  formation_code: string;
  match_date: string;
  stadium: string;
  captain_name: string;
  captain_jersey?: number | null;
  starters: CoachPlayer[];
  substitutes: CoachPlayer[];
  excluded: CoachPlayer[];
  admin_timeline: Array<{ offset: string; task_ar: string }>;
}

export interface LiveStandingRow {
  rank: number;
  team_id: string;
  team_name: string;
  team_name_ar: string;
  kit_hex?: string;
  stadium_ar?: string;
  logo_url?: string;
  group?: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  form?: string;
}

export interface LiveFixtureRow {
  event_id: string;
  date_utc: string;
  name: string;
  status: string;
  home_team: string;
  away_team: string;
  home_logo?: string;
  away_logo?: string;
  home_score: string;
  away_score: string;
}

export interface LiveHubPayload {
  league_id: string;
  league_name_ar: string;
  league_name_en: string;
  provider: string;
  source: string;
  is_live: boolean;
  cache_hit: boolean;
  fetched_at_utc: string;
  standings: LiveStandingRow[];
  upcoming_fixtures: LiveFixtureRow[];
  recent_results: LiveFixtureRow[];
}

export interface CoachOverviewPayload {
  profile: CoachProfile | null;
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  formation: string;
  squad_depth: SquadDepthReport;
  matchday_sheet: MatchdaySheetPayload;
  training_sessions: TrainingSessionPlan[];
  weekly_load_safety: { total_weekly_au: number; status: "optimal" | "warning"; warnings_ar: string[] };
  live_hub: LiveHubPayload;
}
