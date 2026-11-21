import { create } from "zustand";
import type { MatchDetail, MatchListItem, TeamKitPalette, TelemetryFrame } from "@/lib/api";

export type StudioTab = "studio" | "doctor" | "moneyball" | "manager";

export interface OverlayLayers {
  show3DRings: boolean;
  showTacticalMesh: boolean;
  showPassingLanes: boolean;
  showVoronoi3D: boolean;
  showTrail: boolean;
  showAllLabels: boolean;
}

export type TelestratorTool = "none" | "arrow" | "circle" | "zone";

const DEFAULT_TEAM_KITS: Record<string, TeamKitPalette> = {
  "0": { family: "red", label_ar: "أحمر", ring: "#ef4444", primary: "#dc2626", hex: "#ef4444" },
  "1": { family: "blue", label_ar: "أزرق", ring: "#38bdf8", primary: "#0284c7", hex: "#38bdf8" },
};

interface TacticalStoreState {
  activeTab: StudioTab;
  matches: MatchListItem[];
  selectedMatchId: number | null;
  currentMatch: MatchDetail | null;
  fps: number;
  videoWidth: number;
  videoHeight: number;
  frameMap: Map<number, TelemetryFrame>;
  sortedFrameIds: number[];
  teamKits: Record<string, TeamKitPalette>;
  currentFrameId: number;
  currentTimeS: number;
  isPlaying: boolean;
  seekTargetS: number | null;
  selectedIdentity: string | null;
  layers: OverlayLayers;
  telestratorTool: TelestratorTool;

  setActiveTab: (tab: StudioTab) => void;
  setMatches: (matches: MatchListItem[]) => void;
  setSelectedMatchId: (id: number | null) => void;
  setCurrentMatch: (match: MatchDetail | null) => void;
  setTelemetry: (
    fps: number,
    width: number,
    height: number,
    frames: TelemetryFrame[],
    teamKits?: Record<string, TeamKitPalette>
  ) => void;
  setPlaybackState: (frameId: number, timeS: number, isPlaying?: boolean) => void;
  requestSeek: (timeS: number | null) => void;
  setSelectedIdentity: (ident: string | null) => void;
  toggleLayer: (key: keyof OverlayLayers) => void;
  setTelestratorTool: (tool: TelestratorTool) => void;
}

export const useTacticalStore = create<TacticalStoreState>((set) => ({
  activeTab: "studio",
  matches: [],
  selectedMatchId: null,
  currentMatch: null,
  fps: 25,
  videoWidth: 1280,
  videoHeight: 720,
  frameMap: new Map(),
  sortedFrameIds: [],
  teamKits: DEFAULT_TEAM_KITS,
  currentFrameId: 0,
  currentTimeS: 0,
  isPlaying: false,
  seekTargetS: null,
  selectedIdentity: null,
  telestratorTool: "none",
  layers: {
    show3DRings: true,
    showTacticalMesh: true,
    showPassingLanes: true,
    showVoronoi3D: false,
    showTrail: false,
    showAllLabels: false,
  },

  setActiveTab: (activeTab) => set({ activeTab }),
  setMatches: (matches) => set({ matches }),
  setSelectedMatchId: (selectedMatchId) => set({ selectedMatchId }),
  setCurrentMatch: (currentMatch) =>
    set((s) => ({
      currentMatch,
      teamKits:
        currentMatch?.summary?.team_kits && Object.keys(currentMatch.summary.team_kits).length > 0
          ? currentMatch.summary.team_kits
          : s.teamKits,
    })),
  setTelemetry: (fps, videoWidth, videoHeight, frames, teamKits) => {
    const frameMap = new Map<number, TelemetryFrame>();
    const ids: number[] = [];
    for (const f of frames) {
      frameMap.set(f.frame_id, f);
      ids.push(f.frame_id);
    }
    ids.sort((a, b) => a - b);
    set((s) => ({
      fps: fps || 25,
      videoWidth: videoWidth || 1280,
      videoHeight: videoHeight || 720,
      frameMap,
      sortedFrameIds: ids,
      teamKits: teamKits && Object.keys(teamKits).length > 0 ? teamKits : s.teamKits,
    }));
  },
  setPlaybackState: (currentFrameId, currentTimeS, isPlaying) =>
    set((s) => ({
      currentFrameId,
      currentTimeS,
      isPlaying: isPlaying !== undefined ? isPlaying : s.isPlaying,
    })),
  requestSeek: (seekTargetS) => set({ seekTargetS }),
  setSelectedIdentity: (selectedIdentity) => set({ selectedIdentity }),
  toggleLayer: (key) =>
    set((s) => ({
      layers: { ...s.layers, [key]: !s.layers[key] },
    })),
  setTelestratorTool: (telestratorTool) => set({ telestratorTool }),
}));

