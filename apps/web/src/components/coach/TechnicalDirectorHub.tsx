"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Search, Shield, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  CoachClubDetail,
  CoachClubListItem,
  CoachPlayer,
  isLightHex,
  LeaguePlayerSearchItem,
  LiveStandingRow,
  SquadDepthReport,
} from "./coachTypes";

import { COACH_LEAGUES as TD_COACH_LEAGUES } from "./coachTypes";
import { Sparkles as TdSparkles, ShieldPlus as TdShieldPlus } from "lucide-react";
import { loadCachedLeagueClubs as tdLoadCachedClubs, saveCachedLeagueClubs as tdSaveCachedClubs } from "@/lib/coachStorage";

interface Props {
  lang: "ar" | "en";
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  clubs: CoachClubListItem[];
  squadDepth: SquadDepthReport;
  standings: LiveStandingRow[];
  onSelectPlayer: (player: CoachPlayer, ownerClub: CoachClubDetail) => void;
  onAskAiAboutPlayer?: (player: CoachPlayer, ownerClub?: CoachClubDetail) => void;
  onAskAiAboutClub?: (targetClub: CoachClubDetail) => void;
  onOpenOpponentPicker?: () => void;
}

export default function TechnicalDirectorHub({
  lang,
  club,
  opponent,
  clubs,
  squadDepth,
  standings,
  onSelectPlayer,
  onAskAiAboutPlayer,
  onAskAiAboutClub,
  onOpenOpponentPicker,
}: Props) {
  const isAr = lang === "ar";
  const [subView, setSubView] = useState<"club_depth" | "egypt_scout">("club_depth");
  const [viewTeam, setViewTeam] = useState<"club" | "opponent">("club");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");

  // All-Egypt 690+ Player Explorer & 2-Player Comparator
  const [scoutClubId, setScoutClubId] = useState<string>("ALL");
  const [scoutNat, setScoutNat] = useState<"all" | "egyptian" | "foreign">("all");
  const [scoutMaxAge, setScoutMaxAge] = useState<string>("");
  const [scoutMinHt, setScoutMinHt] = useState<string>("");
  const [scoutResults, setScoutResults] = useState<LeaguePlayerSearchItem[]>([]);
  const [loadingScout, setLoadingScout] = useState(false);
  const [comparePair, setComparePair] = useState<LeaguePlayerSearchItem[]>([]);

  const [scoutLeague, setScoutLeague] = useState<string>(club.league_id || "egy.1");
  const [scoutClubs, setScoutClubs] = useState<CoachClubListItem[]>(clubs);

  useEffect(() => {
    if (subView !== "egypt_scout") return;
    const cached = tdLoadCachedClubs(scoutLeague);
    if (cached && cached.length > 0) setScoutClubs(cached);
    apiFetch<{ clubs: CoachClubListItem[] }>(
      `/api/coach/clubs?league=${encodeURIComponent(scoutLeague)}`,
      {},
      "club_demo_egypt",
      "coach"
    )
      .then((res) => {
        const list = res.clubs || [];
        if (list.length > 0) {
          setScoutClubs(list);
          tdSaveCachedClubs(scoutLeague, list);
        }
      })
      .catch(() => {});
  }, [subView, scoutLeague]);

  useEffect(() => {
    if (subView !== "egypt_scout") return;
    let alive = true;
    setLoadingScout(true);
    const qs = new URLSearchParams({
      q: query,
      position: posFilter,
      club_id: scoutClubId,
      league: scoutLeague,
      nationality_type: scoutNat,
      limit: "90",
    });
    if (scoutMaxAge) qs.set("max_age", scoutMaxAge);
    if (scoutMinHt) qs.set("min_height", scoutMinHt);

    apiFetch<{ players: LeaguePlayerSearchItem[] }>(`/api/coach/league-players?${qs.toString()}`, {}, "club_demo_egypt", "coach")
      .then((res) => {
        if (alive) setScoutResults(res.players || []);
      })
      .finally(() => {
        if (alive) setLoadingScout(false);
      });
    return () => {
      alive = false;
    };
  }, [subView, query, posFilter, scoutClubId, scoutLeague, scoutNat, scoutMaxAge, scoutMinHt]);

  const activeClub = viewTeam === "club" ? club : opponent;
  const filteredPlayers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeClub.players.filter((p) => {
      if (posFilter !== "ALL" && !p.position.toUpperCase().includes(posFilter)) return false;
      if (!q) return true;
      return (
        p.name_ar.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        String(p.jersey_number).includes(q)
      );
    });
  }, [activeClub.players, posFilter, query]);

  const clubStanding = standings.find(
    (s) => s.team_id === club.club_id || s.team_name.toLowerCase().includes(club.name_en.toLowerCase())
  );
  const oppStanding = standings.find(
    (s) => s.team_id === opponent.club_id || s.team_name.toLowerCase().includes(opponent.name_en.toLowerCase())
  );

  const toggleCompare = (p: LeaguePlayerSearchItem) => {
    setComparePair((prev) => {
      const exists = prev.some((x) => x.club_id === p.club_id && x.jersey_number === p.jersey_number);
      if (exists) return prev.filter((x) => !(x.club_id === p.club_id && x.jersey_number === p.jersey_number));
      return [...prev.slice(-1), p];
    });
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      {/* Sub-view Switcher: Club Depth vs All-Egypt League 690+ Player Scout */}
      <div className="studio-panel p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubView("club_depth")}
            className={`px-3.5 py-2 rounded-xl font-extrabold transition ${
              subView === "club_depth" ? "bg-emerald-600 text-white shadow-2xs" : "bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"
            }`}
          >
            {isAr ? `عمق قائمة ${club.name_ar} والمنافس` : "Squad Depth & Matchup"}
          </button>
          <button
            type="button"
            onClick={() => setSubView("egypt_scout")}
            className={`px-3.5 py-2 rounded-xl font-extrabold transition ${
              subView === "egypt_scout" ? "bg-[#0D717A] text-white shadow-2xs" : "bg-[#F2F6F8] text-[#0B1F3A] border border-[#D8E3EB] hover:bg-slate-100"
            }`}
          >
            {isAr ? "كشاف كل لاعبي الدوري المصري 2026/27" : "All-Egypt League Scout 2026/27"}
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAr ? "بحث بالاسم أو الرقم..." : "Search player name/number..."}
            className="w-full rounded-xl bg-slate-50 border border-slate-200 ps-8 pe-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:bg-white"
          />
        </div>
      </div>

      {subView === "egypt_scout" ? (
        <div className="space-y-4">
          {/* Scout Filters */}
          <div className="studio-panel p-4 flex flex-wrap items-center gap-2.5 text-xs">
            <select
              value={scoutClubId}
              aria-label="Filter Club"
              onChange={(e) => setScoutClubId(e.target.value)}
              className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 font-bold text-slate-800"
            >
              <option value="ALL">{isAr ? `كل أندية الدوري (${clubs.length})` : `All Clubs (${clubs.length})`}</option>
              {clubs.map((c) => (
                <option key={c.club_id} value={c.club_id}>
                  {c.name_ar} ({c.player_count})
                </option>
              ))}
            </select>

            <select
              value={posFilter}
              aria-label="Filter Position"
              onChange={(e) => setPosFilter(e.target.value)}
              className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 font-bold text-slate-800"
            >
              {["ALL", "GK", "CB", "RB", "LB", "DM", "CM", "CAM", "LW", "RW", "ST"].map((p) => (
                <option key={p} value={p}>{p === "ALL" ? (isAr ? "كل المراكز" : "All Positions") : p}</option>
              ))}
            </select>

            <select
              value={scoutNat}
              aria-label="Nationality Filter"
              onChange={(e) => setScoutNat(e.target.value as "all" | "egyptian" | "foreign")}
              className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 font-bold text-slate-800"
            >
              <option value="all">{isAr ? "مصري + أجنبي" : "All Nationalities"}</option>
              <option value="egyptian">{isAr ? "مصريون فقط" : "Egyptian Only"}</option>
              <option value="foreign">{isAr ? "أجانب فقط" : "Foreign Only"}</option>
            </select>

            <select
              value={scoutMaxAge}
              aria-label="Max Age Filter"
              onChange={(e) => setScoutMaxAge(e.target.value)}
              className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 font-bold text-slate-800"
            >
              <option value="">{isAr ? "كل الأعمار" : "Any Age"}</option>
              <option value="23">{isAr ? "تحت 23 سنة" : "U23"}</option>
              <option value="27">{isAr ? "تحت 27 سنة" : "U27"}</option>
            </select>

            <select
              value={scoutMinHt}
              aria-label="Min Height Filter"
              onChange={(e) => setScoutMinHt(e.target.value)}
              className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 font-bold text-slate-800"
            >
              <option value="">{isAr ? "كل الأطوال" : "Any Height"}</option>
              <option value="180">{isAr ? "180+ سم" : "180+ cm"}</option>
              <option value="185">{isAr ? "185+ سم" : "185+ cm"}</option>
            </select>

            <span className="ms-auto font-bold text-emerald-700">
              {loadingScout ? "..." : `${scoutResults.length} ${isAr ? "نتيجة" : "matches"}`}
            </span>
          </div>

          {/* Side-by-Side 2-Player Comparator */}
          {comparePair.length > 0 && (
            <div className="studio-panel p-4 space-y-2 text-xs border border-sky-200 bg-sky-50/40">
              <div className="flex items-center justify-between font-extrabold text-sky-800">
                <span className="flex items-center gap-1.5">
                  <ArrowLeftRight className="w-4 h-4 text-sky-600" />
                  <span>{isAr ? "مقارنة ثنائية مباشرة" : "Side-by-Side Player Comparator"}</span>
                </span>
                <button type="button" onClick={() => setComparePair([])} className="text-[11px] text-rose-600 underline">
                  {isAr ? "مسح المقارنة" : "Clear"}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {comparePair.map((p) => (
                  <div key={`${p.club_id}-${p.jersey_number}`} className="p-3 rounded-2xl bg-white border border-slate-200 flex items-center justify-between gap-3 shadow-2xs">
                    <div>
                      <div className="font-extrabold text-slate-900 text-sm">
                        #{p.jersey_number} {p.name_ar}
                      </div>
                      <div className="text-slate-600">
                        {p.club_name_ar} • {p.position} • {p.nationality_flag} {p.nationality_ar}
                      </div>
                    </div>
                    <div className="text-end font-bold">
                      <div className="text-emerald-700">{p.age ? `${p.age} سنة` : "-"}</div>
                      <div className="text-sky-700">{p.height_cm ? `${p.height_cm} سم` : "-"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scout Grid */}
          <div className="rounded-2xl border border-[#D8E3EB] bg-slate-50/80 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-extrabold text-[#0B1F3A]">
                {isAr ? "كشاف الدوريات الـ 8 الحية (تحديث 2026/27 — تحميل تدريجي للنادي)" : "Live 8-League Player Scout (Progressive Club Loading)"}
              </span>
              <span className="text-[10px] font-bold text-[#0D717A]">
                {isAr ? `${scoutClubs.length} نادٍ متاح` : `${scoutClubs.length} clubs ready`}
              </span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {TD_COACH_LEAGUES.map((lg) => (
                <button
                  key={lg.id}
                  type="button"
                  onClick={() => {
                    setScoutLeague(lg.id);
                    setScoutClubId("ALL");
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-extrabold whitespace-nowrap border transition ${
                    scoutLeague === lg.id
                      ? "bg-[#0D717A] text-white border-[#0D717A]"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <img src={lg.logo} alt="" className="w-3.5 h-3.5 object-contain" />
                  <span>{isAr ? lg.ar : lg.en}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setScoutClubId("ALL")}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold whitespace-nowrap border ${
                  scoutClubId === "ALL" ? "bg-[#0B1F3A] text-white border-[#0B1F3A]" : "bg-white text-slate-600 border-slate-200"
                }`}
              >
                {isAr ? "كل الأندية المحمّلة" : "All Loaded Clubs"}
              </button>
              {scoutClubs.map((sc) => (
                <button
                  key={sc.club_id}
                  type="button"
                  onClick={() => setScoutClubId(sc.club_id)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap border transition ${
                    scoutClubId === sc.club_id
                      ? "bg-sky-600 text-white border-sky-600"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-sky-50"
                  }`}
                >
                  {sc.logo_url && <img src={sc.logo_url} alt="" className="w-3.5 h-3.5 object-contain" />}
                  <span>{isAr ? sc.name_ar : sc.name_en}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 text-xs">
            {scoutResults.map((p) => {
              const isCmp = comparePair.some((x) => x.club_id === p.club_id && x.jersey_number === p.jersey_number);
              const lk = isLightHex(p.club_kit_hex);
              return (
                <div
                  key={`${p.club_id}-${p.jersey_number}`}
                  className="p-3 rounded-2xl bg-white border border-slate-200 hover:border-emerald-400 shadow-2xs space-y-2 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onSelectPlayer(p, {
                          club_id: p.club_id,
                          name_ar: p.club_name_ar,
                          name_en: p.club_name_en,
                          kit_hex: p.club_kit_hex,
                          stadium_ar: p.club_stadium_ar,
                          players: [],
                        })
                      }
                      className="flex items-center gap-2.5 min-w-0 text-start"
                    >
                      {p.photo_url ? (
                        <img src={p.photo_url} alt={p.name_ar} className="w-10 h-10 rounded-xl object-cover object-top border border-slate-200 shrink-0" />
                      ) : (
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold shrink-0 border ${
                            lk ? "border-slate-300 text-slate-900" : "border-transparent text-white"
                          }`}
                          style={{ backgroundColor: p.club_kit_hex || "#059669" }}
                        >
                          #{p.jersey_number}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-extrabold text-slate-900 truncate">{p.name_ar}</div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {p.club_name_ar} • {p.position}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCompare(p)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 ${
                        isCmp ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {isCmp ? "✓" : isAr ? "مقارنة" : "Cmp"}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-600 pt-1 border-t border-slate-100">
                    <span>{p.nationality_flag} {p.nationality_ar || p.nationality}</span>
                    <span>{p.age ? `${p.age}س` : "-"} • {p.height_cm ? `${p.height_cm}سم` : "-"}</span>
                  </div>
                  {onAskAiAboutPlayer && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAskAiAboutPlayer(p, {
                          club_id: p.club_id,
                          name_ar: p.club_name_ar,
                          name_en: p.club_name_en,
                          kit_hex: p.club_kit_hex,
                          league_id: scoutLeague,
                          players: [],
                        });
                      }}
                      className="mt-1.5 w-full inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-[#E6F8F7] hover:bg-[#0D717A] text-[#0D717A] hover:text-white border border-[#0FB5AE]/40 text-[10px] font-extrabold transition"
                    >
                      <TdSparkles className="w-3 h-3" />
                      {isAr ? "توظيف بالـ AI" : "AI Role Analysis"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          {/* Visual Green-Pitch 11-Slot Depth Diagram + Opponent Live Comparison */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div className="xl:col-span-7 studio-panel p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-sm font-extrabold text-slate-900">
                    {isAr
                      ? `خريطة عمق الملعب (${squadDepth.formation_code}) — ${club.name_ar}`
                      : `Visual Pitch Depth (${squadDepth.formation_code})`}
                  </h2>
                </div>
                <div>
                  <span className="text-emerald-700 font-bold">{squadDepth.fit_count} {isAr ? "جاهز" : "Fit"}</span>
                  {" • "}
                  <span className="text-rose-600 font-bold">{squadDepth.unavailable_count} {isAr ? "مستبعد" : "Out"}</span>
                </div>
              </div>

              <div className="relative w-full aspect-[16/10] rounded-2xl border border-emerald-700/30 bg-[#15803D] overflow-hidden shadow-sm">
                <svg viewBox="0 0 105 68" className="w-full h-full">
                  <rect x="0" y="0" width="105" height="68" fill="#15803D" />
                  {[0, 2, 4, 6, 8].map((i) => (
                    <rect key={i} x={i * 10.5} y="0" width="10.5" height="68" fill="#166534" />
                  ))}
                  <rect x="2" y="2" width="101" height="64" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.5" />
                  <line x1="52.5" y1="2" x2="52.5" y2="66" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
                  <circle cx="52.5" cy="34" r="9.15" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
                </svg>

                {squadDepth.slots.map((sl) => {
                  const leftPct = Math.max(8, Math.min(92, sl.x_norm * 100));
                  const topPct = Math.max(11, Math.min(89, sl.y_norm * 100));
                  const depthColor = !sl.starter ? "border-rose-500" : sl.backups.length === 0 ? "border-amber-400" : "border-emerald-500";
                  return (
                    <button
                      key={sl.slot}
                      type="button"
                      disabled={!sl.starter}
                      onClick={() => sl.starter && onSelectPlayer(sl.starter, club)}
                      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center text-center"
                    >
                      <div className={`px-2 py-1 rounded-xl bg-white/95 border-2 ${depthColor} shadow-md min-w-[74px]`}>
                        <div className="text-[9px] font-extrabold text-emerald-700">{sl.slot}</div>
                        <div className="text-[10px] font-extrabold text-slate-900 truncate max-w-[78px]">
                          {sl.starter ? `#${sl.starter.jersey_number} ${(sl.starter.name_ar || sl.starter.name_en).split(" ").slice(-1)[0]}` : "نقص"}
                        </div>
                        <div className="text-[8.5px] text-slate-500 truncate max-w-[78px]">
                          +{sl.backups.length} {isAr ? "بديل" : "bkp"}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {squadDepth.shortage_alerts_ar.length > 0 && (
                <div className="space-y-1.5">
                  {squadDepth.shortage_alerts_ar.map((al, i) => (
                    <div key={i} className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{al}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="xl:col-span-5 studio-panel p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-sm font-extrabold text-slate-900">
                  {isAr ? "تحليل المواجهة المباشرة (البيانات الحية)" : "Head-to-Head Live Club Profile"}
                </h3>
                <div className="flex items-center gap-1.5">
                  {onAskAiAboutClub && (
                    <button
                      type="button"
                      onClick={() => onAskAiAboutClub(club)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E6F8F7] border border-[#0FB5AE]/40 text-[#0D717A] text-[10px] font-extrabold hover:bg-[#0D717A] hover:text-white transition"
                    >
                      <TdSparkles className="w-3 h-3" />
                      {isAr ? "تحليل الفريق بالـ AI" : "AI Club Audit"}
                    </button>
                  )}
                  {onOpenOpponentPicker && (
                    <button
                      type="button"
                      onClick={onOpenOpponentPicker}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 text-[10px] font-extrabold hover:bg-sky-600 hover:text-white transition"
                    >
                      <TdShieldPlus className="w-3 h-3" />
                      {opponent.club_id === "none" ? (isAr ? "اختر الخصم" : "Pick Opponent") : (isAr ? "تغيير الخصم" : "Change Opponent")}
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { c: club, st: clubStanding, tag: isAr ? "فريقك" : "Your Club", accent: "border-emerald-200 bg-emerald-50/70" },
                  { c: opponent, st: oppStanding, tag: isAr ? "الخصم" : "Opponent", accent: "border-sky-200 bg-sky-50/70" },
                ].map((item) => (
                  <div key={item.c.club_id} className={`p-3 rounded-2xl border ${item.accent} space-y-1.5`}>
                    <div className="text-[10px] font-bold text-slate-600">{item.tag}</div>
                    <div className="text-sm font-extrabold text-slate-900 truncate">{isAr ? item.c.name_ar : item.c.name_en}</div>
                    <div className="text-[11px] text-slate-600">{item.c.stadium_ar || "-"}</div>
                    <div className="pt-1 border-t border-slate-200/80 text-[11px] text-slate-700 space-y-0.5">
                      <div>{isAr ? "المركز:" : "Rank:"} <b className="text-amber-700">{item.st ? `#${item.st.rank}` : "-"}</b></div>
                      <div>{isAr ? "النقاط:" : "Pts:"} <b className="text-slate-900">{item.st ? `${item.st.points} نقطة (${item.st.played})` : "-"}</b></div>
                      <div>{isAr ? "القائمة:" : "Squad:"} <b className="text-emerald-700">{item.c.players.length}</b></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-700 leading-relaxed">
                {isAr
                  ? `قائمة ${club.name_ar} (${club.players.length} لاعباً) مقابل ${opponent.name_ar} (${opponent.players.length} لاعباً). استخدم تبويب "كشاف كل لاعبي الدوري المصري" بالأعلى للبحث في جميع الـ 23 نادياً أو مقارنة أي لاعبين.`
                  : "Switch to All-Egypt Scout above to search across all 23 clubs or compare players."}
              </div>
            </div>
          </div>

          {/* Club & Opponent Full Player Directory */}
          <div className="studio-panel p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setViewTeam("club")}
                    className={`px-3 py-1 rounded-lg text-xs font-extrabold ${
                      viewTeam === "club" ? "bg-emerald-600 text-white shadow-2xs" : "text-slate-700"
                    }`}
                  >
                    {club.name_ar} ({club.players.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewTeam("opponent")}
                    className={`px-3 py-1 rounded-lg text-xs font-extrabold ${
                      viewTeam === "opponent" ? "bg-sky-600 text-white shadow-2xs" : "text-slate-700"
                    }`}
                  >
                    {opponent.name_ar} ({opponent.players.length})
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                {["ALL", "GK", "CB", "RB", "LB", "DM", "CM", "ST"].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPosFilter(p)}
                    className={`px-2 py-1 rounded-lg font-bold ${
                      posFilter === p ? "bg-emerald-600 text-white" : "bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {p === "ALL" ? (isAr ? "الكل" : "All") : p}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
              {filteredPlayers.map((p) => {
                const lk = isLightHex(activeClub.kit_hex);
                return (
                  <div
                    key={`${activeClub.club_id}-${p.jersey_number}`}
                    className={`rounded-2xl border flex flex-col justify-between transition hover:shadow-sm ${
                      p.is_eligible_starter
                        ? "bg-slate-50 border-slate-200 hover:border-emerald-400 hover:bg-white"
                        : "bg-rose-50/70 border-rose-200 hover:border-rose-400"
                    }`}
                  >
                  <button
                    type="button"
                    onClick={() => onSelectPlayer(p, activeClub)}
                    className="p-3 text-start w-full"
                  >
                    <div className="flex items-center justify-between gap-2">
                      {p.photo_url ? (
                        <img
                          src={p.photo_url}
                          alt={p.name_ar}
                          className="w-11 h-11 rounded-xl object-cover object-top border border-slate-200 bg-slate-100 shrink-0"
                        />
                      ) : (
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-sm border shrink-0 ${
                            lk ? "border-slate-300 text-slate-900" : "border-white/40 text-white"
                          }`}
                          style={{ backgroundColor: activeClub.kit_hex || "#059669" }}
                        >
                          #{p.jersey_number}
                        </div>
                      )}
                      <div className="text-end">
                        <div className="text-xs font-extrabold text-emerald-700">{p.position}</div>
                        <div className="text-[10px] text-slate-500">#{p.jersey_number} {p.nationality_flag || ""}</div>
                      </div>
                    </div>
                    <div className="mt-2 font-extrabold text-xs text-slate-900 truncate">
                      {isAr ? p.name_ar || p.name_en : p.name_en}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {p.age ? `${p.age}س` : p.nationality_ar || "EGY"}
                      {p.height_cm ? ` • ${p.height_cm}سم` : ""}
                    </div>
                    {!p.is_eligible_starter && (
                      <div className="mt-1 text-[10px] font-bold text-rose-600 truncate">{p.block_reason_ar}</div>
                    )}
                  </button>
                  {onAskAiAboutPlayer && (
                    <div className="px-2.5 pb-2">
                      <button
                        type="button"
                        onClick={() => onAskAiAboutPlayer(p, activeClub)}
                        className="w-full inline-flex items-center justify-center gap-1 py-1 rounded-lg bg-[#E6F8F7] hover:bg-[#0D717A] text-[#0D717A] hover:text-white border border-[#0FB5AE]/30 text-[10px] font-extrabold transition"
                      >
                        <TdSparkles className="w-3 h-3" />
                        {isAr ? "اسأل الـ AI عن توظيفه" : "Ask AI Role"}
                      </button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
