"use client";

import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  EyeOff,
  FileText,
  Film,
  Ghost,
  Layers,
  Link2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Ruler,
  Sparkles,
  Square,
  Target,
  Trash2,
  Undo2,
  Video,
} from "lucide-react";
import { EChartsMatchMomentum } from "@/components/TacticalCharts";
import TacticalTwinCanvas, { SetPieceSimState } from "@/components/TacticalTwinCanvas";
import {
  API_BASE,
  apiFetch,
  frameImageUrl,
  matchVideoUrl,
  MomentsAndBriefPayload,
  OpponentDossierPayload,
  PositioningAnalysisPayload,
  TimelineBall,
  TimelineFrame,
  TimelinePayload,
  TimelineTrack,
  UserRole,
} from "@/lib/api";
import {
  draw3DCurvedArrow,
  draw3DTapeMeasure,
  drawBallCometAndArc,
  drawBroadcastGroundRing,
  drawGhostSilhouette,
  drawGoalProbabilityCone,
  drawSpotlightBeamAndCard,
  drawTacticalChainWall,
  drawTacticalZone,
  hexToRgba,
  RenderPlayer,
} from "@/lib/broadcastRenderer";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
}

type ToolMode = "spotlight" | "chain" | "arrow" | "tape" | "zone" | "ghost";
type ArDensity = "focus" | "all" | "clean";

interface TelestratorDrawing {
  kind: "arrow" | "tape" | "zone";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  metersEst?: number;
}

/** Adaptive One-Euro style EMA smoothing factor (rock-steady when slow, responsive on sprints). */
function adaptiveAlpha(delta: number, dt: number): number {
  const speed = Math.abs(delta) / Math.max(dt, 0.008);
  const cutoff = 1.6 + 0.08 * speed;
  const tau = 1 / (2 * Math.PI * cutoff);
  return Math.max(0.14, Math.min(0.85, 1 / (1 + tau / Math.max(dt, 0.008))));
}

/** Interpolate telemetry players, velocities & Kalman ball at video time `tSec`. */
function interpolateTimeline(
  frames: TimelineFrame[],
  tSec: number
): {
  calibrated: boolean;
  players: TimelineTrack[];
  ball: TimelineBall | null;
  ballCarrierId: number | null;
  possessionTeam: string;
  momentum: number;
} {
  if (!frames.length) {
    return {
      calibrated: false,
      players: [],
      ball: null,
      ballCarrierId: null,
      possessionTeam: "contested",
      momentum: 0,
    };
  }

  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time_s < tSec) lo = mid + 1;
    else hi = mid;
  }
  const next = frames[lo];
  const prev = lo > 0 ? frames[lo - 1] : next;

  const nearestDiff = Math.min(Math.abs(tSec - prev.time_s), Math.abs(next.time_s - tSec));
  if (nearestDiff > 0.65 || (!prev.calibrated && !next.calibrated)) {
    return {
      calibrated: false,
      players: [],
      ball: null,
      ballCarrierId: null,
      possessionTeam: "contested",
      momentum: 0,
    };
  }
  if (!prev.calibrated) {
    return {
      calibrated: next.calibrated,
      players: next.players,
      ball: next.ball ?? null,
      ballCarrierId: next.ball_carrier_id ?? null,
      possessionTeam: next.possession_team ?? "contested",
      momentum: next.momentum ?? 0,
    };
  }
  if (!next.calibrated || prev.frame_id === next.frame_id) {
    return {
      calibrated: prev.calibrated,
      players: prev.players,
      ball: prev.ball ?? null,
      ballCarrierId: prev.ball_carrier_id ?? null,
      possessionTeam: prev.possession_team ?? "contested",
      momentum: prev.momentum ?? 0,
    };
  }

  const span = Math.max(1e-4, next.time_s - prev.time_s);
  if (span > 0.85) {
    const chosen = Math.abs(tSec - prev.time_s) <= Math.abs(next.time_s - tSec) ? prev : next;
    return {
      calibrated: chosen.calibrated,
      players: chosen.players,
      ball: chosen.ball ?? null,
      ballCarrierId: chosen.ball_carrier_id ?? null,
      possessionTeam: chosen.possession_team ?? "contested",
      momentum: chosen.momentum ?? 0,
    };
  }

  const u = Math.max(0, Math.min(1, (tSec - prev.time_s) / span));
  const nextById = new Map<number, TimelineTrack>();
  for (const p of next.players) nextById.set(p.track_id, p);
  const prevIds = new Set<number>();

  const out: TimelineTrack[] = [];
  for (const a of prev.players) {
    prevIds.add(a.track_id);
    const b = nextById.get(a.track_id);
    if (!b) {
      if (u < 0.65) out.push(a);
      continue;
    }
    if (Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m) > 6.5) {
      out.push(u < 0.5 ? a : b);
      continue;
    }
    out.push({
      ...a,
      x_m: a.x_m + (b.x_m - a.x_m) * u,
      y_m: a.y_m + (b.y_m - a.y_m) * u,
      vx_ms: (a.vx_ms ?? 0) + ((b.vx_ms ?? 0) - (a.vx_ms ?? 0)) * u,
      vy_ms: (a.vy_ms ?? 0) + ((b.vy_ms ?? 0) - (a.vy_ms ?? 0)) * u,
      speed_kmh: (a.speed_kmh ?? 0) + ((b.speed_kmh ?? 0) - (a.speed_kmh ?? 0)) * u,
      bbox: [
        a.bbox[0] + (b.bbox[0] - a.bbox[0]) * u,
        a.bbox[1] + (b.bbox[1] - a.bbox[1]) * u,
        a.bbox[2] + (b.bbox[2] - a.bbox[2]) * u,
        a.bbox[3] + (b.bbox[3] - a.bbox[3]) * u,
      ],
    });
  }
  if (u >= 0.35) {
    for (const b of next.players) {
      if (!prevIds.has(b.track_id)) out.push(b);
    }
  }

  let interpBall: TimelineBall | null = prev.ball ?? next.ball ?? null;
  if (prev.ball && next.ball) {
    interpBall = {
      x_m: prev.ball.x_m + (next.ball.x_m - prev.ball.x_m) * u,
      y_m: prev.ball.y_m + (next.ball.y_m - prev.ball.y_m) * u,
      z_m: prev.ball.z_m + (next.ball.z_m - prev.ball.z_m) * u,
      u:
        prev.ball.u !== null && next.ball.u !== null
          ? prev.ball.u + (next.ball.u - prev.ball.u) * u
          : prev.ball.u ?? next.ball.u,
      v:
        prev.ball.v !== null && next.ball.v !== null
          ? prev.ball.v + (next.ball.v - prev.ball.v) * u
          : prev.ball.v ?? next.ball.v,
      vx_ms: prev.ball.vx_ms + (next.ball.vx_ms - prev.ball.vx_ms) * u,
      vy_ms: prev.ball.vy_ms + (next.ball.vy_ms - prev.ball.vy_ms) * u,
      vx_px: (prev.ball.vx_px ?? 0) + ((next.ball.vx_px ?? 0) - (prev.ball.vx_px ?? 0)) * u,
      vy_px: (prev.ball.vy_px ?? 0) + ((next.ball.vy_px ?? 0) - (prev.ball.vy_px ?? 0)) * u,
      j_mat: u < 0.5 ? prev.ball.j_mat ?? next.ball.j_mat : next.ball.j_mat ?? prev.ball.j_mat,
      inpainted: prev.ball.inpainted || next.ball.inpainted,
    };
  }

  const chosenMeta = u < 0.5 ? prev : next;
  if (out.length < 4 && (prev.calibrated || next.calibrated)) {
    const fb = u < 0.5 && prev.calibrated ? prev : next;
    return {
      calibrated: fb.calibrated,
      players: fb.players,
      ball: interpBall,
      ballCarrierId: fb.ball_carrier_id ?? null,
      possessionTeam: fb.possession_team ?? "contested",
      momentum: fb.momentum ?? 0,
    };
  }

  return {
    calibrated: out.length >= 4,
    players: out,
    ball: interpBall,
    ballCarrierId: chosenMeta.ball_carrier_id ?? null,
    possessionTeam: chosenMeta.possession_team ?? "contested",
    momentum: chosenMeta.momentum ?? 0,
  };
}

/** Build camera-compensated grass-locked ball trajectory up to `tSec` (works on pause, scrub & play). */
function buildBallTrailAtTime(
  frames: TimelineFrame[],
  tSec: number,
  curBall: TimelineBall | null
): Array<{ u: number; v: number; z_m: number }> {
  const pts: Array<{ u: number; v: number; z_m: number }> = [];
  if (!curBall || curBall.u === null || curBall.v === null) return pts;

  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].time_s <= tSec) lo = mid;
    else hi = mid - 1;
  }

  let refT = tSec;
  let refX = curBall.x_m;
  let refY = curBall.y_m;
  let refU = curBall.u;
  let refV = curBall.v;
  const jMat = curBall.j_mat;

  for (let i = lo; i >= 0 && pts.length < 7; i--) {
    const fr = frames[i];
    if (!fr.calibrated) break;
    if (refT - fr.time_s > 0.65) break;
    const b = fr.ball;
    if (!b || b.u === null || b.v === null) continue;
    if (Math.hypot(b.x_m - refX, b.y_m - refY) > 12) break;

    let uProj = b.u;
    let vProj = b.v;
    if (jMat) {
      const dxm = b.x_m - curBall.x_m;
      const dym = b.y_m - curBall.y_m;
      uProj = curBall.u + jMat[0] * dxm + jMat[1] * dym;
      vProj = curBall.v + jMat[2] * dxm + jMat[3] * dym;
    }
    if (Math.hypot(uProj - refU, vProj - refV) > 220) break;

    pts.unshift({ u: uProj, v: vProj, z_m: b.z_m });
    refT = fr.time_s;
    refX = b.x_m;
    refY = b.y_m;
    refU = uProj;
    refV = vProj;
  }
  pts.push({ u: curBall.u, v: curBall.v, z_m: curBall.z_m });
  return pts;
}

