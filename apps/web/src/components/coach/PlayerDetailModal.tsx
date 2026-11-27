"use client";

import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Flame, MessageSquare, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CoachClubDetail, CoachPlayer, isLightHex, MultiSourcePlayerStats } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  player: CoachPlayer;
  club: CoachClubDetail;
  onClose: () => void;
  onAskAi?: (question: string) => void;
}

const STATUS_LABEL_AR: Record<CoachPlayer["status"], string> = {
  fit: "جاهز للمشاركة 100%",
  load_managed: "متاح مع تقنين الأحمال",
  rehab: "تأهيل فردي — غير متاح",
  injured: "إصابة طبية — مستبعد",
  suspended: "إيقاف انضباطي — مستبعد",
};

export default function PlayerDetailModal({ lang, player, club, onClose, onAskAi }: Props) {
  const isAr = lang === "ar";
  const displayName = isAr ? player.name_ar || player.name_en : player.name_en || player.name_ar;
  const isEligible = player.is_eligible_starter !== false;
  const safeStatus = player.status || "fit";
  const safeReadiness = player.readiness_pct ?? 100;
  const [imgFailed, setImgFailed] = useState(false);
  const [liveStats, setLiveStats] = useState<MultiSourcePlayerStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const safeYc = player.yellow_cards ?? 0;
  const safeRc = player.red_cards ?? 0;
  const lightKit = isLightHex(club.kit_hex);

  const fetchLiveStats = async () => {
    setLoadingStats(true);
    try {
      const qs = new URLSearchParams({
        name: player.name_ar || player.name_en,
        name_en: player.name_en || "",
        club_name: club.name_ar || "",
        position: player.position || "",
      });
      const c365 = (club as { ts_365_id?: number }).ts_365_id;
      if (c365) qs.set("club_365_id", String(c365));
      const res = await apiFetch<MultiSourcePlayerStats>(`/api/coach/player-live-stats?${qs.toString()}`);
      setLiveStats(res);
    } catch {
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    fetchLiveStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.jersey_number, player.name_ar, player.name_en]);

  const m = liveStats?.metrics;

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="fixed inset-0 z-[100] bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-2xl text-slate-900"
      >
        {/* Editorial Club Header Banner */}
        <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            {(liveStats?.photo_url || player.photo_url) && !imgFailed ? (
              <img
                src={liveStats?.photo_url || player.photo_url || ""}
                alt={displayName}
                onError={() => setImgFailed(true)}
                className="w-16 h-16 rounded-xl object-cover object-top border border-slate-200 bg-white shrink-0"
              />
            ) : (
              <div
                className={`w-16 h-16 rounded-xl border-2 flex flex-col items-center justify-center font-extrabold shrink-0 ${
                  lightKit ? "border-slate-300 text-slate-900" : "border-white/70 text-white"
                }`}
                style={{ backgroundColor: club.kit_hex || "#15803D" }}
              >
                <span className="text-lg leading-none">#{player.jersey_number}</span>
                <span className={`text-[10px] mt-0.5 ${lightKit ? "text-slate-600" : "text-white/90"}`}>{player.position}</span>
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-slate-900 text-[11px] font-bold text-white">
                  #{player.jersey_number}
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-[#15803D]">
                  {liveStats?.position_code || player.position}
                </span>
                {m?.impact_rating && (
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-[10px] font-bold text-emerald-300">
                    Rating {m.impact_rating}
                  </span>
                )}
                {player.is_captain && (
                  <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-[10px] font-bold text-amber-800">
                    {isAr ? "قائد" : "Captain"}
                  </span>
                )}
              </div>
              <h3 className="text-base font-extrabold text-slate-900 truncate mt-1">{displayName}</h3>
              <div className="text-xs text-slate-500 truncate">
                {player.name_en} • {isAr ? club.name_ar : club.name_en}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={fetchLiveStats}
              disabled={loadingStats}
              title={isAr ? "تحديث الإحصائيات الحية" : "Refresh live stats"}
              className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-slate-900"
            >
              <RefreshCw className={`w-4 h-4 ${loadingStats ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Details Body */}
        <div className="p-4 sm:p-5 space-y-4 text-xs">
          {/* Status Banner */}
          <div
            className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
              isEligible ? "bg-emerald-50 border-emerald-200 text-[#15803D]" : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            <div className="flex items-center gap-2 font-bold">
              {isEligible ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
              <span>{player.block_reason_ar || STATUS_LABEL_AR[safeStatus] || safeStatus}</span>
            </div>
            <span className="font-extrabold">
              {isAr ? `الجاهزية ${safeReadiness}%` : `Readiness ${safeReadiness}%`}
            </span>
          </div>

          {player.warning_ar && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{player.warning_ar}</span>
            </div>
          )}

          {/* Biographical Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] text-slate-500">{isAr ? "العمر" : "Age"}</div>
              <div className="font-extrabold text-slate-900 mt-0.5">
                {liveStats?.age || player.age ? `${liveStats?.age || player.age} ${isAr ? "سنة" : "yrs"}` : isAr ? "غير مسجل" : "N/A"}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] text-slate-500">{isAr ? "الطول / القدم" : "Height / Foot"}</div>
              <div className="font-extrabold text-slate-900 mt-0.5 truncate">
                {liveStats?.height_cm || player.height_cm ? `${liveStats?.height_cm || player.height_cm} سم` : "—"}
                {(liveStats?.preferred_foot || player.preferred_foot) ? ` • ${liveStats?.preferred_foot || player.preferred_foot}` : ""}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] text-slate-500">{isAr ? "الجنسية" : "Nationality"}</div>
              <div className="font-extrabold text-slate-900 mt-0.5 truncate">
                {player.nationality_flag || "🌍"} {player.nationality_ar || player.nationality || "EGY"}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] text-slate-500">{isAr ? "البطاقات" : "Cards"}</div>
              <div className="font-extrabold text-slate-900 mt-0.5">
                🟨 {m?.yellow_cards ?? safeYc} &nbsp; 🟥 {m?.red_cards ?? safeRc}
              </div>
            </div>
          </div>

          {/* Multi-Source Deep Live Analytics */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-extrabold text-slate-900 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-[#15803D]" />
                <span>{isAr ? "الإحصائيات الحية العميقة (متعددة المصادر)" : "Deep Live Multi-Source Analytics"}</span>
              </span>
              {loadingStats && <span className="text-[10px] text-slate-500">{isAr ? "جاري الاستيراد..." : "Syncing..."}</span>}
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[9.5px] text-slate-500">{isAr ? "مباريات" : "Apps"}</div>
                <div className="font-extrabold text-slate-900 text-sm tabular-nums">{m?.appearances ?? player.live_stats?.appearances ?? "—"}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[9.5px] text-slate-500">{isAr ? "أساسي" : "Starts"}</div>
                <div className="font-extrabold text-slate-900 text-sm tabular-nums">{m?.starts ?? "—"}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[9.5px] text-slate-500">{isAr ? "أهداف" : "Goals"}</div>
                <div className="font-extrabold text-[#15803D] text-sm tabular-nums">{m?.goals ?? player.live_stats?.goals ?? "—"}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[9.5px] text-slate-500">{isAr ? "صناعة" : "Assists"}</div>
                <div className="font-extrabold text-sky-700 text-sm tabular-nums">{m?.assists ?? player.live_stats?.assists ?? "—"}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[9.5px] text-slate-500">G+A / 90</div>
                <div className="font-extrabold text-slate-900 text-sm tabular-nums">{m?.ga_per_90 ?? "—"}</div>
              </div>
              <div className="p-2 rounded-lg bg-white border border-slate-200">
                <div className="text-[9.5px] text-slate-500">{isAr ? "دقة التسديد" : "Shot %"}</div>
                <div className="font-extrabold text-slate-900 text-sm tabular-nums">{m?.shot_accuracy_pct != null ? `${m.shot_accuracy_pct}%` : "—"}</div>
              </div>
            </div>

            {/* Player Activity Heatmap SVG */}
            {liveStats?.heatmap_zones && liveStats.heatmap_zones.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-rose-600" />
                  <span>{isAr ? `الخريطة الحرارية التمركزية (${liveStats.position_code})` : `Positional Activity Heatmap (${liveStats.position_code})`}</span>
                </div>
                <div className="relative rounded-xl overflow-hidden border border-emerald-800/30 bg-[#15803D]">
                  <svg viewBox="0 0 105 68" className="w-full h-36">
                    <rect x="0" y="0" width="105" height="68" fill="#15803D" />
                    <rect x="2" y="2" width="101" height="64" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="0.5" />
                    <line x1="52.5" y1="2" x2="52.5" y2="66" stroke="rgba(255,255,255,0.65)" strokeWidth="0.45" />
                    <circle cx="52.5" cy="34" r="9.15" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="0.45" />
                    <defs>
                      {liveStats.heatmap_zones.map((hz, i) => (
                        <radialGradient key={i} id={`ph-${i}`}>
                          <stop offset="0%" stopColor="#EF4444" stopOpacity={0.75 * hz.w} />
                          <stop offset="55%" stopColor="#F59E0B" stopOpacity={0.42 * hz.w} />
                          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
                        </radialGradient>
                      ))}
                    </defs>
                    {liveStats.heatmap_zones.map((hz, i) => (
                      <circle key={i} cx={(hz.x / 100) * 105} cy={(hz.y / 100) * 68} r={14 + hz.w * 8} fill={`url(#ph-${i})`} />
                    ))}
                  </svg>
                </div>
              </div>
            )}

            {/* Competition Breakdown + Recent Matches (ESPN) */}
            {liveStats?.competitions && liveStats.competitions.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10.5px] font-bold text-slate-600">{isAr ? "تفاصيل البطولات 2026/27:" : "Competitions 2026/27:"}</div>
                <div className="space-y-1">
                  {liveStats.competitions.map((cp, idx) => (
                    <div key={idx} className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px]">
                      <span className="font-bold text-slate-800 truncate">{cp.competition}</span>
                      <span className="text-slate-600 tabular-nums shrink-0">
                        {cp.appearances}م ({cp.starts} أساسي) • {cp.goals}أ • {cp.assists}ص
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {liveStats?.recent_matches && liveStats.recent_matches.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10.5px] font-bold text-slate-600">{isAr ? "آخر المباريات الرسمية:" : "Recent Official Matches:"}</div>
                <div className="space-y-1">
                  {liveStats.recent_matches.slice(0, 4).map((rm, idx) => (
                    <div key={idx} className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[10.5px]">
                      <span className="font-bold text-slate-800 truncate">{rm.opponent}</span>
                      <span className="text-slate-500 shrink-0">
                        {rm.date} • {rm.score} ({rm.result})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {liveStats?.sources_verified && liveStats.sources_verified.length > 0 && (
              <div className="flex items-center gap-1.5 pt-1">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#15803D]">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {isAr ? "بيانات موسم 2026/27 محدثة" : "2026/27 Season Data Updated"}
                </span>
              </div>
            )}
          </div>

          {onAskAi && (
            <button
              type="button"
              onClick={() => {
                onAskAi(
                  `حلل الدور التكتيكي والتدريبي الأمثل للاعب #${player.jersey_number} ${displayName} (${player.position}${player.age ? `، ${player.age} سنة` : ""}) في ${club.name_ar}`
                );
                onClose();
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition"
            >
              <MessageSquare className="w-4 h-4" />
              <span>{isAr ? "تحليل وتوظيف اللاعب في التشكيل" : "Analyze Player Role in Formation"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
