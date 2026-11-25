"use client";

import React from "react";

interface Props {
  lang: "ar" | "en";
  className?: string;
}

export default function EstimateBadge({ lang, className = "" }: Props) {
  const isAr = lang === "ar";
  return (
    <span
      title={
        isAr
          ? "قيمة تقديرية من نموذج رياضي وليست قياساً مباشراً"
          : "Estimated by a mathematical model, not a direct measurement"
      }
      className={`inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[10px] font-semibold cursor-help ${className}`}
    >
      {isAr ? "تقدير" : "Est."}
    </span>
  );
}
