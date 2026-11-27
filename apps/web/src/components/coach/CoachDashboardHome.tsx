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
import { CoachClubDetail, CoachOverviewPayload, CoachPlayer, CoachProfile, getShortArabicName, isLightHex } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  profile: CoachProfile;
  overview: CoachOverviewPayload;
  onFormationChange?: (formation: string) => void;
  onNavigate: (tab: "tactics" | "training" | "director" | "admin" | "live") => void;
  onSelectPlayer: (player: CoachPlayer, club: CoachClubDetail) => void;
  onRunAiPrompt: (q: string) => void;
}

const WEEK_SLOTS = [
  { md: "MD-5", refAu: 135 },
  { md: "MD-4", refAu: 525 },
  { md: "MD-3", refAu: 680 },
  { md: "MD-2", refAu: 390 },
  { md: "MD-1", refAu: 180 },
  { md: "MD", refAu: 900 },
  { md: "MD+1", refAu: 100 },
];

const DASHBOARD_FORMATIONS = ["4-2-3-1", "4-3-3", "3-4-2-1", "3-2-4-1", "3-5-2", "4-4-2", "5-3-2"];

export default function CoachDashboardHome({
  lang,
  profile,
  overview,
  onFormationChange,
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
    // Real-only logged training sessions (0 AU for unlogged days) + UEFA Periodization reference line
    const mergedData = WEEK_SLOTS.map((slot) => {
      const daySess = overview.training_sessions.filter((s) => s.md_code === slot.md);
      const totalAu = daySess.reduce((acc, s) => acc + Number(s.srpe_au || 0), 0);
      const maxRpe = daySess.length > 0 ? Math.max(...daySess.map((s) => Number(s.target_rpe || 0))) : 0;
      return {
        md: slot.md,
        au: totalAu,
        rpe: maxRpe,
        refAu: slot.refAu,
      };
    });
    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "#FFFFFF",
        borderColor: "#D8E3EB",
        textStyle: { color: "#0B1F3A", fontSize: 11 },
      },
      legend: {
        top: 0,
        textStyle: { color: "#5C6A7C", fontSize: 10 },
      },
      grid: { left: 40, right: 16, top: 28, bottom: 24 },
      xAxis: {
        type: "category",
        data: mergedData.map((d) => d.md),
        axisLabel: { color: "#5C6A7C", fontSize: 10 },
        axisLine: { lineStyle: { color: "#D8E3EB" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#5C6A7C", fontSize: 10 },
        splitLine: { lineStyle: { color: "#EEF3F6" } },
      },
      series: [
        {
          name: isAr ? "المسجل فعلياً (AU)" : "Logged (AU)",
          type: "bar",
          barWidth: "42%",
          data: mergedData.map((d) => ({
            value: d.au,
            itemStyle: {
              borderRadius: [5, 5, 0, 0],
              color: d.rpe >= 8 ? "#EF4444" : d.rpe >= 6 ? "#E0A526" : "#0FB5AE",
            },
          })),
        },
        {
          name: isAr ? "المرجع الإرشادي (UEFA)" : "UEFA Ref",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#0B1F3A", type: "dashed", width: 1.5, opacity: 0.45 },
          data: mergedData.map((d) => d.refAu),
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [overview.training_sessions, isAr]);

  const clubKitLight = isLightHex(overview.club.kit_hex);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      {/* Row 1: Executive Matchup Hero + Quick Jump Buttons */}
      <div className="studio-panel p-4 bg-gradient-to-l from-emerald-50/70 via-white to-sky-50/50 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-2xl border flex items-center justify-center font-extrabold text-sm shrink-0 shadow-xs ${
                clubKitLight ? "border-slate-300 text-slate-900" : "border-white/60 text-white"
              }`}
              style={{ backgroundColor: overview.club.kit_hex || "#059669" }}
            >
              {clubSt ? `#${clubSt.rank}` : "XI"}
            </div>
            <div>
              <div className="text-[11px] font-bold text-emerald-700">
                {isAr ? `غرفة قيادة كابتن ${profile.coach_name}` : `Coach ${profile.coach_name} HQ`}
              </div>
              <div className="text-base font-extrabold text-[#0B1F3A]">
                {overview.club.name_ar} <span className="text-[#5C6A7C] mx-1">×</span> {overview.opponent.name_ar}
              </div>
              <div className="text-[11px] text-[#5C6A7C]">
                {clubSt ? `${clubSt.points} نقطة (${clubSt.wins}ف ${clubSt.draws}ت ${clubSt.losses}خ)` : `${overview.club.players.length} لاعباً`}
                {" • "}
                {overview.club.head_coach_ar ? `المدرب: ${overview.club.head_coach_ar} • ` : ""}
                {overview.club.stadium_ar || "الدوري المصري الممتاز 2026/27"}
                {oppSt ? ` | الخصم: #${oppSt.rank} (${oppSt.points} ن)` : ""}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate("tactics")}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold transition shadow-xs"
          >
            <Compass className="w-4 h-4" />
            <span>{isAr ? "السبورة التكتيكية (3 حالات)" : "3-Phase Tactics"}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("training")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 shadow-2xs"
          >
            <Flame className="w-4 h-4 text-amber-500" />
            <span>{isAr ? "التدريب اليومي" : "Training"}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("admin")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 shadow-2xs"
          >
            <ClipboardList className="w-4 h-4 text-sky-600" />
            <span>{isAr ? "كشف المباراة" : "Matchday Sheet"}</span>
          </button>
        </div>
      </div>

      {/* Row 2: 6 Live KPI Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
        <div className="studio-panel p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "اللاعبون الجاهزون" : "Fit Players"}</div>
          <div className="text-lg font-extrabold text-emerald-600 mt-0.5">{overview.squad_depth.fit_count}</div>
          <div className="text-[10px] text-slate-500">{isAr ? `من إجمالي ${overview.club.players.length}` : `of ${overview.club.players.length}`}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "إصابات / إيقافات" : "Excluded"}</div>
          <div className={`text-lg font-extrabold mt-0.5 ${overview.squad_depth.unavailable_count > 0 ? "text-rose-600" : "text-slate-800"}`}>
            {overview.squad_depth.unavailable_count}
          </div>
          <div className="text-[10px] text-slate-500">{isAr ? "تحديث إداري فوري" : "Live admin gate"}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "مهدد بالإيقاف (2🟨)" : "2-Card Risk"}</div>
          <div className={`text-lg font-extrabold mt-0.5 ${warnedCount > 0 ? "text-amber-600" : "text-slate-800"}`}>{warnedCount}</div>
          <div className="text-[10px] text-slate-500">{isAr ? "حد الإيقاف 3 إنذارات" : "Suspension at 3"}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "حصة الأجانب (EFA)" : "Foreign Quota"}</div>
          <div
            className={`text-lg font-extrabold mt-0.5 ${
              overview.foreign_quota?.status === "over_limit"
                ? "text-rose-600"
                : overview.foreign_quota?.status === "warning"
                  ? "text-amber-600"
                  : "text-emerald-600"
            }`}
          >
            {overview.foreign_quota?.foreign_count ?? 0} / {overview.foreign_quota?.limit ?? 5}
          </div>
          <div className="text-[10px] text-slate-500">{isAr ? "الحد الأقصى 5 أجانب" : "Max 5 registered"}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "الحمل الأسبوعي" : "Weekly Load"}</div>
          <div className="text-lg font-extrabold text-sky-600 mt-0.5">{overview.weekly_load_safety.total_weekly_au} AU</div>
          <div className="text-[10px] text-slate-500">{overview.training_sessions.length} {isAr ? "حصص مسجلة" : "saved sessions"}</div>
        </div>
        <div className="studio-panel p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "متوسط الأعمار" : "Avg Squad Age"}</div>
          <div className="text-lg font-extrabold text-slate-900 mt-0.5">{avgAge}</div>
          <div className="text-[10px] text-slate-500">{isAr ? "بيانات ويكيداتا الحية" : "Live bio data"}</div>
        </div>
      </div>

      {/* Row 3: Interactive 11-Starter Pitch Preview + ECharts Load + AI Briefing */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Interactive 11-Player Sunlit Stadium Pitch Preview */}
        <div className="xl:col-span-6 studio-panel p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-extrabold text-[#0B1F3A]">
              <Users className="w-4 h-4 text-[#0D717A]" />
              <span>
                {isAr
                  ? `التشكيل الأساسي الجاهز (${overview.formation}) — اضغط على أي لاعب للتفاصيل`
                  : `Fit Starting XI (${overview.formation}) — Click any player`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onFormationChange && (
                <select
                  aria-label={isAr ? "تغيير التشكيل الأساسي" : "Change Starting Formation"}
                  value={overview.formation}
                  onChange={(e) => onFormationChange(e.target.value)}
                  className="rounded-lg bg-[#E6F8F7] border border-[#0FB5AE]/50 px-2 py-1 text-[11px] font-extrabold text-[#0D717A] cursor-pointer outline-none"
                >
                  {DASHBOARD_FORMATIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              )}
              <span className="text-[10px] text-[#0D717A] font-bold">{overview.club.name_ar}</span>
            </div>
          </div>

          <div className="relative w-full min-h-[340px] aspect-[16/10] rounded-2xl border border-[#0D717A]/35 bg-[#15803D] overflow-hidden select-none shadow-sm">
            <svg viewBox="0 0 105 68" className="w-full h-full">
              <rect x="0" y="0" width="105" height="68" fill="#15803D" />
              {[0, 2, 4, 6, 8].map((i) => (
                <rect key={i} x={i * 10.5} y="0" width="10.5" height="68" fill="#166534" />
              ))}
              <rect x="2" y="2" width="101" height="64" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.5" />
              <line x1="52.5" y1="2" x2="52.5" y2="66" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
              <circle cx="52.5" cy="34" r="9.15" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
              <rect x="2" y="13.84" width="16.5" height="40.32" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
              <rect x="86.5" y="13.84" width="16.5" height="40.32" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
            </svg>

            {overview.squad_depth.slots.map((sl, idx) => {
              const leftPct = Math.max(8, Math.min(92, sl.x_norm * 100));
              const topPct = Math.max(13, Math.min(87, sl.y_norm * 100));
              const p = sl.starter;
              const fullNm = p ? getShortArabicName(p) : sl.slot;
              const isGk = sl.slot === "GK";
              const darkInk = isGk || clubKitLight;
              return (
                <button
                  key={`${sl.slot}-${idx}`}
                  type="button"
                  disabled={!p}
                  onClick={() => p && onSelectPlayer(p, overview.club)}
                  style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group z-10 hover:z-20 cursor-pointer"
                >
                  <span className="mb-0.5 px-1 rounded bg-[#0B1F3A]/85 text-[8px] font-extrabold text-[#0FB5AE]">
                    {sl.slot}
                  </span>
                  <div
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 flex items-center justify-center text-[10.5px] font-extrabold shadow-md group-hover:scale-110 transition ${
                      darkInk ? "border-[#0B1F3A] text-[#0B1F3A]" : "border-white text-white"
                    }`}
                    style={{ backgroundColor: isGk ? "#E0A526" : overview.club.kit_hex || "#DC2626" }}
                  >
                    {p ? p.jersey_number : "?"}
                  </div>
                  <span className="mt-0.5 px-1.5 py-0.5 rounded bg-[#0B1F3A]/90 text-[9px] font-bold text-white whitespace-nowrap shadow-xs">
                    {fullNm}
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
              <div className="flex items-center gap-2 font-extrabold text-slate-900">
                <Activity className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? "توزيع الأحمال الأسبوعي (Foster sRPE AU)" : "Weekly Load Distribution (sRPE AU)"}</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("training")}
                className="text-[11px] font-bold text-emerald-700 hover:underline"
              >
                {isAr ? "فتح المخطط التدريبي ←" : "Open Training Studio ->"}
              </button>
            </div>
            <div ref={chartRef} className="w-full h-44" />
          </div>

          <div className="studio-panel p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-extrabold text-emerald-800">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? "الموجز الفني الذكي للمباراة" : "Live Matchday Intelligence Brief"}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  onRunAiPrompt(
                    `اكتب خطاب تحفيز غرفة الملابس لفريق ${overview.club.name_ar} قبل مواجهة ${overview.opponent.name_ar} مع 3 تعليمات تكتيكية حاسمة`
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] shadow-2xs"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>{isAr ? "خطاب غرفة الملابس بالـ AI" : "AI Team Talk"}</span>
              </button>
            </div>
            <div className="space-y-1.5">
              {(overview.matchday_brief_ar || []).map((line, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-slate-800 flex items-start gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
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
