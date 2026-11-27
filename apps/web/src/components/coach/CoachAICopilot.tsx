"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  History,
  MessageSquarePlus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { apiFetch, useGroqModels } from "@/lib/api";
import {
  loadActiveChatThreadId,
  loadChatThreads,
  saveActiveChatThreadId,
  saveChatThreads,
} from "@/lib/coachStorage";
import {
  AiPendingRequest,
  ChatMessageItem,
  ChatThread,
  CoachClubDetail,
  CoachPlayer,
  CoachProfile,
  MatchdaySheetPayload,
  ResearchedPlayerDossier,
  ThreePhaseBlueprint,
  TrainingSessionPlan,
} from "./coachTypes";

export interface CoachChatResponse {
  answer_ar: string;
  answer_en?: string;
  model_used?: string;
  engine?: string;
  action?: string;
  ai_drawing_blueprint?: ThreePhaseBlueprint | null;
  ai_blueprint?: ThreePhaseBlueprint | null;
  ai_training_session?: TrainingSessionPlan | null;
  ai_matchday_sheet?: MatchdaySheetPayload | null;
  researched_player?: ResearchedPlayerDossier | null;
  research_sources?: string[];
  follow_up_questions?: string[];
  grounded?: boolean;
}

interface Props {
  lang: "ar" | "en";
  profile: CoachProfile;
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  isOpen: boolean;
  onToggleOpen: () => void;
  onActionExecuted: (res: CoachChatResponse) => void;
  pendingRequest?: AiPendingRequest | null;
  onPendingConsumed?: () => void;
}

function buildWelcomeMessage(
  isAr: boolean,
  profile: CoachProfile,
  club: CoachClubDetail,
  opponent: CoachClubDetail
): ChatMessageItem {
  const hasOpponent = Boolean(opponent?.club_id && opponent.club_id !== "none");
  return {
    id: `welcome-${Date.now()}`,
    sender: "ai",
    text: isAr
      ? `أهلاً كابتن **${profile.coach_name}** — أنا المساعد التكتيكي بالـ AI المرتبط حياً بقائمة **${club.name_ar}** (${club.players.length} لاعباً)${
          hasOpponent ? ` ومواجهة **${opponent.name_ar}**` : ""
        }.\nاسألني عن توظيف أي لاعب (سأبحث حياً في بيانات 2026/27 قبل الإجابة)، أو اطلب رسم خطة (بالحالات الـ 3: الاستحواذ، الهجوم، الدفاع)، أو تصميم وحدة تدريبية، أو كشف المباراة.`
      : `Welcome Coach **${profile.coach_name}** — live AI Tactical Assistant connected to **${club.name_en}** (${club.players.length} players)${
          hasOpponent ? ` vs **${opponent.name_en}**` : ""
        }. Ask about any player's tactical role (live-verified before answering), formations, or training sessions.`,
    timestamp: new Date().toISOString(),
  };
}

function createThread(
  isAr: boolean,
  profile: CoachProfile,
  club: CoachClubDetail,
  opponent: CoachClubDetail,
  title?: string
): ChatThread {
  const welcome = buildWelcomeMessage(isAr, profile, club, opponent);
  return {
    id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: title || (isAr ? `محادثة ${club.name_ar}` : `${club.name_en} Chat`),
    clubId: club.club_id,
    updatedAt: new Date().toISOString(),
    messages: [welcome],
  };
}

