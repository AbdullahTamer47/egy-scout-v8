import { create } from "zustand";
import type { BoundPlayerInfo, MatchItem, TeamKit, TelemetryFrame, TimelineEvent } from "@/lib/api";

export type StudioTab = "studio" | "forensics" | "portfolios" | "director" | "scouting" | "manager";
export type OverlayLayerKey =
  | "showBroadcast3D"
  | "showPassingLanes"
  | "showDefWalls"
  | "showVoronoi"
  | "showPitchGrid"
  | "showCoords";

/** High-frequency 60fps mutable playback state shared between video canvas & 3D Pitch Twin without React re-render lag. */
export const livePlaybackBridge: {
  timeS: number;
  frame: TelemetryFrame | null;
} = {
  timeS: 0,
  frame: null,
};

interface ScoutState {
  activeTab: StudioTab;
  matches: MatchItem[];
  selectedSlug: string | null;
  currentMatch: MatchItem | null;
  frames: TelemetryFrame[];
  teamKits: Record<string, TeamKit>;
  timelineEvents: TimelineEvent[];
  boundPlayers: Record<string, BoundPlayerInfo>;
  currentTimeS: number;
  currentFrame: TelemetryFrame | null;
  seekNonce: { timeS: number; playbackRate?: number; autoPlay?: boolean; seq: number } | null;

  // Broadcast 3D AR Layers & Playback
  showBroadcast3D: boolean;
  showPassingLanes: boolean;
  showDefWalls: boolean;
  showVoronoi: boolean;
  showPitchGrid: boolean;
  showCoords: boolean;
  pitchViewMode: "3d" | "2d";
  playbackRate: number;

  // Interactive Player Spotlight, Lineup Sheet & Executive Dossier
  selectedIdentityKey: string | null;
  dossierTarget: { type: "video"; identityKey: string } | { type: "db"; playerId: number } | null;
  showLineupModal: boolean;
  geminiApiKey: string;
  refreshSeq: number;

  setActiveTab: (tab: StudioTab) => void;
  setMatches: (m: MatchItem[]) => void;
  setSelectedSlug: (slug: string | null) => void;
  setCurrentMatch: (m: MatchItem | null) => void;
  setTelemetry: (
    frames: TelemetryFrame[],
    kits?: Record<string, TeamKit>,
    events?: TimelineEvent[],
    bound?: Record<string, BoundPlayerInfo>
  ) => void;
  setPlaybackState: (timeS: number, frame: TelemetryFrame | null) => void;
  seekTo: (timeS: number, opts?: { playbackRate?: number; autoPlay?: boolean }) => void;
  replayInStudio: (timeS: number, opts?: { playbackRate?: number; focusIdentity?: string | null }) => void;
  setPlaybackRate: (r: number) => void;
  toggleLayer: (key: OverlayLayerKey) => void;
  setPitchViewMode: (m: "3d" | "2d") => void;
  setSelectedIdentityKey: (ikey: string | null) => void;
  openVideoDossier: (identityKey: string) => void;
  openDbDossier: (playerId: number) => void;
  closeDossier: () => void;
  setShowLineupModal: (v: boolean) => void;
  setGeminiApiKey: (k: string) => void;
  triggerMatchRefresh: () => void;
}