/** Fast client-side continuous geometric xG & local Pitch Control evaluator during scrubbing/drag. */
function evalInstantMetrics(
  players: RenderPlayer[],
  ballXY: [number, number],
  attackingTeam: string,
  goalX?: number
): { xg: number; boxControlPct: number } {
  const resolvedGoalX = goalX !== undefined ? goalX : attackingTeam === "team_a" ? 105 : 0;
  const goalY = 34;
  const [bx, by] = ballXY;
  const dist = Math.hypot(resolvedGoalX - bx, goalY - by);
  const segX = resolvedGoalX - bx;
  const segY = goalY - by;
  const segLen = Math.hypot(segX, segY) + 1e-6;
  const p1x = resolvedGoalX - bx, p1y = goalY - 3.66 - by;
  const p2x = resolvedGoalX - bx, p2y = goalY + 3.66 - by;
  const cosA = Math.max(
    -1,
    Math.min(1, (p1x * p2x + p1y * p2y) / (Math.hypot(p1x, p1y) * Math.hypot(p2x, p2y) + 1e-6))
  );
  const angleRad = Math.acos(cosA);

  const defTeam = attackingTeam === "team_a" ? "team_b" : "team_a";
  let pressure = 0;
  let coneOcc = 0;
  let attZone = 0.01;
  let defZone = 0.01;
  const zoneX = resolvedGoalX >= 52.5 ? Math.max(bx, 78) : Math.min(bx, 27);

  for (const p of players) {
    if (p.role !== "player" && p.role !== "goalkeeper") continue;
    const dBall = Math.hypot(p.x_m - bx, p.y_m - by);
    const dZone = Math.hypot(p.x_m - zoneX, p.y_m - by);
    const infl = Math.exp(-((dZone / 18) ** 2));
    if (p.team === attackingTeam) {
      attZone += infl;
    } else if (p.team === defTeam) {
      defZone += infl;
      pressure += 0.65 * Math.exp(-((dBall / 3.2) ** 2));
      const tProj = ((p.x_m - bx) * segX + (p.y_m - by) * segY) / (segLen * segLen);
      if (tProj >= -0.05 && tProj <= 1.02) {
        const perp = Math.abs(segX * (p.y_m - by) - segY * (p.x_m - bx)) / segLen;
        coneOcc += 0.55 * Math.exp(-((perp / 2.2) ** 2));
      }
    }
  }

  const effDist = Math.min(dist, 24);
  const effAngle = Math.max(angleRad, 0.22);
  const logit = 0.25 - 0.085 * effDist + 2.4 * effAngle - 0.55 * coneOcc - pressure;
  const xg = Math.max(0.02, Math.min(0.92, 1 / (1 + Math.exp(-logit))));
  const boxControlPct = (attZone / (attZone + defZone)) * 100;
  return { xg: Number(xg.toFixed(3)), boxControlPct: Number(boxControlPct.toFixed(1)) };
}

/** Downscaled HSV green-turf alpha matte keeping players' bodies, green/yellow kits & sunlit ankles above rings. */
function buildGreenTurfMask(
  source: HTMLVideoElement | HTMLImageElement,
  maskCanvas: HTMLCanvasElement,
  players: RenderPlayer[] = [],
  vw = 1280,
  vh = 720
) {
  const mw = maskCanvas.width;
  const mh = maskCanvas.height;
  const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!mctx) return;
  mctx.drawImage(source, 0, 0, mw, mh);
  const imgData = mctx.getImageData(0, 0, mw, mh);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const sat = max === 0 ? 0 : delta / max;
    let hue = 0;
    if (delta > 0) {
      if (max === g) hue = 60 * ((b - r) / delta + 2);
      else if (max === r) hue = 60 * (((g - b) / delta) % 6);
      else hue = 60 * ((r - g) / delta + 4);
      if (hue < 0) hue += 360;
    }
    const isTurf =
      hue >= 64 &&
      hue <= 158 &&
      sat >= 0.20 &&
      max >= 0.14 &&
      g > r * 1.10 &&
      g > b * 1.12;
    d[i + 3] = isTurf ? 255 : 0;
  }
  mctx.putImageData(imgData, 0, 0);

  // Foreground Player Silhouette Protection: keep players' torsos/legs strictly opaque ABOVE ground rings
  // even when wearing green/lime/yellow kits (e.g. ENPPI / Goalkeeper)!
  if (players.length > 0 && vw > 0 && vh > 0) {
    const sx = mw / vw;
    const sy = mh / vh;
    mctx.save();
    mctx.globalCompositeOperation = "destination-out";
    mctx.fillStyle = "#000000";
    for (const p of players) {
      if (p.role !== "player" && p.role !== "goalkeeper") continue;
      const [x1, y1, x2, y2] = p.bbox;
      const bw = Math.max(8, x2 - x1);
      const bh = Math.max(16, y2 - y1);
      // Punch out inner torso + legs (middle 54% width, top 93% height) so AR never bleeds over kits/legs
      const px = (x1 + bw * 0.23) * sx;
      const py = (y1 + bh * 0.04) * sy;
      const pw = bw * 0.54 * sx;
      const ph = bh * 0.89 * sy;
      mctx.fillRect(px, py, pw, ph);
    }
    mctx.restore();
  }
}

