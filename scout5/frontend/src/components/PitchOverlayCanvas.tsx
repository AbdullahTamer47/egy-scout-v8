"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  Crosshair,
  FileUser,
  Flame,
  Pause,
  Play,
  RotateCcw,
  UserCog,
  X,
  Zap,
} from "lucide-react";
import {
  API_BASE,
  apiFetch,
  type FramePlayer,
  type MatchSequence,
  type TelemetryFrame,
  type TimelineEvent,
} from "@/lib/api";
import {
  interpolateFrameAtTime,
  livePlaybackBridge,
  useScoutStore,
  type OverlayLayerKey,
} from "@/store/useScoutStore";

const PITCH_L = 105.0;
const PITCH_W = 68.0;

function shortArName(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length >= 2 && ["عبد", "أبو", "فتح", "نور", "سيف", "تاج"].includes(parts[parts.length - 2])) {
    return parts.slice(-2).join(" ");
  }
  return parts[parts.length - 1] || name;
}

// Precompute canonical 105x68 FIFA markings for optional PnLCalib chalk verification
const FIFA_POLYLINES: [number, number][][] = (() => {
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
  ];
  const segs: [number, number][][] = [
    rect(0, 0, PITCH_L, PITCH_W),
    [[PITCH_L / 2, 0], [PITCH_L / 2, PITCH_W]],
    rect(0, 13.84, 16.5, 54.16),
    rect(PITCH_L - 16.5, 13.84, PITCH_L, 54.16),
    rect(0, 24.84, 5.5, 43.16),
    rect(PITCH_L - 5.5, 24.84, PITCH_L, 43.16),
  ];
  const circle: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    circle.push([PITCH_L / 2 + 9.15 * Math.cos(a), PITCH_W / 2 + 9.15 * Math.sin(a)]);
  }
  segs.push(circle);
  return segs.map((poly) => {
    const dense: [number, number][] = [];
    for (let i = 0; i < poly.length - 1; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[i + 1];
      const steps = poly.length > 10 ? 1 : 10;
      for (let s = 0; s < steps; s++) {
        dense.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
      }
    }
    dense.push(poly[poly.length - 1]);
    return dense;
  });
})();

