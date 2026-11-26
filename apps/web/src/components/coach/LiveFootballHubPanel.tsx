"use client";

import React, { useState } from "react";
import { Download, Globe, RefreshCw, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { LiveHubPayload } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  initialHub: LiveHubPayload;
  onClubSynced?: (clubId: string) => void;
}

const LEAGUE_PILLS = [
  { id: "egy.1", ar: "الدوري المصري", en: "Egypt EPL" },
  { id: "eng.1", ar: "الإنجليزي", en: "Premier League" },
  { id: "esp.1", ar: "الإسباني", en: "LaLiga" },
  { id: "ger.1", ar: "الألماني", en: "Bundesliga" },
  { id: "ita.1", ar: "الإيطالي", en: "Serie A" },
  { id: "uefa.champions", ar: "أبطال أوروبا", en: "UEFA CL" },
  { id: "caf.champions", ar: "أبطال إفريقيا", en: "CAF CL" },
];

export default function LiveFootballHubPanel({ lang, initialHub, onClubSynced }: Props) {
  const isAr = lang === "ar";
  const [hub, setHub] = useState<LiveHubPayload>(initialHub);
  const [activeLeague, setActiveLeague] = useState(initialHub?.league_id || "egy.1");
  const [loading, setLoading] = useState(false);
  const [syncingTeam, setSyncingTeam] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadLeague = async (lid: string, forceRefresh = false) => {
    setActiveLeague(lid);
    setLoading(true);
    try {
      const res = await apiFetch<LiveHubPayload>(
        `/api/coach/live/hub?league=${encodeURIComponent(lid)}&force_refresh=${forceRefresh}`,
        {},
        "club_demo_egypt",
        "coach"
      );
      setHub(res);
    } catch (e) {
      setToast(String(e));
    } finally {
      setLoading(false);
    }
  };

  const syncTeamLive = async (teamId: string, teamName: string) => {
    setSyncingTeam(teamId);
    setToast(null);
    try {
      const isEgypt = activeLeague === "egy.1";
      const res = await apiFetch<{ club_id: string; name_ar: string; players: unknown[] }>(
        "/api/coach/live/sync-club",
        {
          method: "POST",
          body: JSON.stringify(
            isEgypt
              ? { mode: "wikipedia", club_id: teamId }
              : { mode: "espn", league_slug: activeLeague, team_id: teamId }
          ),
        },
        "club_demo_egypt",
        "coach"
      );
      setToast(
        isAr
          ? `تم تحديث قائمة ${res.name_ar} حياً (${res.players.length} لاعباً)`
          : `Synced ${teamName} (${res.players.length} players)`
      );
      if (onClubSynced) onClubSynced(res.club_id);
    } catch (e) {
      setToast(String(e));
    } finally {
      setSyncingTeam(null);
    }
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      {/* Header & League Switcher */}
      <div className="studio-panel p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">
                {isAr ? "مركز البيانات الكروية الحية والموثّقة" : "Live Verified Football Data Hub"}
              </h2>
              <div className="text-[11px] text-slate-500">
                {hub.source} •{" "}
                <span className={hub.is_live ? "text-[#0D717A] font-bold" : "text-amber-700 font-bold"}>
                  {hub.is_live ? (isAr ? "مباشر الآن" : "LIVE") : isAr ? "نسخة مخزنة" : "Cached"}
                </span>
                {hub.fetched_at_cairo ? ` • ${isAr ? "تحديث:" : "Updated:"} ${hub.fetched_at_cairo}` : ""}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadLeague(activeLeague, true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-xs font-extrabold text-emerald-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{isAr ? "تحديث حي الآن" : "Refresh Live"}</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {LEAGUE_PILLS.map((lg) => (
            <button
              key={lg.id}
              type="button"
              onClick={() => loadLeague(lg.id, false)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition ${
                activeLeague === lg.id
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "bg-slate-50 border border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              {isAr ? lg.ar : lg.en}
            </button>
          ))}
        </div>

        {toast && (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">
            {toast}
          </div>
        )}
      </div>

      {/* Main Grid: Standings + Fixtures */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Standings */}
        <div className="xl:col-span-8 studio-panel p-4 overflow-x-auto">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-extrabold text-slate-900">
              {isAr ? `جدول الترتيب الحي — ${hub.league_name_ar}` : `Live Standings — ${hub.league_name_en}`}
            </h3>
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
                  <th className="py-2 text-center text-emerald-700">{isAr ? "نقاط" : "Pts"}</th>
                  <th className="py-2 text-end">{isAr ? "مزامنة القائمة" : "Sync Squad"}</th>
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
                      <div className="flex items-center gap-2">
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
                            style={{ backgroundColor: row.kit_hex || "#10B981" }}
                          />
                        )}
                        <span className="font-bold text-slate-900">{isAr ? row.team_name_ar : row.team_name}</span>
                      </div>
                    </td>
                    <td className="py-2 text-center text-slate-600">{row.played}</td>
                    <td className="py-2 text-center font-bold text-emerald-700">{row.wins}</td>
                    <td className="py-2 text-center text-slate-500">{row.draws}</td>
                    <td className="py-2 text-center font-bold text-rose-600">{row.losses}</td>
                    <td className="py-2 text-center text-slate-600">
                      {row.gf}:{row.ga}
                    </td>
                    <td className="py-2 text-center text-slate-700 font-semibold">{row.gd > 0 ? `+${row.gd}` : row.gd}</td>
                    <td className="py-2 text-center font-extrabold text-emerald-700">{row.points}</td>
                    <td className="py-2 text-end">
                      <button
                        type="button"
                        disabled={syncingTeam === row.team_id || !row.team_id}
                        onClick={() => syncTeamLive(row.team_id, row.team_name_ar || row.team_name)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-bold text-emerald-700 disabled:opacity-40"
                      >
                        <Download className="w-3 h-3" />
                        <span>{syncingTeam === row.team_id ? "..." : isAr ? "مزامنة" : "Sync"}</span>
                      </button>
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
            <h3 className="text-xs font-extrabold text-sky-700">
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
                      <span className="text-[10px] font-extrabold text-emerald-700 px-1.5">VS</span>
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
            <h3 className="text-xs font-extrabold text-emerald-700">
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
