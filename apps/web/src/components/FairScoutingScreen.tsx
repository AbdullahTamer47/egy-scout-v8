"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bookmark, Crosshair, Film, Play, RotateCcw, ShieldAlert, Trash2, Upload, UserCheck } from "lucide-react";
import {
  API_BASE,
  apiFetch,
  BenchStatePayload,
  frameImageUrl,
  MatchupPlanPayload,
  matchVideoUrl,
  ScoutingPlayer,
  ScoutingResponse,
  ShortlistItem,
  UserRole,
} from "@/lib/api";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
}

type SubTab = "video_tracks" | "benchmark" | "four_point";

const RADAR_AXES = [
  { key: "vaep_per90", label: "VAEP", max: 0.6 },
  { key: "xt_per90", label: "xT", max: 0.4 },
  { key: "team_xt_share_pct", label: "%xT", max: 25 },
  { key: "padj_defensive_actions_per90", label: "PAdj", max: 16 },
  { key: "hir_distance_m_per90", label: "HIR", max: 1100 },
  { key: "positional_discipline_score", label: "Disc", max: 100 },
] as const;

const RADAR_COLORS = ["#10B981", "#38BDF8", "#F59E0B", "#F472B6"] as const;

function SvgRadarChart({ players }: { players: ScoutingPlayer[] }) {
  const cx = 140, cy = 140, r = 102;

  const pt = (axisIdx: number, ratio: number) => {
    const ang = (Math.PI * 2 * axisIdx) / RADAR_AXES.length - Math.PI / 2;
    return [cx + Math.cos(ang) * r * ratio, cy + Math.sin(ang) * r * ratio];
  };

  return (
    <svg viewBox="0 0 280 280" className="w-full max-w-[290px] mx-auto">
      {[0.25, 0.5, 0.75, 1].map((lvl) => (
        <polygon
          key={lvl}
          points={RADAR_AXES.map((_, i) => pt(i, lvl).join(",")).join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.09)"
          strokeWidth="1"
        />
      ))}
      {RADAR_AXES.map((ax, i) => {
        const [x, y] = pt(i, 1.15);
        const [ex, ey] = pt(i, 1);
        return (
          <g key={ax.key}>
            <line x1={cx} y1={cy} x2={ex} y2={ey} stroke="rgba(255,255,255,0.08)" />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#94A3B8" fontSize="10" fontWeight="600">
              {ax.label}
            </text>
          </g>
        );
      })}
      {players.map((p, pIdx) => {
        const coords = RADAR_AXES.map((ax, i) => {
          const val = Number(p[ax.key] ?? 0);
          return pt(i, Math.max(0.08, Math.min(1, val / ax.max))).join(",");
        }).join(" ");
        const c = RADAR_COLORS[pIdx % RADAR_COLORS.length];
        return (
          <polygon
            key={p.player_id}
            points={coords}
            fill={c}
            fillOpacity={0.16}
            stroke={c}
            strokeWidth={2}
          />
        );
      })}
    </svg>
  );
}

