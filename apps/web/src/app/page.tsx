"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  Eye,
  FileText,
  Film,
  Globe,
  Keyboard,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import BroadcastStudioScreen from "@/components/BroadcastStudioScreen";
import TacticalAIChatbot from "@/components/TacticalAIChatbot";
import CompetitorBenchmarkModal from "@/components/CompetitorBenchmarkModal";
import {
  API_BASE,
  apiFetch,
  FormationBlueprintPayload,
  MatchListItem,
  PlayerCardSummary,
  UserRole,
} from "@/lib/api";

const PlayersScreen = dynamic(() => import("@/components/PlayersScreen"), {
  ssr: false,
  loading: () => (
    <div className="studio-panel p-8 text-center text-xs text-slate-400 animate-pulse">
      Loading Players...
    </div>
  ),
});

const QuickAnalysisScreen = dynamic(() => import("@/components/QuickAnalysisScreen"), {
  ssr: false,
  loading: () => (
    <div className="studio-panel p-8 text-center text-xs text-slate-400 animate-pulse">
      Loading Import Studio...
    </div>
  ),
});

const AccuracyProofScreen = dynamic(() => import("@/components/AccuracyProofScreen"), {
  ssr: false,
  loading: () => (
    <div className="studio-panel p-8 text-center text-xs text-slate-400 animate-pulse">
      Loading Identity QA...
    </div>
  ),
});

type TabKey = "studio" | "players" | "quick" | "accuracy";

