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
import {
  loadCachedLeagueClubs,
  loadSavedPlans,
  loadSavedProfile,
  loadSavedSessions,
  mergeAdminIntoPlayers,
  saveCachedLeagueClubs,
  saveLocalProfile,
} from "@/lib/coachStorage";
import BedigitalBrandMark from "@/components/coach/BedigitalBrandMark";
import CoachAICopilot, { CoachChatResponse } from "@/components/coach/CoachAICopilot";
import CoachDashboardHome from "@/components/coach/CoachDashboardHome";
import CoachLoadingScreen from "@/components/coach/CoachLoadingScreen";
import CoachOnboardingGate from "@/components/coach/CoachOnboardingGate";
import CoachTacticsStudio from "@/components/coach/CoachTacticsStudio";
import LiveFootballHubPanel from "@/components/coach/LiveFootballHubPanel";
import OpponentPickerModal from "@/components/coach/OpponentPickerModal";
import PlayerDetailModal from "@/components/coach/PlayerDetailModal";
import TeamAdminHub from "@/components/coach/TeamAdminHub";
import TechnicalDirectorHub from "@/components/coach/TechnicalDirectorHub";
import TrainingSessionStudio from "@/components/coach/TrainingSessionStudio";
import {
  AiPendingRequest,
  COACH_LEAGUES,
  CoachClubDetail,
  CoachClubListItem,
  CoachOverviewPayload,
  CoachPlayer,
  CoachProfile,
  ThreePhaseBlueprint,
  TrainingSessionPlan,
} from "@/components/coach/coachTypes";

type CoachTab = "dashboard" | "tactics" | "training" | "director" | "admin" | "live";

function mergeSessionsWithLocal(clubId: string, serverSessions: TrainingSessionPlan[]): TrainingSessionPlan[] {
  const local = loadSavedSessions(clubId);
  const byId = new Map<string, TrainingSessionPlan>();
  for (const s of [...serverSessions, ...local]) {
    if (s && s.session_id && !byId.has(s.session_id)) {
      byId.set(s.session_id, s);
    }
  }
  return Array.from(byId.values());
}

