"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CircleDot, Download, Eraser, Pause, Play, Sparkles, SquareDashed, Volume2, VolumeX } from "lucide-react";
import { API_BASE, type TelemetryFrame, apiFetch } from "@/lib/api";
import { interpolateTelemetryFrame, resolveNearestFrame, type TelestratorTool, useTacticalStore } from "@/store/useTacticalStore";

function hexToRgba(hex: string, alpha: number): string {
  const s = (hex || "").trim().replace("#", "");
  if (s.length !== 6) return `rgba(56, 189, 248, ${alpha})`;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return `rgba(56, 189, 248, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawCanvasArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 7;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

interface TelestratorShape {
  kind: Exclude<TelestratorTool, "none">;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function projectMetersToCanvas(
  xm: number,
  ym: number,
  hInv: number[] | null | undefined,
  w: number,
  h: number
): [number, number] | null {
  if (!hInv || hInv.length !== 9) return null;
  const px = hInv[0] * xm + hInv[1] * ym + hInv[2];
  const py = hInv[3] * xm + hInv[4] * ym + hInv[5];
  const pz = hInv[6] * xm + hInv[7] * ym + hInv[8];
  if (Math.abs(pz) < 1e-6) return null;
  const uNorm = px / pz;
  const vNorm = py / pz;
  if (!Number.isFinite(uNorm) || !Number.isFinite(vNorm)) return null;
  return [uNorm * w, vNorm * h];
}

export default function SynchronizedVideoCanvas() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentMatch = useTacticalStore((s) => s.currentMatch);
  const fps = useTacticalStore((s) => s.fps);
  const videoWidth = useTacticalStore((s) => s.videoWidth);
  const videoHeight = useTacticalStore((s) => s.videoHeight);
  const frameMap = useTacticalStore((s) => s.frameMap);
  const teamKits = useTacticalStore((s) => s.teamKits);
  const selectedIdentity = useTacticalStore((s) => s.selectedIdentity);
  const layers = useTacticalStore((s) => s.layers);
  const seekTargetS = useTacticalStore((s) => s.seekTargetS);
  const isPlaying = useTacticalStore((s) => s.isPlaying);
  const currentTimeS = useTacticalStore((s) => s.currentTimeS);
  const setPlaybackState = useTacticalStore((s) => s.setPlaybackState);
  const setSelectedIdentity = useTacticalStore((s) => s.setSelectedIdentity);
  const requestSeek = useTacticalStore((s) => s.requestSeek);
  const toggleLayer = useTacticalStore((s) => s.toggleLayer);
  const telestratorTool = useTacticalStore((s) => s.telestratorTool);
  const setTelestratorTool = useTacticalStore((s) => s.setTelestratorTool);

  const [aspect, setAspect] = useState<number>(videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(0);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const annotationsRef = useRef<TelestratorShape[]>([]);
  const draftShapeRef = useRef<TelestratorShape | null>(null);
  const [annotationCount, setAnnotationCount] = useState(0);

  // Sync external seek requests (e.g. clicking Hudl timeline tags)
  useEffect(() => {
    const vid = videoRef.current;
    if (vid && seekTargetS !== null) {
      vid.currentTime = Math.max(0, seekTargetS);
      requestSeek(null);
    }
  }, [seekTargetS, requestSeek]);

  // Zero-drift render loop synchronized directly to HTML5 video frames
  useEffect(() => {
    const vid = videoRef.current;
    const cvs = canvasRef.current;
    if (!vid || !cvs) return;

    let rafId = 0;
    let vfcHandle: number | null = null;
    const vidAny = vid as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    const drawOverlay = () => {
      const rect = cvs.getBoundingClientRect();
      const w = Math.max(320, Math.round(rect.width * (window.devicePixelRatio || 1)));
      const h = Math.max(180, Math.round(rect.height * (window.devicePixelRatio || 1)));
      if (cvs.width !== w || cvs.height !== h) {
        cvs.width = w;
        cvs.height = h;
      }

      const ctx = cvs.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      const tNow = vid.currentTime || 0;
      const exactFrame = tNow * (fps || 25);
      const frameIdx = Math.floor(exactFrame);
      setPlaybackState(frameIdx, tNow, !vid.paused);

      const f: TelemetryFrame | undefined = interpolateTelemetryFrame(frameMap, exactFrame);
      if (!f) return;

      const hInv = f.h_inv;
      const kit0Color = currentMatch?.summary?.team_kits?.["0"]?.ring || teamKits?.["0"]?.ring || "#ef4444";
      const kit1Color = currentMatch?.summary?.team_kits?.["1"]?.ring || teamKits?.["1"]?.ring || "#38bdf8";

      if (f.is_tactical_wide === false) {
        ctx.save();
        const pillText = "لقطة قريبة / إعادة — إيقاف الرسم التكتيكي مؤقتاً";
        ctx.font = `bold ${Math.max(11, Math.round(h * 0.017))}px sans-serif`;
        const pw = ctx.measureText(pillText).width + 24;
        ctx.fillStyle = "rgba(15, 23, 42, 0.86)";
        ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(14, 14, pw, 28, 999);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e2e8f0";
        ctx.textAlign = "left";
        ctx.fillText(pillText, 26, 32);
        ctx.restore();
      } else {
        // 1. 3D Projected Voronoi Polygons on Grass
        if (layers.showVoronoi3D && hInv && f.voronoi_polys?.length) {
          for (const vp of f.voronoi_polys) {
            if (vp.points_m.length < 3) continue;
            ctx.beginPath();
            let started = false;
            for (const [xm, ym] of vp.points_m) {
              const p = projectMetersToCanvas(xm, ym, hInv, w, h);
              if (!p) continue;
              if (!started) {
                ctx.moveTo(p[0], p[1]);
                started = true;
              } else {
                ctx.lineTo(p[0], p[1]);
              }
            }
            if (started) {
              ctx.closePath();
              const kCol = vp.team_cluster === 0 ? kit0Color : kit1Color;
              ctx.fillStyle = hexToRgba(kCol, 0.14);
              ctx.strokeStyle = hexToRgba(kCol, 0.36);
              ctx.lineWidth = 1;
              ctx.fill();
              ctx.stroke();
            }
          }
        }

        // 2. Cover Shadows + Zero-Drift 3D Bezier Passing Lanes
        if (layers.showPassingLanes) {
          if (hInv) {
            for (const sh of f.cover_shadows || []) {
              if (sh.polygon_m.length < 3) continue;
              ctx.beginPath();
              let started = false;
              for (const [xm, ym] of sh.polygon_m) {
                const p = projectMetersToCanvas(xm, ym, hInv, w, h);
                if (!p) continue;
                if (!started) {
                  ctx.moveTo(p[0], p[1]);
                  started = true;
                } else {
                  ctx.lineTo(p[0], p[1]);
                }
              }
              if (started) {
                ctx.closePath();
                ctx.fillStyle = "rgba(15, 23, 42, 0.40)";
                ctx.strokeStyle = "rgba(239, 68, 68, 0.25)";
                ctx.lineWidth = 1;
                ctx.fill();
                ctx.stroke();
              }
            }
          }

          for (const lane of (f.passing_lanes || []).slice(0, 3)) {
            const p0: [number, number] | null = lane.from_uv
              ? [lane.from_uv[0] * w, lane.from_uv[1] * h]
              : projectMetersToCanvas(lane.from_m[0], lane.from_m[1], hInv, w, h);
            const p1: [number, number] | null = lane.to_uv
              ? [lane.to_uv[0] * w, lane.to_uv[1] * h]
              : projectMetersToCanvas(lane.to_m[0], lane.to_m[1], hInv, w, h);
            if (!p0 || !p1) continue;

            const color =
              lane.status === "line_breaking"
                ? "#10b981"
                : lane.status === "safe_open"
                ? "#38bdf8"
                : "#ef4444";

            const ctrlX = 0.5 * (p0[0] + p1[0]);
            const ctrlY = 0.5 * (p0[1] + p1[1]) - h * 0.055;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(p0[0], p0[1]);
            ctx.quadraticCurveTo(ctrlX, ctrlY, p1[0], p1[1]);
            ctx.strokeStyle = color;
            ctx.lineWidth = lane.status === "line_breaking" ? 3 : 2;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            if (lane.status === "blocked") ctx.setLineDash([6, 6]);
            ctx.stroke();
            ctx.restore();

            const peakX = 0.25 * p0[0] + 0.5 * ctrlX + 0.25 * p1[0];
            const peakY = 0.25 * p0[1] + 0.5 * ctrlY + 0.25 * p1[1];
            const badge = `${Math.round(lane.xpass_pct)}%${lane.is_line_breaking ? " كاسر" : ""}`;
            ctx.font = `bold ${Math.max(11, Math.round(h * 0.017))}px sans-serif`;
            const tw = ctx.measureText(badge).width + 12;
            ctx.fillStyle = "rgba(7, 11, 18, 0.85)";
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(peakX - tw / 2, peakY - 12, tw, 20, 6);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.textAlign = "center";
            ctx.fillText(badge, peakX, peakY + 3);
          }
        }

        // 3. Zero-Drift Pixel-Locked Dynamic Tactical Mesh Chains + Unit Polygon Bands + >16m Gap Alert
        if (layers.showTacticalMesh && f.formations) {
          for (const tc of ["0", "1"] as const) {
            const form = f.formations[tc];
            if (!form) continue;
            const baseColor = tc === "0" ? kit0Color : kit1Color;
            const chainsUv = form.lines_uv && form.lines_uv.length > 0 ? form.lines_uv : null;
            const chainsM = form.lines || [];

            if (chainsUv && chainsUv.length >= 2) {
              for (let ci = 0; ci < chainsUv.length - 1; ci++) {
                const cA = chainsUv[ci];
                const cB = chainsUv[ci + 1];
                if (cA.length < 2 || cB.length < 2) continue;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(cA[0][0] * w, cA[0][1] * h);
                for (let k = 1; k < cA.length; k++) ctx.lineTo(cA[k][0] * w, cA[k][1] * h);
                for (let k = cB.length - 1; k >= 0; k--) ctx.lineTo(cB[k][0] * w, cB[k][1] * h);
                ctx.closePath();
                ctx.fillStyle = hexToRgba(baseColor, 0.07);
                ctx.fill();
                ctx.restore();
              }
            }

            if (chainsUv) {
              for (let ci = 0; ci < chainsUv.length; ci++) {
                const uvChain = chainsUv[ci];
                if (uvChain.length < 2) continue;
                const mChain = chainsM[ci] || [];
                for (let i = 0; i < uvChain.length - 1; i++) {
                  const pa: [number, number] = [uvChain[i][0] * w, uvChain[i][1] * h];
                  const pb: [number, number] = [uvChain[i + 1][0] * w, uvChain[i + 1][1] * h];
                  const hasMeters = i + 1 < mChain.length;
                  const distM = hasMeters ? Math.hypot(mChain[i + 1][0] - mChain[i][0], mChain[i + 1][1] - mChain[i][1]) : 0;
                  const isGap = hasMeters && distM > 16.0;
                  const stroke = isGap ? "#ef4444" : baseColor;

                  ctx.save();
                  ctx.beginPath();
                  ctx.moveTo(pa[0], pa[1]);
                  ctx.lineTo(pb[0], pb[1]);
                  ctx.strokeStyle = isGap ? "rgba(239, 68, 68, 0.92)" : hexToRgba(baseColor, 0.72);
                  ctx.lineWidth = isGap ? 3 : 2;
                  if (isGap) {
                    ctx.setLineDash([7, 5]);
                    ctx.shadowColor = "#ef4444";
                    ctx.shadowBlur = 10;
                  }
                  ctx.stroke();
                  ctx.restore();

                  if (hasMeters && distM > 0.5) {
                    const mx = 0.5 * (pa[0] + pb[0]);
                    const my = 0.5 * (pa[1] + pb[1]);
                    const lbl = isGap ? `⚠ ${distM.toFixed(1)}m` : `${distM.toFixed(1)}m`;
                    ctx.font = `bold ${Math.max(10, Math.round(h * 0.015))}px monospace`;
                    const bw = ctx.measureText(lbl).width + 10;
                    ctx.fillStyle = isGap ? "rgba(127, 29, 29, 0.9)" : "rgba(7, 11, 18, 0.78)";
                    ctx.beginPath();
                    ctx.roundRect(mx - bw / 2, my - 9, bw, 17, 5);
                    ctx.fill();
                    ctx.fillStyle = isGap ? "#fecaca" : stroke;
                    ctx.textAlign = "center";
                    ctx.fillText(lbl, mx, my + 3);
                  }
                }
              }
            } else if (hInv) {
              for (const chain of chainsM) {
                if (chain.length < 2) continue;
                for (let i = 0; i < chain.length - 1; i++) {
                  const a = chain[i];
                  const b = chain[i + 1];
                  const distM = Math.hypot(b[0] - a[0], b[1] - a[1]);
                  const pa = projectMetersToCanvas(a[0], a[1], hInv, w, h);
                  const pb = projectMetersToCanvas(b[0], b[1], hInv, w, h);
                  if (!pa || !pb) continue;
                  const isGap = distM > 16.0;
                  const stroke = isGap ? "#ef4444" : baseColor;
                  ctx.save();
                  ctx.beginPath();
                  ctx.moveTo(pa[0], pa[1]);
                  ctx.lineTo(pb[0], pb[1]);
                  ctx.strokeStyle = isGap ? "rgba(239, 68, 68, 0.92)" : hexToRgba(baseColor, 0.72);
                  ctx.lineWidth = isGap ? 3 : 1.8;
                  if (isGap) ctx.setLineDash([7, 5]);
                  ctx.stroke();
                  ctx.restore();
                }
              }
            }
          }
        }

        // 4. Trajectory Trail for selected player
        if (layers.showTrail && selectedIdentity) {
          const trailPts: [number, number][] = [];
          for (let offset = 28; offset >= 0; offset -= 2) {
            const past = resolveNearestFrame(frameMap, frameIdx - offset);
            const matchP = past?.players.find((p) => p.identity_key === selectedIdentity);
            if (matchP) {
              trailPts.push([matchP.u_norm * w, matchP.v_norm * h]);
            }
          }
          if (trailPts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(trailPts[0][0], trailPts[0][1]);
            for (let i = 1; i < trailPts.length; i++) {
              ctx.lineTo(trailPts[i][0], trailPts[i][1]);
            }
            ctx.strokeStyle = "rgba(16, 185, 129, 0.85)";
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }

        // 5. Dual Concentric 3D Foot Ellipses + Spotlight Beam + Velocity Vector + Selective Broadcast Nameplates
        if (layers.show3DRings) {
          for (const p of f.players) {
            if (p.role === "referee") continue;
            const cx = p.u_norm * w;
            const cy = p.v_norm * h;
            const boxH = Math.max(24, (p.y2_norm - p.y1_norm) * h);
            const rx = Math.max(12, (p.x2_norm - p.x1_norm) * w * 0.65);
            const ry = Math.max(5, rx * 0.33);

            const isSelected = selectedIdentity === p.identity_key;
            const isCarrier = f.ball_carrier_track_id > 0 && p.track_id === f.ball_carrier_track_id;
            const teamColor = p.team_cluster === 0 ? kit0Color : p.team_cluster === 1 ? kit1Color : "#94a3b8";
            const glowColor = isSelected ? "#10b981" : isCarrier ? "#22d3ee" : teamColor;

            // Vertical 3D Spotlight Pillar for carrier or selected player
            if (isSelected || isCarrier) {
              const grad = ctx.createLinearGradient(cx, cy - boxH * 1.45, cx, cy);
              grad.addColorStop(0, "rgba(16, 185, 129, 0)");
              grad.addColorStop(1, isSelected ? "rgba(16, 185, 129, 0.34)" : "rgba(34, 211, 238, 0.28)");
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.moveTo(cx - rx * 0.45, cy - boxH * 1.45);
              ctx.lineTo(cx + rx * 0.45, cy - boxH * 1.45);
              ctx.lineTo(cx + rx * 1.08, cy);
              ctx.lineTo(cx - rx * 1.08, cy);
              ctx.closePath();
              ctx.fill();
            }

            // Outer concentric broadcast aura ring
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx * 1.26, ry * 1.26, 0, -Math.PI * 0.12, Math.PI * 1.12);
            ctx.strokeStyle = hexToRgba(glowColor, 0.45);
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // Primary inner 3D open foot ring
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, -Math.PI * 0.16, Math.PI * 1.16);
            ctx.strokeStyle = glowColor;
            ctx.lineWidth = isSelected || isCarrier ? 3.2 : 2.1;
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = isSelected || isCarrier ? 14 : 6;
            ctx.stroke();
            ctx.restore();

            // Perspective-true velocity vector arrow on sprinting/running players
            if (p.speed_kmh >= 9.0 && (Math.abs(p.vx) + Math.abs(p.vy)) > 0.4) {
              let dirX = p.vx;
              let dirY = -p.vy;
              if (hInv) {
                const pA = projectMetersToCanvas(p.x_m, p.y_m, hInv, w, h);
                const pB = projectMetersToCanvas(p.x_m + p.vx * 0.35, p.y_m + p.vy * 0.35, hInv, w, h);
                if (pA && pB) {
                  dirX = pB[0] - pA[0];
                  dirY = pB[1] - pA[1];
                }
              }
              const mag = Math.hypot(dirX, dirY);
              if (mag > 0.01) {
                const len = Math.min(34, Math.max(12, p.speed_kmh * 1.15));
                drawCanvasArrow(ctx, cx, cy, cx + (dirX / mag) * len, cy + (dirY / mag) * len, glowColor);
              }
            }

            // Uncluttered Selective Broadcast Nameplates
            const showDetailed = isSelected || isCarrier || p.speed_kmh >= 18.0 || layers.showAllLabels;
            if (showDetailed) {
              const jPart = p.jersey_number ? `#${p.jersey_number}` : `#${p.track_id}`;
              const shortName = p.player_name ? p.player_name.split(" ").slice(-1)[0] : "";
              const spdPart = p.speed_kmh >= 15.0 ? ` ${p.speed_kmh.toFixed(0)}k` : "";
              const label = shortName ? `${jPart} ${shortName}${spdPart}` : `${jPart}${spdPart}`;
              ctx.font = `bold ${Math.max(10, Math.round(h * 0.015))}px sans-serif`;
              const lw = ctx.measureText(label).width + 12;
              ctx.fillStyle = isSelected ? "rgba(6, 78, 59, 0.92)" : "rgba(7, 11, 18, 0.82)";
              ctx.strokeStyle = hexToRgba(glowColor, 0.55);
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.roundRect(cx - lw / 2, cy + ry + 3, lw, 17, 5);
              ctx.fill();
              ctx.stroke();
              ctx.fillStyle = isSelected ? "#a7f3d0" : "#f1f5f9";
              ctx.textAlign = "center";
              ctx.fillText(label, cx, cy + ry + 15);
            }
          }

          // Ball glow beacon
          if (f.ball) {
            const bx = f.ball.u_norm * w;
            const by = f.ball.v_norm * h;
            ctx.save();
            ctx.beginPath();
            ctx.arc(bx, by, Math.max(7, w * 0.006), 0, Math.PI * 2);
            ctx.strokeStyle = "#fde047";
            ctx.lineWidth = 2.5;
            ctx.shadowColor = "#fde047";
            ctx.shadowBlur = 12;
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Coach Telestrator Drawings (saved shapes + active drag shape)
      const allShapes = draftShapeRef.current
        ? [...annotationsRef.current, draftShapeRef.current]
        : annotationsRef.current;
      for (const sh of allShapes) {
        const sx1 = sh.x1 * w;
        const sy1 = sh.y1 * h;
        const sx2 = sh.x2 * w;
        const sy2 = sh.y2 * h;
        ctx.save();
        if (sh.kind === "arrow") {
          const ang = Math.atan2(sy2 - sy1, sx2 - sx1);
          const headLen = Math.max(12, w * 0.015);
          ctx.strokeStyle = "#facc15";
          ctx.fillStyle = "#facc15";
          ctx.lineWidth = 3.2;
          ctx.shadowColor = "rgba(250, 204, 21, 0.7)";
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(sx2, sy2);
          ctx.lineTo(sx2 - headLen * Math.cos(ang - Math.PI / 6), sy2 - headLen * Math.sin(ang - Math.PI / 6));
          ctx.lineTo(sx2 - headLen * Math.cos(ang + Math.PI / 6), sy2 - headLen * Math.sin(ang + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        } else if (sh.kind === "circle") {
          const rad = Math.max(14, Math.hypot(sx2 - sx1, sy2 - sy1));
          ctx.strokeStyle = "#22d3ee";
          ctx.fillStyle = "rgba(34, 211, 238, 0.14)";
          ctx.lineWidth = 2.6;
          ctx.setLineDash([7, 5]);
          ctx.beginPath();
          ctx.ellipse(sx1, sy1, rad, rad * 0.48, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (sh.kind === "zone") {
          const rx0 = Math.min(sx1, sx2);
          const ry0 = Math.min(sy1, sy2);
          const rw = Math.abs(sx2 - sx1);
          const rh = Math.abs(sy2 - sy1);
          ctx.strokeStyle = "#fb7185";
          ctx.fillStyle = "rgba(244, 63, 94, 0.18)";
          ctx.lineWidth = 2.2;
          ctx.fillRect(rx0, ry0, rw, rh);
          ctx.strokeRect(rx0, ry0, rw, rh);
        }
        ctx.restore();
      }
    };

    const tick = () => {
      drawOverlay();
      rafId = requestAnimationFrame(tick);
    };

    const onVideoFrame = () => {
      drawOverlay();
      if (vidAny.requestVideoFrameCallback) {
        vfcHandle = vidAny.requestVideoFrameCallback(onVideoFrame);
      }
    };

    rafId = requestAnimationFrame(tick);
    if (vidAny.requestVideoFrameCallback) {
      vfcHandle = vidAny.requestVideoFrameCallback(onVideoFrame);
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (vfcHandle !== null && vidAny.cancelVideoFrameCallback) {
        vidAny.cancelVideoFrameCallback(vfcHandle);
      }
    };
  }, [fps, frameMap, layers, selectedIdentity, setPlaybackState, teamKits, currentMatch]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (telestratorTool !== "none") return;
    const cvs = canvasRef.current;
    if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;
    const f = resolveNearestFrame(frameMap, useTacticalStore.getState().currentFrameId);
    if (!f) return;

    let bestId: string | null = null;
    let bestD = 0.045;
    for (const p of f.players) {
      const d = Math.hypot(p.u_norm - clickX, p.v_norm - clickY);
      if (d < bestD) {
        bestD = d;
        bestId = p.identity_key;
      }
    }
    setSelectedIdentity(bestId === selectedIdentity ? null : bestId);
  };

  const _canvasNormCoords = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height))),
    ];
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (telestratorTool === "none") return;
    const [nx, ny] = _canvasNormCoords(e);
    draftShapeRef.current = { kind: telestratorTool, x1: nx, y1: ny, x2: nx, y2: ny };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draftShapeRef.current) return;
    const [nx, ny] = _canvasNormCoords(e);
    draftShapeRef.current = { ...draftShapeRef.current, x2: nx, y2: ny };
  };

  const handlePointerUp = () => {
    if (!draftShapeRef.current) return;
    const sh = draftShapeRef.current;
    draftShapeRef.current = null;
    if (Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1) > 0.015) {
      annotationsRef.current = [...annotationsRef.current, sh];
      setAnnotationCount(annotationsRef.current.length);
    }
  };

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) void vid.play();
    else vid.pause();
  };

  const handleExport3D = async () => {
    if (!currentMatch) return;
    setExportStatus("جاري رندر وتصدير فيديو 3D AR...");
    try {
      const res = await apiFetch<{ filename: string; download_url: string }>(`/api/matches/${currentMatch.id}/export-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_s: Math.max(0, currentTimeS - 5),
          end_s: Math.min(duration || currentMatch.duration_s || 60, currentTimeS + 10),
          highlight_identity: selectedIdentity,
        }),
      });
      setExportStatus(`بدأ الرندر: ${res.filename} (راقب التقدم في إدارة المباريات)`);
      setTimeout(() => setExportStatus(null), 5000);
    } catch (err) {
      setExportStatus(`تعذر التصدير: ${err instanceof Error ? err.message : "خطأ"}`);
    }
  };

  const videoSrc = currentMatch?.video_url ? `${API_BASE}${currentMatch.video_url}` : "";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-[#0d1420] p-3 shadow-2xl">
      {/* Zero-Drift Video + Canvas Aspect-Locked Container */}
      <div
        className="relative w-full overflow-hidden rounded-xl border border-slate-800 bg-black"
        style={{ aspectRatio: String(aspect) }}
      >
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            muted={muted}
            playsInline
            crossOrigin="anonymous"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) {
                setAspect(v.videoWidth / v.videoHeight);
              }
              setDuration(v.duration || 0);
            }}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-400">
            اختر مباراة محللة أو ارفع فيديو للبدء
          </div>
        )}
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
        />

        {/* Top Live Overlay Badge (Auto-Homography Active) */}
        <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-slate-950/80 px-3 py-1.5 text-xs backdrop-blur-md">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold text-emerald-300">Auto-Homography 3D AR • 100%</span>
        </div>
      </div>

      {/* Custom Scrub Bar & Transport Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800/70 bg-slate-950/60 px-3 py-2">
        <button
          onClick={togglePlay}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-slate-950 transition hover:bg-emerald-400"
          title={isPlaying ? "إيقاف مؤقت" : "تشغيل"}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>

        <input
          type="range"
          min={0}
          max={duration || currentMatch?.duration_s || 60}
          step={0.04}
          value={currentTimeS}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = parseFloat(e.target.value);
          }}
          className="h-1.5 flex-1 accent-emerald-500 cursor-pointer"
          dir="ltr"
        />

        <span className="tabular-nums text-xs text-slate-300" dir="ltr">
          {currentTimeS.toFixed(1)}s / {(duration || currentMatch?.duration_s || 0).toFixed(1)}s
        </span>

        <button
          onClick={() => setMuted((m) => !m)}
          className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:border-slate-500"
          title="الصوت"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>

        <button
          onClick={handleExport3D}
          className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/25"
        >
          <Download className="h-3.5 w-3.5" />
          تصدير مقطع 3D AR
        </button>
      </div>

      {/* Piero 3D Arabic Toggle Pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-400 ml-1">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          طبقات البث التكتيكي 3D:
        </span>

        <button
          onClick={() => toggleLayer("show3DRings")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
            layers.show3DRings
              ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
              : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200"
          }`}
        >
          حلقات اللاعبين والسرعة 3D
        </button>

        <button
          onClick={() => toggleLayer("showTacticalMesh")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
            layers.showTacticalMesh
              ? "border-amber-500 bg-amber-500/20 text-amber-200"
              : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200"
          }`}
        >
          خطوط التشكيل والمسافات بالمتر
        </button>

        <button
          onClick={() => toggleLayer("showPassingLanes")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
            layers.showPassingLanes
              ? "border-cyan-500 bg-cyan-500/20 text-cyan-200"
              : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200"
          }`}
        >
          مسارات التمرير والظل الدفاعي
        </button>

        <button
          onClick={() => toggleLayer("showVoronoi3D")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
            layers.showVoronoi3D
              ? "border-violet-500 bg-violet-500/20 text-violet-200"
              : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200"
          }`}
        >
          مساحات السيطرة Voronoi 3D
        </button>

        <button
          onClick={() => toggleLayer("showTrail")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
            layers.showTrail
              ? "border-teal-500 bg-teal-500/20 text-teal-200"
              : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200"
          }`}
        >
          مسار حركة اللاعب المختار
        </button>

        <button
          onClick={() => toggleLayer("showAllLabels")}
          className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
            layers.showAllLabels
              ? "border-sky-500 bg-sky-500/20 text-sky-200"
              : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-200"
          }`}
        >
          أسماء كل اللاعبين
        </button>
      </div>

      {/* Coach Telestrator Drawing Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/70 pt-2">
        <span className="text-xs font-semibold text-slate-400 ml-1">لوحة رسم المدرب (Telestrator):</span>
        <button
          onClick={() => setTelestratorTool(telestratorTool === "arrow" ? "none" : "arrow")}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs border transition ${
            telestratorTool === "arrow"
              ? "border-yellow-400 bg-yellow-500/20 text-yellow-200 font-semibold"
              : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500"
          }`}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          سهم حركة
        </button>
        <button
          onClick={() => setTelestratorTool(telestratorTool === "circle" ? "none" : "circle")}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs border transition ${
            telestratorTool === "circle"
              ? "border-cyan-400 bg-cyan-500/20 text-cyan-200 font-semibold"
              : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500"
          }`}
        >
          <CircleDot className="h-3.5 w-3.5" />
          دائرة تركيز
        </button>
        <button
          onClick={() => setTelestratorTool(telestratorTool === "zone" ? "none" : "zone")}
          className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs border transition ${
            telestratorTool === "zone"
              ? "border-rose-400 bg-rose-500/20 text-rose-200 font-semibold"
              : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500"
          }`}
        >
          <SquareDashed className="h-3.5 w-3.5" />
          منطقة ضغط
        </button>
        {annotationCount > 0 && (
          <button
            onClick={() => {
              annotationsRef.current = [];
              setAnnotationCount(0);
            }}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs text-rose-300 hover:border-rose-500/50"
          >
            <Eraser className="h-3.5 w-3.5" />
            مسح الرسم ({annotationCount})
          </button>
        )}
      </div>

      {exportStatus && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-200">
          {exportStatus}
        </div>
      )}
    </div>
  );
}
