"use client";

import React from "react";
import { AlertTriangle, Bot, CheckCircle2, ShieldAlert, X } from "lucide-react";
import { CoachClubDetail, CoachPlayer } from "./coachTypes";

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

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl bg-[#0C1220] border border-emerald-500/35 shadow-2xl overflow-hidden"
      >
        {/* Header Card Banner */}
        <div
          className="px-5 py-4 flex items-center justify-between gap-3 border-b border-white/[0.08]"
          style={{
            background: `linear-gradient(135deg, ${club.kit_hex || "#10B981"}33 0%, #0C1220 75%)`,
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            {player.photo_url ? (
              <img
                src={player.photo_url}
                alt={displayName}
                className="w-16 h-16 rounded-2xl object-cover object-top border border-white/25 bg-slate-900 shrink-0"
              />
            ) : (
              <div
                className="w-16 h-16 rounded-2xl border border-white/25 flex flex-col items-center justify-center font-extrabold text-white shrink-0"
                style={{ backgroundColor: `${club.kit_hex || "#10B981"}55` }}
              >
                <span className="text-lg leading-none">#{player.jersey_number}</span>
                <span className="text-[10px] text-emerald-200 mt-0.5">{player.position}</span>
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-full bg-white/[0.1] text-[11px] font-extrabold text-white">
                  #{player.jersey_number}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-[11px] font-extrabold text-emerald-300">
                  {player.position}
                </span>
                {player.is_captain && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-[10px] font-extrabold text-amber-300">
                    {isAr ? "قائد الفريق" : "Captain"}
                  </span>
                )}
                {player.is_on_loan && (
                  <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-[10px] font-extrabold text-sky-300">
                    {isAr ? "إعارة" : "On Loan"}
                  </span>
                )}
              </div>
              <h3 className="text-base font-extrabold text-white truncate mt-1">{displayName}</h3>
              <div className="text-xs text-slate-300 truncate">
                {player.name_en} • {isAr ? club.name_ar : club.name_en}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Details Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Status Banner */}
          <div
            className={`p-3 rounded-2xl border flex items-center justify-between gap-2 ${
              player.is_eligible_starter
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                : "bg-rose-500/15 border-rose-500/35 text-rose-200"
            }`}
          >
            <div className="flex items-center gap-2 font-bold">
              {player.is_eligible_starter ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{player.block_reason_ar || STATUS_LABEL_AR[player.status] || player.status}</span>
            </div>
            <span className="font-extrabold">
              {isAr ? `الجاهزية ${player.readiness_pct}%` : `Readiness ${player.readiness_pct}%`}
            </span>
          </div>

          {player.warning_ar && (
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-200 flex items-center gap-2 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{player.warning_ar}</span>
            </div>
          )}

          {/* Profile Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.07]">
              <div className="text-[10px] text-slate-400">{isAr ? "الجنسية" : "Nationality"}</div>
              <div className="font-extrabold text-white mt-0.5">
                {player.nationality_flag || "🇪🇬"} {player.nationality_ar || player.nationality || "EGY"}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.07]">
              <div className="text-[10px] text-slate-400">{isAr ? "البطاقات المتراكمة" : "Discipline"}</div>
              <div className="font-extrabold text-white mt-0.5">
                🟨 {player.yellow_cards} &nbsp;|&nbsp; 🟥 {player.red_cards}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.07]">
              <div className="text-[10px] text-slate-400">{isAr ? "ملعب النادي" : "Stadium"}</div>
              <div className="font-extrabold text-white mt-0.5 truncate">{club.stadium_ar || "-"}</div>
            </div>
            {player.live_stats && (player.live_stats.appearances !== null || player.live_stats.goals !== null) && (
              <>
                <div className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.07]">
                  <div className="text-[10px] text-slate-400">{isAr ? "المشاركات الحية" : "Apps"}</div>
                  <div className="font-extrabold text-emerald-300 mt-0.5">{player.live_stats.appearances ?? "-"}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.07]">
                  <div className="text-[10px] text-slate-400">{isAr ? "الأهداف" : "Goals"}</div>
                  <div className="font-extrabold text-emerald-300 mt-0.5">{player.live_stats.goals ?? "-"}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.07]">
                  <div className="text-[10px] text-slate-400">{isAr ? "الصناعة" : "Assists"}</div>
                  <div className="font-extrabold text-emerald-300 mt-0.5">{player.live_stats.assists ?? "-"}</div>
                </div>
              </>
            )}
          </div>

          {player.admin_note && (
            <div className="p-3 rounded-xl bg-[#090D16] border border-white/[0.07] text-slate-300">
              <span className="font-bold text-slate-400">{isAr ? "ملاحظة الجهاز الإداري: " : "Admin Note: "}</span>
              {player.admin_note}
            </div>
          )}

          <div className="text-[10px] text-slate-400 flex items-center justify-between">
            <span>{player.source || club.source}</span>
            {player.return_date && <span>{isAr ? `عودة متوقعة: ${player.return_date}` : `ETA: ${player.return_date}`}</span>}
          </div>

          {onAskAi && (
            <button
              type="button"
              onClick={() => {
                onAskAi(`حلل الدور التكتيكي والتدريبي الأمثل للاعب #${player.jersey_number} ${displayName} (${player.position}) في ${club.name_ar}`);
                onClose();
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold transition"
            >
              <Bot className="w-4 h-4" />
              <span>{isAr ? "اسأل المساعد الذكي عن توظيف اللاعب" : "Ask AI Copilot about this player"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
