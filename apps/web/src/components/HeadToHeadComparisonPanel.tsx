"use client";

import React, { useEffect, useState } from "react";
import { ArrowUpRight, ExternalLink, Play, Share2, ShieldAlert, TrendingUp, Users } from "lucide-react";
import {
  API_BASE,
  apiFetch,
  HeadToHeadComparisonPayload,
  MultiMatchTrendsPayload,
  ScoutingPlayer,
  UserRole,
} from "@/lib/api";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
  matchPlayers: ScoutingPlayer[];
  benchmarkPlayers: ScoutingPlayer[];
  onJumpToClip?: (startSec: number) => void;
}

const H2H_COLORS = ["#10B981", "#38BDF8", "#F59E0B", "#F472B6"];

const H2H_AXES = [
  { key: "attack_impact", ar: "الأثر الهجومي", en: "Attack" },
  { key: "progression_xt", ar: "التقدم xT", en: "Progression" },
  { key: "defensive_work", ar: "الدفاع PAdj", en: "Defense" },
  { key: "physical_hir", ar: "البدني HIR", en: "Physical" },
  { key: "tactical_discipline", ar: "الانضباط", en: "Discipline" },
] as const;

export default function HeadToHeadComparisonPanel({
  lang,
  matchId,
  role,
  matchPlayers,
  benchmarkPlayers,
  onJumpToClip,
}: Props) {
  const isAr = lang === "ar";
  const [includeBenchmark, setIncludeBenchmark] = useState<boolean>(false);
  const pool = includeBenchmark ? [...matchPlayers, ...benchmarkPlayers] : matchPlayers;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [h2h, setH2h] = useState<HeadToHeadComparisonPayload | null>(null);
  const [trends, setTrends] = useState<MultiMatchTrendsPayload | null>(null);
  const [shareUrl, setShareUrl] = useState<{ player: string; url: string } | null>(null);

  useEffect(() => {
    setSelectedIds(matchPlayers.slice(0, 2).map((p) => p.player_id));
  }, [matchId, matchPlayers]);

  useEffect(() => {
    if (selectedIds.length < 2) return;
    let alive = true;
    const qs = new URLSearchParams({
      match_id: matchId,
      player_ids: selectedIds.join(","),
      include_external_benchmark: String(includeBenchmark),
    });
    apiFetch<HeadToHeadComparisonPayload>(`/api/scouting/compare?${qs.toString()}`, {}, "club_demo_egypt", role)
      .then((res) => {
        if (alive) setH2h(res);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [matchId, selectedIds, includeBenchmark, role]);

  useEffect(() => {
    let alive = true;
    apiFetch<MultiMatchTrendsPayload>("/api/scouting/multi-match-trends", {}, "club_demo_egypt", role)
      .then((res) => {
        if (alive) setTrends(res);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [role]);

  const togglePlayer = (pid: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(pid)) {
        return prev.length > 2 ? prev.filter((id) => id !== pid) : prev;
      }
      if (prev.length >= 4) return [...prev.slice(1), pid];
      return [...prev, pid];
    });
  };

  const generateMobileShareLink = async (p: HeadToHeadComparisonPayload["players"][number]) => {
    try {
      const res = await apiFetch<{ share_url: string; player_name: string }>(
        "/api/share/player",
        {
          method: "POST",
          body: JSON.stringify({
            match_id: matchId,
            player_name: p.display_name,
            position: p.position,
            rating_10: p.rating_10,
            strengths_ar: [
              `أعلى سرعة مسجلة: ${p.metrics.max_speed_kmh} كم/س`,
              `الانضباط التكتيكي: ${p.metrics.discipline}/100`,
            ],
            focus_points_ar: [
              "مراجعة قرارات التمرير تحت الضغط في الثلث الأخير",
              "تأمين التغطية الوقائية فور فقدان الكرة",
            ],
            clips: p.evidence_clips,
          }),
        },
        "club_demo_egypt",
        role
      );
      setShareUrl({ player: res.player_name, url: `${API_BASE}${res.share_url}` });
    } catch {}
  };

  // Pentagon Radar SVG
  const cx = 135;
  const cy = 135;
  const r = 92;
  const pt = (idx: number, ratio: number) => {
    const ang = (Math.PI * 2 * idx) / H2H_AXES.length - Math.PI / 2;
    return [cx + Math.cos(ang) * r * ratio, cy + Math.sin(ang) * r * ratio];
  };

  return (
    <div className="space-y-4">
      {/* 1. Head-to-Head Player Comparison (2-4 Players + Dual Radar + Evidence Video Clips + Mobile Share!) */}
      <div className="studio-panel p-4 space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-extrabold text-white">
              {isAr ? "مقارنة لاعب بلاعب وجهاً لوجه (Head-to-Head — 2 إلى 4 لاعبين)" : "Head-to-Head Fair Player Comparison (2–4 Players)"}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#090D16] border border-white/10 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeBenchmark}
                onChange={(e) => setIncludeBenchmark(e.target.checked)}
                className="accent-emerald-500"
              />
              <span>
                {isAr
                  ? "إضافة مرجع عالمي (StatsBomb) للمقارنة الاسترشادية فقط"
                  : "Include StatsBomb external reference"}
              </span>
            </label>
          </div>
        </div>

        {/* Selectable Player Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {pool.slice(0, 12).map((p) => {
            const idx = selectedIds.indexOf(p.player_id);
            const active = idx !== -1;
            return (
              <button
                key={p.player_id}
                type="button"
                onClick={() => togglePlayer(p.player_id)}
                className={`px-2.5 py-1 rounded-lg border font-bold transition flex items-center gap-1.5 ${
                  active
                    ? "bg-white/10 text-white"
                    : "bg-[#090D16] border-white/[0.08] text-slate-400 hover:text-white"
                }`}
                style={active ? { borderColor: H2H_COLORS[idx % H2H_COLORS.length] } : undefined}
              >
                {active && (
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: H2H_COLORS[idx % H2H_COLORS.length] }}
                  />
                )}
                <span>{p.display_name}</span>
                <span className="text-[10px] text-slate-400">({p.position})</span>
              </button>
            );
          })}
        </div>

        {h2h && h2h.players.length >= 2 && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            {/* Multi-Player Overlay Radar */}
            <div className="lg:col-span-4 bg-[#090D16] border border-white/[0.07] rounded-xl p-3">
              <svg viewBox="0 0 270 270" className="w-full max-w-[260px] mx-auto">
                {[0.25, 0.5, 0.75, 1].map((lvl) => (
                  <polygon
                    key={lvl}
                    points={H2H_AXES.map((_, i) => pt(i, lvl).join(",")).join(" ")}
                    fill="none"
                    stroke="rgba(255,255,255,0.09)"
                    strokeWidth="1"
                  />
                ))}
                {H2H_AXES.map((ax, i) => {
                  const [x, y] = pt(i, 1.18);
                  const [ex, ey] = pt(i, 1);
                  return (
                    <g key={ax.key}>
                      <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="rgba(255,255,255,0.08)" />
                      <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#CBD5E1" fontSize="9.5" fontWeight="700">
                        {isAr ? ax.ar : ax.en}
                      </text>
                    </g>
                  );
                })}
                {h2h.players.map((p, pIdx) => {
                  const col = H2H_COLORS[pIdx % H2H_COLORS.length];
                  const poly = H2H_AXES.map((ax, i) => pt(i, (p.radar[ax.key] || 20) / 100).join(",")).join(" ");
                  return (
                    <polygon
                      key={p.player_id}
                      points={poly}
                      fill={col}
                      fillOpacity={0.18}
                      stroke={col}
                      strokeWidth="2.2"
                    />
                  );
                })}
              </svg>
            </div>

            {/* Side-by-Side Comparison Cards with Video Jump & Mobile Share */}
            <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {h2h.players.map((p, pIdx) => {
                const col = H2H_COLORS[pIdx % H2H_COLORS.length];
                return (
                  <div
                    key={p.player_id}
                    className="p-3 rounded-xl bg-[#090D16] border space-y-2"
                    style={{ borderColor: `${col}66` }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-extrabold text-white flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col }} />
                          <span>{p.display_name}</span>
                        </div>
                        <div className="text-[10.5px] text-slate-400">
                          {p.team_name} • {p.position} • {p.minutes_analyzed} {isAr ? "دقيقة" : "min"}
                        </div>
                      </div>
                      <span
                        className="px-2 py-0.5 rounded-lg font-black text-slate-950 text-xs tabular-nums"
                        style={{ backgroundColor: col }}
                      >
                        {p.rating_10 !== null ? `${p.rating_10}/10` : "Clip"}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-center tabular-nums text-[10.5px]">
                      <div className="p-1.5 rounded bg-[#111827]">
                        <div className="text-slate-400">VAEP/90</div>
                        <div className="font-bold text-white">{p.metrics.vaep_per90 ?? "—"}</div>
                      </div>
                      <div className="p-1.5 rounded bg-[#111827]">
                        <div className="text-slate-400">xT/90</div>
                        <div className="font-bold text-white">{p.metrics.xt_per90 ?? "—"}</div>
                      </div>
                      <div className="p-1.5 rounded bg-[#111827]">
                        <div className="text-slate-400">{isAr ? "انضباط" : "Disc"}</div>
                        <div className="font-bold text-emerald-300">{p.metrics.discipline}</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 border-t border-white/[0.06]">
                      {p.evidence_clips[0] && onJumpToClip ? (
                        <button
                          type="button"
                          onClick={() => onJumpToClip(p.evidence_clips[0].start_s)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-300 text-[10.5px] font-bold"
                        >
                          <Play className="w-3 h-3" />
                          <span>{isAr ? "شاهد لقطة الإثبات" : "Watch Clip"}</span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500">{p.archetype_ar}</span>
                      )}

                      <button
                        type="button"
                        onClick={() => generateMobileShareLink(p)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-300 text-[10.5px] font-bold"
                      >
                        <Share2 className="w-3 h-3" />
                        <span>{isAr ? "إرسال للاعب" : "Share to Player"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {shareUrl && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-emerald-200 font-bold">
              {isAr ? `تم إنشاء بوابة الموبايل المحمية للاعب ${shareUrl.player} (بدون ملاحظات الإدارة الداخلية):` : `Protected mobile portal ready for ${shareUrl.player}:`}
            </span>
            <a
              href={shareUrl.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 font-extrabold"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{isAr ? "افتح صفحة اللاعب الآن" : "Open Player Portal"}</span>
            </a>
          </div>
        )}
      </div>

      {/* 2. V9.0 Multi-Match Progression & Multi-Match Opponent Scouting */}
      {trends && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          {/* Player Multi-Match Progression */}
          <div className="studio-panel p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-extrabold text-white">
                  {isAr ? "تطور اللاعبين عبر عدة مباريات (Multi-Match Progression)" : "Multi-Match Player Progression"}
                </h3>
              </div>
              <span className="text-[10.5px] px-2 py-0.5 rounded bg-white/[0.06] text-slate-300 tabular-nums">
                {trends.total_matches_in_archive} {isAr ? "مباريات بالأرشيف" : "Archived Matches"}
              </span>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pe-1">
              {trends.player_progression.slice(0, 6).map((pp) => (
                <div key={pp.player_name} className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.07] space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white">{pp.player_name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                      {pp.sample_warning_ar}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[10.5px] tabular-nums">
                    {pp.series.map((pt, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-[#111827] border border-white/[0.06] text-slate-300">
                        {pt.match_title_ar.slice(0, 18)}: <b className="text-emerald-300">{pt.max_speed_kmh} km/h</b> •{" "}
                        {isAr ? "انضباط" : "Disc"} {pt.discipline}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Multi-Match Opponent Scouting & Coach Focus Sheet */}
          <div className="studio-panel p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-extrabold text-white">
                {isAr ? "تجميع أنماط الخصوم عبر المباريات (Multi-Match Opponent Scouting)" : "Multi-Match Opponent Scouting"}
              </h3>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pe-1">
              {trends.opponent_scouting.map((op) => (
                <div key={op.opponent_name} className="p-3 rounded-xl bg-[#090D16] border border-amber-500/25 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-extrabold text-white flex items-center gap-1.5">
                      <ArrowUpRight className="w-3.5 h-3.5 text-amber-400" />
                      {op.opponent_name}
                    </span>
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      {op.matches_analyzed} {isAr ? "مباراة" : "matches"} • {op.total_observed_s}s •{" "}
                      <span className="text-amber-300">{op.sample_warning_ar}</span>
                    </span>
                  </div>
                  <div className="text-[11px] text-rose-300">
                    <b>{isAr ? "الثغرات المتكررة:" : "Recurring Vulnerabilities:"}</b>{" "}
                    {op.recurring_vulnerabilities_ar.join(" • ") || (isAr ? "لا توجد ثغرة حرجة مسجلة" : "None")}
                  </div>
                  <div className="text-[11px] text-emerald-300">
                    <b>{isAr ? "نقاط تركيز المدرب قبل اللقاء:" : "Pre-Match Coach Focus:"}</b>{" "}
                    {op.coach_focus_points_ar.join(" • ") || (isAr ? "استغلال الممرات النصفية والضغط العكسي" : "Attack half-spaces")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
