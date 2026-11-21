"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Compass,
  DollarSign,
  Eye,
  FileUser,
  KeyRound,
  Play,
  Send,
  Sparkles,
} from "lucide-react";
import { API_BASE, apiFetch, type TacticalBrief } from "@/lib/api";
import { useScoutStore } from "@/store/useScoutStore";

function fmtEgp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}م ج.م`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}ألف ج.م`;
  return `${n} ج.م`;
}

function renderInlineFormatted(line: string) {
  const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith("**") && tok.endsWith("**")) {
      return (
        <strong key={i} className="font-black text-white">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith("`") && tok.endsWith("`")) {
      return (
        <span
          key={i}
          className="mx-0.5 inline-block rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-300"
        >
          {tok.slice(1, -1)}
        </span>
      );
    }
    return <React.Fragment key={i}>{tok}</React.Fragment>;
  });
}

function FormattedDirectorText({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((raw, idx) => {
        const ln = raw.trim();
        if (ln.startsWith("### ")) {
          return (
            <div key={idx} className="text-sm font-black text-emerald-300 pt-1">
              {ln.slice(4)}
            </div>
          );
        }
        if (ln.startsWith("- ")) {
          return (
            <div key={idx} className="flex items-start gap-2 pr-1 text-slate-200">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
              <span>{renderInlineFormatted(ln.slice(2))}</span>
            </div>
          );
        }
        return (
          <div key={idx} className="text-slate-200">
            {renderInlineFormatted(ln)}
          </div>
        );
      })}
    </div>
  );
}

interface ChatTurn {
  role: "user" | "director";
  text: string;
  engine?: string;
}

const QUICK_PROMPTS = [
  "اقترح خطة مضادة وتعديلات الشوط الثاني",
  "ما أخطر الثغرات الدفاعية المرصودة في المباراة؟",
  "رشّح أفضل 5 صفقات اقتصادية من الدرجة الثانية",
  "التقييم الشامل للمباراة وأبرز اللاعبين",
];

