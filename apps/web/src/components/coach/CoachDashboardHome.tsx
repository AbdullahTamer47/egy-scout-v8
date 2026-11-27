"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import {
  Activity,
  ClipboardList,
  Compass,
  Flame,
  MessageSquare,
  Shield,
  ShieldAlert,
  Users,
} from "lucide-react";
import {
  CoachClubDetail,
  CoachOverviewPayload,
  CoachPlayer,
  CoachProfile,
  formatCoachName,
  getShortArabicName,
  isLightHex,
  SavedTacticalPlan,
  TacticalPhaseId,
} from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  profile: CoachProfile;
  overview: CoachOverviewPayload;
  generalPlan?: SavedTacticalPlan | null;
  onFormationChange?: (formation: string) => void;
  onNavigate: (tab: "tactics" | "training" | "director" | "admin" | "live") => void;
  onSelectPlayer: (player: CoachPlayer, club: CoachClubDetail) => void;
  onRunAiPrompt: (q: string) => void;
  onOpenOpponentPicker?: () => void;
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

const HOME_PHASE_LABELS: Array<{ id: TacticalPhaseId; ar: string; en: string }> = [
  { id: "attack", ar: "1. الهجوم", en: "1. Attack" },
  { id: "possession", ar: "2. الاستحواذ", en: "2. Possession" },
  { id: "defense", ar: "3. الدفاع", en: "3. Defense" },
];

