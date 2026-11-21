"use client";

import React, { useEffect, useState } from "react";
import { Building2, DollarSign, FileUser, Search, Sparkles } from "lucide-react";
import { apiFetch, type SeedPlayer } from "@/lib/api";
import { useScoutStore } from "@/store/useScoutStore";

interface DbResponse {
  total: number;
  metric_keys: string[];
  position_templates: Record<string, Record<string, string>>;
  players: SeedPlayer[];
}

interface MoneyballAlt {
  id: number;
  name: string;
  club_name: string;
  division: string;
  position: string;
  age: number;
  market_value_egp: number;
  savings_pct: number;
  similarity_pct: number;
  scouting_profile: Record<string, number>;
}

interface SquadAnalysis {
  club_name: string;
  style: string;
  avg_fit_pct: number;
  starting_xi: {
    id: number;
    slot_idx: number;
    slot_label_ar: string;
    slot_pos: string;
    x_m: number;
    y_m: number;
    name: string;
    style_fit_pct: number;
    jersey_number: number | null;
  }[];
  weakest_slots: { id: number; slot_idx: number; slot_label_ar: string; name: string; style_fit_pct: number }[];
}

function fmtEgp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}م ج.م`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}ألف ج.م`;
  return `${n} ج.م`;
}

function shortPlayerName(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length >= 2 && ["عبد", "أبو", "فتح", "نور", "سيف", "تاج"].includes(parts[parts.length - 2])) {
    return parts.slice(-2).join(" ");
  }
  return parts[parts.length - 1] || name;
}

function RadarChart14({ axes }: { axes: { key: string; label: string; val: number; cmp?: number }[] }) {
  const w = 540;
  const h = 420;
  const cx = w / 2;
  const cy = h / 2;
  const rMax = 112;
  const n = axes.length;
  const poly = (vals: number[]) =>
    vals
      .map((v, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
        const r = (Math.max(0, Math.min(100, v)) / 100) * rMax;
        return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
      })
      .join(" ");

  return (
    <div dir="ltr" className="w-full flex justify-center overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-[540px] h-auto">
        {[25, 50, 75, 100].map((p) => (
          <circle key={p} cx={cx} cy={cy} r={(p / 100) * rMax} fill="none" stroke="rgba(148,163,184,0.18)" />
        ))}
        {axes.map((ax, i) => {
          const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
          const cosA = Math.cos(a);
          const sinA = Math.sin(a);
          const pad = Math.abs(cosA) < 0.2 ? 18 : 22;
          const lx = cx + (rMax + pad) * cosA;
          const ly = cy + (rMax + pad) * sinA;
          const anchor = Math.abs(cosA) < 0.18 ? "middle" : cosA > 0 ? "start" : "end";
          return (
            <g key={ax.key}>
              <line x1={cx} y1={cy} x2={cx + rMax * cosA} y2={cy + rMax * sinA} stroke="rgba(148,163,184,0.18)" />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize="10" fill="#cbd5e1">
                {ax.label}
              </text>
            </g>
          );
        })}
        <polygon points={poly(axes.map((a) => a.val))} fill="rgba(16,185,129,0.25)" stroke="#10b981" strokeWidth={2} />
        {axes.some((a) => a.cmp !== undefined) && (
          <polygon points={poly(axes.map((a) => a.cmp ?? 0))} fill="rgba(56,189,248,0.22)" stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 2" />
        )}
      </svg>
    </div>
  );
}

