"use client";

import React from "react";
import { HelpCircle } from "lucide-react";

export const TACTICAL_GLOSSARY: Record<string, { ar: string; en: string }> = {
  xg: {
    ar: "xG (الأهداف المتوقعة): احتمالية دخول التسديدة هدفاً من 0 إلى 1 بناءً على زاوية المرمى والمسافة وعدد المدافعين أمام الكرة.",
    en: "xG (Expected Goals): Shot scoring probability (0 to 1) computed from distance, goal angle, and blockers.",
  },
  what_if: {
    ar: "محاكاة الشبح (What-If): تحريك أي لاعب من فريقك أو الخصم لموقع افتراضي وقياس أثر التمركز الجديد على xG والسيطرة فوراً.",
    en: "Ghost What-If: Reposition any player (either team) hypothetically to measure immediate xG & Pitch Control delta.",
  },
  player_pov: {
    ar: "كاميرا عين اللاعب (Player-POV): مشهد ثلاثي الأبعاد من داخل عيني اللاعب المحدد لتعرف ماذا كان يرى فعلياً لحظة القرار.",
    en: "Player-POV: First-person 3D camera from the selected player's eyes to inspect real passing vision.",
  },
  shortlist: {
    ar: "قائمة المختصرين (Shortlist CRM): قائمة متابعة دائمة للاعبين المرشحين للتعاقد أو التصعيد داخل النادي.",
    en: "Shortlist CRM: Persistent recruitment watchlist saved per club tenant.",
  },
  rest_defense: {
    ar: "الدفاع الوقائي (Rest-Defense): عدد وتمركز المدافعين المتبقين خلف الكرة أثناء الهجوم لإيقاف المرتدات فور فقدان الاستحواذ.",
    en: "Rest-Defense: Structure of defenders stationed behind the ball during attack to stop opposition counters.",
  },
  half_spaces: {
    ar: "الممرات النصفية (Half-Spaces): المساحتان الذهبيتان بين العمق والأجنحة، وهما أخطر مناطق صناعة الأهداف في كرة القدم الحديثة.",
    en: "Half-Spaces: The two tactical channels between the wings and center — highest-value creation zones.",
  },
  pre_post_roll: {
    ar: "القص التلقائي (Pre/Post-Roll): يقص تلقائياً مثلاً 4 ثوانٍ قبل الحدث و4 ثوانٍ بعده ليظهر السياق الكامل للقطة في المحاضرة.",
    en: "Pre/Post-Roll: Automatically buffers seconds before & after each tagged moment for full tactical context.",
  },
  sportscode_xml: {
    ar: "تصدير/استيراد XML: الصيغة العالمية المعتمدة لتبادل وسوم المباريات مع Hudl Sportscode و Nacsport.",
    en: "Sportscode XML: Industry-standard timeline interchange format for Hudl Sportscode & Nacsport.",
  },
  keyframe: {
    ar: "تحريك المراحل (Keyframes): سجّل المرحلة 1 ثم حرك اللاعبين وسجّل المرحلة 2 و3 وشغّلها كفيديو تكتيكي متحرك!",
    en: "Keyframe Animation: Capture Phase 1, move players for Phase 2 & 3, then play & export as an animated video.",
  },
};

interface Props {
  term: keyof typeof TACTICAL_GLOSSARY;
  lang: "ar" | "en";
  children?: React.ReactNode;
}

export default function GlossaryTooltip({ term, lang, children }: Props) {
  const entry = TACTICAL_GLOSSARY[term];
  if (!entry) return <>{children}</>;
  const tip = lang === "ar" ? entry.ar : entry.en;
  return (
    <span className="group relative inline-flex items-center gap-1 cursor-help">
      {children}
      <HelpCircle className="w-3 h-3 text-slate-400 group-hover:text-emerald-400 transition shrink-0" />
      <span
        role="tooltip"
        className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute bottom-full start-1/2 -translate-x-1/2 rtl:translate-x-1/2 mb-1.5 z-50 w-64 p-2.5 rounded-xl bg-[#090D16] border border-emerald-500/45 text-[11px] font-normal leading-relaxed text-slate-100 shadow-2xl shadow-black/90 text-start"
      >
        {tip}
      </span>
    </span>
  );
}
