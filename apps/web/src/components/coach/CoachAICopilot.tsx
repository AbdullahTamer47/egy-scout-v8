"use client";

import React, { useState } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { apiFetch, useGroqModels } from "@/lib/api";
import { CoachClubDetail, CoachProfile, MatchdaySheetPayload, ThreePhaseBlueprint, TrainingSessionPlan } from "./coachTypes";

export interface CoachChatResponse {
  answer_ar: string;
  engine: string;
  action_executed: string;
  ai_drawing_blueprint?: ThreePhaseBlueprint | null;
  ai_training_session?: TrainingSessionPlan | null;
  ai_matchday_sheet?: MatchdaySheetPayload | null;
  follow_up_questions?: string[];
}

interface Props {
  lang: "ar" | "en";
  profile: CoachProfile;
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  isOpen: boolean;
  onToggleOpen: () => void;
  onActionExecuted: (res: CoachChatResponse) => void;
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
        ? `أهلاً كابتن ${profile.coach_name} — أنا متصل حياً بقائمة ${club.name_ar} (${club.players.length} لاعباً) وقائمة ${opponent.name_ar} وجدول الدوري المصري. اطلب رسم أي خطة (بالحالات الـ 3: الاستحواذ، الهجوم، الدفاع)، تصميم وحدة تدريبية، أو تجهيز كشف المباراة وسأنفذها فوراً.`
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
    `ارسم خطة 3-4-2-1 لـ ${club.name_ar} ضد ${opponent.name_ar}`,
    `صمم وحدة تدريبية MD-2 للضغط العالي والتحولات`,
    `جهز كشف المباراة الرسمي واستبعد المصابين والموقوفين`,
    `حلل نقاط قوة وضعف ${opponent.name_ar} بالبيانات الحية`,
    `اكتب خطاب غرفة الملابس التحفيزي قبل المباراة`,
  ];

  // Zero-overlap design: no fixed bottom floating button! Opened from Header AI button cleanly.
  if (!isOpen) return null;

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-[2px]" onClick={onToggleOpen}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[460px] h-[100dvh] bg-white border-s border-slate-200 shadow-2xl shadow-slate-900/20 flex flex-col overflow-hidden text-slate-900"
      >
        <div className="px-4 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-slate-900 truncate">
                {isAr ? `مساعد كابتن ${profile.coach_name} بالـ AI` : `Coach ${profile.coach_name} AI Assistant`}
              </div>
              <div className="text-[10px] font-bold text-emerald-700 truncate">
                {club.name_ar} × {opponent.name_ar}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="AI Model"
              className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700 max-w-[130px]"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {isAr ? m.ar : m.en}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onToggleOpen}
              aria-label="Close AI Assistant"
              className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Prompt Chips */}
        <div className="px-3 py-2.5 bg-[#F2F6F8] border-b border-[#D8E3EB] flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {quickChips.map((ch, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => sendPrompt(ch)}
              className="px-2.5 py-1 rounded-full bg-white hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 text-[10px] font-bold text-slate-700 hover:text-emerald-800 whitespace-nowrap shrink-0"
            >
              {ch}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 text-xs bg-[#F8FAFC]">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 whitespace-pre-line leading-relaxed ${
                  m.sender === "user"
                    ? "bg-emerald-600 text-white font-bold shadow-xs"
                    : "bg-white border border-slate-200 text-slate-800 shadow-2xs"
                }`}
              >
                {m.text}
                {m.sender === "ai" && m.action && m.action !== "advisory" && (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-200 text-[10px] font-extrabold text-emerald-700">
                    {m.action === "apply_tactics"
                      ? isAr ? "✓ تم تطبيق الحالات التكتيكية الثلاث مباشرة على الملعب (ويمكنك التعديل بحرية)" : "✓ Applied all 3 tactical phases to Pitch"
                      : m.action === "apply_training"
                        ? isAr ? "✓ تم تحميل الوحدة التدريبية مباشرة على لوحة التدريب" : "✓ Loaded into Training Studio"
                        : isAr ? "✓ تم تحديث كشف المباراة الرسمي تلقائياً" : "✓ Matchday Sheet Updated"}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && <div className="text-[11px] font-bold text-emerald-700 animate-pulse flex items-center gap-1.5"><Bot className="w-3.5 h-3.5" /><span>{isAr ? "جاري التحليل والتنفيذ الحي..." : "Thinking..."}</span></div>}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendPrompt();
          }}
          className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={isAr ? "اطلب خطة، تمرين، خطاب تحفيز، أو كشف مباراة..." : "Ask for tactics, training, or matchday sheet..."}
            className="flex-1 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:bg-white"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            aria-label="Send"
            className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