export default function BroadcastStudioScreen({ lang, matchId, role }: Props) {
  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  const [data, setData] = useState<PositioningAnalysisPayload | null>(null);
  const [timelineMeta, setTimelineMeta] = useState<{
    tStart: number;
    tEnd: number;
    teamAName: string;
    teamBName: string;
    teamAAttacksRight: boolean;
    frames: TimelineFrame[];
  }>({ tStart: 50, tEnd: 73, teamAName: "Team A", teamBName: "Team B", teamAAttacksRight: true, frames: [] });
  const [attackDirOverride, setAttackDirOverride] = useState<"auto" | "left" | "right">("auto");
  const [momentsBrief, setMomentsBrief] = useState<MomentsAndBriefPayload | null>(null);

  const [tool, setTool] = useState<ToolMode>("ghost");
  const [arDensity, setArDensity] = useState<ArDensity>("focus");
  const [showGoalCone, setShowGoalCone] = useState(true);
  const [showBallTrail, setShowBallTrail] = useState(true);
  const [turfOcclusion, setTurfOcclusion] = useState(true);
  const [faceBlur, setFaceBlur] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hudTimeS, setHudTimeS] = useState(50);
  const [hudPossession, setHudPossession] = useState("contested");
  const [isCloseUpUi, setIsCloseUpUi] = useState(false);

  const [selectedDefId, setSelectedDefId] = useState<number | null>(null);
  const [spotlightIds, setSpotlightIds] = useState<number[]>([]);
  const [chainIds, setChainIds] = useState<number[]>([]);
  const [drawings, setDrawings] = useState<TelestratorDrawing[]>([]);
  const [activeDraft, setActiveDraft] = useState<TelestratorDrawing | null>(null);

  const [ghostDx, setGhostDx] = useState(0);
  const [ghostDy, setGhostDy] = useState(0);
  const [baseMetrics, setBaseMetrics] = useState({ xg: 0.221, boxControlPct: 59.4 });
  const [liveMetrics, setLiveMetrics] = useState({ xg: 0.221, boxControlPct: 59.4 });

  // Live synced props for TacticalTwinCanvas
  const [twinPlayers, setTwinPlayers] = useState<RenderPlayer[]>([]);
  const [twinBall, setTwinBall] = useState<TimelineBall | null>(null);

  const [simulatingSetPiece, setSimulatingSetPiece] = useState(false);
  const [setPieceSim, setSetPieceSim] = useState<SetPieceSimState | null>(null);
  const [recordingAr, setRecordingAr] = useState(false);
  const [exportingMp4, setExportingMp4] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const [hlsActive, setHlsActive] = useState(false);
  const [loadingHls, setLoadingHls] = useState(false);
  const [opponentDossier, setOpponentDossier] = useState<OpponentDossierPayload | null>(null);
  const [showDossier, setShowDossier] = useState(false);
  const hlsRef = useRef<Hls | null>(null);

  const enableGopHlsStream = async () => {
    const video = videoRef.current;
    if (!video || loadingHls) return;
    setLoadingHls(true);
    setExportNote("");
    try {
      const res = await apiFetch<{ hls_url: string; segments: number; keyint: number }>(
        `/api/matches/${encodeURIComponent(matchId)}/package-hls`,
        { method: "POST" },
        "club_demo_egypt",
        role
      );
      const srcUrl = `${API_BASE}${res.hls_url}`;
      const curT = video.currentTime || tlStartRef.current;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (Hls.isSupported()) {
        const hls = new Hls({ lowLatencyMode: false, maxBufferLength: 20 });
        hls.loadSource(srcUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.currentTime = curT;
        });
        hlsRef.current = hls;
        setHlsActive(true);
        setExportNote(
          isAr
            ? `✓ تم تفعيل بث HLS السريع (${res.segments} شرائح • keyint=${res.keyint})`
            : `✓ GOP-Aligned HLS active (${res.segments} segments • keyint=${res.keyint})`
        );
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = srcUrl;
        video.currentTime = curT;
        setHlsActive(true);
      }
    } catch (e) {
      setExportNote(String(e));
    } finally {
      setLoadingHls(false);
    }
  };

  const toggleOpponentDossier = async () => {
    if (showDossier) {
      setShowDossier(false);
      return;
    }
    setShowDossier(true);
    try {
      const d = await apiFetch<OpponentDossierPayload>(
        `/api/matches/${encodeURIComponent(matchId)}/opponent-dossier`,
        {},
        "club_demo_egypt",
        role
      );
      setOpponentDossier(d);
    } catch {}
  };

  // High-frequency refs for 60FPS render loop
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fallbackImgRef = useRef<HTMLImageElement | null>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gfxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const timelineRef = useRef<TimelineFrame[]>([]);
  const tlStartRef = useRef<number>(50);
  const videoReadyRef = useRef<boolean>(false);
  const smoothedMapRef = useRef<Map<number, TimelineTrack>>(new Map());
  const ballTrailRef = useRef<Array<{ u: number; v: number; z_m: number }>>([]);
  const wasCloseUpRef = useRef<boolean>(false);
  const lastEvalTimeRef = useRef<number>(-1);
  const overlayAlphaRef = useRef<number>(1.0);
  const activePlayersRef = useRef<TimelineTrack[]>([]);
  const activeBallRef = useRef<[number, number]>([60, 34]);
  const draggingVideoGhostRef = useRef<boolean>(false);
  const dragDrawStartRef = useRef<{ vx: number; vy: number } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const lastMaskKeyRef = useRef<string>("");
  const lastSyncedTimeRef = useRef<number>(-999);
  const lastSyncedCalRef = useRef<boolean | null>(null);
  const lastSyncedPossRef = useRef<string>("");
  const lastDrawTsRef = useRef<number>(0);

  const effectiveAttackGoalX =
    attackDirOverride === "left"
      ? 0
      : attackDirOverride === "right"
      ? 105
      : data?.attack_goal_x ?? (timelineMeta.teamAAttacksRight ? 105 : 0);

  const toggleAttackDir = () => {
    const nextOverride =
      attackDirOverride === "auto"
        ? effectiveAttackGoalX >= 52.5
          ? "left"
          : "right"
        : "auto";
    setAttackDirOverride(nextOverride);
    if (!activePlayersRef.current.length) return;
    const nextGx =
      nextOverride === "left"
        ? 0
        : nextOverride === "right"
        ? 105
        : data?.attack_goal_x ?? (timelineMeta.teamAAttacksRight ? 105 : 0);
    const attTeam = data?.attacking_team || "team_a";
    const base = evalInstantMetrics(activePlayersRef.current, activeBallRef.current, attTeam, nextGx);
    setBaseMetrics(base);
    if (selectedDefId !== null && (ghostDx !== 0 || ghostDy !== 0)) {
      const mod = activePlayersRef.current.map((p) =>
        p.track_id === selectedDefId
          ? {
              ...p,
              x_m: Math.max(0, Math.min(105, p.x_m + ghostDx)),
              y_m: Math.max(0, Math.min(68, p.y_m + ghostDy)),
            }
          : p
      );
      setLiveMetrics(evalInstantMetrics(mod, activeBallRef.current, attTeam, nextGx));
    } else {
      setLiveMetrics(base);
    }
  };

  const stateRef = useRef({
    tool,
    arDensity,
    showGoalCone,
    showBallTrail,
    turfOcclusion,
    faceBlur,
    selectedDefId,
    spotlightIds,
    chainIds,
    drawings,
    activeDraft,
    ghostDx,
    ghostDy,
    liveXg: liveMetrics.xg,
    baseXg: baseMetrics.xg,
    attackingTeam: "team_a",
    defendingTeam: "team_b",
    attackGoalX: 105,
    teamAHex: "#EF4444",
    teamBHex: "#38BDF8",
    teamAName: "Team A",
    teamBName: "Team B",
    isAr,
  });
  stateRef.current = {
    tool,
    arDensity,
    showGoalCone,
    showBallTrail,
    turfOcclusion,
    faceBlur,
    selectedDefId,
    spotlightIds,
    chainIds,
    drawings,
    activeDraft,
    ghostDx,
    ghostDy,
    liveXg: liveMetrics.xg,
    baseXg: baseMetrics.xg,
    attackingTeam: data?.attacking_team || "team_a",
    defendingTeam: data?.defending_team || "team_b",
    attackGoalX: effectiveAttackGoalX,
    teamAHex: data?.kit_colors?.team_a_hex || "#EF4444",
    teamBHex: data?.kit_colors?.team_b_hex || "#38BDF8",
    teamAName: timelineMeta.teamAName,
    teamBName: timelineMeta.teamBName,
    isAr,
  };

  useEffect(() => {
    lastDrawTsRef.current = 0;
  }, [
    tool,
    arDensity,
    showGoalCone,
    showBallTrail,
    turfOcclusion,
    faceBlur,
    selectedDefId,
    spotlightIds,
    chainIds,
    drawings,
    activeDraft,
    ghostDx,
    ghostDy,
    attackDirOverride,
    data,
    timelineMeta,
    liveMetrics.xg,
  ]);

  useEffect(() => {
    let alive = true;
    smoothedMapRef.current.clear();
    ballTrailRef.current = [];
    wasCloseUpRef.current = false;
    lastEvalTimeRef.current = -1;
    lastMaskKeyRef.current = "";
    lastSyncedTimeRef.current = -999;
    lastSyncedCalRef.current = null;
    lastSyncedPossRef.current = "";
    lastDrawTsRef.current = 0;
    videoReadyRef.current = false;
    setIsPlaying(false);
    setAttackDirOverride("auto");
    setSpotlightIds([]);
    setChainIds([]);
    setDrawings([]);
    setSetPieceSim(null);

    Promise.all([
      apiFetch<PositioningAnalysisPayload>(
        `/api/matches/${matchId}/positioning-analysis?frame_id=1250`,
        {},
        "club_demo_egypt",
        role
      ),
      apiFetch<TimelinePayload>(`/api/matches/${matchId}/timeline`, {}, "club_demo_egypt", role),
      apiFetch<MomentsAndBriefPayload>(`/api/matches/${matchId}/moments-and-brief`, {}, "club_demo_egypt", role),
    ])
      .then(([res, tl, mb]) => {
        if (!alive) return;
        const mergedData: PositioningAnalysisPayload = {
          ...res,
          kit_colors: res.kit_colors || tl.kit_colors,
        };
        setData(mergedData);
        setMomentsBrief(mb);
        timelineRef.current = tl.frames;
        tlStartRef.current = tl.t_start;
        const aAttacksRight = tl.team_a_attacks_right ?? res.team_a_attacks_right ?? true;
        const autoGoalX = res.attack_goal_x ?? (aAttacksRight ? 105 : 0);
        setTimelineMeta({
          tStart: tl.t_start,
          tEnd: tl.t_end,
          teamAName: tl.team_a_name || "Team A",
          teamBName: tl.team_b_name || "Team B",
          teamAAttacksRight: aAttacksRight,
          frames: tl.frames,
        });
        setHudTimeS(tl.t_start);
        setIsCloseUpUi(false);
        overlayAlphaRef.current = 1.0;

        const firstCal = tl.frames.find((f) => f.calibrated);
        const initPlayers: TimelineTrack[] = firstCal?.players ?? res.players;
        activePlayersRef.current = initPlayers;
        activeBallRef.current = firstCal?.ball ? [firstCal.ball.x_m, firstCal.ball.y_m] : res.ball_xy;
        setTwinPlayers(initPlayers);
        setTwinBall(firstCal?.ball ?? null);

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = frameImageUrl(matchId, res.frame_id);
        fallbackImgRef.current = img;

        if (videoRef.current && videoRef.current.readyState >= 1) {
          videoRef.current.currentTime = tl.t_start;
          videoReadyRef.current = true;
        }

        const defs = initPlayers.filter((p) => p.team === res.defending_team && p.role === "player");
        const nearest = defs.length
          ? defs.reduce((a, b) =>
              Math.hypot(b.x_m - res.ball_xy[0], b.y_m - res.ball_xy[1]) <
              Math.hypot(a.x_m - res.ball_xy[0], a.y_m - res.ball_xy[1])
                ? b
                : a
            )
          : null;
        const chosenId = res.suggested_ghost_move?.target_track_id ?? nearest?.track_id ?? null;
        setSelectedDefId(chosenId);
        setGhostDx(0);
        setGhostDy(0);
        lastEvalTimeRef.current = tl.t_start;

        const base = {
          xg: res.shot_xg?.xg ?? evalInstantMetrics(initPlayers, res.ball_xy, res.attacking_team, autoGoalX).xg,
          boxControlPct:
            res.pitch_control?.box_control_pct ??
            evalInstantMetrics(initPlayers, res.ball_xy, res.attacking_team, autoGoalX).boxControlPct,
        };
        setBaseMetrics(base);
        setLiveMetrics(base);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [matchId, role]);

  // Unified 60FPS Broadcast AR Render Loop
  useEffect(() => {
    if (!gfxCanvasRef.current) gfxCanvasRef.current = document.createElement("canvas");
    if (!maskCanvasRef.current) {
      const mc = document.createElement("canvas");
      mc.width = 320;
      mc.height = 180;
      maskCanvasRef.current = mc;
    }

    let rafId = 0;
    let lastTs = performance.now();
    let lastHudSync = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.008, (now - lastTs) / 1000));
      lastTs = now;

      const st = stateRef.current;
      const video = videoRef.current;
      const fallbackImg = fallbackImgRef.current;
      const mainCanvas = mainCanvasRef.current;
      const gfxCanvas = gfxCanvasRef.current!;
      const maskCanvas = maskCanvasRef.current!;

      const hasVideoFrame = Boolean(video && video.readyState >= 2 && video.videoWidth > 0);
      const sourceEl = hasVideoFrame
        ? video!
        : fallbackImg && fallbackImg.complete && fallbackImg.naturalWidth > 0
        ? fallbackImg
        : null;

      const tCur = video && videoReadyRef.current ? video.currentTime : tlStartRef.current;
      const interp = timelineRef.current.length
        ? interpolateTimeline(timelineRef.current, tCur)
        : {
            calibrated: activePlayersRef.current.length >= 4,
            players: activePlayersRef.current,
            ball: null,
            ballCarrierId: null,
            possessionTeam: "contested",
            momentum: 0,
          };

      if (!interp.calibrated) {
        wasCloseUpRef.current = true;
        ballTrailRef.current = [];
      } else if (wasCloseUpRef.current) {
        smoothedMapRef.current.clear();
        wasCloseUpRef.current = false;
      }

      const targetAlpha = interp.calibrated ? 1.0 : 0.0;
      overlayAlphaRef.current += (targetAlpha - overlayAlphaRef.current) * Math.min(1, dt * 8.5);
      const alpha = overlayAlphaRef.current;

      const smoothedList: TimelineTrack[] = [];
      const nextMap = new Map<number, TimelineTrack>();
      for (const raw of interp.players) {
        const prev = smoothedMapRef.current.get(raw.track_id);
        if (!prev || Math.hypot(raw.x_m - prev.x_m, raw.y_m - prev.y_m) > 5.0) {
          nextMap.set(raw.track_id, raw);
          smoothedList.push(raw);
        } else {
          const ax = adaptiveAlpha(raw.x_m - prev.x_m, dt);
          const ay = adaptiveAlpha(raw.y_m - prev.y_m, dt);
          const ab = adaptiveAlpha(raw.bbox[0] - prev.bbox[0], dt);
          const sm: TimelineTrack = {
            ...raw,
            x_m: prev.x_m + (raw.x_m - prev.x_m) * ax,
            y_m: prev.y_m + (raw.y_m - prev.y_m) * ay,
            bbox: [
              prev.bbox[0] + (raw.bbox[0] - prev.bbox[0]) * ab,
              prev.bbox[1] + (raw.bbox[1] - prev.bbox[1]) * ab,
              prev.bbox[2] + (raw.bbox[2] - prev.bbox[2]) * ab,
              prev.bbox[3] + (raw.bbox[3] - prev.bbox[3]) * ab,
            ],
          };
          nextMap.set(raw.track_id, sm);
          smoothedList.push(sm);
        }
      }

      let activeBallTrail: Array<{ u: number; v: number; z_m: number }> = [];
      if (interp.calibrated && smoothedList.length > 0) {
        smoothedMapRef.current = nextMap;
        activePlayersRef.current = smoothedList;
        if (interp.ball) {
          activeBallRef.current = [interp.ball.x_m, interp.ball.y_m];
          activeBallTrail = buildBallTrailAtTime(timelineRef.current, tCur, interp.ball);
          ballTrailRef.current = activeBallTrail;
        } else {
          ballTrailRef.current = [];
        }
      }

      if (mainCanvas && sourceEl) {
        const vw = sourceEl instanceof HTMLVideoElement ? sourceEl.videoWidth : sourceEl.naturalWidth;
        const vh = sourceEl instanceof HTMLVideoElement ? sourceEl.videoHeight : sourceEl.naturalHeight;
        const isActivelyPlaying = Boolean(video && !video.paused);
        const shouldSkipPausedRedraw =
          !isActivelyPlaying &&
          !draggingVideoGhostRef.current &&
          !dragDrawStartRef.current &&
          now - lastDrawTsRef.current < 85 &&
          Math.abs(tCur - lastSyncedTimeRef.current) <= 0.01;

        if (!shouldSkipPausedRedraw) {
          lastDrawTsRef.current = now;
          if (mainCanvas.width !== vw || mainCanvas.height !== vh) {
            mainCanvas.width = vw;
            mainCanvas.height = vh;
            gfxCanvas.width = vw;
            gfxCanvas.height = vh;
            lastMaskKeyRef.current = "";
          }
          const ctx = mainCanvas.getContext("2d");
          const gctx = gfxCanvas.getContext("2d");
          if (ctx && gctx) {
            ctx.drawImage(sourceEl, 0, 0, vw, vh);

            if (st.arDensity !== "clean" && alpha > 0.02 && smoothedList.length > 0) {
              const phaseRad = (now * 0.0022) % (Math.PI * 2);
              const isPaused = !video || video.paused;

              // --- PASS A: Ground Pitch Layers (occluded underneath legs/socks via Green Turf Mask!) ---
              gctx.clearRect(0, 0, vw, vh);
              gctx.save();
              gctx.globalAlpha = alpha;

              // 1. LaLiga Goal Probability Cone from Ball toward ACTUAL defended goal
              if (st.showGoalCone && interp.ball && interp.ball.u !== null && interp.ball.v !== null) {
                drawGoalProbabilityCone(
                  gctx,
                  interp.ball.u,
                  interp.ball.v,
                  vw,
                  vh,
                  st.attackGoalX >= 52.5,
                  st.liveXg
                );
              }

              // 2. Tactical Zone highlights
              for (const d of [...st.drawings, ...(st.activeDraft ? [st.activeDraft] : [])]) {
                if (d.kind === "zone") {
                  const cx = (d.x1 + d.x2) * 0.5;
                  const cy = (d.y1 + d.y2) * 0.5;
                  drawTacticalZone(gctx, cx, cy, Math.abs(d.x2 - d.x1) * 0.5, Math.abs(d.y2 - d.y1) * 0.5);
                }
              }

              // 3. Tactical Linked Defensive Chain Wall
              const chainPlayers = st.chainIds.length >= 2
                ? st.chainIds.map((id) => smoothedList.find((p) => p.track_id === id)).filter((x): x is TimelineTrack => Boolean(x))
                : st.tool === "chain"
                ? smoothedList.filter((p) => p.team === st.defendingTeam && p.role === "player").slice(0, 4)
                : [];
              if (chainPlayers.length >= 2) {
                drawTacticalChainWall(gctx, chainPlayers, vw, vh, false);
              }

              // 4. Player Broadcast Perspective Discs (Focus Mode keeps pitch ultra clean!)
              const spotSet = new Set(st.spotlightIds);
              const chainSet = new Set(chainPlayers.map((p) => p.track_id));
              for (const p of smoothedList) {
                if (p.role !== "player" && p.role !== "goalkeeper") continue;
                const isSel = p.track_id === st.selectedDefId;
                const isCarrier = p.track_id === interp.ballCarrierId;
                const isHighlighted = isSel || isCarrier || spotSet.has(p.track_id) || chainSet.has(p.track_id);
                const colorHex = isSel
                  ? "#10B981"
                  : p.role === "goalkeeper"
                  ? "#22D3EE"
                  : p.team === "team_a"
                  ? st.teamAHex
                  : st.teamBHex;

                drawBroadcastGroundRing(gctx, p, {
                  colorHex,
                  emphasized: isHighlighted,
                  subtle: st.arDensity === "focus" && !isHighlighted,
                  phaseRad,
                  isCarrier,
                });
              }

              // 5a. Ground Kalman Ball Comet Trail & Turf Shadow
              if (st.showBallTrail && activeBallTrail.length > 0) {
                drawBallCometAndArc(gctx, activeBallTrail, undefined, "ground");
              }

              gctx.restore();

              // Apply Green-Turf Chroma Occlusion Mask + Player Torso Protection (cached per timestamp!)
              if (st.turfOcclusion) {
                const maskKey = `${vw}x${vh}:${hasVideoFrame ? "v" : "i"}:${tCur.toFixed(2)}`;
                if (maskKey !== lastMaskKeyRef.current) {
                  buildGreenTurfMask(sourceEl, maskCanvas, smoothedList, vw, vh);
                  if (!video?.seeking) {
                    lastMaskKeyRef.current = maskKey;
                  }
                }
                gctx.save();
                gctx.globalCompositeOperation = "destination-in";
                gctx.drawImage(maskCanvas, 0, 0, vw, vh);
                gctx.restore();
              }
              ctx.drawImage(gfxCanvas, 0, 0);

              // --- PASS B: Foreground Broadcast HUD (Ball Reticle & Direction Vector, Light Pillars, Cards, Ghost) ---
              ctx.save();
              ctx.globalAlpha = alpha;

              // 5b. High-Contrast Ball Reticle & Velocity Direction Vector above turf mask
              if (st.showBallTrail && activeBallTrail.length > 0) {
                drawBallCometAndArc(
                  ctx,
                  activeBallTrail,
                  { vx: interp.ball?.vx_px ?? 0, vy: interp.ball?.vy_px ?? 0 },
                  "foreground"
                );
              }

              // Chain spacing pills above legs
              if (chainPlayers.length >= 2) {
                drawTacticalChainWall(ctx, chainPlayers, vw, vh, true);
              }

              // User-drawn 3D Arrows & Laser Tapes
              for (const d of [...st.drawings, ...(st.activeDraft ? [st.activeDraft] : [])]) {
                if (d.kind === "arrow") {
                  draw3DCurvedArrow(ctx, d.x1, d.y1, d.x2, d.y2);
                } else if (d.kind === "tape") {
                  draw3DTapeMeasure(ctx, d.x1, d.y1, d.x2, d.y2, vw, vh, d.metersEst);
                }
              }

              // Sky Sports MNF Spotlight Light Pillars & Telemetry Tag Cards
              const focusIds = new Set<number>(st.spotlightIds);
              if (st.selectedDefId !== null) focusIds.add(st.selectedDefId);
              for (const fid of focusIds) {
                const fp = smoothedList.find((p) => p.track_id === fid);
                if (!fp) continue;
                const hex =
                  fp.track_id === st.selectedDefId
                    ? "#10B981"
                    : fp.team === "team_a"
                    ? st.teamAHex
                    : st.teamBHex;
                drawSpotlightBeamAndCard(ctx, fp, vw, vh, hex, activeBallRef.current);
              }

              // Athletic 3D Ghost Silhouette when Defender Moved
              if (st.selectedDefId !== null && (st.ghostDx !== 0 || st.ghostDy !== 0) && isPaused) {
                const gp = smoothedList.find((p) => p.track_id === st.selectedDefId);
                if (gp) {
                  const gx = (gp.bbox[0] + gp.bbox[2]) * 0.5 + st.ghostDx * 14;
                  const gy = gp.bbox[3] + st.ghostDy * 9;
                  const xgDelta =
                    st.baseXg > 0 ? Math.round(((st.liveXg - st.baseXg) / st.baseXg) * 100) : 0;
                  drawGhostSilhouette(ctx, gp, gx, gy, vw, vh, xgDelta);
                }
              }

              // Youth GDPR Auto Face-Blur
              if (st.faceBlur) {
                for (const p of smoothedList) {
                  const [x1, y1, x2, y2] = p.bbox;
                  const fh = Math.max(8, (y2 - y1) * 0.22);
                  ctx.fillStyle = "rgba(9, 13, 22, 0.90)";
                  ctx.beginPath();
                  ctx.roundRect(x1, y1, x2 - x1, fh, 4);
                  ctx.fill();
                }
              }

              ctx.restore();
            }

            // Bottom-right Broadcast Scorebug HUD (avoids overlapping TV broadcast top-left scoreboard!)
            if (st.arDensity !== "clean") {
              const hudW = 248;
              const hudH = 28;
              const hx = vw - hudW - 14;
              const hy = vh - hudH - 12;
              const cyMid = hy + hudH * 0.5;
              ctx.save();
              ctx.direction = "ltr";
              ctx.fillStyle = "rgba(9, 13, 22, 0.86)";
              ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.roundRect(hx, hy, hudW, hudH, 7);
              ctx.fill();
              ctx.stroke();

              // Team A swatch & name
              ctx.fillStyle = st.teamAHex;
              ctx.beginPath();
              ctx.arc(hx + 13, cyMid, 4.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#F8FAFC";
              ctx.font = "700 11px Inter, system-ui, sans-serif";
              ctx.textAlign = "left";
              ctx.textBaseline = "middle";
              ctx.fillText(st.teamAName.slice(0, 9), hx + 22, cyMid + 0.5);

              // Team B swatch & name
              ctx.fillStyle = st.teamBHex;
              ctx.beginPath();
              ctx.arc(hx + 104, cyMid, 4.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = "#F8FAFC";
              ctx.fillText(st.teamBName.slice(0, 9), hx + 113, cyMid + 0.5);

              // Clock badge
              ctx.fillStyle = "#10B981";
              ctx.font = "700 11px Inter, monospace";
              ctx.textAlign = "right";
              ctx.fillText(`${tCur.toFixed(1)}s`, hx + hudW - 10, cyMid + 0.5);
              ctx.restore();
            }
          }
        }
      }

      // Throttled HUD & Twin sync ONLY when time/state actually changed (zero idle React re-render storm!)
      if (now - lastHudSync > 80) {
        lastHudSync = now;
        const isActivelyPlaying = Boolean(video && !video.paused);
        const stateChanged =
          isActivelyPlaying ||
          Math.abs(tCur - lastSyncedTimeRef.current) > 0.015 ||
          interp.calibrated !== lastSyncedCalRef.current ||
          interp.possessionTeam !== lastSyncedPossRef.current;

        if (stateChanged) {
          lastSyncedTimeRef.current = tCur;
          lastSyncedCalRef.current = interp.calibrated;
          lastSyncedPossRef.current = interp.possessionTeam;
          setHudTimeS(tCur);
          setHudPossession(interp.possessionTeam);
          setIsCloseUpUi(!interp.calibrated);
          if (interp.calibrated && smoothedList.length > 0) {
            setTwinPlayers(smoothedList);
            setTwinBall(interp.ball);
          }
          if (interp.calibrated && smoothedList.length > 0 && !draggingVideoGhostRef.current) {
            const timeMoved = Math.abs(tCur - lastEvalTimeRef.current) > 0.03;
            if (isActivelyPlaying) {
              lastEvalTimeRef.current = tCur;
              const m = evalInstantMetrics(smoothedList, activeBallRef.current, st.attackingTeam, st.attackGoalX);
              setBaseMetrics(m);
              setLiveMetrics(m);
            } else if (timeMoved) {
              lastEvalTimeRef.current = tCur;
              const m = evalInstantMetrics(smoothedList, activeBallRef.current, st.attackingTeam, st.attackGoalX);
              setBaseMetrics(m);
              if (st.selectedDefId !== null && (st.ghostDx !== 0 || st.ghostDy !== 0)) {
                const mod = smoothedList.map((p) =>
                  p.track_id === st.selectedDefId
                    ? {
                        ...p,
                        x_m: Math.max(0, Math.min(105, p.x_m + st.ghostDx)),
                        y_m: Math.max(0, Math.min(68, p.y_m + st.ghostDy)),
                      }
                    : p
                );
                setLiveMetrics(evalInstantMetrics(mod, activeBallRef.current, st.attackingTeam, st.attackGoalX));
              } else {
                setLiveMetrics(m);
              }
            }
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [timelineMeta.tStart]);

  const commitWhatIfToApi = async (tid: number, dx: number, dy: number) => {
    if (!data || isReadOnly) return;
    try {
      const res = await apiFetch<{
        before_xg: number;
        after_xg: number;
        before_box_control_pct: number;
        after_box_control_pct: number;
      }>(
        "/api/tactics/what-if",
        {
          method: "POST",
          body: JSON.stringify({
            players: activePlayersRef.current.map((p) => ({ ...p, vx_ms: 0, vy_ms: 0 })),
            ball_xy: activeBallRef.current,
            target_track_id: tid,
            dx_m: dx,
            dy_m: dy,
            attacking_team: data.attacking_team,
            goal_x: effectiveAttackGoalX,
          }),
        },
        "club_demo_egypt",
        role
      );
      setBaseMetrics({ xg: res.before_xg, boxControlPct: res.before_box_control_pct });
      setLiveMetrics({ xg: res.after_xg, boxControlPct: res.after_box_control_pct });
    } catch {
      // Keep client-computed preview
    }
  };

  const applyGhostAtPitch = (rx: number, ry: number, activeId: number, commit: boolean) => {
    const def = activePlayersRef.current.find((p) => p.track_id === activeId);
    if (!def) return;
    const dx = Math.max(-16, Math.min(16, Number((rx - def.x_m).toFixed(1))));
    const dy = Math.max(-16, Math.min(16, Number((ry - def.y_m).toFixed(1))));
    setGhostDx(dx);
    setGhostDy(dy);

    const attTeam = data?.attacking_team || "team_a";
    const base = evalInstantMetrics(activePlayersRef.current, activeBallRef.current, attTeam, effectiveAttackGoalX);
    setBaseMetrics(base);
    const mod = activePlayersRef.current.map((p) =>
      p.track_id === activeId
        ? { ...p, x_m: Math.max(0, Math.min(105, p.x_m + dx)), y_m: Math.max(0, Math.min(68, p.y_m + dy)) }
        : p
    );
    setLiveMetrics(evalInstantMetrics(mod, activeBallRef.current, attTeam, effectiveAttackGoalX));
    if (commit) commitWhatIfToApi(activeId, dx, dy);
  };

  const canvasToVideoCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = mainCanvasRef.current!;
    const rect = cvs.getBoundingClientRect();
    return {
      vx: ((e.clientX - rect.left) / Math.max(1, rect.width)) * cvs.width,
      vy: ((e.clientY - rect.top) / Math.max(1, rect.height)) * cvs.height,
    };
  };

  const hitPlayerAtVideo = (vx: number, vy: number, teamFilter?: string) =>
    activePlayersRef.current.find(
      (p) =>
        (!teamFilter || p.team === teamFilter) &&
        (p.role === "player" || p.role === "goalkeeper") &&
        vx >= p.bbox[0] - 18 &&
        vx <= p.bbox[2] + 18 &&
        vy >= p.bbox[1] - 12 &&
        vy <= p.bbox[3] + 22
    );

  const handleVideoMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!mainCanvasRef.current || !data) return;
    const { vx, vy } = canvasToVideoCoords(e);

    if (tool === "spotlight") {
      const hit = hitPlayerAtVideo(vx, vy);
      if (hit) {
        setSelectedDefId(hit.track_id);
        setSpotlightIds((prev) =>
          prev.includes(hit.track_id) ? prev.filter((id) => id !== hit.track_id) : [...prev, hit.track_id]
        );
      }
      return;
    }

    if (tool === "chain") {
      const hit = hitPlayerAtVideo(vx, vy);
      if (hit) {
        setChainIds((prev) =>
          prev.includes(hit.track_id) ? prev.filter((id) => id !== hit.track_id) : [...prev, hit.track_id]
        );
      }
      return;
    }

    if (tool === "arrow" || tool === "tape" || tool === "zone") {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
      dragDrawStartRef.current = { vx, vy };
      setActiveDraft({ kind: tool, x1: vx, y1: vy, x2: vx, y2: vy });
      return;
    }

    if (tool === "ghost") {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
      const hit = hitPlayerAtVideo(vx, vy, data.defending_team);
      const activeId = hit ? hit.track_id : selectedDefId;
      if (hit) setSelectedDefId(hit.track_id);
      if (activeId !== null) draggingVideoGhostRef.current = true;
    }
  };

  const handleVideoMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!mainCanvasRef.current) return;
    const { vx, vy } = canvasToVideoCoords(e);

    if (dragDrawStartRef.current && (tool === "arrow" || tool === "tape" || tool === "zone")) {
      const { vx: sx, vy: sy } = dragDrawStartRef.current;
      let metersEst: number | undefined = undefined;
      if (tool === "tape") {
        const p1 = hitPlayerAtVideo(sx, sy);
        const p2 = hitPlayerAtVideo(vx, vy);
        if (p1 && p2) metersEst = Number(Math.hypot(p1.x_m - p2.x_m, p1.y_m - p2.y_m).toFixed(1));
      }
      setActiveDraft({ kind: tool, x1: sx, y1: sy, x2: vx, y2: vy, metersEst });
      return;
    }

    if (draggingVideoGhostRef.current && selectedDefId !== null) {
      const def = activePlayersRef.current.find((p) => p.track_id === selectedDefId);
      if (!def) return;
      const cx = (def.bbox[0] + def.bbox[2]) * 0.5;
      const cy = def.bbox[3];
      const dx = Math.max(-14, Math.min(14, Number(((vx - cx) / 14).toFixed(1))));
      const dy = Math.max(-14, Math.min(14, Number(((vy - cy) / 9).toFixed(1))));
      applyGhostAtPitch(def.x_m + dx, def.y_m + dy, selectedDefId, false);
    }
  };

  const handleVideoMouseUp = () => {
    if (dragDrawStartRef.current && activeDraft) {
      if (Math.hypot(activeDraft.x2 - activeDraft.x1, activeDraft.y2 - activeDraft.y1) >= 12) {
        setDrawings((prev) => [...prev, activeDraft]);
      }
      dragDrawStartRef.current = null;
      setActiveDraft(null);
    }
    if (draggingVideoGhostRef.current && selectedDefId !== null) {
      draggingVideoGhostRef.current = false;
      commitWhatIfToApi(selectedDefId, ghostDx, ghostDy);
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < timelineMeta.tStart - 0.5 || v.currentTime > timelineMeta.tEnd - 0.2) {
        v.currentTime = timelineMeta.tStart;
      }
      v.playbackRate = playbackRate;
      v.play().catch(() => {});
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const stepFrame = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    v.currentTime = Math.max(0, v.currentTime + delta / 25);
  };

  const seekToTime = (sec: number) => {
    const v = videoRef.current;
    smoothedMapRef.current.clear();
    ballTrailRef.current = [];
    lastMaskKeyRef.current = "";
    lastDrawTsRef.current = 0;
    if (v) {
      v.currentTime = sec;
    }
    setHudTimeS(sec);
  };

  const resetToTacticalStart = () => {
    const startSec = timelineRef.current[0]?.time_s ?? tlStartRef.current ?? timelineMeta.tStart;
    smoothedMapRef.current.clear();
    ballTrailRef.current = [];
    lastMaskKeyRef.current = "";
    lastSyncedTimeRef.current = -999;
    lastDrawTsRef.current = 0;
    wasCloseUpRef.current = false;
    lastEvalTimeRef.current = startSec;
    overlayAlphaRef.current = 1.0;
    setIsCloseUpUi(false);
    setGhostDx(0);
    setGhostDy(0);
    if (data) {
      const firstCal = timelineRef.current.find((f) => f.calibrated);
      const initPlayers = firstCal?.players ?? data.players;
      activePlayersRef.current = initPlayers;
      activeBallRef.current = firstCal?.ball ? [firstCal.ball.x_m, firstCal.ball.y_m] : data.ball_xy;
      setTwinPlayers(initPlayers);
      setTwinBall(firstCal?.ball ?? null);
      const m = {
        xg: data.shot_xg?.xg ?? evalInstantMetrics(initPlayers, data.ball_xy, data.attacking_team, effectiveAttackGoalX).xg,
        boxControlPct:
          data.pitch_control?.box_control_pct ??
          evalInstantMetrics(initPlayers, data.ball_xy, data.attacking_team, effectiveAttackGoalX).boxControlPct,
      };
      setBaseMetrics(m);
      setLiveMetrics(m);
    }
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
      videoRef.current.currentTime = startSec;
    }
    setHudTimeS(startSec);
  };

  const applySuggestedGhost = () => {
    if (!data || !activePlayersRef.current.length) return;
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setIsPlaying(false);
    }

    const sug = data.suggested_ghost_move;
    if (sug) {
      const sugDef = activePlayersRef.current.find((p) => p.track_id === sug.target_track_id);
      if (sugDef) {
        setSelectedDefId(sug.target_track_id);
        applyGhostAtPitch(sugDef.x_m + sug.dx_m, sugDef.y_m + sug.dy_m, sug.target_track_id, true);
        return;
      }
    }

    // Current-frame 25-point counterfactual search when scrubbed away from initial frame
    const defs = activePlayersRef.current.filter(
      (p) => p.team === data.defending_team && p.role === "player"
    );
    if (!defs.length) return;
    const [bx, by] = activeBallRef.current;
    const selDef = defs.find((p) => p.track_id === selectedDefId);
    const chosenDef =
      selDef ||
      defs.reduce((a, b) =>
        Math.hypot(b.x_m - bx, b.y_m - by) < Math.hypot(a.x_m - bx, a.y_m - by) ? b : a
      );

    let bestDx = 0;
    let bestDy = 0;
    let bestScore = Infinity;
    for (const dx of [-8, -4, 0, 4, 8]) {
      for (const dy of [-8, -4, 0, 4, 8]) {
        if (dx === 0 && dy === 0) continue;
        const mod = activePlayersRef.current.map((p) =>
          p.track_id === chosenDef.track_id
            ? {
                ...p,
                x_m: Math.max(0, Math.min(105, chosenDef.x_m + dx)),
                y_m: Math.max(0, Math.min(68, chosenDef.y_m + dy)),
              }
            : p
        );
        const m = evalInstantMetrics(mod, [bx, by], data.attacking_team, effectiveAttackGoalX);
        const score = m.xg * 100 + m.boxControlPct * 0.35;
        if (score < bestScore) {
          bestScore = score;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
    setSelectedDefId(chosenDef.track_id);
    applyGhostAtPitch(chosenDef.x_m + bestDx, chosenDef.y_m + bestDy, chosenDef.track_id, true);
  };

  const toggleLiveArRecording = () => {
    if (recordingAr && recorderRef.current) {
      recorderRef.current.stop();
      setRecordingAr(false);
      return;
    }
    const cvs = mainCanvasRef.current;
    if (!cvs || typeof MediaRecorder === "undefined" || !("captureStream" in cvs)) {
      setExportNote(isAr ? "المتصفح لا يدعم تسجيل اللوحة المباشر" : "Canvas MediaRecorder unsupported");
      return;
    }
    try {
      const stream = cvs.captureStream(30);
      const mr = new MediaRecorder(stream, { mimeType: "video/webm" });
      recordedChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${matchId}_skypad_ar.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setExportNote(isAr ? "تم تنزيل تسجيل البث AR (WebM)" : "Broadcast AR clip saved (WebM)");
      };
      recorderRef.current = mr;
      mr.start();
      setRecordingAr(true);
    } catch {
      setExportNote(isAr ? "تعذّر بدء تسجيل WebM" : "Unable to start WebM recording");
    }
  };

  const handleServerMp4Export = async () => {
    setExportingMp4(true);
    setExportNote("");
    try {
      const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/export-clip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": "club_demo_egypt",
          "X-User-Role": role,
        },
        body: JSON.stringify({
          start_s: Math.max(0, Number(hudTimeS.toFixed(1))),
          end_s: Number((hudTimeS + 5.0).toFixed(1)),
          auto_face_blur: faceBlur,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${matchId}_club_clip.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNote(isAr ? "تم تصدير MP4 بعلامة النادي" : "Club-watermarked MP4 downloaded");
    } catch {
      setExportNote(isAr ? "فشل تصدير MP4" : "MP4 export failed");
    } finally {
      setExportingMp4(false);
    }
  };

  const xgDeltaPct =
    baseMetrics.xg > 0
      ? Math.round(((liveMetrics.xg - baseMetrics.xg) / baseMetrics.xg) * 100)
      : 0;

  return (
    <div className="space-y-5">
      {/* Hidden Video Backing Source */}
      <video
        ref={videoRef}
        key={matchId}
        src={matchVideoUrl(matchId)}
        crossOrigin="anonymous"
        playsInline
        preload="auto"
        onLoadedMetadata={() => {
          if (videoRef.current) {
            videoRef.current.currentTime = tlStartRef.current;
            videoReadyRef.current = true;
            lastMaskKeyRef.current = "";
            lastDrawTsRef.current = 0;
          }
        }}
        onLoadedData={() => {
          lastMaskKeyRef.current = "";
          lastDrawTsRef.current = 0;
        }}
        onSeeked={() => {
          lastMaskKeyRef.current = "";
          lastDrawTsRef.current = 0;
        }}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      {/* Top Header + AR Density Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">
            {data
              ? isAr ? data.analysis_title_ar : data.analysis_title_en
              : isAr ? "استوديو البث التكتيكي 60FPS" : "60FPS Broadcast Tactical Studio"}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {isAr
              ? "وضع تركيز أوروبي بدون تشويش • تتبع كرة كالمان ثلاثي الأبعاد • إخفاء الطبقات خلف الأرجل + توأم 2D/3D/Player-POV."
              : "Focus-first European Broadcast AR • 3D Kalman Ball Trail • Turf Occlusion + 2D/3D/Player-POV Twin."}
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-[#111827] border border-white/[0.08] rounded-xl p-1 text-xs">
          {(
            [
              { id: "focus" as ArDensity, ar: "بث مركّز (أنيق)", en: "Focus Broadcast" },
              { id: "all" as ArDensity, ar: "كامل الطبقات", en: "All Layers" },
              { id: "clean" as ArDensity, ar: "فيديو صافي", en: "Clean Video" },
            ]
          ).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setArDensity(d.id)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap ${
                arDensity === d.id ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
              }`}
            >
              {isAr ? d.ar : d.en}
            </button>
          ))}
        </div>
      </div>

      {/* Main 12-Col Broadcast Studio Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left 70%: Video AR Canvas + Docked Broadcast Telestrator Bar (no video obstruction!) */}
        <div className="xl:col-span-8 studio-panel p-3 space-y-3">
          <div className="relative rounded-lg overflow-hidden bg-black border border-white/[0.08]">
            <canvas
              ref={mainCanvasRef}
              onMouseDown={handleVideoMouseDown}
              onMouseMove={handleVideoMouseMove}
              onMouseUp={handleVideoMouseUp}
              onMouseLeave={() => {
                draggingVideoGhostRef.current = false;
                dragDrawStartRef.current = null;
                setActiveDraft(null);
              }}
              className={`w-full aspect-video object-contain bg-black block ${
                tool === "ghost"
                  ? "cursor-grab active:cursor-grabbing"
                  : tool === "spotlight" || tool === "chain"
                  ? "cursor-pointer"
                  : "cursor-crosshair"
              }`}
            />
          </div>

          {/* Docked SkyPad Broadcast Studio Bar (strictly below video frame so players stay 100% visible) */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#090D16] border border-white/[0.08] rounded-xl px-2.5 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: "spotlight" as ToolMode, icon: <Sparkles className="w-3.5 h-3.5" />, label: "Spotlight" },
                  { id: "chain" as ToolMode, icon: <Link2 className="w-3.5 h-3.5" />, label: "3D Chain" },
                  { id: "arrow" as ToolMode, icon: <ArrowUpRight className="w-3.5 h-3.5" />, label: "3D Arrow" },
                  { id: "tape" as ToolMode, icon: <Ruler className="w-3.5 h-3.5" />, label: "3D Tape" },
                  { id: "zone" as ToolMode, icon: <Circle className="w-3.5 h-3.5" />, label: "Zone" },
                  { id: "ghost" as ToolMode, icon: <Ghost className="w-3.5 h-3.5" />, label: "Ghost" },
                ]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTool(t.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition whitespace-nowrap ${
                    tool === t.id
                      ? "bg-emerald-500 text-slate-950 font-bold"
                      : "text-slate-300 hover:bg-white/[0.06]"
                  }`}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              ))}
              {tool === "chain" && (
                <button
                  type="button"
                  onClick={() => {
                    const defs = activePlayersRef.current
                      .filter((p) => p.team === (data?.defending_team || "team_b") && p.role === "player")
                      .sort((a, b) => a.y_m - b.y_m)
                      .slice(0, 4)
                      .map((p) => p.track_id);
                    setChainIds(defs);
                  }}
                  className="px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[11px] font-semibold whitespace-nowrap"
                >
                  {isAr ? "ربط رباعي الدفاع" : "Auto Back-4"}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={toggleAttackDir}
                title={isAr ? "تبديل اتجاه المرمى المستهدف" : "Flip Target Goal Side"}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] whitespace-nowrap bg-[#111827] border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/15"
              >
                <span dir="ltr">
                  {effectiveAttackGoalX >= 52.5
                    ? isAr
                      ? "يمين ▶"
                      : "Attack ▶"
                    : isAr
                    ? "◀ يسار"
                    : "◀ Attack"}
                </span>
                {attackDirOverride === "auto" && (
                  <span className="text-[10px] text-slate-400">
                    {isAr ? "(تلقائي)" : "(Auto)"}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowGoalCone((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] whitespace-nowrap ${
                  showGoalCone
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                    : "bg-[#111827] border-white/[0.08] text-slate-400"
                }`}
              >
                <Target className="w-3 h-3" />
                <span>{isAr ? "مخروط الهدف" : "Goal Cone"}</span>
              </button>
              <button
                type="button"
                onClick={() => setTurfOcclusion((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] whitespace-nowrap ${
                  turfOcclusion
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                    : "bg-[#111827] border-white/[0.08] text-slate-400"
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>{isAr ? "عزل العشب" : "Turf Key"}</span>
              </button>
              <button
                type="button"
                onClick={() => setFaceBlur((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] whitespace-nowrap ${
                  faceBlur
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                    : "bg-[#111827] border-white/[0.08] text-slate-400"
                }`}
              >
                <EyeOff className="w-3 h-3" />
                <span>{isAr ? "طمس الوجوه" : "Face Blur"}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowBallTrail((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] whitespace-nowrap ${
                  showBallTrail
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                    : "bg-[#111827] border-white/[0.08] text-slate-400"
                }`}
              >
                <span>{isAr ? "مسار الكرة" : "Ball Arc"}</span>
              </button>
              {drawings.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDrawings((d) => d.slice(0, -1))}
                  className="p-1.5 rounded-lg bg-[#111827] border border-white/[0.08] text-slate-300 hover:text-white"
                  title="Undo Drawing"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
              )}
              {(drawings.length > 0 || chainIds.length > 0 || spotlightIds.length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setDrawings([]);
                    setChainIds([]);
                    setSpotlightIds([]);
                  }}
                  className="p-1.5 rounded-lg bg-[#111827] border border-white/[0.08] text-slate-300 hover:text-red-400"
                  title="Clear Telestration"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Cinema Transport Scrubber + Live Export Actions */}
          <div className="space-y-2 px-1">
            <input
              dir="ltr"
              type="range"
              min={timelineMeta.tStart}
              max={Math.max(timelineMeta.tStart + 1, timelineMeta.tEnd)}
              step={0.04}
              value={Math.max(timelineMeta.tStart, Math.min(timelineMeta.tEnd, hudTimeS))}
              onChange={(e) => seekToTime(Number(e.target.value))}
              className="w-full accent-emerald-500 h-1.5"
            />
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => stepFrame(-1)}
                  className="p-2 rounded-lg bg-[#090D16] border border-white/[0.08] hover:border-emerald-500/50"
                  title="Frame -1"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition whitespace-nowrap"
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isPlaying ? (isAr ? "إيقاف" : "Pause") : isAr ? "تشغيل 60FPS" : "Play 60FPS"}
                </button>
                <button
                  type="button"
                  onClick={() => stepFrame(1)}
                  className="p-2 rounded-lg bg-[#090D16] border border-white/[0.08] hover:border-emerald-500/50"
                  title="Frame +1"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={resetToTacticalStart}
                  className="p-2 rounded-lg bg-[#090D16] border border-white/[0.08] hover:border-emerald-500/50"
                  title="Reset"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <span dir="ltr" className="ms-2 text-slate-400 tabular-nums whitespace-nowrap">
                  {`${hudTimeS.toFixed(2)}s / ${timelineMeta.tEnd.toFixed(1)}s`}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-white/[0.05] text-slate-300">
                  {hudPossession === "team_a"
                    ? timelineMeta.teamAName
                    : hudPossession === "team_b"
                    ? timelineMeta.teamBName
                    : isAr ? "صراع كرة" : "Contested"}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <div dir="ltr" className="flex items-center gap-1 me-1">
                  {[0.25, 0.5, 1].map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => {
                        setPlaybackRate(spd);
                        if (videoRef.current) videoRef.current.playbackRate = spd;
                      }}
                      className={`px-2 py-1 rounded-md tabular-nums whitespace-nowrap ${
                        playbackRate === spd
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                          : "bg-[#090D16] text-slate-400"
                      }`}
                    >
                      {`${spd}x`}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleLiveArRecording}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition whitespace-nowrap ${
                    recordingAr
                      ? "bg-red-500/20 border-red-500/60 text-red-300 animate-pulse"
                      : "bg-[#090D16] border-white/[0.1] text-slate-200 hover:border-emerald-500/50"
                  }`}
                >
                  {recordingAr ? <Square className="w-3 h-3" /> : <Video className="w-3 h-3 text-emerald-400" />}
                  <span>{recordingAr ? (isAr ? "إيقاف التسجيل" : "Stop Rec") : isAr ? "تسجيل AR" : "Rec AR"}</span>
                </button>
                <button
                  type="button"
                  disabled={exportingMp4}
                  onClick={handleServerMp4Export}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#090D16] border border-white/[0.1] hover:border-emerald-500/50 text-slate-200 text-[11px] font-semibold disabled:opacity-50 whitespace-nowrap"
                >
                  {exportingMp4 ? <Download className="w-3 h-3 animate-bounce text-emerald-400" /> : <Film className="w-3 h-3 text-emerald-400" />}
                  <span>{exportingMp4 ? (isAr ? "تصدير..." : "Exporting...") : isAr ? "تصدير AR MP4" : "Export AR MP4"}</span>
                </button>
                <button
                  type="button"
                  disabled={loadingHls}
                  onClick={enableGopHlsStream}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap transition ${
                    hlsActive
                      ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                      : "bg-[#090D16] border-white/[0.1] hover:border-emerald-500/50 text-slate-200"
                  }`}
                >
                  <Radio className={`w-3 h-3 ${hlsActive ? "text-emerald-400" : "text-sky-400"}`} />
                  <span>{loadingHls ? "HLS..." : hlsActive ? "HLS Active" : isAr ? "بث HLS سريع" : "GOP HLS"}</span>
                </button>
                <button
                  type="button"
                  onClick={toggleOpponentDossier}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap transition ${
                    showDossier
                      ? "bg-sky-500/20 border-sky-400/50 text-sky-300"
                      : "bg-[#090D16] border-white/[0.1] hover:border-sky-400/50 text-slate-200"
                  }`}
                >
                  <FileText className="w-3 h-3 text-sky-400" />
                  <span>{isAr ? "ملف الخصم" : "Opponent Dossier"}</span>
                </button>
              </div>
            </div>
            {exportNote && <div className="text-[11px] text-emerald-400 px-1">{exportNote}</div>}
            {showDossier && opponentDossier && (
              <div className="mt-2 p-3.5 rounded-xl bg-[#090D16] border border-sky-500/30 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-sky-300">
                    {isAr ? "ملخص تحليل الخصم من اللقطات المحلّلة" : "Grounded Opponent Analysis Dossier"}
                  </div>
                  {opponentDossier.scoreboard_latest && (
                    <span dir="ltr" className="px-2 py-0.5 rounded bg-white/[0.06] text-slate-200 font-bold tabular-nums">
                      Score: {opponentDossier.scoreboard_latest}
                    </span>
                  )}
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {isAr ? opponentDossier.summary_ar : opponentDossier.summary_en}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div className="bg-[#0C1220] border border-white/[0.06] rounded-lg p-2.5 space-y-1">
                    <div className="font-semibold text-emerald-400 text-[11px]">
                      {isAr ? "الأنماط الهجومية المرصودة" : "Observed Attacking Patterns"}
                    </div>
                    {opponentDossier.attacking_patterns.slice(0, 3).map((ev, idx) => (
                      <div key={idx} className="text-[11px] text-slate-300">
                        • <b dir="ltr">{ev.time_s.toFixed(1)}s</b> — {isAr ? ev.title_ar : ev.title_en}
                      </div>
                    ))}
                  </div>
                  <div className="bg-[#0C1220] border border-white/[0.06] rounded-lg p-2.5 space-y-1">
                    <div className="font-semibold text-amber-400 text-[11px]">
                      {isAr ? "ثغرات التحول الدفاعي" : "Defensive Transition Vulnerabilities"}
                    </div>
                    {opponentDossier.defensive_transitions.slice(0, 3).map((ev, idx) => (
                      <div key={idx} className="text-[11px] text-slate-300">
                        • <b dir="ltr">{ev.time_s.toFixed(1)}s</b> — {isAr ? ev.title_ar : ev.title_en}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right 30%: 2D/3D/Player-POV Pitch Twin + Ghost + Set-Piece Innovation Lab */}
        <div className="xl:col-span-4 space-y-4">
          <div className="studio-panel p-4 space-y-3">
            <TacticalTwinCanvas
              lang={lang}
              players={twinPlayers}
              ball={twinBall}
              fallbackBallXY={data?.ball_xy || [60, 34]}
              attackingTeam={data?.attacking_team || "team_a"}
              defendingTeam={data?.defending_team || "team_b"}
              attackGoalX={effectiveAttackGoalX}
              teamAHex={data?.kit_colors?.team_a_hex || "#EF4444"}
              teamBHex={data?.kit_colors?.team_b_hex || "#38BDF8"}
              teamAName={timelineMeta.teamAName}
              teamBName={timelineMeta.teamBName}
              selectedDefId={selectedDefId}
              ghostDx={ghostDx}
              ghostDy={ghostDy}
              boxControlPct={liveMetrics.boxControlPct}
              isPlaying={isPlaying}
              isCloseUp={isCloseUpUi}
              chainIds={chainIds}
              setPieceSim={setPieceSim}
              onSelectPlayer={(tid) => setSelectedDefId(tid)}
              onGhostPitchMove={(px, py, commit, tid) => {
                if (videoRef.current && !videoRef.current.paused) {
                  videoRef.current.pause();
                  setIsPlaying(false);
                }
                const target = tid ?? selectedDefId;
                if (target !== null) applyGhostAtPitch(px, py, target, commit);
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              {!isReadOnly && data?.suggested_ghost_move && (
                <button
                  type="button"
                  onClick={applySuggestedGhost}
                  className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold whitespace-nowrap transition"
                >
                  {isAr ? "تحسين تلقائي (What-If)" : "Auto-Optimize What-If"}
                </button>
              )}
              {(ghostDx !== 0 || ghostDy !== 0) && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedDefId !== null) {
                      const def = activePlayersRef.current.find((p) => p.track_id === selectedDefId);
                      if (def) applyGhostAtPitch(def.x_m, def.y_m, selectedDefId, false);
                    } else {
                      setGhostDx(0);
                      setGhostDy(0);
                    }
                  }}
                  className="px-2.5 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 text-[11px] whitespace-nowrap transition"
                >
                  {isAr ? "إعادة (0,0)" : "Reset Ghost"}
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-2.5">
                <div className="text-[11px] text-slate-400">
                  {isPlaying ? (isAr ? "السيطرة الهجومية" : "Zone Control") : isAr ? "إزاحة المدافع" : "Ghost Offset"}
                </div>
                <div dir="ltr" className="font-bold text-emerald-400 mt-0.5 inline-block">
                  {isPlaying
                    ? isCloseUpUi ? "—" : `${liveMetrics.boxControlPct}%`
                    : `ΔX ${ghostDx > 0 ? "+" : ""}${ghostDx}m • ΔY ${ghostDy > 0 ? "+" : ""}${ghostDy}m`}
                </div>
              </div>
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-2.5">
                <div className="text-[11px] text-slate-400">
                  {isAr ? (
                    <>
                      تغيّر خطورة التسديد <bdi dir="ltr">(xG)</bdi>
                    </>
                  ) : (
                    "Shot xG Impact"
                  )}
                </div>
                <div dir="ltr" className="font-bold text-white mt-0.5 inline-block">
                  {isCloseUpUi
                    ? "—"
                    : isPlaying
                    ? `${liveMetrics.xg}`
                    : `${baseMetrics.xg} → ${liveMetrics.xg} (${xgDeltaPct > 0 ? "+" : ""}${xgDeltaPct}%)`}
                </div>
              </div>
            </div>
          </div>

          {/* Wave 5 Set-Piece Kinematic Sandbox (animates directly inside Twin Canvas!) */}
          <div className="studio-panel p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-white">
                {isAr ? "مختبر الكرات الثابتة (محاكاة فيزيائية)" : "Set-Piece Kinematic Lab"}
              </span>
              <button
                type="button"
                disabled={simulatingSetPiece}
                onClick={async () => {
                  setSimulatingSetPiece(true);
                  try {
                    const r = await apiFetch<SetPieceSimState>(
                      "/api/tactics/innovation/simulate",
                      { method: "POST", body: JSON.stringify({ n_candidates: 20, rollouts_per_candidate: 300 }) },
                      "club_demo_egypt",
                      role
                    );
                    setSetPieceSim(r);
                  } finally {
                    setSimulatingSetPiece(false);
                  }
                }}
                className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 font-semibold disabled:opacity-50"
              >
                {simulatingSetPiece ? (isAr ? "جاري..." : "Running...") : isAr ? "تشغيل 6,000 محاكاة" : "Run 6,000 Rollouts"}
              </button>
            </div>
            {setPieceSim ? (
              <div className="grid grid-cols-2 gap-2 tabular-nums">
                <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-2">
                  <div className="text-[11px] text-slate-400">{isAr ? "احتمال الهدف (أساسي ← محسّن)" : "Goal Prob (Base → Opt)"}</div>
                  <div dir="ltr" className="font-bold text-emerald-400 mt-0.5 inline-block">
                    {`${setPieceSim.baseline_goal_prob_pct}% → ${setPieceSim.optimized_goal_prob_pct}% (+${setPieceSim.uplift_pct_points}%)`}
                  </div>
                </div>
                <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-2">
                  <div className="text-[11px] text-slate-400">{isAr ? "نقطة السقوط المثلى" : "Optimal Target Zone"}</div>
                  <div dir="ltr" className="font-bold text-white mt-0.5 inline-block">
                    {`(${setPieceSim.target_zone_xy[0]}m, ${setPieceSim.target_zone_xy[1]}m)`}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400">
                {isAr ? (
                  <>
                    يختبر 6,000 سيناريو ركنية بزمن رد فعل <bdi dir="ltr">250ms</bdi> ويرسم التمويه ونقطة السقوط على الملعب.
                  </>
                ) : (
                  "Simulates 6,000 corner rollouts (250ms human cue) and animates the routine on the Twin Pitch."
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section Below Studio: Oracle Match Momentum + UEFA 4-Moment Events + Grounded Coach Brief & Playbook */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Interactive Oracle Momentum & Clickable UEFA 4-Moment Strip */}
        <div className="xl:col-span-7 studio-panel p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <h2 className="text-sm font-bold text-white">
                {isAr ? "زخم المباراة والأحداث المكتشفة (Oracle Momentum + UEFA 4-Moments)" : "Oracle Match Momentum & Detected Moments"}
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isAr ? "اضغط على أي شريط زخم أو لحظة للقفز الفوري للفريم داخل استوديو البث." : "Click any momentum bar or moment pill to jump straight to that timestamp."}
              </p>
            </div>
            {momentsBrief && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.05] text-slate-300 tabular-nums">
                {momentsBrief.verified_goals.length > 0
                  ? isAr
                    ? `${momentsBrief.verified_goals.length} أهداف موثّقة (لوحة النتيجة)`
                    : `${momentsBrief.verified_goals.length} Scoreboard-Verified Goals`
                  : isAr
                  ? `فحص لوحة النتيجة: 0 أهداف بالمقطع${momentsBrief.scoreboard_latest ? ` (${momentsBrief.scoreboard_latest})` : ""}`
                  : `Scoreboard Verified: 0 Goals${momentsBrief.scoreboard_latest ? ` (${momentsBrief.scoreboard_latest})` : ""}`}
              </span>
            )}
          </div>

          {/* Interactive Apache ECharts Oracle Match Momentum (Click to Seek!) */}
          {timelineMeta.frames.length > 0 && (
            <div dir="ltr" className="bg-[#090D16] border border-white/[0.06] rounded-lg p-2.5">
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                <span>{timelineMeta.teamAName}</span>
                <span>{isAr ? "مخطط زخم المباراة التفاعلي (Apache ECharts)" : "Interactive Oracle Momentum (Apache ECharts)"}</span>
                <span>{timelineMeta.teamBName}</span>
              </div>
              <EChartsMatchMomentum
                frames={timelineMeta.frames}
                currentTimeS={hudTimeS}
                teamAName={timelineMeta.teamAName}
                teamBName={timelineMeta.teamBName}
                teamAHex={data?.kit_colors?.team_a_hex || "#EF4444"}
                teamBHex={data?.kit_colors?.team_b_hex || "#38BDF8"}
                onSeek={seekToTime}
              />
            </div>
          )}

          {/* Clickable Moments Strip + Pose Resolution Gate Pills */}
          {momentsBrief && momentsBrief.events.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {momentsBrief.events.slice(0, 10).map((ev, i) => (
                <button
                  key={`${ev.frame_id}-${i}`}
                  type="button"
                  onClick={() => {
                    if (ev.track_id !== null) setSelectedDefId(ev.track_id);
                    seekToTime(ev.time_s);
                  }}
                  className="text-start px-2.5 py-1.5 rounded-lg bg-[#090D16] border border-white/[0.08] hover:border-emerald-500/50 transition"
                >
                  <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                    <span dir="ltr" className="text-emerald-400 tabular-nums">{`${ev.time_s.toFixed(1)}s`}</span>
                    <span>{isAr ? ev.title_ar : ev.title_en}</span>
                  </div>
                  <div dir="ltr" className="text-[10px] text-slate-400 mt-0.5">{ev.metric_proof}</div>
                </button>
              ))}
            </div>
          )}

          {momentsBrief && momentsBrief.pose_assessments.length > 0 && (
            <div className="border-t border-white/[0.06] pt-3 space-y-1.5 text-[11px]">
              <div className="font-semibold text-slate-300">
                {isAr
                  ? "تقييم وضعية الجذع (YOLO11-Pose) — فحص مسح الرأس مفعّل للقطات القريبة (+75px):"
                  : "Event-Triggered Torso Pose (YOLO11-Pose) — Head Scanning enabled >= 75px:"}
              </div>
              <div className="flex flex-wrap gap-2">
                {momentsBrief.pose_assessments.map((pa) => (
                  <div key={`${pa.frame_id}-${pa.track_id}`} className="bg-[#090D16] border border-white/[0.06] rounded-md px-2.5 py-1 text-slate-300">
                    <span dir="ltr" className="font-bold text-emerald-400">{`#${pa.track_id}`}</span>
                    <span className="mx-1">•</span>
                    <span>{pa.torso_orientation === "open_to_pitch" ? (isAr ? "جسم مفتوح" : "Open Torso") : isAr ? "مغلق للخط" : "Closed"}</span>
                    <span className="mx-1 text-slate-500">|</span>
                    <span dir="ltr" className="text-slate-400">{`${pa.bbox_height_px}px`}</span>
                    {pa.pose_engine === "yolo11n-pose" && (
                      <span className="ms-1.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-bold">
                        YOLO11-Pose
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Grounded Coach Brief (3 points) & Diagnostic Playbook */}
        <div className="xl:col-span-5 studio-panel p-4 space-y-3 text-xs">
          {momentsBrief && momentsBrief.coach_brief.length > 0 && (
            <div className="space-y-2">
              <div className="font-bold text-white text-sm">
                {isAr ? "ملخص ما بين الشوطين الموثّق (Grounded Coach Brief)" : "Grounded Half-Time Coach Brief"}
              </div>
              {momentsBrief.coach_brief.map((b) => (
                <div key={b.id} className="bg-[#090D16] border border-white/[0.06] rounded-lg p-2.5">
                  <div className="font-semibold text-emerald-400">{isAr ? b.title_ar : b.title_en}</div>
                  <div className="text-slate-300 mt-0.5 leading-relaxed">{isAr ? b.detail_ar : b.detail_en}</div>
                </div>
              ))}
            </div>
          )}

          {data && data.diagnoses.length > 0 && (
            <div className="space-y-2 border-t border-white/[0.06] pt-3">
              <div className="font-bold text-white">
                {isAr ? "دليل الحلول الهندسية (3 خيارات بالمخاطرة)" : "Measured Tactical Playbook"}
              </div>
              {data.diagnoses.map((d) => (
                <div key={d.code} className="space-y-1.5">
                  <div className="font-semibold text-amber-300">{isAr ? d.title_ar : d.title_en}</div>
                  <div className="text-[11px] text-slate-400">{isAr ? d.evidence_ar : d.evidence_en}</div>
                  {d.options.map((opt) => (
                    <div key={opt.style} className="bg-[#090D16] border border-white/[0.06] rounded-lg p-2 text-[11px]">
                      <div className="font-semibold text-slate-100">{isAr ? opt.title_ar : opt.title_en}</div>
                      <div className="text-slate-300 mt-0.5">{isAr ? opt.action_ar : opt.action_en}</div>
                      <div className="text-amber-400/90 mt-0.5">
                        {isAr ? `المخاطرة: ${opt.risk_ar}` : `Risk: ${opt.risk_en}`}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
