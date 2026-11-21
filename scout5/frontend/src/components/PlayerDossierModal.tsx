"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  Award,
  CheckCircle2,
  Link2,
  Play,
  PlusCircle,
  ShieldAlert,
  Sparkles,
  UserCheck,
  Wrench,
  X,
} from "lucide-react";
import {
  API_BASE,
  apiFetch,
  type CompatibilityItem,
  type DbPlayerPortfolio,
  type PlayerPortfolio,
  type SeedPlayer,
} from "@/lib/api";
import { useScoutStore } from "@/store/useScoutStore";

function fmtEgp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} مليون ج.م`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} ألف ج.م`;
  return `${n} ج.م`;
}

function tierBadge(tier: CompatibilityItem["tier"]) {
  if (tier === "elite") return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
  if (tier === "conditional") return "border-amber-500/40 bg-amber-500/15 text-amber-300";
  return "border-rose-500/40 bg-rose-500/15 text-rose-300";
}

function tierBar(tier: CompatibilityItem["tier"]) {
  if (tier === "elite") return "bg-emerald-400";
  if (tier === "conditional") return "bg-amber-400";
  return "bg-rose-500";
}

function PitchHeatmap12x8({ grid }: { grid: number[][] }) {
  return (
    <div className="rounded-xl border border-emerald-900/60 bg-[#0b2919] p-2" dir="ltr">
      <svg viewBox="0 0 105 68" className="w-full h-auto block">
        {grid.map((row, rIdx) =>
          row.map((val, cIdx) => {
            if (val <= 0.02) return null;
            const x = (cIdx / 12) * 105;
            const y = (rIdx / 8) * 68;
            const cw = 105 / 12;
            const ch = 68 / 8;
            const col = val > 0.72 ? "#ef4444" : val > 0.4 ? "#f59e0b" : "#10b981";
            return (
              <rect
                key={`${rIdx}-${cIdx}`}
                x={x}
                y={y}
                width={cw}
                height={ch}
                rx={1.4}
                fill={col}
                fillOpacity={0.22 + val * 0.62}
              />
            );
          })
        )}
        <rect x={0.4} y={0.4} width={104.2} height={67.2} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.45} />
        <line x1={52.5} y1={0} x2={52.5} y2={68} stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
        <circle cx={52.5} cy={34} r={9.15} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
        <rect x={0} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
        <rect x={88.5} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={0.35} />
      </svg>
    </div>
  );
}

