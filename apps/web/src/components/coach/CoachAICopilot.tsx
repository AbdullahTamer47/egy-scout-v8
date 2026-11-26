"use client";

import React, { useState } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { apiFetch, FormationBlueprintPayload, useGroqModels } from "@/lib/api";
import { CoachClubDetail, CoachProfile, MatchdaySheetPayload, TrainingSessionPlan } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  profile: CoachProfile;
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  isOpen: boolean;
  onToggleOpen: () => void;
  externalPrompt?: string | null;
  onActionExecuted: (res: CoachChatResponse) => void;
}

export interface CoachChatResponse {
  answer_ar: string;
  engine: string;
  action_executed: string;
  ai_drawing_blueprint?: FormationBlueprintPayload | null;
  ai_training_session?: TrainingSessionPlan | null;
  ai_matchday_sheet?: MatchdaySheetPayload | null;
  follow_up_questions?: string[];
}

interface MsgItem {
  id: string;
  sender: "user" | "ai";
  text: string;
  engine?: string;
  action?: string;
}

export default function CoachAICopilot({
  lang,
  profile,
  club,
  opponent,
  isOpen,
  onToggleOpen,
  onActionExecuted,
}: Props) {
  const isAr = lang === "ar";
  const { models } = useGroqModels("coach");
  const [model, setModel] = useState("auto");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<MsgItem[]>([
    {
      id: "welcome",
      sender: "ai",
      text: isAr
        ? `أهلاً كابتن ${profile.coach_name} — أنا متصل حياً بقائمة ${club.name_ar} (${club.players.length} لاعباً) وقائمة ${opponent.name_ar} وجدول الدوري المصري. اطلب رسم أي خطة، تصميم وحدة تدريبية، أو تجهيز كشف المباراة وسأنفذها مباشرةً.`
        : `Welcome Coach ${profile.coach_name} — connected live to ${club.name_en} & ${opponent.name_en}.`,
    },
  ]);

  const sendPrompt = async (qOverride?: string) => {
    const q = (qOverride ?? question).trim();
    if (!q || loading) return;
    setQuestion("");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, sender: "user", text: q }]);
    setLoading(true);
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
            opponent_id: opponent.club_id,
            formation: profile.formation,
            model,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, sender: "ai", text: res.answer_ar, engine: res.engine, action: res.action_executed },
      ]);
      onActionExecuted(res);
    } catch (e) {
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, sender: "ai", text: String(e) }]);
    } finally {
      setLoading(false);
    }
  };

  const quickChips = [
    `ارسم خطة 3-4-2-1 ألونسو لـ ${club.name_ar} ضد ${opponent.name_ar}`,
    `صمم وحدة تدريبية MD-2 للضغط العالي والتحولات`,
    `جهز كشف المباراة الرسمي واستبعد المصابين والموقوفين`,
    `قيّم عمق قائمة ${club.name_ar} أمام ${opponent.name_ar}`,
  ];

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        aria-label={isAr ? "المساعد الذكي للمدرب" : "Coach AI Copilot"}
        className="fixed bottom-20 md:bottom-5 end-4 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs shadow-2xl shadow-emerald-950/80 border border-emerald-300"
      >
        <Bot className="w-5 h-5" />
        <span>{isAr ? "المساعد الذكي للمدرب (AI)" : "Coach AI Copilot"}</span>
      </button>
    );
  }

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="fixed bottom-20 md:bottom-4 end-3 z-50 w-[94vw] sm:w-[460px] h-[610px] max-h-[85vh] rounded-3xl bg-[#0B101C] border border-emerald-500/40 shadow-2xl shadow-black/90 flex flex-col overflow-hidden"
    >
      <div className="px-4 py-3 bg-[#111827] border-b border-white/[0.08] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white truncate">
              {isAr ? `مساعد كابتن ${profile.coach_name} الذكي` : `Coach ${profile.coach_name} AI Copilot`}
            </div>
            <div className="text-[10px] text-emerald-400 truncate">
              {club.name_ar} × {opponent.name_ar}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Groq AI Model"
            className="rounded-lg bg-[#090D16] border border-white/10 px-2 py-1 text-[10px] text-slate-200 max-w-[125px]"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {isAr ? m.ar : m.en}
              </option>
            ))}
          </select>
          <button type="button" onClick={onToggleOpen} aria-label="Close AI Copilot" className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quick Prompt Chips */}
      <div className="px-3 py-2 bg-[#090D16] border-b border-white/[0.06] flex gap-1.5 overflow-x-auto">
        {quickChips.map((ch, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => sendPrompt(ch)}
            className="px-2.5 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-[10px] font-bold text-emerald-200 whitespace-nowrap shrink-0"
          >
            {ch}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 text-xs">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 whitespace-pre-line leading-relaxed ${
                m.sender === "user"
                  ? "bg-emerald-500 text-slate-950 font-bold"
                  : "bg-[#111827] border border-white/[0.08] text-slate-100"
              }`}
            >
              {m.text}
              {m.sender === "ai" && m.action && m.action !== "advisory" && (
                <div className="mt-1.5 pt-1.5 border-t border-white/10 text-[10px] font-extrabold text-emerald-400">
                  {m.action === "apply_tactics"
                    ? isAr ? "✓ تم تطبيق الخطة مباشرة على السبورة التكتيكية" : "✓ Applied to Tactical Board"
                    : m.action === "apply_training"
                      ? isAr ? "✓ تم تحميل الوحدة التدريبية مباشرة على لوحة التدريب" : "✓ Loaded into Training Studio"
                      : isAr ? "✓ تم تحديث كشف المباراة الرسمي تلقائياً" : "✓ Matchday Sheet Updated"}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="text-[11px] text-emerald-400 animate-pulse">{isAr ? "جاري التحليل والتنفيذ الحي..." : "Thinking..."}</div>}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendPrompt();
        }}
        className="p-3 bg-[#111827] border-t border-white/[0.08] flex items-center gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={isAr ? "اطلب خطة، تمرين، أو كشف مباراة..." : "Ask for tactics, training, or matchday sheet..."}
          className="flex-1 rounded-xl bg-[#090D16] border border-white/[0.12] px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          aria-label="Send"
          className="p-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
