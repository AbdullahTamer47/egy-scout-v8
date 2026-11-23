"use client";

import React, { useEffect, useRef, useState } from "react";
import { Box, Compass, Eye, RotateCcw, Zap } from "lucide-react";
import ThreePitchTwin from "@/components/ThreePitchTwin";
import GlossaryTooltip from "@/components/GlossaryTooltip";
import { MomentStatePayload, TimelineBall } from "@/lib/api";
import { hexToRgba, RenderPlayer } from "@/lib/broadcastRenderer";

export type TwinViewMode = "2d" | "3d" | "pov";

export interface SetPieceSimState {
  simulations_run: number;
  baseline_goal_prob_pct: number;
  optimized_goal_prob_pct: number;
  uplift_pct_points: number;
  target_zone_xy: [number, number];
  decoy_run_vector: [number, number];
}

interface Props {
  lang: "ar" | "en";
  players: RenderPlayer[];
  ball: TimelineBall | null;
  fallbackBallXY: [number, number];
  attackingTeam: string;
  defendingTeam: string;
  attackGoalX?: number;
  teamAHex: string;
  teamBHex: string;
  teamAName: string;
  teamBName: string;
  selectedDefId: number | null;
  ghostDx: number;
  ghostDy: number;
  boxControlPct: number;
  isPlaying: boolean;
  isCloseUp: boolean;
  chainIds: number[];
  setPieceSim: SetPieceSimState | null;
  momentState?: MomentStatePayload | null;
  onSelectPlayer?: (trackId: number) => void;
  onGhostPitchMove?: (pitchX: number, pitchY: number, commit: boolean, trackId?: number) => void;
}

/** Right-handed 3D pinhole projector from pitch coordinates (x in [0..105], y in [0..68], z in m) -> screen. */
function project3D(
  x: number,
  y: number,
  z: number,
  camX: number,
  camY: number,
  camZ: number,
  yawRad: number,
  tiltDownRad: number,
  W: number,
  H: number,
  fovScale: number
): { sx: number; sy: number; depth: number; scale: number } | null {
  const dx = x - camX;
  const dy = y - camY;
  const dz = z - camZ;

  const cy = Math.cos(yawRad);
  const sy = Math.sin(yawRad);
  const ct = Math.cos(tiltDownRad);
  const st = Math.sin(tiltDownRad);

  const fx = cy * ct;
  const fy = sy * ct;
  const fz = -st;

  const rx = -sy;
  const ry = cy;

  const ux = cy * st;
  const uy = sy * st;
  const uz = ct;

  const forward = dx * fx + dy * fy + dz * fz;
  if (forward <= 1.0) return null;

  const right = dx * rx + dy * ry;
  const up = dx * ux + dy * uy + dz * uz;
  const scale = fovScale / forward;

  return {
    sx: W * 0.5 + right * scale,
    sy: H * 0.50 - up * scale,
    depth: forward,
    scale,
  };
}