export default function CoachProHomePage() {
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
  const [pendingAiReq, setPendingAiReq] = useState<AiPendingRequest | null>(null);
  const [opponentPickerOpen, setOpponentPickerOpen] = useState<boolean>(false);
  const [modalTarget, setModalTarget] = useState<{ player: CoachPlayer; club: CoachClubDetail } | null>(null);
  const [aiBanner, setAiBanner] = useState<string | null>(null);

  const triggerAiQuestion = useCallback(
    (question: string, targetPlayer?: CoachPlayer | null, targetClub?: CoachClubDetail | null) => {
      const clean = question.trim();
      if (!clean) return;
      setPendingAiReq({
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        question: clean,
        targetPlayer: targetPlayer || null,
        targetClub: targetClub || null,
      });
      setChatOpen(true);
    },
    []
  );

  const fetchOverview = useCallback(async (prof: CoachProfile) => {
    const leagueId = prof.league_id || "egy.1";
    const oppLeagueId = prof.opponent_league_id || leagueId;
    const oppId = prof.opponent_id || "none";
    const ov = await apiFetch<CoachOverviewPayload>(
      `/api/coach/overview?club_id=${encodeURIComponent(prof.club_id)}&opponent_id=${encodeURIComponent(
        oppId
      )}&formation=${encodeURIComponent(prof.formation || "4-2-3-1")}&league=${encodeURIComponent(
        leagueId
      )}&opponent_league=${encodeURIComponent(oppLeagueId)}`,
      {},
      "club_demo_egypt",
      "coach"
    );

    // Dual persistence merge: keep saved player statuses, saved plans & training sessions even after Vercel cold start
    const mergedClub: CoachClubDetail = {
      ...ov.club,
      players: mergeAdminIntoPlayers(ov.club.club_id, ov.club.players || []),
    };
    const mergedSessions = mergeSessionsWithLocal(ov.club.club_id, ov.training_sessions || []);
    const localPlans = loadSavedPlans(ov.club.club_id);
    const mergedPlans =
      (ov.saved_plans && ov.saved_plans.length > 0 ? ov.saved_plans : localPlans) || [];

    setOverview({
      ...ov,
      club: mergedClub,
      training_sessions: mergedSessions,
      saved_plans: mergedPlans,
    });

    // Progressive club list for coach's chosen league
    const cachedClubs = loadCachedLeagueClubs(leagueId);
    if (cachedClubs && cachedClubs.length > 0) {
      setClubs(cachedClubs);
    } else {
      apiFetch<{ clubs: CoachClubListItem[] }>(
        `/api/coach/clubs?league=${encodeURIComponent(leagueId)}`,
        {},
        "club_demo_egypt",
        "coach"
      )
        .then((res) => {
          const list = res.clubs || [];
          if (list.length > 0) {
            setClubs(list);
            saveCachedLeagueClubs(leagueId, list);
          }
        })
        .catch(() => {});
    }

    // Load 3-phase blueprint immediately
    try {
      const bp = await apiFetch<ThreePhaseBlueprint>(
        "/api/coach/tactics/blueprint",
        {
          method: "POST",
          body: JSON.stringify({
            club_id: prof.club_id,
            opponent_id: oppId,
            league: leagueId,
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
        // 1. Check browser login memory first for instant restore without waiting on network
        const savedLocal = loadSavedProfile();
        if (savedLocal) {
          if (!alive) return;
          setProfile(savedLocal);
          setShowOnboarding(false);
          await fetchOverview(savedLocal);
          if (alive) setLoadingInit(false);
          return;
        }

        // 2. Fallback to backend stored profile
        const profRes = await apiFetch<{ configured: boolean; profile: CoachProfile | null }>(
          "/api/coach/profile",
          {},
          "club_demo_egypt",
          "coach"
        ).catch(() => ({ configured: false, profile: null }));

        if (!alive) return;
        if (profRes.configured && profRes.profile && profRes.profile.club_id) {
          saveLocalProfile(profRes.profile);
          setProfile(profRes.profile);
          setShowOnboarding(false);
          await fetchOverview(profRes.profile);
        } else {
          setShowOnboarding(true);
        }
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
    setLoadingInit(true);
    saveLocalProfile(newProf);
    setProfile(newProf);
    setShowOnboarding(false);
    try {
      const res = await apiFetch<{ profile: CoachProfile }>(
        "/api/coach/profile",
        {
          method: "POST",
          body: JSON.stringify(newProf),
        },
        "club_demo_egypt",
        "coach"
      ).catch(() => ({ profile: newProf }));
      const finalProf = { ...newProf, ...(res.profile || {}) };
      saveLocalProfile(finalProf);
      setProfile(finalProf);
      await fetchOverview(finalProf);
    } finally {
      setSavingProfile(false);
      setLoadingInit(false);
    }
  };

  const handleSelectOpponent = async (oppId: string, oppLeagueId: string) => {
    if (!profile) return;
    const nextProf: CoachProfile = {
      ...profile,
      opponent_id: oppId,
      opponent_league_id: oppLeagueId,
    };
    saveLocalProfile(nextProf);
    setProfile(nextProf);
    setOpponentPickerOpen(false);
    apiFetch(
      "/api/coach/profile",
      { method: "POST", body: JSON.stringify(nextProf) },
      "club_demo_egypt",
      "coach"
    ).catch(() => {});
    await fetchOverview(nextProf);
  };

  const handleFormationChange = (nextFormation: string) => {
    if (!profile) return;
    const updated = { ...profile, formation: nextFormation };
    saveLocalProfile(updated);
    setProfile(updated);
    apiFetch(
      "/api/coach/profile",
      {
        method: "POST",
        body: JSON.stringify(updated),
      },
      "club_demo_egypt",
      "coach"
    ).catch(() => {});
  };

  const handleAiAction = useCallback((res: CoachChatResponse) => {
    const bp = res.ai_drawing_blueprint || res.ai_blueprint;
    if (bp) {
      setAiBlueprint(bp);
      setTab("tactics");
      setAiBanner(isAr ? "✓ رسم المساعد الذكي الخطة التكتيكية بـ 3 حالات في الملعب" : "✓ AI drew the 3-phase tactical blueprint");
    } else if (res.ai_training_session) {
      const newSess = res.ai_training_session;
      setAiSession(newSess);
      setOverview((prev) =>
        prev
          ? {
              ...prev,
              training_sessions: [newSess, ...prev.training_sessions.filter((s) => s.session_id !== newSess.session_id)],
            }
          : prev
      );
      setTab("training");
      setAiBanner(isAr ? "✓ صمم المساعد الذكي الوحدة التدريبية وتمرين الملعب" : "✓ AI generated training session & pitch drill");
    } else if (res.ai_matchday_sheet) {
      const sheet = res.ai_matchday_sheet;
      setOverview((prev) => (prev ? { ...prev, matchday_sheet: sheet } : prev));
      setTab("admin");
      setAiBanner(isAr ? "✓ تم تجهيز كشف المباراة الرسمي وتطبيق الاستبعادات" : "✓ AI updated Official Matchday Sheet");
    }
  }, [isAr]);

  const handleQuickPromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPrompt.trim()) return;
    const q = quickPrompt;
    setQuickPrompt("");
    triggerAiQuestion(q);
  };

  if (loadingInit) {
    return (
      <CoachLoadingScreen
        lang={lang}
        title={
          profile
            ? isAr
              ? `مرحباً كابتن ${profile.coach_name} — جاري تحميل قائمة ناديك بالصور...`
              : `Welcome ${profile.coach_name} — Loading live club squad...`
            : undefined
        }
      />
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
        onCancel={overview ? () => setShowOnboarding(false) : undefined}
      />
    );
  }

  const tabs: Array<{ id: CoachTab; ar: string; en: string; icon: React.ReactNode }> = [
    { id: "dashboard", ar: "الرئيسية", en: "Home", icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: "tactics", ar: "التكتيك والملعب", en: "Tactics Studio", icon: <Compass className="w-4 h-4" /> },
    { id: "training", ar: "التدريب والأحمال", en: "Training & Load", icon: <Flame className="w-4 h-4" /> },
    { id: "director", ar: "المدير الفني والكشاف", en: "Tech Director", icon: <UserCheck className="w-4 h-4" /> },
    { id: "admin", ar: "الإداري وكشف المباراة", en: "Team Admin", icon: <ClipboardList className="w-4 h-4" /> },
    { id: "live", ar: "البطولات المباشرة", en: "Live Football", icon: <Globe className="w-4 h-4" /> },
  ];

  const hasOpponent = Boolean(overview.opponent?.club_id && overview.opponent.club_id !== "none");
  const leagueMeta = COACH_LEAGUES.find((l) => l.id === (profile.league_id || overview.club.league_id || "egy.1"));

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="coach-light min-h-[100dvh] bg-[#F2F6F8] text-[#0B1F3A] flex flex-col">
      {/* Unified Light Command Bar */}
      <header className="sticky top-0 z-40 border-b border-[#D8E3EB] bg-white/95 backdrop-blur-xl shadow-xs">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2 sm:gap-3 flex-wrap">
          {/* Coach + Club Identity Badge */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <BedigitalBrandMark showWordmark={false} />
            <div className="flex items-center gap-2 ps-2.5 border-s border-[#D8E3EB]">
              {overview.club.logo_url ? (
                <img
                  src={overview.club.logo_url}
                  alt={overview.club.name_ar}
                  className="w-8 h-8 rounded-full object-contain bg-slate-50 border border-[#D8E3EB] p-0.5 shrink-0"
                />
              ) : (
                <div
                  className="w-4 h-8 rounded-md border border-slate-200 shrink-0"
                  style={{ backgroundColor: overview.club.kit_hex || "#0FB5AE" }}
                />
              )}
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-black text-[#0B1F3A]">
                    {isAr ? overview.club.name_ar : overview.club.name_en}
                  </span>
                  {leagueMeta && (
                    <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-bold text-[#5C6A7C] bg-slate-100 px-1.5 py-0.5 rounded-md">
                      {isAr ? leagueMeta.ar : leagueMeta.en}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpponentPickerOpen(true)}
                    className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded-full border transition ${
                      hasOpponent
                        ? "bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100"
                        : "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100"
                    }`}
                  >
                    <Shield className="w-3 h-3" />
                    {hasOpponent
                      ? `× ${isAr ? overview.opponent.name_ar : overview.opponent.name_en}`
                      : isAr
                      ? "+ اختر الخصم"
                      : "+ Pick Opponent"}
                  </button>
                </div>
                <div className="text-[11px] text-[#5C6A7C] font-semibold">
                  {isAr ? `كابتن ${profile.coach_name}` : `Coach ${profile.coach_name}`} • {profile.formation} • {overview.club.players.length}{" "}
                  {isAr ? "لاعب" : "players"}
                </div>
              </div>
            </div>
          </div>

          {/* Direct AI Command Box in Header */}
          <form onSubmit={handleQuickPromptSubmit} className="hidden lg:flex items-center gap-1.5 flex-1 max-w-md mx-2">
            <div className="relative flex-1">
              <Sparkles className="w-3.5 h-3.5 text-[#0FB5AE] absolute top-2.5 start-3" />
              <input
                type="text"
                value={quickPrompt}
                onChange={(e) => setQuickPrompt(e.target.value)}
                placeholder={
                  isAr
                    ? "اسأل الـ AI: توظيف لاعب، ارسم خطة 3-4-2-1، وحدة تدريب..."
                    : "Ask AI: player role, draw 3-4-2-1, MD-2 training..."
                }
                className="w-full rounded-xl bg-[#F2F6F8] border border-[#D8E3EB] ps-8 pe-3 py-1.5 text-xs text-[#0B1F3A] placeholder:text-[#5C6A7C] focus:outline-none focus:border-[#0FB5AE]"
              />
            </div>
            <button
              type="submit"
              disabled={!quickPrompt.trim()}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#0FB5AE] to-[#0055FF] text-white text-xs font-extrabold disabled:opacity-40 flex items-center gap-1 shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>AI</span>
            </button>
          </form>

          {/* Desktop Tabs */}
          <nav className="hidden xl:flex items-center gap-1 bg-[#F2F6F8] p-1 rounded-xl border border-[#D8E3EB]">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                  tab === t.id
                    ? "bg-[#0055FF] text-white shadow-sm"
                    : "text-[#4A5868] hover:text-[#0B1F3A] hover:bg-white"
                }`}
              >
                {t.icon}
                <span>{isAr ? t.ar : t.en}</span>
              </button>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              className="lg:hidden px-2.5 py-1.5 rounded-xl bg-[#E6F8F7] border border-[#0FB5AE]/40 text-[#0D717A] text-xs font-extrabold flex items-center gap-1"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>AI</span>
            </button>
            <button
              type="button"
              onClick={() => fetchOverview(profile)}
              title={isAr ? "تحديث البيانات" : "Refresh"}
              className="p-2 rounded-xl bg-[#F2F6F8] border border-[#D8E3EB] text-[#4A5868] hover:text-[#0B1F3A] hover:bg-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowOnboarding(true)}
              className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#F2F6F8] border border-[#D8E3EB] text-[11px] font-bold text-[#0B1F3A] hover:bg-white"
            >
              {isAr ? "تغيير الدوري / النادي" : "Switch Club"}
            </button>
            <button
              type="button"
              onClick={() => setLang((l) => (l === "ar" ? "en" : "ar"))}
              className="px-2.5 py-1.5 rounded-xl bg-[#F2F6F8] border border-[#D8E3EB] text-[11px] font-black text-[#0B1F3A]"
            >
              {lang === "ar" ? "EN" : "AR"}
            </button>
          </div>
        </div>

        {/* Mobile/Tablet Tab Strip */}
        <div className="xl:hidden border-t border-[#D8E3EB] px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto bg-[#F8FAFC]">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold whitespace-nowrap transition ${
                tab === t.id
                  ? "bg-[#0055FF] text-white shadow-xs"
                  : "bg-white text-[#4A5868] border border-[#D8E3EB]"
              }`}
            >
              {t.icon}
              <span>{isAr ? t.ar : t.en}</span>
            </button>
          ))}
        </div>
      </header>

      {/* AI Execution Banner */}
      {aiBanner && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2 text-xs text-emerald-800 flex items-center justify-between max-w-[1600px] w-full mx-auto">
          <span className="font-extrabold flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            {aiBanner}
          </span>
          <button type="button" onClick={() => setAiBanner(null)} className="text-emerald-700 hover:text-emerald-950 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-3 sm:px-6 py-4 pb-24 lg:pb-8">
        {tab === "dashboard" && (
          <CoachDashboardHome
            lang={lang}
            profile={profile}
            overview={overview}
            onFormationChange={handleFormationChange}
            onNavigate={(t) => setTab(t)}
            onSelectPlayer={(p, c) => setModalTarget({ player: p, club: c })}
            onRunAiPrompt={(q) => triggerAiQuestion(q)}
          />
        )}

        {tab === "tactics" && (
          <CoachTacticsStudio
            lang={lang}
            club={overview.club}
            opponent={overview.opponent}
            defaultFormation={profile.formation}
            externalBlueprint={aiBlueprint}
            onFormationChange={handleFormationChange}
            onOpenOpponentPicker={() => setOpponentPickerOpen(true)}
            onAskAiAboutPlayer={(p, ownerClub) =>
              triggerAiQuestion(
                isAr
                  ? `ما هو توظيف اللاعب ${p.name_ar} (${p.position}) في فريق ${ownerClub.name_ar} وكيف أستفيد منه في تشكيل ${profile.formation}؟`
                  : `Explain exact tactical role and positioning for ${p.name_en} (${p.position}) in ${profile.formation}.`,
                p,
                ownerClub
              )
            }
          />
        )}

        {tab === "training" && (
          <TrainingSessionStudio
            lang={lang}
            club={overview.club}
            formation={profile.formation}
            sessions={overview.training_sessions}
            weeklySafety={overview.weekly_load_safety}
            activeSession={aiSession}
            onSessionUpdated={(_sess, all, safety) =>
              setOverview((prev) => (prev ? { ...prev, training_sessions: all, weekly_load_safety: safety } : prev))
            }
            onSessionsDeleted={(all, safety) =>
              setOverview((prev) => (prev ? { ...prev, training_sessions: all, weekly_load_safety: safety } : prev))
            }
            onAskAiAboutPlayer={(p, ownerClub, customQ) =>
              triggerAiQuestion(
                customQ ||
                  (isAr
                    ? `ما هو توظيف اللاعب ${p.name_ar} (${p.position}) في التدريب والمباريات وما أفضل تمرين لتطوير أدواره في ${ownerClub.name_ar}؟`
                    : `Explain tactical role and custom training drill for ${p.name_en} (${p.position}) in ${ownerClub.name_en}.`),
                p,
                ownerClub
              )
            }
          />
        )}

        {tab === "director" && (
          <TechnicalDirectorHub
            lang={lang}
            club={overview.club}
            opponent={overview.opponent}
            clubs={clubs}
            squadDepth={overview.squad_depth}
            standings={overview.live_hub?.standings || []}
            onSelectPlayer={(p, ownerClub) => setModalTarget({ player: p, club: ownerClub })}
            onOpenOpponentPicker={() => setOpponentPickerOpen(true)}
            onAskAiAboutPlayer={(p, ownerClub) => {
              const owner = ownerClub || overview.club;
              triggerAiQuestion(
                isAr
                  ? `ابحث حياً عن اللاعب ${p.name_ar} وحدد مركزه الحقيقي وتوظيفه التكتيكي وأرقامه في ${owner.name_ar}`
                  : `Live-verify and explain exact tactical role for ${p.name_en} at ${owner.name_en}`,
                p,
                owner
              );
            }}
            onAskAiAboutClub={(targetClub) =>
              triggerAiQuestion(
                isAr
                  ? `حلل قائمة ونقاط القوة والضعف وتشكيل فريق ${targetClub.name_ar} بالكامل بالبيانات الحية 2026/27`
                  : `Full live 2026/27 tactical audit for ${targetClub.name_en}`,
                null,
                targetClub
              )
            }
          />
        )}

        {tab === "admin" && (
          <TeamAdminHub
            lang={lang}
            club={overview.club}
            opponent={overview.opponent}
            formation={profile.formation}
            foreignQuota={overview.foreign_quota}
            matchdaySheet={overview.matchday_sheet}
            onAdminUpdated={(updatedClub, depth, sheet) =>
              setOverview((prev) =>
                prev ? { ...prev, club: updatedClub, squad_depth: depth, matchday_sheet: sheet } : prev
              )
            }
            onClubSynced={() => fetchOverview(profile)}
          />
        )}

        {tab === "live" && (
          <LiveFootballHubPanel
            lang={lang}
            initialHub={overview.live_hub}
            onClubSynced={() => fetchOverview(profile)}
          />
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-[#D8E3EB] flex items-center justify-around py-1.5 px-1 shadow-lg">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-extrabold ${
              tab === t.id ? "text-[#0055FF]" : "text-[#5C6A7C]"
            }`}
          >
            {t.icon}
            <span className="truncate max-w-[60px]">{isAr ? t.ar.split(" ")[0] : t.en.split(" ")[0]}</span>
          </button>
        ))}
      </nav>

      {/* Cross-League Opponent Picker Modal */}
      <OpponentPickerModal
        lang={lang}
        isOpen={opponentPickerOpen}
        myClubId={profile.club_id}
        currentOpponentId={overview.opponent.club_id}
        initialLeague={profile.opponent_league_id || profile.league_id || "egy.1"}
        onClose={() => setOpponentPickerOpen(false)}
        onSelectOpponent={handleSelectOpponent}
      />

      {/* Slide-over AI Tactical Assistant with Live Research & Persistent History */}
      <CoachAICopilot
        lang={lang}
        profile={profile}
        club={overview.club}
        opponent={overview.opponent}
        isOpen={chatOpen}
        onToggleOpen={() => setChatOpen((v) => !v)}
        onActionExecuted={handleAiAction}
        pendingRequest={pendingAiReq}
        onPendingConsumed={() => setPendingAiReq(null)}
      />

      {/* Unified Player Detail Modal */}
      {modalTarget && (
        <PlayerDetailModal
          lang={lang}
          player={modalTarget.player}
          club={modalTarget.club}
          onClose={() => setModalTarget(null)}
          onAskAi={(q) => {
            const tp = modalTarget.player;
            const tc = modalTarget.club;
            setModalTarget(null);
            triggerAiQuestion(q, tp, tc);
          }}
        />
      )}
    </div>
  );
}
