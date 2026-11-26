"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  ClipboardList,
  Compass,
  Flame,
  Globe,
  LayoutDashboard,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import CoachAICopilot, { CoachChatResponse } from "@/components/coach/CoachAICopilot";
import CoachDashboardHome from "@/components/coach/CoachDashboardHome";
import CoachOnboardingGate from "@/components/coach/CoachOnboardingGate";
import CoachTacticsStudio from "@/components/coach/CoachTacticsStudio";
import LiveFootballHubPanel from "@/components/coach/LiveFootballHubPanel";
import PlayerDetailModal from "@/components/coach/PlayerDetailModal";
import TeamAdminHub from "@/components/coach/TeamAdminHub";
import TechnicalDirectorHub from "@/components/coach/TechnicalDirectorHub";
import TrainingSessionStudio from "@/components/coach/TrainingSessionStudio";
import {
  CoachClubDetail,
  CoachClubListItem,
  CoachOverviewPayload,
  CoachPlayer,
  CoachProfile,
  ThreePhaseBlueprint,
  TrainingSessionPlan,
} from "@/components/coach/coachTypes";

type CoachTab = "dashboard" | "tactics" | "training" | "director" | "admin" | "live";

export default function CoachProPage() {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";

  const [tab, setTab] = useState<CoachTab>("dashboard");
  const [clubs, setClubs] = useState<CoachClubListItem[]>([]);
  const [profile, setProfile] = useState<CoachProfile | null>(null);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [loadingInit, setLoadingInit] = useState<boolean>(true);
  const [savingProfile, setSavingProfile] = useState<boolean>(false);

  const [overview, setOverview] = useState<CoachOverviewPayload | null>(null);
  const [aiBlueprint, setAiBlueprint] = useState<ThreePhaseBlueprint | null>(null);
  const [aiSession, setAiSession] = useState<TrainingSessionPlan | null>(null);
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [quickPrompt, setQuickPrompt] = useState<string>("");
  const [runningQuick, setRunningQuick] = useState<boolean>(false);
  const [modalTarget, setModalTarget] = useState<{ player: CoachPlayer; club: CoachClubDetail } | null>(null);
  const [aiBanner, setAiBanner] = useState<string | null>(null);

  const fetchOverview = useCallback(async (prof: CoachProfile) => {
    const ov = await apiFetch<CoachOverviewPayload>(
      `/api/coach/overview?club_id=${encodeURIComponent(prof.club_id)}&opponent_id=${encodeURIComponent(
        prof.opponent_id
      )}&formation=${encodeURIComponent(prof.formation || "4-2-3-1")}&league=egy.1`,
      {},
      "club_demo_egypt",
      "coach"
    );
    setOverview(ov);
    try {
      const bp = await apiFetch<ThreePhaseBlueprint>(
        "/api/coach/tactics/blueprint",
        {
          method: "POST",
          body: JSON.stringify({
            club_id: prof.club_id,
            opponent_id: prof.opponent_id,
            formation_code: prof.formation || "4-2-3-1",
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      setAiBlueprint(bp);
    } catch {}
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [clubsRes, profRes] = await Promise.all([
          apiFetch<{ clubs: CoachClubListItem[] }>("/api/coach/clubs?league=egy.1", {}, "club_demo_egypt", "coach"),
          apiFetch<{ configured: boolean; profile: CoachProfile | null }>("/api/coach/profile", {}, "club_demo_egypt", "coach"),
        ]);
        if (!alive) return;
        setClubs(clubsRes.clubs || []);
        if (profRes.configured && profRes.profile) {
          setProfile(profRes.profile);
          setShowOnboarding(false);
          await fetchOverview(profRes.profile);
        } else {
          setShowOnboarding(true);
        }
      } catch {
        setShowOnboarding(true);
      } finally {
        if (alive) setLoadingInit(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchOverview]);

  const handleOnboardingSubmit = async (newProf: CoachProfile) => {
    setSavingProfile(true);
    try {
      const saved = await apiFetch<{ profile: CoachProfile }>(
        "/api/coach/profile",
        { method: "POST", body: JSON.stringify(newProf) },
        "club_demo_egypt",
        "coach"
      );
      const resolved = saved.profile || newProf;
      setProfile(resolved);
      setShowOnboarding(false);
      await fetchOverview(resolved);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAiAction = (res: CoachChatResponse) => {
    if (res.ai_drawing_blueprint) {
      setAiBlueprint(res.ai_drawing_blueprint);
      setTab("tactics");
      setAiBanner(isAr ? "تم رسم الحالات التكتيكية الثلاث وتطبيقها مباشرة على السبورة ✓" : "3-phase tactical plan applied ✓");
    } else if (res.ai_training_session) {
      setAiSession(res.ai_training_session);
      setOverview((prev) =>
        prev ? { ...prev, training_sessions: [res.ai_training_session!, ...prev.training_sessions] } : prev
      );
      setTab("training");
      setAiBanner(isAr ? "تم توليد الحصة التدريبية وتجهيزها على لوحة الملعب ✓" : "Training session generated ✓");
    } else if (res.ai_matchday_sheet) {
      setOverview((prev) => (prev ? { ...prev, matchday_sheet: res.ai_matchday_sheet! } : prev));
      setTab("admin");
      setAiBanner(isAr ? "تم تحديث كشف المباراة الرسمي مع استبعاد المصابين والموقوفين ✓" : "Matchday sheet updated ✓");
    } else if (res.answer_ar) {
      setAiBanner(res.answer_ar.slice(0, 180));
    }
  };

  const runDirectAiPrompt = async (q: string) => {
    if (!q.trim() || !profile || runningQuick) return;
    setRunningQuick(true);
    try {
      const res = await apiFetch<CoachChatResponse>(
        "/api/coach/chat",
        {
          method: "POST",
          body: JSON.stringify({
            question: q,
            coach_name: profile.coach_name,
            coach_role: profile.coach_role,
            club_id: profile.club_id,
            opponent_id: profile.opponent_id,
            formation: profile.formation,
            model: "auto",
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      setQuickPrompt("");
      handleAiAction(res);
    } finally {
      setRunningQuick(false);
    }
  };

  if (loadingInit) {
    return (
      <div className="coach-light min-h-screen bg-[#F4F7FA] flex items-center justify-center text-sm font-bold text-emerald-700">
        {isAr ? "جاري تحميل غرفة قيادة EGY-SCOUT Coach Pro..." : "Loading EGY-SCOUT Coach Pro..."}
      </div>
    );
  }

  if (showOnboarding || !profile || !overview) {
    return (
      <CoachOnboardingGate
        lang={lang}
        clubs={clubs}
        initialProfile={profile}
        saving={savingProfile}
        onSubmit={handleOnboardingSubmit}
        onCancel={profile && overview ? () => setShowOnboarding(false) : undefined}
      />
    );
  }

  const navTabs: Array<{ id: CoachTab; ar: string; en: string; icon: React.ReactNode }> = [
    { id: "dashboard", ar: "لوحة القيادة", en: "Command", icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: "tactics", ar: "الخطط والتكتيك", en: "Tactics", icon: <Compass className="w-4 h-4" /> },
    { id: "training", ar: "التدريب والأحمال", en: "Training", icon: <Flame className="w-4 h-4" /> },
    { id: "director", ar: "المدير الفني والكشاف", en: "Director", icon: <Shield className="w-4 h-4" /> },
    { id: "admin", ar: "الإداري وكشف المباراة", en: "Admin & XI", icon: <ClipboardList className="w-4 h-4" /> },
    { id: "live", ar: "الدوريات الحية", en: "Live Hub", icon: <Globe className="w-4 h-4" /> },
  ];

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="coach-light min-h-screen bg-[#F4F7FA] text-slate-900 flex overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside className="relative z-30 hidden md:flex w-56 shrink-0 bg-white border-e border-slate-200 flex-col justify-between py-4 px-3 shadow-xs">
        <div className="space-y-5">
          <div className="px-2 space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-extrabold text-slate-900">Coach Pro</div>
                <div className="text-[10px] font-bold text-emerald-700">
                  {isAr ? "نسخة المدرب المعتمدة ✓" : "Production Certified ✓"}
                </div>
              </div>
            </div>
          </div>

          <nav className="space-y-1.5" aria-label={isAr ? "أقسام المدرب" : "Coach navigation"}>
            {navTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-extrabold transition ${
                  tab === item.id
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent"
                }`}
              >
                {item.icon}
                <span className="truncate">{isAr ? item.ar : item.en}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="space-y-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={() => setShowOnboarding(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700"
          >
            <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate">{isAr ? "تغيير المدرب / الفريق" : "Switch Coach / Match"}</span>
          </button>

          <a
            href="/"
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[11px] font-bold text-amber-800"
          >
            <span className="flex items-center gap-1.5 truncate">
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{isAr ? "استوديو الفيديو الكامل" : "Full Video Studio"}</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-amber-200/70 text-[9px] font-extrabold text-amber-900 shrink-0">Beta</span>
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Compact Single Header + Direct AI Bar */}
        <header className="bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowOnboarding(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-emerald-200 text-xs font-extrabold text-slate-900 hover:border-emerald-400 shadow-2xs"
              >
                <span className="w-2.5 h-2.5 rounded-full border border-slate-300" style={{ backgroundColor: overview.club.kit_hex || "#10B981" }} />
                <span>{overview.club.name_ar}</span>
                <span className="text-slate-400">×</span>
                <span className="w-2.5 h-2.5 rounded-full border border-slate-300" style={{ backgroundColor: overview.opponent.kit_hex || "#38BDF8" }} />
                <span>{overview.opponent.name_ar}</span>
              </button>
              <span className="text-xs font-bold text-emerald-700">
                {isAr ? `أهلاً كابتن ${profile.coach_name}` : `Coach ${profile.coach_name}`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchOverview(profile)}
                className="p-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                title={isAr ? "تحديث البيانات" : "Refresh"}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setChatOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-xs"
              >
                <Bot className="w-4 h-4" />
                <span>{isAr ? "المساعد الذكي (AI)" : "AI Copilot"}</span>
              </button>
              <button
                type="button"
                onClick={() => setLang(isAr ? "en" : "ar")}
                className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                {isAr ? "EN" : "عربي"}
              </button>
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              runDirectAiPrompt(quickPrompt);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={quickPrompt}
              onChange={(e) => setQuickPrompt(e.target.value)}
              placeholder={
                isAr
                  ? `أمر سريع للذكاء الاصطناعي: "ارسم خطة 3-4-2-1 ألونسو"، "صمم حصة MD-2"، أو "جهز كشف المباراة"...`
                  : "Quick AI Command..."
              }
              className="flex-1 rounded-xl bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:bg-white px-3.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
            />
            <button
              type="submit"
              disabled={runningQuick || !quickPrompt.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-extrabold text-white disabled:opacity-50 shadow-2xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{runningQuick ? "..." : isAr ? "تنفيذ بالـ AI" : "Run AI"}</span>
            </button>
          </form>

          {aiBanner && (
            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center justify-between gap-2">
              <span className="truncate">{aiBanner}</span>
              <button type="button" onClick={() => setAiBanner(null)} className="text-[10px] underline shrink-0">
                {isAr ? "إخفاء" : "Hide"}
              </button>
            </div>
          )}
        </header>

        {/* Workspace */}
        <main className="flex-1 p-4 pb-24 md:pb-6">
          {tab === "dashboard" && (
            <CoachDashboardHome
              lang={lang}
              profile={profile}
              overview={overview}
              onNavigate={(t) => setTab(t)}
              onSelectPlayer={(player, ownerClub) => setModalTarget({ player, club: ownerClub })}
              onRunAiPrompt={(q) => {
                setChatOpen(true);
                setQuickPrompt(q);
              }}
            />
          )}

          {tab === "tactics" && (
            <CoachTacticsStudio
              lang={lang}
              club={overview.club}
              opponent={overview.opponent}
              defaultFormation={profile.formation || "4-2-3-1"}
              externalBlueprint={aiBlueprint}
            />
          )}

          {tab === "training" && (
            <TrainingSessionStudio
              lang={lang}
              club={overview.club}
              formation={profile.formation || "4-2-3-1"}
              sessions={overview.training_sessions}
              weeklySafety={overview.weekly_load_safety}
              activeSession={aiSession}
              onSessionUpdated={(sess, all, safety) => {
                setAiSession(sess);
                setOverview((prev) =>
                  prev ? { ...prev, training_sessions: all, weekly_load_safety: safety } : prev
                );
              }}
              onSessionsDeleted={(all, safety) => {
                setOverview((prev) =>
                  prev ? { ...prev, training_sessions: all, weekly_load_safety: safety } : prev
                );
              }}
            />
          )}

          {tab === "director" && (
            <TechnicalDirectorHub
              lang={lang}
              club={overview.club}
              opponent={overview.opponent}
              clubs={clubs}
              squadDepth={overview.squad_depth}
              standings={overview.live_hub.standings || []}
              onSelectPlayer={(player, ownerClub) => setModalTarget({ player, club: ownerClub })}
            />
          )}

          {tab === "admin" && (
            <TeamAdminHub
              lang={lang}
              club={overview.club}
              opponent={overview.opponent}
              formation={profile.formation || "4-2-3-1"}
              foreignQuota={overview.foreign_quota}
              matchdaySheet={overview.matchday_sheet}
              onAdminUpdated={(updatedClub, depth, sheet) => {
                setOverview((prev) =>
                  prev ? { ...prev, club: updatedClub, squad_depth: depth, matchday_sheet: sheet } : prev
                );
              }}
              onClubSynced={async () => {
                await fetchOverview(profile);
              }}
            />
          )}

          {tab === "live" && (
            <LiveFootballHubPanel
              lang={lang}
              initialHub={overview.live_hub}
              onClubSynced={async () => {
                await fetchOverview(profile);
                const cRes = await apiFetch<{ clubs: CoachClubListItem[] }>(
                  "/api/coach/clubs?league=egy.1",
                  {},
                  "club_demo_egypt",
                  "coach"
                );
                setClubs(cRes.clubs || []);
              }}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 shadow-lg grid grid-cols-6 py-1.5 px-1">
        {navTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex flex-col items-center justify-center gap-0.5 py-1 rounded-lg text-[9.5px] font-bold ${
              tab === item.id ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            {item.icon}
            <span className="truncate max-w-[54px]">{isAr ? item.ar.split(" ")[0] : item.en}</span>
          </button>
        ))}
      </nav>

      {/* Slide-Over AI Copilot Drawer */}
      <CoachAICopilot
        lang={lang}
        profile={profile}
        club={overview.club}
        opponent={overview.opponent}
        isOpen={chatOpen}
        onToggleOpen={() => setChatOpen((v) => !v)}
        onActionExecuted={handleAiAction}
      />

      {/* Player Bio Modal */}
      {modalTarget && (
        <PlayerDetailModal
          lang={lang}
          player={modalTarget.player}
          club={modalTarget.club}
          onClose={() => setModalTarget(null)}
          onAskAi={(q) => {
            setChatOpen(true);
            setQuickPrompt(q);
          }}
        />
      )}
    </div>
  );
}
