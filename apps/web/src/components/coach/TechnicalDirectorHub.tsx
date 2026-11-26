"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Search, Shield, Users } from "lucide-react";
import { CoachClubDetail, CoachPlayer, LiveStandingRow, SquadDepthReport } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  squadDepth: SquadDepthReport;
  standings: LiveStandingRow[];
  onSelectPlayer: (player: CoachPlayer, ownerClub: CoachClubDetail) => void;
}

export default function TechnicalDirectorHub({
  lang,
  club,
  opponent,
  squadDepth,
  standings,
  onSelectPlayer,
}: Props) {
  const isAr = lang === "ar";
  const [viewTeam, setViewTeam] = useState<"club" | "opponent">("club");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");

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

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      {/* Top Grid: Squad Depth Chart + Opponent Live Matchup */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* 11-Slot Squad Depth Chart */}
        <div className="xl:col-span-7 studio-panel p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-extrabold text-white">
                {isAr
                  ? `خريطة عمق القائمة ({${squadDepth.formation_code}}) — ${club.name_ar}`
                  : `Squad Depth Map (${squadDepth.formation_code}) — ${club.name_en}`}
              </h2>
            </div>
            <div className="text-xs font-bold">
              <span className="text-emerald-300">{squadDepth.fit_count} {isAr ? "جاهز" : "Fit"}</span>
              {" • "}
              <span className="text-rose-300">{squadDepth.unavailable_count} {isAr ? "مستبعد" : "Out"}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {squadDepth.slots.map((sl) => (
              <div key={sl.slot} className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.08] text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-emerald-300">{sl.slot}</span>
                  <span className="text-[10px] text-slate-400 truncate">{sl.role_ar}</span>
                </div>
                {sl.starter ? (
                  <button
                    type="button"
                    onClick={() => onSelectPlayer(sl.starter!, club)}
                    className="w-full text-start font-bold text-white hover:text-emerald-300 truncate"
                  >
                    #{sl.starter.jersey_number} {isAr ? sl.starter.name_ar : sl.starter.name_en}
                  </button>
                ) : (
                  <div className="text-rose-400 font-bold">{isAr ? "لا يوجد لاعب متاح" : "No Fit Starter"}</div>
                )}
                {sl.backups.length > 0 && (
                  <div className="text-[10px] text-slate-400 truncate">
                    {isAr ? "البدائل: " : "Backups: "}
                    {sl.backups.map((b) => `#${b.jersey_number} ${b.name_ar.split(" ")[0]}`).join("، ")}
                  </div>
                )}
              </div>
            ))}
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

        {/* Live Matchup & Head-to-Head League Card */}
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
                  <div>
                    {isAr ? "المركز الحي:" : "Rank:"}{" "}
                    <b className="text-amber-300">{item.st ? `#${item.st.rank}` : "-"}</b>
                  </div>
                  <div>
                    {isAr ? "النقاط / اللعب:" : "Pts / P:"}{" "}
                    <b className="text-white">{item.st ? `${item.st.points} نقطة (${item.st.played})` : "-"}</b>
                  </div>
                  <div>
                    {isAr ? "القائمة:" : "Squad:"} <b className="text-emerald-300">{item.c.players.length} لاعباً</b>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-2xl bg-[#090D16] border border-white/[0.08] space-y-1">
            <div className="font-extrabold text-emerald-300">
              {isAr ? "توصية المدير الفني" : "Technical Director Summary"}
            </div>
            <p className="text-slate-300 leading-relaxed">
              {isAr
                ? `قائمة ${club.name_ar} تضم ${squadDepth.fit_count} لاعباً متاحاً أمام ${opponent.name_ar} (${opponent.players.length} لاعباً مسجلاً). اضغط على أي بطاقة لاعب بالأسفل لعرض ملفه التفصيلي الكامل.`
                : `${club.name_en} has ${squadDepth.fit_count} fit players vs ${opponent.name_en} (${opponent.players.length} registered). Click any player below for full profile details.`}
            </p>
          </div>
        </div>
      </div>

      {/* Full Registered Players Directory (Your Team vs Opponent) */}
      <div className="studio-panel p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
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

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-[11px]">
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
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2 start-2.5" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isAr ? "بحث بالاسم أو الرقم..." : "Search name/number..."}
                className="rounded-xl bg-[#090D16] border border-white/[0.12] ps-8 pe-3 py-1 text-xs text-white outline-none focus:border-emerald-400"
              />
            </div>
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
              <div className="text-[10px] text-slate-400 truncate">{p.nationality_ar || p.nationality || "EGY"}</div>
              {!p.is_eligible_starter && (
                <div className="mt-1 text-[10px] font-bold text-rose-300 truncate">{p.block_reason_ar}</div>
              )}
              {p.is_eligible_starter && p.warning_ar && (
                <div className="mt-1 text-[10px] font-bold text-amber-300 truncate">{p.warning_ar}</div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