export default function ScoutingTab() {
  const openDbDossier = useScoutStore((s) => s.openDbDossier);

  const [division, setDivision] = useState("all");
  const [position, setPosition] = useState("all");
  const [q, setQ] = useState("");
  const [db, setDb] = useState<DbResponse | null>(null);
  const [sel, setSel] = useState<SeedPlayer | null>(null);
  const [alts, setAlts] = useState<MoneyballAlt[]>([]);
  const [pickedAlt, setPickedAlt] = useState<MoneyballAlt | null>(null);

  const [clubs, setClubs] = useState<{ id: number; name: string; division: string }[]>([]);
  const [clubId, setClubId] = useState(1);
  const [style, setStyle] = useState("high_press");
  const [squad, setSquad] = useState<SquadAnalysis | null>(null);

  useEffect(() => {
    void apiFetch<{ id: number; name: string; division: string }[]>("/api/clubs")
      .then((r) => {
        setClubs(r);
        if (r.length && !r.some((c) => c.id === clubId)) setClubId(r[0].id);
      })
      .catch(() => {});
  }, [clubId]);

  useEffect(() => {
    void apiFetch<SquadAnalysis>(`/api/clubs/${clubId}/squad-analysis?style=${style}`).then(setSquad).catch(() => {});
  }, [clubId, style]);

  useEffect(() => {
    const p = new URLSearchParams({ division, position, q, limit: "60" });
    void apiFetch<DbResponse>(`/api/scouting/database?${p.toString()}`)
      .then((r) => {
        setDb(r);
        setSel((prev) => (prev && r.players.some((x) => x.id === prev.id) ? prev : r.players[0] || null));
      })
      .catch(() => {});
  }, [division, position, q]);

  const loadMoneyball = async (id: number) => {
    const r = await apiFetch<{ alternatives: MoneyballAlt[] }>(`/api/scouting/moneyball/${id}`);
    setAlts(r.alternatives);
    setPickedAlt(r.alternatives[0] || null);
  };

  const axes = (() => {
    if (!sel || !db) return [];
    const labels = db.position_templates[sel.position_family] || db.position_templates["MID"] || {};
    return db.metric_keys.map((k) => ({
      key: k,
      label: labels[k] || k,
      val: sel.scouting_profile?.[k] ?? 70,
      cmp: pickedAlt?.scouting_profile?.[k],
    }));
  })();

  return (
    <div className="space-y-5">
      {/* Club Tactical Squad Fit Simulator */}
      <div className="rounded-2xl border border-emerald-500/25 bg-[#0c1320] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-black text-sm text-white">
            <Building2 className="h-4 w-4 text-emerald-400" />
            محاكي ملاءمة تشكيلة النادي لأسلوب المدرب (46 نادياً مصرياً — اضغط على أي لاعب لفتح ملفه)
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={clubId}
              onChange={(e) => setClubId(Number(e.target.value))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-emerald-300 font-bold"
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.division})
                </option>
              ))}
            </select>
            {[
              { id: "high_press", lbl: "ضغط عالي" },
              { id: "possession", lbl: "استحواذ" },
              { id: "direct_counter", lbl: "تحولات" },
              { id: "low_block", lbl: "دفاع منظم" },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setStyle(s.id)}
                className={`rounded-xl px-2.5 py-1.5 font-bold transition ${
                  style === s.id ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-slate-300 border border-slate-700"
                }`}
              >
                {s.lbl}
              </button>
            ))}
          </div>
        </div>

        {squad && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-6 overflow-hidden rounded-xl border border-emerald-900/50 bg-[#0b2919]" dir="ltr">
              <svg viewBox="0 0 105 68" className="w-full h-auto block">
                <rect x={0.5} y={0.5} width={104} height={67} fill="none" stroke="rgba(226,232,240,0.35)" strokeWidth={0.4} />
                <line x1={52.5} y1={0} x2={52.5} y2={68} stroke="rgba(226,232,240,0.3)" strokeWidth={0.4} />
                {squad.starting_xi.map((slot) => {
                  const weak = squad.weakest_slots.some((w) => w.slot_idx === slot.slot_idx);
                  const fill = weak ? "#f43f5e" : "#10b981";
                  return (
                    <g key={slot.slot_idx} className="cursor-pointer" onClick={() => openDbDossier(slot.id)}>
                      <circle cx={slot.x_m} cy={slot.y_m} r={3.1} fill={fill} stroke="#070b12" strokeWidth={0.45} />
                      <text x={slot.x_m} y={slot.y_m + 0.8} textAnchor="middle" fontSize="2.1" fontWeight="bold" fill="#070b12">
                        {slot.jersey_number ?? slot.slot_pos}
                      </text>
                      <text x={slot.x_m} y={slot.y_m + 5.4} textAnchor="middle" fontSize="1.9" fontWeight="bold" fill="#f8fafc">
                        {shortPlayerName(slot.name)} ({Math.round(slot.style_fit_pct)}%)
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="lg:col-span-6 space-y-2.5 text-xs">
              <div className="font-bold text-slate-200">
                متوسط التوافق لأسلوب اللعب: <span className="text-emerald-400 font-mono text-base">{squad.avg_fit_pct}%</span>
              </div>
              <div className="text-rose-300 font-semibold">أضعف 3 مراكز بالتشكيل الحالي (الأولوية للتدعيم من الدرجة الثانية):</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {squad.weakest_slots.map((w) => (
                  <button
                    key={w.slot_idx}
                    onClick={() => openDbDossier(w.id)}
                    className="rounded-xl border border-rose-500/35 bg-rose-950/20 p-3 text-right hover:border-rose-400 transition"
                  >
                    <div className="font-bold text-rose-200">{w.slot_label_ar}</div>
                    <div className="text-slate-200 truncate font-semibold">{w.name}</div>
                    <div className="font-mono font-black text-rose-400 mt-1">{w.style_fit_pct}%</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Moneyball Database, 14-Axis Radar & Direct Executive Dossier Access */}
      <div className="rounded-2xl border border-slate-800 bg-[#0c1320] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-black text-sm text-white">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            قاعدة مواهب الدوري المصري والدرجة الثانية والناشئين (Moneyball)
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[
              { id: "all", lbl: "الكل" },
              { id: "EGY1", lbl: "الممتاز" },
              { id: "EGY2", lbl: "الدرجة الثانية (المحترفين)" },
              { id: "EGY_YOUTH", lbl: "الناشئين" },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => setDivision(d.id)}
                className={`rounded-xl px-2.5 py-1.5 font-bold transition ${
                  division === d.id ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-slate-300 border border-slate-700"
                }`}
              >
                {d.lbl}
              </button>
            ))}
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200 font-bold"
            >
              <option value="all">كل المراكز</option>
              <option value="CB">دفاع وحراسة</option>
              <option value="FB">الأظهرة</option>
              <option value="MID">الوسط</option>
              <option value="ATT">الأجنحة والهجوم</option>
            </select>
            <div className="relative">
              <Search className="absolute right-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث بالاسم أو النادي..."
                className="rounded-xl border border-slate-700 bg-slate-950 pr-8 pl-2.5 py-1.5 text-xs text-slate-100"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5 max-h-[460px] space-y-1.5 overflow-y-auto pl-1">
            {(db?.players || []).map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setSel(p);
                  setAlts([]);
                  setPickedAlt(null);
                }}
                className={`w-full rounded-xl border p-2.5 text-right text-xs transition ${
                  sel?.id === p.id ? "border-emerald-500 bg-emerald-500/10" : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between font-bold text-slate-100">
                  <span className="flex items-center gap-1.5">
                    {p.name}
                    {(p.video_matches_count || 0) > 0 && (
                      <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] text-cyan-300">
                        فيديو ({p.video_matches_count})
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-emerald-300">{p.overall_rating}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    {p.club_name} • {p.position} • {p.age}س
                  </span>
                  <span className="font-mono text-amber-300">{fmtEgp(p.market_value_egp)}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-7 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            {sel ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-base font-black text-white">
                      {sel.name} ({sel.position})
                    </div>
                    <div className="text-xs text-slate-400">
                      {sel.club_name} • {sel.division} • {fmtEgp(sel.market_value_egp)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => openDbDossier(sel.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-black text-cyan-200 hover:bg-cyan-500/25"
                    >
                      <FileUser className="h-3.5 w-3.5" />
                      البروفايل الكامل + 6 خطط
                    </button>
                    <button
                      onClick={() => void loadMoneyball(sel.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-emerald-400"
                    >
                      <DollarSign className="h-3.5 w-3.5" />
                      البديل الأرخص (Moneyball)
                    </button>
                  </div>
                </div>
                <div className="flex justify-center">
                  <RadarChart14 axes={axes} />
                </div>
                {alts.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-cyan-300">أقرب بدائل الدرجة الثانية والشباب (اضغط للمقارنة على الرادار):</div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {alts.map((a) => (
                        <div
                          key={a.id}
                          onClick={() => setPickedAlt(a)}
                          className={`cursor-pointer rounded-xl border p-2.5 text-right text-xs transition ${
                            pickedAlt?.id === a.id ? "border-sky-400 bg-sky-500/15" : "border-slate-800 bg-slate-900 hover:border-slate-700"
                          }`}
                        >
                          <div className="flex items-center justify-between font-bold text-white">
                            <span>{a.name}</span>
                            <span className="font-mono text-emerald-300">{a.similarity_pct}% تطابق</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {a.club_name} • {a.position} • {fmtEgp(a.market_value_egp)} (وفر {a.savings_pct}%)
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openDbDossier(a.id);
                            }}
                            className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-cyan-300 hover:underline"
                          >
                            <FileUser className="h-3 w-3" />
                            فتح بروفايل ومصفوفة الخطط
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
