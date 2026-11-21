"use client";

import React, { useEffect, useState } from "react";
import {
  AlertOctagon,
  CheckCircle2,
  Crosshair,
  FileUser,
  Flame,
  Play,
  ShieldAlert,
  Target,
  UserCog,
  Wrench,
} from "lucide-react";
import { API_BASE, apiFetch, type ForensicsResponse, type MatchSequence } from "@/lib/api";
import { useScoutStore } from "@/store/useScoutStore";

function SequencePitchDiagram({
  seq,
  k0,
  k1,
}: {
  seq: MatchSequence;
  k0: string;
  k1: string;
}) {
  const pathPts = seq.ball_path_m.map(([x, y]) => `${x},${y}`).join(" ");
  const lastBall = seq.ball_path_m[seq.ball_path_m.length - 1];

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-900/60 bg-[#092416]" dir="ltr">
      <svg viewBox="0 0 105 68" className="w-full h-auto block">
        {/* Pitch lines */}
        <rect x={0.4} y={0.4} width={104.2} height={67.2} fill="none" stroke="rgba(226,232,240,0.38)" strokeWidth={0.45} />
        <line x1={52.5} y1={0} x2={52.5} y2={68} stroke="rgba(226,232,240,0.32)" strokeWidth={0.35} />
        <circle cx={52.5} cy={34} r={9.15} fill="none" stroke="rgba(226,232,240,0.32)" strokeWidth={0.35} />
        <rect x={0} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(226,232,240,0.35)" strokeWidth={0.35} />
        <rect x={88.5} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(226,232,240,0.35)" strokeWidth={0.35} />

        {/* Defensive Gap Breakdown Line */}
        {seq.gap_segment_m && (
          <line
            x1={seq.gap_segment_m[0][0]}
            y1={seq.gap_segment_m[0][1]}
            x2={seq.gap_segment_m[1][0]}
            y2={seq.gap_segment_m[1][1]}
            stroke="#fb7185"
            strokeWidth={1.3}
            strokeDasharray="2 1.2"
          />
        )}

        {/* Ball Attack Trajectory */}
        {seq.ball_path_m.length >= 2 && (
          <polyline
            points={pathPts}
            fill="none"
            stroke="#facc15"
            strokeWidth={1.1}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1.8 1"
          />
        )}

        {/* Key Players */}
        {seq.key_players_m.map((pl, idx) => (
          <circle
            key={idx}
            cx={pl.x_m}
            cy={pl.y_m}
            r={1.9}
            fill={pl.team_id === 0 ? k0 : k1}
            stroke="#050911"
            strokeWidth={0.4}
            opacity={0.92}
          />
        ))}

        {/* Final Threat Ball Position */}
        {lastBall && (
          <g>
            <circle cx={lastBall[0]} cy={lastBall[1]} r={3.6} fill="rgba(250, 204, 21, 0.24)" stroke="#facc15" strokeWidth={0.5} />
            <circle cx={lastBall[0]} cy={lastBall[1]} r={1.6} fill="#facc15" stroke="#000" strokeWidth={0.35} />
          </g>
        )}
      </svg>
    </div>
  );
}

function seqBadge(t: MatchSequence["sequence_type"]) {
  if (t === "goal") return { lbl: "هدف محلّل", cls: "border-amber-400/50 bg-amber-500/20 text-amber-200" };
  if (t === "box_entry") return { lbl: "اختراق الصندوق", cls: "border-emerald-400/50 bg-emerald-500/20 text-emerald-200" };
  if (t === "defensive_breakdown") return { lbl: "انهيار دفاعي", cls: "border-rose-400/50 bg-rose-500/20 text-rose-200" };
  if (t === "dangerous_counter") return { lbl: "اختراق كاسر للخطوط", cls: "border-cyan-400/50 bg-cyan-500/20 text-cyan-200" };
  return { lbl: "لحظة خطيرة", cls: "border-violet-400/50 bg-violet-500/20 text-violet-200" };
}

