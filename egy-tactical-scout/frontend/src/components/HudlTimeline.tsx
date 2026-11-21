"use client";

import React from "react";
import { Flag, ShieldAlert, TrendingUp, Zap } from "lucide-react";
import { useTacticalStore } from "@/store/useTacticalStore";

const ROWS = [
  {
    key: "line_breaking" as const,
    title: "تمريرات كاسرة للخطوط",
    color: "bg-emerald-500 border-emerald-400 text-emerald-300",
    pill: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
    icon: TrendingUp,
  },
  {
    key: "positive_transition" as const,
    title: "تحولات هجومية سريعة",
    color: "bg-cyan-500 border-cyan-400 text-cyan-300",
    pill: "bg-cyan-500/20 text-cyan-200 border-cyan-500/40",
    icon: Zap,
  },
  {
    key: "defensive_gap" as const,
    title: "ثغرات دفاعية (>16م)",
    color: "bg-rose-500 border-rose-400 text-rose-300",
    pill: "bg-rose-500/20 text-rose-200 border-rose-500/40",
    icon: ShieldAlert,
  },
  {
    key: "high_recovery" as const,
    title: "ضغط عالي ناجح",
    color: "bg-amber-500 border-amber-400 text-amber-300",
    pill: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    icon: Flag,
  },
];

export default function HudlTimeline() {
  const currentMatch = useTacticalStore((s) => s.currentMatch);
  const currentTimeS = useTacticalStore((s) => s.currentTimeS);
  const requestSeek = useTacticalStore((s) => s.requestSeek);

  if (!currentMatch) return null;
  const tags = currentMatch.summary?.timeline_tags || [];
  const maxDur = Math.max(10, currentMatch.duration_s || 60);

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-200">
          شريط الأحداث التفاعلي (Hudl Timeline) — اضغط على أي علامة للانتقال المباشر في الفيديو
        </h3>
        <span className="text-[11px] font-mono text-slate-400">{tags.length} لقطة مسجلة تلقائياً</span>
      </div>

      <div className="space-y-1.5">
        {ROWS.map((row) => {
          const rowTags = tags.filter((t) => t.category === row.key);
          const Icon = row.icon;
          return (
            <div key={row.key} className="grid grid-cols-12 items-center gap-2 rounded-lg bg-slate-950/70 px-2.5 py-1.5">
              <div className="col-span-4 sm:col-span-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-200">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{row.title}</span>
                <span className="mr-auto rounded bg-slate-800 px-1.5 py-0.2 text-[10px] font-mono text-slate-300">
                  {rowTags.length}
                </span>
              </div>

              <div className="col-span-8 sm:col-span-9 relative h-6 rounded bg-slate-900/90 border border-slate-800/80 overflow-hidden" dir="ltr">
                {/* Playhead */}
                <div
                  className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white/80 z-10"
                  style={{ left: `${Math.min(100, (currentTimeS / maxDur) * 100)}%` }}
                />

                {rowTags.map((t, idx) => {
                  const leftPct = Math.min(98, Math.max(1, (t.time_s / maxDur) * 100));
                  return (
                    <button
                      key={idx}
                      onClick={() => requestSeek(t.time_s)}
                      title={`${t.label_ar} • ${t.time_s}s (${t.detail})`}
                      style={{ left: `${leftPct}%` }}
                      className={`absolute top-1 bottom-1 w-2.5 -translate-x-1/2 rounded-sm ${row.color.split(" ")[0]} opacity-85 hover:opacity-100 hover:scale-125 transition cursor-pointer`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick clickable chips for the earliest notable events */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {tags.slice(0, 12).map((t, idx) => {
            const meta = ROWS.find((r) => r.key === t.category);
            return (
              <button
                key={idx}
                onClick={() => requestSeek(t.time_s)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition hover:brightness-125 ${meta?.pill || "border-slate-700 text-slate-300"}`}
              >
                {t.label_ar} ({t.time_s.toFixed(1)}ث)
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

