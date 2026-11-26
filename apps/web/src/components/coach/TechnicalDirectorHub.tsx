"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Search, Shield, Users } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  CoachClubDetail,
  CoachClubListItem,
  CoachPlayer,
  LeaguePlayerSearchItem,
  LiveStandingRow,
  SquadDepthReport,
} from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  clubs: CoachClubListItem[];
  squadDepth: SquadDepthReport;
  standings: LiveStandingRow[];
  onSelectPlayer: (player: CoachPlayer, ownerClub: CoachClubDetail) => void;
}

export default function TechnicalDirectorHub({
  lang,
  club,
  opponent,
  clubs,
  squadDepth,
  standings,
  onSelectPlayer,
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

  useEffect(() => {
    if (subView !== "egypt_scout") return;
    let alive = true;
    setLoadingScout(true);
    const qs = new URLSearchParams({
      q: query,
      position: posFilter,
      club_id: scoutClubId,
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
  }, [subView, query, posFilter, scoutClubId, scoutNat, scoutMaxAge, scoutMinHt]);

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
              subView === "club_depth" ? "bg-emerald-500 text-slate-950" : "bg-[#090D16] text-slate-300 border border-white/10"
            }`}
          >
            {isAr ? `عمق قائمة ${club.name_ar} والمنافس` : "Squad Depth & Matchup"}
          </button>
          <button
            type="button"
            onClick={() => setSubView("egypt_scout")}
            className={`px-3.5 py-2 rounded-xl font-extrabold transition ${
              subView === "egypt_scout" ? "bg-emerald-500 text-slate-950" : "bg-[#090D16] text-slate-300 border border-white/10"
            }`}
          >
            {isAr ? "كشاف كل لاعبي الدوري المصري (23 نادي / 691 لاعب)" : "All-Egypt League Scout (691 Players)"}
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAr ? "بحث بالاسم أو الرقم..." : "Search player name/number..."}
            className="w-full rounded-xl bg-[#090D16] border border-white/[0.12] ps-8 pe-3 py-1.5 text-xs text-white outline-none focus:border-emerald-400"
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
              className="rounded-xl bg-[#090D16] border border-white/15 px-3 py-1.5 font-bold text-white"
            >
              <option value="ALL">{isAr ? "كل أندية الدوري المصري (23)" : "All Clubs"}</option>
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
              className="rounded-xl bg-[#090D16] border border-white/15 px-3 py-1.5 font-bold text-white"
            >
              {["ALL", "GK", "CB", "RB", "LB", "DM", "CM", "CAM", "LW", "RW", "ST"].map((p) => (
                <option key={p} value={p}>{p === "ALL" ? (isAr ? "كل المراكز" : "All Positions") : p}</option>
              ))}
            </select>

            <select
              value={scoutNat}
              aria-label="Nationality Filter"
              onChange={(e) => setScoutNat(e.target.value as "all" | "egyptian" | "foreign")}
              className="rounded-xl bg-[#090D16] border border-white/15 px-3 py-1.5 font-bold text-white"
            >
              <option value="all">{isAr ? "مصري + أجنبي" : "All Nationalities"}</option>
              <option value="egyptian">{isAr ? "مصريون فقط" : "Egyptian Only"}</option>
              <option value="foreign">{isAr ? "أجانب فقط" : "Foreign Only"}</option>
            </select>

            <select
              value={scoutMaxAge}
              aria-label="Max Age Filter"
              onChange={(e) => setScoutMaxAge(e.target.value)}
              className="rounded-xl bg-[#090D16] border border-white/15 px-3 py-1.5 font-bold text-white"
            >
              <option value="">{isAr ? "كل الأعمار" : "Any Age"}</option>
              <option value="23">{isAr ? "تحت 23 سنة" : "U23"}</option>
              <option value="27">{isAr ? "تحت 27 سنة" : "U27"}</option>
            </select>

            <select
              value={scoutMinHt}
              aria-label="Min Height Filter"
              onChange={(e) => setScoutMinHt(e.target.value)}
              className="rounded-xl bg-[#090D16] border border-white/15 px-3 py-1.5 font-bold text-white"
            >
              <option value="">{isAr ? "كل الأطوال" : "Any Height"}</option>
              <option value="180">{isAr ? "180+ سم" : "180+ cm"}</option>
              <option value="185">{isAr ? "185+ سم" : "185+ cm"}</option>
            </select>

            <span className="ms-auto font-bold text-emerald-300">
              {loadingScout ? "..." : `${scoutResults.length} ${isAr ? "نتيجة" : "matches"}`}
            </span>
          </div>

          {/* Side-by-Side 2-Player Comparator */}
          {comparePair.length > 0 && (
            <div className="studio-panel p-4 space-y-2 text-xs border border-sky-500/35">
              <div className="flex items-center justify-between font-extrabold text-sky-300">
                <span className="flex items-center gap-1.5">
                  <ArrowLeftRight className="w-4 h-4" />
                  <span>{isAr ? "مقارنة ثنائية مباشرة" : "Side-by-Side Player Comparator"}</span>
                </span>
                <button type="button" onClick={() => setComparePair([])} className="text-[11px] text-rose-300 underline">
                  {isAr ? "مسح المقارنة" : "Clear"}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {comparePair.map((p) => (
                  <div key={`${p.club_id}-${p.jersey_number}`} className="p-3 rounded-2xl bg-[#090D16] border border-white/[0.08] flex items-center justify-between gap-3">
                    <div>
                      <div className="font-extrabold text-white text-sm">
                        #{p.jersey_number} {p.name_ar}
                      </div>
                      <div className="text-slate-400">
                        {p.club_name_ar} • {p.position} • {p.nationality_flag} {p.nationality_ar}
                      </div>
                    </div>
                    <div className="text-end font-bold">
                      <div className="text-emerald-300">{p.age ? `${p.age} سنة` : "-"}</div>
                      <div className="text-sky-300">{p.height_cm ? `${p.height_cm} سم` : "-"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scout Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 text-xs">
            {scoutResults.map((p) => {
              const isCmp = comparePair.some((x) => x.club_id === p.club_id && x.jersey_number === p.jersey_number);
              return (
                <div
                  key={`${p.club_id}-${p.jersey_number}`}
                  className="p-3 rounded-2xl bg-[#0C1220] border border-white/[0.08] hover:border-emerald-400/50 space-y-2"
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
                        <img src={p.photo_url} alt={p.name_ar} className="w-10 h-10 rounded-xl object-cover object-top border border-white/15 shrink-0" />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-white shrink-0"
                          style={{ backgroundColor: `${p.club_kit_hex}55` }}
                        >
                          #{p.jersey_number}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-extrabold text-white truncate">{p.name_ar}</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {p.club_name_ar} • {p.position}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCompare(p)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 ${
                        isCmp ? "bg-sky-500 text-slate-950" : "bg-white/[0.06] text-slate-300"
                      }`}
                    >
                      {isCmp ? "✓" : isAr ? "مقارنة" : "Cmp"}
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-300 pt-1 border-t border-white/[0.06]">
                    <span>{p.nationality_flag} {p.nationality_ar || p.nationality}</span>
                    <span>{p.age ? `${p.age}س` : "-"} • {p.height_cm ? `${p.height_cm}سم` : "-"}</span>
                  </div>
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
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-extrabold text-white">
                    {isAr
                      ? `خريطة عمق الملعب (${squadDepth.formation_code}) — ${club.name_ar}`
                      : `Visual Pitch Depth (${squadDepth.formation_code})`}
                  </h2>
                </div>
                <div>
                  <span className="text-emerald-300 font-bold">{squadDepth.fit_count} {isAr ? "جاهز" : "Fit"}</span>
                  {" • "}
                  <span className="text-rose-300 font-bold">{squadDepth.unavailable_count} {isAr ? "مستبعد" : "Out"}</span>
                </div>
              </div>

              <div className="relative w-full aspect-[16/10] rounded-2xl border border-emerald-500/30 bg-[#062016] overflow-hidden">
                <svg viewBox="0 0 105 68" className="w-full h-full">
                  <rect x="0" y="0" width="105" height="68" fill="#062016" />
                  {[0, 2, 4, 6, 8].map((i) => (
                    <rect key={i} x={i * 10.5} y="0" width="10.5" height="68" fill="#08291D" />
                  ))}
                  <rect x="2" y="2" width="101" height="64" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.45" />
                  <line x1="52.5" y1="2" x2="52.5" y2="66" stroke="rgba(255,255,255,0.35)" strokeWidth="0.4" />
                  <circle cx="52.5" cy="34" r="9.15" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.4" />
                </svg>

                {squadDepth.slots.map((sl) => {
                  const leftPct = Math.max(8, Math.min(92, sl.x_norm * 100));
                  const topPct = Math.max(11, Math.min(89, sl.y_norm * 100));
                  const depthColor = !sl.starter ? "border-rose-400" : sl.backups.length === 0 ? "border-amber-300" : "border-emerald-300";
                  return (
                    <button
                      key={sl.slot}
                      type="button"
                      disabled={!sl.starter}
                      onClick={() => sl.starter && onSelectPlayer(sl.starter, club)}
                      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center text-center"
                    >
                      <div className={`px-2 py-1 rounded-xl bg-[#090D16]/90 border-2 ${depthColor} shadow-lg min-w-[74px]`}>
                        <div className="text-[9px] font-extrabold text-emerald-300">{sl.slot}</div>
                        <div className="text-[10px] font-extrabold text-white truncate max-w-[78px]">
                          {sl.starter ? `#${sl.starter.jersey_number} ${(sl.starter.name_ar || sl.starter.name_en).split(" ").slice(-1)[0]}` : "نقص"}
                        </div>
                        <div className="text-[8.5px] text-slate-400 truncate max-w-[78px]">
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
                    <div key={i} className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/35 text-xs font-bold text-amber-200 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{al}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="xl:col-span-5 studio-panel p-4 space-y-3 text-xs">
              <h3 className="text-sm font-extrabold text-white">
                {isAr ? "تحليل المواجهة المباشرة (البيانات الحية)" : "Head-to-Head Live Club Profile"}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { c: club, st: clubStanding, tag: isAr ? "فريقك" : "Your Club", accent: "border-emerald-500/40 bg-emerald-500/10" },
                  { c: opponent, st: oppStanding, tag: isAr ? "الخصم" : "Opponent", accent: "border-sky-500/40 bg-sky-500/10" },
                ].map((item) => (
                  <div key={item.c.club_id} className={`p-3 rounded-2xl border ${item.accent} space-y-1.5`}>
                    <div className="text-[10px] font-bold text-slate-300">{item.tag}</div>
                    <div className="text-sm font-extrabold text-white truncate">{isAr ? item.c.name_ar : item.c.name_en}</div>
                    <div className="text-[11px] text-slate-300">{item.c.stadium_ar || "-"}</div>
                    <div className="pt-1 border-t border-white/10 text-[11px] space-y-0.5">
                      <div>{isAr ? "المركز:" : "Rank:"} <b className="text-amber-300">{item.st ? `#${item.st.rank}` : "-"}</b></div>
                      <div>{isAr ? "النقاط:" : "Pts:"} <b className="text-white">{item.st ? `${item.st.points} نقطة (${item.st.played})` : "-"}</b></div>
                      <div>{isAr ? "القائمة:" : "Squad:"} <b className="text-emerald-300">{item.c.players.length}</b></div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-2xl bg-[#090D16] border border-white/[0.08] text-slate-300 leading-relaxed">
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
                <Users className="w-4 h-4 text-emerald-400" />
                <div className="flex items-center gap-1.5 bg-[#090D16] p-1 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setViewTeam("club")}
                    className={`px-3 py-1 rounded-lg text-xs font-extrabold ${
                      viewTeam === "club" ? "bg-emerald-500 text-slate-950" : "text-slate-300"
                    }`}
                  >
                    {club.name_ar} ({club.players.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewTeam("opponent")}
                    className={`px-3 py-1 rounded-lg text-xs font-extrabold ${
                      viewTeam === "opponent" ? "bg-sky-500 text-slate-950" : "text-slate-300"
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
                      posFilter === p ? "bg-emerald-500 text-slate-950" : "bg-[#090D16] text-slate-300 border border-white/10"
                    }`}
                  >
                    {p === "ALL" ? (isAr ? "الكل" : "All") : p}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
              {filteredPlayers.map((p) => (
                <button
                  key={`${activeClub.club_id}-${p.jersey_number}`}
                  type="button"
                  onClick={() => onSelectPlayer(p, activeClub)}
                  className={`p-3 rounded-2xl border text-start transition hover:scale-[1.01] ${
                    p.is_eligible_starter
                      ? "bg-[#090D16] border-white/[0.08] hover:border-emerald-400/60"
                      : "bg-rose-950/20 border-rose-500/35 hover:border-rose-400"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    {p.photo_url ? (
                      <img
                        src={p.photo_url}
                        alt={p.name_ar}
                        className="w-11 h-11 rounded-xl object-cover object-top border border-white/15 bg-slate-900 shrink-0"
                      />
                    ) : (
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-sm text-white border border-white/15 shrink-0"
                        style={{ backgroundColor: `${activeClub.kit_hex || "#10B981"}55` }}
                      >
                        #{p.jersey_number}
                      </div>
                    )}
                    <div className="text-end">
                      <div className="text-xs font-extrabold text-emerald-300">{p.position}</div>
                      <div className="text-[10px] text-slate-400">#{p.jersey_number} {p.nationality_flag || ""}</div>
                    </div>
                  </div>
                  <div className="mt-2 font-extrabold text-xs text-white truncate">
                    {isAr ? p.name_ar || p.name_en : p.name_en}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {p.age ? `${p.age}س` : p.nationality_ar || "EGY"}
                    {p.height_cm ? ` • ${p.height_cm}سم` : ""}
                  </div>
                  {!p.is_eligible_starter && (
                    <div className="mt-1 text-[10px] font-bold text-rose-300 truncate">{p.block_reason_ar}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
