"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  Compass,
  ExternalLink,
  KeyRound,
  MessageSquare,
  Send,
  Sparkles,
  Target,
  UserCheck,
  X,
} from "lucide-react";
import { apiFetch, TacticalChatResponse, UserRole } from "@/lib/api";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  matchTitleAr?: string;
  role: UserRole;
  isOpen: boolean;
  onToggleOpen: () => void;
  onNavigateTab?: (tab: "accuracy" | "studio" | "scouting" | "quick") => void;
}

interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  engine?: string;
  structuredCards?: Array<Record<string, unknown>>;
  suggestedActions?: TacticalChatResponse["suggested_actions"];
  followUps?: string[];
}

export default function TacticalAIChatbot({
  lang,
  matchId,
  matchTitleAr = "الأهلي × إنبي",
  role,
  isOpen,
  onToggleOpen,
  onNavigateTab,
}: Props) {
  const isAr = lang === "ar";
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load saved free Gemini/Groq API key from localStorage if user entered one previously
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("egy_scout_ai_api_key");
      if (saved) setApiKey(saved);
    } catch {}
  }, []);

  // Reset welcome message with initial live match analysis when matchId changes
  useEffect(() => {
    setMessages([
      {
        id: `welcome-${matchId}`,
        sender: "ai",
        engine: "EGY-SCOUT V8 Grounded Tactical Analyst",
        text: isAr
          ? `أهلاً بك في **المحلل التكتيكي الذكي (EGY-SCOUT AI)** لمباراة **${matchTitleAr}**.\n\nأنا مربوط مباشرة بإحداثيات اللاعبين الحقيقية، سرعاتهم، خطوط التشكيل، ومحرك تشريح اللقطة (**عمل إيه / معملش إيه / غلط فين وليه**).\nاسألني أي سؤال عن أي لاعب، خطة (4-2-3-1، 4-3-3، 3-4-2-1)، ثغرة دفاعية، أو بديل في الكشافة!`
          : `Welcome to **EGY-SCOUT AI Tactical Analyst** for **${matchTitleAr}**.\n\nI am 100% grounded in the live player telemetry, speeds, formation lines, and Moment State Analyzer (**Did / Did Not / Where & Why**). Ask me anything!`,
        followUps: [
          "حلل اللقطة الحالية بالتفصيل: كل لاعب عمل إيه ومعملش إيه وغلط فين وليه؟",
          "ارسم خطة 4-2-3-1 على الملعب واشرح خطوط الدفاع والوسط والمنطقة 14",
          "ماذا لو تحرك المدافع الأقرب لإغلاق حامل الكرة؟ كم ينخفض خطر الهدف xG؟",
          "ما هي أفضل قنوات التمرير المفتوحة حالياً ومن هم أسرع اللاعبين في المباراة؟",
        ],
      },
    ]);
  }, [matchId, matchTitleAr, isAr]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const askQuestion = async (rawQ?: string) => {
    const qText = (rawQ ?? question).trim();
    if (!qText || loading) return;
    if (!rawQ) setQuestion("");

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text: qText,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await apiFetch<TacticalChatResponse>(
        "/api/chat/ask",
        {
          method: "POST",
          body: JSON.stringify({
            match_id: matchId,
            question: qText,
            api_key: apiKey.trim() || undefined,
          }),
        },
        "club_demo_egypt",
        role
      );

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: "ai",
        text: res.answer_ar,
        engine: res.engine,
        structuredCards: res.structured_cards,
        suggestedActions: res.suggested_actions,
        followUps: res.follow_up_questions,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: "ai",
          text: isAr ? `حدث خطأ أثناء تحليل السؤال: ${String(e)}` : `Error analyzing question: ${String(e)}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveKey = (val: string) => {
    setApiKey(val);
    try {
      window.localStorage.setItem("egy_scout_ai_api_key", val.trim());
    } catch {}
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        className="fixed bottom-5 end-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs shadow-2xl shadow-emerald-950/80 border border-emerald-300 transition transform hover:scale-[1.03]"
      >
        <Bot className="w-5 h-5" />
        <span>{isAr ? "🤖 اسأل المساعد التكتيكي الذكي (AI Chat)" : "🤖 Ask AI Tactical Analyst"}</span>
      </button>
    );
  }

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="fixed bottom-4 end-4 z-50 w-[95vw] sm:w-[470px] h-[640px] max-h-[86vh] rounded-2xl bg-[#0B101C] border border-emerald-500/40 shadow-2xl shadow-black/90 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[#111827] border-b border-white/[0.08] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white truncate">
              {isAr ? "المساعد التكتيكي الذكي (EGY-SCOUT AI)" : "EGY-SCOUT AI Tactical Analyst"}
            </div>
            <div className="text-[10px] text-emerald-400 truncate">
              {apiKey.trim()
                ? isAr
                  ? "🟢 يعمل بمحرك Telemetry + مفتاح AI الخارجي"
                  : "🟢 Active: Telemetry + External LLM Key"
                : isAr
                ? "🟢 يعمل مجاناً بمحرك القياس التكتيكي الحي (Telemetry NLU)"
                : "🟢 Active: Built-in Grounded Telemetry NLU (Free)"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowKeyModal((v) => !v)}
            title={isAr ? "إعداد مفتاح Gemini / Groq المجاني (اختياري)" : "Configure Free Gemini / Groq Key"}
            className={`px-2 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition ${
              apiKey.trim()
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                : "bg-[#090D16] border-white/[0.1] text-slate-300 hover:border-emerald-400/50"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>{isAr ? "مفتاح AI مجاني" : "Free API Key"}</span>
          </button>
          <button
            type="button"
            onClick={onToggleOpen}
            className="p-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.08] text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Optional Free API Key Guide & Input Drawer */}
      {showKeyModal && (
        <div className="p-3.5 bg-[#0F172A] border-b border-emerald-500/30 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-emerald-300">
              {isAr
                ? "🔑 كيف تحصل على مفتاح API مجاني 100% في 30 ثانية؟ (اختياري)"
                : "🔑 How to get a 100% Free API Key in 30 seconds (Optional)"}
            </span>
            <button onClick={() => setShowKeyModal(false)} className="text-[11px] text-slate-400 hover:text-white">
              {isAr ? "إغلاق" : "Close"}
            </button>
          </div>
          <div className="text-[11px] text-slate-300 space-y-1 leading-relaxed">
            <div>
              {isAr
                ? "الشات يعمل الآن بالفعل بدون مفتاح! ولكن إذا أردت ربطه بنموذج لغوي سحابي مجاني لكتابة صياغات أوسع:"
                : "Chat already works out-of-the-box! To connect a free cloud LLM:"}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold hover:bg-emerald-500/30"
              >
                <span>1. مفتاح Google Gemini المجاني (AI Studio)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-500/20 border border-sky-500/40 text-sky-300 font-semibold hover:bg-sky-500/30"
              >
                <span>2. مفتاح Groq Llama-3.3-70B المجاني</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => handleSaveKey(e.target.value)}
              placeholder={isAr ? "الصق المفتاح هنا (يبدأ بـ AIza... أو gsk_...)" : "Paste key (AIza... or gsk_...)"}
              className="flex-1 bg-[#090D16] border border-white/[0.15] rounded-lg px-2.5 py-1.5 text-xs text-white"
            />
            <button
              type="button"
              onClick={() => setShowKeyModal(false)}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs"
            >
              {isAr ? "حفظ" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Messages Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.sender === "user" ? "items-end" : "items-start"} space-y-2`}
          >
            <div
              className={`max-w-[92%] rounded-2xl p-3.5 leading-relaxed whitespace-pre-line ${
                m.sender === "user"
                  ? "bg-emerald-500 text-slate-950 font-bold rounded-ee-none"
                  : "bg-[#111827] border border-white/[0.09] text-slate-100 rounded-es-none"
              }`}
            >
              {m.engine && m.sender === "ai" && (
                <div className="text-[10px] text-emerald-400 font-semibold mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  <span>{m.engine}</span>
                </div>
              )}
              <div>{m.text}</div>

              {/* Structured Moment Did / Did Not / Where & Why Evidence Cards inside Chat */}
              {m.structuredCards && m.structuredCards.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-white/[0.08] pt-2.5">
                  {m.structuredCards.map((c, idx) => {
                    if (c.card_type === "moment_did_didnot") {
                      return (
                        <div key={idx} className="rounded-xl bg-[#090D16] border border-emerald-500/30 p-2.5 space-y-1.5 text-[11px]">
                          <div className="font-bold text-emerald-300 flex items-center justify-between">
                            <span>{String(c.title_ar)}</span>
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              {`${c.speed_kmh} km/h • ${c.dist_to_ball_m}m`}
                            </span>
                          </div>
                          <div className="text-emerald-200">
                            <b>✅ فعل:</b> {String(c.did_ar)}
                          </div>
                          <div className="text-rose-300">
                            <b>❌ لم يفعل:</b> {String(c.did_not_ar)}
                          </div>
                          <div className="text-amber-200">
                            <b>📍 أين ولماذا:</b> {String(c.where_and_why_ar)}
                          </div>
                        </div>
                      );
                    }
                    if (c.card_type === "formation_blueprint") {
                      return (
                        <div key={idx} className="rounded-xl bg-[#090D16] border border-sky-500/30 p-2.5 space-y-1 text-[11px]">
                          <div className="font-bold text-sky-300 flex items-center gap-1.5">
                            <Compass className="w-3.5 h-3.5" />
                            <span>{String(c.title_ar)}</span>
                          </div>
                          <div className="text-slate-300">{String(c.philosophy_ar)}</div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}

              {/* One-Click Canvas Actions */}
              {m.suggestedActions && m.suggestedActions.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {m.suggestedActions.map((act, aIdx) => (
                    <button
                      key={aIdx}
                      type="button"
                      onClick={() => {
                        if (onNavigateTab) onNavigateTab("studio");
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold flex items-center gap-1 transition"
                    >
                      <Target className="w-3 h-3" />
                      <span>{act.label_ar}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Contextual Follow-Up Question Chips */}
            {m.followUps && m.followUps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-w-[95%]">
                {m.followUps.map((fq, fIdx) => (
                  <button
                    key={fIdx}
                    type="button"
                    onClick={() => askQuestion(fq)}
                    className="text-start px-2.5 py-1.5 rounded-xl bg-[#090D16] hover:bg-white/[0.06] border border-white/[0.1] hover:border-emerald-500/40 text-[11px] text-slate-300 transition"
                  >
                    💬 {fq}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 p-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>
              {isAr
                ? "جاري تحليل الإحداثيات وخطوط التشكيل وحالة كل لاعب..."
                : "Analyzing live coordinates, formations, and player states..."}
            </span>
          </div>
        )}
      </div>

      {/* Input Box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          askQuestion();
        }}
        className="p-3 bg-[#111827] border-t border-white/[0.08] flex items-center gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            isAr
              ? "اسأل عن أي لاعب (#14)، خطة (4-2-3-1)، غلط فين وليه، أو ماذا لو..."
              : "Ask about any player (#14), formation (4-2-3-1), mistake, or What-If..."
          }
          className="flex-1 bg-[#090D16] border border-white/[0.12] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="px-3.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center gap-1 transition"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isAr ? "إرسال" : "Ask"}</span>
        </button>
      </form>
    </div>
  );
}
