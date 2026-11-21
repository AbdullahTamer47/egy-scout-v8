"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Activity, Flame, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import PlayerScoutingCard, { type RadarAxis } from "@/components/PlayerScoutingCard";

interface StatProfileResponse {
  stat_id: number;
  match_id: number;
  match_title: string;
  identity_key: string;
  team_cluster: number;
  jersey_number?: number | null;
  role: string;
  player?: {
    id: number;
    name: string;
    club?: string | null;
    position?: string | null;
    age?: number | null;
    preferred_foot?: string | null;
    market_value_egp?: number | null;
  } | null;
  position_family: string;
  radar_axes: RadarAxis[];
  stats: {
    minutes_tracked: number;
    total_distance_m: number;
    distance_per_min_m: number;
    max_speed_kmh: number;
    avg_speed_kmh: number;
    hir_distance_m: number;
    sprint_distance_m: number;
    sprint_count: number;
    passes: number;
    passes_completed: number;
    progressive_passes: number;
    line_breaking_passes: number;
    progressive_carries: number;
    xt_generated: number;
    pressing_actions: number;
    recoveries: number;
    avg_space_m2?: number | null;
    avg_attacking_space_m2?: number | null;
    space_created_m2?: number | null;
    offball_runs: number;
    tactical_deviation_m?: number | null;
    fluidity_score?: number | null;
    discipline_score?: number | null;
    roaming_radius_m?: number | null;
    avg_time_on_ball_sec?: number | null;
    tactical_role_ar?: string | null;
    heatmap?: number[][] | null;
    scout_score?: number | null;
    score_breakdown?: Record<string, number> | null;
    verdict?: string | null;
  };
}

function PlayerDossierContent() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<StatProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    apiFetch<StatProfileResponse>(`/api/scouting/stat/${params.id}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "تعذر تحميل ملف اللاعب"));
  }, [params?.id]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#070b12] p-8 text-center text-rose-300 space-y-4">
        <p>{error}</p>
        <Link href="/" className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs text-white">
          <ArrowRight className="h-4 w-4" />
          العودة للاستوديو
        </Link>
      </div>
    );
  }

  if (!data) {
    return <div className="min-h-screen bg-[#070b12] p-8 text-center text-slate-400">جاري تحميل ملف الكشاف...</div>;
  }

  const s = data.stats;
  const titleName = data.player?.name || (data.jersey_number ? `لاعب #${data.jersey_number}` : `مسار ${data.identity_key}`);
  const heat = s.heatmap || [];

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-[#0d1420] p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white">{titleName}</h1>
              <span className="rounded-lg bg-emerald-500/20 px-2.5 py-0.5 font-mono text-sm font-black text-emerald-300">
                التقييم: {s.scout_score ?? "-"}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {data.match_title} • الفريق {data.team_cluster + 1} • {s.tactical_role_ar || "لاعب ميداني"}
            </p>
            {s.verdict && <p className="text-xs font-semibold text-cyan-300">{s.verdict}</p>}
          </div>

          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 hover:border-emerald-500"
          >
            <ArrowRight className="h-4 w-4" />
            العودة إلى استوديو التحليل
          </Link>
        </div>

        {/* KPI Cards Grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Gauge className="h-4 w-4 text-emerald-400" />
              السرعة القصوى
            </div>
            <div className="mt-1 text-2xl font-black text-white font-mono">{s.max_speed_kmh} كم/س</div>
            <div className="text-[11px] text-slate-400">المسافة: {s.total_distance_m}م</div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              الخطورة المتوقعة (xT)
            </div>
            <div className="mt-1 text-2xl font-black text-cyan-300 font-mono">{s.xt_generated.toFixed(3)}</div>
            <div className="text-[11px] text-slate-400">كسر الخطوط: {s.line_breaking_passes} تمريرات</div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              الالتزام مقابل المرونة
            </div>
            <div className="mt-1 text-2xl font-black text-emerald-300 font-mono">
              {Math.round(s.discipline_score ?? 70)}% / {Math.round(s.fluidity_score ?? 60)}%
            </div>
            <div className="text-[11px] text-slate-400">نصف قطر الحركة: {s.roaming_radius_m ?? 0}م</div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-4">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Flame className="h-4 w-4 text-amber-400" />
              زمن تحرير الكرة والضغط
            </div>
            <div className="mt-1 text-2xl font-black text-amber-300 font-mono">{s.avg_time_on_ball_sec ?? 1.4}ث</div>
            <div className="text-[11px] text-slate-400">ضغط/استخلاص: {s.pressing_actions + s.recoveries}</div>
          </div>
        </div>

        {/* 14-Metric Position Radar + 12x8 Tactical Heatmap */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-[#0d1420] p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-100">
              <Activity className="h-4 w-4 text-emerald-400" />
              الرادار الـ 14 معيار المخصص لمركزه ({data.position_family})
            </div>
            <PlayerScoutingCard axes={data.radar_axes} primaryName={titleName} size={390} />
          </div>

          <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-[#0d1420] p-5 space-y-4">
            <div className="text-sm font-bold text-slate-100">الخريطة الحرارية للانتشار (12×8 نطاقات الملعب)</div>
            {heat.length === 12 ? (
              <div className="overflow-hidden rounded-xl border border-emerald-900/50 bg-[#0b2919] p-2" dir="ltr">
                <div className="grid grid-cols-12 gap-1 aspect-[105/68]">
                  {Array.from({ length: 8 }).map((_, yIdx) =>
                    Array.from({ length: 12 }).map((__, xIdx) => {
                      const val = heat[xIdx]?.[yIdx] || 0;
                      const alpha = Math.min(0.92, val * 8.5);
                      return (
                        <div
                          key={`${xIdx}-${yIdx}`}
                          className="rounded-sm border border-emerald-950/30"
                          style={{
                            backgroundColor: val > 0 ? `rgba(16, 185, 129, ${Math.max(0.12, alpha)})` : "rgba(7, 25, 15, 0.45)",
                          }}
                          title={`نطاق (${xIdx + 1}, ${yIdx + 1}): ${(val * 100).toFixed(1)}%`}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400">لا توجد بيانات خريطة حرارية كافية.</div>
            )}

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex justify-between">
                <span className="text-slate-400">التمريرات (الناجحة):</span>
                <span className="font-mono font-bold text-slate-100">
                  {s.passes_completed} / {s.passes}
                </span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex justify-between">
                <span className="text-slate-400">التقدم بالكرة:</span>
                <span className="font-mono font-bold text-slate-100">{s.progressive_carries}</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex justify-between">
                <span className="text-slate-400">مساحة السيطرة Voronoi:</span>
                <span className="font-mono font-bold text-emerald-300">{s.avg_space_m2 ?? 0} م²</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex justify-between">
                <span className="text-slate-400">تحركات بدون كرة:</span>
                <span className="font-mono font-bold text-cyan-300">{s.offball_runs}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlayerDossierPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#070b12] p-8 text-center text-slate-400">
          جاري تحميل ملف الكشاف...
        </div>
      }
    >
      <PlayerDossierContent />
    </Suspense>
  );
}
