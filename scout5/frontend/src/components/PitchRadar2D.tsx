"use client";

import React from "react";
import { useScoutStore } from "@/store/useScoutStore";

export default function PitchRadar2D({ embedded = false }: { embedded?: boolean }) {
  const frame = useScoutStore((s) => s.currentFrame);
  const teamKits = useScoutStore((s) => s.teamKits);
  const selectedIdentityKey = useScoutStore((s) => s.selectedIdentityKey);
  const setSelectedIdentityKey = useScoutStore((s) => s.setSelectedIdentityKey);
  const openVideoDossier = useScoutStore((s) => s.openVideoDossier);

  const k0 = teamKits["0"]?.ring || "#f43f5e";
  const k1 = teamKits["1"]?.ring || "#38bdf8";
  const calibrated = Boolean(frame && frame.cal_src !== "none");

  const fovPts =
    calibrated && frame?.camera_fov_m && frame.camera_fov_m.length === 4
      ? frame.camera_fov_m.map(([x, y]) => `${x},${y}`).join(" ")
      : null;

  const pitchSvg = (
    <div className="relative overflow-hidden rounded-xl border border-emerald-900/60 bg-[#0b2919]" dir="ltr">
      <svg viewBox="0 0 105 68" className="w-full h-auto block">
        {/* Voronoi polygons */}
        {calibrated &&
          frame?.voronoi_cells?.map((cell, idx) => (
            <polygon
              key={idx}
              points={cell.poly_m.map(([x, y]) => `${x},${y}`).join(" ")}
              fill={cell.team_id === 0 ? k0 : k1}
              fillOpacity={0.14}
              stroke={cell.team_id === 0 ? k0 : k1}
              strokeOpacity={0.32}
              strokeWidth={0.25}
            />
          ))}

        {/* Pitch chalk lines */}
        <rect x={0.4} y={0.4} width={104.2} height={67.2} fill="none" stroke="rgba(226,232,240,0.42)" strokeWidth={0.4} />
        <line x1={52.5} y1={0} x2={52.5} y2={68} stroke="rgba(226,232,240,0.35)" strokeWidth={0.35} />
        <circle cx={52.5} cy={34} r={9.15} fill="none" stroke="rgba(226,232,240,0.35)" strokeWidth={0.35} />
        <rect x={0} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(226,232,240,0.35)" strokeWidth={0.35} />
        <rect x={88.5} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(226,232,240,0.35)" strokeWidth={0.35} />
        <rect x={0} y={24.84} width={5.5} height={18.32} fill="none" stroke="rgba(226,232,240,0.28)" strokeWidth={0.3} />
        <rect x={99.5} y={24.84} width={5.5} height={18.32} fill="none" stroke="rgba(226,232,240,0.28)" strokeWidth={0.3} />

        {/* Live camera FOV cone */}
        {fovPts && (
          <polygon points={fovPts} fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.25)" strokeWidth={0.3} strokeDasharray="1.5 1.2" />
        )}

        {/* Defensive Gaps > 16m */}
        {calibrated &&
          frame?.defensive_gaps?.map((g, i) => (
            <line
              key={`g-${i}`}
              x1={g.from_m[0]}
              y1={g.from_m[1]}
              x2={g.to_m[0]}
              y2={g.to_m[1]}
              stroke="#fb7185"
              strokeWidth={0.85}
              strokeDasharray="1.4 0.9"
            />
          ))}

        {/* Passing lanes */}
        {calibrated &&
          frame?.passing_lanes?.map((ln, idx) =>
            ln.status === "blocked" ? null : (
              <line
                key={idx}
                x1={ln.from_m[0]}
                y1={ln.from_m[1]}
                x2={ln.to_m[0]}
                y2={ln.to_m[1]}
                stroke={ln.status === "line_breaking" ? "#10b981" : "#38bdf8"}
                strokeWidth={ln.status === "line_breaking" ? 0.65 : 0.35}
                strokeDasharray={ln.status === "line_breaking" ? undefined : "1 1"}
                opacity={0.9}
              />
            )
          )}

        {/* Calibrated players */}
        {calibrated &&
          frame?.players.map((p, i) => {
            if (!p.on_pitch || p.x_m === null || p.y_m === null) return null;
            const col = p.role === "referee" ? "#f59e0b" : p.team_id === 0 ? k0 : p.team_id === 1 ? k1 : "#94a3b8";
            const isBallCarrier = frame.ball_carrier_track_id === p.track_id;
            const isSelected = Boolean(selectedIdentityKey && p.identity_key === selectedIdentityKey);
            return (
              <g
                key={`${p.track_id}-${i}`}
                className="cursor-pointer"
                onClick={() => {
                  if (!p.identity_key || p.role === "referee") return;
                  if (isSelected) openVideoDossier(p.identity_key);
                  else setSelectedIdentityKey(p.identity_key);
                }}
              >
                {(isBallCarrier || isSelected) && (
                  <circle cx={p.x_m} cy={p.y_m} r={3.0} fill="none" stroke={isSelected ? "#22d3ee" : "#facc15"} strokeWidth={0.55} />
                )}
                <circle cx={p.x_m} cy={p.y_m} r={1.9} fill={col} stroke="#070b12" strokeWidth={0.35} />
              </g>
            );
          })}

        {/* Calibrated ball */}
        {calibrated && frame?.ball && frame.ball.x_m !== null && frame.ball.y_m !== null && (
          <circle cx={frame.ball.x_m} cy={frame.ball.y_m} r={1.35} fill="#facc15" stroke="#000" strokeWidth={0.3} />
        )}
      </svg>
    </div>
  );

  if (embedded) return pitchSvg;
  return <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-3.5">{pitchSvg}</div>;
}