export default function HomePage() {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [tab, setTab] = useState<TabKey>("studio");
  const [matchId, setMatchId] = useState("m2_ahly_enppi");
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [apiOffline, setApiOffline] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [role, setRole] = useState<UserRole>("analyst");
  const [chatOpen, setChatOpen] = useState(false);
  const [aiBlueprint, setAiBlueprint] = useState<FormationBlueprintPayload | null>(null);
  const [jumpTimeSec, setJumpTimeSec] = useState<number | null>(null);
  const [pinnedStudioCard, setPinnedStudioCard] = useState<PlayerCardSummary | null>(null);
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);

  const [moreOpen, setMoreOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const loadMatches = useCallback(() => {
    setLoadingMatches(true);
    apiFetch<{ matches: MatchListItem[] }>("/api/matches", {}, "club_demo_egypt", role)
      .then((res) => {
        const list = res.matches || [];
        setMatches(list);
        setApiOffline(false);
        if (list.length > 0) {
          setMatchId((prev) => (list.some((m) => m.match_id === prev) ? prev : list[0].match_id));
        }
      })
      .catch(() => {
        setApiOffline(true);
        setMatches([]);
      })
      .finally(() => setLoadingMatches(false));
  }, [role]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || tag === "select";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        setCmdQuery("");
        return;
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
        setShortcutsOpen(false);
        setMoreOpen(false);
        return;
      }
      if (!isInput && e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.documentElement.dir = isAr ? "rtl" : "ltr";
    }
  }, [lang, isAr]);

  const navItems: Array<{ id: TabKey; ar: string; en: string; icon: React.ReactNode }> = [
    { id: "studio", ar: "الاستوديو", en: "Studio", icon: <Film className="w-5 h-5" /> },
    { id: "players", ar: "اللاعبين", en: "Players", icon: <Users className="w-5 h-5" /> },
    { id: "quick", ar: "استيراد مباراة", en: "Import", icon: <UploadCloud className="w-5 h-5" /> },
    { id: "accuracy", ar: "مراجعة الهويات", en: "Identity QA", icon: <ShieldCheck className="w-5 h-5" /> },
  ];

  const customMatches = matches.filter((m) => Boolean(m.is_custom || m.match_id.startsWith("custom_")));
  const demoMatches = matches.filter((m) => !Boolean(m.is_custom || m.match_id.startsWith("custom_")));
  const activeMatch = matches.find((m) => m.match_id === matchId);

  const cmdActions = [
    { id: "go-studio", label: isAr ? "الانتقال إلى الاستوديو" : "Go to Studio", run: () => setTab("studio") },
    { id: "go-players", label: isAr ? "الانتقال إلى كروت اللاعبين" : "Go to Player Cards", run: () => setTab("players") },
    { id: "go-quick", label: isAr ? "استيراد مباراة أو رابط فيديو" : "Import Match Video / URL", run: () => setTab("quick") },
    { id: "go-qa", label: isAr ? "مراجعة الهويات وعزل الحكام" : "Open Identity QA", run: () => setTab("accuracy") },
    { id: "toggle-chat", label: isAr ? "فتح / إغلاق المساعد التكتيكي" : "Toggle AI Tactical Analyst", run: () => setChatOpen((v) => !v) },
    { id: "benchmark", label: isAr ? "مقارنة مع المنصات العالمية" : "Compare vs Global Platforms", run: () => setBenchmarkOpen(true) },
    { id: "shortcuts", label: isAr ? "عرض اختصارات الكيبورد" : "Show Keyboard Shortcuts", run: () => setShortcutsOpen(true) },
    ...matches.map((m) => ({
      id: `match-${m.match_id}`,
      label: `${isAr ? "مباراة:" : "Match:"} ${isAr ? m.title_ar || m.team_a_name : `${m.team_a_name} vs ${m.team_b_name}`}`,
      run: () => setMatchId(m.match_id),
    })),
  ].filter((a) => !cmdQuery.trim() || a.label.toLowerCase().includes(cmdQuery.toLowerCase()));

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen flex bg-[#090D16] text-slate-100 overflow-x-hidden">
      {/* Clean 4-Tab Pro Sidebar (Desktop/Tablet) */}
      <aside className="hidden md:flex w-52 shrink-0 bg-[#0C1220] border-e border-white/[0.08] flex-col justify-between py-4 px-3">
        <div className="space-y-6">
          <div className="flex items-center gap-2.5 px-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="hidden md:block leading-tight">
              <div className="text-sm font-extrabold tracking-tight text-white">EGY-SCOUT</div>
              <div className="text-[11px] text-emerald-400 font-semibold">Pro Studio</div>
            </div>
          </div>

          <nav className="space-y-1.5" aria-label={isAr ? "التنقل الرئيسي" : "Main navigation"}>
            {navItems.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  title={isAr ? item.ar : item.en}
                  aria-current={active ? "page" : undefined}
                  className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-semibold transition ${
                    active
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/35"
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

        <div className="hidden md:block space-y-2 px-1 pt-4 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.05] border border-white/[0.08] text-[11px] text-slate-400 hover:text-white transition"
          >
            <span className="flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isAr ? "بحث سريع" : "Quick Search"}</span>
            </span>
            <kbd dir="ltr" className="px-1.5 py-0.5 rounded bg-white/[0.07] text-[10px] font-mono">
              Ctrl+K
            </kbd>
          </button>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Single Clean Header Row */}
        <header className="shrink-0 bg-[#0C1220]/95 backdrop-blur border-b border-white/[0.08] px-4 lg:px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Start: Match Selector + New Match CTA */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2 bg-[#111827] border border-white/[0.1] rounded-xl px-3 py-1.5">
                {activeMatch && (
                  <span className="flex items-center -space-x-1 rtl:space-x-reverse shrink-0" aria-hidden="true">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/50 inline-block"
                      style={{ backgroundColor: activeMatch.kit_colors?.team_a_hex || "#EF4444" }}
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/50 inline-block"
                      style={{ backgroundColor: activeMatch.kit_colors?.team_b_hex || "#38BDF8" }}
                    />
                  </span>
                )}
                <select
                  value={matchId}
                  onChange={(e) => setMatchId(e.target.value)}
                  disabled={matches.length === 0}
                  aria-label={isAr ? "اختيار المباراة" : "Select match"}
                  className="bg-transparent text-xs font-bold text-slate-100 focus:outline-none max-w-[260px] truncate"
                >
                  {matches.length === 0 ? (
                    <option value={matchId} className="bg-[#0C1220]">
                      {loadingMatches ? (isAr ? "جاري تحميل المباريات..." : "Loading matches...") : isAr ? "لا توجد مباريات" : "No matches"}
                    </option>
                  ) : (
                    <>
                      {customMatches.length > 0 && (
                        <optgroup label={isAr ? "مبارياتي" : "My Matches"} className="bg-[#0C1220] text-emerald-300">
                          {customMatches.map((m) => (
                            <option key={m.match_id} value={m.match_id} className="bg-[#0C1220] text-slate-100">
                              {isAr ? m.title_ar || `${m.team_a_name} × ${m.team_b_name}` : `${m.team_a_name} × ${m.team_b_name}`}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {demoMatches.length > 0 && (
                        <optgroup label={isAr ? "أمثلة تجريبية" : "Demo Samples"} className="bg-[#0C1220] text-slate-400">
                          {demoMatches.map((m) => (
                            <option key={m.match_id} value={m.match_id} className="bg-[#0C1220] text-slate-100">
                              {isAr ? m.title_ar || `${m.team_a_name} × ${m.team_b_name}` : `${m.team_a_name} × ${m.team_b_name}`}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  )}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setTab("quick")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold border transition ${
                  tab === "quick"
                    ? "bg-emerald-500 text-slate-950 border-emerald-400"
                    : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40"
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isAr ? "مباراة جديدة" : "New Match"}</span>
              </button>

              {isReadOnly && (
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-slate-800/90 border border-white/[0.1] text-slate-300">
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    {role === "player"
                      ? isAr ? "معاينة: حساب اللاعب" : "Preview: Player"
                      : isAr ? "معاينة: الإدارة" : "Preview: Board"}
                  </span>
                </span>
              )}
            </div>

            {/* End: AI Assistant + Language + More Menu */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setChatOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition ${
                  chatOpen
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300"
                }`}
              >
                <Bot className="w-4 h-4" />
                <span>{isAr ? "المساعد الذكي" : "AI Analyst"}</span>
              </button>

              <button
                type="button"
                onClick={() => setLang(isAr ? "en" : "ar")}
                aria-label={isAr ? "تبديل اللغة إلى الإنجليزية" : "Switch to Arabic"}
                className="inline-flex items-center gap-1.5 bg-[#111827] hover:bg-slate-800 border border-white/[0.1] rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition"
              >
                <Globe className="w-3.5 h-3.5 text-slate-400" />
                <span>{isAr ? "EN" : "عربي"}</span>
              </button>

              {/* More Overflow Menu */}
              <div className="relative" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  aria-label={isAr ? "المزيد" : "More options"}
                  className="inline-flex items-center gap-1 bg-[#111827] hover:bg-slate-800 border border-white/[0.1] rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition"
                >
                  <MoreHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">{isAr ? "المزيد" : "More"}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {moreOpen && (
                  <div
                    role="menu"
                    className="absolute end-0 mt-2 w-64 rounded-2xl bg-[#0C1220] border border-white/[0.12] shadow-2xl p-2 space-y-1 z-50 text-xs"
                  >
                    <a
                      role="menuitem"
                      href={`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/export-report?audience=${role === "player" ? "player" : "admin"}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setMoreOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/[0.06] text-emerald-300 font-semibold"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{isAr ? "تقرير النادي الكامل" : "Club Report"}</span>
                    </a>
                    {role !== "player" && (
                      <a
                        role="menuitem"
                        href={`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/export-report?audience=player`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setMoreOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/[0.06] text-sky-300 font-semibold"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>{isAr ? "نسخة تقرير اللاعب" : "Player Report"}</span>
                      </a>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        setBenchmarkOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/[0.06] text-amber-300 font-semibold"
                    >
                      <span className="flex items-center gap-2">
                        <Trophy className="w-3.5 h-3.5 text-amber-400" />
                        <span>{isAr ? "مقارنة المنصات العالمية" : "Global Benchmark"}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        setCmdOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/[0.06] text-slate-200"
                    >
                      <span className="flex items-center gap-2">
                        <Search className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{isAr ? "لوحة الأوامر" : "Command Palette"}</span>
                      </span>
                      <kbd dir="ltr" className="text-[10px] text-slate-400 font-mono">Ctrl+K</kbd>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        setShortcutsOpen(true);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-white/[0.06] text-slate-200"
                    >
                      <span className="flex items-center gap-2">
                        <Keyboard className="w-3.5 h-3.5 text-sky-400" />
                        <span>{isAr ? "اختصارات الكيبورد" : "Keyboard Shortcuts"}</span>
                      </span>
                      <kbd className="text-[10px] text-slate-400 font-mono">?</kbd>
                    </button>

                    <div className="border-t border-white/[0.08] pt-2 mt-1 px-2 pb-1 space-y-1">
                      <label htmlFor="role-preview-select" className="block text-[10.5px] text-slate-400 font-semibold">
                        {isAr ? "عرض كـ (معاينة الواجهة فقط):" : "View as (UI Preview only):"}
                      </label>
                      <select
                        id="role-preview-select"
                        value={role}
                        onChange={(e) => setRole(e.target.value as UserRole)}
                        className="w-full bg-[#111827] border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60"
                      >
                        <option value="analyst">{isAr ? "محلل أداء" : "Analyst"}</option>
                        <option value="coach">{isAr ? "المدير الفني" : "Head Coach"}</option>
                        <option value="scout">{isAr ? "كشاف" : "Scout"}</option>
                        <option value="board">{isAr ? "مجلس الإدارة (عرض فقط)" : "Board (Read-Only)"}</option>
                        <option value="player">{isAr ? "حساب اللاعب (عرض فقط)" : "Player (Read-Only)"}</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Honest Server Offline Banner (Never fakes matches) */}
        {apiOffline && (
          <div
            role="alert"
            className="mx-4 lg:mx-6 mt-4 rounded-xl bg-rose-500/15 border border-rose-500/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2 text-rose-200 font-semibold">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                {isAr
                  ? "السيرفر غير متصل — شغّل start_egy_scout.bat"
                  : "Backend server offline — run start_egy_scout.bat"}
              </span>
            </div>
            <button
              type="button"
              onClick={loadMatches}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{isAr ? "إعادة المحاولة" : "Retry"}</span>
            </button>
          </div>
        )}

        <main className="flex-1 p-3 sm:p-4 lg:p-6 pb-24 md:pb-6 max-w-[1600px] w-full mx-auto">
          {tab === "studio" && (
            <BroadcastStudioScreen
              lang={lang}
              matchId={matchId}
              role={role}
              externalBlueprint={aiBlueprint}
              jumpToTimeSec={jumpTimeSec}
              onJumpHandled={() => setJumpTimeSec(null)}
              pinnedCard={pinnedStudioCard}
              onClearPinnedCard={() => setPinnedStudioCard(null)}
            />
          )}
          {tab === "players" && (
            <PlayersScreen
              lang={lang}
              matchId={matchId}
              role={role}
              onJumpToClip={(tSec) => {
                setJumpTimeSec(tSec);
                setTab("studio");
              }}
              onNavigateQA={() => setTab("accuracy")}
              onPinCardToStudio={(card) => {
                setPinnedStudioCard(card);
                setTab("studio");
              }}
            />
          )}
          {tab === "quick" && (
            <QuickAnalysisScreen
              lang={lang}
              role={role}
              onMatchIngested={(newId) => {
                loadMatches();
                setMatchId(newId);
                setTab("accuracy");
              }}
            />
          )}
          {tab === "accuracy" && <AccuracyProofScreen lang={lang} matchId={matchId} role={role} />}
        </main>

        {/* Grounded AI Tactical Chatbot */}
        <TacticalAIChatbot
          lang={lang}
          matchId={matchId}
          matchTitleAr={
            activeMatch?.title_ar ||
            `${activeMatch?.team_a_name || "Team A"} × ${activeMatch?.team_b_name || "Team B"}`
          }
          role={role}
          isOpen={chatOpen}
          onToggleOpen={() => setChatOpen((v) => !v)}
          onNavigateTab={(targetTab) => setTab(targetTab === "scouting" ? "players" : targetTab)}
          onAiBlueprintDrawn={(bp) => {
            setAiBlueprint(bp);
            setTab("studio");
          }}
        />
      </div>

      {/* Command Palette Modal (Ctrl+K) */}
      {cmdOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isAr ? "لوحة الأوامر" : "Command Palette"}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 px-4"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-[#0C1220] border border-emerald-500/40 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.08]">
              <Search className="w-4 h-4 text-emerald-400" />
              <input
                autoFocus
                type="text"
                value={cmdQuery}
                onChange={(e) => setCmdQuery(e.target.value)}
                placeholder={isAr ? "ابحث عن صفحة، مباراة، أو أداة..." : "Search pages, matches, tools..."}
                className="flex-1 bg-transparent text-sm text-white focus:outline-none"
              />
              <button
                type="button"
                aria-label={isAr ? "إغلاق" : "Close"}
                onClick={() => setCmdOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2 space-y-1">
              {cmdActions.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => {
                    act.run();
                    setCmdOpen(false);
                  }}
                  className="w-full text-start px-3 py-2 rounded-xl text-xs font-semibold text-slate-200 hover:bg-emerald-500/20 hover:text-emerald-300 transition flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{act.label}</span>
                </button>
              ))}
              {cmdActions.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-500">
                  {isAr ? "لا توجد أوامر مطابقة." : "No matching commands."}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal (?) */}
      {shortcutsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isAr ? "اختصارات الكيبورد" : "Keyboard Shortcuts"}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#0C1220] border border-sky-500/40 shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-extrabold text-sm text-white">
                <Keyboard className="w-4 h-4 text-sky-400" />
                <span>{isAr ? "اختصارات الكيبورد" : "Keyboard Shortcuts"}</span>
              </div>
              <button
                type="button"
                aria-label={isAr ? "إغلاق" : "Close"}
                onClick={() => setShortcutsOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 text-xs">
              {[
                ["Ctrl + K", isAr ? "لوحة الأوامر السريعة" : "Open Command Palette"],
                ["Space", isAr ? "تشغيل / إيقاف الفيديو" : "Play / Pause video"],
                ["← / →", isAr ? "تقديم أو تأخير فريم واحد" : "Step backward / forward 1 frame"],
                ["S", isAr ? "تسليط الضوء المتتبع" : "Motion-Tracked Spotlight"],
                ["G", isAr ? "تحريك الشبح التكتيكي" : "Ghost What-If tool"],
                ["A", isAr ? "رسم سهم تكتيكي" : "Draw tactical arrow"],
                ["Z", isAr ? "العدسة المكبّرة" : "Pinned Zoom Loupe"],
                ["T", isAr ? "تكويد اللقطة الحالية" : "Tag current moment"],
                ["Ctrl+Z / Ctrl+Y", isAr ? "تراجع / إعادة في مرسم الخطط" : "Undo / Redo on Tactical Board"],
                ["?", isAr ? "قائمة الاختصارات" : "Show shortcuts modal"],
              ].map(([k, desc]) => (
                <div key={k} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-[#090D16] border border-white/[0.06]">
                  <span className="text-slate-300">{desc}</span>
                  <kbd dir="ltr" className="px-2 py-0.5 rounded bg-white/[0.08] text-emerald-300 font-mono text-[11px] font-bold">
                    {k}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label={isAr ? "التنقل السريع للموبايل" : "Mobile bottom navigation"}
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0C1220]/95 backdrop-blur-md border-t border-white/[0.1] grid grid-cols-4 px-1 py-1.5"
      >
        {navItems.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg text-[10.5px] font-bold transition ${
                active ? "text-emerald-400 bg-emerald-500/15" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {item.icon}
              <span className="truncate max-w-[84px]">
                {isAr ? (item.id === "accuracy" ? "الهويات" : item.ar) : item.en}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Global Platform Benchmark Modal */}
      <CompetitorBenchmarkModal open={benchmarkOpen} onClose={() => setBenchmarkOpen(false)} lang={lang} />
    </div>
  );
}
