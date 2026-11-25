"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  Compass,
  Send,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import EstimateBadge from "@/components/ui/EstimateBadge";
import { apiFetch, FormationBlueprintPayload, TacticalChatResponse, useGroqModels, UserRole } from "@/lib/api";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  matchTitleAr?: string;
  role: UserRole;
  isOpen: boolean;
  onToggleOpen: () => void;
  onNavigateTab?: (tab: "accuracy" | "studio" | "scouting" | "quick") => void;
  onAiBlueprintDrawn?: (bp: FormationBlueprintPayload) => void;
}

interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  engine?: string;
  aiBlueprint?: FormationBlueprintPayload | null;
  structuredCards?: Array<Record<string, unknown>>;
  suggestedActions?: TacticalChatResponse["suggested_actions"];
  followUps?: string[];
}

/** Mini 22-Player Tactical Pitch Canvas rendered directly inside AI Chat messages when the AI draws a plan! */
function InlineBlueprintMiniCanvas({ blueprint }: { blueprint: FormationBlueprintPayload }) {
  const cvsRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cvs = cvsRef.current;
    if (!cvs || !blueprint) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const W = cvs.width;
    const H = cvs.height;
    const pad = 12;
    const pw = W - pad * 2;
    const ph = H - pad * 2;

    ctx.fillStyle = "#061A13";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = "#09251B";
        ctx.fillRect(pad + (i * pw) / 10, pad, pw / 10, ph);
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(pad, pad, pw, ph);
    ctx.beginPath();
    ctx.moveTo(W / 2, pad);
    ctx.lineTo(W / 2, H - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, ph * 0.14, 0, Math.PI * 2);
    ctx.stroke();

    const boxW = pw * (16.5 / 105);
    const boxH = ph * (40.32 / 68);
    ctx.strokeRect(pad, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - pad - boxW, (H - boxH) / 2, boxW, boxH);

    // Custom / Tactical Zones
    const zones = blueprint.custom_zones?.length ? blueprint.custom_zones : blueprint.tactical_zones || [];
    for (const z of zones.slice(0, 2)) {
      const x1 = pad + (Math.min(z.x1_m, z.x2_m) / 105) * pw;
      const x2 = pad + (Math.max(z.x1_m, z.x2_m) / 105) * pw;
      const y1 = pad + (Math.min(z.y1_m, z.y2_m) / 68) * ph;
      const y2 = pad + (Math.max(z.y1_m, z.y2_m) / 68) * ph;
      ctx.save();
      ctx.fillStyle = "rgba(245, 158, 11, 0.15)";
      ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
      ctx.setLineDash([4, 3]);
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.restore();
    }

    const hexA = blueprint.kit_colors?.team_a_hex || "#EF4444";
    const hexB = blueprint.kit_colors?.team_b_hex || "#38BDF8";

    // Draw lines for both teams
    const drawLines = (lines: FormationBlueprintPayload["lines"], col: string) => {
      for (const ln of lines || []) {
        if (ln.points.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ln.points.forEach((pt, idx) => {
          const px = pad + (pt.x_m / 105) * pw;
          const py = pad + (pt.y_m / 68) * ph;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.restore();
      }
    };
    drawLines(blueprint.lines, hexA);
    if (blueprint.opponent_lines) drawLines(blueprint.opponent_lines, hexB);

    // Draw custom / passing arrows with smooth arc + xPass % badge
    const arrows = [
      ...(blueprint.passing_arrows || []),
      ...(blueprint.custom_arrows || []),
    ].slice(0, 8);
    for (const ar of arrows) {
      const fx = pad + (ar.from_x_m / 105) * pw;
      const fy = pad + (ar.from_y_m / 68) * ph;
      const tx = pad + (ar.to_x_m / 105) * pw;
      const ty = pad + (ar.to_y_m / 68) * ph;
      if (Math.hypot(tx - fx, ty - fy) < 5) continue;
      const col = ar.color || "#FACC15";
      const dx = tx - fx;
      const dy = ty - fy;
      const cpx = (fx + tx) * 0.5 - dy * 0.14;
      const cpy = (fy + ty) * 0.5 + dx * 0.14;
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.9;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(cpx, cpy, tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(ty - cpy, tx - cpx);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 6 * Math.cos(ang - 0.45), ty - 6 * Math.sin(ang - 0.45));
      ctx.lineTo(tx - 6 * Math.cos(ang + 0.45), ty - 6 * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
      if (typeof ar.xpass_pct === "number") {
        const mx = 0.25 * fx + 0.5 * cpx + 0.25 * tx;
        const my = 0.25 * fy + 0.5 * cpy + 0.25 * ty;
        const badge = `${Math.round(ar.xpass_pct)}%`;
        ctx.fillStyle = "rgba(9,13,22,0.9)";
        ctx.beginPath();
        ctx.roundRect(mx - 12, my - 6.5, 24, 13, 3);
        ctx.fill();
        ctx.fillStyle = ar.xpass_pct >= 75 ? "#34D399" : "#FACC15";
        ctx.font = "800 7.5px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badge, mx, my);
      }
      ctx.restore();
    }

    // Draw nodes for Team B and Team A
    const drawNodes = (nodes: FormationBlueprintPayload["nodes"], col: string, isTeamA: boolean) => {
      for (const nd of nodes || []) {
        const px = pad + (nd.x_m / 105) * pw;
        const py = pad + (nd.y_m / 68) * ph;
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 6.2, 0, Math.PI * 2);
        ctx.fillStyle = nd.slot === "GK" ? (isTeamA ? "#F59E0B" : "#22D3EE") : col;
        ctx.fill();
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "800 6.8px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(nd.jersey_number ? `${nd.jersey_number}` : nd.slot.slice(0, 2), px, py);
        ctx.restore();
      }
    };
    if (blueprint.opponent_nodes) drawNodes(blueprint.opponent_nodes, hexB, false);
    drawNodes(blueprint.nodes, hexA, true);
  }, [blueprint]);

  return (
    <div className="rounded-xl overflow-hidden border border-emerald-500/40 bg-[#061A13] mt-2">
      <div className="px-2.5 py-1 bg-[#090D16] border-b border-white/10 flex items-center justify-between text-[10px]">
        <span className="font-bold text-emerald-300">
          {blueprint.team_name} (<bdi dir="ltr">{blueprint.formation_code}</bdi>) × {blueprint.opponent_name} (
          <bdi dir="ltr">{blueprint.opponent_formation_code || "4-4-2"}</bdi>)
        </span>
        <span className="text-slate-400">22 لاعباً • رسم حي</span>
      </div>
      <canvas ref={cvsRef} width={380} height={235} className="w-full block" />
    </div>
  );
}

function renderInlineTokens(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-extrabold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

function renderFormattedMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((rawLine, i) => {
        const line = rawLine.trim();
        if (!line) return <div key={i} className="h-1" />;
        if (line === "---") {
          return <hr key={i} className="border-white/10 my-2" />;
        }
        if (line.startsWith("|") && line.endsWith("|")) {
          // Skip pure separator row |---|---|
          if (/^\|[\s\-:|]+\|$/.test(line)) return null;
          const cells = line
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim());
          return (
            <div
              key={i}
              className="grid gap-1.5 px-2 py-1.5 rounded bg-[#090D16]/85 border border-white/[0.07] text-[11px]"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, cells.length)}, minmax(0, 1fr))` }}
            >
              {cells.map((cell, cIdx) => (
                <div key={cIdx} className={cIdx === 0 ? "font-bold text-emerald-300" : "text-slate-200"}>
                  {renderInlineTokens(cell)}
                </div>
              ))}
            </div>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <div key={i} className="text-xs font-extrabold text-emerald-300 pt-1">
              {renderInlineTokens(line.slice(4))}
            </div>
          );
        }
        if (line.startsWith("#### ")) {
          return (
            <div key={i} className="text-xs font-bold text-sky-300 pt-1">
              {renderInlineTokens(line.slice(5))}
            </div>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <div key={i} className="text-xs font-extrabold text-emerald-300 pt-1">
              {renderInlineTokens(line.slice(3))}
            </div>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <div key={i} className="text-xs font-extrabold text-white pt-1">
              {renderInlineTokens(line.slice(2))}
            </div>
          );
        }
        if (line.startsWith("> ")) {
          return (
            <div
              key={i}
              className="ps-2.5 py-1 border-s-2 border-emerald-500/50 bg-[#090D16]/70 rounded-e text-[11px] text-slate-200"
            >
              {renderInlineTokens(line.slice(2))}
            </div>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex items-start gap-1.5 text-[11.5px] text-slate-200">
              <span className="text-emerald-400 font-bold">•</span>
              <div className="flex-1">{renderInlineTokens(line.slice(2))}</div>
            </div>
          );
        }
        return (
          <div key={i} className="text-[11.5px] leading-relaxed">
            {renderInlineTokens(line)}
          </div>
        );
      })}
    </div>
  );
}

export default function TacticalAIChatbot({
  lang,
  matchId,
  matchTitleAr = "الأهلي × إنبي",
  role,
  isOpen,
  onToggleOpen,
  onNavigateTab,
  onAiBlueprintDrawn,
}: Props) {
  const isAr = lang === "ar";
  const { models: aiModels } = useGroqModels(role);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [showAdvancedModel, setShowAdvancedModel] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMessages([
      {
        id: `welcome-${matchId}`,
        sender: "ai",
        engine: isAr ? "المحلل التكتيكي الذكي" : "AI Tactical Analyst",
        text: isAr
          ? `أهلاً بك في **المحلل التكتيكي الذكي** لمباراة **${matchTitleAr}**.\n\nمتصل ببيانات الفريقين (الإحداثيات والسرعات وتشريح اللقطة). اسأل عن أي لقطة أو اطلب رسم تشكيل تكتيكي على السبورة.`
          : `Welcome to **EGY-SCOUT AI Tactical Analyst** for **${matchTitleAr}**.\n\nConnected to both teams' tracking telemetry and the Tactical Board. Ask about any moment or request a tactical formation.`,
        followUps: [
          isAr ? `قارن تمركز الفريقين في هذه اللقطة ومن أخطأ؟` : "Compare both teams' shape and positioning in this moment.",
          isAr ? `ما أسرع اللاعبين وما هي قنوات التمرير المفتوحة؟` : "Who are the fastest players and what passing lanes are open?",
          isAr ? `ارسم خطة ضغط عالي 4-3-3 ضد 4-4-2` : "Draw a 4-3-3 high press vs 4-4-2",
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
    const historyPayload = messages
      .filter((m) => !m.id.startsWith("welcome-"))
      .slice(-6)
      .map((m) => ({ sender: m.sender, text: m.text }));

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
            history: historyPayload,
            model: selectedModel,
          }),
        },
        "club_demo_egypt",
        role
      );

      if (res.ai_drawing_blueprint && onAiBlueprintDrawn) {
        onAiBlueprintDrawn(res.ai_drawing_blueprint);
      }

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: "ai",
        text: res.answer_ar,
        engine: res.engine,
        aiBlueprint: res.ai_drawing_blueprint,
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

  const activeModelLabel =
    aiModels.find((m) => m.id === selectedModel)?.[isAr ? "ar" : "en"] || selectedModel;

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onToggleOpen}
        aria-label={isAr ? "المساعد التكتيكي الذكي (AI)" : "AI Tactical Analyst"}
        className="fixed bottom-20 md:bottom-5 end-3 md:end-5 z-40 flex items-center gap-2 px-3.5 md:px-4 py-2.5 md:py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs shadow-2xl shadow-emerald-950/80 border border-emerald-300 transition transform hover:scale-[1.03]"
      >
        <Bot className="w-5 h-5" />
        <span className="hidden sm:inline">{isAr ? "المساعد التكتيكي الذكي (AI)" : "AI Tactical Analyst"}</span>
        <span className="sm:hidden">{isAr ? "مساعد AI" : "AI"}</span>
      </button>
    );
  }

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="fixed bottom-20 md:bottom-4 end-2.5 sm:end-4 z-50 w-[95vw] sm:w-[485px] h-[640px] max-h-[calc(100vh-6rem)] md:max-h-[88vh] rounded-2xl bg-[#0B101C] border border-emerald-500/40 shadow-2xl shadow-black/90 flex flex-col overflow-hidden"
    >
      {/* Header (Clean — Multi-Model Groq Picker, No API key prompt!) */}
      <div className="px-4 py-3 bg-[#111827] border-b border-white/[0.08] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold text-white truncate">
                {isAr ? "المحلل التكتيكي الذكي وراسم الخطط" : "EGY-SCOUT AI Tactical Brain & Plan Drawer"}
              </div>
              <div className="text-[10px] text-emerald-400 truncate">
                {isAr
                  ? "متصل حياً ببيانات الفريقين والسبورة التكتيكية المزدوجة"
                  : "Connected live to two-team telemetry & dual tactical boards"}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleOpen}
            className="p-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.08] text-slate-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* V8.3 Clean Auto Smart Router (Raw models tucked cleanly under Advanced!) */}
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-emerald-300 font-semibold truncate">
            {selectedModel === "auto"
              ? isAr
                ? "الوضع التلقائي الذكي (يختار الموديل الأنسب تلقائياً)"
                : "Auto Smart Router Active"
              : activeModelLabel}
          </span>
          <button
            type="button"
            onClick={() => setShowAdvancedModel((v) => !v)}
            className="px-2 py-0.5 rounded bg-[#090D16] border border-white/10 text-[10px] text-slate-400 hover:text-white shrink-0"
          >
            {showAdvancedModel ? (isAr ? "إخفاء الموديلات" : "Hide") : isAr ? "إعدادات الموديل" : "Model Settings"}
          </button>
        </div>
        {showAdvancedModel && (
          <select
            aria-label={isAr ? "اختيار موديل الذكاء الاصطناعي" : "Select AI Model"}
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full bg-[#090D16] border border-emerald-500/35 rounded-lg px-2 py-1 text-[11px] font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
          >
            {aiModels.map((m) => (
              <option key={m.id} value={m.id}>
                {isAr ? m.ar : m.en}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Messages Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.sender === "user" ? "items-end" : "items-start"} space-y-2`}
          >
            <div
              className={`max-w-[94%] rounded-2xl p-3.5 leading-relaxed ${
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
              <div>{m.sender === "ai" ? renderFormattedMarkdown(m.text) : m.text}</div>

              {/* Live Drawn 22-Player Tactical Blueprint Canvas inside the Chat Message! */}
              {m.aiBlueprint && <InlineBlueprintMiniCanvas blueprint={m.aiBlueprint} />}

              {/* Structured Two-Team Moment Did / Did Not / Where & Why Evidence Cards */}
              {m.structuredCards && m.structuredCards.length > 0 && (
                <div className="mt-3 space-y-2 border-t border-white/[0.08] pt-2.5">
                  {m.structuredCards.map((c, idx) => {
                    if (c.card_type === "moment_did_didnot") {
                      return (
                        <div key={idx} className="rounded-xl bg-[#090D16] border border-emerald-500/30 p-2.5 space-y-1 text-[11px]">
                          <div className="font-bold text-emerald-300 flex items-center justify-between">
                            <span>{String(c.title_ar)}</span>
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              {`${c.speed_kmh} km/h • ${c.dist_to_ball_m}m`}
                            </span>
                          </div>
                          <div className="text-emerald-200">
                            <b>فعل:</b> {String(c.did_ar)}
                          </div>
                          <div className="text-rose-300">
                            <b>لم يفعل:</b> {String(c.did_not_ar)}
                          </div>
                          <div className="text-amber-200">
                            <b>أين ولماذا:</b> {String(c.where_and_why_ar)}
                          </div>
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
                        if (m.aiBlueprint && onAiBlueprintDrawn) {
                          onAiBlueprintDrawn(m.aiBlueprint);
                        }
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
                ? `${activeModelLabel} يحلل بيانات الفريقين ويرسم الخطة التكتيكية...`
                : `${activeModelLabel} analyzing two-team telemetry & drawing tactical plan...`}
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
              ? "اسأل أي سؤال أو اطلب رسم أي خطة (مثال: ارسم 3-5-2 تيكي تاكا ضد 5-3-2)..."
              : "Ask anything or request any tactical plan drawing..."
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
