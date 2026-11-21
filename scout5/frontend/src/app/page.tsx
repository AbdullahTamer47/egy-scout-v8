"use client";

import React, { useCallback, useEffect } from "react";
import { Brain, Flame, FolderInput, Search, ShieldCheck, UserCog, Users, Video } from "lucide-react";
import { apiFetch, type MatchItem, type TelemetryResponse } from "@/lib/api";
import { useScoutStore, type StudioTab } from "@/store/useScoutStore";
import PitchOverlayCanvas from "@/components/PitchOverlayCanvas";
import PitchTwin3D from "@/components/PitchTwin3D";
import ForensicsTab from "@/components/ForensicsTab";
import PlayerPortfoliosTab from "@/components/PlayerPortfoliosTab";
import TacticalDirectorTab from "@/components/TacticalDirectorTab";
import ScoutingTab from "@/components/ScoutingTab";
import MatchManagerTab from "@/components/MatchManagerTab";
import PlayerDossierModal from "@/components/PlayerDossierModal";
import MatchLineupModal from "@/components/MatchLineupModal";

const TABS: { id: StudioTab; label: string; badge?: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "studio", label: "استوديو البث 3D الحي", badge: "60FPS AR", icon: Video },
  { id: "forensics", label: "تحليل الأهداف والأخطاء", badge: "جديد", icon: Flame },
  { id: "portfolios", label: "بروفايلات اللاعبين والتقييم", icon: Users },
  { id: "director", label: "غرفة المدير الفني والخطط", icon: Brain },
  { id: "scouting", label: "الكشافة و Moneyball", icon: Search },
  { id: "manager", label: "رفع المباريات", icon: FolderInput },
];