export default function CoachDashboardHome({
  lang,
  profile,
  overview,
  generalPlan = null,
  onFormationChange,
  onNavigate,
  onSelectPlayer,
  onRunAiPrompt,
  onOpenOpponentPicker,
}: Props) {
  const isAr = lang === "ar";
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [homePhase, setHomePhase] = useState<TacticalPhaseId>("attack");
  const [brokenImgs, setBrokenImgs] = useState<Record<string, boolean>>({});

  const hasOpponent = Boolean(overview.opponent?.club_id && overview.opponent.club_id !== "none");
  const standings = overview.live_hub?.standings || [];
  const clubSt = standings.find(
    (s) => s.team_id === overview.club.club_id || s.team_name.toLowerCase().includes(overview.club.name_en.toLowerCase())
  );
  const oppSt = hasOpponent
    ? standings.find(
        (s) =>
          s.team_id === overview.opponent.club_id ||
          s.team_name.toLowerCase().includes(overview.opponent.name_en.toLowerCase())
      )
    : undefined;

  const warnedCount = overview.club.players.filter((p) => p.yellow_cards === 2).length;
  const ages = overview.club.players.map((p) => p.age).filter((a): a is number => typeof a === "number" && a > 14);
  const avgAge = ages.length > 0 ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : "-";

  const activeGeneralNodes = useMemo(() => {
    const snap = generalPlan?.phases?.[homePhase];
    if (snap && Array.isArray(snap.nodes) && snap.nodes.length > 0) {
      return snap.nodes;
    }
    return null;
  }, [generalPlan, homePhase]);

  const activeFormationDisplay = generalPlan?.formation_a || overview.formation;

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const chart = echarts.init(el);
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
        borderColor: "#E5E7EB",
        textStyle: { color: "#0F172A", fontSize: 11 },
      },
      legend: {
        top: 0,
        textStyle: { color: "#64748B", fontSize: 10 },
      },
      grid: { left: 36, right: 14, top: 28, bottom: 22 },
      xAxis: {
        type: "category",
        data: mergedData.map((d) => d.md),
        axisLabel: { color: "#64748B", fontSize: 10 },
        axisLine: { lineStyle: { color: "#E5E7EB" } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#64748B", fontSize: 10 },
        splitLine: { lineStyle: { color: "#F1F5F9" } },
      },
      series: [
        {
          name: isAr ? "المسجل فعلياً (AU)" : "Logged (AU)",
          type: "bar",
          barWidth: "42%",
          data: mergedData.map((d) => ({
            value: d.au,
            itemStyle: {
              borderRadius: [4, 4, 0, 0],
              color: d.rpe >= 8 ? "#DC2626" : d.rpe >= 6 ? "#D97706" : "#15803D",
            },
          })),
        },
        {
          name: isAr ? "المرجع الإرشادي (UEFA)" : "UEFA Ref",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { color: "#0F172A", type: "dashed", width: 1.5, opacity: 0.4 },
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

  const findClubPlayer = (jersey: number | null, label: string): CoachPlayer | undefined => {
    if (jersey != null) {
      const byJersey = overview.club.players.find((pl) => pl.jersey_number === jersey);
      if (byJersey) return byJersey;
    }
    const clean = (label || "").trim().toLowerCase();
    return overview.club.players.find(
      (pl) => pl.name_ar.toLowerCase().includes(clean) || pl.name_en.toLowerCase().includes(clean)
    );
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-3 sm:space-y-4">
      {/* Row 1: Clean Club Overview Hero */}
      <div className="studio-panel p-3.5 sm:p-4 border-s-4 border-s-[#15803D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {overview.club.logo_url ? (
            <img
              src={overview.club.logo_url}
              alt={overview.club.name_ar}
              className="w-11 h-11 rounded-xl object-contain bg-slate-50 border border-slate-200 p-1 shrink-0"
            />
          ) : (
            <div
              className={`w-11 h-11 rounded-xl border flex items-center justify-center font-extrabold text-sm shrink-0 ${
                clubKitLight ? "border-slate-300 text-slate-900" : "border-slate-200 text-white"
              }`}
              style={{ backgroundColor: overview.club.kit_hex || "#15803D" }}
            >
              {clubSt ? `#${clubSt.rank}` : "XI"}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500">
              {isAr ? `لوحة الفريق • ${formatCoachName(profile.coach_name, true)}` : `${formatCoachName(profile.coach_name, false)} • Team HQ`}
            </div>
            <div className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center flex-wrap gap-1.5">
              <span>{isAr ? overview.club.name_ar : overview.club.name_en}</span>
              {hasOpponent ? (
                <span className="text-slate-500 font-bold text-xs sm:text-sm">
                  × {isAr ? overview.opponent.name_ar : overview.opponent.name_en}
                </span>
              ) : (
                onOpenOpponentPicker && (
                  <button
                    type="button"
                    onClick={onOpenOpponentPicker}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-[11px] font-bold text-slate-700 border border-slate-200"
                  >
                    <Shield className="w-3 h-3" />
                    <span>{isAr ? "+ تحديد الخصم" : "+ Set Opponent"}</span>
                  </button>
                )
              )}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {clubSt ? `${clubSt.points} نقطة (${clubSt.wins}ف ${clubSt.draws}ت ${clubSt.losses}خ)` : `${overview.club.players.length} لاعباً`}
              {overview.club.stadium_ar ? ` • ${overview.club.stadium_ar}` : ""}
              {oppSt ? ` | الخصم: #${oppSt.rank} (${oppSt.points} ن)` : ""}
            </div>
            {overview.club.tactical_profile && (
              <div className="text-[10.5px] font-semibold text-[#15803D] truncate mt-0.5">
                {isAr ? overview.club.tactical_profile.identity_ar : overview.club.tactical_profile.identity_en}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => onNavigate("tactics")}
            className="inline-flex items-center justify-center gap-1 px-2.5 sm:px-3.5 py-2 min-h-[40px] rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-[11px] sm:text-xs font-extrabold transition"
          >
            <Compass className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{isAr ? "التكتيك" : "Tactics"}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("training")}
            className="inline-flex items-center justify-center gap-1 px-2.5 sm:px-3 py-2 min-h-[40px] rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-[11px] sm:text-xs font-bold text-slate-800"
          >
            <Flame className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="truncate">{isAr ? "التدريب" : "Training"}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("admin")}
            className="inline-flex items-center justify-center gap-1 px-2.5 sm:px-3 py-2 min-h-[40px] rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-[11px] sm:text-xs font-bold text-slate-800"
          >
            <ClipboardList className="w-3.5 h-3.5 text-slate-700 shrink-0" />
            <span className="truncate">{isAr ? "القائمة" : "Sheet"}</span>
          </button>
        </div>
      </div>

      {/* Row 2: 6 Live KPI Tiles (2 cols mobile, 6 cols desktop) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5 text-xs">
        <div className="studio-panel p-2.5 sm:p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "اللاعبون الجاهزون" : "Fit Players"}</div>
          <div className="text-lg font-extrabold text-[#15803D] mt-0.5 tabular-nums">{overview.squad_depth.fit_count}</div>
          <div className="text-[10px] text-slate-500">{isAr ? `من إجمالي ${overview.club.players.length}` : `of ${overview.club.players.length}`}</div>
        </div>
        <div className="studio-panel p-2.5 sm:p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "إصابات / إيقافات" : "Excluded"}</div>
          <div className={`text-lg font-extrabold mt-0.5 tabular-nums ${overview.squad_depth.unavailable_count > 0 ? "text-rose-600" : "text-slate-900"}`}>
            {overview.squad_depth.unavailable_count}
          </div>
          <div className="text-[10px] text-slate-500">{isAr ? "حالة إدارية" : "Admin status"}</div>
        </div>
        <div className="studio-panel p-2.5 sm:p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "مهدد بالإيقاف" : "2-Card Risk"}</div>
          <div className={`text-lg font-extrabold mt-0.5 tabular-nums ${warnedCount > 0 ? "text-amber-600" : "text-slate-900"}`}>{warnedCount}</div>
          <div className="text-[10px] text-slate-500">{isAr ? "إنذاران (الحد 3)" : "At 2 yellows"}</div>
        </div>
        <div className="studio-panel p-2.5 sm:p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "حصة الأجانب" : "Foreign Quota"}</div>
          <div
            className={`text-lg font-extrabold mt-0.5 tabular-nums ${
              overview.foreign_quota?.status === "over_limit"
                ? "text-rose-600"
                : overview.foreign_quota?.status === "warning"
                  ? "text-amber-600"
                  : "text-slate-900"
            }`}
          >
            {overview.foreign_quota?.foreign_count ?? 0} / {overview.foreign_quota?.limit ?? 5}
          </div>
          <div className="text-[10px] text-slate-500">{isAr ? "الحد الأقصى 5" : "Max 5 registered"}</div>
        </div>
        <div className="studio-panel p-2.5 sm:p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "الحمل الأسبوعي" : "Weekly Load"}</div>
          <div className="text-lg font-extrabold text-slate-900 mt-0.5 tabular-nums">{overview.weekly_load_safety.total_weekly_au} AU</div>
          <div className="text-[10px] text-slate-500">{overview.training_sessions.length} {isAr ? "حصص مسجلة" : "sessions"}</div>
        </div>
        <div className="studio-panel p-2.5 sm:p-3">
          <div className="text-[10px] font-bold text-slate-500">{isAr ? "متوسط الأعمار" : "Avg Age"}</div>
          <div className="text-lg font-extrabold text-slate-900 mt-0.5 tabular-nums">{avgAge}</div>
          <div className="text-[10px] text-slate-500">{isAr ? "بيانات 2026/27" : "2026/27 data"}</div>
        </div>
      </div>

      {/* Row 3: Live General Plan Pitch + ECharts Load + Match Briefing */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 sm:gap-4">
        {/* Live General Plan Pitch Preview */}
        <div className="xl:col-span-6 studio-panel p-3 sm:p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-extrabold text-slate-900">
              <Users className="w-4 h-4 text-[#15803D]" />
              <span>
                {generalPlan
                  ? isAr
                    ? `الخطة العامة المعتمدة (${activeFormationDisplay})`
                    : `Active General Plan (${activeFormationDisplay})`
                  : isAr
                  ? `التشكيل الأساسي (${activeFormationDisplay})`
                  : `Starting XI (${activeFormationDisplay})`}
              </span>
              {generalPlan && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#15803D] border border-emerald-200 text-[10px] font-bold">
                  {isAr ? "محدّثة" : "Synced"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {onFormationChange && !generalPlan && (
                <select
                  aria-label={isAr ? "تغيير التشكيل الأساسي" : "Change Starting Formation"}
                  value={overview.formation}
                  onChange={(e) => onFormationChange(e.target.value)}
                  className="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-800 cursor-pointer outline-none"
                >
                  {DASHBOARD_FORMATIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => onNavigate("tactics")}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold"
              >
                {isAr ? "تعديل في التكتيك" : "Edit in Tactics"}
              </button>
            </div>
          </div>

          {/* 3-Phase Switcher when General Plan is saved */}
          {generalPlan && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                {HOME_PHASE_LABELS.map((ph) => (
                  <button
                    key={ph.id}
                    type="button"
                    onClick={() => setHomePhase(ph.id)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                      homePhase === ph.id ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {isAr ? ph.ar : ph.en}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-500">
                {isAr ? "آخر حفظ:" : "Updated:"} {generalPlan.updated_at?.slice(0, 10)}
              </span>
            </div>
          )}

          <div className="relative w-full min-h-[260px] sm:min-h-[340px] aspect-[16/10] rounded-xl border border-emerald-800/30 bg-[#15803D] overflow-hidden select-none">
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

            {activeGeneralNodes
              ? activeGeneralNodes.map((n, idx) => {
                  const leftPct = Math.max(7, Math.min(93, (n.x_m / 105) * 100));
                  const topPct = Math.max(12, Math.min(88, (n.y_m / 68) * 100));
                  const p = findClubPlayer(n.jersey_number, n.player_label);
                  const isGk = n.slot === "GK";
                  const darkInk = isGk || clubKitLight;
                  const shortLabel = p ? getShortArabicName(p) : n.player_label || n.slot;
                  return (
                    <button
                      key={`${n.slot}-${idx}`}
                      type="button"
                      disabled={!p}
                      onClick={() => p && onSelectPlayer(p, overview.club)}
                      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group z-10 hover:z-20 cursor-pointer"
                    >
                      <span className="mb-0.5 px-1 rounded bg-slate-900/90 text-[8px] font-bold text-emerald-300">
                        {n.slot}
                      </span>
                      <div className="relative flex items-center justify-center group-hover:scale-110 transition">
                        {p?.photo_url && !brokenImgs[p.photo_url] ? (
                          <div
                            className="w-8 h-8 sm:w-10 sm:h-10 rounded-full overflow-hidden border-2 bg-white shadow-md"
                            style={{ borderColor: isGk ? "#EAB308" : overview.club.kit_hex || "#DC2626" }}
                          >
                            <img
                              src={p.photo_url}
                              alt={shortLabel}
                              onError={() => setBrokenImgs((b) => ({ ...b, [p.photo_url!]: true }))}
                              className="w-full h-full object-cover object-top"
                            />
                          </div>
                        ) : (
                          <div
                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-extrabold shadow-sm ${
                              darkInk ? "border-slate-900 text-slate-900" : "border-white text-white"
                            }`}
                            style={{ backgroundColor: isGk ? "#EAB308" : overview.club.kit_hex || "#DC2626" }}
                          >
                            {n.jersey_number ?? p?.jersey_number ?? "?"}
                          </div>
                        )}
                        {p?.photo_url && !brokenImgs[p.photo_url] && (
                          <span className="absolute -bottom-0.5 -end-1 px-1 rounded-full bg-slate-900 text-white text-[8px] font-extrabold border border-white leading-tight">
                            {n.jersey_number ?? p.jersey_number ?? ""}
                          </span>
                        )}
                      </div>
                      <span className="mt-0.5 px-1.5 py-0.5 rounded bg-slate-900/90 text-[8.5px] sm:text-[9px] font-bold text-white whitespace-nowrap max-w-[78px] truncate">
                        {shortLabel}
                      </span>
                    </button>
                  );
                })
              : overview.squad_depth.slots.map((sl, idx) => {
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
                      <span className="mb-0.5 px-1 rounded bg-slate-900/90 text-[8px] font-bold text-emerald-300">
                        {sl.slot}
                      </span>
                      <div className="relative flex items-center justify-center group-hover:scale-110 transition">
                        {p?.photo_url && !brokenImgs[p.photo_url] ? (
                          <div
                            className="w-8 h-8 sm:w-10 sm:h-10 rounded-full overflow-hidden border-2 bg-white shadow-md"
                            style={{ borderColor: isGk ? "#EAB308" : overview.club.kit_hex || "#DC2626" }}
                          >
                            <img
                              src={p.photo_url}
                              alt={fullNm}
                              onError={() => setBrokenImgs((b) => ({ ...b, [p.photo_url!]: true }))}
                              className="w-full h-full object-cover object-top"
                            />
                          </div>
                        ) : (
                          <div
                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-extrabold shadow-sm ${
                              darkInk ? "border-slate-900 text-slate-900" : "border-white text-white"
                            }`}
                            style={{ backgroundColor: isGk ? "#EAB308" : overview.club.kit_hex || "#DC2626" }}
                          >
                            {p ? p.jersey_number : "?"}
                          </div>
                        )}
                        {p?.photo_url && !brokenImgs[p.photo_url] && (
                          <span className="absolute -bottom-0.5 -end-1 px-1 rounded-full bg-slate-900 text-white text-[8px] font-extrabold border border-white leading-tight">
                            {p.jersey_number}
                          </span>
                        )}
                      </div>
                      <span className="mt-0.5 px-1.5 py-0.5 rounded bg-slate-900/90 text-[8.5px] sm:text-[9px] font-bold text-white whitespace-nowrap">
                        {fullNm}
                      </span>
                    </button>
                  );
                })}
          </div>

          {!generalPlan && (
            <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2">
              <span>{isAr ? "تشكيل مبدئي — عدّل اللاعبين واحفظ «الخطة العامة» لتثبيتها هنا" : "Default XI — edit & save General Plan in Tactics"}</span>
              <button type="button" onClick={() => onNavigate("tactics")} className="font-bold text-[#15803D] hover:underline whitespace-nowrap">
                {isAr ? "فتح التكتيك" : "Open Tactics"}
              </button>
            </div>
          )}
        </div>

        {/* Right: ECharts Load Chart + Matchday Brief */}
        <div className="xl:col-span-6 space-y-3 sm:space-y-4">
          <div className="studio-panel p-3.5 sm:p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-extrabold text-slate-900">
                <Activity className="w-4 h-4 text-[#15803D]" />
                <span>{isAr ? "توزيع الأحمال الأسبوعي (Foster sRPE AU)" : "Weekly Load Distribution (sRPE AU)"}</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("training")}
                className="text-[11px] font-bold text-[#15803D] hover:underline"
              >
                {isAr ? "التدريب ←" : "Training ->"}
              </button>
            </div>
            <div ref={chartRef} className="w-full h-40 sm:h-44" />
          </div>

          <div className="studio-panel p-3.5 sm:p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-extrabold text-slate-900">
                <ClipboardList className="w-4 h-4 text-slate-700" />
                <span>{isAr ? "ملاحظات وتقرير الفريق" : "Matchday Squad Notes"}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  onRunAiPrompt(
                    hasOpponent
                      ? `اكتب خطاب تحفيز غرفة الملابس لفريق ${overview.club.name_ar} قبل مواجهة ${overview.opponent.name_ar} مع 3 تعليمات تكتيكية حاسمة`
                      : `حلل نقاط القوة والضعف في التشكيل العام لفريق ${overview.club.name_ar} واقترح 3 تعليمات تكتيكية`
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px]"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>{isAr ? "محادثة تكتيكية" : "Ask Assistant"}</span>
              </button>
            </div>
            <div className="space-y-1.5">
              {(overview.matchday_brief_ar || []).map((line, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 flex items-start gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
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
