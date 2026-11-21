"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Dumbbell,
  Flame,
  Layers,
  Printer,
  Shield,
  Target,
  Wrench,
} from "lucide-react";
import { useTacticalStore } from "@/store/useTacticalStore";

export default function TacticalDoctorPanel() {
  const currentMatch = useTacticalStore((s) => s.currentMatch);
  const [reportTeam, setReportTeam] = useState<"0" | "1">("0");

  if (!currentMatch) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-8 text-center text-slate-400">
        اختر مباراة جاهزة من استوديو التحليل لعرض تقرير المدير الفني وتشخيص الكرة المصرية.
      </div>
    );
  }

  const doc = currentMatch.summary?.egyptian_doctor;
  if (!doc) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-8 text-center text-slate-400">
        لم يتم استخراج بيانات التشخيص التكتيكي لهذه المباراة بعد.
      </div>
    );
  }

  const homeName = currentMatch.home_team_name || "فريق 1 (ذهبي)";
  const awayName = currentMatch.away_team_name || "فريق 2 (أزرق)";
  const playerMap = new Map((currentMatch.players || []).map((p) => [p.identity_key, p.player_name]));
  const nameOf = (ident: string) => playerMap.get(ident) || ident;

  const sb = doc.second_ball_win_rate || { team_0_pct: 50, team_1_pct: 50, contested_zones: [] };
  const lb0 = doc.low_block_breaker?.["0"];
  const lb1 = doc.low_block_breaker?.["1"];
  const activeReport = currentMatch.summary?.coach_report?.[reportTeam];

  return (
    <div className="space-y-5">
      {/* Top Action Header with Print / PDF Report Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800/80 bg-[#0d1420] px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-emerald-400" />
          <div>
            <h2 className="text-sm font-bold text-slate-100">غرفة قرارات المدير الفني ومحلل الأداء (V4 Pro)</h2>
            <p className="text-[11px] text-slate-400">
              {homeName} ضد {awayName} • {currentMatch.title}
            </p>
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/25 print:hidden"
        >
          <Printer className="h-4 w-4" />
          طباعة / حفظ تقرير المدرب PDF
        </button>
      </div>

      {/* Head Coach Automated SWOT + Adjustments + Weekly Drills */}
      {activeReport && (
        <div className="rounded-2xl border border-emerald-500/25 bg-[#0d1420] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-emerald-300">خطة المدير الفني وتعديلات ما بين الشوطين وتدريبات الأسبوع</h3>
            <div className="flex gap-1.5 print:hidden">
              <button
                onClick={() => setReportTeam("0")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  reportTeam === "0" ? "bg-amber-500 text-slate-950" : "border border-slate-700 text-amber-300"
                }`}
              >
                {homeName}
              </button>
              <button
                onClick={() => setReportTeam("1")}
                className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                  reportTeam === "1" ? "bg-sky-500 text-slate-950" : "border border-slate-700 text-sky-300"
                }`}
              >
                {awayName}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                نقاط القوة الفنية
              </div>
              <ul className="space-y-1.5 text-slate-200 list-disc list-inside leading-relaxed">
                {activeReport.strengths_ar.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-rose-300">
                <AlertTriangle className="h-4 w-4" />
                الثغرات ونقاط الضعف
              </div>
              <ul className="space-y-1.5 text-slate-200 list-disc list-inside leading-relaxed">
                {activeReport.weaknesses_ar.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <Wrench className="h-4 w-4" />
                التعديلات الفورية (بين الشوطين)
              </div>
              <ul className="space-y-1.5 text-slate-200 list-disc list-inside leading-relaxed">
                {activeReport.in_game_adjustments_ar.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Suggested Weekly Training Drills */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
              <Dumbbell className="h-4 w-4" />
              البرنامج التدريبي المقترح للأسبوع القادم بناءً على أرقام المباراة:
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {activeReport.weekly_drills_ar.map((dr, idx) => (
                <div key={idx} className="rounded-xl border border-cyan-500/25 bg-slate-950/70 p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-100">{dr.title}</span>
                    <span className="shrink-0 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                      {dr.duration_min} دقيقة • {dr.target_group}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{dr.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Coach Action Recommendations Banner */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-l from-emerald-950/40 to-[#0d1420] p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
          <Target className="h-4 w-4" />
          تشخيص وحدة الكرة المصرية الفوري
        </div>
        <ul className="space-y-1.5 text-xs text-slate-200 list-disc list-inside">
          {(doc.recommendations_ar || []).map((rec, i) => (
            <li key={i}>{rec}</li>
          ))}
        </ul>
      </div>

      {/* 4 Core Chronic Egyptian Football Indicators */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 1. Tempo & Effective Play Time */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 font-bold text-sm text-cyan-300">
              <Clock className="h-4 w-4" />
              مؤشر الرتم والوقت الفعلي للعب
            </div>
            <span className="font-mono text-xs text-slate-400">معالجة بطء الرتم</span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-[11px] text-slate-400">الوقت الفعلي للعب</div>
              <div className="mt-1 text-xl font-black text-emerald-400 tabular-nums">
                {doc.effective_play_time_pct}%
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-[11px] text-slate-400">رتم التمريرات</div>
              <div className="mt-1 text-xl font-black text-cyan-300 tabular-nums">
                {doc.pass_tempo_per_min}/د
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="text-[11px] text-slate-400">الاحتفاظ بالكرة</div>
              <div className={`mt-1 text-xl font-black tabular-nums ${doc.avg_time_on_ball_sec > 2.3 ? "text-amber-400" : "text-slate-100"}`}>
                {doc.avg_time_on_ball_sec}ث
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-300">
              لاعبون يبطئون رتم اللعب (احتفاظ &gt; 2.4 ثانية):
            </div>
            {doc.slow_releasers?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {doc.slow_releasers.map((sr, i) => (
                  <span
                    key={i}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200"
                  >
                    {nameOf(sr.identity_key)} • <strong className="font-mono">{sr.avg_hold_sec}ث</strong>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-emerald-400">ممتاز: سرعة تحرير الكرة مثالية ولا يوجد احتفاظ مفرط يتجاوز 2.4 ثانية.</p>
            )}
          </div>
        </div>

        {/* 2. Second-Ball Win Rate & 8m Recovery Map */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 font-bold text-sm text-amber-300">
              <Flame className="h-4 w-4" />
              خريطة الكرة الثانية (نطاق الالتحام 8م)
            </div>
            <span className="font-mono text-xs text-slate-400">{sb.contested_zones?.length || 0} صراع مسجل</span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="flex-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-center">
              <div className="text-slate-300 truncate">{homeName}</div>
              <div className="mt-1 text-lg font-black text-amber-300 tabular-nums">{sb.team_0_pct}%</div>
            </div>
            <div className="flex-1 rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 text-center">
              <div className="text-slate-300 truncate">{awayName}</div>
              <div className="mt-1 text-lg font-black text-sky-300 tabular-nums">{sb.team_1_pct}%</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-emerald-900/50 bg-[#0b2919]" dir="ltr">
            <svg viewBox="0 0 105 68" className="w-full h-36">
              <rect x={0.5} y={0.5} width={104} height={67} fill="none" stroke="rgba(226,232,240,0.25)" strokeWidth={0.5} />
              <line x1={52.5} y1={0} x2={52.5} y2={68} stroke="rgba(226,232,240,0.25)" strokeWidth={0.5} />
              {(sb.contested_zones || []).map((z, idx) => (
                <g key={idx}>
                  <circle
                    cx={z.x_m}
                    cy={z.y_m}
                    r={4}
                    fill={z.team_cluster === 0 ? "rgba(245, 158, 11, 0.18)" : "rgba(56, 189, 248, 0.18)"}
                  />
                  <circle
                    cx={z.x_m}
                    cy={z.y_m}
                    r={1.4}
                    fill={z.team_cluster === 0 ? "#f59e0b" : "#38bdf8"}
                  />
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* 3. Fatigue Drop-off Alert (>18%) */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 font-bold text-sm text-rose-300">
              <AlertTriangle className="h-4 w-4" />
              إنذار الإجهاد البدني وهبوط الارتداد (&gt;18%)
            </div>
            <span className="font-mono text-xs text-rose-400">
              متوسط الهبوط: {doc.fatigue_dropoff_index}%
            </span>
          </div>

          {doc.fatigue_alerts?.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {doc.fatigue_alerts.map((al, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-bold text-rose-200">{nameOf(al.identity_key)}</span>
                    <span className="mr-2 text-[11px] text-slate-400">
                      ({al.team_cluster === 0 ? homeName.split(" ")[0] : awayName.split(" ")[0]})
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-200">
                    {al.early_kmh} ➔ {al.late_kmh} كم/س{" "}
                    <span className="mr-1 font-bold text-rose-400">(-{al.drop_pct}%)</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-300">
              مستوى الثبات البدني جيد: لم يتجاوز أي لاعب حاجز هبوط السرعة الارتدادية بنسبة 18%.
            </div>
          )}
        </div>

        {/* 4. Low-Block Breaker (Low/Mid/High Block + Half-Spaces) */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
              <Layers className="h-4 w-4" />
              كاشف التكتلات الدفاعية وأنصاف المساحات (Low / Mid / High Block)
            </div>
            <Shield className="h-4 w-4 text-slate-400" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { title: `هجوم ${homeName.split(" ")[0]} ضد ${awayName.split(" ")[0]}`, data: lb0, accent: "text-amber-300" },
              { title: `هجوم ${awayName.split(" ")[0]} ضد ${homeName.split(" ")[0]}`, data: lb1, accent: "text-sky-300" },
            ].map((item, idx) => (
              <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2 text-xs">
                <div className={`font-bold ${item.accent}`}>{item.title}</div>

                {/* Defensive block height split */}
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-900 p-1.5 text-center text-[10px]">
                  <div>
                    <span className="text-slate-400 block">منخفض</span>
                    <strong className="font-mono text-rose-300">{item.data?.opp_low_block_pct ?? 0}%</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">متوسط</span>
                    <strong className="font-mono text-amber-300">{item.data?.opp_mid_block_pct ?? 0}%</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">ضغط عالي</span>
                    <strong className="font-mono text-emerald-300">{item.data?.opp_high_press_pct ?? 0}%</strong>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-300">
                      <span>نصف المساحة الأيسر</span>
                      <span className="font-mono">{item.data?.left_half_space_open_pct ?? 0}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-slate-800">
                      <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${item.data?.left_half_space_open_pct ?? 0}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-300">
                      <span>العمق المركزي (Z14)</span>
                      <span className="font-mono">{item.data?.central_open_pct ?? 0}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-slate-800">
                      <div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${item.data?.central_open_pct ?? 0}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-300">
                      <span>نصف المساحة الأيمن</span>
                      <span className="font-mono">{item.data?.right_half_space_open_pct ?? 0}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-slate-800">
                      <div className="h-1.5 rounded-full bg-cyan-400" style={{ width: `${item.data?.right_half_space_open_pct ?? 0}%` }} />
                    </div>
                  </div>
                </div>
                <div className="rounded bg-slate-900 px-2 py-1.5 text-[11px] text-emerald-300">
                  {item.data?.recommended_overload_ar}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
