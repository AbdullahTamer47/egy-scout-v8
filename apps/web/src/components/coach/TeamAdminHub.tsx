"use client";

import React, { useState } from "react";
import { ClipboardList, Printer, ShieldAlert, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CoachClubDetail, CoachPlayer, MatchdaySheetPayload, SquadDepthReport } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  formation: string;
  matchdaySheet: MatchdaySheetPayload;
  onAdminUpdated: (club: CoachClubDetail, depth: SquadDepthReport, sheet: MatchdaySheetPayload) => void;
  onClubSynced: (club: CoachClubDetail) => void;
}

export default function TeamAdminHub({
  lang,
  club,
  opponent,
  formation,
  matchdaySheet,
  onAdminUpdated,
  onClubSynced,
}: Props) {
  const isAr = lang === "ar";
  const [updatingJersey, setUpdatingJersey] = useState<number | null>(null);
  const [scoresheetText, setScoresheetText] = useState("");
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const updatePlayerStatus = async (p: CoachPlayer, patch: Partial<CoachPlayer>) => {
    setUpdatingJersey(p.jersey_number);
    try {
      const res = await apiFetch<{
        club: CoachClubDetail;
        squad_depth: SquadDepthReport;
        matchday_sheet: MatchdaySheetPayload;
      }>(
        "/api/coach/admin/player-status",
        {
          method: "POST",
          body: JSON.stringify({
            club_id: club.club_id,
            jersey_number: p.jersey_number,
            status: patch.status ?? p.status,
            readiness_pct: patch.readiness_pct ?? p.readiness_pct,
            yellow_cards: patch.yellow_cards ?? p.yellow_cards,
            red_cards: patch.red_cards ?? p.red_cards,
            return_date: patch.return_date ?? p.return_date ?? "",
            admin_note: patch.admin_note ?? p.admin_note ?? "",
            formation,
            opponent_name_ar: opponent.name_ar,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      onAdminUpdated(res.club, res.squad_depth, res.matchday_sheet);
    } finally {
      setUpdatingJersey(null);
    }
  };

  const handleImportScoresheet = async () => {
    if (!scoresheetText.trim()) return;
    setImporting(true);
    setMsg(null);
    try {
      const synced = await apiFetch<CoachClubDetail>(
        "/api/coach/live/sync-club",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "scoresheet",
            club_id: club.club_id,
            name_ar: club.name_ar,
            name_en: club.name_en,
            kit_hex: club.kit_hex,
            raw_text: scoresheetText,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      setMsg(isAr ? `تم استيراد ${synced.players.length} لاعباً من الاسكور شيت بنجاح.` : `Imported ${synced.players.length} players.`);
      onClubSynced(synced);
      setScoresheetText("");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left: Availability, Injuries & Yellow-Card Suspension Ledger */}
        <div className="xl:col-span-7 studio-panel p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-400" />
              <div>
                <h2 className="text-sm font-extrabold text-white">
                  {isAr ? `السجل الطبي والانضباطي — ${club.name_ar}` : `Medical & Discipline Ledger — ${club.name_en}`}
                </h2>
                <p className="text-[11px] text-slate-400">
                  {isAr
                    ? "أي إصابة أو تراكم 3 بطاقات صفراء يوقف اللاعب تلقائياً من التشكيل الأساسي وكشف المباراة"
                    : "Injured players or 3+ yellow cards are automatically excluded from Starting XI"}
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] text-slate-400 border-b border-white/[0.08]">
                  <th className="py-2 text-start">#</th>
                  <th className="py-2 text-start">{isAr ? "اللاعب" : "Player"}</th>
                  <th className="py-2 text-center">{isAr ? "الحالة الطبية" : "Status"}</th>
                  <th className="py-2 text-center">{isAr ? "إنذارات" : "Yellows"}</th>
                  <th className="py-2 text-center">{isAr ? "الجاهزية" : "Ready %"}</th>
                </tr>
              </thead>
              <tbody>
                {club.players.map((p) => (
                  <tr
                    key={p.jersey_number}
                    className={`border-b border-white/[0.05] ${!p.is_eligible_starter ? "bg-rose-950/20" : ""}`}
                  >
                    <td className="py-2 font-extrabold text-emerald-300">#{p.jersey_number}</td>
                    <td className="py-2">
                      <div className="font-bold text-white">{isAr ? p.name_ar : p.name_en}</div>
                      <div className="text-[10px] text-slate-400">
                        {p.position}
                        {p.block_reason_ar ? ` • ${p.block_reason_ar}` : p.warning_ar ? ` • ${p.warning_ar}` : ""}
                      </div>
                    </td>
                    <td className="py-2 text-center">
                      <select
                        disabled={updatingJersey === p.jersey_number}
                        value={p.status}
                        aria-label={`status-${p.jersey_number}`}
                        onChange={(e) => {
                          const st = e.target.value as CoachPlayer["status"];
                          updatePlayerStatus(p, {
                            status: st,
                            readiness_pct: st === "fit" ? 100 : st === "load_managed" ? 75 : 25,
                            yellow_cards: st === "fit" && p.yellow_cards >= 3 ? 0 : p.yellow_cards,
                          });
                        }}
                        className="rounded-lg bg-[#090D16] border border-white/[0.14] px-2 py-1 text-[11px] font-bold text-white"
                      >
                        <option value="fit">{isAr ? "متاح (جاهز)" : "Fit"}</option>
                        <option value="load_managed">{isAr ? "تقنين أحمال" : "Load Managed"}</option>
                        <option value="rehab">{isAr ? "تأهيل فردي" : "Rehab"}</option>
                        <option value="injured">{isAr ? "مصاب" : "Injured"}</option>
                        <option value="suspended">{isAr ? "موقوف" : "Suspended"}</option>
                      </select>
                    </td>
                    <td className="py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updatePlayerStatus(p, { yellow_cards: Math.max(0, p.yellow_cards - 1) })}
                          className="w-5 h-5 rounded bg-white/[0.08] text-white font-bold"
                        >
                          -
                        </button>
                        <span
                          className={`min-w-[20px] font-extrabold ${
                            p.yellow_cards >= 3 ? "text-rose-400" : p.yellow_cards === 2 ? "text-amber-300" : "text-slate-200"
                          }`}
                        >
                          {p.yellow_cards}
                        </span>
                        <button
                          type="button"
                          onClick={() => updatePlayerStatus(p, { yellow_cards: p.yellow_cards + 1 })}
                          className="w-5 h-5 rounded bg-white/[0.08] text-amber-300 font-bold"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="py-2 text-center font-bold text-emerald-300">{p.readiness_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Official 20-Man Matchday Sheet + Scoresheet Import */}
        <div className="xl:col-span-5 space-y-4">
          <div className="studio-panel p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-extrabold text-white">
                    {isAr ? "كشف المباراة الرسمي (قائمة الـ 20)" : "Official Matchday Sheet (20-Man Squad)"}
                  </h3>
                  <div className="text-[11px] text-slate-400">
                    {matchdaySheet.club_name_ar} × {matchdaySheet.opponent_name_ar} • {matchdaySheet.formation_code}
                  </div>
                </div>
              </div>
              <a
                href={`http://127.0.0.1:8080/api/coach/admin/matchday-sheet/print?club_id=${encodeURIComponent(
                  club.club_id
                )}&opponent_id=${encodeURIComponent(opponent.club_id)}&formation=${encodeURIComponent(formation)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 font-extrabold"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{isAr ? "طباعة الكشف الرسمي" : "Print Sheet"}</span>
              </a>
            </div>

            <div>
              <div className="font-extrabold text-emerald-300 mb-1">
                {isAr ? `الأساسيون (${matchdaySheet.starters.length})` : `Starters (${matchdaySheet.starters.length})`}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {matchdaySheet.starters.map((p) => (
                  <div key={p.jersey_number} className="px-2.5 py-1.5 rounded-lg bg-[#090D16] border border-white/[0.07] flex items-center justify-between">
                    <span className="font-bold text-white truncate">
                      #{p.jersey_number} {isAr ? p.name_ar : p.name_en}
                    </span>
                    <span className="text-[10px] font-extrabold text-emerald-300 shrink-0 ms-1">
                      {p.assigned_slot || p.position}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="font-extrabold text-sky-300 mb-1">
                {isAr ? `البدلاء (${matchdaySheet.substitutes.length})` : `Substitutes (${matchdaySheet.substitutes.length})`}
              </div>
              <div className="flex flex-wrap gap-1">
                {matchdaySheet.substitutes.map((p) => (
                  <span key={p.jersey_number} className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[11px] text-slate-200">
                    #{p.jersey_number} {p.name_ar} ({p.position})
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="font-extrabold text-rose-300 mb-1">
                {isAr ? `المستبعدون (${matchdaySheet.excluded.length})` : `Excluded (${matchdaySheet.excluded.length})`}
              </div>
              {matchdaySheet.excluded.length === 0 ? (
                <div className="text-slate-400">{isAr ? "لا يوجد مستبعدون حالياً" : "No excluded players"}</div>
              ) : (
                <div className="space-y-1">
                  {matchdaySheet.excluded.map((p) => (
                    <div key={p.jersey_number} className="px-2.5 py-1 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-200 flex items-center justify-between">
                      <span>#{p.jersey_number} {p.name_ar}</span>
                      <span className="text-[10px] font-bold">{p.block_reason_ar}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Scoresheet Quick Importer */}
          <div className="studio-panel p-4 space-y-2.5 text-xs">
            <div className="flex items-center gap-2 font-extrabold text-white">
              <Upload className="w-4 h-4 text-emerald-400" />
              <span>{isAr ? "استيراد سريع لاسكور شيت رسمي (30 ثانية)" : "Official Scoresheet Quick Import"}</span>
            </div>
            <textarea
              rows={3}
              value={scoresheetText}
              onChange={(e) => setScoresheetText(e.target.value)}
              placeholder={isAr ? "1 - محمد الشناوي (GK)\n10 - إمام عاشور (CM)\n--- احتياط ---\n14 - حسين الشحات" : "1 - Player Name (GK)..."}
              className="w-full rounded-xl bg-[#090D16] border border-white/[0.12] p-2.5 text-xs text-white outline-none focus:border-emerald-400"
            />
            {msg && <div className="text-[11px] font-bold text-emerald-300">{msg}</div>}
            <button
              type="button"
              disabled={importing || !scoresheetText.trim()}
              onClick={handleImportScoresheet}
              className="w-full py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-extrabold disabled:opacity-50"
            >
              {importing ? (isAr ? "جاري الاستيراد..." : "Importing...") : isAr ? "اعتماد وتحديث قائمة الفريق" : "Apply Scoresheet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