export const useScoutStore = create<ScoutState>((set) => ({
  activeTab: "studio",
  matches: [],
  selectedSlug: null,
  currentMatch: null,
  frames: [],
  teamKits: {},
  timelineEvents: [],
  boundPlayers: {},
  currentTimeS: 0,
  currentFrame: null,
  seekNonce: null,

  showBroadcast3D: true,
  showPassingLanes: true,
  showDefWalls: true,
  showVoronoi: false,
  showPitchGrid: false,
  showCoords: false,
  pitchViewMode: "3d",
  playbackRate: 1.0,

  selectedIdentityKey: null,
  dossierTarget: null,
  showLineupModal: false,
  geminiApiKey: "",
  refreshSeq: 0,

  setActiveTab: (activeTab) => set({ activeTab }),
  setMatches: (matches) => set({ matches }),
  setSelectedSlug: (selectedSlug) => set({ selectedSlug, selectedIdentityKey: null }),
  setCurrentMatch: (currentMatch) => set({ currentMatch }),
  setTelemetry: (frames, kits, events, bound) => {
    livePlaybackBridge.frame = frames[0] || null;
    livePlaybackBridge.timeS = frames[0]?.time_s || 0;
    set({
      frames,
      teamKits: kits || {},
      timelineEvents: events || [],
      boundPlayers: bound || {},
      currentFrame: frames[0] || null,
    });
  },
  setPlaybackState: (currentTimeS, currentFrame) => set({ currentTimeS, currentFrame }),
  seekTo: (timeS, opts) =>
    set((s) => ({
      playbackRate: opts?.playbackRate ?? s.playbackRate,
      seekNonce: { timeS, playbackRate: opts?.playbackRate, autoPlay: opts?.autoPlay, seq: (s.seekNonce?.seq ?? 0) + 1 },
    })),
  replayInStudio: (timeS, opts) =>
    set((s) => ({
      activeTab: "studio",
      dossierTarget: null,
      selectedIdentityKey: opts?.focusIdentity !== undefined ? opts.focusIdentity : s.selectedIdentityKey,
      playbackRate: opts?.playbackRate ?? 0.5,
      seekNonce: { timeS, playbackRate: opts?.playbackRate ?? 0.5, autoPlay: true, seq: (s.seekNonce?.seq ?? 0) + 1 },
    })),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  toggleLayer: (key) => set((s) => ({ [key]: !s[key] })),
  setPitchViewMode: (pitchViewMode) => set({ pitchViewMode }),
  setSelectedIdentityKey: (selectedIdentityKey) => set({ selectedIdentityKey }),
  openVideoDossier: (identityKey) => set({ dossierTarget: { type: "video", identityKey } }),
  openDbDossier: (playerId) => set({ dossierTarget: { type: "db", playerId } }),
  closeDossier: () => set({ dossierTarget: null }),
  setShowLineupModal: (showLineupModal) => set({ showLineupModal }),
  setGeminiApiKey: (geminiApiKey) => set({ geminiApiKey }),
  triggerMatchRefresh: () => set((s) => ({ refreshSeq: s.refreshSeq + 1 })),
}));

/**
 * Glitch-free 60fps intra-shot interpolation:
 * - Matches players by identity_key OR track_id
 * - Smoothly blends u_norm, v_norm, bbox (x1..y2), metric (x_m, y_m), velocity, AND h_inv_norm matrix
 * - Locks passing lanes directly to the live interpolated carrier & receiver positions so arcs never snap!
 */