export default function ForensicsTab() {
  const selectedSlug = useScoutStore((s) => s.selectedSlug);
  const currentMatch = useScoutStore((s) => s.currentMatch);
  const refreshSeq = useScoutStore((s) => s.refreshSeq);
  const replayInStudio = useScoutStore((s) => s.replayInStudio);
  const openVideoDossier = useScoutStore((s) => s.openVideoDossier);
  const setShowLineupModal = useScoutStore((s) => s.setShowLineupModal);

  const [data, setData] = useState<ForensicsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [teamFilter, setTeamFilter] = useState<"all" | "0" | "1">("all");
  const [auditSort, setAuditSort] = useState<"mistakes" | "highlights">("mistakes");

  useEffect(() => {
    if (!selectedSlug || currentMatch?.status !== "ready") {
      setData(null);
      return;
    }
    setLoading(true);
    void apiFetch<ForensicsResponse>(`/api/matches/${selectedSlug}/forensics`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedSlug, currentMatch?.status, refreshSeq]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0b111d] p-10 text-center text-sm text-slate-400">
        جاري تشريح الهجمات الخطيرة وأخطاء ومميزات كل لاعب...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0b111d] p-10 text-center text-sm text-slate-400">
        اختر مباراة جاهزة لعرض تحليل الأهداف والهجمات والأخطاء الفردية.
      </div>
    );
  }

  const k0 = data.team_kits?.["0"]?.ring || "#f43f5e";
  const k1 = data.team_kits?.["1"]?.ring || "#38bdf8";
  const name0 = data.team_names?.["0"] || "فريق 1";
  const name1 = data.team_names?.["1"] || "فريق 2";

  const audits = data.player_audits
    .filter((a) => teamFilter === "all" || String(a.team_id) === teamFilter)
    .sort((a, b) =>
      auditSort === "mistakes"
        ? b.mistakes_count - a.mistakes_count || b.overall_score - a.overall_score
        : b.highlights_count - a.highlights_count || b.overall_score - a.overall_score
    );

  return (
    <div className="space-y-6">
      {/* Executive Forensics Hero Strip */}
      <div className="rounded-2xl border border-rose-500/25 bg-gradient-to-l from-[#0b1220] via-[#0e1526] to-rose-950/20 p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-black text-rose-200">
              <Target className="h-3.5 w-3.5" />
              مختبر تشريح الأهداف والهجمات وأخطاء اللاعبين (Forensics)
            </div>
            <h2 className="text-lg font-black text-white">
              كيف حدثت الخطورة والانهيارات الدفاعية؟ وما مميزات وعيوب كل لاعب بالثانية؟
            </h2>
            <p className="text-xs text-slate-300">
              كل هجمة وكل خطأ دفاعي موثّق بإحداثيات PnLCalib الحقيقية ويمكن تشغيله فوراً بالحركة البطيئة (0.4x) داخل استوديو الـ 3D.
            </p>
          </div>
          <button
            onClick={() => setShowLineupModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3.5 py-2 text-xs font-black text-cyan-200 hover:bg-cyan-500/25 transition"
          >
            <UserCog className="h-4 w-4" />
            تأكيد / تعديل أسماء التشكيلة التلقائية
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-center text-xs tabular-nums">
          <div className="rounded-xl border border-white/[0.07] bg-slate-950/80 p-3">
            <div className="text-slate-400">هجمات واختراقات مشرّحة تلقائياً</div>
            <div className="mt-1 font-mono text-2xl font-black text-amber-300">{data.totals.sequences_count}</div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-slate-950/80 p-3">
            <div className="text-slate-400">أخطاء فردية ودفاعية مرصودة بالثانية</div>
            <div className="mt-1 font-mono text-2xl font-black text-rose-400">{data.totals.total_mistakes_flagged}</div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-slate-950/80 p-3">
            <div className="text-slate-400">مميزات ولقطات إيجابية مثبتة</div>
            <div className="mt-1 font-mono text-2xl font-black text-emerald-300">{data.totals.total_highlights_flagged}</div>
          </div>
        </div>
      </div>

      {/* SECTION A: 3-Stage Goal / Big-Chance / Breakdown Forensics Cards */}
      <div className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <Flame className="h-4 w-4 text-amber-400" />
            تشريح الهجمات الخطيرة ونقاط الانهيار الدفاعي (3 مراحل + رسم مسار الكرة)
          </h3>
          <span className="text-[11px] text-slate-400">
            يمكنك أيضاً تشريح أي هدف عند أي ثانية مباشرة من زر «تحليل هذه اللحظة» في استوديو الفيديو
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {data.sequences.map((seq) => {
            const b = seqBadge(seq.sequence_type);
            return (
              <div
                key={seq.id}
                className="rounded-2xl border border-white/[0.08] bg-[#0b111d] p-4 space-y-4 shadow-xl"
              >
                {/* Sequence Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-black ${b.cls}`}>{b.lbl}</span>
                      <span className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-200">
                        {seq.time_s.toFixed(1)}ث
                      </span>
                      <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-black text-amber-300">
                        xG {seq.xg_estimate} • بُعد {seq.distance_to_goal_m}م
                      </span>
                    </div>
                    <h4 className="text-sm font-black text-white">{seq.title_ar}</h4>
                  </div>

                  <button
                    onClick={() => replayInStudio(seq.start_time_s, { playbackRate: 0.5 })}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400 shadow-lg shadow-emerald-500/20"
                  >
                    <Play className="h-3.5 w-3.5" />
                    إعادة 0.5x بالـ 3D
                  </button>
                </div>

                {/* Diagram + 3-Stage Breakdown */}
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-12 items-start">
                  <div className="md:col-span-5 space-y-1.5">
                    <SequencePitchDiagram seq={seq} k0={k0} k1={k1} />
                    <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
                      <span className="text-amber-300">● مسار الكرة</span>
                      <span className="text-rose-400">--- فجوة الدفاع</span>
                      <span>{seq.blocking_defenders} مدافعين بزاوية المرمى</span>
                    </div>
                  </div>

                  <div className="md:col-span-7 space-y-2 text-xs">
                    {seq.stages.map((st) => (
                      <div key={st.step} className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-2.5">
                        <div className="flex items-center gap-1.5 font-black text-cyan-300 text-[11px]">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500/20 font-mono text-[10px]">
                            {st.step}
                          </span>
                          {st.label_ar}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-200">{st.detail_ar}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Attribution: Heroes vs Responsible Defenders */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-black text-emerald-300 text-[11px]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      صنّاع الخطورة ({seq.attacking_team_name})
                    </div>
                    {seq.attacking_heroes.length === 0 ? (
                      <div className="text-[11px] text-slate-400">هجمة جماعية منظمة</div>
                    ) : (
                      seq.attacking_heroes.map((h, i) => (
                        <button
                          key={i}
                          onClick={() => openVideoDossier(h.identity_key)}
                          className="w-full rounded-lg bg-slate-950/70 p-2 text-right hover:border-emerald-400 border border-transparent transition"
                        >
                          <div className="font-bold text-white">
                            {h.name} <span className="text-[10px] text-emerald-300">({h.role_ar})</span>
                          </div>
                          <div className="text-[10px] text-slate-300">{h.reason_ar}</div>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="rounded-xl border border-rose-500/25 bg-rose-950/15 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-black text-rose-300 text-[11px]">
                      <AlertOctagon className="h-3.5 w-3.5" />
                      المسؤولون عن الخطأ الدفاعي ({seq.defending_team_name})
                    </div>
                    {seq.defensive_faults.length === 0 ? (
                      <div className="text-[11px] text-slate-400">لم يُرصد خطأ فردي مباشر</div>
                    ) : (
                      seq.defensive_faults.map((df, i) => (
                        <button
                          key={i}
                          onClick={() => openVideoDossier(df.identity_key)}
                          className="w-full rounded-lg bg-slate-950/70 p-2 text-right hover:border-rose-400 border border-transparent transition"
                        >
                          <div className="font-bold text-white">
                            {df.name} <span className="text-[10px] text-rose-300">({df.role_ar})</span>
                          </div>
                          <div className="text-[10px] text-slate-300">{df.fault_ar}</div>
                          <div className="mt-0.5 text-[10px] text-amber-300">التصحيح: {df.fix_ar}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION B: Per-Player Strengths, Weaknesses & Timestamped Mistakes Audit Board */}
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-[#0b111d] px-4 py-3 text-xs">
          <div className="flex items-center gap-2 font-black text-sm text-white">
            <ShieldAlert className="h-4 w-4 text-rose-400" />
            تقييم مميزات وعيوب وغلطات كل لاعب (مرتبطة بالثانية داخل الفيديو)
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: "all" as const, lbl: "الكل" },
              { id: "0" as const, lbl: name0 },
              { id: "1" as const, lbl: name1 },
            ].map((b) => (
              <button
                key={b.id}
                onClick={() => setTeamFilter(b.id)}
                className={`rounded-xl px-3 py-1 font-bold ${
                  teamFilter === b.id ? "bg-emerald-500 text-slate-950" : "border border-slate-800 bg-slate-900 text-slate-300"
                }`}
              >
                {b.lbl}
              </button>
            ))}
            <select
              value={auditSort}
              onChange={(e) => setAuditSort(e.target.value as typeof auditSort)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1 font-bold text-slate-200"
            >
              <option value="mistakes">الأكثر أخطاءً للمعالجة</option>
              <option value="highlights">الأكثر تميزاً وإيجابية</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {audits.map((pl) => {
            const tCol = pl.team_id === 0 ? k0 : k1;
            return (
              <div
                key={pl.identity_key}
                className="rounded-2xl border border-white/[0.08] bg-[#0b111d] p-4 space-y-3 shadow-lg"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {pl.portrait_url ? (
                      <img
                        src={`${API_BASE}${pl.portrait_url}`}
                        alt={pl.display_name}
                        className="h-14 w-12 shrink-0 rounded-xl border-2 object-cover bg-slate-900"
                        style={{ borderColor: tCol }}
                      />
                    ) : (
                      <div
                        className="flex h-14 w-12 shrink-0 items-center justify-center rounded-xl border-2 bg-slate-900 font-mono text-xs font-black"
                        style={{ borderColor: tCol }}
                      >
                        {pl.display_jersey ? `#${pl.display_jersey}` : "P"}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-black text-white">{pl.display_name}</span>
                        <span className="rounded bg-slate-900 border border-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                          {pl.inferred_role_ar}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {pl.team_name} • <span className="text-slate-300">{pl.status_label_ar}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="rounded-lg bg-emerald-500/15 border border-emerald-500/35 px-2 py-1 font-mono text-xs font-black text-emerald-300">
                      +{pl.highlights_count}
                    </span>
                    <span className="rounded-lg bg-rose-500/15 border border-rose-500/35 px-2 py-1 font-mono text-xs font-black text-rose-300">
                      -{pl.mistakes_count}
                    </span>
                    <button
                      onClick={() => openVideoDossier(pl.identity_key)}
                      title="فتح البروفايل الكامل"
                      className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                    >
                      <FileUser className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Strengths & Mistakes Lists */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-[11px]">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-2.5 space-y-1.5">
                    <div className="font-black text-emerald-300">المميزات المرصودة ({pl.match_strengths.length})</div>
                    {pl.match_strengths.length === 0 ? (
                      <div className="text-slate-500">أداء متوازن دون طفرات فردية مسجلة</div>
                    ) : (
                      pl.match_strengths.slice(0, 3).map((st, i) => (
                        <div key={i} className="rounded-lg bg-slate-950/75 p-2 space-y-0.5">
                          <div className="flex items-center justify-between gap-1 font-bold text-emerald-100">
                            <span>{st.title_ar}</span>
                            {st.time_s !== null && (
                              <button
                                onClick={() => replayInStudio(Math.max(0, st.time_s! - 1.5), { playbackRate: 0.5, focusIdentity: pl.identity_key })}
                                className="shrink-0 inline-flex items-center gap-0.5 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] text-emerald-200 hover:bg-emerald-500/35"
                              >
                                <Crosshair className="h-2.5 w-2.5" />
                                {st.time_s}ث
                              </button>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">{st.detail_ar}</div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-2.5 space-y-1.5">
                    <div className="font-black text-rose-300">الأخطاء والعيوب ({pl.match_mistakes.length})</div>
                    {pl.match_mistakes.length === 0 ? (
                      <div className="text-emerald-300/80">لا توجد أخطاء دفاعية أو فقدان كرة حرج في العينة</div>
                    ) : (
                      pl.match_mistakes.slice(0, 3).map((mk, i) => (
                        <div key={i} className="rounded-lg bg-slate-950/75 p-2 space-y-0.5">
                          <div className="flex items-center justify-between gap-1 font-bold text-rose-100">
                            <span>{mk.title_ar}</span>
                            {mk.time_s !== null && (
                              <button
                                onClick={() => replayInStudio(Math.max(0, mk.time_s! - 1.5), { playbackRate: 0.5, focusIdentity: pl.identity_key })}
                                className="shrink-0 inline-flex items-center gap-0.5 rounded bg-rose-500/25 px-1.5 py-0.5 font-mono text-[9px] text-rose-100 hover:bg-rose-500/40"
                              >
                                <Play className="h-2.5 w-2.5" />
                                {mk.time_s}ث
                              </button>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">{mk.detail_ar}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Actionable Coaching Drill */}
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-950/15 px-3 py-2 text-[11px] text-amber-100">
                  <Wrench className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
                  <span>
                    <strong className="text-amber-300">التصحيح التدريبي للمدرب:</strong> {pl.coaching_fix_ar}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
