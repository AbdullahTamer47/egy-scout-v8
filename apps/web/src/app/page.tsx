"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  Compass,
  Eye,
  FileText,
  Film,
  Globe,
  Keyboard,
  PlusCircle,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import AccuracyProofScreen from "@/components/AccuracyProofScreen";
import BroadcastStudioScreen from "@/components/BroadcastStudioScreen";
import FairScoutingScreen from "@/components/FairScoutingScreen";
import QuickAnalysisScreen from "@/components/QuickAnalysisScreen";
import TacticalAIChatbot from "@/components/TacticalAIChatbot";
import {
  API_BASE,
  apiFetch,
  FormationBlueprintPayload,
  MatchListItem,
  UserRole,
  WorkspaceMode,
} from "@/lib/api";

type TabKey = "accuracy" | "studio" | "scouting" | "quick";

const FALLBACK_MATCHES: MatchListItem[] = [
  {
    match_id: "m2_ahly_enppi",
    team_a_name: "Al Ahly",
    team_b_name: "ENPPI",
    team_a_name_ar: "الأهلي",
    team_b_name_ar: "إنبي",
    title_ar: "الأهلي × إنبي (الدوري المصري)",
    kit_colors: { team_a_hex: "#EF4444", team_b_hex: "#38BDF8" },
    fps: 25,
    has_video: true,
    has_telemetry: true,
  },
  {
    match_id: "m1_ahly_sekka",
    team_a_name: "El Sekka",
    team_b_name: "Al Ahly",
    team_a_name_ar: "السكة الحديد",
    team_b_name_ar: "الأهلي",
    title_ar: "الأهلي × السكة الحديد (3-0)",
    kit_colors: { team_a_hex: "#F59E0B", team_b_hex: "#EF4444" },
    fps: 25,
    has_video: true,
    has_telemetry: true,
  },
  {
    match_id: "m3_enppi_mokawloon",
    team_a_name: "Al Mokawloon",
    team_b_name: "ENPPI",
    team_a_name_ar: "المقاولون العرب",
    team_b_name_ar: "إنبي",
    title_ar: "إنبي × المقاولون العرب (الدوري المصري)",
    kit_colors: { team_a_hex: "#FACC15", team_b_hex: "#38BDF8" },
    fps: 25,
    has_video: true,
    has_telemetry: true,
  },
];

