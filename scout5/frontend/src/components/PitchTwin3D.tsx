"use client";

import React, { useEffect, useRef, useState } from "react";
import { Box, Eye, Layers, Map as MapIcon } from "lucide-react";
import { livePlaybackBridge, useScoutStore } from "@/store/useScoutStore";
import PitchRadar2D from "@/components/PitchRadar2D";

const PITCH_L = 105.0;
const PITCH_W = 68.0;

function hexToRgba(hex: string, alpha: number): string {
  const clean = (hex || "#38bdf8").replace("#", "");
  if (clean.length !== 6) return `rgba(56, 189, 248, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type CamPreset = "broadcast" | "tactical" | "goal";

const CAM_PRESETS: Record<CamPreset, { yawDeg: number; tiltDeg: number; zoom: number; label: string }> = {
  broadcast: { yawDeg: 0, tiltDeg: 44, zoom: 1.0, label: "زاوية البث" },
  tactical: { yawDeg: -16, tiltDeg: 58, zoom: 1.02, label: "إيزومتريك" },
  goal: { yawDeg: -68, tiltDeg: 34, zoom: 1.08, label: "خلف المرمى" },
};

/** Perspective 3D camera projection mapping FIFA (x_m, y_m, z_m) -> canvas (px, py, scale). */
function makeProjector(w: number, h: number, yawDeg: number, tiltDeg: number, zoom: number) {
  const yaw = (yawDeg * Math.PI) / 180;
  const tilt = (tiltDeg * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const camDist = 148.0;
  const focal = Math.min(w, h * 1.48) * 1.15 * zoom;

  return (xm: number, ym: number, zm = 0): { x: number; y: number; s: number; depth: number } => {
    // Center pitch at (0, 0, 0)
    const dx = xm - PITCH_L * 0.5;
    const dy = ym - PITCH_W * 0.5;
    const dz = zm;

    // Rotate around Z (yaw)
    const rx = dx * cy - dy * sy;
    const ry = dx * sy + dy * cy;

    // Tilt around X
    const ty = ry * st - dz * ct;
    const tz = ry * ct + dz * st;

    const depth = camDist + tz;
    const scale = focal / Math.max(25, depth);
    return {
      x: w * 0.5 + rx * scale,
      y: h * 0.53 + ty * scale,
      s: scale,
      depth,
    };
  };
}

export default function PitchTwin3D() {
  const frame = useScoutStore((s) => s.currentFrame);
  const teamKits = useScoutStore((s) => s.teamKits);
  const currentMatch = useScoutStore((s) => s.currentMatch);
  const pitchViewMode = useScoutStore((s) => s.pitchViewMode);
  const setPitchViewMode = useScoutStore((s) => s.setPitchViewMode);
  const selectedIdentityKey = useScoutStore((s) => s.selectedIdentityKey);
  const setSelectedIdentityKey = useScoutStore((s) => s.setSelectedIdentityKey);
  const openVideoDossier = useScoutStore((s) => s.openVideoDossier);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [preset, setPreset] = useState<CamPreset>("broadcast");
  const [show3DVoronoi, setShow3DVoronoi] = useState(true);
  const screenPlayersRef = useRef<{ x: number; y: number; identityKey: string }[]>([]);

  const k0 = teamKits["0"]?.ring || "#f43f5e";
  const k1 = teamKits["1"]?.ring || "#38bdf8";
  const hc = String(currentMatch?.home_team_cluster ?? 0);
  const name0 = hc === "0" ? currentMatch?.home_team_name || "فريق 1" : currentMatch?.away_team_name || "فريق 2";
  const name1 = hc === "1" ? currentMatch?.home_team_name || "فريق 1" : currentMatch?.away_team_name || "فريق 2";
  const calibrated = Boolean(frame && frame.cal_src !== "none");

  useEffect(() => {
    if (pitchViewMode !== "3d") return;
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const syncSize = () => {
      const rect = cv.getBoundingClientRect();
      cv.width = Math.max(300, Math.round(rect.width * dpr));
      cv.height = Math.max(220, Math.round(rect.height * dpr));
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [pitchViewMode]);

  useEffect(() => {
    if (pitchViewMode !== "3d") return;
    let rafId = 0;
    let lastDraw = 0;

    const renderLoop = (ts: number) => {
      // Smooth 30fps 3D Pitch Twin synced to livePlaybackBridge without React re-render lag
      if (ts - lastDraw >= 32) {
        lastDraw = ts;
        const cv = canvasRef.current;
        const activeFrame = livePlaybackBridge.frame || frame;
        const isCal = Boolean(activeFrame && activeFrame.cal_src !== "none");
        if (cv) {
          const ctx = cv.getContext("2d");
          const w = cv.width;
          const h = cv.height;
          const dpr = Math.min(1.5, window.devicePixelRatio || 1);
          if (ctx && w > 0 && h > 0) {
            const cfg = CAM_PRESETS[preset];
            const proj = makeProjector(w, h, cfg.yawDeg, cfg.tiltDeg, cfg.zoom);

            const bg = ctx.createRadialGradient(w * 0.5, h * 0.3, w * 0.08, w * 0.5, h * 0.5, w * 0.72);
            bg.addColorStop(0, "#102336");
            bg.addColorStop(1, "#050911");
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);

            const c00 = proj(0, 0, 0);
            const c10 = proj(PITCH_L, 0, 0);
            const c11 = proj(PITCH_L, PITCH_W, 0);
            const c01 = proj(0, PITCH_W, 0);
            const b01 = proj(0, PITCH_W, -2.6);
            const b11 = proj(PITCH_L, PITCH_W, -2.6);

            ctx.beginPath();
            ctx.moveTo(c01.x, c01.y);
            ctx.lineTo(c11.x, c11.y);
            ctx.lineTo(b11.x, b11.y);
            ctx.lineTo(b01.x, b01.y);
            ctx.closePath();
            ctx.fillStyle = "#062115";
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(c00.x, c00.y);
            ctx.lineTo(c10.x, c10.y);
            ctx.lineTo(c11.x, c11.y);
            ctx.lineTo(c01.x, c01.y);
            ctx.closePath();
            ctx.fillStyle = "#0b3120";
            ctx.fill();

            for (let s = 0; s < 10; s += 2) {
              const x0 = (s / 10) * PITCH_L;
              const x1 = ((s + 1) / 10) * PITCH_L;
              const p1 = proj(x0, 0, 0);
              const p2 = proj(x1, 0, 0);
              const p3 = proj(x1, PITCH_W, 0);
              const p4 = proj(x0, PITCH_W, 0);
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.lineTo(p3.x, p3.y);
              ctx.lineTo(p4.x, p4.y);
              ctx.closePath();
              ctx.fillStyle = "rgba(16, 185, 129, 0.085)";
              ctx.fill();
            }

            if (isCal && show3DVoronoi && activeFrame?.voronoi_cells?.length) {
              for (const cell of activeFrame.voronoi_cells) {
                if (cell.poly_m.length < 3) continue;
                const col = cell.team_id === 0 ? k0 : k1;
                ctx.beginPath();
                cell.poly_m.forEach(([xm, ym], i) => {
                  const p = proj(xm, ym, 0.05);
                  if (i === 0) ctx.moveTo(p.x, p.y);
                  else ctx.lineTo(p.x, p.y);
                });
                ctx.closePath();
                ctx.fillStyle = hexToRgba(col, 0.16);
                ctx.fill();
                ctx.strokeStyle = hexToRgba(col, 0.32);
                ctx.lineWidth = 1;
                ctx.stroke();
              }
            }

            const drawLine3D = (a: [number, number, number], b: [number, number, number], stroke = "rgba(226,232,240,0.48)", lw = 1.2) => {
              const pa = proj(a[0], a[1], a[2]);
              const pb = proj(b[0], b[1], b[2]);
              ctx.beginPath();
              ctx.moveTo(pa.x, pa.y);
              ctx.lineTo(pb.x, pb.y);
              ctx.strokeStyle = stroke;
              ctx.lineWidth = lw;
              ctx.stroke();
            };
            const drawRect3D = (x0: number, y0: number, x1: number, y1: number) => {
              drawLine3D([x0, y0, 0], [x1, y0, 0]);
              drawLine3D([x1, y0, 0], [x1, y1, 0]);
              drawLine3D([x1, y1, 0], [x0, y1, 0]);
              drawLine3D([x0, y1, 0], [x0, y0, 0]);
            };
            drawRect3D(0, 0, PITCH_L, PITCH_W);
            drawLine3D([PITCH_L / 2, 0, 0], [PITCH_L / 2, PITCH_W, 0]);
            drawRect3D(0, 13.84, 16.5, 54.16);
            drawRect3D(PITCH_L - 16.5, 13.84, PITCH_L, 54.16);
            drawRect3D(0, 24.84, 5.5, 43.16);
            drawRect3D(PITCH_L - 5.5, 24.84, PITCH_L, 43.16);

            ctx.beginPath();
            for (let i = 0; i <= 32; i++) {
              const a = (i / 32) * Math.PI * 2;
              const p = proj(PITCH_L / 2 + 9.15 * Math.cos(a), PITCH_W / 2 + 9.15 * Math.sin(a), 0);
              if (i === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = "rgba(226,232,240,0.45)";
            ctx.lineWidth = 1.2;
            ctx.stroke();

            const drawGoal = (gx: number, backDx: number) => {
              const yA = 30.34;
              const yB = 37.66;
              const gh = 3.2;
              drawLine3D([gx, yA, 0], [gx, yA, gh], "rgba(248,250,252,0.85)", 2);
              drawLine3D([gx, yB, 0], [gx, yB, gh], "rgba(248,250,252,0.85)", 2);
              drawLine3D([gx, yA, gh], [gx, yB, gh], "rgba(248,250,252,0.85)", 2);
              drawLine3D([gx, yA, gh], [gx + backDx, yA, gh * 0.7], "rgba(203,213,225,0.45)", 1);
              drawLine3D([gx, yB, gh], [gx + backDx, yB, gh * 0.7], "rgba(203,213,225,0.45)", 1);
              drawLine3D([gx + backDx, yA, 0], [gx + backDx, yB, 0], "rgba(203,213,225,0.35)", 1);
            };
            drawGoal(0, -2.2);
            drawGoal(PITCH_L, 2.2);

            if (isCal && activeFrame?.camera_fov_m?.length === 4) {
              ctx.beginPath();
              activeFrame.camera_fov_m.forEach(([xm, ym], i) => {
                const p = proj(xm, ym, 0.1);
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
              });
              ctx.closePath();
              ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
              ctx.fill();
              ctx.strokeStyle = "rgba(255, 255, 255, 0.30)";
              ctx.setLineDash([5, 4]);
              ctx.lineWidth = 1.1;
              ctx.stroke();
              ctx.setLineDash([]);
            }

            if (isCal && activeFrame?.formations) {
              for (const [tk, fm] of Object.entries(activeFrame.formations)) {
                const col = tk === "0" ? k0 : k1;
                if (fm.def_line_x_m !== undefined) {
                  const b0 = proj(fm.def_line_x_m, 3, 0);
                  const b1 = proj(fm.def_line_x_m, PITCH_W - 3, 0);
                  const t1 = proj(fm.def_line_x_m, PITCH_W - 3, 4.2);
                  const t0 = proj(fm.def_line_x_m, 3, 4.2);
                  ctx.beginPath();
                  ctx.moveTo(b0.x, b0.y);
                  ctx.lineTo(b1.x, b1.y);
                  ctx.lineTo(t1.x, t1.y);
                  ctx.lineTo(t0.x, t0.y);
                  ctx.closePath();
                  ctx.fillStyle = hexToRgba(col, 0.18);
                  ctx.fill();
                  drawLine3D([fm.def_line_x_m, 3, 0], [fm.def_line_x_m, PITCH_W - 3, 0], col, 2.2);
                }
              }
              for (const gap of activeFrame.defensive_gaps || []) {
                drawLine3D([gap.from_m[0], gap.from_m[1], 0.5], [gap.to_m[0], gap.to_m[1], 0.5], "#fb7185", 2.8);
              }
            }

            if (isCal && activeFrame?.passing_lanes?.length) {
              for (const ln of activeFrame.passing_lanes.slice(0, 4)) {
                if (ln.status === "blocked") continue;
                const p0 = proj(ln.from_m[0], ln.from_m[1], 0.5);
                const p1 = proj(ln.to_m[0], ln.to_m[1], 0.5);
                const midZ = Math.min(11, Math.max(3.5, ln.distance_m * 0.24));
                const pm = proj((ln.from_m[0] + ln.to_m[0]) * 0.5, (ln.from_m[1] + ln.to_m[1]) * 0.5, midZ);
                const col = ln.status === "line_breaking" ? "#10b981" : ln.status === "open" ? "#38bdf8" : "#f59e0b";

                drawLine3D([ln.from_m[0], ln.from_m[1], 0.05], [ln.to_m[0], ln.to_m[1], 0.05], "rgba(0,0,0,0.45)", 1.5);

                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.quadraticCurveTo(pm.x, pm.y, p1.x, p1.y);
                ctx.strokeStyle = col;
                ctx.lineWidth = ln.status === "line_breaking" ? 2.6 : 1.7;
                ctx.stroke();
              }
            }

            const hitList: { x: number; y: number; identityKey: string }[] = [];
            if (isCal && activeFrame?.players?.length) {
              const drawable = activeFrame.players
                .filter((p) => p.on_pitch && p.x_m !== null && p.y_m !== null)
                .map((p) => ({
                  p,
                  base: proj(p.x_m!, p.y_m!, 0),
                  top: proj(p.x_m!, p.y_m!, 3.4),
                }))
                .sort((a, b) => b.base.depth - a.base.depth);

              for (const item of drawable) {
                const { p, base, top } = item;
                const isRef = p.role === "referee";
                const isCarrier = activeFrame.ball_carrier_track_id === p.track_id;
                const isSelected = Boolean(selectedIdentityKey && p.identity_key === selectedIdentityKey);
                const col = isRef ? "#f59e0b" : p.team_id === 0 ? k0 : p.team_id === 1 ? k1 : "#94a3b8";
                const rPx = Math.max(3.8, base.s * 1.15);

                if (p.identity_key && !isRef) {
                  hitList.push({ x: top.x / dpr, y: top.y / dpr, identityKey: p.identity_key });
                }

                if ((p.speed_kmh ?? 0) >= 8.5 && (p.vx_ms || p.vy_ms)) {
                  const vNorm = Math.hypot(p.vx_ms || 0, p.vy_ms || 0) || 1;
                  const lenM = Math.min(4.0, (p.speed_kmh || 0) * 0.12);
                  drawLine3D(
                    [p.x_m!, p.y_m!, 0.15],
                    [p.x_m! + ((p.vx_ms || 0) / vNorm) * lenM, p.y_m! + ((p.vy_ms || 0) / vNorm) * lenM, 0.15],
                    (p.speed_kmh || 0) >= 23 ? "#facc15" : hexToRgba(col, 0.9),
                    2.0
                  );
                }

                if (isSelected || isCarrier) {
                  const high = proj(p.x_m!, p.y_m!, 14.0);
                  const grad = ctx.createLinearGradient(base.x, base.y, high.x, high.y);
                  const scol = isSelected ? "#22d3ee" : "#facc15";
                  grad.addColorStop(0, hexToRgba(scol, 0.42));
                  grad.addColorStop(1, hexToRgba(scol, 0.0));
                  ctx.beginPath();
                  ctx.moveTo(base.x - rPx, base.y);
                  ctx.lineTo(base.x + rPx, base.y);
                  ctx.lineTo(high.x + rPx * 1.6, high.y);
                  ctx.lineTo(high.x - rPx * 1.6, high.y);
                  ctx.closePath();
                  ctx.fillStyle = grad;
                  ctx.fill();
                }

                ctx.beginPath();
                ctx.ellipse(base.x + 2, base.y + 1.5, rPx * 1.15, rPx * 0.62, 0, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
                ctx.fill();

                ctx.beginPath();
                ctx.ellipse(base.x, base.y, rPx * 1.25, rPx * 0.65, 0, 0, Math.PI * 2);
                ctx.strokeStyle = isSelected ? "#22d3ee" : isCarrier ? "#facc15" : hexToRgba(col, 0.8);
                ctx.lineWidth = isSelected || isCarrier ? 2.2 : 1.2;
                ctx.stroke();

                const pGrad = ctx.createLinearGradient(base.x, base.y, top.x, top.y);
                pGrad.addColorStop(0, hexToRgba(col, 0.35));
                pGrad.addColorStop(1, col);
                ctx.beginPath();
                ctx.moveTo(base.x - rPx * 0.62, base.y);
                ctx.lineTo(base.x + rPx * 0.62, base.y);
                ctx.lineTo(top.x + rPx * 0.78, top.y);
                ctx.lineTo(top.x - rPx * 0.78, top.y);
                ctx.closePath();
                ctx.fillStyle = pGrad;
                ctx.fill();

                ctx.beginPath();
                ctx.arc(top.x, top.y, rPx * 0.85, 0, Math.PI * 2);
                ctx.fillStyle = isSelected ? "#22d3ee" : col;
                ctx.fill();
                ctx.strokeStyle = "#070b12";
                ctx.lineWidth = 1.4;
                ctx.stroke();

                const tag = p.bound_jersey ?? p.jersey_ocr ?? p.track_id;
                ctx.fillStyle = "#070b12";
                ctx.font = `900 ${Math.max(8, Math.round(rPx * 1.05))}px monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(String(tag), top.x, top.y + 0.5);
              }
            }
            screenPlayersRef.current = hitList;

            if (isCal && activeFrame?.ball && activeFrame.ball.x_m !== null && activeFrame.ball.y_m !== null) {
              const bGround = proj(activeFrame.ball.x_m, activeFrame.ball.y_m, 0);
              const bAir = proj(activeFrame.ball.x_m, activeFrame.ball.y_m, 1.3);
              ctx.beginPath();
              ctx.ellipse(bGround.x, bGround.y, 4.5, 2.5, 0, 0, Math.PI * 2);
              ctx.fillStyle = "rgba(0,0,0,0.5)";
              ctx.fill();

              ctx.beginPath();
              ctx.arc(bAir.x, bAir.y, 6.2, 0, Math.PI * 2);
              ctx.fillStyle = "rgba(250, 204, 21, 0.3)";
              ctx.fill();

              ctx.beginPath();
              ctx.arc(bAir.x, bAir.y, 4.4, 0, Math.PI * 2);
              ctx.fillStyle = "#facc15";
              ctx.fill();
            }
          }
        }
      }
      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [frame, teamKits, pitchViewMode, preset, show3DVoronoi, selectedIdentityKey, k0, k1]);

  const handle3DClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let bestKey: string | null = null;
    let bestD = 22;
    for (const item of screenPlayersRef.current) {
      const d = Math.hypot(item.x - mx, item.y - my);
      if (d < bestD) {
        bestD = d;
        bestKey = item.identityKey;
      }
    }
    if (bestKey) {
      if (bestKey === selectedIdentityKey) openVideoDossier(bestKey);
      else setSelectedIdentityKey(bestKey);
    }
  };

  const pc0 = frame?.pitch_control?.["0"];
  const pc1 = frame?.pitch_control?.["1"];

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-3.5 space-y-3 shadow-xl">
      {/* Header + 3D/2D Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-black text-slate-100">
            {pitchViewMode === "3d" ? "التوأم التكتيكي ثلاثي الأبعاد 3D" : "الرادار الميداني 2D FIFA"}
          </span>
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
              calibrated ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/20 text-amber-300"
            }`}
          >
            {calibrated ? `${frame?.cal_src}` : "غير معايَرة"}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-0.5">
          <button
            onClick={() => setPitchViewMode("3d")}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
              pitchViewMode === "3d" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <Box className="h-3.5 w-3.5" />
            3D حي
          </button>
          <button
            onClick={() => setPitchViewMode("2d")}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
              pitchViewMode === "2d" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
            }`}
          >
            <MapIcon className="h-3.5 w-3.5" />
            2D FIFA
          </button>
        </div>
      </div>

      {/* 3D Camera Angle Presets + Voronoi Toggle */}
      {pitchViewMode === "3d" && (
        <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
          <div className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5 text-slate-400 ml-0.5" />
            {(Object.keys(CAM_PRESETS) as CamPreset[]).map((k) => (
              <button
                key={k}
                onClick={() => setPreset(k)}
                className={`rounded-lg px-2 py-1 font-bold transition ${
                  preset === k
                    ? "bg-cyan-500/20 text-cyan-200 border border-cyan-400/40"
                    : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-white"
                }`}
              >
                {CAM_PRESETS[k].label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShow3DVoronoi((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold transition ${
              show3DVoronoi
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "bg-slate-900 text-slate-400 border border-slate-800"
            }`}
          >
            <Layers className="h-3 w-3" />
            Voronoi
          </button>
        </div>
      )}

      {/* Viewport */}
      {pitchViewMode === "3d" ? (
        <div className="relative overflow-hidden rounded-xl border border-emerald-900/50 bg-[#050911]" dir="ltr">
          <canvas
            ref={canvasRef}
            onClick={handle3DClick}
            title="اضغط على أي لاعب لتسليط الضوء، واضغط مرة ثانية لفتح بروفايله الكامل"
            className="block h-[265px] w-full cursor-pointer"
          />
        </div>
      ) : (
        <PitchRadar2D embedded />
      )}

      {/* Live Voronoi Pitch Control Split Bar */}
      {calibrated && pc0 !== undefined && pc1 !== undefined && (
        <div className="space-y-1 text-[11px]">
          <div className="flex items-center justify-between font-bold tabular-nums">
            <span style={{ color: k0 }}>
              {name0} {pc0}%
            </span>
            <span className="text-[10px] text-slate-400">السيطرة المكانية الحية (Voronoi)</span>
            <span style={{ color: k1 }}>
              {pc1}% {name1}
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800" dir="ltr">
            <div style={{ width: `${pc0}%`, backgroundColor: k0 }} className="transition-all duration-300" />
            <div style={{ width: `${pc1}%`, backgroundColor: k1 }} className="transition-all duration-300" />
          </div>
        </div>
      )}

      {/* Per-Team Real-Time Formation & Compactness Cards */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {(["0", "1"] as const).map((tk) => {
          const fm = frame?.formations?.[tk];
          const tName = tk === hc ? currentMatch?.home_team_name || "فريق 1" : currentMatch?.away_team_name || "فريق 2";
          const col = tk === "0" ? k0 : k1;
          return (
            <div key={tk} className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
              <div className="flex items-center justify-between font-bold">
                <span className="flex items-center gap-1.5 text-slate-100 truncate">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: col }} />
                  {tName}
                </span>
                <span className="font-mono text-emerald-300 font-black">{fm?.formation || "—"}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[10px] tabular-nums">
                <div className="rounded bg-slate-900 py-1">
                  <div className="text-slate-500">عرض</div>
                  <div className="font-mono font-bold text-slate-200">{fm ? `${fm.width_m}م` : "—"}</div>
                </div>
                <div className="rounded bg-slate-900 py-1">
                  <div className="text-slate-500">طول</div>
                  <div className="font-mono font-bold text-slate-200">{fm ? `${fm.length_m}م` : "—"}</div>
                </div>
                <div className="rounded bg-slate-900 py-1">
                  <div className="text-slate-500">دفاع</div>
                  <div className="font-mono font-bold text-cyan-300">{fm ? `${fm.def_line_m}م` : "—"}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Frame Alerts (Passing Lanes + Gaps) */}
      {calibrated && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-300">
          <span>
            ممرات كاسرة متاحة:{" "}
            <strong className="font-mono text-emerald-300">
              {(frame?.passing_lanes || []).filter((l) => l.status === "line_breaking").length}
            </strong>
          </span>
          <span>
            ثغرات دفاعية &gt;16م:{" "}
            <strong className={`font-mono ${(frame?.defensive_gaps?.length || 0) > 0 ? "text-rose-400" : "text-slate-400"}`}>
              {frame?.defensive_gaps?.length || 0}
            </strong>
          </span>
          <span>
            خطأ الإسقاط: <strong className="font-mono text-cyan-300">{frame?.cal_err_px ?? "—"}px</strong>
          </span>
        </div>
      )}
    </div>
  );
}
