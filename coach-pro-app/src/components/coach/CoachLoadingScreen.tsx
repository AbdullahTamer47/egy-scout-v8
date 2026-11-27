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
  const mainTitle = title || (isAr ? "جاري تجهيز غرفة القيادة الذكية..." : "Preparing Coach Pro Workspace...");
  const subTitle =
    subtitle ||
    (isAr
      ? "تحميل قائمة اللاعبين الحالية بالصور والتحديث المباشر 2026/27"
      : "Syncing live 2026/27 squad & player profiles");

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className={`coach-light ${
        compact ? "min-h-[320px] rounded-3xl" : "min-h-[100dvh]"
      } bg-gradient-to-br from-[#F7FBFE] via-[#EEF5FA] to-[#E5F4F4] flex flex-col items-center justify-center p-6 text-center`}
    >
      <div className="relative flex flex-col items-center gap-5 max-w-md w-full bg-white/90 backdrop-blur-md border border-[#D8E3EB] rounded-3xl p-8 shadow-xl shadow-slate-900/5">
        <div className="relative flex items-center justify-center">
          <span className="absolute w-20 h-20 rounded-full bg-[#0FB5AE]/20 animate-ping" />
          <span className="relative w-16 h-16 rounded-2xl bg-[#E6F8F7] border border-[#0FB5AE]/40 flex items-center justify-center shadow-sm">
            <BedigitalBrandMark showWordmark={false} />
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#0D717A]">
            EGY-SCOUT Coach Pro · bedigital
          </div>
          <h2 className="text-base font-extrabold text-[#0B1F3A]">{mainTitle}</h2>
          <p className="text-xs font-medium text-[#5C6A7C] leading-relaxed">{subTitle}</p>
        </div>

        <div className="w-full h-2 rounded-full bg-[#E8F1F6] overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#0055FF] via-[#0FB5AE] to-[#0D717A] animate-[pulse_1.1s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}
