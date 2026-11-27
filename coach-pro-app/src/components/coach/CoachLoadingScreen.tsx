"use client";

import React from "react";
import BedigitalBrandMark from "./BedigitalBrandMark";

interface Props {
  lang?: "ar" | "en";
  title?: string;
  subtitle?: string;
  compact?: boolean;
}

export default function CoachLoadingScreen({
  lang = "ar",
  title,
  subtitle,
  compact = false,
}: Props) {
  const isAr = lang === "ar";
  const mainTitle = title || (isAr ? "جاري تحميل بيانات الفريق..." : "Loading team workspace...");
  const subTitle =
    subtitle ||
    (isAr
      ? "تجهيز القائمة الحالية والتشكيل والجدول المباشر 2026/27"
      : "Syncing live 2026/27 squad & formation");

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className={`coach-light ${
        compact ? "min-h-[280px] rounded-xl" : "min-h-[100dvh]"
      } bg-[#F5F6F8] flex flex-col items-center justify-center p-5 text-center`}
    >
      <div className="flex flex-col items-center gap-4 max-w-sm w-full bg-white border border-slate-200 rounded-xl p-7 shadow-xs">
        <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
          <BedigitalBrandMark showWordmark={false} />
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            EGY-SCOUT Coach Pro · bedigital
          </div>
          <h2 className="text-sm sm:text-base font-extrabold text-slate-900">{mainTitle}</h2>
          <p className="text-xs text-slate-500 leading-relaxed">{subTitle}</p>
        </div>

        <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full w-2/5 rounded-full bg-[#15803D] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