function renderInlineBold(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-extrabold text-[#0B1F3A]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function FormattedAiBody({ text }: { text: string }) {
  const lines = String(text || "").split("\n");
  return (
    <div className="space-y-1.5 text-xs leading-relaxed">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trimEnd();
        if (!line.trim()) return <div key={idx} className="h-1" />;
        if (line.trim().startsWith("###")) {
          return (
            <div key={idx} className="pt-1.5 pb-0.5 text-[12px] font-extrabold text-[#0D717A] border-b border-[#D8E3EB]/60">
              {line.replace(/^#+\s*/, "")}
            </div>
          );
        }
        if (line.trim().startsWith("##")) {
          return (
            <div key={idx} className="pt-2 text-[13px] font-black text-[#0B1F3A]">
              {line.replace(/^#+\s*/, "")}
            </div>
          );
        }
        if (/^\s*[-*•]\s+/.test(line)) {
          const content = line.replace(/^\s*[-*•]\s+/, "");
          return (
            <div key={idx} className="flex items-start gap-1.5 ps-1">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0FB5AE] shrink-0" />
              <span className="flex-1">{renderInlineBold(content)}</span>
            </div>
          );
        }
        if (/^\s*\d+[.)]\s+/.test(line)) {
          return (
            <div key={idx} className="ps-1 font-medium">
              {renderInlineBold(line.trim())}
            </div>
          );
        }
        return <p key={idx}>{renderInlineBold(line)}</p>;
      })}
    </div>
  );
}

