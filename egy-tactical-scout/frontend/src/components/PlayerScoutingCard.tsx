"use client";

import React from "react";

export interface RadarAxis {
  key: string;
  label_ar: string;
  value: number;
  compareValue?: number;
}

interface PlayerScoutingCardProps {
  axes: RadarAxis[];
  primaryName?: string;
  compareName?: string;
  size?: number;
}

export default function PlayerScoutingCard({
  axes,
  primaryName = "اللاعب",
  compareName,
  size = 380,
}: PlayerScoutingCardProps) {
  if (!axes || axes.length === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.31;
  const n = axes.length;

  const angleOf = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;

  const polyPoints = (vals: number[]) =>
    vals
      .map((v, i) => {
        const r = (Math.max(0, Math.min(100, v)) / 100) * maxR;
        const a = angleOf(i);
        return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
      })
      .join(" ");

  const rings = [20, 40, 60, 80, 100];

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible max-w-full">
        {/* Concentric rings */}
        {rings.map((pct) => (
          <circle
            key={pct}
            cx={cx}
            cy={cy}
            r={(pct / 100) * maxR}
            fill="none"
            stroke="rgba(148, 163, 184, 0.16)"
            strokeDasharray={pct === 60 ? "3 3" : undefined}
            strokeWidth={1}
          />
        ))}

        {/* Axis spokes & Arabic labels */}
        {axes.map((ax, i) => {
          const a = angleOf(i);
          const x2 = cx + maxR * Math.cos(a);
          const y2 = cy + maxR * Math.sin(a);
          const lx = cx + (maxR + 18) * Math.cos(a);
          const ly = cy + (maxR + 18) * Math.sin(a);
          const cosA = Math.cos(a);
          const anchor = Math.abs(cosA) < 0.18 ? "middle" : cosA > 0 ? "start" : "end";
          return (
            <g key={ax.key}>
              <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgba(148, 163, 184, 0.18)" strokeWidth={1} />
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize="10"
                fill="#cbd5e1"
                className="select-none"
              >
                {ax.label_ar}
              </text>
            </g>
          );
        })}

        {/* Primary Player Polygon */}
        <polygon
          points={polyPoints(axes.map((a) => a.value))}
          fill="rgba(16, 185, 129, 0.24)"
          stroke="#10b981"
          strokeWidth={2}
        />

        {/* Comparison Alternative Polygon */}
        {axes.some((a) => a.compareValue !== undefined) && (
          <polygon
            points={polyPoints(axes.map((a) => a.compareValue ?? 0))}
            fill="rgba(56, 189, 248, 0.22)"
            stroke="#38bdf8"
            strokeWidth={2}
            strokeDasharray="4 2"
          />
        )}

        {/* Dots */}
        {axes.map((ax, i) => {
          const a = angleOf(i);
          const r = (Math.max(0, Math.min(100, ax.value)) / 100) * maxR;
          return <circle key={`d1-${ax.key}`} cx={cx + r * Math.cos(a)} cy={cy + r * Math.sin(a)} r={3} fill="#10b981" />;
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-emerald-300">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          {primaryName}
        </span>
        {compareName && (
          <span className="flex items-center gap-1.5 text-sky-300">
            <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
            البديل المرشح: {compareName}
          </span>
        )}
      </div>
    </div>
  );
}
