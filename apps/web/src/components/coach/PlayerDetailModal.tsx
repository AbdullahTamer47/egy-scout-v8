"use client";

import React from "react";
import { AlertTriangle, Bot, CheckCircle2, ShieldAlert, X } from "lucide-react";
import { CoachClubDetail, CoachPlayer, isLightHex } from "./coachTypes";

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
  const safeYc = player.yellow_cards ?? 0;
  const safeRc = player.red_cards ?? 0;
  const lightKit = isLightHex(club.kit_hex);

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden text-slate-900"
      >
        {/* Clean Light Executive Header Banner */}
        <div
          className="px-5 py-4 flex items-center justify-between gap-3 border-b border-slate-200"
          style={{
            background: `linear-gradient(135deg, ${club.kit_hex || "#10B981"}1F 0%, #F8FAFC 65%, #FFFFFF 100%)`,
          }}
        >
          <div className="flex items-center gap-3.5 min-w-0">
            {player.photo_url ? (
              <img
                src={player.photo_url}
                alt={displayName}
                className="w-18 h-18 rounded-2xl object-cover object-top border-2 border-emerald-500/40 bg-slate-100 shrink-0 shadow-sm"
              />
            ) : (
              <div
                className={`w-16 h-16 rounded-2xl border-2 flex flex-col items-center justify-center font-extrabold shrink-0 shadow-2xs ${
                  lightKit ? "border-slate-300 text-slate-900" : "border-white/70 text-white"
                }`}
                style={{ backgroundColor: club.kit_hex || "#059669" }}
              >
                <span className="text-lg leading-none">#{player.jersey_number}</span>
                <span className={`text-[10px] mt-0.5 ${lightKit ? "text-slate-600" : "text-white/90"}`}>{player.position}</span>
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-full bg-slate-900 text-[11px] font-extrabold text-white">
                  #{player.jersey_number}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-extrabold text-emerald-700">
                  {player.position}
                </span>
                {player.is_captain && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[10px] font-extrabold text-amber-800">
                    {isAr ? "⭐ قائد" : "⭐ Captain"}
                  </span>
                )}
                {player.is_on_loan && (
                  <span className="px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-[10px] font-extrabold text-sky-700">
                    {isAr ? "إعارة" : "On Loan"}
                  </span>
                )}
              </div>
              <h3 className="text-base font-extrabold text-slate-900 truncate mt-1">{displayName}</h3>
              <div className="text-xs text-slate-600 truncate">
                {player.name_en} • {isAr ? club.name_ar : club.name_en}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Details Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Status Banner */}
          <div
            className={`p-3 rounded-2xl border flex items-center justify-between gap-2 ${
              isEligible
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            <div className="flex items-center gap-2 font-bold">
              {isEligible ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              )}
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

          {/* Biographical & Physical Grid (Real Wikidata + Official Squad) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] text-slate-500">{isAr ? "العمر وتاريخ الميلاد" : "Age / DOB"}</div>
              <div className="font-extrabold text-slate-900 mt-0.5">
                {player.age ? `${player.age} ${isAr ? "سنة" : "yrs"}` : isAr ? "غير مسجل" : "N/A"}
              </div>
              {player.birth_date && <div className="text-[10px] text-slate-500">{player.birth_date}</div>}
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] text-slate-500">{isAr ? "الطول / القدم" : "Height / Foot"}</div>
              <div className="font-extrabold text-slate-900 mt-0.5">
                {player.height_cm ? `${player.height_cm} سم` : isAr ? "غير مسجل" : "N/A"}
              </div>
              {player.preferred_foot && <div className="text-[10px] font-bold text-emerald-700">{player.preferred_foot}</div>}
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] text-slate-500">{isAr ? "الجنسية" : "Nationality"}</div>
              <div className="font-extrabold text-slate-900 mt-0.5">
                {player.nationality_flag || "🇪🇬"} {player.nationality_ar || player.nationality || "EGY"}
              </div>
              <div className="text-[10px] text-slate-500">{player.nationality === "EGY" ? (isAr ? "محلي" : "Domestic") : isAr ? "أجنبي" : "Foreign"}</div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-[10px] text-slate-500">{isAr ? "الانضباط" : "Discipline"}</div>
              <div className="font-extrabold text-slate-900 mt-0.5">
                🟨 {safeYc} &nbsp;|&nbsp; 🟥 {safeRc}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 col-span-2">
              <div className="text-[10px] text-slate-500">{isAr ? "الملعب والمصدر الموثّق" : "Stadium & Provenance"}</div>
              <div className="font-bold text-slate-900 mt-0.5 truncate">{club.stadium_ar || "-"}</div>
              <div className="text-[10px] text-slate-500 truncate">{player.source || club.source}</div>
            </div>
          </div>

          {player.live_stats && (player.live_stats.appearances !== null || player.live_stats.goals !== null) && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                <div className="text-[10px] text-slate-500">{isAr ? "المشاركات" : "Apps"}</div>
                <div className="font-extrabold text-emerald-700 text-sm">{player.live_stats.appearances ?? "-"}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                <div className="text-[10px] text-slate-500">{isAr ? "الأهداف" : "Goals"}</div>
                <div className="font-extrabold text-emerald-700 text-sm">{player.live_stats.goals ?? "-"}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                <div className="text-[10px] text-slate-500">{isAr ? "الصناعة" : "Assists"}</div>
                <div className="font-extrabold text-emerald-700 text-sm">{player.live_stats.assists ?? "-"}</div>
              </div>
            </div>
          )}

          {player.admin_note && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-700">
              <span className="font-bold text-slate-500">{isAr ? "ملاحظة الجهاز الإداري: " : "Admin Note: "}</span>
              {player.admin_note}
            </div>
          )}

          {onAskAi && (
            <button
              type="button"
              onClick={() => {
                onAskAi(
                  `حلل الدور التكتيكي والتدريبي الأمثل للاعب #${player.jersey_number} ${displayName} (${player.position}${player.age ? `، ${player.age} سنة` : ""}${player.height_cm ? `، ${player.height_cm} سم` : ""}) في ${club.name_ar} أمام ${isAr ? "الخصم" : "opponent"}`
                );
                onClose();
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold transition shadow-xs"
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
