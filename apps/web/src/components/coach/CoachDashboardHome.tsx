"use client";

import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";
import {
  Activity,
  Bot,
  ClipboardList,
  Compass,
  Flame,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { CoachClubDetail, CoachOverviewPayload, CoachPlayer, CoachProfile } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  profile: CoachProfile;
  overview: CoachOverviewPayload;
  onNavigate: (tab: "tactics" | "training" | "director" | "admin" | "live") => void;
  onSelectPlayer: (player: CoachPlayer, club: CoachClubDetail) => void;
  onRunAiPrompt: (q: string) => void;
}

const DEFAULT_WEEK_LOAD = [
  { md: "MD-5", au: 135, rpe: 3.0 },
  { md: "MD-4", au: 525, rpe: 7.0 },
  { md: "MD-3", au: 680, rpe: 8.0 },
  { md: "MD-2", au: 390, rpe: 6.0 },
  { md: "MD-1", au: 180, rpe: 4.0 },
  { md: "MD", au: 902, rpe: 9.5 },
  { md: "MD+1", au: 100, rpe: 2.5 },
];

export default function CoachDashboardHome({
  lang,
  profile,
  overview,
  onNavigate,
  onSelectPlayer,
  onRunAiPrompt,
}: Props) {
  const isAr = lang === "ar";
  const chartRef = useRef<HTMLDivElement | null>(null);

  const standings = overview.live_hub?.standings || [];
  const clubSt = standings.find(
    (s) => s.team_id === overview.club.club_id || s.team_name.toLowerCase().includes(overview.club.name_en.toLowerCase())
  );
  const oppSt = standings.find(
    (s) => s.team_id === overview.opponent.club_id || s.team_name.toLowerCase().includes(overview.opponent.name_en.toLowerCase())
  );

  const warnedCount = overview.club.players.filter((p) => p.yellow_cards === 2).length;
  const ages = overview.club.players.map((p) => p.age).filter((a): a is number => typeof a === "number" && a > 14);
  const avgAge = ages.length > 0 ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : "-";

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    const mergedData = DEFAULT_WEEK_LOAD.map((base) => {
      const saved = overview.training_sessions.find((s) => s.md_code === base.md);
      return {
        md: base.md,
        au: saved ? saved.srpe_au : base.au,
        rpe: saved ? saved.target_rpe : base.rpe,
      };
    });
    chart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      grid: { left: 38, right: 16, top: 24, bottom: 26 },
      xAxis: {
        type: "category",
        data: mergedData.map((d) => d.md),
        axisLabel: { color: "#94A3B8", fontSize: 10 },
        axisLine: { lineStyle: { color: "#1E293B" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#94A3B8", fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      series: [
        {
          name: "sRPE (AU)",
          type: "bar",
          barWidth: "46%",
          data: mergedData.map((d) => ({
            value: d.au,
            itemStyle: {
              borderRadius: [6, 6, 0, 0],
              color: d.rpe >= 8 ? "#EF4444" : d.rpe >= 6 ? "#F59E0B" : "#10B981",
            },
          })),
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [overview.training_sessions]);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      {/* Row 1: Executive Matchup Hero + Quick Jump Buttons */}
      <div className="studio-panel p-4 bg-gradient-to-l from-emerald-950/35 via-[#0C1220] to-[#090D16] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl border border-white/25 flex items-center justify-center font-extrabold text-sm text-white shrink-0"
              style={{ backgroundColor: `${overview.club.kit_hex || "#10B981"}44` }}
            >
              {clubSt ? `#${clubSt.rank}` : "XI"}
            </div>
            <div>
              <div className="text-[11px] font-bold text-emerald-300">
                {isAr ? `غرفة قيادة كابتن ${profile.coach_name}` : `Coach ${profile.coach_name} HQ`}
              </div>
              <div className="text-base font-extrabold text-white">
                {overview.club.name_ar} <span className="text-slate-400 mx-1">×</span> {overview.opponent.name_ar}
              </div>
              <div className="text-[11px] text-slate-300">
                {clubSt ? `${clubSt.points} نقطة (${clubSt.wins}ف ${clubSt.draws}ت ${clubSt.losses}خ)` : `${overview.club.players.length} لاعباً`}
                {" • "}
                {overview.club.stadium_ar || "الدوري المصري الممتاز"}
                {oppSt ? ` | الخصم: #${oppSt.rank} (${oppSt.points} ن)` : ""}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate("tactics")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold transition"
          >
            <Compass className="w-4 h-4" />
            <span>{isAr ? "السبورة التكتيكية (3 حالات)" : "3-Phase Tactics"}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("training")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#111827] hover:bg-slate-800 border border-white/15 text-xs font-bold text-white"
          >
            <Flame className="w-4 h-4 text-amber-400" />
            <span>{isAr ? "التدريب اليومي" : "Training"}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("admin")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#111827] hover:bg-slate-800 border border-white/15 text-xs font-bold text-white"
          >
            <ClipboardList className="w-4 h-4 text-sky-400" />
            <span>{isAr ? "كشف المباراة" : "Matchday Sheet"}</span>
          </button>
        </div>
      </div>

      {/* Row 2: 6 Live KPI Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
        <div className="studio-panel p-3">
          <div className="text-[10px] text-slate-400">{isAr ? "اللاعبون الجاهزون" : "Fit Players"}</div>
          <div className="text-lg font-extrabold text-emerald-400 mt-0.5">{overview.squad_depth.fit_count}</div>
          <div className="text-[10px] text-slate-400">{isAr ? `من إجمالي ${overview.club.players.length}` : `of ${overview.club.players.length}`}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] text-slate-400">{isAr ? "إصابات / إيقافات" : "Excluded"}</div>
          <div className={`text-lg font-extrabold mt-0.5 ${overview.squad_depth.unavailable_count > 0 ? "text-rose-400" : "text-slate-200"}`}>
            {overview.squad_depth.unavailable_count}
          </div>
          <div className="text-[10px] text-slate-400">{isAr ? "تحديث إداري فوري" : "Live admin gate"}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] text-slate-400">{isAr ? "مهدد بالإيقاف (2🟨)" : "2-Card Risk"}</div>
          <div className={`text-lg font-extrabold mt-0.5 ${warnedCount > 0 ? "text-amber-300" : "text-slate-200"}`}>{warnedCount}</div>
          <div className="text-[10px] text-slate-400">{isAr ? "حد الإيقاف 3 إنذارات" : "Suspension at 3"}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] text-slate-400">{isAr ? "حصة الأجانب (EFA)" : "Foreign Quota"}</div>
          <div
            className={`text-lg font-extrabold mt-0.5 ${
              overview.foreign_quota?.status === "over_limit"
                ? "text-rose-400"
                : overview.foreign_quota?.status === "warning"
                  ? "text-amber-300"
                  : "text-emerald-300"
            }`}
          >
            {overview.foreign_quota?.foreign_count ?? 0} / {overview.foreign_quota?.limit ?? 5}
          </div>
          <div className="text-[10px] text-slate-400">{isAr ? "الحد الأقصى 5 أجانب" : "Max 5 registered"}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] text-slate-400">{isAr ? "الحمل الأسبوعي" : "Weekly Load"}</div>
          <div className="text-lg font-extrabold text-sky-300 mt-0.5">{overview.weekly_load_safety.total_weekly_au} AU</div>
          <div className="text-[10px] text-slate-400">{overview.training_sessions.length} {isAr ? "حصص مسجلة" : "saved sessions"}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] text-slate-400">{isAr ? "متوسط الأعمار" : "Avg Squad Age"}</div>
          <div className="text-lg font-extrabold text-white mt-0.5">{avgAge}</div>
          <div className="text-[10px] text-slate-400">{isAr ? "بيانات ويكيداتا الحية" : "Live bio data"}</div>
        </div>
      </div>

      {/* Row 3: Interactive 11-Starter Pitch Preview + ECharts Load + AI Briefing */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Interactive 11-Player FIFA Pitch Preview */}
        <div className="xl:col-span-6 studio-panel p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-extrabold text-white">
              <Users className="w-4 h-4 text-emerald-400" />
              <span>
                {isAr
                  ? `التشكيل الأساسي الجاهز (${overview.formation}) — اضغط على أي لاعب للتفاصيل`
                  : `Fit Starting XI (${overview.formation}) — Click any player`}
              </span>
            </div>
            <span className="text-[10px] text-emerald-300 font-bold">{overview.club.name_ar}</span>
          </div>

          <div className="relative w-full aspect-[16/10] rounded-2xl border border-emerald-500/30 bg-[#062016] overflow-hidden select-none">
            <svg viewBox="0 0 105 68" className="w-full h-full">
              <rect x="0" y="0" width="105" height="68" fill="#062016" />
              {[0, 2, 4, 6, 8].map((i) => (
                <rect key={i} x={i * 10.5} y="0" width="10.5" height="68" fill="#08291D" />
              ))}
              <rect x="2" y="2" width="101" height="64" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="0.45" />
              <line x1="52.5" y1="2" x2="52.5" y2="66" stroke="rgba(255,255,255,0.38)" strokeWidth="0.4" />
              <circle cx="52.5" cy="34" r="9.15" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="0.4" />
              <rect x="2" y="13.84" width="16.5" height="40.32" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="0.4" />
              <rect x="86.5" y="13.84" width="16.5" height="40.32" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="0.4" />
            </svg>

            {overview.squad_depth.slots.map((sl) => {
              const leftPct = Math.max(7, Math.min(93, sl.x_norm * 100));
              const topPct = Math.max(10, Math.min(90, sl.y_norm * 100));
              const p = sl.starter;
              const shortNm = p
                ? (isAr ? p.name_ar || p.name_en : p.name_en).split(" ").slice(-1)[0]
                : sl.slot;
              return (
                <button
                  key={sl.slot}
                  type="button"
                  disabled={!p}
                  onClick={() => p && onSelectPlayer(p, overview.club)}
                  style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group"
                >
                  <div
                    className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-[11px] font-extrabold text-white shadow-lg group-hover:scale-110 transition"
                    style={{ backgroundColor: sl.slot === "GK" ? "#F59E0B" : overview.club.kit_hex || "#10B981" }}
                  >
                    {p ? p.jersey_number : "?"}
                  </div>
                  <span className="mt-0.5 px-1.5 py-0.5 rounded bg-black/75 text-[9px] font-bold text-white whitespace-nowrap max-w-[76px] truncate">
                    {shortNm}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: ECharts Load Chart + AI Matchday Briefing */}
        <div className="xl:col-span-6 space-y-4">
          <div className="studio-panel p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-extrabold text-white">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>{isAr ? "توزيع الأحمال الأسبوعي (Foster sRPE AU)" : "Weekly Load Distribution (sRPE AU)"}</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("training")}
                className="text-[11px] font-bold text-emerald-400 hover:underline"
              >
                {isAr ? "فتح المخطط التدريبي ←" : "Open Training Studio ->"}
              </button>
            </div>
            <div ref={chartRef} className="w-full h-44" />
          </div>

          <div className="studio-panel p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-extrabold text-emerald-300">
                <Sparkles className="w-4 h-4" />
                <span>{isAr ? "الموجز الفني الذكي للمباراة" : "Live Matchday Intelligence Brief"}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  onRunAiPrompt(
                    `اكتب خطاب تحفيز غرفة الملابس لفريق ${overview.club.name_ar} قبل مواجهة ${overview.opponent.name_ar} مع 3 تعليمات تكتيكية حاسمة`
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 font-extrabold text-[11px]"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>{isAr ? "خطاب غرفة الملابس بالـ AI" : "AI Team Talk"}</span>
              </button>
            </div>
            <div className="space-y-1.5">
              {(overview.matchday_brief_ar || []).map((line, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.07] text-slate-200 flex items-start gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
