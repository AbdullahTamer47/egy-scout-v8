"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ClipboardList,
  Compass,
  Flame,
  Globe,
  LayoutDashboard,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Shield,
  UserCheck,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  loadCachedLeagueClubs,
  loadGeneralPlan,
  loadSavedPlans,
  loadSavedProfile,
  loadSavedSessions,
  mergeAdminIntoPlayers,
  saveCachedLeagueClubs,
  saveGeneralPlan,
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
  formatCoachName,
  SavedTacticalPlan,
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
  const [generalPlan, setGeneralPlan] = useState<SavedTacticalPlan | null>(null);
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

    const mergedClub: CoachClubDetail = {
      ...ov.club,
      players: mergeAdminIntoPlayers(ov.club.club_id, ov.club.players || []),
    };
    const mergedSessions = mergeSessionsWithLocal(ov.club.club_id, ov.training_sessions || []);
    const localPlans = loadSavedPlans(ov.club.club_id);
    const mergedPlans =
      (ov.saved_plans && ov.saved_plans.length > 0 ? ov.saved_plans : localPlans) || [];

    const localGen = loadGeneralPlan(ov.club.club_id);
    const serverGen =
      (ov.saved_plans || []).find(
        (p) => p.is_general || p.plan_id === `general_${ov.club.club_id}`
      ) || null;
    const resolvedGen =
      localGen && serverGen
        ? localGen.updated_at >= serverGen.updated_at
          ? localGen
          : serverGen
        : localGen || serverGen;
    setGeneralPlan(resolvedGen);

    setOverview({
      ...ov,
      formation: resolvedGen?.formation_a || ov.formation,
      club: mergedClub,
      training_sessions: mergedSessions,
      saved_plans: mergedPlans,
    });

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

    if (!resolvedGen) {
      try {
        const bp = await apiFetch<ThreePhaseBlueprint>(
          "/api/coach/tactics/blueprint",
          {
            method: "POST",
            body: JSON.stringify({
              club_id: prof.club_id,
              opponent_id: oppId,
              league: leagueId,
              formation_code: prof.formation || ov.club.tactical_profile?.default_formation || "4-2-3-1",
            }),
          },
          "club_demo_egypt",
          "coach"
        );
        setAiBlueprint(bp);
      } catch {}
    } else {
      setAiBlueprint(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const savedLocal = loadSavedProfile();
        if (savedLocal) {
          if (!alive) return;
          setProfile(savedLocal);
          setShowOnboarding(false);
          await fetchOverview(savedLocal);
          if (alive) setLoadingInit(false);
          return;
        }

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
        { method: "POST", body: JSON.stringify(newProf) },
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
    setOverview((prev) => (prev ? { ...prev, formation: nextFormation } : prev));
    apiFetch(
      "/api/coach/profile",
      { method: "POST", body: JSON.stringify(updated) },
      "club_demo_egypt",
      "coach"
    ).catch(() => {});
  };

  const handleGeneralPlanSaved = useCallback(
    (plan: SavedTacticalPlan) => {
      const saved = saveGeneralPlan(plan.club_id, plan);
      setGeneralPlan(saved);
      setOverview((prev) => (prev ? { ...prev, formation: saved.formation_a || prev.formation } : prev));
      if (profile && saved.formation_a && saved.formation_a !== profile.formation) {
        const updated = { ...profile, formation: saved.formation_a };
        saveLocalProfile(updated);
        setProfile(updated);
        apiFetch(
          "/api/coach/profile",
          { method: "POST", body: JSON.stringify(updated) },
          "club_demo_egypt",
          "coach"
        ).catch(() => {});
      }
      setAiBanner(
        isAr
          ? `تم حفظ الخطة العامة (${saved.formation_a}) وتحديثها في الرئيسية ✓`
          : `General Plan (${saved.formation_a}) synced to Home ✓`
      );
      setTimeout(() => setAiBanner(null), 4000);
    },
    [isAr, profile]
  );

  const handleApplyBlueprintFromChat = useCallback(
    (bp: ThreePhaseBlueprint, asGeneral = false) => {
      setAiBlueprint(bp);
      if (bp.formation_code) handleFormationChange(bp.formation_code);
      if (asGeneral && bp.phase_states && overview) {
        const plan: SavedTacticalPlan = {
          plan_id: `general_${overview.club.club_id}`,
          club_id: overview.club.club_id,
          name: `${overview.club.name_ar} (${bp.formation_code}) — الخطة العامة`,
          formation_a: bp.formation_code,
          formation_b: bp.opponent_formation_code || "4-4-2",
          phases: bp.phase_states,
          is_general: true,
          updated_at: new Date().toISOString(),
        };
        handleGeneralPlanSaved(plan);
        setTab("dashboard");
      } else {
        setTab("tactics");
      }
      setChatOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, handleGeneralPlanSaved]
  );

  const handleAiAction = useCallback(
    (res: CoachChatResponse) => {
      const bp = res.ai_drawing_blueprint || res.ai_blueprint;
      if (bp) {
        setAiBlueprint(bp);
        setAiBanner(isAr ? "تم تجهيز خطة الـ 3 حالات — افتح التكتيك أو اعتمدها من البطاقة ✓" : "3-phase plan ready ✓");
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
        setAiBanner(isAr ? "تم تجهيز الوحدة التدريبية ✓" : "Training session ready ✓");
      } else if (res.ai_matchday_sheet) {
        const sheet = res.ai_matchday_sheet;
        setOverview((prev) => (prev ? { ...prev, matchday_sheet: sheet } : prev));
        setTab("admin");
        setAiBanner(isAr ? "تم تحديث كشف المباراة الرسمي ✓" : "Official Matchday Sheet updated ✓");
      }
    },
    [isAr]
  );

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
              ? `أهلاً ${formatCoachName(profile.coach_name, true)} — جاري تحميل قائمة الفريق...`
              : `Welcome ${formatCoachName(profile.coach_name, false)} — Loading team...`
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
    { id: "tactics", ar: "التكتيك", en: "Tactics", icon: <Compass className="w-4 h-4" /> },
    { id: "training", ar: "التدريب", en: "Training", icon: <Flame className="w-4 h-4" /> },
    { id: "director", ar: "المدير الفني", en: "Director", icon: <UserCheck className="w-4 h-4" /> },
    { id: "admin", ar: "الإداري", en: "Admin", icon: <ClipboardList className="w-4 h-4" /> },
    { id: "live", ar: "البطولات", en: "Leagues", icon: <Globe className="w-4 h-4" /> },
  ];

  const hasOpponent = Boolean(overview.opponent?.club_id && overview.opponent.club_id !== "none");
  const leagueMeta = COACH_LEAGUES.find((l) => l.id === (profile.league_id || overview.club.league_id || "egy.1"));
  const displayFormation = generalPlan?.formation_a || overview.formation || profile.formation;

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="coach-light min-h-[100dvh] bg-[#F5F6F8] text-slate-900 flex flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-5 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="hidden sm:block">
              <BedigitalBrandMark showWordmark={false} compact />
            </div>
            <div className="flex items-center gap-2 min-w-0 sm:ps-2.5 sm:border-s sm:border-slate-200">
              {overview.club.logo_url ? (
                <img
                  src={overview.club.logo_url}
                  alt={overview.club.name_ar}
                  className="w-8 h-8 rounded-lg object-contain bg-slate-50 border border-slate-200 p-0.5 shrink-0"
                />
              ) : (
                <div
                  className="w-3.5 h-8 rounded border border-slate-200 shrink-0"
                  style={{ backgroundColor: overview.club.kit_hex || "#15803D" }}
                />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-extrabold text-slate-900 truncate">
                    {isAr ? overview.club.name_ar : overview.club.name_en}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold tabular-nums shrink-0">
                    {displayFormation}
                  </span>
                  {leagueMeta && (
                    <span className="hidden lg:inline-flex items-center text-[10px] font-semibold text-slate-500">
                      • {isAr ? leagueMeta.ar : leagueMeta.en}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpponentPickerOpen(true)}
                    className="hidden sm:inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 shrink-0"
                  >
                    <Shield className="w-3 h-3" />
                    {hasOpponent
                      ? `× ${isAr ? overview.opponent.name_ar : overview.opponent.name_en}`
                      : isAr
                      ? "+ الخصم"
                      : "+ Opponent"}
                  </button>
                </div>
                <div className="text-[10.5px] text-slate-500 font-medium truncate">
                  {formatCoachName(profile.coach_name, isAr)} • {overview.club.players.length} {isAr ? "لاعب" : "players"}
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleQuickPromptSubmit} className="hidden lg:flex items-center gap-1.5 flex-1 max-w-sm mx-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
              <input
                type="text"
                value={quickPrompt}
                onChange={(e) => setQuickPrompt(e.target.value)}
                placeholder={isAr ? "اسأل عن لاعب أو اطلب خطة الـ 3 حالات..." : "Ask player role or 3-phase blueprint..."}
                className="w-full rounded-lg bg-slate-50 border border-slate-200 ps-8 pe-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
              />
            </div>
            <button
              type="submit"
              disabled={!quickPrompt.trim()}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>

          <nav className="hidden xl:flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${
                  tab === t.id ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {t.icon}
                <span>{isAr ? t.ar : t.en}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href="/"
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[11px] font-bold text-amber-900"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{isAr ? "استوديو الفيديو" : "Video Studio"}</span>
            </a>
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              className="md:hidden inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-lg bg-slate-900 text-white text-xs font-bold"
              aria-label={isAr ? "المساعد" : "Assistant"}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{isAr ? "المساعد" : "Ask"}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowOnboarding(true)}
              className="px-2.5 py-1.5 min-h-[36px] rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-800 hover:bg-slate-200"
            >
              {isAr ? "تغيير النادي" : "Switch"}
            </button>
            <button
              type="button"
              onClick={() => fetchOverview(profile)}
              title={isAr ? "تحديث البيانات" : "Refresh"}
              className="hidden sm:inline-flex p-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setLang((l) => (l === "ar" ? "en" : "ar"))}
              className="hidden sm:inline-flex px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-[11px] font-extrabold text-slate-800"
            >
              {lang === "ar" ? "EN" : "AR"}
            </button>
          </div>
        </div>

        <div className="hidden md:flex xl:hidden border-t border-slate-200 px-4 py-1.5 items-center gap-1.5 overflow-x-auto no-scrollbar bg-slate-50">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                tab === t.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
              }`}
            >
              {t.icon}
              <span>{isAr ? t.ar : t.en}</span>
            </button>
          ))}
        </div>
      </header>

      {aiBanner && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-4 sm:px-6 py-2 text-xs text-[#15803D] flex items-center justify-between max-w-[1600px] w-full mx-auto">
          <span className="font-bold flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 shrink-0" />
            {aiBanner}
          </span>
          <button type="button" onClick={() => setAiBanner(null)} className="text-[#15803D] font-bold px-1">
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-3 sm:px-5 py-3 sm:py-4 pb-20 md:pb-8">
        {tab === "dashboard" && (
          <CoachDashboardHome
            lang={lang}
            profile={profile}
            overview={overview}
            generalPlan={generalPlan}
            onFormationChange={handleFormationChange}
            onNavigate={(t) => setTab(t)}
            onSelectPlayer={(p, c) => setModalTarget({ player: p, club: c })}
            onRunAiPrompt={(q) => triggerAiQuestion(q)}
            onOpenOpponentPicker={() => setOpponentPickerOpen(true)}
          />
        )}

        {tab === "tactics" && (
          <CoachTacticsStudio
            lang={lang}
            club={overview.club}
            opponent={overview.opponent}
            defaultFormation={displayFormation}
            externalBlueprint={aiBlueprint}
            generalPlan={generalPlan}
            onFormationChange={handleFormationChange}
            onGeneralPlanSaved={handleGeneralPlanSaved}
            onOpenOpponentPicker={() => setOpponentPickerOpen(true)}
            onAskAiAboutPlayer={(p, ownerClub) =>
              triggerAiQuestion(
                isAr
                  ? `ما هو توظيف اللاعب ${p.name_ar} (${p.position}) في فريق ${ownerClub.name_ar} وكيف أستفيد منه في تشكيل ${displayFormation}؟`
                  : `Explain exact tactical role and positioning for ${p.name_en} (${p.position}) in ${displayFormation}.`,
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
            formation={displayFormation}
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
            onClubStatsSynced={(updatedClub) =>
              setOverview((prev) => (prev ? { ...prev, club: updatedClub } : prev))
            }
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
            formation={displayFormation}
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
            onSelectPlayer={(p, c) => setModalTarget({ player: p, club: c })}
            onSelectAsOpponent={async (oppClubId, oppLeagueId) => {
              await handleSelectOpponent(oppClubId, oppLeagueId);
              setTab("tactics");
            }}
          />
        )}
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 grid grid-cols-6 pb-[max(0.35rem,env(safe-area-inset-bottom))]">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2 min-h-[52px] text-[10px] font-bold transition ${
                active ? "text-[#15803D]" : "text-slate-500"
              }`}
            >
              {active && <span className="absolute top-0 inset-x-3 h-0.5 rounded-b bg-[#15803D]" />}
              {t.icon}
              <span className="truncate max-w-[56px]">{isAr ? t.ar.split(" ")[0] : t.en}</span>
            </button>
          );
        })}
      </nav>

      <OpponentPickerModal
        lang={lang}
        isOpen={opponentPickerOpen}
        myClubId={profile.club_id}
        currentOpponentId={overview.opponent.club_id}
        initialLeague={profile.opponent_league_id || profile.league_id || "egy.1"}
        onClose={() => setOpponentPickerOpen(false)}
        onSelectOpponent={handleSelectOpponent}
      />

      <CoachAICopilot
        lang={lang}
        profile={profile}
        club={overview.club}
        opponent={overview.opponent}
        isOpen={chatOpen}
        onToggleOpen={() => setChatOpen((v) => !v)}
        onActionExecuted={handleAiAction}
        onApplyBlueprintToBoard={handleApplyBlueprintFromChat}
        pendingRequest={pendingAiReq}
        onPendingConsumed={() => setPendingAiReq(null)}
      />

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
