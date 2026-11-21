"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  DollarSign,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
  UserCheck,
  X,
} from "lucide-react";
import { apiFetch, type ClubOption, type ClubSquadAnalysis, type SeedPlayer } from "@/lib/api";
import PlayerScoutingCard, { type RadarAxis } from "@/components/PlayerScoutingCard";

interface DatabaseResponse {
  total_returned: number;
  position_templates: Record<string, Record<string, string>>;
  metric_keys: string[];
  players: SeedPlayer[];
}

interface MoneyballAlt {
  id: number;
  name: string;
  club_name: string;
  division: string;
  position: string;
  position_family: string;
  age: number;
  preferred_foot?: string;
  market_value_eur: number;
  market_value_egp: number;
  savings_pct: number;
  savings_egp: number;
  similarity_pct: number;
  scouting_profile: Record<string, number>;
}

interface MoneyballResponse {
  target: {
    id: number;
    name: string;
    club_name: string;
    division: string;
    position: string;
    position_family: string;
    age: number;
    market_value_eur: number;
    market_value_egp: number;
    scouting_profile: Record<string, number>;
  };
  radar_labels: Record<string, string>;
  metric_keys: string[];
  alternatives: MoneyballAlt[];
}

interface TopProspect {
  stat_id: number;
  match_id: number;
  match_title: string;
  player_name: string;
  jersey_number?: number | null;
  max_speed_kmh: number;
  xt_generated: number;
  line_breaking_passes: number;
  scout_score: number;
  verdict?: string;
}

const DIVISION_TABS = [
  { id: "all", label: "الكل (46 نادي)" },
  { id: "EGY1", label: "الدوري الممتاز (دوري نايل)" },
  { id: "EGY2", label: "دوري المحترفين (الدرجة الثانية أ)" },
  { id: "EGY_YOUTH", label: "قطاع الناشئين (2005-2008)" },
];

const POS_FILTERS = [
  { id: "all", label: "كل المراكز" },
  { id: "CB", label: "قلب دفاع (CB)" },
  { id: "FB", label: "ظهير عصري (FB/WB)" },
  { id: "MID", label: "ارتكاز وصانع لعب (CM/DM)" },
  { id: "ATT", label: "جناح ومهاجم (W/ST)" },
];

const STYLE_OPTIONS = [
  { id: "high_press", label: "ضغط عالي (4-2-3-1)" },
  { id: "possession", label: "استحواذ وبناء (3-2-4-1)" },
  { id: "direct_counter", label: "تحولات سريعة (4-3-3)" },
  { id: "low_block", label: "تنظيم دفاعي (5-4-1)" },
];

function fmtEgp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} مليون ج.م`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} ألف ج.م`;
  return `${n} ج.م`;
}

