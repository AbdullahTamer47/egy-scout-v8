"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import type { MathValidationResult } from "@/lib/api";
import GlossaryTooltip from "@/components/GlossaryTooltip";

interface Props {
  lang: "ar" | "en";
  validation: MathValidationResult | null;
}

export default function TacticalMathValidatorCard({ lang, validation }: Props) {
  const isAr = lang === "ar";
  if (!validation) return null;

  const riskStyle =
    validation.risk_level === "high"
      ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
      : validation.risk_level === "medium"
      ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
      : "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";

  return (
    <div className="p-3.5 rounded-xl bg-[#090D16] border border-indigo-500/35 space-y-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-extrabold text-indigo-300">
          <ShieldAlert className="w-4 h-4" />
          <span>{isAr ? "مدقق واقعية الخطة الهندسي" : "Tactical Math Validator"}</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${riskStyle}`}>
          {validation.risk_level === "high"
            ? isAr ? "مخاطرة عالية" : "High Risk"
            : validation.risk_level === "medium"
            ? isAr ? "توازن متوسط" : "Medium Risk"
            : isAr ? "متوازن جداً" : "Low Risk"}
        </span>
      </div>

      {/* 3 Core Geometric Gauges */}
      <div className="grid grid-cols-3 gap-1.5 text-center tabular-nums">
        <div className="p-2 rounded-lg bg-[#111827] border border-white/[0.07]">
          <div className="text-[10px] text-slate-400">{isAr ? "التوازن العام" : "Balance"}</div>
          <div className="text-sm font-black text-white">{validation.overall_balance_score}%</div>
        </div>
        <div className="p-2 rounded-lg bg-[#111827] border border-white/[0.07]">
          <div className="text-[10px] text-slate-400 flex items-center justify-center">
            <GlossaryTooltip term="half_spaces" lang={lang}>
              <span>{isAr ? "الممرات الـ 5" : "5 Corridors"}</span>
            </GlossaryTooltip>
          </div>
          <div className="text-sm font-black text-sky-300">{validation.half_spaces_score}%</div>
        </div>
        <div className="p-2 rounded-lg bg-[#111827] border border-white/[0.07]">
          <div className="text-[10px] text-slate-400 flex items-center justify-center">
            <GlossaryTooltip term="rest_defense" lang={lang}>
              <span>{isAr ? "الدفاع الوقائي" : "Rest-Def"}</span>
            </GlossaryTooltip>
          </div>
          <div
            className={`text-sm font-black ${
              validation.rest_defense_score < 45 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {validation.rest_defense_score}%
          </div>
        </div>
      </div>

      {/* 5 Vertical Corridors Occupation Bar */}
      {validation.corridors.length > 0 && (
        <div className="grid grid-cols-5 gap-1 text-[9.5px] text-center">
          {validation.corridors.map((c) => (
            <div
              key={c.id}
              className={`py-1 px-1 rounded border font-bold ${
                c.status === "empty"
                  ? "bg-rose-500/15 border-rose-500/35 text-rose-300"
                  : c.status === "overload"
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                  : "bg-emerald-500/15 border-emerald-500/35 text-emerald-300"
              }`}
              title={isAr ? c.label_ar : c.label_en}
            >
              <div className="truncate">{isAr ? c.label_ar.split(" ")[0] : c.label_en.split(" ")[0]}</div>
              <div className="text-xs font-black tabular-nums">{c.count}</div>
            </div>
          ))}
        </div>
      )}

      {/* Grounded Strengths & Counter-Attack Exposure */}
      <div className="space-y-1.5 text-[11px]">
        {(isAr ? validation.strengths_ar : validation.strengths_en).slice(0, 2).map((s, i) => (
          <div key={`st-${i}`} className="flex items-start gap-1.5 text-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <span>{s}</span>
          </div>
        ))}
        {(isAr ? validation.vulnerabilities_ar : validation.vulnerabilities_en).slice(0, 2).map((v, i) => (
          <div key={`vl-${i}`} className="flex items-start gap-1.5 text-amber-200">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
            <span>{v}</span>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-white/[0.06] tabular-nums">
        <span>
          {isAr
            ? `طول الكتلة: ${validation.vertical_length_m}م • العرض: ${validation.horizontal_width_m}م`
            : `Length: ${validation.vertical_length_m}m • Width: ${validation.horizontal_width_m}m`}
        </span>
        <span>
          {isAr
            ? `دفاع وقائي: ${validation.rest_defenders_count} | هجوم: ${validation.attacking_players_count}`
            : `Rest-Def: ${validation.rest_defenders_count} | Att: ${validation.attacking_players_count}`}
        </span>
      </div>
    </div>
  );
}