function projectMetric(hInvNorm: number[][], xm: number, ym: number, w: number, h: number): [number, number] | null {
  const denom = hInvNorm[2][0] * xm + hInvNorm[2][1] * ym + hInvNorm[2][2];
  if (denom <= 1e-6) return null;
  const u = (hInvNorm[0][0] * xm + hInvNorm[0][1] * ym + hInvNorm[0][2]) / denom;
  const v = (hInvNorm[1][0] * xm + hInvNorm[1][1] * ym + hInvNorm[1][2]) / denom;
  if (u < -0.45 || u > 1.45 || v < -0.45 || v > 1.45) return null;
  return [u * w, v * h];
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || "#38bdf8").replace("#", "");
  if (clean.length !== 6) return `rgba(56, 189, 248, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Fast CPU-friendly glowing stroke using dual-pass alpha instead of expensive software shadowBlur. */
function strokeWithGlow(
  ctx: CanvasRenderingContext2D,
  color: string,
  coreWidth: number,
  glowAlpha = 0.25
) {
  ctx.strokeStyle = hexToRgba(color, glowAlpha);
  ctx.lineWidth = coreWidth * 2.5;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = coreWidth;
  ctx.stroke();
}

function drawRoundedPill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  fg: string,
  bg: string,
  border: string,
  fontPx: number
) {
  ctx.save();
  ctx.font = `800 ${fontPx}px "Cairo", ui-monospace, monospace`;
  const padX = Math.max(7, fontPx * 0.55);
  const h = fontPx + 8;
  const tw = ctx.measureText(text).width + padX * 2;
  const x = cx - tw / 2;
  const y = cy - h / 2;
  const r = h / 2;

  ctx.beginPath();
  ctx.roundRect(x, y, tw, h, r);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + 0.5);
  ctx.restore();
}

function traceMetricCircle(
  ctx: CanvasRenderingContext2D,
  hInvNorm: number[][],
  xm: number,
  ym: number,
  radiusM: number,
  w: number,
  h: number,
  segments = 20
): boolean {
  let started = false;
  let count = 0;
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const pt = projectMetric(hInvNorm, xm + radiusM * Math.cos(a), ym + radiusM * Math.sin(a), w, h);
    if (!pt) continue;
    if (!started) {
      ctx.moveTo(pt[0], pt[1]);
      started = true;
    } else {
      ctx.lineTo(pt[0], pt[1]);
    }
    count++;
  }
  ctx.closePath();
  return count >= 10;
}

export default function PitchOverlayCanvas() {
  const currentMatch = useScoutStore((s) => s.currentMatch);
  const selectedSlug = useScoutStore((s) => s.selectedSlug);
  const frames = useScoutStore((s) => s.frames);
  const teamKits = useScoutStore((s) => s.teamKits);
  const timelineEvents = useScoutStore((s) => s.timelineEvents);
  const seekNonce = useScoutStore((s) => s.seekNonce);
  const playbackRate = useScoutStore((s) => s.playbackRate);
  const setPlaybackRate = useScoutStore((s) => s.setPlaybackRate);
  const showBroadcast3D = useScoutStore((s) => s.showBroadcast3D);
  const showPassingLanes = useScoutStore((s) => s.showPassingLanes);
  const showDefWalls = useScoutStore((s) => s.showDefWalls);
  const showVoronoi = useScoutStore((s) => s.showVoronoi);
  const showPitchGrid = useScoutStore((s) => s.showPitchGrid);
  const showCoords = useScoutStore((s) => s.showCoords);
  const selectedIdentityKey = useScoutStore((s) => s.selectedIdentityKey);
  const toggleLayer = useScoutStore((s) => s.toggleLayer);
  const setPlaybackState = useScoutStore((s) => s.setPlaybackState);
  const setSelectedIdentityKey = useScoutStore((s) => s.setSelectedIdentityKey);
  const openVideoDossier = useScoutStore((s) => s.openVideoDossier);
  const setShowLineupModal = useScoutStore((s) => s.setShowLineupModal);
  const currentFrame = useScoutStore((s) => s.currentFrame);
  const currentTimeS = useScoutStore((s) => s.currentTimeS);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [isPlaying, setIsPlaying] = useState(false);

  // Instant On-Demand Moment Forensics State
  const [liveMomentSeq, setLiveMomentSeq] = useState<MatchSequence | null>(null);
  const [analyzingMoment, setAnalyzingMoment] = useState(false);

  // Sync video playbackRate (0.25x, 0.5x, 1.0x)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Auto-jump to first calibrated frame when match loads if start is uncalibrated pre-kickoff
  useEffect(() => {
    setLiveMomentSeq(null);
    const firstCal = frames.find((f) => f.cal_src !== "none");
    if (firstCal && firstCal.time_s > 2.0 && videoRef.current && videoRef.current.currentTime < 0.5) {
      videoRef.current.currentTime = firstCal.time_s;
    }
  }, [frames]);

  // Sync external seek & slow-mo replay commands
  useEffect(() => {
    if (!seekNonce || !videoRef.current) return;
    const v = videoRef.current;
    v.currentTime = seekNonce.timeS;
    if (seekNonce.playbackRate) {
      v.playbackRate = seekNonce.playbackRate;
    }
    if (seekNonce.autoPlay) {
      void v.play().catch(() => {});
    }
  }, [seekNonce]);

  // Exact DPR-aware ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const syncSize = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(1.75, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // Silky 60fps CPU-optimized Broadcast 3D AR Renderer (zero shadowBlur lag, smooth homography + player interpolation)
  useEffect(() => {
    let rafId = 0;
    let lastStoreUpdate = 0;

    const draw = (ts: number) => {
      const vid = videoRef.current;
      const cv = canvasRef.current;
      if (vid && cv) {
        const ctx = cv.getContext("2d");
        const w = cv.width;
        const h = cv.height;
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          const t = vid.currentTime || 0;
          const pulse = 0.5 + 0.5 * Math.sin(ts * 0.0055);
          const dashFlow = (ts * 0.04) % 24;
          const frame: TelemetryFrame | null = interpolateFrameAtTime(frames, t);

          // Update 60fps shared bridge immediately for 3D Pitch Twin, and throttle React store to 220ms
          livePlaybackBridge.timeS = t;
          livePlaybackBridge.frame = frame;
          if (ts - lastStoreUpdate > 220) {
            setPlaybackState(t, frame);
            lastStoreUpdate = ts;
          }

          if (frame && frame.cal_src !== "none") {
            const kit0 = teamKits["0"]?.ring || "#f43f5e";
            const kit1 = teamKits["1"]?.ring || "#38bdf8";
            const hInv = frame.h_inv_norm;

            // 1. Optional Turf Voronoi Space Control Shading
            if (showVoronoi && hInv && frame.voronoi_cells?.length) {
              ctx.save();
              for (const cell of frame.voronoi_cells) {
                if (cell.poly_m.length < 3) continue;
                const col = cell.team_id === 0 ? kit0 : kit1;
                ctx.beginPath();
                let okPts = 0;
                for (const [xm, ym] of cell.poly_m) {
                  const pt = projectMetric(hInv, xm, ym, w, h);
                  if (!pt) continue;
                  if (okPts === 0) ctx.moveTo(pt[0], pt[1]);
                  else ctx.lineTo(pt[0], pt[1]);
                  okPts++;
                }
                if (okPts >= 3) {
                  ctx.closePath();
                  ctx.fillStyle = hexToRgba(col, 0.13);
                  ctx.fill();
                  ctx.strokeStyle = hexToRgba(col, 0.34);
                  ctx.lineWidth = Math.max(1, w * 0.001);
                  ctx.stroke();
                }
              }
              ctx.restore();
            }

            // 2. Optional PnLCalib FIFA chalk line verification grid
            if (showPitchGrid && hInv) {
              ctx.save();
              ctx.strokeStyle = "rgba(16, 185, 129, 0.42)";
              ctx.lineWidth = Math.max(1.2, w * 0.0014);
              for (const poly of FIFA_POLYLINES) {
                ctx.beginPath();
                let started = false;
                for (const [xm, ym] of poly) {
                  const pt = projectMetric(hInv, xm, ym, w, h);
                  if (!pt) {
                    started = false;
                    continue;
                  }
                  if (!started) {
                    ctx.moveTo(pt[0], pt[1]);
                    started = true;
                  } else {
                    ctx.lineTo(pt[0], pt[1]);
                  }
                }
                ctx.stroke();
              }
              ctx.restore();
            }

            // 3. 3D Defensive Line AR Wall + Dynamic Formation Ribbons + Red Gap Lasers (>16m)
            if (showDefWalls && frame.formations) {
              for (const [tk, fobj] of Object.entries(frame.formations)) {
                const col = tk === "0" ? kit0 : kit1;

                if (hInv && fobj.def_line_x_m !== undefined) {
                  const wallPts: [number, number][] = [];
                  for (let ym = 4; ym <= PITCH_W - 4; ym += 8) {
                    const pt = projectMetric(hInv, fobj.def_line_x_m, ym, w, h);
                    if (pt && pt[0] > -w * 0.1 && pt[0] < w * 1.1 && pt[1] > h * 0.14 && pt[1] < h * 1.05) {
                      wallPts.push(pt);
                    }
                  }
                  if (wallPts.length >= 2) {
                    const wallH = Math.max(20, h * 0.052);
                    ctx.save();
                    ctx.beginPath();
                    wallPts.forEach(([px, py], i) => {
                      if (i === 0) ctx.moveTo(px, py);
                      else ctx.lineTo(px, py);
                    });
                    for (let i = wallPts.length - 1; i >= 0; i--) {
                      ctx.lineTo(wallPts[i][0], wallPts[i][1] - wallH);
                    }
                    ctx.closePath();
                    const midPt = wallPts[Math.floor(wallPts.length / 2)];
                    const wallGrad = ctx.createLinearGradient(midPt[0], midPt[1], midPt[0], midPt[1] - wallH);
                    wallGrad.addColorStop(0, hexToRgba(col, 0.34));
                    wallGrad.addColorStop(1, hexToRgba(col, 0.02));
                    ctx.fillStyle = wallGrad;
                    ctx.fill();

                    ctx.beginPath();
                    wallPts.forEach(([px, py], i) => {
                      if (i === 0) ctx.moveTo(px, py);
                      else ctx.lineTo(px, py);
                    });
                    strokeWithGlow(ctx, col, Math.max(2.0, w * 0.002), 0.28);

                    drawRoundedPill(
                      ctx,
                      midPt[0],
                      midPt[1] - wallH * 0.65,
                      `DEF ${fobj.def_line_m}m`,
                      "#f8fafc",
                      "rgba(7, 11, 18, 0.84)",
                      hexToRgba(col, 0.85),
                      Math.max(9.5, Math.round(w * 0.0082))
                    );
                    ctx.restore();
                  }
                }

                // Dynamic live formation lines connecting on-pitch team players sorted by depth bands
                ctx.save();
                for (const pts of Object.values(fobj.bands_uv || {})) {
                  if (pts.length < 2) continue;
                  ctx.beginPath();
                  pts.forEach(([u, v], idx) => {
                    if (idx === 0) ctx.moveTo(u * w, v * h);
                    else ctx.lineTo(u * w, v * h);
                  });
                  strokeWithGlow(ctx, col, Math.max(1.5, w * 0.0016), 0.22);
                }
                ctx.restore();
              }

              // Pulsing Red Defensive Gap Lasers (> 16m back-line split)
              if (frame.defensive_gaps?.length) {
                ctx.save();
                for (const gap of frame.defensive_gaps) {
                  const [fx, fy] = [gap.from_uv[0] * w, gap.from_uv[1] * h];
                  const [tx, ty] = [gap.to_uv[0] * w, gap.to_uv[1] * h];
                  ctx.beginPath();
                  ctx.moveTo(fx, fy);
                  ctx.lineTo(tx, ty);
                  ctx.setLineDash([10, 6]);
                  ctx.lineDashOffset = -dashFlow;
                  strokeWithGlow(ctx, "#f43f5e", Math.max(2.6, w * 0.0026), 0.3 + 0.15 * pulse);
                  ctx.setLineDash([]);

                  drawRoundedPill(
                    ctx,
                    (fx + tx) / 2,
                    (fy + ty) / 2 - 12,
                    `ثغرة ${gap.gap_m}م`,
                    "#ffe4e6",
                    "rgba(136, 19, 55, 0.92)",
                    "#fb7185",
                    Math.max(9.5, Math.round(w * 0.0082))
                  );
                }
                ctx.restore();
              }
            }

            // 4. 3D Parabolic Curved Passing Trajectories (locked to interpolated player feet!)
            if (showPassingLanes && frame.passing_lanes?.length) {
              ctx.save();
              for (const ln of frame.passing_lanes.slice(0, 4)) {
                if (ln.status === "blocked") continue;
                const [fx, fy] = [ln.from_uv[0] * w, ln.from_uv[1] * h];
                const [tx, ty] = [ln.to_uv[0] * w, ln.to_uv[1] * h];
                const distPx = Math.hypot(tx - fx, ty - fy);
                const liftPx = Math.min(h * 0.13, Math.max(16, distPx * 0.21));
                const cpx = (fx + tx) / 2;
                const cpy = (fy + ty) / 2 - liftPx;
                const isLbp = ln.status === "line_breaking";
                const col = isLbp ? "#10b981" : ln.status === "open" ? "#38bdf8" : "#f59e0b";

                // Ground turf shadow line
                ctx.beginPath();
                ctx.moveTo(fx, fy);
                ctx.lineTo(tx, ty);
                ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
                ctx.lineWidth = Math.max(2.2, w * 0.0022);
                ctx.stroke();

                // Elevated glowing 3D Bezier passing arc
                ctx.beginPath();
                ctx.moveTo(fx, fy);
                ctx.quadraticCurveTo(cpx, cpy, tx, ty);
                ctx.setLineDash(isLbp ? [] : [9, 6]);
                ctx.lineDashOffset = -dashFlow;
                strokeWithGlow(ctx, col, isLbp ? Math.max(2.8, w * 0.0028) : Math.max(1.8, w * 0.0018), 0.28);
                ctx.setLineDash([]);

                if (isLbp || (ln.status === "open" && (ln.xpass_pct ?? 0) >= 76)) {
                  const ax = 0.25 * fx + 0.5 * cpx + 0.25 * tx;
                  const ay = 0.25 * fy + 0.5 * cpy + 0.25 * ty - 8;
                  const pillTxt = isLbp
                    ? `xPass ${ln.xpass_pct ?? 82}% • +${ln.opponents_bypassed} خصوم`
                    : `xPass ${ln.xpass_pct ?? 85}% • ${ln.distance_m}م`;
                  drawRoundedPill(
                    ctx,
                    ax,
                    ay,
                    pillTxt,
                    isLbp ? "#ecfdf5" : "#e0f2fe",
                    "rgba(7, 11, 18, 0.88)",
                    col,
                    Math.max(9.5, Math.round(w * 0.008))
                  );
                }
              }
              ctx.restore();
            }

            // 5. Broadcast 3D Perspective Ground Rings + Volumetric Spotlights + Auto-Matched Names
            if (showBroadcast3D) {
              for (const p of frame.players) {
                // Suppress off-pitch advertising board / crowd false detections on calibrated frames
                if (!p.on_pitch && p.role !== "goalkeeper") continue;
                if (p.v_norm < 0.16) continue; // Top scoreboard / crowd banner margin

                const cx = p.u_norm * w;
                const cy = p.v_norm * h;
                const isRef = p.role === "referee";
                const isCarrier = frame.ball_carrier_track_id === p.track_id;
                const isSelected = Boolean(selectedIdentityKey && p.identity_key === selectedIdentityKey);
                const col = isRef ? "#f59e0b" : p.team_id === 0 ? kit0 : p.team_id === 1 ? kit1 : "#94a3b8";
                const spd = p.speed_kmh ?? 0;

                ctx.save();

                // 5a. Directional Velocity Arrow projected on turf
                if (hInv && p.x_m !== null && p.y_m !== null && spd >= 8.5 && (p.vx_ms || p.vy_ms)) {
                  const lookAhead = Math.min(3.4, Math.max(1.2, spd * 0.095));
                  const vNorm = Math.hypot(p.vx_ms || 0, p.vy_ms || 0) || 1;
                  const tip = projectMetric(
                    hInv,
                    p.x_m + ((p.vx_ms || 0) / vNorm) * lookAhead,
                    p.y_m + ((p.vy_ms || 0) / vNorm) * lookAhead,
                    w,
                    h
                  );
                  if (tip) {
                    const ang = Math.atan2(tip[1] - cy, tip[0] - cx);
                    const headLen = Math.max(6.5, w * 0.0065);
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(tip[0], tip[1]);
                    ctx.strokeStyle = spd >= 23 ? "#facc15" : hexToRgba(col, 0.88);
                    ctx.lineWidth = spd >= 23 ? 2.8 : 2.0;
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.moveTo(tip[0], tip[1]);
                    ctx.lineTo(tip[0] - headLen * Math.cos(ang - 0.5), tip[1] - headLen * Math.sin(ang - 0.5));
                    ctx.lineTo(tip[0] - headLen * Math.cos(ang + 0.5), tip[1] - headLen * Math.sin(ang + 0.5));
                    ctx.closePath();
                    ctx.fillStyle = spd >= 23 ? "#facc15" : col;
                    ctx.fill();
                  }
                }

                // 5b. True Perspective Metric Ground Ring
                let drewPerspective = false;
                if (hInv && p.on_pitch && p.x_m !== null && p.y_m !== null) {
                  if (traceMetricCircle(ctx, hInv, p.x_m, p.y_m, isSelected || isCarrier ? 1.32 : 1.02, w, h, 18)) {
                    drewPerspective = true;
                    ctx.fillStyle = hexToRgba(
                      isSelected ? "#22d3ee" : isCarrier ? "#facc15" : col,
                      isSelected || isCarrier ? 0.26 : 0.14
                    );
                    ctx.fill();
                    strokeWithGlow(ctx, isSelected ? "#22d3ee" : col, isSelected || isCarrier ? 2.6 : 1.8, 0.25);
                  }
                  if (isSelected || isCarrier || spd >= 22.0) {
                    const outerR = (isSelected || isCarrier ? 1.9 : 1.52) + pulse * 0.25;
                    if (traceMetricCircle(ctx, hInv, p.x_m, p.y_m, outerR, w, h, 20)) {
                      ctx.strokeStyle = isSelected ? "rgba(34,211,238,0.85)" : "#facc15";
                      ctx.lineWidth = 1.6;
                      ctx.setLineDash([7, 5]);
                      ctx.stroke();
                      ctx.setLineDash([]);
                    }
                  }
                }
                if (!drewPerspective) {
                  ctx.beginPath();
                  ctx.ellipse(cx, cy, Math.max(10, w * 0.012), Math.max(4.5, h * 0.0085), 0, 0, Math.PI * 2);
                  ctx.fillStyle = hexToRgba(col, 0.16);
                  ctx.fill();
                  ctx.strokeStyle = isSelected ? "#22d3ee" : col;
                  ctx.lineWidth = isSelected || isCarrier ? 2.8 : 1.8;
                  ctx.stroke();
                }

                // 5c. Volumetric 3D Broadcast Spotlight Pillar
                if (isSelected || isCarrier) {
                  const boxH = Math.max(42, (p.y2_norm - p.y1_norm) * h);
                  const topY = Math.max(10, cy - boxH * 1.42);
                  const beamWTop = Math.max(19, w * 0.026);
                  const beamWBot = Math.max(11, w * 0.014);
                  const spotCol = isSelected ? "#22d3ee" : "#facc15";
                  const grad = ctx.createLinearGradient(cx, cy, cx, topY);
                  grad.addColorStop(0, hexToRgba(spotCol, 0.32));
                  grad.addColorStop(0.65, hexToRgba(spotCol, 0.09));
                  grad.addColorStop(1, hexToRgba(spotCol, 0.0));
                  ctx.beginPath();
                  ctx.moveTo(cx - beamWBot, cy);
                  ctx.lineTo(cx + beamWBot, cy);
                  ctx.lineTo(cx + beamWTop, topY);
                  ctx.lineTo(cx - beamWTop, topY);
                  ctx.closePath();
                  ctx.fillStyle = grad;
                  ctx.fill();
                }

                // 5d. Broadcast Glass Tag showing Real Auto-Matched / Confirmed Player Name
                const jerseyTag = p.bound_jersey ?? p.jersey_ocr;
                const baseLabel = isRef
                  ? "REF"
                  : p.bound_name
                  ? `${jerseyTag ? `#${jerseyTag} ` : ""}${shortArName(p.bound_name)}`
                  : jerseyTag
                  ? `#${jerseyTag} ${p.inferred_role_code || ""}`.trim()
                  : p.role === "goalkeeper"
                  ? "GK"
                  : `${p.inferred_role_code || "P"}·${p.track_id}`;

                const showSpd = !isRef && spd >= 4.0 && (spd >= 19.5 || isSelected || isCarrier);
                const fullLabel =
                  showCoords && p.x_m !== null && p.y_m !== null
                    ? `${baseLabel} (${Math.round(p.x_m)},${Math.round(p.y_m)})`
                    : showSpd
                    ? `${baseLabel} · ${spd.toFixed(1)} كم/س`
                    : baseLabel;

                const headY = Math.max(18, p.y1_norm * h - 10);
                drawRoundedPill(
                  ctx,
                  cx,
                  headY,
                  fullLabel,
                  isSelected ? "#ecfeff" : isCarrier ? "#fef9c3" : "#f8fafc",
                  isSelected ? "rgba(8, 51, 68, 0.92)" : "rgba(7, 11, 18, 0.82)",
                  isSelected ? "#22d3ee" : isCarrier ? "#facc15" : hexToRgba(col, 0.85),
                  Math.max(9.5, Math.round(w * 0.008))
                );

                ctx.restore();
              }
            }

            // 6. Glowing 3D Ball Beacon
            if (frame.ball) {
              const bx = frame.ball.u_norm * w;
              const by = frame.ball.v_norm * h;
              ctx.save();
              ctx.beginPath();
              ctx.arc(bx, by, Math.max(7.5, w * 0.008) + pulse * 2.5, 0, Math.PI * 2);
              ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
              ctx.lineWidth = 1.5;
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(bx, by, Math.max(5, w * 0.0055), 0, Math.PI * 2);
              ctx.fillStyle = "rgba(250, 204, 21, 0.3)";
              ctx.fill();
              ctx.strokeStyle = "#facc15";
              ctx.lineWidth = 2.2;
              ctx.stroke();
              ctx.restore();
            }
          } else if (frame && frame.cal_src === "none") {
            ctx.save();
            drawRoundedPill(
              ctx,
              Math.min(w * 0.5, 220),
              28,
              "لقطة قريبة / انتقال كاميرا — مستبعدة تلقائياً لحفظ الدقة المترية",
              "#fef3c7",
              "rgba(15, 23, 42, 0.90)",
              "#f59e0b",
              Math.max(11, Math.round(w * 0.0095))
            );
            ctx.restore();
          }
        }
      }
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [
    frames,
    teamKits,
    showBroadcast3D,
    showPassingLanes,
    showDefWalls,
    showVoronoi,
    showPitchGrid,
    showCoords,
    selectedIdentityKey,
    setPlaybackState,
  ]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    const frame = livePlaybackBridge.frame || currentFrame;
    if (!cv || !frame || frame.cal_src === "none") return;
    const rect = cv.getBoundingClientRect();
    const u = (e.clientX - rect.left) / Math.max(1, rect.width);
    const v = (e.clientY - rect.top) / Math.max(1, rect.height);

    let best: FramePlayer | null = null;
    let bestD = 0.055;
    for (const p of frame.players) {
      if (p.role === "referee" || !p.identity_key || !p.on_pitch) continue;
      const midV = (p.y1_norm + p.v_norm) * 0.5;
      const d = Math.hypot(p.u_norm - u, midV - v);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best && best.identity_key) {
      setSelectedIdentityKey(best.identity_key === selectedIdentityKey ? null : best.identity_key);
    } else {
      setSelectedIdentityKey(null);
    }
  };

  const analyzeCurrentVideoMoment = async () => {
    if (!selectedSlug) return;
    const t = videoRef.current?.currentTime ?? currentTimeS;
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
    }
    setAnalyzingMoment(true);
    try {
      const seq = await apiFetch<MatchSequence>(`/api/matches/${selectedSlug}/forensics/moment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time_s: t, event_type: "goal" }),
      });
      setLiveMomentSeq(seq);
    } catch {
      /* ignore if uncalibrated frame */
    } finally {
      setAnalyzingMoment(false);
    }
  };

  const selectedPortfolio = useMemo(() => {
    if (!selectedIdentityKey) return null;
    const list = currentMatch?.summary?.player_portfolios || currentMatch?.summary?.tracked_players || [];
    return list.find((p) => p.identity_key === selectedIdentityKey) || null;
  }, [selectedIdentityKey, currentMatch]);

  const videoSrc = currentMatch ? `${API_BASE}${currentMatch.video_url}` : "";
  const cal = currentMatch?.summary?.calibration;
  const k0 = teamKits["0"];
  const k1 = teamKits["1"];
  const hc = String(currentMatch?.home_team_cluster ?? 0);
  const name0 = hc === "0" ? currentMatch?.home_team_name || "فريق 1" : currentMatch?.away_team_name || "فريق 2";
  const name1 = hc === "1" ? currentMatch?.home_team_name || "فريق 1" : currentMatch?.away_team_name || "فريق 2";

  const minT = frames.length ? frames[0].time_s : 0;
  const maxT = frames.length ? frames[frames.length - 1].time_s : Math.max(1, currentMatch?.duration_s || 1);
  const spanT = Math.max(0.5, maxT - minT);

  const eventColor = (t: TimelineEvent["type"]) => {
    if (t === "defensive_gap") return "bg-rose-500 border-rose-300";
    if (t === "line_breaking_pass") return "bg-emerald-400 border-emerald-200";
    if (t === "sprint") return "bg-amber-400 border-amber-200";
    return "bg-sky-400 border-sky-200";
  };

  // Pre-memoized timeline strip so playback never recreates 150 DOM nodes
  const timelineSegments = useMemo(
    () =>
      frames.map((fr, idx) => {
        const col =
          fr.cal_src === "none"
            ? "bg-slate-800"
            : fr.poss_team === 0
            ? ""
            : fr.poss_team === 1
            ? ""
            : "bg-emerald-700/70";
        const bgStyle =
          fr.cal_src !== "none" && fr.poss_team === 0
            ? { backgroundColor: k0?.ring || "#f43f5e", opacity: 0.75 }
            : fr.cal_src !== "none" && fr.poss_team === 1
            ? { backgroundColor: k1?.ring || "#38bdf8", opacity: 0.75 }
            : undefined;
        return <div key={idx} className={`flex-1 ${col}`} style={bgStyle} />;
      }),
    [frames, k0?.ring, k1?.ring]
  );

  const layerButtons: { k: OverlayLayerKey; lbl: string; on: boolean }[] = [
    { k: "showBroadcast3D", lbl: "حلقات 3D + الأسماء", on: showBroadcast3D },
    { k: "showPassingLanes", lbl: "أقواس التمرير xPass", on: showPassingLanes },
    { k: "showDefWalls", lbl: "جدار الدفاع + الثغرات", on: showDefWalls },
    { k: "showVoronoi", lbl: "مساحات Voronoi", on: showVoronoi },
    { k: "showPitchGrid", lbl: "شبكة PnLCalib", on: showPitchGrid },
    { k: "showCoords", lbl: "إحداثيات (م)", on: showCoords },
  ];

  return (
    <div className="space-y-3">
      {/* Broadcast AR Layer Dock */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-[#0b111d] px-3.5 py-2.5 text-xs shadow-lg">
        <div className="flex flex-wrap items-center gap-2">
          {k0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 font-bold text-slate-100">
              <span className="h-2.5 w-2.5 rounded-full shadow" style={{ backgroundColor: k0.ring || "#f43f5e" }} />
              {name0} <span className="text-[10px] font-normal text-slate-400">({k0.label_ar || "طقم 1"})</span>
            </span>
          )}
          {k1 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 font-bold text-slate-100">
              <span className="h-2.5 w-2.5 rounded-full shadow" style={{ backgroundColor: k1.ring || "#38bdf8" }} />
              {name1} <span className="text-[10px] font-normal text-slate-400">({k1.label_ar || "طقم 2"})</span>
            </span>
          )}
          <button
            onClick={() => setShowLineupModal(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-black text-cyan-200 hover:bg-cyan-500/25"
          >
            <UserCog className="h-3.5 w-3.5" />
            تعديل أسماء التشكيلة
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {layerButtons.map((btn) => (
            <button
              key={btn.k}
              onClick={() => toggleLayer(btn.k)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                btn.on
                  ? "border border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                  : "border border-slate-800 bg-slate-900/80 text-slate-400 hover:text-slate-200"
              }`}
            >
              {btn.lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Aspect-locked Video + Interactive 3D Broadcast AR Canvas */}
      <div
        ref={containerRef}
        className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.1] bg-black shadow-2xl shadow-black/70"
        style={{ aspectRatio: `${aspect}` }}
        dir="ltr"
      >
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className="h-full w-full object-contain"
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth > 0 && v.videoHeight > 0) setAspect(v.videoWidth / v.videoHeight);
              v.playbackRate = playbackRate;
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">اختر مباراة لعرض الاستوديو</div>
        )}
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          title="اضغط على أي لاعب لتسليط الضوء 3D وفتح بياناته الفورية"
          className="absolute inset-0 h-full w-full cursor-crosshair"
        />

        {/* Broadcast Live Scorebug (Top-Right) */}
        {currentFrame && currentFrame.cal_src !== "none" && (
          <div
            dir="rtl"
            className="pointer-events-none absolute top-3 right-3 flex items-center gap-2 rounded-xl border border-white/15 bg-slate-950/85 px-3 py-1.5 text-[11px] backdrop-blur-md shadow-xl"
          >
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-black text-emerald-300 tracking-wide">3D AR 60FPS</span>
            {playbackRate !== 1.0 && (
              <span className="rounded bg-amber-500/25 px-1.5 py-0.5 font-mono text-[10px] font-black text-amber-300">
                SLOW-MO {playbackRate}x
              </span>
            )}
            <span className="text-slate-600">|</span>
            {currentFrame.pitch_control && currentFrame.pitch_control["0"] !== undefined && (
              <span className="tabular-nums text-slate-200">
                Voronoi:{" "}
                <strong style={{ color: k0?.ring || "#f43f5e" }}>{currentFrame.pitch_control["0"]}%</strong>
                {" / "}
                <strong style={{ color: k1?.ring || "#38bdf8" }}>{currentFrame.pitch_control["1"]}%</strong>
              </span>
            )}
            {currentFrame.defensive_gaps && currentFrame.defensive_gaps.length > 0 && (
              <span className="rounded bg-rose-500/25 border border-rose-400/50 px-1.5 py-0.5 font-bold text-rose-200">
                ثغرة {currentFrame.defensive_gaps[0].gap_m}م
              </span>
            )}
          </div>
        )}

        {/* Clicked Player Instant Broadcast Spotlight Card (Bottom-Left) */}
        {selectedPortfolio && (
          <div
            dir="rtl"
            className="absolute bottom-3 left-3 z-10 w-[305px] rounded-2xl border border-cyan-400/50 bg-slate-950/92 p-3 text-xs shadow-2xl backdrop-blur-md"
          >
            <div className="flex items-center gap-2.5">
              {selectedPortfolio.portrait_url ? (
                <img
                  src={`${API_BASE}${selectedPortfolio.portrait_url}`}
                  alt={selectedPortfolio.identity_key}
                  className="h-12 w-11 rounded-xl border border-cyan-400/40 object-cover bg-slate-900 shrink-0"
                />
              ) : (
                <div className="flex h-12 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-500/10 font-mono font-black text-cyan-300">
                  {selectedPortfolio.display_jersey ? `#${selectedPortfolio.display_jersey}` : selectedPortfolio.inferred_role_code}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-black text-white">
                    {selectedPortfolio.display_name || `هوية ${selectedPortfolio.identity_key}`}
                  </span>
                  <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[11px] font-black text-emerald-300">
                    {selectedPortfolio.scorecard.overall_score}
                  </span>
                </div>
                <div className="text-[11px] text-cyan-200 truncate">
                  {selectedPortfolio.inferred_role_ar} • {selectedPortfolio.compatibility.best_formation} (
                  {selectedPortfolio.compatibility.best_formation_pct}%)
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {selectedPortfolio.status_label_ar || "مطابقة تلقائية"} • +{selectedPortfolio.highlights_count ?? 0} مميزات / -
                  {selectedPortfolio.mistakes_count ?? 0} أخطاء
                </div>
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center text-[10px] tabular-nums">
              <div className="rounded-lg bg-slate-900/90 p-1.5">
                <div className="text-slate-400">أقصى سرعة</div>
                <div className="font-mono font-black text-amber-300">{selectedPortfolio.max_speed_kmh} كم/س</div>
              </div>
              <div className="rounded-lg bg-slate-900/90 p-1.5">
                <div className="text-slate-400">المسافة</div>
                <div className="font-mono font-black text-white">{selectedPortfolio.distance_m}م</div>
              </div>
              <div className="rounded-lg bg-slate-900/90 p-1.5">
                <div className="text-slate-400">مساحة تحكم</div>
                <div className="font-mono font-black text-cyan-300">{selectedPortfolio.avg_voronoi_m2}م²</div>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <button
                onClick={() => openVideoDossier(selectedPortfolio.identity_key)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-400 px-2.5 py-1.5 text-[11px] font-black text-slate-950 hover:bg-cyan-300"
              >
                <FileUser className="h-3.5 w-3.5" />
                البروفايل والأخطاء
              </button>
              <button
                onClick={() => setSelectedIdentityKey(null)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-300 hover:text-white"
              >
                إغلاق
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hudl-Style Timeline + Slow-Motion Controls + 1-Click Moment Forensics */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0b111d] p-3 space-y-2.5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) void v.play();
                else v.pause();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-1.5 font-black text-slate-950 hover:bg-emerald-400 shadow-lg shadow-emerald-500/20"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? "إيقاف" : "تشغيل"}
            </button>
            <button
              onClick={() => {
                const firstCal = frames.find((f) => f.cal_src !== "none");
                if (videoRef.current) videoRef.current.currentTime = firstCal ? firstCal.time_s : 0;
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200 hover:border-slate-500"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              أول لقطة معايرة
            </button>

            {/* Slow-Motion Speed Selector (0.25x, 0.5x, 1x) */}
            <div className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-950 p-0.5">
              {[0.25, 0.5, 1.0].map((spd) => (
                <button
                  key={spd}
                  onClick={() => setPlaybackRate(spd)}
                  className={`rounded-lg px-2 py-1 font-mono text-[10px] font-black transition ${
                    playbackRate === spd ? "bg-amber-400 text-slate-950" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>

            {/* 1-Click Live Moment / Goal Forensics Button */}
            <button
              onClick={() => void analyzeCurrentVideoMoment()}
              disabled={analyzingMoment}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/50 bg-rose-500/20 px-3 py-1.5 text-[11px] font-black text-rose-100 hover:bg-rose-500/30"
            >
              <Flame className="h-3.5 w-3.5 text-amber-300" />
              {analyzingMoment ? "جاري التشريح..." : "تشريح هذه اللحظة (هدف / هجمة)"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300 tabular-nums">
            <span className="font-mono text-emerald-300">
              {currentTimeS.toFixed(1)}s / {maxT.toFixed(1)}s
            </span>
            {cal && (
              <>
                <span>
                  تغطية: <strong className="text-emerald-300">{cal.wide_cal_coverage_pct}%</strong>
                </span>
                <span>
                  دقة الإسقاط: <strong className="text-cyan-300">{cal.median_rep_err_px ?? "—"} px</strong>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Visual Calibration + Possession Timeline Ribbon */}
        <div
          dir="ltr"
          className="relative h-8 w-full cursor-pointer rounded-xl border border-slate-800 bg-slate-950 overflow-hidden"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            const targetT = minT + frac * spanT;
            if (videoRef.current) videoRef.current.currentTime = targetT;
          }}
        >
          <div className="absolute inset-x-0 bottom-0 flex h-2.5">{timelineSegments}</div>

          {timelineEvents.slice(0, 24).map((ev, i) => {
            const leftPct = Math.max(1, Math.min(99, ((ev.time_s - minT) / spanT) * 100));
            return (
              <button
                key={i}
                type="button"
                title={`${ev.label_ar} (${ev.time_s.toFixed(1)}ث)`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (videoRef.current) videoRef.current.currentTime = ev.time_s;
                  if (ev.identity_key) setSelectedIdentityKey(ev.identity_key);
                }}
                style={{ left: `${leftPct}%` }}
                className={`absolute top-1.5 -translate-x-1/2 h-3.5 w-3.5 rounded-full border shadow hover:scale-125 transition ${eventColor(
                  ev.type
                )}`}
              />
            );
          })}

          <div
            style={{ left: `${Math.max(0, Math.min(100, ((currentTimeS - minT) / spanT) * 100))}%` }}
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_10px_#fff]"
          />
        </div>

        {/* Clickable Moment Jump Chips */}
        {timelineEvents.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[11px]">
            <span className="shrink-0 inline-flex items-center gap-1 font-bold text-slate-400">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
              أبرز اللحظات:
            </span>
            {timelineEvents.slice(0, 10).map((ev, idx) => (
              <button
                key={idx}
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime = ev.time_s;
                  if (ev.identity_key) setSelectedIdentityKey(ev.identity_key);
                }}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-slate-200 hover:border-emerald-500/60 hover:text-white transition"
              >
                <span className={`h-2 w-2 rounded-full ${eventColor(ev.type).split(" ")[0]}`} />
                <span>{ev.label_ar}</span>
                <span className="font-mono text-[10px] text-slate-400">{ev.time_s.toFixed(1)}ث</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Instant On-Demand Moment / Goal Forensics Drawer */}
      {liveMomentSeq && (
        <div className="rounded-2xl border border-rose-500/40 bg-[#0d1322] p-4 space-y-3 text-xs shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-rose-500/20 border border-rose-400/50 px-2.5 py-0.5 font-black text-rose-200">
                تشريح فوري عند {liveMomentSeq.time_s}ث
              </span>
              <h4 className="text-sm font-black text-white">{liveMomentSeq.title_ar}</h4>
              <span className="font-mono font-black text-amber-300">xG {liveMomentSeq.xg_estimate}</span>
            </div>
            <button
              onClick={() => setLiveMomentSeq(null)}
              className="rounded-lg border border-slate-700 bg-slate-900 p-1 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
            {liveMomentSeq.stages.map((st) => (
              <div key={st.step} className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
                <div className="font-black text-cyan-300">
                  {st.step}. {st.label_ar}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-200">{st.detail_ar}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-2.5 space-y-1">
              <div className="font-black text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                صنّاع الهجمة ({liveMomentSeq.attacking_team_name})
              </div>
              {liveMomentSeq.attacking_heroes.map((h, i) => (
                <div key={i} className="text-[11px] text-slate-200">
                  <strong>{h.name}</strong> ({h.role_ar}): {h.reason_ar}
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-rose-500/25 bg-rose-950/15 p-2.5 space-y-1">
              <div className="font-black text-rose-300 flex items-center gap-1">
                <AlertOctagon className="h-3.5 w-3.5" />
                الأخطاء الدفاعية ({liveMomentSeq.defending_team_name})
              </div>
              {liveMomentSeq.defensive_faults.map((df, i) => (
                <div key={i} className="text-[11px] text-slate-200">
                  <strong>{df.name}</strong> ({df.role_ar}): {df.fault_ar}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