export function interpolateFrameAtTime(frames: TelemetryFrame[], timeS: number): TelemetryFrame | null {
  if (!frames || frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time_s < timeS) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo;
  const f1 = frames[idx];
  const f0 = idx > 0 ? frames[idx - 1] : null;
  if (!f0) return f1;

  const nearest = Math.abs(f1.time_s - timeS) < Math.abs(timeS - f0.time_s) ? f1 : f0;
  if (f0.shot_id !== f1.shot_id || f0.cal_src === "none" || f1.cal_src === "none") {
    return nearest;
  }
  const dt = f1.time_s - f0.time_s;
  if (dt <= 0.005 || dt > 0.5) return nearest;
  const a = Math.max(0, Math.min(1, (timeS - f0.time_s) / dt));

  // Index f1 players by both track_id and identity_key for seamless cross-frame continuity
  const byTrack1 = new Map(f1.players.map((p) => [p.track_id, p]));
  const byId1 = new Map(f1.players.filter((p) => p.identity_key).map((p) => [p.identity_key!, p]));

  const blendedByTrack = new Map<number, (typeof f0.players)[0]>();
  const blendedById = new Map<string, (typeof f0.players)[0]>();

  const blendedPlayers = f0.players.map((p0) => {
    const p1 = byTrack1.get(p0.track_id) || (p0.identity_key ? byId1.get(p0.identity_key) : undefined);
    if (!p1) {
      blendedByTrack.set(p0.track_id, p0);
      if (p0.identity_key) blendedById.set(p0.identity_key, p0);
      return p0;
    }
    const bp = {
      ...p0,
      u_norm: p0.u_norm + (p1.u_norm - p0.u_norm) * a,
      v_norm: p0.v_norm + (p1.v_norm - p0.v_norm) * a,
      x1_norm: p0.x1_norm + (p1.x1_norm - p0.x1_norm) * a,
      y1_norm: p0.y1_norm + (p1.y1_norm - p0.y1_norm) * a,
      x2_norm: p0.x2_norm + (p1.x2_norm - p0.x2_norm) * a,
      y2_norm: p0.y2_norm + (p1.y2_norm - p0.y2_norm) * a,
      x_m: p0.x_m !== null && p1.x_m !== null ? p0.x_m + (p1.x_m - p0.x_m) * a : p0.x_m,
      y_m: p0.y_m !== null && p1.y_m !== null ? p0.y_m + (p1.y_m - p0.y_m) * a : p0.y_m,
      vx_ms: (p0.vx_ms ?? 0) + ((p1.vx_ms ?? 0) - (p0.vx_ms ?? 0)) * a,
      vy_ms: (p0.vy_ms ?? 0) + ((p1.vy_ms ?? 0) - (p0.vy_ms ?? 0)) * a,
      speed_kmh:
        p0.speed_kmh !== undefined && p1.speed_kmh !== undefined
          ? p0.speed_kmh + (p1.speed_kmh - p0.speed_kmh) * a
          : p0.speed_kmh,
    };
    blendedByTrack.set(p0.track_id, bp);
    if (p0.identity_key) blendedById.set(p0.identity_key, bp);
    return bp;
  });

  // Smoothly interpolate h_inv_norm homography matrix so perspective ground rings glide with camera pan
  let blendedHInv = nearest.h_inv_norm;
  if (f0.h_inv_norm && f1.h_inv_norm) {
    const h22 = (1 - a) * f0.h_inv_norm[2][2] + a * f1.h_inv_norm[2][2];
    if (Math.abs(h22) > 1e-8) {
      blendedHInv = [0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => (((1 - a) * f0.h_inv_norm![r][c] + a * f1.h_inv_norm![r][c]) / h22))
      );
    }
  }

  // Lock passing lane endpoints directly to live interpolated carrier & target player feet!
  const carrier =
    (nearest.ball_carrier_identity ? blendedById.get(nearest.ball_carrier_identity) : undefined) ||
    (nearest.ball_carrier_track_id !== null ? blendedByTrack.get(nearest.ball_carrier_track_id) : undefined);

  const blendedLanes = (nearest.passing_lanes || []).map((ln) => {
    const tgt =
      (ln.target_identity_key ? blendedById.get(ln.target_identity_key) : undefined) ||
      blendedByTrack.get(ln.target_track_id);
    return {
      ...ln,
      from_uv: carrier ? ([carrier.u_norm, carrier.v_norm] as [number, number]) : ln.from_uv,
      to_uv: tgt ? ([tgt.u_norm, tgt.v_norm] as [number, number]) : ln.to_uv,
      from_m:
        carrier && carrier.x_m !== null && carrier.y_m !== null
          ? ([carrier.x_m, carrier.y_m] as [number, number])
          : ln.from_m,
      to_m:
        tgt && tgt.x_m !== null && tgt.y_m !== null
          ? ([tgt.x_m, tgt.y_m] as [number, number])
          : ln.to_m,
    };
  });

  let blendedBall = nearest.ball;
  if (f0.ball && f1.ball) {
    blendedBall = {
      ...f0.ball,
      u_norm: f0.ball.u_norm + (f1.ball.u_norm - f0.ball.u_norm) * a,
      v_norm: f0.ball.v_norm + (f1.ball.v_norm - f0.ball.v_norm) * a,
      x_m: f0.ball.x_m !== null && f1.ball.x_m !== null ? f0.ball.x_m + (f1.ball.x_m - f0.ball.x_m) * a : nearest.ball?.x_m ?? null,
      y_m: f0.ball.y_m !== null && f1.ball.y_m !== null ? f0.ball.y_m + (f1.ball.y_m - f0.ball.y_m) * a : nearest.ball?.y_m ?? null,
    };
  }

  return {
    ...nearest,
    h_inv_norm: blendedHInv,
    passing_lanes: blendedLanes,
    players: blendedPlayers,
    ball: blendedBall,
  };
}
