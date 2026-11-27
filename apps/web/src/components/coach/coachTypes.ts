import { BlueprintCustomZone, BlueprintNode, BlueprintPassingArrow, MathValidationResult } from "@/lib/api";

export type CoachRoleType = "head_coach" | "assistant_coach" | "technical_director" | "team_admin";
export type TacticalPhaseId = "possession" | "attack" | "defense";

export interface CoachProfile {
  tenant_id?: string;
  coach_name: string;
  coach_role: CoachRoleType;
  club_id: string;
  opponent_id: string;
  formation: string;
  league_id?: string;
  opponent_league_id?: string;
  updated_at?: string;
}

export const COACH_LEAGUES: Array<{ id: string; ar: string; en: string; logo: string }> = [
  { id: "egy.1", ar: "الدوري المصري", en: "Egypt EPL", logo: "https://imagecache.365scores.com/image/upload/f_png,w_96,h_96,c_limit,q_auto:eco,dpr_2,d_Competitions:default.png/v1/Competitions/552" },
  { id: "eng.1", ar: "الدوري الإنجليزي", en: "Premier League", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png" },
  { id: "esp.1", ar: "الدوري الإسباني", en: "LaLiga", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png" },
  { id: "ger.1", ar: "الدوري الألماني", en: "Bundesliga", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png" },
  { id: "ita.1", ar: "الدوري الإيطالي", en: "Serie A", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png" },
  { id: "fra.1", ar: "الدوري الفرنسي", en: "Ligue 1", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png" },
  { id: "uefa.champions", ar: "أبطال أوروبا", en: "UEFA CL", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png" },
  { id: "caf.champions", ar: "أبطال إفريقيا", en: "CAF CL", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/67.png" },
];

export interface SavedTacticalPlan {
  plan_id: string;
  club_id: string;
  name: string;
  formation_a: string;
  formation_b: string;
  phases: Record<TacticalPhaseId, TacticalPhaseSnapshot>;
  lineHeight?: "low" | "mid" | "high";
  pressingStyle?: "contain" | "trigger" | "gegenpress";
  updated_at: string;
}

export interface ResearchedPlayerDossier {
  athlete_id?: number | null;
  name_ar: string;
  name_en?: string;
  club_name_ar?: string;
  jersey_number?: number | null;
  position_code: string;
  position_label_ar?: string;
  age?: number | null;
  height_cm?: number | null;
  preferred_foot?: string | null;
  nationality_ar?: string;
  readiness_pct?: number;
  photo_url?: string | null;
  season_stats?: {
    season_name?: string;
    appearances?: number;
    starts?: number;
    goals?: number;
    assists?: number;
    competitions?: string[];
  };
  tactical_profile?: {
    best_roles_ar?: string[];
    fit_3421?: string;
    fit_4231?: string;
  };
  sources?: string[];
}

export interface ChatMessageItem {
  id: string;
  sender: "user" | "ai";
  text: string;
  engine?: string;
  action?: string;
  researchedPlayer?: ResearchedPlayerDossier | null;
  researchSources?: string[];
  timestamp?: string;
}

export interface ChatThread {
  id: string;
  title: string;
  clubId: string;
  updatedAt: string;
  messages: ChatMessageItem[];
}

export interface AiPendingRequest {
  id: string;
  question: string;
  targetPlayer?: CoachPlayer | null;
  targetClub?: CoachClubDetail | null;
}

export interface CoachClubListItem {
  club_id: string;
  ts_365_id?: number | null;
  name_ar: string;
  name_en: string;
  kit_hex: string;
  stadium_ar?: string;
  city_ar?: string;
  head_coach_ar?: string;
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
  birth_date?: string | null;
  age?: number | null;
  height_cm?: number | null;
  preferred_foot?: string | null;
  wikidata_id?: string | null;
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

export interface LeaguePlayerSearchItem extends CoachPlayer {
  club_id: string;
  club_name_ar: string;
  club_name_en: string;
  club_kit_hex: string;
  club_stadium_ar?: string;
}

export interface ForeignQuotaSummary {
  foreign_count: number;
  limit: number;
  remaining_slots: number;
  status: "ok" | "warning" | "over_limit";
  foreign_players: Array<{
    jersey_number: number;
    name_ar: string;
    name_en: string;
    nationality: string;
    nationality_flag: string;
    nationality_ar: string;
    position: string;
  }>;
}

export interface CoachClubDetail {
  club_id: string;
  name_ar: string;
  name_en: string;
  kit_hex: string;
  stadium_ar?: string;
  city_ar?: string;
  head_coach_ar?: string;
  head_coach_en?: string;
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

export interface PlayerTacticalLink {
  id: string;
  fromTeam: "team_a" | "team_b";
  fromSlot: string;
  toTeam: "team_a" | "team_b";
  toSlot: string;
  kind: "pass" | "support" | "mark";
  color: string;
  label: string;
}

export interface EditableArrow extends BlueprintPassingArrow {
  id?: string;
  kind?: "pass" | "run" | "press";
}

export interface EditableZone extends BlueprintCustomZone {
  id?: string;
}

export interface FreehandStroke {
  id: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width?: number;
}

export function isLightHex(hex?: string | null): boolean {
  if (!hex) return false;
  const clean = hex.trim().replace("#", "");
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.72;
}

export interface TacticalPhaseSnapshot {
  phase_id: TacticalPhaseId;
  label_ar: string;
  label_en: string;
  description_ar: string;
  nodes: BlueprintNode[];
  opponent_nodes: BlueprintNode[];
  passing_arrows: EditableArrow[];
  opponent_passing_arrows: EditableArrow[];
  custom_arrows: EditableArrow[];
  custom_links: PlayerTacticalLink[];
  custom_zones: EditableZone[];
  freehand_strokes?: FreehandStroke[];
  validation?: MathValidationResult | null;
}

export interface ThreePhaseBlueprint {
  formation_code: string;
  opponent_formation_code?: string;
  team_size?: number;
  title_ar: string;
  philosophy_ar: string;
  team_name: string;
  opponent_name?: string;
  tactical_mode?: string;
  kit_colors?: { team_a_hex: string; team_b_hex: string };
  nodes: BlueprintNode[];
  opponent_nodes?: BlueprintNode[];
  passing_arrows: EditableArrow[];
  opponent_passing_arrows?: EditableArrow[];
  phase_states?: Record<TacticalPhaseId, TacticalPhaseSnapshot>;
}

export function getShortArabicName(player?: { name_ar?: string; name_en?: string; player_label?: string } | null): string {
  if (!player) return "";
  const raw = (player.name_ar || player.player_label || player.name_en || "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return raw;
  return `${words[0]} ${words[words.length - 1]}`;
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
  fetched_at_cairo?: string;
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
  foreign_quota: ForeignQuotaSummary;
  matchday_brief_ar: string[];
  matchday_sheet: MatchdaySheetPayload;
  training_sessions: TrainingSessionPlan[];
  weekly_load_safety: { total_weekly_au: number; status: "optimal" | "warning"; warnings_ar: string[] };
  saved_plans?: SavedTacticalPlan[];
  live_hub: LiveHubPayload;
}
