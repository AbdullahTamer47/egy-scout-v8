"use client";

import React, { useCallback, useEffect } from "react";
import { Brain, FolderInput, Search, Video } from "lucide-react";
import { apiFetch, type MatchDetail, type MatchListItem, type TelemetryResponse } from "@/lib/api";
import { useTacticalStore, type StudioTab } from "@/store/useTacticalStore";
import SynchronizedVideoCanvas from "@/components/SynchronizedVideoCanvas";
import PitchMinimap2D from "@/components/PitchMinimap2D";
import HudlTimeline from "@/components/HudlTimeline";
import TacticalMetricsPanel from "@/components/TacticalMetricsPanel";
import TacticalDoctorPanel from "@/components/TacticalDoctorPanel";
import MoneyballScoutPanel from "@/components/MoneyballScoutPanel";
import MatchManagerPanel from "@/components/MatchManagerPanel";

const TABS: { id: StudioTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "studio", label: "استوديو التحليل التكتيكي والـ 3D الحي", icon: Video },
  { id: "doctor", label: "تشخيص المباراة وحلول الكرة المصرية", icon: Brain },
  { id: "moneyball", label: "كشاف المواهب وبدائل الصفقات (Moneyball)", icon: Search },
  { id: "manager", label: "إدارة المباريات والسحب المحلي", icon: FolderInput },
];

export default function HomePage() {
  const activeTab = useTacticalStore((s) => s.activeTab);
  const matches = useTacticalStore((s) => s.matches);
  const selectedMatchId = useTacticalStore((s) => s.selectedMatchId);
  const currentMatch = useTacticalStore((s) => s.currentMatch);

  const setActiveTab = useTacticalStore((s) => s.setActiveTab);
  const setMatches = useTacticalStore((s) => s.setMatches);
  const setSelectedMatchId = useTacticalStore((s) => s.setSelectedMatchId);
  const setCurrentMatch = useTacticalStore((s) => s.setCurrentMatch);
  const setTelemetry = useTacticalStore((s) => s.setTelemetry);

  const loadMatches = useCallback(async () => {
    try {
      const list = await apiFetch<MatchListItem[]>("/api/matches");
      setMatches(list);
      const currId = useTacticalStore.getState().selectedMatchId;
      if (!currId && list.length > 0) {
        const readyOne = list.find((m) => m.status === "ready") || list[0];
        setSelectedMatchId(readyOne.id);
      }
    } catch {
      /* backend offline retry handled silently */
    }
  }, [setMatches, setSelectedMatchId]);

  const loadMatchData = useCallback(
    async (matchId: number) => {
      try {
        const detail = await apiFetch<MatchDetail>(`/api/matches/${matchId}`);
        setCurrentMatch(detail);
        if (detail.status === "ready") {
          const tel = await apiFetch<TelemetryResponse>(`/api/matches/${matchId}/telemetry`);
          setTelemetry(tel.fps, tel.width, tel.height, tel.frames, tel.team_kits || detail.summary?.team_kits);
        } else {
          setTelemetry(detail.fps || 25, detail.width || 1280, detail.height || 720, [], detail.summary?.team_kits);
        }
      } catch {
        /* ignore fetch error */
      }
    },
    [setCurrentMatch, setTelemetry]
  );

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    if (selectedMatchId) {
      void loadMatchData(selectedMatchId);
    }
  }, [selectedMatchId, loadMatchData]);

  const readyMatches = matches.filter((m) => m.status === "ready");

  return (
    <div className="min-h-screen bg-[#070b12] text-slate-100 flex flex-col">
      {/* Enterprise Studio Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#090f1a]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-slate-950 font-black text-base shadow-lg shadow-emerald-500/20">
              ES
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-tight text-white">EGY-SCOUT PRO</h1>
                <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  V3.0 محلي للأندية
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                منصة التحليل التكتيكي ثلاثي الأبعاد وكشاف الدوري المصري الممتاز والمحترفين
              </p>
            </div>
          </div>

          {/* Match Selector Dropdown */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">المباراة النشطة:</label>
            <select
              value={selectedMatchId ?? ""}
              onChange={(e) => setSelectedMatchId(Number(e.target.value) || null)}
              className="max-w-xs rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              {matches.length === 0 && <option value="">لا توجد مباريات مسجلة</option>}
              {matches.map((m) => (
                <option key={m.id} value={m.id}>
                  #{m.id} — {m.title} ({m.status === "ready" ? "جاهز 100%" : m.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 4 Main Arabic RTL Workspace Tabs */}
        <div className="mx-auto flex max-w-[1600px] gap-1.5 overflow-x-auto px-4 pb-2.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition ${
                  active
                    ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "border border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content Body */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 space-y-5">
        {activeTab === "studio" && (
          <div className="space-y-4">
            {readyMatches.length === 0 && currentMatch?.status !== "ready" && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
                <span>
                  المباراة المختارة ({currentMatch?.title || "غير محددة"}) في حالة{" "}
                  <strong>{currentMatch?.status || "غير جاهز"}</strong>. انتقل لتبويب إدارة المباريات لإعادة التحليل أو رفع فيديو MP4 محلي.
                </span>
                <button
                  onClick={() => setActiveTab("manager")}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-slate-950 hover:bg-amber-400"
                >
                  فتح إدارة المباريات
                </button>
              </div>
            )}

            {/* 70% Video + 30% Synced 2D Tactical Radar */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 items-start">
              <div className="xl:col-span-8 space-y-4">
                <SynchronizedVideoCanvas />
                <HudlTimeline />
              </div>
              <div className="xl:col-span-4">
                <PitchMinimap2D />
              </div>
            </div>

            <TacticalMetricsPanel />
          </div>
        )}

        {activeTab === "doctor" && <TacticalDoctorPanel />}

        {activeTab === "moneyball" && <MoneyballScoutPanel />}

        {activeTab === "manager" && (
          <MatchManagerPanel
            onMatchesChanged={() => {
              void loadMatches();
              const cid = useTacticalStore.getState().selectedMatchId;
              if (cid) void loadMatchData(cid);
            }}
            onSelectAndOpenMatch={(id) => {
              setSelectedMatchId(id);
              setActiveTab("studio");
            }}
          />
        )}
      </main>
    </div>
  );
}