function SpeedSparkline({ series }: { series: { t: number; kmh: number }[] }) {
  if (!series || series.length < 2) {
    return <div className="flex h-[110px] items-center justify-center text-xs text-slate-500">لا توجد نقاط سرعة كافية</div>;
  }
  const sorted = [...series].sort((a, b) => a.t - b.t);
  const w = 380;
  const h = 122;
  const maxV = Math.max(32, ...sorted.map((s) => s.kmh)) * 1.08;
  const minT = sorted[0].t;
  const spanT = Math.max(0.5, sorted[sorted.length - 1].t - minT);

  const coords = sorted.map((s) => {
    const x = 12 + ((s.t - minT) / spanT) * (w - 24);
    const y = Math.max(10, Math.min(h - 14, h - 14 - (s.kmh / maxV) * (h - 26)));
    return [x, y] as [number, number];
  });
  const pts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPts = `${coords[0][0].toFixed(1)},${h - 14} ${pts} ${coords[coords.length - 1][0].toFixed(1)},${h - 14}`;

  const yHir = Math.max(10, h - 14 - (19.8 / maxV) * (h - 26));
  const ySpr = Math.max(10, h - 14 - (25.2 / maxV) * (h - 26));

  return (
    <div dir="ltr" className="rounded-xl border border-slate-800 bg-slate-950/90 p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto block">
        <defs>
          <linearGradient id="spdFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={12} y1={yHir} x2={w - 12} y2={yHir} stroke="rgba(245,158,11,0.45)" strokeDasharray="4 3" strokeWidth={1} />
        <text x={w - 14} y={yHir - 3} textAnchor="end" fontSize="8" fill="#fbbf24">HIR 19.8 km/h</text>
        <line x1={12} y1={ySpr} x2={w - 12} y2={ySpr} stroke="rgba(244,63,94,0.55)" strokeDasharray="4 3" strokeWidth={1} />
        <text x={w - 14} y={ySpr - 3} textAnchor="end" fontSize="8" fill="#fb7185">Sprint 25.2 km/h</text>
        <polygon points={areaPts} fill="url(#spdFill)" />
        <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function PlayerDossierModal() {
  const dossierTarget = useScoutStore((s) => s.dossierTarget);
  const closeDossier = useScoutStore((s) => s.closeDossier);
  const selectedSlug = useScoutStore((s) => s.selectedSlug);
  const currentMatch = useScoutStore((s) => s.currentMatch);
  const triggerMatchRefresh = useScoutStore((s) => s.triggerMatchRefresh);
  const replayInStudio = useScoutStore((s) => s.replayInStudio);

  const [videoData, setVideoData] = useState<PlayerPortfolio | null>(null);
  const [dbData, setDbData] = useState<DbPlayerPortfolio | null>(null);
  const [loading, setLoading] = useState(false);

  // Roster Binding state for Video-Tracked players
  const [showBindBox, setShowBindBox] = useState(false);
  const [bindMode, setBindMode] = useState<"existing" | "new">("existing");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SeedPlayer[]>([]);
  const [pickedPlayerId, setPickedPlayerId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newDivision, setNewDivision] = useState("EGY2");
  const [newPos, setNewPos] = useState("CM");
  const [newAge, setNewAge] = useState(21);
  const [newJersey, setNewJersey] = useState("");
  const [bindNotes, setBindNotes] = useState("");
  const [bindMsg, setBindMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!dossierTarget) {
      setVideoData(null);
      setDbData(null);
      setShowBindBox(false);
      setBindMsg(null);
      return;
    }
    setLoading(true);
    setBindMsg(null);
    if (dossierTarget.type === "video" && selectedSlug) {
      setDbData(null);
      void apiFetch<PlayerPortfolio>(`/api/matches/${selectedSlug}/players/${dossierTarget.identityKey}`)
        .then((r) => {
          setVideoData(r);
          setNewPos(r.inferred_role_code || "CM");
          setNewJersey(r.jersey_ocr ? String(r.jersey_ocr) : "");
        })
        .catch(() => setVideoData(null))
        .finally(() => setLoading(false));
    } else if (dossierTarget.type === "db") {
      setVideoData(null);
      void apiFetch<DbPlayerPortfolio>(`/api/scouting/player/${dossierTarget.playerId}`)
        .then(setDbData)
        .catch(() => setDbData(null))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [dossierTarget, selectedSlug]);

  useEffect(() => {
    if (!showBindBox || bindMode !== "existing") return;
    const params = new URLSearchParams({ division: "all", q: searchQ, limit: "18" });
    void apiFetch<{ players: SeedPlayer[] }>(`/api/scouting/database?${params.toString()}`)
      .then((r) => setSearchResults(r.players))
      .catch(() => {});
  }, [showBindBox, bindMode, searchQ]);

  if (!dossierTarget) return null;

  const submitBind = async () => {
    if (!selectedSlug || !videoData) return;
    setBindMsg(null);
    try {
      const payload =
        bindMode === "existing"
          ? {
              identity_key: videoData.identity_key,
              player_id: pickedPlayerId,
              jersey_number: newJersey ? Number(newJersey) : null,
              notes: bindNotes || null,
            }
          : {
              identity_key: videoData.identity_key,
              new_player_name: newName.trim(),
              new_division: newDivision,
              new_position: newPos,
              new_age: Number(newAge) || 21,
              jersey_number: newJersey ? Number(newJersey) : null,
              notes: bindNotes || null,
            };
      const res = await apiFetch<{ ok: boolean; player_name: string }>(`/api/matches/${selectedSlug}/bind-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setBindMsg(`تم ربط وحفظ اللاعب "${res.player_name}" في قاعدة بيانات النادي بنجاح!`);
      const refreshed = await apiFetch<PlayerPortfolio>(`/api/matches/${selectedSlug}/players/${videoData.identity_key}`);
      setVideoData(refreshed);
      triggerMatchRefresh();
    } catch (err) {
      setBindMsg(`خطأ: ${err instanceof Error ? err.message : "تعذر الربط"}`);
    }
  };

  const compat = videoData?.compatibility || dbData?.compatibility;
  const hc = String(currentMatch?.home_team_cluster ?? 0);
  const videoTeamName = videoData
    ? String(videoData.team_id) === hc
      ? currentMatch?.home_team_name || "فريق 1"
      : currentMatch?.away_team_name || "فريق 2"
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" onClick={closeDossier}>
      <div
        className="relative max-h-[92vh] w-full max-w-[1120px] overflow-y-auto rounded-3xl border border-slate-700/90 bg-[#0a101b] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeDossier}
          className="absolute left-4 top-4 rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:border-slate-500 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-400">جاري تحميل البروفايل التنفيذي ومصفوفة الخطط...</div>
        ) : !videoData && !dbData ? (
          <div className="flex h-48 items-center justify-center text-sm text-rose-300">تعذر العثور على بيانات اللاعب</div>
        ) : (
          <div className="space-y-5">
            {/* Hero Broadcast Banner */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-gradient-to-l from-slate-900/95 via-[#0d1626] to-emerald-950/30 p-4 pl-14">
              <div className="flex items-center gap-4">
                {videoData?.portrait_url ? (
                  <img
                    src={`${API_BASE}${videoData.portrait_url}`}
                    alt={videoData.identity_key}
                    className="h-24 w-20 rounded-2xl border-2 border-emerald-400/50 object-cover bg-slate-900 shadow-lg"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-emerald-400/40 bg-emerald-500/10 font-mono text-2xl font-black text-emerald-300">
                    {dbData?.jersey_number ? `#${dbData.jersey_number}` : dbData?.position || videoData?.inferred_role_code}
                  </div>
                )}

                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black text-white">
                      {videoData
                        ? videoData.display_name ||
                          videoData.bound_player?.name ||
                          (videoData.jersey_ocr
                            ? `لاعب #${videoData.jersey_ocr} (${videoTeamName})`
                            : `هوية ${videoData.identity_key} — ${videoTeamName}`)
                        : dbData?.name}
                    </h2>
                    <span className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-0.5 text-xs font-black text-cyan-200">
                      {videoData ? `${videoData.inferred_role_ar} (${videoData.inferred_role_code})` : dbData?.position}
                    </span>
                    {videoData?.status_label_ar && (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                        <UserCheck className="h-3.5 w-3.5" />
                        {videoData.status_label_ar} ({videoTeamName})
                      </span>
                    )}
                    {dbData && (
                      <span className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-200">
                        {dbData.club_name} • {dbData.division}
                      </span>
                    )}
                  </div>

                  {compat && (
                    <div className="text-xs font-bold text-emerald-300">
                      النمط التكتيكي: {compat.archetype_ar}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 tabular-nums">
                    {videoData ? (
                      <>
                        <span>العينة المرصودة: <strong className="text-slate-200">{videoData.n_cal_frames} فريم معاير ({videoData.seconds_tracked}ث)</strong></span>
                        <span>موثوقية العينة: <strong className="text-amber-300">{videoData.sample_reliability_ar}</strong></span>
                        <span>مسارات مدمجة Re-ID: <strong className="text-cyan-300">{videoData.n_tracklets_merged}</strong></span>
                        {videoData.jersey_ocr && (
                          <span>رقم القميص OCR: <strong className="text-emerald-300">#{videoData.jersey_ocr} ({Math.round(videoData.jersey_ocr_conf * 100)}%)</strong></span>
                        )}
                      </>
                    ) : (
                      dbData && (
                        <>
                          <span>العمر: <strong className="text-slate-200">{dbData.age ?? "--"} سنة</strong></span>
                          <span>القدم: <strong className="text-slate-200">{dbData.preferred_foot || "يمين"}</strong></span>
                          <span>القيمة السوقية: <strong className="text-amber-300">{fmtEgp(dbData.market_value_egp)}</strong></span>
                          <span>مؤشر Moneyball: <strong className="text-emerald-300">{dbData.moneyball_index}/100</strong></span>
                        </>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* Overall Score Badge + Bind Action */}
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-center">
                  <div className="text-[10px] font-bold text-emerald-300">{videoData ? "نتيجة المباراة" : "التقييم العام"}</div>
                  <div className="font-mono text-2xl font-black text-white tabular-nums">
                    {videoData ? videoData.scorecard.overall_score : dbData?.overall_rating}
                    <span className="text-xs text-slate-400">/100</span>
                  </div>
                </div>

                {videoData && (
                  <button
                    onClick={() => setShowBindBox((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400"
                  >
                    <Link2 className="h-4 w-4" />
                    {videoData.bound_player ? "تعديل الربط" : "ربط بقاعدة النادي"}
                  </button>
                )}
              </div>
            </div>

            {/* 1-Click Roster Identity Binding / New Lower-Div Prospect Registration Panel */}
            {videoData && showBindBox && (
              <div className="rounded-2xl border border-cyan-500/40 bg-cyan-950/20 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-black text-cyan-200 flex items-center gap-1.5">
                    <PlusCircle className="h-4 w-4" />
                    ربط هوية الفيديو ({videoData.identity_key}) بملف لاعب دائم في قاعدة البيانات
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => setBindMode("existing")}
                      className={`rounded-lg px-3 py-1 font-bold ${bindMode === "existing" ? "bg-cyan-400 text-slate-950" : "bg-slate-900 text-slate-300"}`}
                    >
                      ربط بلاعب موجود (536 لاعب)
                    </button>
                    <button
                      onClick={() => setBindMode("new")}
                      className={`rounded-lg px-3 py-1 font-bold ${bindMode === "new" ? "bg-emerald-400 text-slate-950" : "bg-slate-900 text-slate-300"}`}
                    >
                      تسجيل موهبة جديدة (درجة ثانية/ثالثة)
                    </button>
                  </div>
                </div>

                {bindMode === "existing" ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      placeholder="ابحث باسم اللاعب أو النادي..."
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    />
                    <select
                      value={pickedPlayerId ?? ""}
                      onChange={(e) => setPickedPlayerId(Number(e.target.value) || null)}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:col-span-2"
                    >
                      <option value="">اختر اللاعب من قاعدة البيانات...</option>
                      {searchResults.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {p.club_name} ({p.position} • {p.division})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="اسم اللاعب بالكامل *"
                      className="col-span-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    />
                    <select
                      value={newDivision}
                      onChange={(e) => setNewDivision(e.target.value)}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    >
                      <option value="EGY2">دوري المحترفين (درجة ثانية)</option>
                      <option value="EGY3">الدرجة الثالثة / الممتاز ب</option>
                      <option value="EGY_YOUTH">ناشئين / 2005</option>
                      <option value="EGY1">الدوري الممتاز</option>
                    </select>
                    <input
                      value={newPos}
                      onChange={(e) => setNewPos(e.target.value)}
                      placeholder="المركز (RW/CM/CB)"
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    />
                    <input
                      type="number"
                      value={newAge}
                      onChange={(e) => setNewAge(Number(e.target.value))}
                      placeholder="العمر"
                      className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={newJersey}
                    onChange={(e) => setNewJersey(e.target.value)}
                    placeholder="رقم القميص"
                    className="w-28 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  />
                  <input
                    value={bindNotes}
                    onChange={(e) => setBindNotes(e.target.value)}
                    placeholder="ملاحظة الكشاف / المدير الفني (اختياري)..."
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  />
                  <button
                    onClick={() => void submitBind()}
                    className="rounded-xl bg-emerald-500 px-4 py-2 font-black text-slate-950 hover:bg-emerald-400"
                  >
                    حفظ الربط الدائم
                  </button>
                </div>
                {bindMsg && <div className="font-bold text-emerald-300">{bindMsg}</div>}
              </div>
            )}

            {/* Video-Tracked Physical Telemetry + Calibrated 12x8 Heatmap + Speed Sparkline */}
            {videoData && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12 items-start">
                <div className="md:col-span-5 space-y-2">
                  <div className="text-xs font-black text-slate-200">الخريطة الحرارية المعايَرة (12×8 — FIFA 105×68م)</div>
                  <PitchHeatmap12x8 grid={videoData.heatmap_12x8} />
                </div>
                <div className="md:col-span-7 space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center text-xs tabular-nums">
                    {[
                      { lbl: "البدني والسرعة", val: `${videoData.scorecard.physical_score}`, sub: `أقصى ${videoData.max_speed_kmh} كم/س`, col: "text-amber-300" },
                      { lbl: "المجهود والمعدل", val: `${videoData.scorecard.workrate_score}`, sub: `${videoData.distance_m}م (${videoData.distance_per_min_m}م/د)`, col: "text-emerald-300" },
                      { lbl: "السيطرة المكانية", val: `${videoData.scorecard.tactical_space_score}`, sub: `Voronoi ${videoData.avg_voronoi_m2}م²`, col: "text-cyan-300" },
                      { lbl: "التدرج والخطورة", val: `${videoData.scorecard.progression_score}`, sub: `${videoData.ball_carrier_frames} استحواذ / ${videoData.line_breaking_options} كاسر`, col: "text-violet-300" },
                    ].map((card) => (
                      <div key={card.lbl} className="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5">
                        <div className="text-[10px] text-slate-400">{card.lbl}</div>
                        <div className={`font-mono text-lg font-black ${card.col}`}>{card.val}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">{card.sub}</div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-200 flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-cyan-400" />
                        منحنى السرعة اللحظية خلال العينة المعايَرة
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        جري عالٍ HIR: <strong className="text-amber-300">{videoData.hir_distance_m}م</strong> • انطلاقات Sprint:{" "}
                        <strong className="text-rose-300">{videoData.sprint_count}</strong> ({videoData.sprint_distance_m}م)
                      </span>
                    </div>
                    <SpeedSparkline series={videoData.speed_series} />
                  </div>
                </div>
              </div>
            )}

            {/* DB Player Acquisition Verdict & Linked Video Matches */}
            {dbData && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-xs space-y-1">
                  <div className="font-black text-emerald-300 flex items-center gap-1.5">
                    <Award className="h-4 w-4" />
                    توصية لجنة التعاقدات
                  </div>
                  <div className="text-sm font-bold text-white">{dbData.acquisition_verdict_ar}</div>
                  <div className="text-[11px] text-slate-400">
                    أفضل خطة: <strong className="text-emerald-300">{dbData.compatibility.best_formation} ({dbData.compatibility.best_formation_pct}%)</strong> • أضعف خطة:{" "}
                    <strong className="text-rose-300">{dbData.compatibility.worst_formation} ({dbData.compatibility.worst_formation_pct}%)</strong>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs space-y-1.5">
                  <div className="font-black text-cyan-300">سجل المباريات المرصودة بالفيديو ({dbData.linked_video_matches.length})</div>
                  {dbData.linked_video_matches.length === 0 ? (
                    <div className="text-slate-400">لم يُربط اللاعب بفيديو مباراة بعد — يمكنك ربطه من تبويب «بروفايلات لاعبي المباراة».</div>
                  ) : (
                    <div className="space-y-1">
                      {dbData.linked_video_matches.map((m, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-lg bg-slate-900 px-2.5 py-1.5">
                          <span className="font-bold text-slate-200">{m.match_slug} ({m.identity_key})</span>
                          <span className="font-mono text-emerald-300">
                            {m.overall_score}/100 • {m.max_speed_kmh} كم/س
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Video Player Match Mistakes, Highlights & Coaching Fix (Timestamped with 1-Click Slow-Mo Replay) */}
            {videoData && (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/75 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-black text-white text-sm">
                    مميزات وعيوب وأخطاء اللاعب المرصودة بالثانية في المباراة
                  </div>
                  <span className="text-[11px] text-slate-400">
                    اضغط على أي توقيت لإعادة اللقطة بالحركة البطيئة (0.5x) مع تسليط الضوء 3D
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-3 space-y-2">
                    <div className="font-black text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />
                      المميزات واللقطات الإيجابية ({videoData.match_strengths?.length || 0})
                    </div>
                    {(videoData.match_strengths || []).map((st, idx) => (
                      <div key={idx} className="rounded-lg bg-slate-950/85 p-2.5 space-y-1">
                        <div className="flex items-center justify-between gap-2 font-bold text-emerald-100">
                          <span>{st.title_ar}</span>
                          {st.time_s !== null && (
                            <button
                              onClick={() =>
                                replayInStudio(Math.max(0, st.time_s! - 1.5), {
                                  playbackRate: 0.5,
                                  focusIdentity: videoData.identity_key,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded bg-emerald-500/25 px-2 py-0.5 font-mono text-[10px] text-emerald-100 hover:bg-emerald-500/40"
                            >
                              <Play className="h-2.5 w-2.5" />
                              شاهد ({st.time_s}ث)
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-300">{st.detail_ar}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-rose-500/25 bg-rose-950/15 p-3 space-y-2">
                    <div className="font-black text-rose-300 flex items-center gap-1.5">
                      <ShieldAlert className="h-4 w-4" />
                      الأخطاء والعيوب المرصودة ({videoData.match_mistakes?.length || 0})
                    </div>
                    {(videoData.match_mistakes || []).length === 0 ? (
                      <div className="text-emerald-300/80 py-2">لا توجد أخطاء دفاعية أو فقدان كرة حرج مسجل في هذه العينة.</div>
                    ) : (
                      (videoData.match_mistakes || []).map((mk, idx) => (
                        <div key={idx} className="rounded-lg bg-slate-950/85 p-2.5 space-y-1">
                          <div className="flex items-center justify-between gap-2 font-bold text-rose-100">
                            <span>{mk.title_ar}</span>
                            {mk.time_s !== null && (
                              <button
                                onClick={() =>
                                  replayInStudio(Math.max(0, mk.time_s! - 1.5), {
                                    playbackRate: 0.5,
                                    focusIdentity: videoData.identity_key,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded bg-rose-500/25 px-2 py-0.5 font-mono text-[10px] text-rose-100 hover:bg-rose-500/40"
                              >
                                <Play className="h-2.5 w-2.5" />
                                شاهد الخطأ ({mk.time_s}ث)
                              </button>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-300">{mk.detail_ar}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {videoData.coaching_fix_ar && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2.5 text-amber-100">
                    <Wrench className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <strong className="text-amber-300">التصحيح التدريبي المقترح للمدرب: </strong>
                      {videoData.coaching_fix_ar}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Strengths & Watchouts */}
            {compat && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-xs">
                <div className="rounded-2xl border border-emerald-500/25 bg-emerald-950/15 p-3.5 space-y-1.5">
                  <div className="font-black text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    أبرز 3 نقاط قوة
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {compat.strengths_ar.map((s, i) => (
                      <span key={i} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-bold text-emerald-100">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-rose-500/25 bg-rose-950/15 p-3.5 space-y-1.5">
                  <div className="font-black text-rose-300 flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4" />
                    3 نقاط تحتاج معالجة / حماية تكتيكية
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {compat.watchouts_ar.map((s, i) => (
                      <span key={i} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 font-bold text-rose-100">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 6-Formation Compatibility Matrix with Explicit Numbered Reasons (1, 2, 3) */}
            {compat && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  مصفوفة الملاءمة التكتيكية عبر الـ 6 خطط (مع الأسباب المرقّمة 1، 2، 3)
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {compat.formations.map((f) => (
                    <div key={f.code} className="rounded-2xl border border-slate-800 bg-slate-950/85 p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-mono text-sm font-black text-white">{f.code}</div>
                          <div className="text-[11px] text-slate-400">{f.name_ar}</div>
                        </div>
                        <div className="text-left">
                          <div className="font-mono text-base font-black text-white tabular-nums">{f.fit_pct}%</div>
                          <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold ${tierBadge(f.tier)}`}>
                            {f.verdict_ar}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800" dir="ltr">
                        <div style={{ width: `${f.fit_pct}%` }} className={`h-full ${tierBar(f.tier)}`} />
                      </div>
                      <ul className="space-y-1 text-[11px] leading-relaxed text-slate-300">
                        {f.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4-System Philosophy Compatibility Matrix */}
            {compat && (
              <div className="space-y-3">
                <div className="text-sm font-black text-white">الملاءمة مع أنظمة اللعب الـ 4 (فلسفة المدرب)</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {compat.systems.map((sys) => (
                    <div key={sys.code} className="rounded-2xl border border-slate-800 bg-slate-950/85 p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-black text-white">{sys.name_ar}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-emerald-300">{sys.fit_pct}%</span>
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${tierBadge(sys.tier)}`}>
                            {sys.verdict_ar}
                          </span>
                        </div>
                      </div>
                      <ul className="space-y-1 text-[11px] leading-relaxed text-slate-300">
                        {sys.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