export default function FairScoutingScreen({ lang, matchId, role }: Props) {
  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  const [subTab, setSubTab] = useState<SubTab>("benchmark");
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [data, setData] = useState<ScoutingResponse | null>(null);
  const [selectedBenchIds, setSelectedBenchIds] = useState<string[]>([]);
  const [activeClip, setActiveClip] = useState<{
    match_id: string;
    frame_id: number;
    track_id?: number;
    start_s: number;
    end_s: number;
    title: string;
    proof: string;
  } | null>(null);
  const [matchup, setMatchup] = useState<MatchupPlanPayload | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistItem[]>([]);
  const [benchState, setBenchState] = useState<BenchStatePayload | null>(null);
  const [exportingClip, setExportingClip] = useState(false);

  // Interactive 4-Point Homography Calibration state (normalized 0..1 coordinates over match image)
  const [fmt, setFmt] = useState<"11v11" | "9v9" | "7v7" | "6v6" | "5v5">("11v11");
  const [age, setAge] = useState<"senior" | "youth" | "u12">("senior");
  const [corners, setCorners] = useState<[number, number][]>([
    [0.18, 0.28],
    [0.82, 0.28],
    [0.92, 0.86],
    [0.08, 0.86],
  ]);
  const [dragCornerIdx, setDragCornerIdx] = useState<number | null>(null);
  const [setupResult, setSetupResult] = useState<{
    offside_enabled: boolean;
    rolling_subs: boolean;
    speed_thresholds: { hir_kmh: number; sprint_kmh: number };
    homography?: { valid: boolean; projected_center_m: [number, number] };
  } | null>(null);

  const calBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch<ScoutingResponse>(`/api/scouting/players?match_id=${matchId}`, {}, "club_demo_egypt", role),
      apiFetch<MatchupPlanPayload>(`/api/tactics/matchup?match_id=${matchId}`, {}, "club_demo_egypt", role),
      apiFetch<{ items: ShortlistItem[] }>(`/api/scouting/shortlist`, {}, "club_demo_egypt", role),
      apiFetch<BenchStatePayload>(`/api/matches/${matchId}/bench-state`, {}, "club_demo_egypt", role),
    ])
      .then(([sc, mu, sl, bs]) => {
        if (!alive) return;
        setData(sc);
        setSelectedBenchIds(sc.benchmark_players.slice(0, 3).map((p) => p.player_id));
        setMatchup(mu);
        setShortlist(sl.items || []);
        setBenchState(bs);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [matchId, role]);

  const handleCornerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragCornerIdx === null || !calBoxRef.current) return;
    const rect = calBoxRef.current.getBoundingClientRect();
    const nx = Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0.05, Math.min(0.96, (e.clientY - rect.top) / rect.height));
    setCorners((prev) => prev.map((c, idx) => (idx === dragCornerIdx ? [nx, ny] : c)));
  };

  const applyCalibration = async () => {
    if (isReadOnly) return;
    const pxCorners = corners.map(([nx, ny]) => [Math.round(nx * 1280), Math.round(ny * 720)]);
    const res = await apiFetch<{
      offside_enabled: boolean;
      rolling_subs: boolean;
      speed_thresholds: { hir_kmh: number; sprint_kmh: number };
      homography?: { valid: boolean; projected_center_m: [number, number] };
    }>(
      `/api/match-setup/${matchId}`,
      {
        method: "POST",
        body: JSON.stringify({ match_format: fmt, age_group: age, four_point_pixels: pxCorners }),
      },
      "club_demo_egypt",
      role
    );
    setSetupResult(res);
    const updatedBench = await apiFetch<BenchStatePayload>(`/api/matches/${matchId}/bench-state`, {}, "club_demo_egypt", role);
    setBenchState(updatedBench);
  };

  const toggleShortlist = async (p: ScoutingPlayer) => {
    if (isReadOnly) return;
    const exists = shortlist.some((it) => it.player_id === p.player_id);
    if (exists) {
      const res = await apiFetch<{ items: ShortlistItem[] }>(
        `/api/scouting/shortlist/${encodeURIComponent(p.player_id)}`,
        { method: "DELETE" },
        "club_demo_egypt",
        role
      );
      setShortlist(res.items || []);
    } else {
      const res = await apiFetch<{ items: ShortlistItem[] }>(
        `/api/scouting/shortlist`,
        {
          method: "POST",
          body: JSON.stringify({
            player_id: p.player_id,
            display_name: p.display_name,
            team_name: p.team_name,
            position: p.position,
            rating_10: p.rating_10,
            league_translation_pct: p.league_translation_pct,
            status: "watch",
            note: isAr ? p.archetype_ar : p.archetype_en,
          }),
        },
        "club_demo_egypt",
        role
      );
      setShortlist(res.items || []);
    }
  };

  const updateShortlistStatus = async (it: ShortlistItem, status: string) => {
    if (isReadOnly) return;
    const res = await apiFetch<{ items: ShortlistItem[] }>(
      `/api/scouting/shortlist`,
      { method: "POST", body: JSON.stringify({ ...it, status }) },
      "club_demo_egypt",
      role
    );
    setShortlist(res.items || []);
  };

  const handleBenchAction = async (action: "substitute" | "red_card" | "reset", team: "team_a" | "team_b") => {
    if (isReadOnly) return;
    try {
      const res = await apiFetch<BenchStatePayload>(
        `/api/matches/${matchId}/bench-state`,
        { method: "POST", body: JSON.stringify({ action, team, minute: 62 }) },
        "club_demo_egypt",
        role
      );
      setBenchState(res);
    } catch {
      // ignore cap limit errors silently
    }
  };

  const exportEvidenceMp4 = async (mId: string, startS: number, endS: number) => {
    setExportingClip(true);
    try {
      const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(mId)}/export-clip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": "club_demo_egypt",
          "X-User-Role": role,
        },
        body: JSON.stringify({ start_s: startS, end_s: endS, auto_face_blur: age === "u12" }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${mId}_evidence_${Math.round(startS)}s.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingClip(false);
    }
  };

  const handleCsvUpload = async (file: File) => {
    if (isReadOnly) return;
    const form = new FormData();
    form.append("file", file);
    await apiFetch("/api/scouting/import-csv", { method: "POST", body: form }, "club_demo_egypt", role);
    const refreshed = await apiFetch<ScoutingResponse>(`/api/scouting/players?match_id=${matchId}`, {}, "club_demo_egypt", role);
    setData(refreshed);
  };

  const comparedBench = data?.benchmark_players.filter((p) => selectedBenchIds.includes(p.player_id)) || [];

  return (
    <div className="space-y-5">
      {/* Segmented Workspace Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex bg-[#111827] border border-white/[0.08] rounded-xl p-1 text-xs">
          {[
            { id: "benchmark" as SubTab, ar: "مقارنة المواهب العادلة (StatsBomb)", en: "Fair Talent Comparison (StatsBomb)" },
            { id: "video_tracks" as SubTab, ar: "مسارات الفيديو الحالي (خام)", en: "Current Video Tracks (Raw)" },
            { id: "four_point" as SubTab, ar: "معايرة 4 نقاط و 6v6", en: "4-Point & Small-Sided Setup" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-3.5 py-2 rounded-lg font-semibold transition ${
                subTab === t.id ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
              }`}
            >
              {isAr ? t.ar : t.en}
            </button>
          ))}
        </div>

        {data && (
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{isAr ? data.input_gate.warning_ar : data.input_gate.warning_en}</span>
          </div>
        )}
      </div>

      {/* TAB 1: Current Video In-Frame Tracks (Top 10 clean tracks + single top banner, ZERO repeated row badges) */}
      {subTab === "video_tracks" && data && (
        <div className="space-y-4">
          <div className="studio-panel p-3.5 flex flex-wrap items-center justify-between gap-3 border-amber-500/25 bg-amber-500/[0.06] text-xs">
            <div className="flex items-center gap-2 text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {isAr
                  ? "عينة غير كافية للتقييم الكشافي (مقطع أقل من 15 دقيقة) — تُعرض الإحصائيات الفيزيائية الخام داخل الكادر فقط بدون تقييم من 10."
                  : "Sample below 15-min rating threshold — displaying verified raw in-frame physics metrics only (no /10 score)."}
              </span>
            </div>
            {data.video_tracks.length > 10 && (
              <button
                onClick={() => setShowAllTracks((v) => !v)}
                className="px-3 py-1 rounded-lg bg-[#090D16] border border-white/[0.12] text-slate-200 hover:border-emerald-500/50 font-medium tabular-nums"
              >
                {showAllTracks
                  ? isAr ? "عرض أطول 10 مسارات" : "Show Top 10"
                  : isAr ? `عرض الكل (${data.video_tracks.length})` : `Show All (${data.video_tracks.length})`}
              </button>
            )}
          </div>

          <div className="studio-panel overflow-x-auto">
            <table className="w-full text-xs text-start border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-slate-400">
                  <th className="py-3 px-4">{isAr ? "المسار" : "Track"}</th>
                  <th className="py-3 px-3">{isAr ? "المدة داخل الكادر" : "Observed"}</th>
                  <th className="py-3 px-3">{isAr ? "المسافة المقطوعة" : "In-Frame Dist"}</th>
                  <th className="py-3 px-3">{isAr ? "متوسط السرعة" : "Avg Speed"}</th>
                  <th className="py-3 px-3">
                    {isAr ? (
                      <>
                        أقصى سرعة <bdi dir="ltr">(≤ 36)</bdi>
                      </>
                    ) : (
                      "Max Speed"
                    )}
                  </th>
                  <th className="py-3 px-3">{isAr ? "لقطة الإثبات" : "Evidence"}</th>
                </tr>
              </thead>
              <tbody>
                {(showAllTracks ? data.video_tracks : data.video_tracks.slice(0, 10)).map((p) => (
                  <tr key={p.player_id} className="border-b border-white/[0.05] hover:bg-white/[0.02]">
                    <td className="py-2.5 px-4 font-semibold text-white">{p.display_name}</td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-300">
                      <span dir="ltr" className="inline-block">{`${p.observed_seconds}s`}</span>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-200">
                      <span dir="ltr" className="inline-block">{`${p.in_frame_distance_m} m`}</span>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-300">
                      <span dir="ltr" className="inline-block">{`${p.avg_speed_kmh} km/h`}</span>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums font-semibold text-emerald-400">
                      <span dir="ltr" className="inline-block">{`${p.max_speed_kmh} km/h`}</span>
                    </td>
                    <td className="py-2.5 px-3">
                      {p.evidence_clips[0] && (
                        <button
                          onClick={() =>
                            setActiveClip({
                              match_id: p.evidence_clips[0].match_id,
                              frame_id: p.evidence_clips[0].frame_id,
                              track_id: p.evidence_clips[0].track_id,
                              start_s: p.evidence_clips[0].start_s,
                              end_s: p.evidence_clips[0].end_s,
                              title: isAr ? p.evidence_clips[0].title_ar : p.evidence_clips[0].title_en,
                              proof: p.evidence_clips[0].metric_proof,
                            })
                          }
                          className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                        >
                          <Play className="w-3 h-3" />
                          {isAr ? "عرض" : "View"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {activeClip && (
            <div className="studio-panel p-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-center border-emerald-500/30">
              <img
                src={frameImageUrl(activeClip.match_id, activeClip.frame_id, activeClip.track_id)}
                alt="Evidence Frame"
                className="w-full aspect-video object-cover bg-[#090D16] rounded-lg border border-white/[0.1]"
              />
              <video
                key={`${activeClip.match_id}-${activeClip.frame_id}-${activeClip.start_s}`}
                src={matchVideoUrl(activeClip.match_id)}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  e.currentTarget.currentTime = activeClip.start_s;
                }}
                className="w-full rounded-lg border border-white/[0.1] bg-black"
              />
              <div className="space-y-2 text-xs">
                <div className="font-bold text-emerald-400 text-sm">{activeClip.title}</div>
                <div dir="ltr" className="text-slate-300 tabular-nums inline-block">{activeClip.proof}</div>
                <div dir="ltr" className="text-slate-500 tabular-nums">
                  {`Frame #${activeClip.frame_id} • ${activeClip.start_s}s–${activeClip.end_s}s`}
                </div>
                <button
                  type="button"
                  disabled={exportingClip}
                  onClick={() => exportEvidenceMp4(activeClip.match_id, activeClip.start_s, activeClip.end_s)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#090D16] border border-white/[0.12] hover:border-emerald-500/50 text-slate-200 font-semibold disabled:opacity-50"
                >
                  <Film className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{exportingClip ? (isAr ? "جاري التصدير..." : "Exporting...") : isAr ? "تصدير MP4 بعلامة النادي" : "Export Watermarked MP4"}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Verified StatsBomb Open Data Comparison + SVG Radar */}
      {subTab === "benchmark" && data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 studio-panel p-3.5 text-xs">
            <span className="text-emerald-300 font-medium">
              {isAr ? data.benchmark_source_badge_ar : data.benchmark_source_badge_en}
            </span>
            {!isReadOnly && (
              <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#090D16] border border-white/[0.12] hover:border-emerald-500/50 cursor-pointer text-slate-200">
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isAr ? "استيراد CSV (Wyscout / StatsBomb)" : "Import CSV"}</span>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleCsvUpload(e.target.files[0])}
                />
              </label>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {data.benchmark_players.map((p) => {
              const active = selectedBenchIds.includes(p.player_id);
              return (
                <button
                  key={p.player_id}
                  onClick={() =>
                    setSelectedBenchIds((prev) =>
                      prev.includes(p.player_id)
                        ? prev.filter((id) => id !== p.player_id)
                        : prev.length < 4
                        ? [...prev, p.player_id]
                        : prev
                    )
                  }
                  className={`text-xs px-3 py-1.5 rounded-lg border transition tabular-nums ${
                    active
                      ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 font-semibold"
                      : "bg-[#111827] border-white/[0.08] text-slate-400"
                  }`}
                >
                  {p.display_name} • {p.position} ({p.rating_10}/10)
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-4 studio-panel p-4 flex flex-col items-center">
              <div className="text-xs font-semibold text-slate-300 mb-2">
                {isAr ? (
                  <>
                    رادار المقارنة العادلة <bdi dir="ltr">(PAdj + VAEP + xT)</bdi>
                  </>
                ) : (
                  "Fair Scouting Radar (PAdj + VAEP + xT)"
                )}
              </div>
              <SvgRadarChart players={comparedBench} />
              {comparedBench.length > 0 && (
                <div className="w-full flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 mt-3 pt-2.5 border-t border-white/[0.06] text-[11px]">
                  {comparedBench.map((p, idx) => (
                    <span key={p.player_id} className="inline-flex items-center gap-1.5 text-slate-200 font-medium">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: RADAR_COLORS[idx % RADAR_COLORS.length] }}
                      />
                      <span>{p.display_name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-8 space-y-4">
              <div className="studio-panel overflow-x-auto">
                <table className="w-full text-xs text-start border-collapse tabular-nums">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-slate-400">
                      <th className="py-3 px-4">{isAr ? "اللاعب" : "Player"}</th>
                      <th className="py-3 px-2">{isAr ? "الدقائق" : "Min"}</th>
                      <th className="py-3 px-2">{isAr ? "التقييم" : "Rating"}</th>
                      <th className="py-3 px-2">VAEP/90</th>
                      <th className="py-3 px-2">xT/90</th>
                      <th className="py-3 px-2">PAdj Def</th>
                      <th className="py-3 px-2">HIR</th>
                      <th className="py-3 px-2" dir="ltr">D2→PL</th>
                      {!isReadOnly && <th className="py-3 px-2">CRM</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {comparedBench.map((p) => {
                      const inCrm = shortlist.some((it) => it.player_id === p.player_id);
                      return (
                        <tr key={p.player_id} className="border-b border-white/[0.05]">
                          <td className="py-2.5 px-4">
                            <div className="font-bold text-white">{p.display_name}</div>
                            <div className="text-[11px] text-slate-400">
                              {isAr ? p.archetype_ar : p.archetype_en} • {p.team_name}
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-slate-300">{p.minutes_analyzed}</td>
                          <td className="py-2.5 px-2 font-bold text-emerald-400">{p.rating_10}/10</td>
                          <td className="py-2.5 px-2">{p.vaep_per90}</td>
                          <td className="py-2.5 px-2">{p.xt_per90}</td>
                          <td className="py-2.5 px-2">{p.padj_defensive_actions_per90}</td>
                          <td className="py-2.5 px-2">
                            <span dir="ltr" className="inline-block">{`${p.hir_distance_m_per90}m`}</span>
                          </td>
                          <td className="py-2.5 px-2">
                            <span dir="ltr" className="text-sky-300 font-semibold">
                              {p.league_translation_pct ? `${p.league_translation_pct}%` : "—"}
                            </span>
                          </td>
                          {!isReadOnly && (
                            <td className="py-2.5 px-2">
                              <button
                                type="button"
                                onClick={() => toggleShortlist(p)}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] ${
                                  inCrm
                                    ? "bg-amber-500/20 border-amber-400/50 text-amber-300"
                                    : "bg-[#090D16] border-white/[0.1] text-slate-400 hover:text-white"
                                }`}
                              >
                                <Bookmark className="w-3 h-3" />
                                <span>{inCrm ? (isAr ? "مرشح" : "Saved") : isAr ? "إضافة" : "Save"}</span>
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {matchup && matchup.recommended_formations.length > 0 && (
                <div className="studio-panel p-4 space-y-3 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {matchup.recommended_formations.map((f) => (
                      <div key={f.formation} className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3 flex justify-between items-center">
                        <div>
                          <div className="font-bold text-white text-sm tabular-nums">{f.formation}</div>
                          <div className="text-slate-400 mt-0.5">{isAr ? f.style_ar : f.style_en}</div>
                        </div>
                        <span className="text-emerald-400 font-bold tabular-nums">{f.fit_score}%</span>
                      </div>
                    ))}
                  </div>

                  {matchup.starting_xi && matchup.starting_xi.length > 0 && (
                    <div className="border-t border-white/[0.06] pt-3 space-y-1.5">
                      <div className="font-semibold text-slate-200">
                        {isAr ? "التشكيل المقترح المثالي (ILP Starting XI + الكيمياء + التبديل):" : "Optimized Starting XI, Synergy & Timed Sub Plan:"}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {matchup.starting_xi.map((xi) => (
                          <span key={xi.player_id} className="px-2 py-1 rounded-md bg-[#090D16] border border-white/[0.07] text-[11px] text-slate-200">
                            <b className="text-emerald-400">{xi.position}</b> {xi.display_name} ({xi.rating_10})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(matchup.synergy_pairs?.length || matchup.substitution_plan?.length) ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {matchup.synergy_pairs?.[0] && (
                        <div className="bg-[#090D16] border border-emerald-500/20 rounded-lg p-2.5">
                          <div className="font-semibold text-emerald-400">
                            {isAr ? "أقوى ثنائية كيمياء هجومية:" : "Top Attacking Synergy:"}{" "}
                            {matchup.synergy_pairs[0].pair.join(" + ")}
                          </div>
                          <div className="text-slate-400 mt-0.5">
                            {isAr ? matchup.synergy_pairs[0].note_ar : matchup.synergy_pairs[0].note_en} (xT{" "}
                            <bdi dir="ltr">{matchup.synergy_pairs[0].combined_xt_per90}</bdi>)
                          </div>
                        </div>
                      )}
                      {matchup.substitution_plan?.[0] && (
                        <div className="bg-[#090D16] border border-sky-500/20 rounded-lg p-2.5">
                          <div className="font-semibold text-sky-400">
                            {isAr ? `خطة تبديل د.${matchup.substitution_plan[0].minute}:` : `Min ${matchup.substitution_plan[0].minute} Sub:`}{" "}
                            {matchup.substitution_plan[0].player_in}
                          </div>
                          <div className="text-slate-400 mt-0.5">
                            {isAr ? matchup.substitution_plan[0].reason_ar : matchup.substitution_plan[0].reason_en}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Persistent Club Shortlist CRM */}
              <div className="studio-panel p-4 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isAr ? "قائمة مراقبة النادي (Scouting CRM Shortlist)" : "Club Scouting CRM Shortlist"}</span>
                  </div>
                  <span className="text-[11px] text-slate-400 tabular-nums">{shortlist.length} {isAr ? "لاعب" : "saved"}</span>
                </div>
                {shortlist.length === 0 ? (
                  <div className="text-slate-500 text-[11px]">
                    {isAr ? "اضغط «إضافة» بجانب أي لاعب في الجدول لحفظه في متابعة النادي الدائمة." : "Click Save next to any player to store them in the club CRM pipeline."}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {shortlist.map((it) => (
                      <div key={it.player_id} className="flex items-center justify-between gap-2 bg-[#090D16] border border-white/[0.06] rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">{it.display_name} ({it.position})</div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {it.team_name} • {it.rating_10 ?? "—"}/10
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            disabled={isReadOnly}
                            value={it.status}
                            onChange={(e) => updateShortlistStatus(it, e.target.value)}
                            className="bg-[#111827] border border-white/[0.1] rounded px-1.5 py-1 text-[11px] text-slate-200"
                          >
                            <option value="watch">{isAr ? "متابعة" : "Watch"}</option>
                            <option value="priority">{isAr ? "أولوية" : "Priority"}</option>
                            <option value="shortlist">{isAr ? "تفاوض" : "Shortlist"}</option>
                          </select>
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={async () => {
                                const r = await apiFetch<{ items: ShortlistItem[] }>(
                                  `/api/scouting/shortlist/${encodeURIComponent(it.player_id)}`,
                                  { method: "DELETE" },
                                  "club_demo_egypt",
                                  role
                                );
                                setShortlist(r.items || []);
                              }}
                              className="p-1 text-slate-500 hover:text-red-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Interactive 4-Point Homography Calibration & Small-Sided 6v6/11v11 Wizard */}
      {subTab === "four_point" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          <div className="xl:col-span-8 studio-panel p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs px-1">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <Crosshair className="w-4 h-4 text-emerald-400 shrink-0" />
                {isAr ? (
                  <>
                    اسحب الزوايا الأربع <bdi dir="ltr">(TL, TR, BR, BL)</bdi> فوق أركان الملعب لمعايرة الـ{" "}
                    <bdi dir="ltr">Homography</bdi>
                  </>
                ) : (
                  "Drag the 4 corner pins (TL, TR, BR, BL) over pitch corners to calibrate Homography"
                )}
              </span>
            </div>

            <div
              ref={calBoxRef}
              dir="ltr"
              onMouseMove={handleCornerMove}
              onMouseUp={() => setDragCornerIdx(null)}
              onMouseLeave={() => setDragCornerIdx(null)}
              className="relative w-full aspect-video rounded-lg overflow-hidden bg-black border border-white/[0.08] select-none"
            >
              <img
                src={frameImageUrl(matchId, 1250)}
                alt="Calibration Pitch"
                draggable={false}
                className="w-full h-full object-cover"
              />
              {/* Projected Perspective Quad Overlay */}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
                <polygon
                  points={corners.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
                  fill="rgba(16, 185, 129, 0.14)"
                  stroke="#10B981"
                  strokeWidth="0.6"
                />
                {/* Midline projection */}
                <line
                  x1={((corners[0][0] + corners[1][0]) / 2) * 100}
                  y1={((corners[0][1] + corners[1][1]) / 2) * 100}
                  x2={((corners[3][0] + corners[2][0]) / 2) * 100}
                  y2={((corners[3][1] + corners[2][1]) / 2) * 100}
                  stroke="rgba(16, 185, 129, 0.75)"
                  strokeWidth="0.45"
                  strokeDasharray="1.5,1"
                />
              </svg>
              {corners.map(([x, y], idx) => {
                const labels = ["TL", "TR", "BR", "BL"];
                return (
                  <div
                    key={labels[idx]}
                    onMouseDown={() => setDragCornerIdx(idx)}
                    style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-emerald-500 text-slate-950 font-bold text-[10px] flex items-center justify-center shadow-lg cursor-grab active:cursor-grabbing border-2 border-white"
                  >
                    {labels[idx]}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="xl:col-span-4 studio-panel p-4 space-y-4 text-xs">
            <div className="font-bold text-white text-sm">
              {isAr ? "إعدادات الصيغة والفئة العمرية" : "Format & Age-Scaled Rules"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["11v11", "9v9", "7v7", "6v6", "5v5"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFmt(f)}
                  className={`px-3 py-1.5 rounded-lg border tabular-nums ${
                    fmt === f ? "bg-emerald-500 text-slate-950 font-bold border-emerald-400" : "bg-[#090D16] border-white/[0.1] text-slate-300"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <select
              value={age}
              onChange={(e) => setAge(e.target.value as "senior" | "youth" | "u12")}
              className="w-full bg-[#090D16] border border-white/[0.1] rounded-lg px-3 py-2 text-xs"
            >
              <option value="senior">{isAr ? "الفريق الأول (Senior)" : "Senior First Team"}</option>
              <option value="youth">{isAr ? "ناشئين وشباب (U13–U18)" : "Youth (U13–U18)"}</option>
              <option value="u12">{isAr ? "براعم وأكاديميات (U7–U12)" : "U12 Academy"}</option>
            </select>

            {!isReadOnly && (
              <button
                onClick={applyCalibration}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-lg transition"
              >
                {isAr ? (
                  <>
                    احسب معايرة <bdi dir="ltr">4-Point Homography</bdi> واحفظ الإعدادات
                  </>
                ) : (
                  "Compute 4-Point Homography & Save"
                )}
              </button>
            )}

            {setupResult && (
              <div className="bg-[#090D16] border border-emerald-500/30 rounded-lg p-3 space-y-1.5 tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-400">{isAr ? "قاعدة التسلل:" : "Offside Rule:"}</span>
                  <span className="font-semibold text-white">{setupResult.offside_enabled ? (isAr ? "مفعّلة" : "Enabled") : isAr ? "ملغاة (ملعب صغير)" : "Disabled"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{isAr ? "تبديلات مفتوحة:" : "Rolling Subs:"}</span>
                  <span className="font-semibold text-white">{setupResult.rolling_subs ? (isAr ? "نعم" : "Yes") : isAr ? "لا (5 تبديلات)" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{isAr ? "عتبة السبرنت:" : "Sprint Threshold:"}</span>
                  <span dir="ltr" className="font-semibold text-emerald-400 inline-block">
                    {`${setupResult.speed_thresholds.sprint_kmh} km/h`}
                  </span>
                </div>
                {setupResult.homography?.valid && (
                  <div className="flex justify-between pt-1 border-t border-white/[0.06]">
                    <span className="text-slate-400">{isAr ? "مركز الملعب المُعايَر:" : "Calibrated Center:"}</span>
                    <span dir="ltr" className="text-emerald-400 font-semibold inline-block">
                      {`(${setupResult.homography.projected_center_m[0]}m, ${setupResult.homography.projected_center_m[1]}m)`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bench, Rolling Substitutions & Red Card State Manager (Section 17.2) */}
      {subTab === "four_point" && benchState && (
        <div className="studio-panel p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-bold text-white text-sm flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                <span>{isAr ? "محرك الدكة والتغييرات والطرد (Bench & Red-Card State)" : "Bench, Substitutions & Red-Card State"}</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {isAr
                  ? `الصيغة: ${benchState.match_format} • تبديلات مفتوحة: ${benchState.rolling_subs ? "نعم (أكاديميات)" : "لا (5 تبديلات)"}`
                  : `Format: ${benchState.match_format} • Rolling subs: ${benchState.rolling_subs ? "Yes" : "No (5 max)"}`}
              </div>
            </div>
            {!isReadOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleBenchAction("substitute", "team_a")}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 font-semibold"
                >
                  {isAr ? "تنفيذ تبديل (فريق أ)" : "Sub Player (Team A)"}
                </button>
                <button
                  type="button"
                  onClick={() => handleBenchAction("red_card", "team_a")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 font-semibold"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{isAr ? "بطاقة حمراء (فريق أ)" : "Red Card (Team A)"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBenchAction("reset", "team_a")}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#090D16] border border-white/[0.1] text-slate-300 hover:text-white"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{isAr ? "إعادة ضبط" : "Reset"}</span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 tabular-nums">
            <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
              <div className="text-[11px] text-slate-400">{isAr ? "السقف النشط داخل الملعب" : "Active On-Pitch Cap"}</div>
              <div className="text-lg font-bold text-emerald-400 mt-0.5" dir="ltr">
                {`Team A: ${benchState.active_cap_team_a} (${benchState.on_pitch.team_a.length}) • Team B: ${benchState.active_cap_team_b}`}
              </div>
            </div>
            <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
              <div className="text-[11px] text-slate-400">{isAr ? "البدلاء المتاحون" : "Bench Available"}</div>
              <div className="text-xs text-slate-200 mt-1 truncate">
                {benchState.bench.team_a.slice(0, 3).join(" • ") || "—"}
              </div>
            </div>
            <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
              <div className="text-[11px] text-slate-400">{isAr ? "سجل التبديلات والطرد" : "Sub & Card Log"}</div>
              <div className="text-[11px] text-amber-300 mt-1">
                {benchState.events.length === 0
                  ? isAr ? "لا توجد أحداث مسجلة بعد" : "No events yet"
                  : benchState.events.slice(-2).map((ev, i) => (
                      <div key={i}>
                        {ev.type === "red_card"
                          ? `${ev.minute}' RED: ${ev.player_id} (Cap -> ${ev.new_cap})`
                          : `${ev.minute}' SUB: ${ev.player_out} -> ${ev.player_in}`}
                      </div>
                    ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