export default function TacticalDirectorTab() {
  const currentMatch = useScoutStore((s) => s.currentMatch);
  const selectedSlug = useScoutStore((s) => s.selectedSlug);
  const setActiveTab = useScoutStore((s) => s.setActiveTab);
  const seekTo = useScoutStore((s) => s.seekTo);
  const openVideoDossier = useScoutStore((s) => s.openVideoDossier);
  const openDbDossier = useScoutStore((s) => s.openDbDossier);
  const geminiApiKey = useScoutStore((s) => s.geminiApiKey);
  const setGeminiApiKey = useScoutStore((s) => s.setGeminiApiKey);

  const [brief, setBrief] = useState<TacticalBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [showKeyBox, setShowKeyBox] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  useEffect(() => {
    if (!selectedSlug || currentMatch?.status !== "ready") {
      setBrief(null);
      return;
    }
    setLoading(true);
    setChat([]);
    void apiFetch<TacticalBrief>(`/api/matches/${selectedSlug}/tactical-brief`)
      .then(setBrief)
      .catch(() => setBrief(null))
      .finally(() => setLoading(false));
  }, [selectedSlug, currentMatch?.status]);

  const sendQuery = async (qText: string) => {
    const clean = qText.trim();
    if (!clean || !selectedSlug) return;
    setChat((prev) => [...prev, { role: "user", text: clean }]);
    setQuestion("");
    setAsking(true);
    try {
      const res = await apiFetch<{ engine: string; answer_ar: string }>("/api/coach/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_slug: selectedSlug,
          question: clean,
          gemini_api_key: geminiApiKey || null,
        }),
      });
      setChat((prev) => [...prev, { role: "director", text: res.answer_ar, engine: res.engine }]);
    } catch (err) {
      setChat((prev) => [
        ...prev,
        { role: "director", text: `تعذر إتمام الاستشارة: ${err instanceof Error ? err.message : "خطأ"}` },
      ]);
    } finally {
      setAsking(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-10 text-center text-sm text-slate-400">
        جاري إعداد تقرير المدير الفني والتوصيات التكتيكية...
      </div>
    );
  }

  if (!brief || !currentMatch) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-10 text-center text-sm text-slate-400">
        اختر مباراة جاهزة لعرض غرفة المدير الفني وتوصيات الخطط والتعاقدات.
      </div>
    );
  }

  const k = brief.kpis;

  return (
    <div className="space-y-5">
      {/* Executive Headline & Match KPIs */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-l from-[#0c1525] via-[#0d1626] to-emerald-950/25 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-black text-emerald-300">
              <Brain className="h-3.5 w-3.5" />
              غرفة المدير الفني والقرار التكتيكي (أرقام موثّقة 100%)
            </div>
            <h2 className="text-lg font-black text-white">{brief.headline_ar}</h2>
            <p className="text-xs text-slate-300">{brief.executive_summary_ar}</p>
          </div>

          <button
            onClick={() => setShowKeyBox((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:border-cyan-400 hover:text-white"
          >
            <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
            {geminiApiKey ? "Gemini مفعّل" : "محرك محلي (مفتاح Gemini اختياري)"}
          </button>
        </div>

        {showKeyBox && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/30 bg-slate-950/80 p-3 text-xs">
            <span className="text-slate-300">
              المحرك التكتيكي يعمل 100% محلياً بدون إنترنت أو مفاتيح. اختيارياً يمكنك إدخال مفتاح Gemini API لتوسيع المحادثة:
            </span>
            <input
              type="password"
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              placeholder="AIza... (اختياري)"
              className="flex-1 min-w-[200px] rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-100"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 text-center text-xs tabular-nums">
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400">تشكيل {k.home_name}</div>
            <div className="font-mono text-base font-black text-emerald-300 mt-0.5">{k.home_formation || "—"}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400">تشكيل {k.away_name}</div>
            <div className="font-mono text-base font-black text-cyan-300 mt-0.5">{k.away_formation || "—"}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400">الاستحواذ المعايَر</div>
            <div className="font-mono text-base font-black text-white mt-0.5">
              {k.home_poss_pct ?? "—"}% / {k.away_poss_pct ?? "—"}%
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400">سيطرة المساحة Voronoi</div>
            <div className="font-mono text-base font-black text-amber-300 mt-0.5">
              {k.home_voronoi_pct ?? "—"}% / {k.away_voronoi_pct ?? "—"}%
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400">ثغرات دفاعية &gt;16م</div>
            <div className="font-mono text-base font-black text-rose-400 mt-0.5">{k.defensive_gaps_count}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
            <div className="text-[10px] text-slate-400">ممرات كاسرة / انطلاقات</div>
            <div className="font-mono text-base font-black text-emerald-300 mt-0.5">
              {k.line_breaking_lanes_count} / {k.high_sprints_count}
            </div>
          </div>
        </div>
      </div>

      {/* Vulnerabilities & Proposed Counter-Tactics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Detected Vulnerabilities with 1-Click Jump to Video */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0c1320] p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-black text-rose-300">
            <AlertTriangle className="h-4 w-4" />
            الثغرات ونقاط الضعف المرصودة ميدانياً
          </div>
          {brief.vulnerabilities.length === 0 ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3 text-xs text-emerald-200">
              الخطوط الدفاعية متماسكة ولم تُرصد فجوات خطيرة متكررة تتجاوز 16 متراً خلال العينة.
            </div>
          ) : (
            <div className="space-y-2.5">
              {brief.vulnerabilities.map((v, idx) => (
                <div
                  key={idx}
                  className={`rounded-xl border p-3 text-xs space-y-1.5 ${
                    v.severity === "high"
                      ? "border-rose-500/35 bg-rose-950/20"
                      : "border-amber-500/35 bg-amber-950/15"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-white">{v.title_ar}</span>
                    {v.time_s !== undefined && (
                      <button
                        onClick={() => {
                          setActiveTab("studio");
                          seekTo(v.time_s!);
                        }}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-rose-500/25 border border-rose-400/50 px-2 py-0.5 text-[10px] font-bold text-rose-100 hover:bg-rose-500/40"
                      >
                        <Play className="h-3 w-3" />
                        شاهد ({v.time_s.toFixed(1)}ث)
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-300">{v.detail_ar}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actionable Formation & Counter-Tactic Recommendations */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0c1320] p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-black text-emerald-300">
            <Compass className="h-4 w-4" />
            الخطط المقترحة وتعديلات المدرب الفورية
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {brief.recommendations.map((r, idx) => (
              <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md bg-emerald-500/15 border border-emerald-500/35 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                    {r.category} • {r.target_team}
                  </span>
                  <span className="font-mono text-xs font-black text-cyan-300">{r.suggested_formation}</span>
                </div>
                <div className="font-black text-white">{r.title_ar}</div>
                <p className="text-[11px] leading-relaxed text-slate-300">{r.action_ar}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive Tactical Director Consultation + 2nd Division Transfer Memo */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Interactive Consultation Box */}
        <div className="lg:col-span-7 rounded-2xl border border-cyan-500/30 bg-[#0c1320] p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <Sparkles className="h-4 w-4 text-cyan-400" />
                استشارة المدير الفني ومحلل الأداء
              </div>
              <span className="text-[10px] text-slate-400">
                الإجابات مبنية حرفياً على أرقام المباراة وقاعدة الـ 46 نادياً
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp}
                  onClick={() => void sendQuery(qp)}
                  disabled={asking}
                  className="rounded-xl border border-slate-700 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 hover:border-cyan-400 hover:text-cyan-200 transition"
                >
                  {qp}
                </button>
              ))}
            </div>

            <div className="max-h-[300px] min-h-[150px] overflow-y-auto space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/75 p-3 text-xs">
              {chat.length === 0 ? (
                <div className="flex h-[120px] items-center justify-center text-center text-slate-500">
                  اختر أحد الأسئلة السريعة أعلاه أو اكتب سؤالك عن التشكيل، الثغرات، أو ترشيحات الدرجة الثانية...
                </div>
              ) : (
                chat.map((c, i) => (
                  <div
                    key={i}
                    className={`rounded-xl p-3 whitespace-pre-wrap leading-relaxed ${
                      c.role === "user"
                        ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-100 mr-8"
                        : "bg-slate-900 border border-slate-800 text-slate-200 ml-4"
                    }`}
                  >
                    {c.role === "director" && (
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold text-cyan-300">
                        <CheckCircle2 className="h-3 w-3" />
                        المدير الفني الذكي ({c.engine === "gemini-4-hydrogen" ? "Gemini 4" : "محرك تكتيكي محلي موثّق"})
                      </div>
                    )}
                    {c.role === "director" ? <FormattedDirectorText text={c.text} /> : c.text}
                  </div>
                ))
              )}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendQuery(question);
            }}
            className="flex gap-2"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="اسأل عن أفضل خطة مضادة، تقييم خط الدفاع، أو بدائل الدرجة الثانية..."
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-400 px-4 py-2 text-xs font-black text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {asking ? "جاري التحليل..." : "تحليل"}
            </button>
          </form>
        </div>

        {/* Club Board 2nd-Division Transfer Memo + Standout Tracked Match Players */}
        <div className="lg:col-span-5 space-y-4">
          {/* 2nd Division Moneyball Memo */}
          <div className="rounded-2xl border border-amber-500/30 bg-[#0c1320] p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-black text-amber-300">
              <DollarSign className="h-4 w-4" />
              مذكرة لجنة التعاقدات — أبرز مواهب الدرجة الثانية والشباب
            </div>
            <div className="space-y-2">
              {brief.recruitment_memo.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openDbDossier(p.id)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 text-right text-xs hover:border-amber-400/60 transition"
                >
                  <div className="flex items-center justify-between font-bold text-white">
                    <span>
                      {p.name} <span className="text-cyan-300 font-mono">({p.position})</span>
                    </span>
                    <span className="font-mono text-emerald-300">{p.overall_rating}/100</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      {p.club_name} • عمر {p.age ?? "--"} • أنسب خطة <strong className="text-slate-200">{p.best_formation}</strong>
                    </span>
                    <span className="font-mono font-bold text-amber-300">{fmtEgp(p.market_value_egp)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Standout Video Players */}
          <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-black text-white">
              <FileUser className="h-4 w-4 text-emerald-400" />
              الأعلى تقييماً في فيديو المباراة
            </div>
            <div className="space-y-1.5">
              {brief.standout_players.slice(0, 4).map((p) => (
                <button
                  key={p.identity_key}
                  onClick={() => openVideoDossier(p.identity_key)}
                  className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/80 p-2 text-right text-xs hover:border-emerald-500/50 transition"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {p.portrait_url ? (
                      <img
                        src={`${API_BASE}${p.portrait_url}`}
                        alt={p.identity_key}
                        className="h-9 w-8 rounded-lg object-cover border border-slate-700"
                      />
                    ) : (
                      <div className="flex h-9 w-8 items-center justify-center rounded-lg bg-slate-800 font-mono text-[10px] font-bold">
                        {p.jersey_ocr ? `#${p.jersey_ocr}` : "P"}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-bold text-white">
                        {p.jersey_ocr ? `لاعب #${p.jersey_ocr}` : p.identity_key} • {p.inferred_role_ar}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {p.team_name} • {p.max_speed_kmh} كم/س • أنسب خطة {p.best_formation}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg bg-emerald-500/20 px-2 py-1 font-mono font-black text-emerald-300">
                    {p.overall_score}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible PnLCalib Visual Audit Proof */}
      <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-black text-slate-200">
            <Eye className="h-4 w-4 text-emerald-400" />
            لوحة التحقق البصري الحقيقية لمعايرة الملعب PnLCalib ({k.cal_err_px ?? "—"} px • تغطية {k.cal_coverage_pct ?? 0}%)
          </div>
          <button
            onClick={() => setShowAudit((v) => !v)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-bold text-slate-300 hover:text-white"
          >
            {showAudit ? "إخفاء الصورة" : "عرض صورة التحقق البصري"}
          </button>
        </div>
        {showAudit && (
          <img
            src={`${API_BASE}${currentMatch.audit_grid_url}`}
            alt={`Audit Grid ${currentMatch.slug}`}
            className="w-full rounded-xl border border-slate-700"
          />
        )}
      </div>
    </div>
  );
}
