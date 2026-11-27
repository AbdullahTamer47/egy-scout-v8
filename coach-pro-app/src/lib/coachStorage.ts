/**
 * Persistent browser storage for EGY-SCOUT Coach Pro.
 * Ensures Vercel serverless cold starts NEVER erase coach login, saved plans,
 * training sessions, admin player statuses, or AI chat history threads.
 */
import type {
  ChatThread,
  CoachClubListItem,
  CoachPlayer,
  CoachProfile,
  SavedTacticalPlan,
  TrainingSessionPlan,
} from "@/components/coach/coachTypes";

const KEY_PROFILE = "egy_scout_coach_profile_v2";
const KEY_PLANS_PREFIX = "egy_scout_plans_v2_";
const KEY_GENERAL_PLAN_PREFIX = "egy_scout_general_plan_v2_";
const KEY_SESSIONS_PREFIX = "egy_scout_sessions_v2_";
const KEY_ADMIN_PREFIX = "egy_scout_admin_v2_";
const KEY_CLUBS_PREFIX = "egy_scout_league_clubs_v2_";
const KEY_CHAT_THREADS = "egy_scout_ai_threads_v2";
const KEY_ACTIVE_THREAD = "egy_scout_ai_active_thread_v2";

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, val: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export function loadSavedProfile(): CoachProfile | null {
  const p = safeRead<CoachProfile | null>(KEY_PROFILE, null);
  if (!p || !p.coach_name || !p.club_id) return null;
  return p;
}

export function saveLocalProfile(prof: CoachProfile): void {
  safeWrite(KEY_PROFILE, { ...prof, updated_at: new Date().toISOString() });
}

export function clearLocalProfile(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY_PROFILE);
  } catch {}
}

export function loadCachedLeagueClubs(leagueId: string): CoachClubListItem[] | null {
  const rec = safeRead<{ ts: number; clubs: CoachClubListItem[] } | null>(`${KEY_CLUBS_PREFIX}${leagueId}`, null);
  if (!rec || !Array.isArray(rec.clubs) || Date.now() - rec.ts > 15 * 60_000) return null;
  return rec.clubs;
}

export function saveCachedLeagueClubs(leagueId: string, clubs: CoachClubListItem[]): void {
  safeWrite(`${KEY_CLUBS_PREFIX}${leagueId}`, { ts: Date.now(), clubs });
}

export function loadSavedPlans(clubId: string): SavedTacticalPlan[] {
  return safeRead<SavedTacticalPlan[]>(`${KEY_PLANS_PREFIX}${clubId}`, []);
}

export function saveLocalPlan(clubId: string, plan: SavedTacticalPlan): SavedTacticalPlan[] {
  const prev = loadSavedPlans(clubId);
  const next = [plan, ...prev.filter((p) => p.plan_id !== plan.plan_id)].slice(0, 30);
  safeWrite(`${KEY_PLANS_PREFIX}${clubId}`, next);
  return next;
}

export function deleteLocalPlan(clubId: string, planId: string): SavedTacticalPlan[] {
  const next = loadSavedPlans(clubId).filter((p) => p.plan_id !== planId);
  safeWrite(`${KEY_PLANS_PREFIX}${clubId}`, next);
  return next;
}

export function loadGeneralPlan(clubId: string): SavedTacticalPlan | null {
  const direct = safeRead<SavedTacticalPlan | null>(`${KEY_GENERAL_PLAN_PREFIX}${clubId}`, null);
  if (direct && direct.phases) return direct;
  const fromList = loadSavedPlans(clubId).find(
    (p) => p.is_general || p.plan_id === `general_${clubId}`
  );
  return fromList && fromList.phases ? fromList : null;
}

export function saveGeneralPlan(clubId: string, plan: SavedTacticalPlan): SavedTacticalPlan {
  const normalized: SavedTacticalPlan = {
    ...plan,
    plan_id: `general_${clubId}`,
    club_id: clubId,
    is_general: true,
    updated_at: new Date().toISOString(),
  };
  safeWrite(`${KEY_GENERAL_PLAN_PREFIX}${clubId}`, normalized);
  saveLocalPlan(clubId, normalized);
  return normalized;
}

export function loadSavedSessions(clubId: string): TrainingSessionPlan[] {
  return safeRead<TrainingSessionPlan[]>(`${KEY_SESSIONS_PREFIX}${clubId}`, []);
}

export function saveLocalSessions(clubId: string, sessions: TrainingSessionPlan[]): void {
  safeWrite(`${KEY_SESSIONS_PREFIX}${clubId}`, sessions.slice(0, 40));
}

export type LocalAdminOverride = Partial<
  Pick<CoachPlayer, "status" | "readiness_pct" | "yellow_cards" | "red_cards" | "return_date" | "admin_note">
>;

export function loadSavedAdminMap(clubId: string): Record<number, LocalAdminOverride> {
  return safeRead<Record<number, LocalAdminOverride>>(`${KEY_ADMIN_PREFIX}${clubId}`, {});
}

export function saveLocalAdminStatus(clubId: string, jersey: number, patch: LocalAdminOverride): void {
  const prev = loadSavedAdminMap(clubId);
  prev[jersey] = { ...(prev[jersey] || {}), ...patch };
  safeWrite(`${KEY_ADMIN_PREFIX}${clubId}`, prev);
}

export function mergeAdminIntoPlayers(clubId: string, players: CoachPlayer[]): CoachPlayer[] {
  const overrides = loadSavedAdminMap(clubId);
  return players.map((p) => {
    const ov = overrides[p.jersey_number];
    if (!ov) return p;
    const status = ov.status || p.status || "fit";
    const yc = ov.yellow_cards ?? p.yellow_cards ?? 0;
    const rc = ov.red_cards ?? p.red_cards ?? 0;
    const blocked = status === "injured" || status === "suspended" || status === "rehab" || yc >= 3 || rc >= 1;
    return {
      ...p,
      ...ov,
      status: yc >= 3 || rc >= 1 ? "suspended" : status,
      is_eligible_starter: !blocked,
      block_reason_ar: yc >= 3 ? `إيقاف تلقائي (${yc} إنذارات)` : rc >= 1 ? "بطاقة حمراء" : blocked ? p.block_reason_ar || status : "",
    };
  });
}

export function loadChatThreads(): ChatThread[] {
  return safeRead<ChatThread[]>(KEY_CHAT_THREADS, []);
}

export function saveChatThreads(threads: ChatThread[]): void {
  safeWrite(KEY_CHAT_THREADS, threads.slice(0, 25));
}

export function loadActiveChatThreadId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY_ACTIVE_THREAD);
  } catch {
    return null;
  }
}

export function saveActiveChatThreadId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_ACTIVE_THREAD, id);
  } catch {}
}
