"use client";

import React, { useEffect, useRef } from "react";
import { Check, Minus, Trophy, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  lang: "ar" | "en";
}

interface RowSpec {
  ar: string;
  en: string;
  egy: string;
  egyEn: string;
  once: "yes" | "partial" | "no";
  metrica: "yes" | "partial" | "no";
  hudl: "yes" | "partial" | "no";
  tpad: "yes" | "partial" | "no";
  sky: "yes" | "partial" | "no";
}

const ROWS: RowSpec[] = [
  {
    ar: "استوديو بث 3D متتبع للحركة + عدسة + طمس وجوه",
    en: "Motion-Tracked 3D Telestration + Zoom + Face Blur",
    egy: "مدمج مجاناً",
    egyEn: "Included Free",
    once: "yes",
    metrica: "yes",
    hudl: "yes",
    tpad: "no",
    sky: "yes",
  },
  {
    ar: "عزل الحكام الذكي من بيانات التتبع (Zero Referee Leak)",
    en: "Zero Referee Leak Shield (SigLIP + Spatial)",
    egy: "مبتكر ومفحوص",
    egyEn: "Verified 4-Layer",
    once: "no",
    metrica: "partial",
    hudl: "no",
    tpad: "no",
    sky: "no",
  },
  {
    ar: "توأم رقمي 2D/3D + محاكي What-If الشبح التكتيكي",
    en: "2D/3D Pitch Twin + Ghost Counterfactual What-If",
    egy: "xG + Box Control",
    egyEn: "xG + Box Control",
    once: "no",
    metrica: "partial",
    hudl: "no",
    tpad: "no",
    sky: "partial",
  },
  {
    ar: "ذكاء اصطناعي يرسم 11v11 (مثل ألونسو 3-4-2-1) + xPass %",
    en: "AI 11v11 Plan Generator (Alonso 3-4-2-1) + xPass %",
    egy: "خطوط + تمريرات + OBV",
    egyEn: "Lines + Passes + OBV",
    once: "no",
    metrica: "no",
    hudl: "no",
    tpad: "partial",
    sky: "no",
  },
  {
    ar: "كروت FIFA/Fantasy + كارت مصغّر PNG + تثبيت على الفيديو",
    en: "FIFA Cards + Mini Stamp PNG + Video Pinning",
    egy: "مدمج مع قوائم الأندية",
    egyEn: "Club Squads + PNG",
    once: "no",
    metrica: "no",
    hudl: "partial",
    tpad: "no",
    sky: "partial",
  },
  {
    ar: "بوابة صدق البيانات ومنع التقييم الوهمي للمقاطع القصيرة",
    en: "Honest Sample-Size Gate (Zero Fake Ratings)",
    egy: "تحقق صارم",
    egyEn: "Strict Sample Gate",
    once: "no",
    metrica: "no",
    hudl: "partial",
    tpad: "no",
    sky: "no",
  },
  {
    ar: "واجهة عربية RTL أصلية + تطبيق موبايل + خصوصية محلية 100%",
    en: "Native Arabic RTL + Mobile Optimized + 100% Local Privacy",
    egy: "تشغيل بضغطة واحدة",
    egyEn: "1-Click + Cloud GPU",
    once: "partial",
    metrica: "partial",
    hudl: "partial",
    tpad: "partial",
    sky: "no",
  },
];

function StatusIcon({ state }: { state: "yes" | "partial" | "no" }) {
  if (state === "yes") return <Check className="w-4 h-4 text-emerald-400 mx-auto" aria-label="Full support" />;
  if (state === "partial") return <span className="text-[11px] font-bold text-amber-300">~</span>;
  return <Minus className="w-4 h-4 text-slate-600 mx-auto" aria-label="Not available" />;
}

export default function CompetitorBenchmarkModal({ open, onClose, lang }: Props) {
  const isAr = lang === "ar";
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isAr ? "مقارنة مع أفضل المنصات العالمية" : "Global Platform Comparison"}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-2xl bg-[#0C1220] border border-emerald-500/35 shadow-2xl p-4 sm:p-6 space-y-4 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-white">
                {isAr
                  ? "مقارنة EGY-SCOUT مع أفضل منصات تحليل كرة القدم العالمية"
                  : "EGY-SCOUT Pro Studio vs. Global Football Platforms"}
              </h2>
              <p className="text-[11px] text-slate-400">
                {isAr
                  ? "دمج البث الاحترافي والرسم التكتيكي والتوأم ثلاثي الأبعاد والصدق الإحصائي في منتج واحد للأندية العربية والمحترفة."
                  : "Combining broadcast telestration, AI tactics board, 3D twin simulation, and evidence-first scouting."}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={isAr ? "إغلاق" : "Close"}
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.08] text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full text-xs text-start border-collapse">
            <thead className="bg-[#090D16] text-slate-300">
              <tr className="border-b border-white/[0.08]">
                <th className="p-3 font-bold text-start min-w-[210px]">
                  {isAr ? "القدرة التنافسية" : "Capability"}
                </th>
                <th className="p-3 font-extrabold text-center text-emerald-300 bg-emerald-500/10 border-x border-emerald-500/25">
                  EGY-SCOUT
                </th>
                <th className="p-3 font-semibold text-center">Once Sport</th>
                <th className="p-3 font-semibold text-center">Metrica Nexus</th>
                <th className="p-3 font-semibold text-center">Hudl / Wyscout</th>
                <th className="p-3 font-semibold text-center">TacticalPad</th>
                <th className="p-3 font-semibold text-center">Sky Sports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {ROWS.map((r, i) => (
                <tr key={i} className="hover:bg-white/[0.02]">
                  <td className="p-3 font-semibold text-slate-200">{isAr ? r.ar : r.en}</td>
                  <td className="p-3 text-center bg-emerald-500/10 border-x border-emerald-500/25 text-emerald-300 font-bold">
                    <div className="flex items-center justify-center gap-1">
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>{isAr ? r.egy : r.egyEn}</span>
                    </div>
                  </td>
                  <td className="p-3 text-center"><StatusIcon state={r.once} /></td>
                  <td className="p-3 text-center"><StatusIcon state={r.metrica} /></td>
                  <td className="p-3 text-center"><StatusIcon state={r.hudl} /></td>
                  <td className="p-3 text-center"><StatusIcon state={r.tpad} /></td>
                  <td className="p-3 text-center"><StatusIcon state={r.sky} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>
            {isAr
              ? "ملاحظة شفافية: يتميز Once Sport وHudl بمكتبات فيديو فرق موسعة وبيانات رسمية عبر مواسم كاملة، بينما يركّز EGY-SCOUT على الخصوصية المحلية والصدق الإحصائي والعربية الكاملة والذكاء الهجين."
              : "Transparency note: Enterprise platforms hold multi-league broadcast archives; EGY-SCOUT excels in local club privacy, honest sample gates, native RTL Arabic UX, and integrated AI tactics."}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold"
          >
            {isAr ? "إغلاق" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