export default function HomePage() {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [tab, setTab] = useState<TabKey>("studio");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("analyst");
  const [matchId, setMatchId] = useState("m2_ahly_enppi");
  const [matches, setMatches] = useState<MatchListItem[]>(FALLBACK_MATCHES);
  const [role, setRole] = useState<UserRole>("analyst");
  const [chatOpen, setChatOpen] = useState(false);
  const [aiBlueprint, setAiBlueprint] = useState<FormationBlueprintPayload | null>(null);
  const [jumpTimeSec, setJumpTimeSec] = useState<number | null>(null);

  // V8.3 Command Palette (Ctrl+K) & Keyboard Cheatsheet (?)
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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

  // Global Keyboard Shortcuts: Ctrl+K (Command Palette), ? (Cheatsheet), Escape (Close modals)
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

  const handleWorkspaceModeChange = (mode: WorkspaceMode) => {
    setWorkspaceMode(mode);
    if (mode === "coach") {
      setTab("studio");
    } else if (mode === "scout") {
      setTab("scouting");
    }
  };

  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  const navItems: Array<{ id: TabKey; ar: string; en: string; icon: React.ReactNode; hideInCoach?: boolean }> = [
    { id: "studio", ar: "استوديو البث والخطط", en: "Broadcast & Tactics", icon: <Film className="w-5 h-5" /> },
    { id: "accuracy", ar: "الدقة وتأكيد الهوية", en: "Accuracy & QA", icon: <ShieldCheck className="w-5 h-5" />, hideInCoach: true },
    { id: "scouting", ar: "الكشافة والمقارنات", en: "Scouting & H2H", icon: <Users className="w-5 h-5" /> },
    { id: "quick", ar: "استيراد مباراة جديدة", en: "Import New Match", icon: <UploadCloud className="w-5 h-5" /> },
  ];

  const activeNavItems = navItems.filter((it) => !(workspaceMode === "coach" && it.hideInCoach));

  // Command palette actions
  const cmdActions = [
    { id: "go-studio", label: isAr ? "📺 افتح استوديو البث ومرسم الـ 22 لاعباً" : "📺 Open Broadcast Studio & Tactical Board", run: () => setTab("studio") },
    { id: "go-qa", label: isAr ? "🛡️ افتح عزل الحكام وورقة تأكيد الهوية (QA)" : "🛡️ Open Referee Isolation & Identity QA", run: () => setTab("accuracy") },
    { id: "go-scout", label: isAr ? "🎯 افتح الكشافة والمقارنة وجهاً لوجه (H2H)" : "🎯 Open Fair Scouting & Head-to-Head", run: () => setTab("scouting") },
    { id: "go-quick", label: isAr ? "⚡ استيراد فيديو MP4 أو رابط YouTube جديد" : "⚡ Import New MP4 or YouTube Match", run: () => setTab("quick") },
    { id: "mode-coach", label: isAr ? "👔 التبديل إلى وضع المدرب السريع (Coach Mode)" : "👔 Switch to Coach Quick Mode", run: () => handleWorkspaceModeChange("coach") },
    { id: "mode-analyst", label: isAr ? "🔬 التبديل إلى وضع المحلل الكامل (Analyst Pro)" : "🔬 Switch to Analyst Pro Mode", run: () => handleWorkspaceModeChange("analyst") },
    { id: "mode-scout", label: isAr ? "🔎 التبديل إلى وضع الكشاف (Scout Mode)" : "🔎 Switch to Scout Mode", run: () => handleWorkspaceModeChange("scout") },
    { id: "toggle-chat", label: isAr ? "🤖 فتح / إغلاق المساعد التكتيكي الذكي" : "🤖 Toggle AI Tactical Assistant", run: () => setChatOpen((v) => !v) },
    { id: "shortcuts", label: isAr ? "⌨️ عرض اختصارات الكيبورد الاحترافية" : "⌨️ Show Pro Keyboard Shortcuts", run: () => setShortcutsOpen(true) },
    ...matches.map((m) => ({
      id: `match-${m.match_id}`,
      label: `${isAr ? "⚽ انتقل لمباراة:" : "⚽ Switch match:"} ${isAr ? m.title_ar || m.team_a_name : `${m.team_a_name} vs ${m.team_b_name}`}`,
      run: () => setMatchId(m.match_id),
    })),
  ].filter((a) => !cmdQuery.trim() || a.label.toLowerCase().includes(cmdQuery.toLowerCase()));

  const onboardingStep = tab === "quick" ? 1 : tab === "accuracy" ? 2 : 3;

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="min-h-screen flex bg-[#090D16] text-slate-100">
      {/* Slim Pro Analytics Sidebar */}
      <aside className="w-16 md:w-56 shrink-0 bg-[#0C1220] border-e border-white/[0.08] flex flex-col justify-between py-4 px-2 md:px-3">
        <div className="space-y-5">
          <div className="flex items-center gap-2.5 px-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <Activity className="w-4 h-4" />
            </div>
            <div className="hidden md:block leading-tight">
              <div className="text-sm font-extrabold tracking-tight text-white">EGY-SCOUT</div>
              <div className="text-[11px] text-emerald-400 font-semibold">V9.0 Pro Studio</div>
            </div>
          </div>

          {/* V8.3 Workspace Mode Switcher */}
          <div className="hidden md:block space-y-1.5 px-1">
            <div className="text-[10px] font-bold text-slate-500 px-1 uppercase tracking-wider">
              {isAr ? "وضع العمل الذكي" : "Workspace Mode"}
            </div>
            <div className="grid grid-cols-3 gap-1 bg-[#090D16] p-1 rounded-lg border border-white/[0.08] text-[10.5px]">
              {(
                [
                  { id: "coach", ar: "مدرب", en: "Coach" },
                  { id: "analyst", ar: "محلل", en: "Pro" },
                  { id: "scout", ar: "كشاف", en: "Scout" },
                ] as Array<{ id: WorkspaceMode; ar: string; en: string }>
              ).map((wm) => (
                <button
                  key={wm.id}
                  type="button"
                  onClick={() => handleWorkspaceModeChange(wm.id)}
                  className={`py-1 rounded font-bold transition ${
                    workspaceMode === wm.id
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {isAr ? wm.ar : wm.en}
                </button>
              ))}
            </div>
          </div>

          <nav className="space-y-1">
            {activeNavItems.map((item) => {
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

        <div className="hidden md:block space-y-2 px-1 pt-4 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setCmdOpen(true)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.05] border border-white/[0.08] text-[11px] text-slate-400 hover:text-white transition"
          >
            <span className="flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isAr ? "بحث وأوامر سريعة" : "Quick Search"}</span>
            </span>
            <kbd dir="ltr" className="px-1.5 py-0.5 rounded bg-white/[0.07] text-[10px] font-mono">
              Ctrl+K
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.05] border border-white/[0.08] text-[11px] text-slate-400 hover:text-white transition"
          >
            <span className="flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5 text-sky-400" />
              <span>{isAr ? "اختصارات الكيبورد" : "Shortcuts"}</span>
            </span>
            <kbd className="px-1.5 py-0.5 rounded bg-white/[0.07] text-[10px] font-mono">?</kbd>
          </button>
          <div className="px-1 text-[10.5px] text-slate-500">
            {isAr ? "بيانات موثّقة • حساب هندسي أولاً" : "Verified Data • Math-First Engine"}
          </div>
        </div>
      </aside>

      {/* Main Workspace Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header Bar + 3-Step Onboarding + Multi-Match Switcher */}
        <header className="shrink-0 bg-[#0C1220]/95 backdrop-blur border-b border-white/[0.08] px-4 lg:px-6 py-2.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* V8.3 3-Step Match Workflow Bar */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setTab("quick")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold transition ${
                  onboardingStep === 1
                    ? "bg-sky-500/20 border-sky-400/50 text-sky-300"
                    : "bg-[#090D16] border-white/[0.08] text-slate-400 hover:text-white"
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-white/10 inline-flex items-center justify-center text-[10px]">1</span>
                <span>{isAr ? "الفيديو والتشكيلة" : "Import Video"}</span>
              </button>
              <span className="text-slate-600">←</span>
              <button
                type="button"
                onClick={() => setTab("accuracy")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold transition ${
                  onboardingStep === 2
                    ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-300"
                    : "bg-[#090D16] border-white/[0.08] text-slate-400 hover:text-white"
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-white/10 inline-flex items-center justify-center text-[10px]">2</span>
                <span>{isAr ? "تأكيد الهويات QA" : "30s Identity QA"}</span>
              </button>
              <span className="text-slate-600">←</span>
              <button
                type="button"
                onClick={() => setTab("studio")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-bold transition ${
                  onboardingStep === 3
                    ? "bg-emerald-500 text-slate-950 border-emerald-400"
                    : "bg-[#090D16] border-white/[0.08] text-slate-400 hover:text-white"
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-black/15 inline-flex items-center justify-center text-[10px]">3</span>
                <span>{isAr ? "الاستوديو والخطط" : "Studio & Tactics"}</span>
              </button>

              {isReadOnly && (
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full bg-slate-800/90 border border-white/[0.1] text-slate-300">
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  {role === "player"
                    ? isAr ? "وضع قراءة فقط (حساب اللاعب)" : "Read-Only Mode (Player View)"
                    : isAr ? "وضع قراءة فقط (إدارة النادي)" : "Read-Only Mode (Board View)"}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setChatOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${
                  chatOpen
                    ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-950/60"
                    : "bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300"
                }`}
              >
                <Bot className="w-4 h-4" />
                <span>{isAr ? "🤖 المساعد التكتيكي الذكي" : "🤖 AI Tactical Chat"}</span>
              </button>

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
          </div>

          {/* Visual Multi-Match Selector Pill Cards */}
          <div className="flex flex-wrap items-center gap-2">
            {matches.map((m) => {
              const active = m.match_id === matchId;
              const labelAr = m.title_ar || `${m.team_a_name_ar || m.team_a_name} × ${m.team_b_name_ar || m.team_b_name}`;
              const labelEn = `${m.team_a_name} × ${m.team_b_name}`;
              const hexA = m.kit_colors?.team_a_hex || "#EF4444";
              const hexB = m.kit_colors?.team_b_hex || "#38BDF8";

              return (
                <button
                  key={m.match_id}
                  type="button"
                  onClick={() => setMatchId(m.match_id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                    active
                      ? "bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-950/60"
                      : "bg-[#111827] hover:bg-white/[0.06] text-slate-200 border-white/[0.1] hover:border-emerald-500/40"
                  }`}
                >
                  <span className="flex items-center -space-x-1 rtl:space-x-reverse">
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/50 inline-block"
                      style={{ backgroundColor: hexA }}
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-full border border-white/50 inline-block"
                      style={{ backgroundColor: hexB }}
                    />
                  </span>
                  <span>{isAr ? labelAr : labelEn}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setTab("quick")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                tab === "quick"
                  ? "bg-sky-500/20 text-sky-300 border-sky-400/50"
                  : "bg-[#090D16] hover:bg-white/[0.05] text-sky-400 border-sky-500/30"
              }`}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>{isAr ? "+ رفع / تحليل مباراة جديدة" : "+ Upload / Analyze New Match"}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">
          {tab === "accuracy" && <AccuracyProofScreen lang={lang} matchId={matchId} role={role} />}
          {tab === "studio" && (
            <BroadcastStudioScreen
              lang={lang}
              matchId={matchId}
              role={role}
              workspaceMode={workspaceMode}
              externalBlueprint={aiBlueprint}
              jumpToTimeSec={jumpTimeSec}
              onJumpHandled={() => setJumpTimeSec(null)}
            />
          )}
          {tab === "scouting" && (
            <FairScoutingScreen
              lang={lang}
              matchId={matchId}
              role={role}
              onJumpToClip={(tSec) => {
                setJumpTimeSec(tSec);
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
        </main>

        {/* Grounded AI Tactical Chatbot */}
        <TacticalAIChatbot
          lang={lang}
          matchId={matchId}
          matchTitleAr={
            matches.find((m) => m.match_id === matchId)?.title_ar ||
            `${matches.find((m) => m.match_id === matchId)?.team_a_name || "Al Ahly"} × ${
              matches.find((m) => m.match_id === matchId)?.team_b_name || "ENPPI"
            }`
          }
          role={role}
          isOpen={chatOpen}
          onToggleOpen={() => setChatOpen((v) => !v)}
          onNavigateTab={(targetTab) => setTab(targetTab)}
          onAiBlueprintDrawn={(bp) => {
            setAiBlueprint(bp);
            setTab("studio");
          }}
        />
      </div>

      {/* V8.3 Command Palette Modal (Ctrl+K) */}
      {cmdOpen && (
        <div
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
                placeholder={isAr ? "ابحث عن صفحة، مباراة، وضع عمل، أو أداة..." : "Search pages, matches, modes, tools..."}
                className="flex-1 bg-transparent text-sm text-white focus:outline-none"
              />
              <button type="button" onClick={() => setCmdOpen(false)} className="text-slate-400 hover:text-white">
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

      {/* V8.3 Keyboard Shortcuts Cheatsheet Modal (?) */}
      {shortcutsOpen && (
        <div
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
                <span>{isAr ? "اختصارات الكيبورد الاحترافية" : "Pro Keyboard Shortcuts"}</span>
              </div>
              <button type="button" onClick={() => setShortcutsOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 text-xs">
              {[
                ["Ctrl + K", isAr ? "فتح شريط الأوامر السريعة" : "Open Command Palette"],
                ["Space", isAr ? "تشغيل / إيقاف الفيديو في الاستوديو" : "Play / Pause broadcast video"],
                ["← / →", isAr ? "تقديم أو تأخير فريم واحد بدقة" : "Step backward / forward 1 frame"],
                ["S", isAr ? "أداة تسليط الضوء المتتبع (Spotlight)" : "Motion-Tracked Spotlight tool"],
                ["G", isAr ? "أداة تحريك الشبح (Ghost What-If)" : "Ghost What-If tool (both teams)"],
                ["A", isAr ? "أداة رسم سهم تكتيكي على الفيديو" : "Draw tactical arrow on video"],
                ["Z", isAr ? "تثبيت العدسة المكبّرة (Pinned Zoom)" : "Pinned 2.2x Zoom Loupe"],
                ["T", isAr ? "تكويد اللقطة الحالية وإضافتها للـ Playlist" : "Tag current moment to Playlist"],
                ["Ctrl+Z / Ctrl+Y", isAr ? "تراجع / إعادة (50 خطوة) في مرسم الخطط" : "50-step Undo / Redo on Tactical Board"],
                ["?", isAr ? "إظهار قائمة الاختصارات" : "Show shortcuts modal"],
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
    </div>
  );
}