export default function HomePage() {
  const activeTab = useScoutStore((s) => s.activeTab);
  const matches = useScoutStore((s) => s.matches);
  const selectedSlug = useScoutStore((s) => s.selectedSlug);
  const currentMatch = useScoutStore((s) => s.currentMatch);
  const refreshSeq = useScoutStore((s) => s.refreshSeq);
  const setActiveTab = useScoutStore((s) => s.setActiveTab);
  const setMatches = useScoutStore((s) => s.setMatches);
  const setSelectedSlug = useScoutStore((s) => s.setSelectedSlug);
  const setCurrentMatch = useScoutStore((s) => s.setCurrentMatch);
  const setTelemetry = useScoutStore((s) => s.setTelemetry);
  const setSelectedIdentityKey = useScoutStore((s) => s.setSelectedIdentityKey);
  const openVideoDossier = useScoutStore((s) => s.openVideoDossier);
  const setShowLineupModal = useScoutStore((s) => s.setShowLineupModal);

  const loadMatches = useCallback(async () => {
    try {
      const list = await apiFetch<MatchItem[]>("/api/matches");
      setMatches(list);
      if (!useScoutStore.getState().selectedSlug && list.length > 0) {
        const ready = list.find((m) => m.status === "ready") || list[0];
        setSelectedSlug(ready.slug);
      }
    } catch {
      /* backend starting */
    }
  }, [setMatches, setSelectedSlug]);

  const loadMatch = useCallback(
    async (slug: string) => {
      try {
        const detail = await apiFetch<MatchItem>(`/api/matches/${slug}`);
        setCurrentMatch(detail);
        if (detail.status === "ready") {
          const tel = await apiFetch<TelemetryResponse>(`/api/matches/${slug}/telemetry`);
          setTelemetry(tel.frames, tel.team_kits, tel.timeline_events, tel.bound_players);
        } else {
          setTelemetry([], {}, [], {});
        }
      } catch {
        /* ignore */
      }
    },
    [setCurrentMatch, setTelemetry]
  );

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    if (selectedSlug) void loadMatch(selectedSlug);
  }, [selectedSlug, refreshSeq, loadMatch]);

  const topStudioPlayers = (currentMatch?.summary?.player_portfolios || []).slice(0, 6);
  const hc = String(currentMatch?.home_team_cluster ?? 0);

  return (
    <div className="min-h-screen text-slate-100 flex flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#070c16]/95 backdrop-blur-xl shadow-lg shadow-black/40">
        <div className="mx-auto flex max-w-[1640px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-500 font-black text-slate-950 shadow-lg shadow-emerald-500/20">
              V6
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-white">EGY-SCOUT PRO</h1>
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                  PnLCalib 3D AR • Re-ID + OCR • Moneyball
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                منصة الأندية الكبرى للتحليل التكتيكي ثلاثي الأبعاد وبروفايلات اللاعبين واستكشاف الدرجة الثانية
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {currentMatch && currentMatch.status === "ready" && (
              <button
                onClick={() => setShowLineupModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/45 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-black text-cyan-200 hover:bg-cyan-500/25 transition"
              >
                <UserCog className="h-3.5 w-3.5" />
                التشكيلة والأسماء التلقائية
              </button>
            )}
            {currentMatch && currentMatch.status === "ready" && (
              <div className="hidden xl:flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-[11px] tabular-nums">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-slate-400">دقة المعايرة:</span>
                <strong className="font-mono text-cyan-300">{currentMatch.median_rep_err_px ?? "—"} px</strong>
                <span className="text-slate-700">|</span>
                <span className="text-slate-400">التغطية:</span>
                <strong className="font-mono text-emerald-300">{currentMatch.cal_coverage_pct}%</strong>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="text-slate-400 font-bold">المباراة:</label>
              <select
                value={selectedSlug ?? ""}
                onChange={(e) => setSelectedSlug(e.target.value || null)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 font-bold text-slate-100 focus:border-emerald-400 focus:outline-none"
              >
                {matches.length === 0 && <option value="">لا توجد مباريات</option>}
                {matches.map((m) => (
                  <option key={m.slug} value={m.slug}>
                    {m.title} ({m.cal_coverage_pct}% معايرة)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Navigation Dock */}
        <div className="mx-auto flex max-w-[1640px] gap-1.5 overflow-x-auto px-4 pb-2.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${
                  active
                    ? "bg-gradient-to-l from-emerald-400 to-teal-400 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "border border-slate-800/90 bg-slate-900/75 text-slate-300 hover:border-slate-600 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                {t.badge && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
                      active ? "bg-slate-950/20 text-slate-950" : "bg-emerald-500/20 text-emerald-300"
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1640px] flex-1 p-4 space-y-4">
        {activeTab === "studio" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
              <div className="min-w-0 lg:col-span-8">
                <PitchOverlayCanvas />
              </div>
              <div className="min-w-0 lg:col-span-4 space-y-3">
                <PitchTwin3D />

                {/* Quick Top Tracked Players Spotlight Strip */}
                {topStudioPlayers.length > 0 && (
                  <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-black text-white">أبرز لاعبي المباراة (اضغط للـ Spotlight / البروفايل)</span>
                      <button
                        onClick={() => setActiveTab("portfolios")}
                        className="text-[11px] font-bold text-emerald-300 hover:underline"
                      >
                        عرض الكل ({currentMatch?.summary?.player_portfolios?.length || 0})
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {topStudioPlayers.map((p) => {
                        const tName =
                          String(p.team_id) === hc
                            ? currentMatch?.home_team_name || "فريق 1"
                            : currentMatch?.away_team_name || "فريق 2";
                        return (
                          <div
                            key={p.identity_key}
                            onClick={() => setSelectedIdentityKey(p.identity_key)}
                            onDoubleClick={() => openVideoDossier(p.identity_key)}
                            className="cursor-pointer rounded-xl border border-slate-800 bg-slate-950/80 p-2 text-[11px] hover:border-cyan-400/60 transition"
                          >
                            <div className="flex items-center justify-between font-bold text-white gap-1">
                              <span className="truncate">
                                {p.display_name || p.bound_player?.name || (p.jersey_ocr ? `#${p.jersey_ocr}` : p.identity_key)}
                              </span>
                              <span className="font-mono text-emerald-300 font-black shrink-0">{p.scorecard.overall_score}</span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-400">
                              <span className="truncate">
                                {tName} • {p.inferred_role_code}
                              </span>
                              <span className="font-mono text-amber-300">{p.max_speed_kmh} كم/س</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "forensics" && <ForensicsTab />}
        {activeTab === "portfolios" && <PlayerPortfoliosTab />}
        {activeTab === "director" && <TacticalDirectorTab />}
        {activeTab === "scouting" && <ScoutingTab />}
        {activeTab === "manager" && (
          <MatchManagerTab
            onOpenMatch={(slug) => {
              setSelectedSlug(slug);
              setActiveTab("studio");
            }}
          />
        )}
      </main>

      {/* Global Executive Individual Player Dossier & Semi-Auto Lineup Modals */}
      <PlayerDossierModal />
      <MatchLineupModal />
    </div>
  );
}
