"use client";

import React, { useMemo, useState } from "react";
import { Crosshair, FileUser, Info, ScanFace, UserCheck, UserCog, Users } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { useScoutStore } from "@/store/useScoutStore";

export default function PlayerPortfoliosTab() {
  const currentMatch = useScoutStore((s) => s.currentMatch);
  const openVideoDossier = useScoutStore((s) => s.openVideoDossier);
  const setSelectedIdentityKey = useScoutStore((s) => s.setSelectedIdentityKey);
  const setActiveTab = useScoutStore((s) => s.setActiveTab);
  const setShowLineupModal = useScoutStore((s) => s.setShowLineupModal);

  const [teamFilter, setTeamFilter] = useState<"all" | "0" | "1">("all");
  const [sortBy, setSortBy] = useState<"score" | "speed" | "distance" | "voronoi">("score");
  const [showMethodInfo, setShowMethodInfo] = useState(true);

  const summary = currentMatch?.summary;
  const portfolios = summary?.player_portfolios || summary?.tracked_players || [];
  const diag = summary?.identity_diagnostics;
  const hc = String(currentMatch?.home_team_cluster ?? 0);
  const name0 = hc === "0" ? currentMatch?.home_team_name || "فريق 1" : currentMatch?.away_team_name || "فريق 2";
  const name1 = hc === "1" ? currentMatch?.home_team_name || "فريق 1" : currentMatch?.away_team_name || "فريق 2";
  const k0 = summary?.teams?.["0"]?.kit?.ring || "#f43f5e";
  const k1 = summary?.teams?.["1"]?.kit?.ring || "#38bdf8";

  const filtered = useMemo(() => {
    const base = portfolios.filter((p) => {
      if (teamFilter !== "all" && String(p.team_id) !== teamFilter) return false;
      return true;
    });
    return [...base].sort((a, b) => {
      if (sortBy === "speed") return b.max_speed_kmh - a.max_speed_kmh;
      if (sortBy === "distance") return b.distance_m - a.distance_m;
      if (sortBy === "voronoi") return b.avg_voronoi_m2 - a.avg_voronoi_m2;
      return (b.scorecard?.overall_score || 0) - (a.scorecard?.overall_score || 0);
    });
  }, [portfolios, teamFilter, sortBy]);

  if (!summary) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-10 text-center text-sm text-slate-400">
        اختر مباراة جاهزة لعرض بروفايلات اللاعبين المرصودين بالفيديو وتقييماتهم الفردية.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Transparent Identity Pipeline Banner (Honest Re-ID + OCR + Portrait + Roster Binding Explanation) */}
      <div className="rounded-2xl border border-cyan-500/30 bg-gradient-to-l from-[#0c1525] to-cyan-950/20 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <ScanFace className="h-4 w-4 text-cyan-400" />
            منظومة التعرّف شبه التلقائية وبناء البروفايلات (Auto-Lineup + OCR + Re-ID)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLineupModal(true)}
              className="inline-flex items-center gap-1 rounded-xl bg-cyan-400 px-3 py-1.5 text-[11px] font-black text-slate-950 hover:bg-cyan-300"
            >
              <UserCog className="h-3.5 w-3.5" />
              تأكيد / تعديل التشكيلة التلقائية
            </button>
            <button
              onClick={() => setShowMethodInfo((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold text-cyan-200"
            >
              <Info className="h-3.5 w-3.5" />
              {showMethodInfo ? "إخفاء الشرح" : "كيف يتعرف النظام؟"}
            </button>
          </div>
        </div>

        {showMethodInfo && (
          <p className="text-xs leading-relaxed text-slate-300">
            {diag?.face_recognition_note_ar ||
              "في البث التلفزيوني الواسع يبلغ حجم وجه اللاعب 6 إلى 14 بكسل فقط، لذا لا تعتمد الأنظمة الاحترافية على التعرف على الوجه من الكاميرا الواسعة، بل تدمج: ربط الهوية البصرية والمكانية عبر اللقطات (Re-ID)، وقراءة أرقام القمصان (OCR)، واستخراج البورتريه، وربط اللاعب بقاعدة النادي بضغطة واحدة."}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-center text-xs tabular-nums">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
            <div className="text-[10px] text-slate-400">مسارات خام ← هويات مدمجة</div>
            <div className="font-mono text-sm font-black text-cyan-300">
              {diag?.total_raw_tracks ?? "—"} ← {diag?.stitched_identities ?? portfolios.length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
            <div className="text-[10px] text-slate-400">بروفايلات مكتملة</div>
            <div className="font-mono text-sm font-black text-emerald-300">{portfolios.length}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
            <div className="text-[10px] text-slate-400">صور بورتريه مستخرجة</div>
            <div className="font-mono text-sm font-black text-white">{diag?.portraits_extracted ?? 0}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
            <div className="text-[10px] text-slate-400">أرقام قمصان OCR</div>
            <div className="font-mono text-sm font-black text-amber-300">{diag?.jersey_ocr_hits ?? 0}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
            <div className="text-[10px] text-slate-400">مربوطون بقاعدة النادي</div>
            <div className="font-mono text-sm font-black text-violet-300">
              {Object.keys(summary.bound_players || {}).length}
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Sort Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-[#0c1320] px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <Users className="h-4 w-4 text-emerald-400 ml-1" />
          {[
            { id: "all" as const, lbl: `كل اللاعبين (${portfolios.length})` },
            { id: "0" as const, lbl: name0 },
            { id: "1" as const, lbl: name1 },
          ].map((b) => (
            <button
              key={b.id}
              onClick={() => setTeamFilter(b.id)}
              className={`rounded-xl px-3 py-1.5 font-bold transition ${
                teamFilter === b.id
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-800 bg-slate-900 text-slate-300 hover:text-white"
              }`}
            >
              {b.lbl}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-400">ترتيب حسب:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 font-bold text-slate-100"
          >
            <option value="score">نتيجة الأداء العام (/100)</option>
            <option value="speed">أقصى سرعة (كم/س)</option>
            <option value="distance">المسافة المقطوعة (م)</option>
            <option value="voronoi">مساحة التحكم (Voronoi م²)</option>
          </select>
        </div>
      </div>

      {/* Individual Executive Player Portfolio Grid */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => {
          const teamCol = p.team_id === 0 ? k0 : k1;
          const teamName = p.team_id === 0 ? name0 : name1;
          const ov = p.scorecard?.overall_score ?? 65;
          const ovCol = ov >= 80 ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/15" : ov >= 70 ? "text-cyan-300 border-cyan-500/40 bg-cyan-500/15" : "text-amber-300 border-amber-500/40 bg-amber-500/15";

          return (
            <div
              key={p.identity_key}
              className="group rounded-2xl border border-slate-800 bg-[#0c1320] p-4 space-y-3 transition hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-950/30"
            >
              {/* Top Row: Portrait + Identity + Overall Match Score */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {p.portrait_url ? (
                    <img
                      src={`${API_BASE}${p.portrait_url}`}
                      alt={p.identity_key}
                      className="h-16 w-14 shrink-0 rounded-xl border-2 object-cover bg-slate-900"
                      style={{ borderColor: teamCol }}
                    />
                  ) : (
                    <div
                      className="flex h-16 w-14 shrink-0 items-center justify-center rounded-xl border-2 bg-slate-900 font-mono text-sm font-black text-white"
                      style={{ borderColor: teamCol }}
                    >
                      {p.jersey_ocr ? `#${p.jersey_ocr}` : p.inferred_role_code}
                    </div>
                  )}

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: teamCol }} />
                      <h3 className="truncate text-sm font-black text-white">
                        {p.display_name || p.bound_player?.name || (p.jersey_ocr ? `لاعب #${p.jersey_ocr}` : `هوية ${p.identity_key}`)}
                      </h3>
                    </div>
                    <div className="text-[11px] font-bold text-slate-300">
                      {teamName} • <span className="text-cyan-300">{p.inferred_role_ar}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {p.compatibility?.archetype_ar}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          p.identity_status === "confirmed_manual"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : p.identity_status === "confirmed_ocr"
                            ? "bg-cyan-500/20 text-cyan-200"
                            : "bg-amber-500/15 text-amber-200"
                        }`}
                      >
                        <UserCheck className="h-2.5 w-2.5" />
                        {p.status_label_ar || "مرشّح تلقائياً"}
                      </span>
                      {(p.highlights_count ?? 0) > 0 && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
                          +{p.highlights_count} مميزات
                        </span>
                      )}
                      {(p.mistakes_count ?? 0) > 0 && (
                        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-rose-300">
                          -{p.mistakes_count} أخطاء
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className={`shrink-0 rounded-xl border px-2.5 py-1.5 text-center ${ovCol}`}>
                  <div className="text-[9px] font-bold opacity-80">التقييم</div>
                  <div className="font-mono text-lg font-black leading-none tabular-nums">{ov}</div>
                </div>
              </div>

              {/* 4 Core Real-Telemetry KPIs */}
              <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] tabular-nums">
                <div className="rounded-xl bg-slate-950/90 border border-slate-800/80 py-1.5 px-1">
                  <div className="text-slate-500">السرعة</div>
                  <div className="font-mono font-black text-amber-300">{p.max_speed_kmh}</div>
                </div>
                <div className="rounded-xl bg-slate-950/90 border border-slate-800/80 py-1.5 px-1">
                  <div className="text-slate-500">المسافة</div>
                  <div className="font-mono font-black text-white">{p.distance_m}م</div>
                </div>
                <div className="rounded-xl bg-slate-950/90 border border-slate-800/80 py-1.5 px-1">
                  <div className="text-slate-500">Voronoi</div>
                  <div className="font-mono font-black text-cyan-300">{Math.round(p.avg_voronoi_m2)}م²</div>
                </div>
                <div className="rounded-xl bg-slate-950/90 border border-slate-800/80 py-1.5 px-1">
                  <div className="text-slate-500">أنسب خطة</div>
                  <div className="font-mono font-black text-emerald-300">{p.compatibility?.best_formation || "—"}</div>
                </div>
              </div>

              {/* Reliability & Sample Footnote */}
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>
                  عينة معايرة: <strong className="text-slate-200">{p.n_cal_frames} فريم</strong> ({p.seconds_tracked}ث)
                </span>
                <span className="rounded bg-slate-900 px-2 py-0.5 text-slate-300">{p.sample_reliability_ar}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  onClick={() => openVideoDossier(p.identity_key)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400 transition"
                >
                  <FileUser className="h-3.5 w-3.5" />
                  البروفايل الكامل (Heatmap + 6×4)
                </button>
                <button
                  onClick={() => {
                    setSelectedIdentityKey(p.identity_key);
                    setActiveTab("studio");
                  }}
                  title="تسليط الضوء 3D على اللاعب في الفيديو"
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  3D
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