/** Stride-aware nearest telemetry lookup preventing 3D overlay flicker on strided frames. */
export function resolveNearestFrame(
  frameMap: Map<number, TelemetryFrame>,
  targetFrameId: number
): TelemetryFrame | undefined {
  const exact = frameMap.get(targetFrameId);
  if (exact) return exact;
  for (let d = 1; d <= 3; d++) {
    const prev = frameMap.get(targetFrameId - d);
    if (prev) return prev;
    const next = frameMap.get(targetFrameId + d);
    if (next) return next;
  }
  return undefined;
}

/** 60fps sub-frame linear interpolation across strided telemetry frames for zero-lag broadcast motion. */
export function interpolateTelemetryFrame(
  frameMap: Map<number, TelemetryFrame>,
  exactFrameFloat: number
): TelemetryFrame | undefined {
  if (frameMap.size === 0 || !Number.isFinite(exactFrameFloat)) return undefined;
  const fFloor = Math.floor(exactFrameFloat);
  const fCeil = Math.ceil(exactFrameFloat);

  let prevF: TelemetryFrame | undefined = frameMap.get(fFloor);
  if (!prevF) {
    for (let d = 1; d <= 4; d++) {
      const cand = frameMap.get(fFloor - d);
      if (cand) {
        prevF = cand;
        break;
      }
    }
  }

  let nextF: TelemetryFrame | undefined = fCeil === fFloor ? frameMap.get(fFloor + 1) : frameMap.get(fCeil);
  if (!nextF) {
    for (let d = 1; d <= 4; d++) {
      const cand = frameMap.get(fFloor + d);
      if (cand && (!prevF || cand.frame_id > prevF.frame_id)) {
        nextF = cand;
        break;
      }
    }
  }

  if (!prevF) return resolveNearestFrame(frameMap, Math.round(exactFrameFloat));
  if (
    !nextF ||
    nextF.frame_id <= prevF.frame_id ||
    nextF.frame_id - prevF.frame_id > 4 ||
    prevF.is_tactical_wide === false ||
    nextF.is_tactical_wide === false
  ) {
    if (prevF.is_tactical_wide === false) return prevF;
    return resolveNearestFrame(frameMap, Math.round(exactFrameFloat)) ?? prevF;
  }

  const alpha = Math.max(0, Math.min(1, (exactFrameFloat - prevF.frame_id) / (nextF.frame_id - prevF.frame_id)));
  const nextByKey = new Map(nextF.players.map((p) => [p.identity_key, p]));
  const interpPlayers = prevF.players.map((p) => {
    const q = nextByKey.get(p.identity_key);
    if (!q || q.team_cluster !== p.team_cluster) return p;
    return {
      ...p,
      u_norm: p.u_norm + (q.u_norm - p.u_norm) * alpha,
      v_norm: p.v_norm + (q.v_norm - p.v_norm) * alpha,
      x1_norm: p.x1_norm + (q.x1_norm - p.x1_norm) * alpha,
      y1_norm: p.y1_norm + (q.y1_norm - p.y1_norm) * alpha,
      x2_norm: p.x2_norm + (q.x2_norm - p.x2_norm) * alpha,
      y2_norm: p.y2_norm + (q.y2_norm - p.y2_norm) * alpha,
      x_m: p.x_m + (q.x_m - p.x_m) * alpha,
      y_m: p.y_m + (q.y_m - p.y_m) * alpha,
      vx: p.vx + (q.vx - p.vx) * alpha,
      vy: p.vy + (q.vy - p.vy) * alpha,
      speed_kmh: p.speed_kmh + (q.speed_kmh - p.speed_kmh) * alpha,
    };
  });

  const interpBall =
    prevF.ball && nextF.ball
      ? {
          u_norm: prevF.ball.u_norm + (nextF.ball.u_norm - prevF.ball.u_norm) * alpha,
          v_norm: prevF.ball.v_norm + (nextF.ball.v_norm - prevF.ball.v_norm) * alpha,
          x_m: prevF.ball.x_m + (nextF.ball.x_m - prevF.ball.x_m) * alpha,
          y_m: prevF.ball.y_m + (nextF.ball.y_m - prevF.ball.y_m) * alpha,
        }
      : prevF.ball;

  const interpFormations: TelemetryFrame["formations"] = { ...prevF.formations };
  for (const tc of ["0", "1"] as const) {
    const fa = prevF.formations?.[tc];
    const fb = nextF.formations?.[tc];
    if (fa?.lines_uv && fb?.lines_uv && fa.lines_uv.length === fb.lines_uv.length) {
      const mergedUv = fa.lines_uv.map((chA, ci) => {
        const chB = fb.lines_uv![ci];
        if (!chB || chA.length !== chB.length) return chA;
        return chA.map((ptA, pi) => [
          ptA[0] + (chB[pi][0] - ptA[0]) * alpha,
          ptA[1] + (chB[pi][1] - ptA[1]) * alpha,
        ] as [number, number]);
      });
      interpFormations[tc] = { ...fa, lines_uv: mergedUv };
    }
  }

  return {
    ...prevF,
    formations: interpFormations,
    players: interpPlayers,
    ball: interpBall,
  };
}
