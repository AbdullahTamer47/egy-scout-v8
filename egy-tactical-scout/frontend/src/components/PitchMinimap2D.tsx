"use client";

import React, { useState } from "react";
import { resolveNearestFrame, useTacticalStore } from "@/store/useTacticalStore";

const PITCH_W = 105;
const PITCH_H = 68;

type RadarViewMode = "live" | "network" | "zones";

function contrastTextOnHex(hex: string): string {
  const s = (hex || "").trim().replace("#", "");
  if (s.length !== 6) return "#070b12";
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 155 ? "#070b12" : "#f8fafc";
}

export default function PitchMinimap2D() {
  const frameMap = useTacticalStore((s) => s.frameMap);
  const teamKits = useTacticalStore((s) => s.teamKits);
  const currentFrameId = useTacticalStore((s) => s.currentFrameId);
  const currentMatch = useTacticalStore((s) => s.currentMatch);
  const selectedIdentity = useTacticalStore((s) => s.selectedIdentity);
  const layers = useTacticalStore((s) => s.layers);
  const setSelectedIdentity = useTacticalStore((s) => s.setSelectedIdentity);

  const [viewMode, setViewMode] = useState<RadarViewMode>("live");
  const [netTeam, setNetTeam] = useState<"0" | "1">("0");

  const frame = resolveNearestFrame(frameMap, currentFrameId);

  const p0State = frame?.game_phase?.["0"];
  const p1State = frame?.game_phase?.["1"];
  const possTeam = frame?.poss_team;

  const kit0 = currentMatch?.summary?.team_kits?.["0"] || teamKits?.["0"] || { family: "red", label_ar: "أحمر", ring: "#ef4444", primary: "#dc2626", hex: "#ef4444" };
  const kit1 = currentMatch?.summary?.team_kits?.["1"] || teamKits?.["1"] || { family: "blue", label_ar: "أزرق", ring: "#38bdf8", primary: "#0284c7", hex: "#38bdf8" };
  const kit0Color = kit0.ring || "#ef4444";
  const kit1Color = kit1.ring || "#38bdf8";

  const homeCluster = currentMatch?.home_team_cluster === 1 ? "1" : "0";
  const team0Summary = currentMatch?.summary?.teams?.["0"];
  const team1Summary = currentMatch?.summary?.teams?.["1"];
  const homeLabel =
    homeCluster === "0"
      ? `${currentMatch?.home_team_name || "فريق 1"} (${kit0.label_ar})`
      : `${currentMatch?.away_team_name || "فريق 1"} (${kit0.label_ar})`;
  const awayLabel =
    homeCluster === "1"
      ? `${currentMatch?.home_team_name || "فريق 2"} (${kit1.label_ar})`
      : `${currentMatch?.away_team_name || "فريق 2"} (${kit1.label_ar})`;

  const passingNet = currentMatch?.summary?.passing_network?.[netTeam];
  const zones18 = currentMatch?.summary?.zone_control_18 || [];

  const mappedPlayers = frame?.players?.filter((p) => p.role !== "referee") || [];

  const netNodeMap = new Map((passingNet?.nodes || []).map((n) => [n.identity_key, n]));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-[#0d1420] p-3.5 shadow-xl">
      {/* Header + Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div>
          <h3 className="text-sm font-bold text-slate-100">الرادار التكتيكي الاحترافي (105×68م)</h3>
          <p className="text-[11px] text-emerald-400">
            رصد {mappedPlayers.length} لاعب • معايرة تلقائية 100%
          </p>
        </div>

        <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
          <button
            onClick={() => setViewMode("live")}
            className={`rounded-md px-2 py-1 transition ${viewMode === "live" ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-400 hover:text-white"}`}
          >
            الرادار الحي
          </button>
          <button
            onClick={() => setViewMode("network")}
            className={`rounded-md px-2 py-1 transition ${viewMode === "network" ? "bg-cyan-500 text-slate-950 font-bold" : "text-slate-400 hover:text-white"}`}
          >
            شبكة التمرير
          </button>
          <button
            onClick={() => setViewMode("zones")}
            className={`rounded-md px-2 py-1 transition ${viewMode === "zones" ? "bg-amber-500 text-slate-950 font-bold" : "text-slate-400 hover:text-white"}`}
          >
            18 منطقة (Z14)
          </button>
        </div>
      </div>

      {/* Live 4-Phase Game State Strip OR Passing Network Team Toggle */}
      {viewMode === "network" ? (
        <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
          <span className="text-slate-300 font-semibold">شبكة تمريرات ومواضع الاستلام:</span>
          <div className="flex gap-1.5">
            <button
              onClick={() => setNetTeam("0")}
              className="rounded-md px-2.5 py-1 text-[11px] font-bold border transition"
              style={
                netTeam === "0"
                  ? { backgroundColor: kit0Color, borderColor: kit0Color, color: contrastTextOnHex(kit0Color) }
                  : { borderColor: kit0Color, color: "#e2e8f0" }
              }
            >
              {homeLabel}
            </button>
            <button
              onClick={() => setNetTeam("1")}
              className="rounded-md px-2.5 py-1 text-[11px] font-bold border transition"
              style={
                netTeam === "1"
                  ? { backgroundColor: kit1Color, borderColor: kit1Color, color: contrastTextOnHex(kit1Color) }
                  : { borderColor: kit1Color, color: "#e2e8f0" }
              }
            >
              {awayLabel}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div
            className="rounded-xl border p-2 transition"
            style={
              possTeam === 0
                ? { borderColor: kit0Color, backgroundColor: `${kit0Color}1f` }
                : { borderColor: "rgb(30, 41, 59)", backgroundColor: "rgba(2, 6, 23, 0.6)" }
            }
          >
            <div className="flex items-center justify-between gap-1">
              <span className="flex items-center gap-1.5 font-bold text-slate-100 truncate">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/40" style={{ backgroundColor: kit0Color }} />
                <span className="truncate">{homeLabel}</span>
              </span>
              <span className="tabular-nums font-mono text-[11px] text-slate-300 shrink-0">
                {frame?.formations?.["0"]?.formation_str || team0Summary?.formation || "---"}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-300 truncate">
              {p0State?.phase_ar || "تحليل المرحلة..."}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              دفاع: {team0Summary?.out_of_possession_formation || "-"} ⇄ هجوم: {team0Summary?.in_possession_formation || "-"}
            </div>
          </div>

          <div
            className="rounded-xl border p-2 transition"
            style={
              possTeam === 1
                ? { borderColor: kit1Color, backgroundColor: `${kit1Color}1f` }
                : { borderColor: "rgb(30, 41, 59)", backgroundColor: "rgba(2, 6, 23, 0.6)" }
            }
          >
            <div className="flex items-center justify-between gap-1">
              <span className="flex items-center gap-1.5 font-bold text-slate-100 truncate">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-white/40" style={{ backgroundColor: kit1Color }} />
                <span className="truncate">{awayLabel}</span>
              </span>
              <span className="tabular-nums font-mono text-[11px] text-slate-300 shrink-0">
                {frame?.formations?.["1"]?.formation_str || team1Summary?.formation || "---"}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-300 truncate">
              {p1State?.phase_ar || "تحليل المرحلة..."}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">
              دفاع: {team1Summary?.out_of_possession_formation || "-"} ⇄ هجوم: {team1Summary?.in_possession_formation || "-"}
            </div>
          </div>
        </div>
      )}

      {/* 2D Vector Pitch SVG */}
      <div className="overflow-hidden rounded-xl border border-emerald-900/50 bg-[#0b2919]" dir="ltr">
        <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} className="w-full h-auto block">
          {/* Grass Stripes */}
          {Array.from({ length: 10 }).map((_, idx) => (
            <rect
              key={idx}
              x={idx * 10.5}
              y={0}
              width={10.5}
              height={PITCH_H}
              fill={idx % 2 === 0 ? "#0d3320" : "#0b2c1b"}
            />
          ))}

          {/* 18-Zone Territorial Heatmap Overlay */}
          {viewMode === "zones" &&
            zones18.map((z, idx) => {
              const p0Dom = z.team_0_pct >= z.team_1_pct;
              const diff = Math.abs(z.team_0_pct - 50) / 50;
              const fill = p0Dom
                ? `rgba(245, 158, 11, ${(0.12 + diff * 0.42).toFixed(2)})`
                : `rgba(56, 189, 248, ${(0.12 + diff * 0.42).toFixed(2)})`;
              return (
                <g key={idx}>
                  <rect
                    x={z.x0_m}
                    y={z.y0_m}
                    width={z.x1_m - z.x0_m}
                    height={z.y1_m - z.y0_m}
                    fill={fill}
                    stroke={z.is_zone_14 ? "#10b981" : "rgba(255,255,255,0.16)"}
                    strokeWidth={z.is_zone_14 ? 0.8 : 0.25}
                  />
                  <text
                    x={(z.x0_m + z.x1_m) / 2}
                    y={(z.y0_m + z.y1_m) / 2 - 0.5}
                    textAnchor="middle"
                    fontSize={z.is_zone_14 ? "2.6" : "2.1"}
                    fontWeight="bold"
                    fill="#f8fafc"
                  >
                    {p0Dom ? `${Math.round(z.team_0_pct)}%` : `${Math.round(z.team_1_pct)}%`}
                  </text>
                  {z.is_zone_14 && (
                    <text
                      x={(z.x0_m + z.x1_m) / 2}
                      y={(z.y0_m + z.y1_m) / 2 + 2.8}
                      textAnchor="middle"
                      fontSize="1.7"
                      fontWeight="bold"
                      fill="#6ee7b7"
                    >
                      Z14
                    </text>
                  )}
                </g>
              );
            })}

          {/* Voronoi Polygons 2D in live view */}
          {viewMode === "live" &&
            layers.showVoronoi3D &&
            frame?.voronoi_polys?.map((vp, idx) => (
              <polygon
                key={idx}
                points={vp.points_m.map(([x, y]) => `${x},${y}`).join(" ")}
                fill={vp.team_cluster === 0 ? kit0Color : kit1Color}
                fillOpacity={0.18}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={0.25}
              />
            ))}

          {/* Live Camera Broadcast FOV Cone */}
          {viewMode === "live" && frame?.is_tactical_wide !== false && frame?.camera_fov_m && frame.camera_fov_m.length >= 3 && (
            <polygon
              points={frame.camera_fov_m.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="rgba(248, 250, 252, 0.06)"
              stroke="rgba(148, 163, 184, 0.45)"
              strokeWidth={0.35}
              strokeDasharray="1.8 1.2"
            />
          )}

          {/* FIFA Pitch Markings */}
          <g stroke="rgba(226, 232, 240, 0.42)" strokeWidth={0.45} fill="none">
            <rect x={0.4} y={0.4} width={PITCH_W - 0.8} height={PITCH_H - 0.8} />
            <line x1={PITCH_W / 2} y1={0} x2={PITCH_W / 2} y2={PITCH_H} />
            <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={9.15} />
            <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={0.6} fill="rgba(226,232,240,0.6)" />
            <rect x={0} y={(PITCH_H - 40.32) / 2} width={16.5} height={40.32} />
            <rect x={PITCH_W - 16.5} y={(PITCH_H - 40.32) / 2} width={16.5} height={40.32} />
            <rect x={0} y={(PITCH_H - 18.32) / 2} width={5.5} height={18.32} />
            <rect x={PITCH_W - 5.5} y={(PITCH_H - 18.32) / 2} width={5.5} height={18.32} />
          </g>

          {/* Passing Network View */}
          {viewMode === "network" && passingNet && (
            <g>
              {passingNet.links.map((lk, idx) => {
                const src = netNodeMap.get(lk.source);
                const dst = netNodeMap.get(lk.target);
                if (!src || !dst) return null;
                const wStroke = Math.min(2.2, 0.35 + lk.count * 0.25);
                return (
                  <line
                    key={idx}
                    x1={src.avg_x_m}
                    y1={src.avg_y_m}
                    x2={dst.avg_x_m}
                    y2={dst.avg_y_m}
                    stroke={lk.progressive_count > 0 ? "#10b981" : "#94a3b8"}
                    strokeOpacity={0.72}
                    strokeWidth={wStroke}
                  />
                );
              })}
              {passingNet.nodes.map((nd) => {
                const isSel = selectedIdentity === nd.identity_key;
                const rad = Math.min(3.5, 1.6 + nd.passes * 0.12);
                const fill = netTeam === "0" ? kit0Color : kit1Color;
                const txtFill = contrastTextOnHex(fill);
                return (
                  <g
                    key={nd.identity_key}
                    className="cursor-pointer"
                    onClick={() => setSelectedIdentity(isSel ? null : nd.identity_key)}
                  >
                    <circle
                      cx={nd.avg_x_m}
                      cy={nd.avg_y_m}
                      r={rad}
                      fill={fill}
                      stroke={isSel ? "#10b981" : "#070b12"}
                      strokeWidth={isSel ? 0.8 : 0.45}
                    />
                    <text
                      x={nd.avg_x_m}
                      y={nd.avg_y_m + 0.7}
                      textAnchor="middle"
                      fontSize="1.9"
                      fontWeight="bold"
                      fill={txtFill}
                    >
                      {nd.jersey_number ?? ""}
                    </text>
                    <text
                      x={nd.avg_x_m}
                      y={nd.avg_y_m + rad + 2.3}
                      textAnchor="middle"
                      fontSize="1.75"
                      fontWeight="600"
                      fill="#f8fafc"
                    >
                      {nd.player_name.split(" ").slice(-1)[0]}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* LIVE VIEW Layers */}
          {viewMode === "live" && (
            <>
              {/* Cover Shadows */}
              {layers.showPassingLanes &&
                frame?.cover_shadows?.map((sh, i) => (
                  <polygon
                    key={i}
                    points={sh.polygon_m.map(([x, y]) => `${x},${y}`).join(" ")}
                    fill="rgba(15, 23, 42, 0.45)"
                    stroke="rgba(239, 68, 68, 0.35)"
                    strokeWidth={0.3}
                  />
                ))}

              {/* Unit Line Chains & >16m Crimson Gaps */}
              {layers.showTacticalMesh &&
                (["0", "1"] as const).map((tc) =>
                  frame?.formations?.[tc]?.lines?.map((chain, ci) =>
                    chain.map((pt, pi) => {
                      if (pi >= chain.length - 1) return null;
                      const nxt = chain[pi + 1];
                      const gap = Math.hypot(nxt[0] - pt[0], nxt[1] - pt[1]);
                      const isGap = gap > 16.0;
                      return (
                        <line
                          key={`${tc}-${ci}-${pi}`}
                          x1={pt[0]}
                          y1={pt[1]}
                          x2={nxt[0]}
                          y2={nxt[1]}
                          stroke={isGap ? "#ef4444" : tc === "0" ? kit0Color : kit1Color}
                          strokeOpacity={isGap ? 0.95 : 0.72}
                          strokeWidth={isGap ? 0.9 : 0.48}
                          strokeDasharray={isGap ? "1.6 1.0" : undefined}
                        />
                      );
                    })
                  )
                )}

              {/* Passing Lanes */}
              {layers.showPassingLanes &&
                frame?.passing_lanes?.slice(0, 3).map((lane, idx) => (
                  <line
                    key={idx}
                    x1={lane.from_m[0]}
                    y1={lane.from_m[1]}
                    x2={lane.to_m[0]}
                    y2={lane.to_m[1]}
                    stroke={
                      lane.status === "line_breaking"
                        ? "#10b981"
                        : lane.status === "safe_open"
                        ? "#38bdf8"
                        : "#ef4444"
                    }
                    strokeWidth={lane.status === "line_breaking" ? 0.95 : 0.6}
                    strokeDasharray={lane.status === "blocked" ? "1.5 1.5" : undefined}
                  />
                ))}

              {/* Tracked Players + Live Velocity Vector Ticks */}
              {mappedPlayers.map((p) => {
                const isSel = selectedIdentity === p.identity_key;
                const isCar = frame && frame.ball_carrier_track_id > 0 && p.track_id === frame.ball_carrier_track_id;
                const fill = p.team_cluster === 0 ? kit0Color : p.team_cluster === 1 ? kit1Color : "#94a3b8";
                const txtFill = contrastTextOnHex(fill);
                const vmag = Math.hypot(p.vx || 0, p.vy || 0);
                const showVec = p.speed_kmh >= 9 && vmag > 0.25;
                const tickLen = Math.min(4.8, 1.8 + p.speed_kmh * 0.11);
                return (
                  <g
                    key={p.identity_key}
                    className="cursor-pointer"
                    onClick={() => setSelectedIdentity(isSel ? null : p.identity_key)}
                  >
                    {showVec && (
                      <line
                        x1={p.x_m}
                        y1={p.y_m}
                        x2={p.x_m + (p.vx / vmag) * tickLen}
                        y2={p.y_m + (p.vy / vmag) * tickLen}
                        stroke={fill}
                        strokeWidth={0.55}
                        strokeLinecap="round"
                      />
                    )}
                    {(isSel || isCar) && (
                      <circle
                        cx={p.x_m}
                        cy={p.y_m}
                        r={3.1}
                        fill="none"
                        stroke={isSel ? "#10b981" : "#fde047"}
                        strokeWidth={0.7}
                      />
                    )}
                    <circle cx={p.x_m} cy={p.y_m} r={1.85} fill={fill} stroke="#070b12" strokeWidth={0.4} />
                    {p.jersey_number && (
                      <text
                        x={p.x_m}
                        y={p.y_m + 0.65}
                        textAnchor="middle"
                        fontSize="1.9"
                        fontWeight="bold"
                        fill={txtFill}
                      >
                        {p.jersey_number}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Ball */}
              {frame?.ball && (
                <circle cx={frame.ball.x_m} cy={frame.ball.y_m} r={1.25} fill="#fde047" stroke="#070b12" strokeWidth={0.35} />
              )}
            </>
          )}
        </svg>
      </div>

      {/* Footer Diagnostic Strip */}
      <div className="space-y-1.5 rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5 text-xs">
        {viewMode === "zones" ? (
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span>السيطرة على Zone 14 (عمق صناعة الخطورة):</span>
            <span className="font-mono text-emerald-300">
              {(() => {
                const z14 = zones18.find((z) => z.col === 3 && z.row === 1);
                return z14 ? `${homeLabel} ${Math.round(z14.team_0_pct)}% • ${awayLabel} ${Math.round(z14.team_1_pct)}%` : "---";
              })()}
            </span>
          </div>
        ) : viewMode === "network" ? (
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span>روابط التمرير المسجلة ({passingNet?.links?.length ?? 0} مسار):</span>
            <span className="text-emerald-300">الخط الأخضر = تمريرات تقدمية • اضغط على أي لاعب للتركيز</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-slate-300">
              <span>انضباط خط الدفاع (std):</span>
              <span className="tabular-nums font-mono">
                <strong className={(frame?.formations?.["0"]?.def_line_sync_std ?? 0) > 4.2 ? "text-rose-400" : "text-emerald-400"}>
                  ف1: {frame?.formations?.["0"]?.def_line_sync_std ?? 0}م
                </strong>
                {" • "}
                <strong className={(frame?.formations?.["1"]?.def_line_sync_std ?? 0) > 4.2 ? "text-rose-400" : "text-sky-400"}>
                  ف2: {frame?.formations?.["1"]?.def_line_sync_std ?? 0}م
                </strong>
              </span>
            </div>

            {(frame?.gaps_gt_16m?.length || 0) > 0 && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-2.5 py-1 text-[11px] text-rose-200">
                تنبيه فوري: {frame?.gaps_gt_16m.length} ثغرة دفاعية تتجاوز 16م في التمركز الحالي!
              </div>
            )}

            {frame?.passing_lanes?.[0] && (
              <div className="flex items-center justify-between text-[11px] text-emerald-300">
                <span>أفضل خيار تمرير:</span>
                <span className="font-mono">
                  xPass {frame.passing_lanes[0].xpass_pct}% ({frame.passing_lanes[0].opponents_bypassed} خصوم)
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
