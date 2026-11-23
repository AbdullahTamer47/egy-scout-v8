"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Eye,
  FileText,
  Film,
  Globe,
  ShieldCheck,
  UploadCloud,
  Users,
} from "lucide-react";
import AccuracyProofScreen from "@/components/AccuracyProofScreen";
import BroadcastStudioScreen from "@/components/BroadcastStudioScreen";
import FairScoutingScreen from "@/components/FairScoutingScreen";
import QuickAnalysisScreen from "@/components/QuickAnalysisScreen";
import { API_BASE, apiFetch, MatchListItem, UserRole } from "@/lib/api";

type TabKey = "accuracy" | "studio" | "scouting" | "quick";

const FALLBACK_MATCHES: MatchListItem[] = [
  { match_id: "m2_ahly_enppi", team_a_name: "Al Ahly", team_b_name: "ENPPI", fps: 25, has_video: true, has_telemetry: true },
  { match_id: "m1_ahly_sekka", team_a_name: "El Sekka", team_b_name: "Al Ahly", fps: 25, has_video: true, has_telemetry: true },
  { match_id: "m3_enppi_mokawloon", team_a_name: "Al Mokawloon", team_b_name: "ENPPI", fps: 25, has_video: true, has_telemetry: true },
];

export default function HomePage() {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [tab, setTab] = useState<TabKey>("accuracy");
  const [matchId, setMatchId] = useState("m2_ahly_enppi");
  const [matches, setMatches] = useState<MatchListItem[]>(FALLBACK_MATCHES);
  const [role, setRole] = useState<UserRole>("analyst");

  const loadMatches = useCallback(() => {
    apiFetch<{ matches: MatchListItem[] }>("/api/matches", {}, "club_demo_egypt", role)
      .then((res) => {
        if (res.matches?.length) setMatches(res.matches);
      })
      .catch(() => {});
  }, [role]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  const navItems: Array<{ id: TabKey; ar: string; en: string; icon: React.ReactNode }> = [
    { id: "accuracy", ar: "الدقة والهوية", en: "Accuracy & QA", icon: <ShieldCheck className="w-5 h-5" /> },
    { id: "studio", ar: "استوديو البث", en: "Broadcast Studio", icon: <Film className="w-5 h-5" /> },
    { id: "scouting", ar: "الكشافة والمعايرة", en: "Scouting & Setup", icon: <Users className="w-5 h-5" /> },
    { id: "quick", ar: "تحليل مقطع سريع", en: "Quick Clip Analysis", icon: <UploadCloud className="w-5 h-5" /> },
  ];

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen flex bg-[#090D16] text-slate-100">
      {/* Slim Pro Analytics Sidebar (always shows labels from md:768px up) */}
      <aside className="w-16 md:w-56 shrink-0 bg-[#0C1220] border-e border-white/[0.08] flex flex-col justify-between py-4 px-2 md:px-3">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 px-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="hidden md:block leading-tight">
              <div className="text-sm font-extrabold tracking-tight text-white">EGY-SCOUT</div>
              <div className="text-[11px] text-slate-400">Tactical Studio</div>
            </div>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  title={isAr ? item.ar : item.en}
                  className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition ${
                    active
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent"
                  }`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="hidden md:inline truncate">{isAr ? item.ar : item.en}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="hidden md:block px-2 pt-4 border-t border-white/[0.06] text-[11px] text-slate-500">
          {isAr ? "بيانات موثّقة • صفر تخمين" : "Verified Data • Zero Guesses"}
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Slim 52px Top Bar */}
        <header className="h-13 shrink-0 bg-[#0C1220]/90 backdrop-blur border-b border-white/[0.08] px-4 lg:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <select
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              className="bg-[#111827] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100 focus:outline-none focus:border-emerald-500/60"
            >
              {matches.map((m) => (
                <option key={m.match_id} value={m.match_id}>
                  {`${m.team_a_name} × ${m.team_b_name}${m.is_custom ? (isAr ? " (مخصص)" : " (Custom)") : ""}`}
                </option>
              ))}
            </select>

            {isReadOnly && (
              <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-slate-800/90 border border-white/[0.1] text-slate-300">
                <Eye className="w-3.5 h-3.5 text-emerald-400" />
                {role === "player"
                  ? isAr ? "وضع قراءة فقط (حساب اللاعب)" : "Read-Only Mode (Player View)"
                  : isAr ? "وضع قراءة فقط (إدارة النادي)" : "Read-Only Mode (Board View)"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/export-report`}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 bg-[#111827] hover:bg-slate-800 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-400 transition"
            >
              <FileText className="w-3.5 h-3.5" />
              {isAr ? "تقرير النادي" : "Club Report"}
            </a>

            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              aria-label="Role"
              className="bg-[#111827] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60"
            >
              <option value="analyst">{isAr ? "محلل أداء" : "Analyst"}</option>
              <option value="coach">{isAr ? "المدير الفني" : "Head Coach"}</option>
              <option value="scout">{isAr ? "كشاف" : "Scout"}</option>
              <option value="board">{isAr ? "مجلس الإدارة (عرض فقط)" : "Board (Read-Only)"}</option>
              <option value="player">{isAr ? "حساب اللاعب (عرض فقط)" : "Player (Read-Only)"}</option>
            </select>

            <button
              onClick={() => setLang(isAr ? "en" : "ar")}
              className="inline-flex items-center gap-1.5 bg-[#111827] hover:bg-slate-800 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition"
            >
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              {isAr ? "EN" : "عربي"}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
          {tab === "accuracy" && <AccuracyProofScreen lang={lang} matchId={matchId} role={role} />}
          {tab === "studio" && <BroadcastStudioScreen lang={lang} matchId={matchId} role={role} />}
          {tab === "scouting" && <FairScoutingScreen lang={lang} matchId={matchId} role={role} />}
          {tab === "quick" && (
            <QuickAnalysisScreen
              lang={lang}
              role={role}
              onMatchIngested={(newId) => {
                loadMatches();
                setMatchId(newId);
                setTab("studio");
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
