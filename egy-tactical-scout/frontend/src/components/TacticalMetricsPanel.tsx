"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, Building2, Check, Loader2, ShieldCheck, Sparkles, Users } from "lucide-react";
import { type ClubOption, type MatchDetail, apiFetch } from "@/lib/api";
import { useTacticalStore } from "@/store/useTacticalStore";

export default function TacticalMetricsPanel() {
  const currentMatch = useTacticalStore((s) => s.currentMatch);
  const setCurrentMatch = useTacticalStore((s) => s.setCurrentMatch);
  const selectedIdentity = useTacticalStore((s) => s.selectedIdentity);
  const setSelectedIdentity = useTacticalStore((s) => s.setSelectedIdentity);

  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [homeClubId, setHomeClubId] = useState<number | "">(currentMatch?.home_club_id ?? "");
  const [awayClubId, setAwayClubId] = useState<number | "">(currentMatch?.away_club_id ?? "");
  const [savingClubs, setSavingClubs] = useState(false);
  const [teamFilter, setTeamFilter] = useState<"all" | 0 | 1>("all");

  useEffect(() => {
    setHomeClubId(currentMatch?.home_club_id ?? "");
    setAwayClubId(currentMatch?.away_club_id ?? "");
  }, [currentMatch?.id, currentMatch?.home_club_id, currentMatch?.away_club_id]);

  useEffect(() => {
    void apiFetch<ClubOption[]>("/api/clubs").then(setClubs).catch(() => {});
  }, []);

  if (!currentMatch) return null;

  const t0 = currentMatch.summary?.teams?.["0"];
  const t1 = currentMatch.summary?.teams?.["1"];
  const pm0 = currentMatch.summary?.pro_coach_metrics?.["0"];
  const pm1 = currentMatch.summary?.pro_coach_metrics?.["1"];
  const players = currentMatch.players || [];

  const filteredPlayers = teamFilter === "all" ? players : players.filter((p) => p.team_cluster === teamFilter);
  const team0Count = players.filter((p) => p.team_cluster === 0).length;
  const team1Count = players.filter((p) => p.team_cluster === 1).length;

  const homeName = currentMatch.home_team_name || "الفريق 1 (ذهبي)";
  const awayName = currentMatch.away_team_name || "الفريق 2 (أزرق)";

  const handleSaveClubs = async () => {
    setSavingClubs(true);
    try {
      const updated = await apiFetch<MatchDetail>(`/api/matches/${currentMatch.id}/clubs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          home_club_id: homeClubId === "" ? null : Number(homeClubId),
          away_club_id: awayClubId === "" ? null : Number(awayClubId),
        }),
      });
      setCurrentMatch(updated);
    } finally {
      setSavingClubs(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Real Egyptian Club Assignment & Match KPI Strip */}
      <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100">ربط أندية المباراة وتقارير المدير الفني الاحترافية (V4 Pro)</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={homeClubId}
              onChange={(e) => setHomeClubId(e.target.value ? Number(e.target.value) : "")}
              className="rounded-lg border border-amber-500/30 bg-slate-950 px-2.5 py-1.5 text-xs text-amber-200 focus:border-amber-400 focus:outline-none"
            >
              <option value="">فريق 1: اختيار نادي...</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="text-slate-500 font-bold">VS</span>
            <select
              value={awayClubId}
              onChange={(e) => setAwayClubId(e.target.value ? Number(e.target.value) : "")}
              className="rounded-lg border border-sky-500/30 bg-slate-950 px-2.5 py-1.5 text-xs text-sky-200 focus:border-sky-400 focus:outline-none"
            >
              <option value="">فريق 2: اختيار نادي...</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleSaveClubs}
              disabled={savingClubs}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {savingClubs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              ربط وتحديث التشكيل
            </button>
          </div>
        </div>

        {/* Pro Coach KPI Comparison Grid (xG, xT, PPDA, Field Tilt, Def Line, Pass Acc, Line Breaking) */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7 text-center text-xs">
          {[
            { label: "الأهداف المتوقعة xG", v0: pm0?.xg_estimated?.toFixed(2) ?? "-", v1: pm1?.xg_estimated?.toFixed(2) ?? "-" },
            { label: "الخطورة التراكمية xT", v0: pm0?.xt_total?.toFixed(2) ?? "-", v1: pm1?.xt_total?.toFixed(2) ?? "-" },
            { label: "شدة الضغط PPDA", v0: pm0?.ppda?.toFixed(1) ?? "-", v1: pm1?.ppda?.toFixed(1) ?? "-" },
            { label: "هيمنة الثلث الأخير Tilt", v0: pm0 ? `${pm0.field_tilt_pct}%` : "-", v1: pm1 ? `${pm1.field_tilt_pct}%` : "-" },
            { label: "عمق خط الدفاع", v0: pm0 ? `${pm0.avg_def_line_height_m}م` : "-", v1: pm1 ? `${pm1.avg_def_line_height_m}م` : "-" },
            { label: "دقة التمرير", v0: pm0 ? `${pm0.pass_accuracy_pct}%` : "-", v1: pm1 ? `${pm1.pass_accuracy_pct}%` : "-" },
            { label: "تمريرات كسر الخطوط", v0: String(pm0?.line_breaking_passes ?? "-"), v1: String(pm1?.line_breaking_passes ?? "-") },
          ].map((kpi, idx) => (
            <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
              <div className="text-[10px] text-slate-400 truncate">{kpi.label}</div>
              <div className="mt-1.5 flex items-center justify-center gap-2 font-mono text-xs font-bold tabular-nums">
                <span className="text-amber-400">{kpi.v0}</span>
                <span className="text-slate-600">:</span>
                <span className="text-sky-400">{kpi.v1}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Team Morphing Formations & Fluidity vs Discipline */}
        <div className="lg:col-span-5 space-y-3 rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-100">تحول التشكيل والانضباط مقابل المرونة</h3>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: homeName, data: t0, color: "text-amber-400", border: "border-amber-500/30" },
              { label: awayName, data: t1, color: "text-sky-400", border: "border-sky-500/30" },
            ].map((tm, i) => (
              <div key={i} className={`rounded-xl border ${tm.border} bg-slate-950/60 p-3 space-y-2`}>
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-xs font-bold truncate ${tm.color}`}>{tm.label}</span>
                  <span className="tabular-nums text-xs font-semibold text-slate-200 shrink-0">
                    {tm.data?.possession_pct ?? 50}%
                  </span>
                </div>

                <div className="rounded-lg bg-slate-900/90 p-2 text-[11px] space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">بدون كرة (دفاع):</span>
                    <span className="font-mono font-bold text-slate-100">{tm.data?.out_of_possession_formation || "---"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">بالكرة (بناء):</span>
                    <span className="font-mono font-bold text-emerald-300">{tm.data?.in_possession_formation || "---"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">العرض / الطول:</span>
                    <span className="font-mono text-slate-200">
                      {tm.data?.team_width_m ?? 0}م × {tm.data?.team_length_m ?? 0}م
                    </span>
                  </div>
                </div>

                {/* Fluidity vs Discipline */}
                <div className="space-y-1.5 text-[11px]">
                  <div>
                    <div className="flex justify-between text-slate-300">
                      <span>المرونة واللامركزية</span>
                      <span className="tabular-nums font-bold text-cyan-300">{tm.data?.fluidity_score ?? 60}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 w-full rounded-full bg-slate-800">
                      <div
                        className="h-1.5 rounded-full bg-cyan-400"
                        style={{ width: `${Math.min(100, tm.data?.fluidity_score ?? 60)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-slate-300">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3 text-emerald-400" />
                        الالتزام التكتيكي
                      </span>
                      <span className="tabular-nums font-bold text-emerald-300">{tm.data?.discipline_score ?? 70}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 w-full rounded-full bg-slate-800">
                      <div
                        className="h-1.5 rounded-full bg-emerald-400"
                        style={{ width: `${Math.min(100, tm.data?.discipline_score ?? 70)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {tm.data?.role_shifts && tm.data.role_shifts.length > 0 && (
                  <div className="pt-1 flex flex-wrap gap-1">
                    {tm.data.role_shifts.slice(0, 2).map((rs, idx) => (
                      <span key={idx} className="rounded bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        {rs.label_ar}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Consolidated 11v11 Tracked Player Scouting Table */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-100">تشكيلة وتقييم لاعبي المباراة ({filteredPlayers.length} / {players.length})</h3>
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
              <button
                onClick={() => setTeamFilter("all")}
                className={`rounded-md px-2 py-1 ${teamFilter === "all" ? "bg-emerald-500 text-slate-950 font-bold" : "text-slate-400"}`}
              >
                الكل ({players.length})
              </button>
              <button
                onClick={() => setTeamFilter(0)}
                className={`rounded-md px-2 py-1 ${teamFilter === 0 ? "bg-amber-500 text-slate-950 font-bold" : "text-amber-300"}`}
              >
                {homeName.split(" ")[0]} ({team0Count})
              </button>
              <button
                onClick={() => setTeamFilter(1)}
                className={`rounded-md px-2 py-1 ${teamFilter === 1 ? "bg-sky-500 text-slate-950 font-bold" : "text-sky-300"}`}
              >
                {awayName.split(" ")[0]} ({team1Count})
              </button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-slate-950/95 text-[11px] text-slate-400">
                <tr>
                  <th className="p-2">اللاعب والمركز</th>
                  <th className="p-2">الفريق</th>
                  <th className="p-2">السرعة</th>
                  <th className="p-2">كسر خطوط</th>
                  <th className="p-2">xT</th>
                  <th className="p-2">التزام / مرونة</th>
                  <th className="p-2">التقييم</th>
                  <th className="p-2">التقرير</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredPlayers.map((p) => {
                  const isSel = selectedIdentity === p.identity_key;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedIdentity(isSel ? null : p.identity_key)}
                      className={`cursor-pointer transition ${
                        isSel ? "bg-emerald-500/15" : "hover:bg-slate-800/50"
                      }`}
                    >
                      <td className="p-2 font-semibold text-slate-100">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                            {p.position || "CM"}
                          </span>
                          <span>{p.player_name}</span>
                          {p.jersey_number ? (
                            <span className="font-mono text-[10px] text-slate-400">#{p.jersey_number}</span>
                          ) : null}
                        </div>
                        {p.tactical_role_ar && (
                          <div className="mt-0.5 text-[10px] font-normal text-slate-400">{p.tactical_role_ar}</div>
                        )}
                      </td>
                      <td className="p-2">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            p.team_cluster === 0
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-sky-500/15 text-sky-300"
                          }`}
                        >
                          {p.team_cluster === 0 ? homeName.split(" ")[0] : awayName.split(" ")[0]}
                        </span>
                      </td>
                      <td className="p-2 tabular-nums font-mono">{p.max_speed_kmh} كم/س</td>
                      <td className="p-2 tabular-nums font-mono text-emerald-300">{p.line_breaking_passes}</td>
                      <td className="p-2 tabular-nums font-mono text-cyan-300">{p.xt_generated.toFixed(2)}</td>
                      <td className="p-2 tabular-nums font-mono text-[11px]">
                        {Math.round(p.discipline_score ?? 70)}% / {Math.round(p.fluidity_score ?? 60)}%
                      </td>
                      <td className="p-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono font-bold text-emerald-300">
                          <Sparkles className="h-3 w-3" />
                          {p.scout_score ?? "-"}
                        </span>
                      </td>
                      <td className="p-2" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/player/${p.id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 hover:border-emerald-500 hover:text-emerald-300"
                        >
                          بطاقة الكشاف
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
