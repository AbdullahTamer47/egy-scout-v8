"use client";

import React, { useState } from "react";
import {
  Calendar,
  Compass,
  Download,
  Globe,
  RefreshCw,
  Shield,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  ClubTacticalProfile,
  CoachClubDetail,
  CoachPlayer,
  getShortArabicName,
  isLightHex,
  LiveHubPayload,
  TacticalPhaseId,
  ThreePhaseBlueprint,
} from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  initialHub: LiveHubPayload;
  onClubSynced?: (clubId: string) => void;
  onSelectPlayer?: (player: CoachPlayer, club: CoachClubDetail) => void;
  onSelectAsOpponent?: (clubId: string, leagueId: string) => void;
}

interface ClubScheduleMatch {
  event_id: string;
  competition: string;
  date_utc: string;
  status: string;
  home_id: number;
  away_id: number;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  outcome: "W" | "D" | "L" | null;
  is_home: boolean;
  home_logo: string;
  away_logo: string;
}

interface ClubIntelPayload {
  club: CoachClubDetail;
  formation: string;
  tactical_profile: ClubTacticalProfile;
  blueprint: ThreePhaseBlueprint;
  upcoming_matches: ClubScheduleMatch[];
  recent_results: ClubScheduleMatch[];
}

const LEAGUE_PILLS = [
  { id: "egy.1", ar: "الدوري المصري", en: "Egypt EPL", logo: "https://imagecache.365scores.com/image/upload/f_png,w_96,h_96,c_limit,q_auto:eco,dpr_2,d_Competitions:default.png/v1/Competitions/552" },
  { id: "eng.1", ar: "الإنجليزي", en: "Premier League", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png" },
  { id: "esp.1", ar: "الإسباني", en: "LaLiga", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png" },
  { id: "ger.1", ar: "الألماني", en: "Bundesliga", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png" },
  { id: "ita.1", ar: "الإيطالي", en: "Serie A", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png" },
  { id: "fra.1", ar: "الفرنسي", en: "Ligue 1", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png" },
  { id: "uefa.champions", ar: "أبطال أوروبا", en: "UEFA CL", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png" },
  { id: "caf.champions", ar: "أبطال إفريقيا", en: "CAF CL", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/67.png" },
];

const INTEL_PHASES: Array<{ id: TacticalPhaseId; ar: string; en: string }> = [
  { id: "attack", ar: "1. الهجوم والإنهاء", en: "1. Attack" },
  { id: "possession", ar: "2. الاستحواذ والبناء", en: "2. Possession" },
  { id: "defense", ar: "3. الدفاع والضغط", en: "3. Defense" },
];

export default function LiveFootballHubPanel({
  lang,
  initialHub,
  onClubSynced,
  onSelectPlayer,
  onSelectAsOpponent,
}: Props) {
  const isAr = lang === "ar";
  const [hub, setHub] = useState<LiveHubPayload>(initialHub);
  const [activeLeague, setActiveLeague] = useState(initialHub?.league_id || "egy.1");
  const [loading, setLoading] = useState(false);
  const [syncingTeam, setSyncingTeam] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);

  const [clubIntel, setClubIntel] = useState<ClubIntelPayload | null>(null);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const [intelTab, setIntelTab] = useState<"tactics" | "upcoming" | "results">("tactics");
  const [intelPhase, setIntelPhase] = useState<TacticalPhaseId>("attack");
  const [brokenImgs, setBrokenImgs] = useState<Record<string, boolean>>({});

  const loadLeague = async (lid: string, forceRefresh = false) => {
    setActiveLeague(lid);
    setLoading(true);
    setToast(null);
    try {
      const res = await apiFetch<LiveHubPayload>(
        `/api/coach/live/hub?league=${encodeURIComponent(lid)}&force_refresh=${forceRefresh}`,
        {},
        "club_demo_egypt",
        "coach"
      );
      setHub(res);
    } catch {
      setToast({
        text: isAr ? "تعذر تحديث جدول البطولة حالياً، حاول مجدداً بعد قليل." : "Unable to refresh competition right now.",
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const openClubIntel = async (teamId: string, teamName: string) => {
    if (!teamId) return;
    setLoadingIntel(true);
    setToast(null);
    setIntelTab("tactics");
    setIntelPhase("attack");
    try {
      const res = await apiFetch<ClubIntelPayload>(
        `/api/coach/live/club-intel?club_id=${encodeURIComponent(teamId)}&league=${encodeURIComponent(
          activeLeague
        )}&team_name=${encodeURIComponent(teamName)}`,
        {},
        "club_demo_egypt",
        "coach"
      );
      setClubIntel(res);
    } catch {
      setToast({
        text: isAr ? `تعذر فتح ملف ${teamName} التكتيكي حالياً.` : `Unable to load ${teamName} tactical sheet.`,
        isError: true,
      });
    } finally {
      setLoadingIntel(false);
    }
  };

  const syncTeamLive = async (teamId: string, teamName: string) => {
    setSyncingTeam(teamId);
    setToast(null);
    try {
      const isEgypt = activeLeague === "egy.1";
      const mode = teamId.startsWith("ts365_") || isEgypt ? "auto" : "espn";
      const res = await apiFetch<{ club_id: string; name_ar: string; players: unknown[] }>(
        "/api/coach/live/sync-club",
        {
          method: "POST",
          body: JSON.stringify({
            mode,
            league_slug: activeLeague,
            club_id: teamId,
            team_id: teamId,
            name_ar: teamName,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      setToast({
        text: isAr
          ? `✓ تم تحديث قائمة ${res.name_ar || teamName} بنجاح (${res.players.length} لاعباً)`
          : `✓ Synced ${teamName} (${res.players.length} players)`,
      });
      if (onClubSynced) onClubSynced(res.club_id);
    } catch {
      setToast({
        text: isAr
          ? `تعذر تحديث قائمة ${teamName} في الوقت الحالي.`
          : `Unable to sync ${teamName} squad right now.`,
        isError: true,
      });
    } finally {
      setSyncingTeam(null);
    }
  };

  const activeIntelPhase = clubIntel?.blueprint?.phase_states?.[intelPhase] || null;
  const clubKitLight = clubIntel ? isLightHex(clubIntel.club.kit_hex) : false;

  const findIntelPlayer = (jersey?: number | null, label?: string): CoachPlayer | null => {
    if (!clubIntel?.club?.players) return null;
    if (jersey != null) {
      const byJ = clubIntel.club.players.find((p) => p.jersey_number === jersey);
      if (byJ) return byJ;
    }
    if (label) {
      const clean = label.trim().toLowerCase();
      return (
        clubIntel.club.players.find(
          (p) => p.name_ar.toLowerCase().includes(clean) || p.name_en.toLowerCase().includes(clean)
        ) || null
      );
    }
    return null;
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      {/* Header & League Switcher */}
      <div className="studio-panel p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#15803D]" />
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">
                {isAr ? "البطولات المباشرة، الخطط وجداول المباريات" : "Live Tournaments, Tactics & Schedules"}
              </h2>
              <div className="text-[11px] text-slate-500">
                {isAr ? hub.league_name_ar : hub.league_name_en} • {isAr ? "موسم 2026/27" : "2026/27 Season"} •{" "}
                <span className={hub.is_live ? "text-[#15803D] font-bold" : "text-amber-700 font-bold"}>
                  {hub.is_live ? (isAr ? "مباشر الآن" : "LIVE") : isAr ? "محدث" : "Updated"}
                </span>
                {hub.fetched_at_cairo ? ` • ${hub.fetched_at_cairo}` : ""}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadLeague(activeLeague, true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-xs font-extrabold text-[#15803D]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{isAr ? "تحديث الجدول الآن" : "Refresh Table"}</span>
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LEAGUE_PILLS.map((lg) => (
            <button
              key={lg.id}
              type="button"
              onClick={() => {
                setClubIntel(null);
                loadLeague(lg.id, false);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-extrabold whitespace-nowrap shrink-0 transition ${
                activeLeague === lg.id
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-50 border border-slate-200 text-slate-800 hover:bg-white"
              }`}
            >
              <img
                src={lg.logo}
                alt={lg.en}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                className="w-4 h-4 object-contain shrink-0 rounded-sm bg-white p-0.5"
              />
              <span>{isAr ? lg.ar : lg.en}</span>
            </button>
          ))}
        </div>

        {toast && (
          <div
            className={`p-2.5 rounded-xl border text-xs font-bold ${
              toast.isError
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-emerald-50 border-emerald-200 text-emerald-800"
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>

      {/* Inline Club Tactical & Upcoming Matches Explorer */}
      {(loadingIntel || clubIntel) && (
        <div className="studio-panel p-4 space-y-3 border-2 border-slate-300">
          {loadingIntel && !clubIntel ? (
            <div className="text-xs font-bold text-slate-600 py-6 text-center">
              {isAr ? "جاري تجهيز الخطة التكتيكية وجدول المباريات القادمة..." : "Loading club tactical blueprint & schedule..."}
            </div>
          ) : (
            clubIntel && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {clubIntel.club.logo_url ? (
                      <img
                        src={clubIntel.club.logo_url}
                        alt={clubIntel.club.name_ar}
                        className="w-10 h-10 rounded-xl object-contain bg-slate-50 border border-slate-200 p-1 shrink-0"
                      />
                    ) : (
                      <Shield className="w-8 h-8 text-slate-700" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                          {isAr ? clubIntel.club.name_ar : clubIntel.club.name_en}
                        </h3>
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#15803D] border border-emerald-200 text-[11px] font-extrabold">
                          {clubIntel.formation}
                        </span>
                        <span className="text-[11px] font-bold text-slate-500">
                          {clubIntel.club.players.length} {isAr ? "لاعباً" : "players"}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 line-clamp-1 mt-0.5">
                        {isAr ? clubIntel.tactical_profile.identity_ar : clubIntel.tactical_profile.identity_en}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {onSelectAsOpponent && (
                      <button
                        type="button"
                        onClick={() => onSelectAsOpponent(clubIntel.club.club_id, activeLeague)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-[11px] font-bold"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>{isAr ? "تحضير مواجهة ضد هذا الفريق" : "Prepare Match vs Club"}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setClubIntel(null)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                      aria-label="Close Club Sheet"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Club Intel Tabs */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setIntelTab("tactics")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${
                      intelTab === "tactics" ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-700 border-slate-200"
                    }`}
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>{isAr ? "الخطة والتشكيل (3 حالات)" : "3-Phase Tactics"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIntelTab("upcoming")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${
                      intelTab === "upcoming" ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-700 border-slate-200"
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>
                      {isAr ? `المباريات القادمة (${clubIntel.upcoming_matches.length})` : `Upcoming (${clubIntel.upcoming_matches.length})`}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIntelTab("results")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${
                      intelTab === "results" ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-700 border-slate-200"
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{isAr ? "آخر النتائج والقائمة" : "Results & Squad"}</span>
                  </button>
                </div>

                {/* Tab 1: 3-Phase Formation & Player Face Cards */}
                {intelTab === "tactics" && activeIntelPhase && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                    <div className="lg:col-span-7 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
                          {INTEL_PHASES.map((ph) => (
                            <button
                              key={ph.id}
                              type="button"
                              onClick={() => setIntelPhase(ph.id)}
                              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                                intelPhase === ph.id ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600"
                              }`}
                            >
                              {isAr ? ph.ar : ph.en}
                            </button>
                          ))}
                        </div>
                        <span className="text-[11px] font-bold text-[#15803D]">
                          {clubIntel.tactical_profile.phase_shapes?.attack} → {clubIntel.tactical_profile.phase_shapes?.possession} → {clubIntel.tactical_profile.phase_shapes?.defense}
                        </span>
                      </div>

                      <div className="relative w-full min-h-[260px] aspect-[16/10] rounded-xl border border-emerald-800/30 bg-[#15803D] overflow-hidden">
                        <svg viewBox="0 0 105 68" className="w-full h-full">
                          <rect x="0" y="0" width="105" height="68" fill="#15803D" />
                          {[0, 2, 4, 6, 8].map((i) => (
                            <rect key={i} x={i * 10.5} y="0" width="10.5" height="68" fill="#166534" />
                          ))}
                          <rect x="2" y="2" width="101" height="64" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.5" />
                          <line x1="52.5" y1="2" x2="52.5" y2="66" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
                          <circle cx="52.5" cy="34" r="9.15" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
                          <rect x="2" y="13.84" width="16.5" height="40.32" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
                          <rect x="86.5" y="13.84" width="16.5" height="40.32" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.45" />
                        </svg>
                        {activeIntelPhase.nodes.map((n, idx) => {
                          const leftPct = Math.max(7, Math.min(93, (n.x_m / 105) * 100));
                          const topPct = Math.max(12, Math.min(88, (n.y_m / 68) * 100));
                          const pl = findIntelPlayer(n.jersey_number, n.player_label);
                          const isGk = n.slot === "GK";
                          const darkInk = isGk || clubKitLight;
                          const shortNm = pl ? getShortArabicName(pl) : n.player_label || n.slot;
                          return (
                            <button
                              key={`${n.slot}-${idx}`}
                              type="button"
                              disabled={!pl || !onSelectPlayer}
                              onClick={() => pl && onSelectPlayer && onSelectPlayer(pl, clubIntel.club)}
                              style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group z-10 hover:z-20 cursor-pointer"
                            >
                              <span className="mb-0.5 px-1 rounded bg-slate-900/90 text-[8px] font-bold text-emerald-300">
                                {n.slot}
                              </span>
                              <div className="relative flex items-center justify-center group-hover:scale-110 transition">
                                {pl?.photo_url && !brokenImgs[pl.photo_url] ? (
                                  <div
                                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-full overflow-hidden border-2 bg-white shadow"
                                    style={{ borderColor: isGk ? "#EAB308" : clubIntel.club.kit_hex || "#DC2626" }}
                                  >
                                    <img
                                      src={pl.photo_url}
                                      alt={shortNm}
                                      onError={() => setBrokenImgs((b) => ({ ...b, [pl.photo_url!]: true }))}
                                      className="w-full h-full object-cover object-top"
                                    />
                                  </div>
                                ) : (
                                  <div
                                    className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-extrabold ${
                                      darkInk ? "border-slate-900 text-slate-900" : "border-white text-white"
                                    }`}
                                    style={{ backgroundColor: isGk ? "#EAB308" : clubIntel.club.kit_hex || "#DC2626" }}
                                  >
                                    {n.jersey_number ?? "?"}
                                  </div>
                                )}
                                {pl?.photo_url && !brokenImgs[pl.photo_url] && (
                                  <span className="absolute -bottom-0.5 -end-1 px-1 rounded-full bg-slate-900 text-white text-[8px] font-extrabold border border-white">
                                    {n.jersey_number ?? pl.jersey_number}
                                  </span>
                                )}
                              </div>
                              <span className="mt-0.5 px-1.5 py-0.5 rounded bg-slate-900/90 text-[8.5px] font-bold text-white whitespace-nowrap max-w-[78px] truncate">
                                {shortNm}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="lg:col-span-5 space-y-2.5 text-xs">
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                        <div className="font-extrabold text-slate-900">{activeIntelPhase.label_ar}</div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">{activeIntelPhase.description_ar}</p>
                        <div className="flex flex-wrap gap-2 pt-1 text-[10.5px]">
                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-bold text-slate-700">
                            {isAr ? "الخط:" : "Line:"} {clubIntel.tactical_profile.line_height}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-bold text-slate-700">
                            {isAr ? "الضغط:" : "Press:"} {clubIntel.tactical_profile.pressing_style}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5">
                        <div className="font-extrabold text-slate-900 text-[11px]">
                          {isAr ? "أقرب المباريات القادمة لهذا الفريق:" : "Next Fixtures for Club:"}
                        </div>
                        {clubIntel.upcoming_matches.length === 0 ? (
                          <div className="text-[11px] text-slate-500">
                            {isAr ? "لا توجد مباريات مجدولة متاحة حالياً." : "No scheduled matches available."}
                          </div>
                        ) : (
                          clubIntel.upcoming_matches.slice(0, 3).map((fx) => (
                            <div key={fx.event_id} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">
                              <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                                <span className="font-bold text-[#15803D]">{fx.competition}</span>
                                <span>{(fx.date_utc || "").slice(0, 16).replace("T", " ")}</span>
                              </div>
                              <div className="flex items-center justify-between font-bold text-slate-900">
                                <span className="truncate">{fx.home_team}</span>
                                <span className="text-[10px] text-slate-400 px-1">VS</span>
                                <span className="truncate text-end">{fx.away_team}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: Full Club Upcoming Matches */}
                {intelTab === "upcoming" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {clubIntel.upcoming_matches.length === 0 ? (
                      <div className="text-xs text-slate-500 py-4">{isAr ? "لا توجد مباريات قادمة مجدولة حالياً." : "No upcoming matches."}</div>
                    ) : (
                      clubIntel.upcoming_matches.map((fx) => (
                        <div key={fx.event_id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="px-2 py-0.5 rounded bg-emerald-50 text-[#15803D] border border-emerald-200 font-bold">
                              {fx.competition || (isAr ? "مباراة رسمية" : "Official Match")}
                            </span>
                            <span className="text-slate-500 font-semibold">{(fx.date_utc || "").slice(0, 16).replace("T", " ")}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 font-extrabold text-slate-900">
                            <span className="flex items-center gap-1.5 truncate flex-1">
                              {fx.home_logo && <img src={fx.home_logo} alt="" className="w-5 h-5 object-contain shrink-0" />}
                              <span className="truncate">{fx.home_team}</span>
                            </span>
                            <span className="text-[10px] text-slate-400 px-1 shrink-0">VS</span>
                            <span className="flex items-center justify-end gap-1.5 truncate flex-1 text-end">
                              <span className="truncate">{fx.away_team}</span>
                              {fx.away_logo && <img src={fx.away_logo} alt="" className="w-5 h-5 object-contain shrink-0" />}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Tab 3: Recent Results & Full Squad Face Cards */}
                {intelTab === "results" && (
                  <div className="space-y-3">
                    {clubIntel.recent_results.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {clubIntel.recent_results.slice(0, 6).map((fx) => (
                          <div key={fx.event_id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-900 truncate flex-1">{fx.home_team}</span>
                            <span
                              className={`px-2 py-0.5 rounded font-extrabold shrink-0 ${
                                fx.outcome === "W"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : fx.outcome === "L"
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {fx.home_score ?? 0} - {fx.away_score ?? 0}
                            </span>
                            <span className="font-bold text-slate-900 truncate flex-1 text-end">{fx.away_team}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-64 overflow-y-auto p-1">
                      {clubIntel.club.players.slice(0, 24).map((p) => (
                        <button
                          key={`${p.jersey_number}-${p.name_ar}`}
                          type="button"
                          onClick={() => onSelectPlayer && onSelectPlayer(p, clubIntel.club)}
                          className="p-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 flex items-center gap-2 text-start transition"
                        >
                          {p.photo_url && !brokenImgs[p.photo_url] ? (
                            <img
                              src={p.photo_url}
                              alt={p.name_ar}
                              onError={() => setBrokenImgs((b) => ({ ...b, [p.photo_url!]: true }))}
                              className="w-8 h-8 rounded-full object-cover object-top border border-slate-200 shrink-0"
                            />
                          ) : (
                            <span className="w-8 h-8 rounded-full bg-slate-900 text-white text-[10px] font-extrabold flex items-center justify-center shrink-0">
                              {p.jersey_number}
                            </span>
                          )}
                          <div className="min-w-0">
                            <div className="text-[11px] font-extrabold text-slate-900 truncate">{getShortArabicName(p)}</div>
                            <div className="text-[10px] text-slate-500">#{p.jersey_number} • {p.position}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </div>
      )}

      {/* Main Grid: Standings + Fixtures */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Standings */}
        <div className="xl:col-span-8 studio-panel p-4 overflow-x-auto">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-extrabold text-slate-900">
                {isAr ? `جدول الترتيب الحي — ${hub.league_name_ar}` : `Live Standings — ${hub.league_name_en}`}
              </h3>
            </div>
            <span className="text-[10.5px] text-slate-500 font-semibold">
              {isAr ? "اضغط على أي نادي لعرض خطته ومبارياته القادمة" : "Click any club to view tactics & schedule"}
            </span>
          </div>

          {hub.standings.length === 0 ? (
            <div className="text-xs text-slate-500 py-8 text-center">
              {loading
                ? isAr ? "جاري جلب البيانات الحية..." : "Loading live table..."
                : isAr ? "لا تتوفر جداول مجموعات حالياً لهذه البطولة — تابع المباريات بالجانب الآخر." : "No table available; inspect fixtures."}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="py-2 px-1.5 text-start">#</th>
                  <th className="py-2 text-start">{isAr ? "النادي" : "Club"}</th>
                  <th className="py-2 text-center">{isAr ? "لعب" : "P"}</th>
                  <th className="py-2 text-center">{isAr ? "ف" : "W"}</th>
                  <th className="py-2 text-center">{isAr ? "ت" : "D"}</th>
                  <th className="py-2 text-center">{isAr ? "خ" : "L"}</th>
                  <th className="py-2 text-center">{isAr ? "له/عليه" : "GF:GA"}</th>
                  <th className="py-2 text-center">{isAr ? "الفارق" : "GD"}</th>
                  <th className="py-2 text-center text-[#15803D]">{isAr ? "نقاط" : "Pts"}</th>
                  <th className="py-2 text-end">{isAr ? "الخطط والمزامنة" : "Plan & Sync"}</th>
                </tr>
              </thead>
              <tbody>
                {hub.standings.map((row, idx) => (
                  <tr
                    key={`${row.rank}-${row.team_name}`}
                    className={`border-b border-slate-100 hover:bg-emerald-50/40 ${idx % 2 === 1 ? "bg-slate-50/40" : ""}`}
                  >
                    <td className="py-2 px-1.5 font-extrabold text-amber-700">{row.rank}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => row.team_id && openClubIntel(row.team_id, row.team_name_ar || row.team_name)}
                        className="flex items-center gap-2 text-start hover:text-[#15803D]"
                      >
                        {row.logo_url ? (
                          <img
                            src={row.logo_url}
                            alt={row.team_name}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                            className="w-5 h-5 object-contain shrink-0"
                          />
                        ) : (
                          <span
                            className="w-3 h-3 rounded-full border border-slate-400 shrink-0"
                            style={{ backgroundColor: row.kit_hex || "#15803D" }}
                          />
                        )}
                        <span className="font-bold text-slate-900 underline-offset-2 hover:underline">
                          {isAr ? row.team_name_ar : row.team_name}
                        </span>
                      </button>
                    </td>
                    <td className="py-2 text-center text-slate-600">{row.played}</td>
                    <td className="py-2 text-center font-bold text-[#15803D]">{row.wins}</td>
                    <td className="py-2 text-center text-slate-500">{row.draws}</td>
                    <td className="py-2 text-center font-bold text-rose-600">{row.losses}</td>
                    <td className="py-2 text-center text-slate-600">
                      {row.gf}:{row.ga}
                    </td>
                    <td className="py-2 text-center text-slate-700 font-semibold">{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
                    <td className="py-2 text-center font-extrabold text-[#15803D]">{row.points}</td>
                    <td className="py-2 text-end">
                      <div className="inline-flex items-center gap-1 justify-end">
                        <button
                          type="button"
                          disabled={!row.team_id}
                          onClick={() => openClubIntel(row.team_id, row.team_name_ar || row.team_name)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold disabled:opacity-40"
                        >
                          <Compass className="w-3 h-3" />
                          <span>{isAr ? "الخطة والمباريات" : "Plan"}</span>
                        </button>
                        <button
                          type="button"
                          disabled={syncingTeam === row.team_id || !row.team_id}
                          onClick={() => syncTeamLive(row.team_id, row.team_name_ar || row.team_name)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-bold text-[#15803D] disabled:opacity-40"
                        >
                          <Download className="w-3 h-3" />
                          <span>{syncingTeam === row.team_id ? "..." : isAr ? "مزامنة" : "Sync"}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Upcoming & Recent Fixtures */}
        <div className="xl:col-span-4 space-y-4">
          <div className="studio-panel p-4 space-y-2.5">
            <h3 className="text-xs font-extrabold text-slate-900">
              {isAr ? "المواجهات القادمة" : "Upcoming Fixtures"}
            </h3>
            {hub.upcoming_fixtures.length === 0 ? (
              <div className="text-xs text-slate-500">{isAr ? "لا توجد مباريات قادمة مجدولة حالياً." : "No upcoming fixtures."}</div>
            ) : (
              <div className="space-y-2">
                {hub.upcoming_fixtures.slice(0, 6).map((fx) => (
                  <div key={fx.event_id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                    <div className="flex items-center justify-between font-bold text-slate-900">
                      <span className="truncate">{fx.home_team}</span>
                      <span className="text-[10px] font-extrabold text-[#15803D] px-1.5">VS</span>
                      <span className="truncate">{fx.away_team}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center justify-between">
                      <span>{fx.status}</span>
                      <span>{(fx.date_utc || "").slice(0, 16).replace("T", " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="studio-panel p-4 space-y-2.5">
            <h3 className="text-xs font-extrabold text-[#15803D]">
              {isAr ? "أحدث النتائج الرسمية" : "Recent Official Results"}
            </h3>
            {hub.recent_results.length === 0 ? (
              <div className="text-xs text-slate-500">{isAr ? "لا توجد نتائج مسجلة حالياً." : "No recent results."}</div>
            ) : (
              <div className="space-y-2">
                {hub.recent_results.slice(0, 6).map((fx) => (
                  <div key={fx.event_id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 truncate flex-1">{fx.home_team}</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-extrabold shrink-0">
                      {fx.home_score} - {fx.away_score}
                    </span>
                    <span className="font-bold text-slate-900 truncate flex-1 text-end">{fx.away_team}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