function ResearchedPlayerCard({ dossier, isAr }: { dossier: ResearchedPlayerDossier; isAr: boolean }) {
  const roles = dossier.tactical_profile?.best_roles_ar || [];
  const stats = dossier.season_stats || {};
  return (
    <div className="mt-2.5 rounded-2xl border border-[#0FB5AE]/40 bg-gradient-to-br from-[#F2FBFB] to-white p-3 space-y-2 shadow-xs">
      <div className="flex items-center gap-2.5">
        {dossier.photo_url ? (
          <img
            src={dossier.photo_url}
            alt={dossier.name_ar}
            className="w-12 h-12 rounded-xl object-cover bg-slate-100 border border-[#D8E3EB] shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-[#0D717A] text-white font-black text-sm flex items-center justify-center shrink-0">
            #{dossier.jersey_number ?? "—"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-black text-[#0B1F3A] truncate">{dossier.name_ar}</span>
            {dossier.jersey_number ? (
              <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-extrabold">
                #{dossier.jersey_number}
              </span>
            ) : null}
            <span className="px-1.5 py-0.5 rounded-md bg-[#0D717A] text-white text-[10px] font-extrabold">
              {dossier.position_code}
            </span>
          </div>
          <div className="text-[11px] font-bold text-[#5C6A7C] truncate">
            {dossier.club_name_ar || "—"} {dossier.position_label_ar ? `• ${dossier.position_label_ar}` : ""}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
            {dossier.age ? <span>{isAr ? `${dossier.age} سنة` : `${dossier.age} yrs`}</span> : null}
            {dossier.height_cm ? <span>• {dossier.height_cm} سم</span> : null}
            {dossier.preferred_foot ? <span>• {dossier.preferred_foot}</span> : null}
          </div>
        </div>
      </div>

      {(stats.appearances !== undefined || stats.goals !== undefined || stats.assists !== undefined) && (
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-xl bg-white border border-slate-200 py-1 px-2">
            <div className="text-[10px] text-slate-500">{isAr ? "مباريات" : "Apps"}</div>
            <div className="text-xs font-black text-[#0B1F3A]">{stats.appearances ?? 0}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 py-1 px-2">
            <div className="text-[10px] text-slate-500">{isAr ? "أهداف" : "Goals"}</div>
            <div className="text-xs font-black text-emerald-700">{stats.goals ?? 0}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 py-1 px-2">
            <div className="text-[10px] text-slate-500">{isAr ? "صناعة" : "Assists"}</div>
            <div className="text-xs font-black text-sky-700">{stats.assists ?? 0}</div>
          </div>
        </div>
      )}

      {roles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {roles.map((r, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-[#E6F8F7] text-[#0D717A] text-[10px] font-extrabold border border-[#0FB5AE]/30">
              {r}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-[#0D717A] font-bold pt-1 border-t border-[#D8E3EB]/60">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          {isAr ? "تحقق حي قبل الإجابة (365Scores 2026/27)" : "Live Verified (365Scores 2026/27)"}
        </span>
        {dossier.readiness_pct !== undefined && <span>{dossier.readiness_pct}%</span>}
      </div>
    </div>
  );
}

export default function CoachAICopilot({
  lang,
  profile,
  club,
  opponent,
  isOpen,
  onToggleOpen,
  onActionExecuted,
  pendingRequest,
  onPendingConsumed,
}: Props) {
  const isAr = lang === "ar";
  const hasOpponent = Boolean(opponent?.club_id && opponent.club_id !== "none");
  const { models } = useGroqModels("coach");
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [input, setInput] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pinnedPlayer, setPinnedPlayer] = useState<CoachPlayer | null>(null);
  const [pinnedClub, setPinnedClub] = useState<CoachClubDetail | null>(null);

  const [threads, setThreads] = useState<ChatThread[]>(() => {
    const saved = loadChatThreads();
    if (saved.length > 0) return saved;
    return [createThread(isAr, profile, club, opponent)];
  });
  const [activeThreadId, setActiveThreadId] = useState<string>(() => {
    const savedId = loadActiveChatThreadId();
    const saved = loadChatThreads();
    if (savedId && saved.some((t) => t.id === savedId)) return savedId;
    return saved[0]?.id || "";
  });

  useEffect(() => {
    if (!activeThreadId || !threads.some((t) => t.id === activeThreadId)) {
      if (threads.length > 0) setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (threads.length > 0) saveChatThreads(threads);
  }, [threads]);

  useEffect(() => {
    if (activeThreadId) saveActiveChatThreadId(activeThreadId);
  }, [activeThreadId]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || threads[0],
    [threads, activeThreadId]
  );

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastPendingIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.messages.length, isOpen]);

  const quickChips = useMemo(
    () =>
      isAr
        ? [
            `ارسم خطة ${profile.formation} لـ ${club.name_ar}${hasOpponent ? ` ضد ${opponent.name_ar}` : ""}`,
            `صمم وحدة تدريبية MD-2 للضغط العالي والتحولات`,
            `جهز كشف المباراة الرسمي واستبعد المصابين والموقوفين`,
            ...(hasOpponent ? [`حلل نقاط قوة وضعف ${opponent.name_ar} بالبيانات الحية`] : [`ما أفضل خطة تناسب قائمة ${club.name_ar} الحالية؟`]),
          ]
        : [
            `Draw ${profile.formation} 3-phase blueprint for ${club.name_en}`,
            `Build MD-2 pressing & transitions training session`,
            `Generate official matchday sheet & squad status`,
            ...(hasOpponent ? [`Analyze ${opponent.name_en} live strengths & weaknesses`] : [`Best formation for ${club.name_en} current squad?`]),
          ],
    [isAr, profile.formation, club.name_ar, club.name_en, hasOpponent, opponent.name_ar, opponent.name_en]
  );

  const sendPrompt = useCallback(
    async (
      promptText?: string,
      overridePlayer?: CoachPlayer | null,
      overrideClub?: CoachClubDetail | null
    ) => {
      const q = (promptText ?? input).trim();
      if (!q || sending) return;

      const effectivePlayer = overridePlayer !== undefined ? overridePlayer : pinnedPlayer;
      const effectiveClub = overrideClub !== undefined ? overrideClub : pinnedClub;

      const userMsg: ChatMessageItem = {
        id: `u-${Date.now()}`,
        sender: "user",
        text: q,
        timestamp: new Date().toISOString(),
      };

      let targetThreadId = activeThread?.id;
      if (!targetThreadId) {
        const fresh = createThread(isAr, profile, club, opponent, q.slice(0, 46));
        targetThreadId = fresh.id;
        setThreads((prev) => [fresh, ...prev]);
        setActiveThreadId(fresh.id);
      }

      const priorMessages = activeThread?.messages || [];
      const historyForApi = priorMessages.slice(-10).map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.text,
      }));

      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== targetThreadId) return t;
          const isDefaultTitle =
            t.title.startsWith("محادثة ") || t.title.endsWith(" Chat") || t.messages.length <= 1;
          return {
            ...t,
            title: isDefaultTitle ? q.slice(0, 44) : t.title,
            updatedAt: new Date().toISOString(),
            messages: [...t.messages, userMsg],
          };
        })
      );

      if (!promptText) setInput("");
      setSending(true);
      try {
        const res = await apiFetch<CoachChatResponse>(
          "/api/coach/chat",
          {
            method: "POST",
            body: JSON.stringify({
              question: q,
              coach_name: profile.coach_name,
              coach_role: profile.coach_role,
              club_id: club.club_id,
              opponent_id: opponent?.club_id || "none",
              league: profile.league_id || club.league_id || "egy.1",
              formation: profile.formation,
              model: selectedModel,
              history: historyForApi,
              target_player: effectivePlayer || undefined,
              target_club: effectiveClub
                ? {
                    club_id: effectiveClub.club_id,
                    name_ar: effectiveClub.name_ar,
                    name_en: effectiveClub.name_en,
                    league_id: effectiveClub.league_id,
                  }
                : undefined,
            }),
          },
          "club_demo_egypt",
          "coach"
        );

        const aiMsg: ChatMessageItem = {
          id: `a-${Date.now()}`,
          sender: "ai",
          text: (isAr ? res.answer_ar : res.answer_en || res.answer_ar) || "OK",
          engine: `${res.engine || "AI"} • ${res.model_used || selectedModel}`,
          action: res.action,
          researchedPlayer: res.researched_player || null,
          researchSources: res.research_sources || [],
          timestamp: new Date().toISOString(),
        };

        setThreads((prev) =>
          prev.map((t) =>
            t.id === targetThreadId
              ? { ...t, updatedAt: new Date().toISOString(), messages: [...t.messages, aiMsg] }
              : t
          )
        );
        onActionExecuted(res);
      } catch (err) {
        const errMsg: ChatMessageItem = {
          id: `err-${Date.now()}`,
          sender: "ai",
          text: isAr
            ? `تعذر الاتصال بمحرك الذكاء الاصطناعي حالياً: ${String(err)}`
            : `AI request failed: ${String(err)}`,
          timestamp: new Date().toISOString(),
        };
        setThreads((prev) =>
          prev.map((t) =>
            t.id === targetThreadId ? { ...t, messages: [...t.messages, errMsg] } : t
          )
        );
      } finally {
        setSending(false);
      }
    },
    [
      input,
      sending,
      pinnedPlayer,
      pinnedClub,
      activeThread,
      isAr,
      profile,
      club,
      opponent,
      selectedModel,
      onActionExecuted,
    ]
  );

  useEffect(() => {
    if (!pendingRequest || !pendingRequest.question) return;
    if (lastPendingIdRef.current === pendingRequest.id) return;
    lastPendingIdRef.current = pendingRequest.id;
    setPinnedPlayer(pendingRequest.targetPlayer || null);
    setPinnedClub(pendingRequest.targetClub || null);
    setHistoryOpen(false);
    void sendPrompt(
      pendingRequest.question,
      pendingRequest.targetPlayer || null,
      pendingRequest.targetClub || null
    ).finally(() => {
      onPendingConsumed?.();
    });
  }, [pendingRequest, sendPrompt, onPendingConsumed]);

  const handleNewThread = () => {
    const fresh = createThread(isAr, profile, club, opponent);
    setThreads((prev) => [fresh, ...prev]);
    setActiveThreadId(fresh.id);
    setPinnedPlayer(null);
    setPinnedClub(null);
    setHistoryOpen(false);
  };

  const handleDeleteThread = (id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = createThread(isAr, profile, club, opponent);
        setActiveThreadId(fresh.id);
        return [fresh];
      }
      if (activeThreadId === id) setActiveThreadId(next[0].id);
      return next;
    });
  };

  const handleDirectPlayerSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const name = playerSearch.trim();
    if (!name) return;
    const allRoster = [...(club.players || []), ...(opponent?.players || [])];
    const matched =
      allRoster.find(
        (p) =>
          p.name_ar.includes(name) ||
          p.name_en.toLowerCase().includes(name.toLowerCase())
      ) || null;
    setPinnedPlayer(matched);
    setPinnedClub(matched ? club : null);
    const q = isAr
      ? `ما هو توظيف اللاعب ${name} الدقيق في الملعب ومراكزه المناسبة وأرقامه الحالية في تشكيل ${profile.formation}؟`
      : `What is the exact tactical role, best positions, and current 2026/27 profile for ${name} in ${profile.formation}?`;
    setPlayerSearch("");
    void sendPrompt(q, matched, matched ? club : null);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        className="fixed bottom-20 lg:bottom-6 end-4 sm:end-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-[#0FB5AE] to-[#0055FF] text-white font-extrabold text-sm shadow-2xl shadow-sky-500/25 hover:scale-105 transition"
      >
        <Bot className="w-5 h-5" />
        <span>{isAr ? "المساعد الذكي بالـ AI" : "AI Tactical Chat"}</span>
      </button>
    );
  }

  const messages = activeThread?.messages || [];

  return (
    <aside
      dir={isAr ? "rtl" : "ltr"}
      className="fixed inset-y-0 end-0 w-full sm:w-[460px] z-50 bg-white border-s border-[#D8E3EB] shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[#F2F6F8] border-b border-[#D8E3EB] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0FB5AE] to-[#0055FF] flex items-center justify-center text-white shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-[#0B1F3A] truncate">
                {isAr ? `المساعد التكتيكي بالـ AI — ${profile.coach_name}` : `AI Assistant — ${profile.coach_name}`}
              </div>
              <div className="text-[11px] font-bold text-[#0D717A] truncate">
                {club.name_ar} ({club.players.length}) {hasOpponent ? `× ${opponent.name_ar}` : ""}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              title={isAr ? "سجل المحادثات" : "Chat History"}
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-extrabold border transition ${
                historyOpen ? "bg-[#0B1F3A] text-white border-[#0B1F3A]" : "bg-white text-[#0B1F3A] border-[#D8E3EB] hover:bg-slate-100"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>{threads.length}</span>
            </button>
            <button
              type="button"
              onClick={handleNewThread}
              title={isAr ? "محادثة جديدة" : "New Chat"}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[#E6F8F7] text-[#0D717A] border border-[#0FB5AE]/40 text-[11px] font-extrabold hover:bg-[#0D717A] hover:text-white transition"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onToggleOpen}
              aria-label="Close AI Drawer"
              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Direct Live Player Search & Role Lookup Bar */}
        <form onSubmit={handleDirectPlayerSearch} className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-2.5" />
            <input
              type="text"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              placeholder={isAr ? "ابحث عن لاعب لتوظيفه بالـ AI (مثلاً: أحمد عيد)..." : "Research player tactical role via AI..."}
              className="w-full rounded-xl bg-white border border-[#D8E3EB] ps-8 pe-2.5 py-1.5 text-[11px] text-[#0B1F3A] focus:outline-none focus:border-[#0FB5AE]"
            />
          </div>
          <button
            type="submit"
            disabled={sending || !playerSearch.trim()}
            className="px-2.5 py-1.5 rounded-xl bg-[#0D717A] hover:bg-[#0B5A61] text-white text-[11px] font-extrabold whitespace-nowrap disabled:opacity-40"
          >
            {isAr ? "بحث وتوظيف" : "Research"}
          </button>
        </form>
      </div>

      {/* Chat History Panel */}
      {historyOpen && (
        <div className="max-h-60 overflow-y-auto bg-[#F8FAFC] border-b border-[#D8E3EB] p-3 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-extrabold text-[#0B1F3A]">
            <span>{isAr ? "سجل المحادثات المحفوظة" : "Saved Chat Sessions"}</span>
            <button
              type="button"
              onClick={handleNewThread}
              className="text-[#0D717A] hover:underline"
            >
              {isAr ? "+ محادثة جديدة" : "+ New chat"}
            </button>
          </div>
          <div className="space-y-1.5">
            {threads.map((th) => {
              const active = th.id === activeThread?.id;
              return (
                <div
                  key={th.id}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border text-xs cursor-pointer transition ${
                    active ? "bg-[#E6F8F7] border-[#0FB5AE]" : "bg-white border-slate-200 hover:border-sky-300"
                  }`}
                  onClick={() => {
                    setActiveThreadId(th.id);
                    setHistoryOpen(false);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold text-[#0B1F3A] truncate">{th.title}</div>
                    <div className="text-[10px] text-slate-500">
                      {th.messages.length} {isAr ? "رسائل" : "msgs"} • {new Date(th.updatedAt).toLocaleDateString(isAr ? "ar-EG" : "en-US")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteThread(th.id);
                    }}
                    className="p-1 rounded-md text-rose-600 hover:bg-rose-50"
                    title={isAr ? "حذف المحادثة" : "Delete"}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pinned Player / Club Context Chip + Quick Actions */}
      <div className="px-3 py-2 border-b border-[#D8E3EB] space-y-1.5 bg-white">
        {(pinnedPlayer || pinnedClub) && (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-xl bg-[#E6F8F7] border border-[#0FB5AE]/40 text-[11px]">
            <span className="font-extrabold text-[#0D717A] truncate">
              {pinnedPlayer ? `${isAr ? "اللاعب المحدد:" : "Target:"} ${pinnedPlayer.name_ar} (${pinnedPlayer.position})` : `${isAr ? "النادي:" : "Club:"} ${pinnedClub?.name_ar}`}
            </span>
            <button
              type="button"
              onClick={() => {
                setPinnedPlayer(null);
                setPinnedClub(null);
              }}
              className="text-slate-500 hover:text-slate-800"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {quickChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => sendPrompt(chip)}
              disabled={sending}
              className="px-2.5 py-1 rounded-full bg-slate-50 hover:bg-[#E6F8F7] border border-[#D8E3EB] hover:border-[#0FB5AE] text-[11px] font-bold text-[#0B1F3A] whitespace-nowrap transition"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#F9FBFD]">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2.5 ${m.sender === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                m.sender === "user" ? "bg-[#0055FF] text-white" : "bg-[#E6F8F7] text-[#0D717A] border border-[#0FB5AE]/30"
              }`}
            >
              {m.sender === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
            </div>
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs shadow-xs ${
                m.sender === "user"
                  ? "bg-[#0055FF] text-white font-semibold"
                  : "bg-white border border-[#D8E3EB] text-[#0B1F3A]"
              }`}
            >
              {m.sender === "user" ? (
                <div className="leading-relaxed whitespace-pre-wrap">{m.text}</div>
              ) : (
                <FormattedAiBody text={m.text} />
              )}

              {m.researchedPlayer && <ResearchedPlayerCard dossier={m.researchedPlayer} isAr={isAr} />}

              {m.engine && (
                <div className="mt-2 pt-1.5 border-t border-slate-100 text-[10px] text-slate-500 flex items-center justify-between gap-2">
                  <span>{m.engine}</span>
                  {m.action && m.action !== "answer" && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-extrabold border border-emerald-200">
                      ✓ {m.action}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs font-bold text-[#0D717A] bg-[#E6F8F7] border border-[#0FB5AE]/30 rounded-2xl px-3.5 py-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0FB5AE] animate-ping" />
            <span>
              {isAr
                ? "جاري البحث الحي عن اللاعب والبيانات (2026/27) ثم التحليل بالذكاء الاصطناعي..."
                : "Running live 2026/27 player research before AI response..."}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendPrompt();
        }}
        className="p-3 border-t border-[#D8E3EB] bg-white space-y-2"
      >
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
          <span>{isAr ? "نموذج الذكاء الاصطناعي:" : "AI Model:"}</span>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-[#F2F6F8] border border-[#D8E3EB] rounded-lg px-2 py-1 text-[11px] font-bold text-[#0B1F3A]"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {isAr ? m.ar : m.en}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isAr
                ? "اكتب سؤالك (توظيف لاعب، رسم خطة، حصة تدريبية...)"
                : "Ask about player deployment, 3-phase blueprint, training..."
            }
            className="flex-1 rounded-xl bg-[#F2F6F8] border border-[#D8E3EB] px-3 py-2 text-xs text-[#0B1F3A] focus:outline-none focus:border-[#0FB5AE]"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#0FB5AE] to-[#0055FF] text-white font-extrabold text-xs disabled:opacity-40 flex items-center gap-1"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
}