export default function TacticalTwinCanvas({
  lang,
  players,
  ball,
  fallbackBallXY,
  attackingTeam,
  defendingTeam,
  attackGoalX = 105,
  teamAHex,
  teamBHex,
  teamAName,
  teamBName,
  selectedDefId,
  ghostDx,
  ghostDy,
  boxControlPct,
  isPlaying,
  isCloseUp,
  chainIds,
  setPieceSim,
  momentState = null,
  onSelectPlayer,
  onGhostPitchMove,
}: Props) {
  const isAr = lang === "ar";
  const [viewMode, setViewMode] = useState<TwinViewMode>("2d");
  const [showFormationLines, setShowFormationLines] = useState(true);
  const [showPassingChannels, setShowPassingChannels] = useState(true);
  const [showCorrectionArrows, setShowCorrectionArrows] = useState(true);
  const [showZone14, setShowZone14] = useState(true);
  const [performanceMode, setPerformanceMode] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingGhostRef = useRef(false);
  const orbitingRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });
  const cameraRef = useRef({ yawDeg: 0, pitchDeg: 32, zoom: 1.0 });

  const latestRef = useRef({
    players,
    ball,
    fallbackBallXY,
    attackingTeam,
    defendingTeam,
    attackGoalX,
    teamAHex,
    teamBHex,
    selectedDefId,
    ghostDx,
    ghostDy,
    isPlaying,
    isCloseUp,
    chainIds,
    setPieceSim,
    momentState,
    showFormationLines,
    showPassingChannels,
    showCorrectionArrows,
    showZone14,
    viewMode,
  });
  latestRef.current = {
    players,
    ball,
    fallbackBallXY,
    attackingTeam,
    defendingTeam,
    attackGoalX,
    teamAHex,
    teamBHex,
    selectedDefId,
    ghostDx,
    ghostDy,
    isPlaying,
    isCloseUp,
    chainIds,
    setPieceSim,
    momentState,
    showFormationLines,
    showPassingChannels,
    showCorrectionArrows,
    showZone14,
    viewMode,
  };

  const forceDrawRef = useRef(true);

  useEffect(() => {
    forceDrawRef.current = true;
  }, [
    players,
    ball,
    fallbackBallXY,
    attackingTeam,
    defendingTeam,
    attackGoalX,
    selectedDefId,
    ghostDx,
    ghostDy,
    isPlaying,
    isCloseUp,
    chainIds,
    setPieceSim,
    momentState,
    showFormationLines,
    showPassingChannels,
    showCorrectionArrows,
    showZone14,
    viewMode,
  ]);

  useEffect(() => {
    let rafId = 0;
    let lastDrawTs = 0;

    const renderFrame = (now: number) => {
      const st = latestRef.current;
      const shouldDraw =
        forceDrawRef.current ||
        st.isPlaying ||
        Boolean(st.setPieceSim) ||
        draggingGhostRef.current ||
        orbitingRef.current.active ||
        now - lastDrawTs >= 120;

      if (shouldDraw) {
        forceDrawRef.current = false;
        lastDrawTs = now;
        const cvs = canvasRef.current;
        if (cvs) {
          const ctx = cvs.getContext("2d");
          if (ctx) {
            const W = cvs.width;
            const H = cvs.height;
            const bPos: [number, number] = st.ball
              ? [st.ball.x_m, st.ball.y_m]
              : st.fallbackBallXY;
            const bz = st.ball?.z_m ?? 0;

            if (st.viewMode === "2d") {
              draw2DPitch(ctx, W, H, st, bPos, now);
            } else {
              draw3DPitchOrPov(ctx, W, H, st, bPos, bz, cameraRef.current, now);
            }
          }
        }
      }
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    if (viewMode === "2d") {
      const rect = cvs.getBoundingClientRect();
      const pad = 12;
      const rx = (((e.clientX - rect.left) / rect.width) * cvs.width - pad) / (cvs.width - pad * 2) * 105;
      const ry = (((e.clientY - rect.top) / rect.height) * cvs.height - pad) / (cvs.height - pad * 2) * 68;
      // Allow selecting & dragging ANY player or goalkeeper from BOTH teams (own club + opponent)!
      let hit: (typeof players)[number] | undefined;
      let bestDist = 5.5;
      for (const p of players) {
        if (p.role !== "player" && p.role !== "goalkeeper") continue;
        const d = Math.hypot(p.x_m - rx, p.y_m - ry);
        if (d < bestDist) {
          bestDist = d;
          hit = p;
        }
      }
      const activeId = hit ? hit.track_id : selectedDefId;
      if (hit && onSelectPlayer) onSelectPlayer(hit.track_id);
      if (activeId !== null && onGhostPitchMove) {
        draggingGhostRef.current = true;
        onGhostPitchMove(rx, ry, false, activeId);
      }
    } else {
      orbitingRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    if (viewMode === "2d") {
      if (!draggingGhostRef.current || selectedDefId === null || !onGhostPitchMove) return;
      const rect = cvs.getBoundingClientRect();
      const pad = 12;
      const rx = (((e.clientX - rect.left) / rect.width) * cvs.width - pad) / (cvs.width - pad * 2) * 105;
      const ry = (((e.clientY - rect.top) / rect.height) * cvs.height - pad) / (cvs.height - pad * 2) * 68;
      onGhostPitchMove(rx, ry, false, selectedDefId);
    } else if (orbitingRef.current.active) {
      const dx = e.clientX - orbitingRef.current.lastX;
      const dy = e.clientY - orbitingRef.current.lastY;
      orbitingRef.current.lastX = e.clientX;
      orbitingRef.current.lastY = e.clientY;
      cameraRef.current.yawDeg = Math.max(-75, Math.min(75, cameraRef.current.yawDeg + dx * 0.35));
      cameraRef.current.pitchDeg = Math.max(18, Math.min(65, cameraRef.current.pitchDeg + dy * 0.25));
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current;
    if (viewMode === "2d" && draggingGhostRef.current && selectedDefId !== null && cvs && onGhostPitchMove) {
      draggingGhostRef.current = false;
      const rect = cvs.getBoundingClientRect();
      const pad = 12;
      const rx = (((e.clientX - rect.left) / rect.width) * cvs.width - pad) / (cvs.width - pad * 2) * 105;
      const ry = (((e.clientY - rect.top) / rect.height) * cvs.height - pad) / (cvs.height - pad * 2) * 68;
      onGhostPitchMove(rx, ry, true, selectedDefId);
    }
    orbitingRef.current.active = false;
    draggingGhostRef.current = false;
  };

  return (
    <div className="space-y-2.5">
      {/* Live Kit Swatches & 2D/3D/Player-POV Switcher Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
            <span className="w-2.5 h-2.5 rounded-full border border-white/40" style={{ backgroundColor: teamAHex }} />
            <span className="truncate max-w-[90px]">{teamAName}</span>
          </span>
          <span className="text-slate-500 text-[10px]">vs</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
            <span className="w-2.5 h-2.5 rounded-full border border-white/40" style={{ backgroundColor: teamBHex }} />
            <span className="truncate max-w-[90px]">{teamBName}</span>
          </span>
        </div>

        <div className="flex items-center gap-1 bg-[#090D16] border border-white/[0.08] rounded-lg p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setViewMode("2d")}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md font-semibold transition ${
              viewMode === "2d" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <Compass className="w-3 h-3" />
            <span>2D</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("3d")}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md font-semibold transition ${
              viewMode === "3d" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <Box className="w-3 h-3" />
            <span>3D Twin</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("pov")}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md font-semibold transition ${
              viewMode === "pov" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <Eye className="w-3 h-3" />
            <GlossaryTooltip term="player_pov" lang={lang}>
              <span>Player-POV</span>
            </GlossaryTooltip>
          </button>
          {viewMode !== "2d" && (
            <button
              type="button"
              onClick={() => setPerformanceMode((v) => !v)}
              className={`inline-flex items-center gap-0.5 px-1.5 py-1 rounded-md text-[10px] font-bold transition ${
                performanceMode
                  ? "bg-amber-400 text-slate-950"
                  : "text-slate-400 hover:text-amber-300"
              }`}
              title={isAr ? "وضع الأداء السريع (تقليل الظلال للأجهزة الضعيفة)" : "Performance Mode (Disable 3D Shadows)"}
            >
              <Zap className="w-3 h-3" />
              <span>{isAr ? "سريع" : "Perf"}</span>
            </button>
          )}
          {viewMode === "3d" && (
            <button
              type="button"
              onClick={() => {
                cameraRef.current = { yawDeg: 0, pitchDeg: 32, zoom: 1.0 };
              }}
              className="p-1 text-slate-400 hover:text-emerald-400"
              title="Reset 3D Camera"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tactical Plan Drawing Layer Toggles */}
      {viewMode === "2d" && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <button
            type="button"
            onClick={() => setShowFormationLines((v) => !v)}
            className={`px-2 py-0.5 rounded border font-semibold transition ${
              showFormationLines
                ? "bg-emerald-500/20 border-emerald-500/45 text-emerald-300"
                : "bg-[#090D16] border-white/[0.08] text-slate-500"
            }`}
          >
            {isAr ? "📐 خطوط التشكيل" : "📐 Formation Lines"}
          </button>
          <button
            type="button"
            onClick={() => setShowPassingChannels((v) => !v)}
            className={`px-2 py-0.5 rounded border font-semibold transition ${
              showPassingChannels
                ? "bg-sky-500/20 border-sky-500/45 text-sky-300"
                : "bg-[#090D16] border-white/[0.08] text-slate-500"
            }`}
          >
            {isAr ? "📡 قنوات التمرير" : "📡 Pass Channels"}
          </button>
          <button
            type="button"
            onClick={() => setShowCorrectionArrows((v) => !v)}
            className={`px-2 py-0.5 rounded border font-semibold transition ${
              showCorrectionArrows
                ? "bg-amber-500/20 border-amber-500/45 text-amber-300"
                : "bg-[#090D16] border-white/[0.08] text-slate-500"
            }`}
          >
            {isAr ? "♟️ أسهم التصحيح" : "♟️ Correction Vectors"}
          </button>
          <button
            type="button"
            onClick={() => setShowZone14((v) => !v)}
            className={`px-2 py-0.5 rounded border font-semibold transition ${
              showZone14
                ? "bg-purple-500/20 border-purple-500/45 text-purple-300"
                : "bg-[#090D16] border-white/[0.08] text-slate-500"
            }`}
          >
            Zone 14
          </button>
        </div>
      )}

      {/* Twin Canvas: 2D Tactical Pitch Control Board OR Real Three.js 3D WebGL Stadium / Player-POV */}
      <div className="relative rounded-lg overflow-hidden border border-white/[0.08] bg-[#071A14]">
        {viewMode === "2d" ? (
          <canvas
            ref={canvasRef}
            width={440}
            height={285}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              draggingGhostRef.current = false;
              orbitingRef.current.active = false;
            }}
            className="w-full block cursor-grab active:cursor-grabbing"
          />
        ) : (
          <ThreePitchTwin
            key={performanceMode ? "perf" : "hq"}
            mode={viewMode}
            players={players}
            ball={ball}
            fallbackBallXY={fallbackBallXY}
            attackGoalX={attackGoalX}
            teamAHex={teamAHex}
            teamBHex={teamBHex}
            selectedDefId={selectedDefId}
            ghostDx={ghostDx}
            ghostDy={ghostDy}
            chainIds={chainIds}
            setPieceSim={setPieceSim}
            performanceMode={performanceMode}
          />
        )}

        {/* Box Control HUD Chip in corner */}
        {!isCloseUp && (
          <div
            dir="ltr"
            className="absolute top-2 right-2 bg-[#090D16]/85 border border-white/[0.12] rounded-md px-2 py-0.5 text-[11px] font-bold text-emerald-400 tabular-nums pointer-events-none"
          >
            {`Box ${boxControlPct}%`}
          </div>
        )}

        {viewMode !== "2d" && !isCloseUp && (
          <div className="absolute bottom-2 left-2 bg-[#090D16]/80 border border-white/[0.1] rounded-md px-2 py-0.5 text-[10px] text-slate-300 pointer-events-none">
            {viewMode === "3d"
              ? isAr ? "اسحب لتدوير الملعب ثلاثي الأبعاد" : "Drag to orbit 3D pitch"
              : isAr ? `كاميرا عين اللاعب #${selectedDefId ?? "—"}` : `Player #${selectedDefId ?? "—"} POV`}
          </div>
        )}

        {isCloseUp && (
          <div className="absolute inset-0 bg-[#090D16]/75 backdrop-blur-[2px] flex items-center justify-center p-4 text-center">
            <span className="text-xs font-medium text-slate-300 bg-[#111827] border border-white/[0.1] px-3 py-1.5 rounded-full">
              {isAr ? "لقطة قريبة — تم إخفاء طبقة الملعب بسلاسة" : "Close-up shot — Pitch overlay smoothly hidden"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function computeInstantTeamLines(
  players: RenderPlayer[],
  team: string,
  attacksRight: boolean
): { shape: string; lines: RenderPlayer[][] } {
  const outfield = players.filter((p) => p.team === team && p.role === "player");
  if (outfield.length === 0) return { shape: "—", lines: [] };
  const sortedX = [...outfield].sort((a, b) => (attacksRight ? a.x_m - b.x_m : b.x_m - a.x_m));
  const n = sortedX.length;
  let groups: RenderPlayer[][] = [];
  if (n <= 3) {
    groups = [sortedX];
  } else if (n <= 6) {
    const mid = Math.ceil(n / 2);
    groups = [sortedX.slice(0, mid), sortedX.slice(mid)];
  } else {
    const s1 = Math.min(4, Math.max(2, Math.round(n * 0.4)));
    const s2 = Math.min(n - 1, s1 + Math.max(2, Math.round((n - s1) * 0.55)));
    groups = [sortedX.slice(0, s1), sortedX.slice(s1, s2), sortedX.slice(s2)];
  }
  const latGroups = groups
    .filter((g) => g.length > 0)
    .map((g) => [...g].sort((a, b) => a.y_m - b.y_m));
  const shape = latGroups.map((g) => g.length).join("-");
  return { shape, lines: latGroups };
}

function draw2DPitch(
  pctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  st: {
    players: RenderPlayer[];
    ball: TimelineBall | null;
    attackingTeam: string;
    defendingTeam: string;
    attackGoalX: number;
    teamAHex: string;
    teamBHex: string;
    selectedDefId: number | null;
    ghostDx: number;
    ghostDy: number;
    isPlaying: boolean;
    isCloseUp: boolean;
    chainIds: number[];
    setPieceSim: SetPieceSimState | null;
    momentState?: MomentStatePayload | null;
    showFormationLines?: boolean;
    showPassingChannels?: boolean;
    showCorrectionArrows?: boolean;
    showZone14?: boolean;
  },
  ballXY: [number, number],
  now: number
) {
  const pad = 12;
  const pw = W - pad * 2;
  const ph = H - pad * 2;

  // Mowed grass stripes
  pctx.fillStyle = "#08221A";
  pctx.fillRect(0, 0, W, H);
  const nStripes = 10;
  for (let i = 0; i < nStripes; i++) {
    if (i % 2 === 0) {
      pctx.fillStyle = "#0B2C22";
      pctx.fillRect(pad + (i * pw) / nStripes, pad, pw / nStripes, ph);
    }
  }

  // Smooth Gaussian Pitch Control Heat Map
  if (!st.isCloseUp && st.players.length > 0) {
    for (const p of st.players) {
      if (p.role !== "player" && p.role !== "goalkeeper") continue;
      const applyGhost = !st.isPlaying && p.track_id === st.selectedDefId;
      const mx = Math.max(0, Math.min(105, p.x_m + (applyGhost ? st.ghostDx : 0)));
      const my = Math.max(0, Math.min(68, p.y_m + (applyGhost ? st.ghostDy : 0)));
      const px = pad + (mx / 105) * pw;
      const py = pad + (my / 68) * ph;
      const rad = W * 0.175;
      const hex = p.team === "team_a" ? st.teamAHex : st.teamBHex;
      const grad = pctx.createRadialGradient(px, py, 2, px, py, rad);
      grad.addColorStop(0, hexToRgba(hex, 0.30));
      grad.addColorStop(1, hexToRgba(hex, 0));
      pctx.fillStyle = grad;
      pctx.beginPath();
      pctx.arc(px, py, rad, 0, Math.PI * 2);
      pctx.fill();
    }
  }

  // Crisp FIFA Pitch Lines + 18-yd & 6-yd Boxes + Goals
  pctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  pctx.lineWidth = 1.25;
  pctx.strokeRect(pad, pad, pw, ph);
  pctx.beginPath();
  pctx.moveTo(W / 2, pad);
  pctx.lineTo(W / 2, H - pad);
  pctx.stroke();
  pctx.beginPath();
  pctx.arc(W / 2, H / 2, ph * 0.135, 0, Math.PI * 2);
  pctx.stroke();

  const boxW = pw * (16.5 / 105);
  const boxH = ph * (40.32 / 68);
  const sixW = pw * (5.5 / 105);
  const sixH = ph * (18.32 / 68);
  pctx.strokeRect(pad, (H - boxH) / 2, boxW, boxH);
  pctx.strokeRect(W - pad - boxW, (H - boxH) / 2, boxW, boxH);
  pctx.strokeRect(pad, (H - sixH) / 2, sixW, sixH);
  pctx.strokeRect(W - pad - sixW, (H - sixH) / 2, sixW, sixH);

  // Highlight Target Attacking Goal + Corner Direction Banner
  const attacksRight = st.attackGoalX >= 52.5;
  pctx.fillStyle = "rgba(16, 185, 129, 0.25)";
  pctx.fillRect(attacksRight ? W - pad - 2 : pad - 2, (H - sixH * 0.42) / 2, 4, sixH * 0.42);
  pctx.fillStyle = "rgba(110, 231, 183, 0.72)";
  pctx.font = "700 9.5px Inter, sans-serif";
  pctx.textAlign = "center";
  pctx.fillText(attacksRight ? "ATT ▶" : "◀ ATT", W * 0.5, pad + 11);

  // 1. Zone 14 Tactical Box Overlay
  if (st.showZone14 !== false && !st.isCloseUp) {
    const z14X1 = attacksRight ? 68.0 : 105.0 - 88.5;
    const z14X2 = attacksRight ? 88.5 : 105.0 - 68.0;
    const zx1 = pad + (z14X1 / 105) * pw;
    const zx2 = pad + (z14X2 / 105) * pw;
    const zy1 = pad + (22.0 / 68) * ph;
    const zy2 = pad + (46.0 / 68) * ph;
    pctx.save();
    pctx.fillStyle = "rgba(250, 204, 21, 0.09)";
    pctx.strokeStyle = "rgba(250, 204, 21, 0.48)";
    pctx.lineWidth = 1.2;
    pctx.setLineDash([4, 3]);
    pctx.fillRect(zx1, zy1, zx2 - zx1, zy2 - zy1);
    pctx.strokeRect(zx1, zy1, zx2 - zx1, zy2 - zy1);
    pctx.setLineDash([]);
    pctx.fillStyle = "rgba(250, 204, 21, 0.85)";
    pctx.font = "700 8.5px Inter, sans-serif";
    pctx.textAlign = "center";
    pctx.fillText("ZONE 14", (zx1 + zx2) * 0.5, zy1 + 9);
    pctx.restore();
  }

  // Subtle Set-Piece Kinematic Simulation Animated Overlay (automatically mirrors for Left/Right goal!)
  if (st.setPieceSim) {
    const [rawTx, ty] = st.setPieceSim.target_zone_xy;
    const [rawDxDec, dyDec] = st.setPieceSim.decoy_run_vector;
    const tx = attacksRight ? rawTx : 105 - rawTx;
    const dxDec = attacksRight ? rawDxDec : -rawDxDec;
    const cornerX = attacksRight ? pad + pw : pad;
    const cornerY = ty <= 34 ? pad : pad + ph;
    const targetPx = pad + (tx / 105) * pw;
    const targetPy = pad + (ty / 68) * ph;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);

    pctx.save();
    pctx.fillStyle = `rgba(16, 185, 129, ${0.18 + 0.14 * pulse})`;
    pctx.strokeStyle = "#10B981";
    pctx.lineWidth = 1.8;
    pctx.beginPath();
    pctx.arc(targetPx, targetPy, 13 + pulse * 4, 0, Math.PI * 2);
    pctx.fill();
    pctx.stroke();

    pctx.strokeStyle = "#FACC15";
    pctx.lineWidth = 2;
    pctx.setLineDash([5, 4]);
    pctx.lineDashOffset = -(now * 0.03) % 18;
    pctx.beginPath();
    pctx.moveTo(cornerX, cornerY);
    pctx.quadraticCurveTo(cornerX + (attacksRight ? -24 : 24), (cornerY + targetPy) * 0.5, targetPx, targetPy);
    pctx.stroke();

    const decStartX = pad + ((attacksRight ? 91 : 14) / 105) * pw;
    const decStartY = pad + (36 / 68) * ph;
    pctx.strokeStyle = "#38BDF8";
    pctx.beginPath();
    pctx.moveTo(decStartX, decStartY);
    pctx.lineTo(decStartX + dxDec * 3.5, decStartY + dyDec * 3.5);
    pctx.stroke();
    pctx.setLineDash([]);
    pctx.restore();
  }

  if (st.isCloseUp || !st.players.length) return;

  // 2. Live Team Formation Lines & Block Shape (drawn continuously at 25fps!)
  if (st.showFormationLines !== false) {
    const teamConfigs = [
      { team: "team_a", hex: st.teamAHex, attRight: st.attackingTeam === "team_a" ? attacksRight : !attacksRight },
      { team: "team_b", hex: st.teamBHex, attRight: st.attackingTeam === "team_b" ? attacksRight : !attacksRight },
    ];
    for (const tc of teamConfigs) {
      const inst = computeInstantTeamLines(st.players, tc.team, tc.attRight);
      pctx.save();
      pctx.strokeStyle = hexToRgba(tc.hex, 0.72);
      pctx.lineWidth = 1.8;
      pctx.setLineDash([5, 3]);
      for (const grp of inst.lines) {
        if (grp.length < 2) continue;
        pctx.beginPath();
        grp.forEach((pt, idx) => {
          const px = pad + (pt.x_m / 105) * pw;
          const py = pad + (pt.y_m / 68) * ph;
          if (idx === 0) pctx.moveTo(px, py);
          else pctx.lineTo(px, py);
        });
        pctx.stroke();
      }
      pctx.setLineDash([]);
      pctx.restore();
    }
  }

  // 3. Live Passing Channels from Ball (when momentState is available or computed live)
  if (st.showPassingChannels !== false && st.momentState?.passing_channels) {
    pctx.save();
    for (const ch of st.momentState.passing_channels.slice(0, 4)) {
      const fx = pad + (ch.from_x_m / 105) * pw;
      const fy = pad + (ch.from_y_m / 68) * ph;
      const tx = pad + (ch.to_x_m / 105) * pw;
      const ty = pad + (ch.to_y_m / 68) * ph;
      pctx.strokeStyle = ch.is_blocked ? "rgba(239, 68, 68, 0.42)" : "rgba(16, 185, 129, 0.78)";
      pctx.lineWidth = ch.is_blocked ? 1.2 : 1.9;
      pctx.setLineDash(ch.is_blocked ? [2, 3] : [6, 3]);
      pctx.beginPath();
      pctx.moveTo(fx, fy);
      pctx.lineTo(tx, ty);
      pctx.stroke();
    }
    pctx.setLineDash([]);
    pctx.restore();
  }

  // 4. Tactical Correction Arrows (from Moment State Analyzer)
  if (st.showCorrectionArrows !== false && st.momentState?.correction_arrows) {
    pctx.save();
    for (const arr of st.momentState.correction_arrows.slice(0, 4)) {
      const fx = pad + (arr.from_x_m / 105) * pw;
      const fy = pad + (arr.from_y_m / 68) * ph;
      const tx = pad + (arr.to_x_m / 105) * pw;
      const ty = pad + (arr.to_y_m / 68) * ph;
      if (Math.hypot(tx - fx, ty - fy) < 4) continue;
      const col = arr.urgency === "critical" ? "#FACC15" : "#22D3EE";
      pctx.strokeStyle = col;
      pctx.lineWidth = 2.0;
      pctx.beginPath();
      pctx.moveTo(fx, fy);
      pctx.lineTo(tx, ty);
      pctx.stroke();

      const ang = Math.atan2(ty - fy, tx - fx);
      pctx.fillStyle = col;
      pctx.beginPath();
      pctx.moveTo(tx, ty);
      pctx.lineTo(tx - 6 * Math.cos(ang - 0.45), ty - 6 * Math.sin(ang - 0.45));
      pctx.lineTo(tx - 6 * Math.cos(ang + 0.45), ty - 6 * Math.sin(ang + 0.45));
      pctx.closePath();
      pctx.fill();

      pctx.beginPath();
      pctx.arc(tx, ty, 4, 0, Math.PI * 2);
      pctx.strokeStyle = col;
      pctx.lineWidth = 1.2;
      pctx.stroke();
    }
    pctx.restore();
  }

  // Linked Chain lines on 2D Twin
  if (st.chainIds.length >= 2) {
    pctx.save();
    for (let i = 0; i < st.chainIds.length - 1; i++) {
      const a = st.players.find((x) => x.track_id === st.chainIds[i]);
      const b = st.players.find((x) => x.track_id === st.chainIds[i + 1]);
      if (!a || !b) continue;
      const distM = Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m);
      pctx.strokeStyle = distM > 12 ? "#EF4444" : "#10B981";
      pctx.lineWidth = 2;
      pctx.beginPath();
      pctx.moveTo(pad + (a.x_m / 105) * pw, pad + (a.y_m / 68) * ph);
      pctx.lineTo(pad + (b.x_m / 105) * pw, pad + (b.y_m / 68) * ph);
      pctx.stroke();
    }
    pctx.restore();
  }

  // Players + Jersey/Track Number Badges + Ghost Arrow
  for (const p of st.players) {
    const px = pad + (p.x_m / 105) * pw;
    const py = pad + (p.y_m / 68) * ph;
    const isSel = p.track_id === st.selectedDefId;
    pctx.beginPath();
    pctx.arc(px, py, isSel ? 7.2 : 6.0, 0, Math.PI * 2);
    pctx.fillStyle =
      p.role === "referee"
        ? "#FACC15"
        : p.role === "assistant_referee"
        ? "#FB923C"
        : p.role === "goalkeeper"
        ? "#22D3EE"
        : p.team === "team_a"
        ? st.teamAHex
        : st.teamBHex;
    pctx.fill();
    pctx.strokeStyle = isSel ? "#10B981" : "rgba(255,255,255,0.92)";
    pctx.lineWidth = isSel ? 2.4 : 1.1;
    pctx.stroke();

    // Clean jersey or base track number inside node
    const numLabel = p.jersey_number
      ? `${p.jersey_number}`
      : p.track_id >= 1000
      ? `${p.track_id % 1000}`
      : `${p.track_id}`;
    pctx.save();
    pctx.fillStyle = p.role === "referee" ? "#0F172A" : "#FFFFFF";
    pctx.font = "800 7.5px Inter, system-ui, sans-serif";
    pctx.textAlign = "center";
    pctx.textBaseline = "middle";
    pctx.fillText(numLabel, px, py);
    pctx.restore();

    if (isSel && !st.isPlaying && (st.ghostDx !== 0 || st.ghostDy !== 0)) {
      const gx = pad + (Math.max(0, Math.min(105, p.x_m + st.ghostDx)) / 105) * pw;
      const gy = pad + (Math.max(0, Math.min(68, p.y_m + st.ghostDy)) / 68) * ph;
      pctx.save();
      pctx.setLineDash([4, 3]);
      pctx.strokeStyle = "#10B981";
      pctx.lineWidth = 2;
      pctx.beginPath();
      pctx.moveTo(px, py);
      pctx.lineTo(gx, gy);
      pctx.stroke();
      pctx.setLineDash([]);
      pctx.beginPath();
      pctx.arc(gx, gy, 7, 0, Math.PI * 2);
      pctx.fillStyle = "rgba(16, 185, 129, 0.38)";
      pctx.fill();
      pctx.strokeStyle = "#10B981";
      pctx.stroke();
      pctx.restore();
    }
  }

  // Ball + True Velocity Direction Vector on 2D Pitch
  const bxPx = pad + (Math.max(0, Math.min(105, ballXY[0])) / 105) * pw;
  const byPx = pad + (Math.max(0, Math.min(68, ballXY[1])) / 68) * ph;
  pctx.save();
  if (st.ball) {
    const vxPx = (st.ball.vx_ms / 105) * pw;
    const vyPx = (st.ball.vy_ms / 68) * ph;
    const spdM = Math.hypot(st.ball.vx_ms, st.ball.vy_ms);
    if (spdM >= 1.2) {
      const ang = Math.atan2(vyPx, vxPx);
      const len = Math.max(12, Math.min(34, spdM * 1.4));
      const ex = bxPx + Math.cos(ang) * len;
      const ey = byPx + Math.sin(ang) * len;
      pctx.strokeStyle = "#FACC15";
      pctx.lineWidth = 2;
      pctx.beginPath();
      pctx.moveTo(bxPx, byPx);
      pctx.lineTo(ex, ey);
      pctx.stroke();
      pctx.fillStyle = "#FACC15";
      pctx.beginPath();
      pctx.moveTo(ex + Math.cos(ang) * 3, ey + Math.sin(ang) * 3);
      pctx.lineTo(ex - 7 * Math.cos(ang - 0.5), ey - 7 * Math.sin(ang - 0.5));
      pctx.lineTo(ex - 7 * Math.cos(ang + 0.5), ey - 7 * Math.sin(ang + 0.5));
      pctx.closePath();
      pctx.fill();
    }
  }
  pctx.shadowColor = "rgba(250, 204, 21, 0.9)";
  pctx.shadowBlur = 8;
  pctx.fillStyle = "#FFFFFF";
  pctx.strokeStyle = "#FACC15";
  pctx.lineWidth = 2;
  pctx.beginPath();
  pctx.arc(bxPx, byPx, 4.4, 0, Math.PI * 2);
  pctx.fill();
  pctx.stroke();
  pctx.restore();
}

function draw3DPitchOrPov(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  st: {
    players: RenderPlayer[];
    attackingTeam: string;
    teamAHex: string;
    teamBHex: string;
    selectedDefId: number | null;
    ghostDx: number;
    ghostDy: number;
    isCloseUp: boolean;
    viewMode: TwinViewMode;
  },
  ballXY: [number, number],
  ballZ: number,
  camOrbit: { yawDeg: number; pitchDeg: number; zoom: number },
  now: number
) {
  // Deep stadium night sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#050914");
  sky.addColorStop(0.55, "#0B1528");
  sky.addColorStop(1, "#08221A");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  let camX = 52.5;
  let camY = 116.0;
  let camZ = 51.0;
  let yawRad = -Math.PI * 0.5;
  let tiltDownRad = 0.56;
  let fovScale = W * 0.72;

  if (st.viewMode === "pov") {
    const focusPlayer =
      st.players.find((p) => p.track_id === st.selectedDefId) ||
      st.players.find((p) => p.role === "player");
    const px = focusPlayer ? focusPlayer.x_m : 52.5;
    const py = focusPlayer ? focusPlayer.y_m : 34.0;
    const targetX = ballXY[0];
    const targetY = ballXY[1];
    yawRad = Math.atan2(targetY - py, targetX - px);
    camX = px - Math.cos(yawRad) * 6.5;
    camY = py - Math.sin(yawRad) * 6.5;
    camZ = 3.2;
    tiltDownRad = 0.16;
    fovScale = W * 0.85;
  } else {
    // 3D Twin Orbit on near broadcast side (+Y) looking toward pitch center (52.5, 34, 0)
    const orbitAngle = (camOrbit.yawDeg * Math.PI) / 180;
    const dist = 82.0;
    tiltDownRad = (Math.max(18, Math.min(65, Math.abs(camOrbit.pitchDeg))) * Math.PI) / 180;
    camX = 52.5 - Math.sin(orbitAngle) * dist;
    camY = 34.0 + Math.cos(orbitAngle) * dist;
    camZ = Math.tan(tiltDownRad) * dist;
    yawRad = Math.atan2(34.0 - camY, 52.5 - camX);
    fovScale = W * 0.72;
  }

  const prj = (x: number, y: number, z: number) =>
    project3D(x, y, z, camX, camY, camZ, yawRad, tiltDownRad, W, H, fovScale);

  const drawLine3D = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, col: string, lw = 1.2) => {
    const a = prj(x1, y1, z1);
    const b = prj(x2, y2, z2);
    if (!a || !b) return;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
  };

  // Mowed 3D turf surface strips (subdivided quads avoid horizon clipping issues)
  for (let ix = 0; ix < 10; ix++) {
    const x0 = ix * 10.5;
    const x1 = (ix + 1) * 10.5;
    const p1 = prj(x0, 0, 0);
    const p2 = prj(x1, 0, 0);
    const p3 = prj(x1, 68, 0);
    const p4 = prj(x0, 68, 0);
    if (p1 && p2 && p3 && p4) {
      ctx.fillStyle = ix % 2 === 0 ? "#0C3125" : "#09261C";
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.lineTo(p3.sx, p3.sy);
      ctx.lineTo(p4.sx, p4.sy);
      ctx.closePath();
      ctx.fill();
    }
  }

  // FIFA Pitch markings in 3D
  const lineCol = "rgba(255,255,255,0.34)";
  drawLine3D(0, 0, 0, 105, 0, 0, lineCol);
  drawLine3D(105, 0, 0, 105, 68, 0, lineCol);
  drawLine3D(105, 68, 0, 0, 68, 0, lineCol);
  drawLine3D(0, 68, 0, 0, 0, 0, lineCol);
  drawLine3D(52.5, 0, 0, 52.5, 68, 0, lineCol);
  // Left & Right 18-yard boxes
  drawLine3D(0, 13.84, 0, 16.5, 13.84, 0, lineCol);
  drawLine3D(16.5, 13.84, 0, 16.5, 54.16, 0, lineCol);
  drawLine3D(16.5, 54.16, 0, 0, 54.16, 0, lineCol);
  drawLine3D(105, 13.84, 0, 88.5, 13.84, 0, lineCol);
  drawLine3D(88.5, 13.84, 0, 88.5, 54.16, 0, lineCol);
  drawLine3D(88.5, 54.16, 0, 105, 54.16, 0, lineCol);

  // 3D Goal Frames (height 2.44m)
  for (const gx of [0, 105]) {
    drawLine3D(gx, 30.34, 0, gx, 30.34, 2.44, "#E2E8F0", 2);
    drawLine3D(gx, 37.66, 0, gx, 37.66, 2.44, "#E2E8F0", 2);
    drawLine3D(gx, 30.34, 2.44, gx, 37.66, 2.44, "#E2E8F0", 2);
  }

  if (st.isCloseUp || !st.players.length) return;

  // Depth-sort all 3D entities (players + ball)
  type DrawItem = { depth: number; fn: () => void };
  const queue: DrawItem[] = [];

  for (const p of st.players) {
    const base = prj(p.x_m, p.y_m, 0);
    const head = prj(p.x_m, p.y_m, 1.85);
    if (!base || !head) continue;
    const isSel = p.track_id === st.selectedDefId;
    const hex =
      p.role === "referee"
        ? "#FACC15"
        : p.role === "assistant_referee"
        ? "#FB923C"
        : p.role === "goalkeeper"
        ? "#22D3EE"
        : p.team === "team_a"
        ? st.teamAHex
        : st.teamBHex;

    queue.push({
      depth: base.depth,
      fn: () => {
        const pxH = Math.max(8, base.sy - head.sy);
        const rad = Math.max(3.5, Math.min(16, pxH * 0.34));
        // Floor halo ring
        ctx.fillStyle = hexToRgba(hex, isSel ? 0.35 : 0.18);
        ctx.strokeStyle = isSel ? "#10B981" : hex;
        ctx.lineWidth = isSel ? 2.2 : 1.4;
        ctx.beginPath();
        ctx.ellipse(base.sx, base.sy, rad * 1.4, rad * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Standing 3D body pillar + head orb
        ctx.strokeStyle = hex;
        ctx.lineWidth = Math.max(3, rad * 0.55);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(base.sx, base.sy - 2);
        ctx.lineTo(head.sx, head.sy + rad * 0.35);
        ctx.stroke();

        ctx.fillStyle = "#F8FAFC";
        ctx.beginPath();
        ctx.arc(head.sx, head.sy, Math.max(2.2, rad * 0.32), 0, Math.PI * 2);
        ctx.fill();

        if (isSel) {
          ctx.fillStyle = "#10B981";
          ctx.font = "700 10px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`#${p.track_id}`, head.sx, head.sy - rad - 4);
        }
      },
    });
  }

  // Ball in 3D with drop shadow & height z
  const bBase = prj(ballXY[0], ballXY[1], 0);
  const bAir = prj(ballXY[0], ballXY[1], Math.max(0.25, ballZ));
  if (bBase && bAir) {
    const pulse = 1 + 0.15 * Math.sin(now * 0.008);
    queue.push({
      depth: bAir.depth,
      fn: () => {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        ctx.ellipse(bBase.sx, bBase.sy, 5, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        if (ballZ > 0.3) {
          ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(bBase.sx, bBase.sy);
          ctx.lineTo(bAir.sx, bAir.sy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = "#FACC15";
        ctx.beginPath();
        ctx.arc(bAir.sx, bAir.sy, 4.5 * pulse, 0, Math.PI * 2);
        ctx.fill();
      },
    });
  }

  queue.sort((a, b) => b.depth - a.depth);
  for (const item of queue) item.fn();
}