export default function MoneyballScoutPanel() {
  const [division, setDivision] = useState("all");
  const [posFilter, setPosFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [dbData, setDbData] = useState<DatabaseResponse | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<SeedPlayer | null>(null);
  const [moneyball, setMoneyball] = useState<MoneyballResponse | null>(null);
  const [selectedAlt, setSelectedAlt] = useState<MoneyballAlt | null>(null);
  const [loadingMb, setLoadingMb] = useState(false);
  const [prospects, setProspects] = useState<TopProspect[]>([]);

  // V4 Club Squad Audit & Transfer Sync & Custom Player state
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [auditClubId, setAuditClubId] = useState<number>(1);
  const [coachStyle, setCoachStyle] = useState<string>("high_press");
  const [squadAnalysis, setSquadAnalysis] = useState<ClubSquadAnalysis | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPlayerForm, setNewPlayerForm] = useState({
    club_id: 1,
    name_ar: "",
    position: "AM",
    age: 22,
    jersey_number: 18,
    preferred_foot: "Right",
    market_value_eur: 350000,
  });
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    void apiFetch<ClubOption[]>("/api/clubs")
      .then((res) => {
        setClubs(res);
        if (res.length > 0 && !res.some((c) => c.id === auditClubId)) {
          setAuditClubId(res[0].id);
        }
      })
      .catch(() => {});
  }, [auditClubId]);

  useEffect(() => {
    setLoadingAudit(true);
    void apiFetch<ClubSquadAnalysis>(`/api/clubs/${auditClubId}/squad-analysis?style=${coachStyle}`)
      .then(setSquadAnalysis)
      .catch(() => {})
      .finally(() => setLoadingAudit(false));
  }, [auditClubId, coachStyle, reloadNonce]);

  useEffect(() => {
    const params = new URLSearchParams({
      division,
      position: posFilter,
      q: searchQ,
      limit: "80",
    });
    apiFetch<DatabaseResponse>(`/api/scouting/database?${params.toString()}`)
      .then((res) => {
        setDbData(res);
        setSelectedPlayer((prev) => {
          if (prev && res.players.some((p) => p.id === prev.id)) return prev;
          return res.players[0] || null;
        });
      })
      .catch(() => {});
  }, [division, posFilter, searchQ, reloadNonce]);

  useEffect(() => {
    apiFetch<TopProspect[]>("/api/top-prospects?limit=10")
      .then(setProspects)
      .catch(() => {});
  }, []);

  const handleFindAlternatives = async (playerId: number) => {
    setLoadingMb(true);
    setSelectedAlt(null);
    try {
      const res = await apiFetch<MoneyballResponse>(`/api/scouting/moneyball-alternatives/${playerId}?limit=6`);
      setMoneyball(res);
      if (res.alternatives.length > 0) {
        setSelectedAlt(res.alternatives[0]);
      }
    } finally {
      setLoadingMb(false);
    }
  };

  const handleSyncSeason = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await apiFetch<{ clubs: number; created_players: number; updated_players: number }>("/api/scouting/sync-season", {
        method: "POST",
      });
      setSyncMsg(`تم تحديث انتقالات موسم 2025/2026: ${res.clubs} نادي • ${res.updated_players} لاعب محدث`);
      setReloadNonce((n) => n + 1);
    } catch (err) {
      setSyncMsg(`تعذر التحديث: ${err instanceof Error ? err.message : "خطأ"}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleCreatePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerForm.name_ar.trim()) return;
    try {
      await apiFetch("/api/scouting/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPlayerForm),
      });
      setShowAddModal(false);
      setNewPlayerForm((f) => ({ ...f, name_ar: "" }));
      setAuditClubId(newPlayerForm.club_id);
      setReloadNonce((n) => n + 1);
      setSyncMsg("تمت إضافة اللاعب وتحديث قائمة النادي بنجاح");
    } catch (err) {
      setSyncMsg(`تعذر الإضافة: ${err instanceof Error ? err.message : "خطأ"}`);
    }
  };

  // Build 14-metric position-specific Arabic radar axes
  const radarAxes: RadarAxis[] = (() => {
    if (!selectedPlayer || !dbData) return [];
    const labels = dbData.position_templates[selectedPlayer.position_family] || dbData.position_templates["MID"] || {};
    return dbData.metric_keys.map((k) => ({
      key: k,
      label_ar: labels[k] || k,
      value: selectedPlayer.scouting_profile?.[k] ?? 70,
      compareValue:
        moneyball?.target.id === selectedPlayer.id && selectedAlt
          ? selectedAlt.scouting_profile?.[k]
          : undefined,
    }));
  })();

  return (
    <div className="space-y-5">
      {/* V4 Season Sync & Club Squad Audit Simulator */}
      <div className="rounded-2xl border border-emerald-500/25 bg-[#0d1420] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">تقييم قوائم الأندية وتوافق أسلوب المدرب (2025/2026)</h2>
              <p className="text-xs text-slate-400">
                اختر أي نادي مصري وأسلوب اللعب لاكتشاف أضعف 3 مراكز بالتشكيل الأساسي وأفضل الصفقات المقترحة لسد الثغرات
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSyncSeason}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-200 transition hover:bg-cyan-500/25 disabled:opacity-60"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              مزامنة انتقالات 2025/2026
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-400"
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة لاعب مخصص
            </button>
          </div>
        </div>

        {syncMsg && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            {syncMsg}
          </div>
        )}

        {/* Club Picker & Coaching Style Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300">النادي المستهدف:</span>
            <select
              value={auditClubId}
              onChange={(e) => setAuditClubId(Number(e.target.value))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-emerald-300 focus:border-emerald-500 focus:outline-none"
            >
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.division})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {STYLE_OPTIONS.map((st) => (
              <button
                key={st.id}
                onClick={() => setCoachStyle(st.id)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  coachStyle === st.id
                    ? "bg-emerald-500 text-slate-950"
                    : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* Starting XI Pitch Visualizer + Weakest Slots & Transfer Upgrades */}
        {loadingAudit ? (
          <div className="py-10 text-center text-xs text-slate-400">جاري حساب ملائمة التشكيل الأساسي...</div>
        ) : squadAnalysis ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Pitch Starting XI */}
            <div className="lg:col-span-6 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-200">
                  التشكيل المثالي لنادي {squadAnalysis.club.name}
                </span>
                <span className="rounded-lg bg-emerald-500/15 px-2 py-0.5 font-mono font-bold text-emerald-300">
                  ملائمة المنظومة: {squadAnalysis.avg_style_fit_pct}%
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-emerald-900/50 bg-[#0b2919]" dir="ltr">
                <svg viewBox="0 0 105 68" className="w-full h-auto block">
                  <rect x={0.5} y={0.5} width={104} height={67} fill="none" stroke="rgba(226,232,240,0.35)" strokeWidth={0.45} />
                  <line x1={52.5} y1={0} x2={52.5} y2={68} stroke="rgba(226,232,240,0.3)" strokeWidth={0.4} />
                  <circle cx={52.5} cy={34} r={9.15} fill="none" stroke="rgba(226,232,240,0.3)" strokeWidth={0.4} />
                  <rect x={0} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(226,232,240,0.3)" strokeWidth={0.4} />
                  <rect x={88.5} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(226,232,240,0.3)" strokeWidth={0.4} />
                  {squadAnalysis.starting_xi.map((slot) => {
                    const isWeak = squadAnalysis.weakest_positions.includes(slot.slot_code);
                    const fill = isWeak ? "#f43f5e" : slot.style_fit_pct >= 79 ? "#10b981" : "#f59e0b";
                    const shortName = slot.name.split(" ").slice(-1)[0];
                    return (
                      <g key={slot.slot_idx}>
                        <circle cx={slot.x_m} cy={slot.y_m} r={3.2} fill={fill} stroke="#070b12" strokeWidth={0.5} />
                        <text x={slot.x_m} y={slot.y_m + 0.85} textAnchor="middle" fontSize="2.2" fontWeight="bold" fill="#070b12">
                          {slot.jersey_number ?? slot.slot_code}
                        </text>
                        <text x={slot.x_m} y={slot.y_m + 5.7} textAnchor="middle" fontSize="2.0" fontWeight="bold" fill="#f8fafc">
                          {shortName} ({Math.round(slot.style_fit_pct)}%)
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>الدوائر الحمراء = أولوية تدعيم عاجلة وفق أسلوب اللعب المختار</span>
                <span className="font-mono">{squadAnalysis.squad.length} لاعب مسجل</span>
              </div>
            </div>

            {/* Weakest Slots + Moneyball Transfer Recommendations */}
            <div className="lg:col-span-6 space-y-3">
              <div className="text-xs font-bold text-rose-300">أضعف 3 مراكز في القائمة الحالية وفقاً لأسلوب اللعب:</div>
              <div className="grid grid-cols-3 gap-2">
                {squadAnalysis.weakest_slots.map((w) => (
                  <div key={w.slot_idx} className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-2.5 text-xs">
                    <div className="font-bold text-rose-200">{w.slot_label_ar}</div>
                    <div className="mt-0.5 text-[11px] text-slate-300 truncate">{w.name}</div>
                    <div className="mt-1 font-mono text-xs font-black text-rose-400">{w.style_fit_pct}%</div>
                  </div>
                ))}
              </div>

              <div className="text-xs font-bold text-emerald-300">ترشيحات التعاقد لرفع جودة الفريق (من الدوري المصري والدرجة الثانية):</div>
              <div className="max-h-56 space-y-2 overflow-y-auto pl-1">
                {squadAnalysis.transfer_targets.map((tg) => (
                  <div
                    key={tg.id}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs hover:border-emerald-500/40"
                  >
                    <div>
                      <div className="font-bold text-slate-100">
                        {tg.name} <span className="text-[11px] font-normal text-cyan-300">({tg.position} • {tg.age} سنة)</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {tg.club_name} • بديل لـ {tg.replaces_player} ({tg.target_slot_ar})
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="font-mono text-xs font-black text-emerald-400">
                        +{tg.fit_upgrade_pct}% ({tg.style_fit_pct}%)
                      </div>
                      <div className="font-mono text-[11px] text-amber-300">{fmtEgp(tg.market_value_egp)}</div>
                    </div>
                  </div>
                ))}
                {squadAnalysis.transfer_targets.length === 0 && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
                    الفريق يمتلك بالفعل أعلى العناصر ملائمة لهذا الأسلوب في السوق المحلي.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Add Custom Player Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreatePlayer}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0d1420] p-5 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-slate-100">إضافة لاعب جديد لقاعدة بيانات الكشاف</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="col-span-2">
                <label className="text-slate-400 block mb-1">النادي</label>
                <select
                  value={newPlayerForm.club_id}
                  onChange={(e) => setNewPlayerForm({ ...newPlayerForm, club_id: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100"
                >
                  {clubs.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-slate-400 block mb-1">اسم اللاعب بالكامل</label>
                <input
                  required
                  value={newPlayerForm.name_ar}
                  onChange={(e) => setNewPlayerForm({ ...newPlayerForm, name_ar: e.target.value })}
                  placeholder="مثال: حمزة علاء / محمد عبد الله"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">المركز</label>
                <select
                  value={newPlayerForm.position}
                  onChange={(e) => setNewPlayerForm({ ...newPlayerForm, position: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100"
                >
                  {["GK", "CB", "RB", "LB", "DM", "CM", "AM", "RW", "LW", "ST"].map((pos) => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">العمر / رقم القميص</label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min={15}
                    max={42}
                    value={newPlayerForm.age}
                    onChange={(e) => setNewPlayerForm({ ...newPlayerForm, age: Number(e.target.value) })}
                    className="w-1/2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100"
                  />
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={newPlayerForm.jersey_number}
                    onChange={(e) => setNewPlayerForm({ ...newPlayerForm, jersey_number: Number(e.target.value) })}
                    className="w-1/2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">القدم المفضلة</label>
                <select
                  value={newPlayerForm.preferred_foot}
                  onChange={(e) => setNewPlayerForm({ ...newPlayerForm, preferred_foot: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100"
                >
                  <option value="Right">Right</option>
                  <option value="Left">Left</option>
                  <option value="Both">Both</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">القيمة السوقية (يورو)</label>
                <input
                  type="number"
                  step={50000}
                  min={50000}
                  value={newPlayerForm.market_value_eur}
                  onChange={(e) => setNewPlayerForm({ ...newPlayerForm, market_value_eur: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-xl border border-slate-700 px-3.5 py-2 text-xs text-slate-300"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400"
              >
                حفظ اللاعب
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search & Filters Header */}
      <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-slate-100">رادار الكشاف الذكي وبدائل الصفقات (Moneyball مصر)</h2>
              <p className="text-xs text-slate-400">
                قاعدة بيانات موسم 2025/2026 أوفلاين (دوري نايل، دوري المحترفين، قطاع الناشئين 2005-2008) مع محرك Cosine Similarity
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="ابحث باسم اللاعب أو النادي..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-9 pl-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {DIVISION_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setDivision(t.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                division === t.id
                  ? "bg-emerald-500 text-slate-950"
                  : "border border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
              }`}
            >
              {t.label}
            </button>
          ))}

          <div className="mr-auto flex flex-wrap gap-1.5">
            {POS_FILTERS.map((pf) => (
              <button
                key={pf.id}
                onClick={() => setPosFilter(pf.id)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  posFilter === pf.id
                    ? "border border-cyan-500 bg-cyan-500/20 text-cyan-200"
                    : "border border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
                }`}
              >
                {pf.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Split: Player Pool List + 14-Metric Position Radar & Moneyball Clones */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left List */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800/80 bg-[#0d1420] p-3.5">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400 px-1">
            <span>قائمة اللاعبين ({dbData?.total_returned ?? 0})</span>
            <span>اضغط للمعاينة</span>
          </div>
          <div className="max-h-[540px] space-y-2 overflow-y-auto pl-1">
            {(dbData?.players || []).map((p) => {
              const isSel = selectedPlayer?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPlayer(p);
                    if (moneyball?.target.id !== p.id) {
                      setMoneyball(null);
                      setSelectedAlt(null);
                    }
                  }}
                  className={`w-full rounded-xl border p-3 text-right transition ${
                    isSel
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-slate-800/80 bg-slate-950/60 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-sm text-slate-100">{p.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {p.club_name} • {p.position} • {p.age} سنة
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-xs font-bold text-emerald-300">
                        {p.overall_rating}
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-amber-300">
                        {fmtEgp(p.market_value_egp)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Detail: Position-Specific 14-Metric Radar + Moneyball Alternatives */}
        <div className="lg:col-span-7 space-y-4 rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4">
          {selectedPlayer ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-slate-100">{selectedPlayer.name}</h3>
                    <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-xs font-bold text-cyan-300">
                      {selectedPlayer.position}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedPlayer.club_name} • {selectedPlayer.age} سنة • القدم المفضلة: {selectedPlayer.preferred_foot} • القيمة:{" "}
                    <strong className="text-amber-300">{fmtEgp(selectedPlayer.market_value_egp)}</strong>
                  </p>
                </div>

                <button
                  onClick={() => handleFindAlternatives(selectedPlayer.id)}
                  disabled={loadingMb}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  <DollarSign className="h-4 w-4" />
                  {loadingMb ? "جاري حساب التطابق الهندسي..." : "ابحث عن البديل الأرخص في دوري المحترفين والناشئين"}
                </button>
              </div>

              <div className="flex justify-center py-2">
                <PlayerScoutingCard
                  axes={radarAxes}
                  primaryName={`${selectedPlayer.name} (${selectedPlayer.club_name})`}
                  compareName={
                    moneyball?.target.id === selectedPlayer.id && selectedAlt
                      ? `${selectedAlt.name} (${selectedAlt.club_name})`
                      : undefined
                  }
                  size={390}
                />
              </div>

              {/* Moneyball Cosine Similarity Results */}
              {moneyball && moneyball.target.id === selectedPlayer.id && (
                <div className="space-y-2.5 border-t border-slate-800 pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-bold text-emerald-300">
                      <UserCheck className="h-4 w-4" />
                      أقرب البدائل الاقتصادية بتقنية Cosine Similarity (14 بُعد فني وبدني):
                    </span>
                    <span className="text-[11px] text-slate-400">اضغط على أي مرشح لمقارنته على الرادار</span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {moneyball.alternatives.map((alt) => {
                      const isPicked = selectedAlt?.id === alt.id;
                      return (
                        <button
                          key={alt.id}
                          onClick={() => setSelectedAlt(alt)}
                          className={`rounded-xl border p-3 text-right transition ${
                            isPicked
                              ? "border-sky-400 bg-sky-500/15"
                              : "border-slate-800 bg-slate-950/70 hover:border-slate-600"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-slate-100">{alt.name}</span>
                            <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-xs font-black text-emerald-300">
                              تطابق {alt.similarity_pct}%
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {alt.club_name} • {alt.position} • {alt.age} سنة
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px]">
                            <span className="font-mono text-amber-300">{fmtEgp(alt.market_value_egp)}</span>
                            <span className="font-semibold text-cyan-300">وفر {alt.savings_pct}% في الصفقة</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-20 text-center text-slate-500">اختر لاعباً لعرض الرادار المخصص لمركزه</div>
          )}
        </div>
      </div>

      {/* Live Video-Tracked Match Top Prospects */}
      {prospects.length > 0 && (
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-300">
            <Trophy className="h-4 w-4" />
            أفضل اللاعبين المكتشفين تلقائياً من تحليل الفيديو بالذكاء الاصطناعي
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {prospects.slice(0, 5).map((pr) => (
              <Link
                key={pr.stat_id}
                href={`/player/${pr.stat_id}`}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 transition hover:border-emerald-500"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-100">{pr.player_name}</span>
                  <span className="font-mono text-xs font-black text-emerald-400">{pr.scout_score}</span>
                </div>
                <div className="mt-1 truncate text-[11px] text-slate-400">{pr.match_title}</div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-cyan-300">
                  <span>{pr.max_speed_kmh} كم/س • xT {pr.xt_generated.toFixed(2)}</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
