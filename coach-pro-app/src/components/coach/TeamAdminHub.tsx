"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, CheckSquare, ClipboardList, Globe, Printer, ShieldAlert, Square, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CoachClubDetail, CoachPlayer, ForeignQuotaSummary, MatchdaySheetPayload, SquadDepthReport } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  formation: string;
  foreignQuota: ForeignQuotaSummary;
  matchdaySheet: MatchdaySheetPayload;
  onAdminUpdated: (club: CoachClubDetail, depth: SquadDepthReport, sheet: MatchdaySheetPayload) => void;
  onClubSynced: (club: CoachClubDetail) => void;
}

const DEFAULT_LOGISTICS = [
  { id: "hotel", ar: "تأكيد معسكر الفندق وتسكين اللاعبين" },
  { id: "kits", ar: "اعتماد ألوان الأطقم الرسمية في الاجتماع الفني" },
  { id: "medical", ar: "حقيبة الإسعافات وأجهزة التبريد والتغذية" },
  { id: "cards", ar: "مراجعة البطاقات والـ ID الإلكتروني قبل الـ 90 دقيقة" },
  { id: "bus", ar: "موعد تحرك الحافلة والتأمين المروري للاستاد" },
];

export default function TeamAdminHub({
  lang,
  club,
  opponent,
  formation,
  foreignQuota,
  matchdaySheet,
  onAdminUpdated,
  onClubSynced,
}: Props) {
  const isAr = lang === "ar";
  const [updatingJersey, setUpdatingJersey] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "fit" | "blocked" | "risk">("all");
  const [scoresheetText, setScoresheetText] = useState("");
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [checkedOps, setCheckedOps] = useState<Record<string, boolean>>({});
  const [sheetStarters, setSheetStarters] = useState<CoachPlayer[]>(matchdaySheet.starters || []);
  const [sheetSubs, setSheetSubs] = useState<CoachPlayer[]>(matchdaySheet.substitutes || []);
  const [swapStarterJersey, setSwapStarterJersey] = useState<number | null>(null);
  const [swapMsg, setSwapMsg] = useState<string | null>(null);

  useEffect(() => {
    setSheetStarters(matchdaySheet.starters || []);
    setSheetSubs(matchdaySheet.substitutes || []);
    setSwapStarterJersey(null);
  }, [matchdaySheet]);

  const handleSwapWithSub = (subPlayer: CoachPlayer) => {
    if (swapStarterJersey === null) return;
    const starterIdx = sheetStarters.findIndex((p) => p.jersey_number === swapStarterJersey);
    const subIdx = sheetSubs.findIndex((p) => p.jersey_number === subPlayer.jersey_number);
    if (starterIdx === -1 || subIdx === -1) return;

    const outgoing = sheetStarters[starterIdx];
    const incoming: CoachPlayer = {
      ...subPlayer,
      assigned_slot: outgoing.assigned_slot || subPlayer.position,
      assigned_role_ar: outgoing.assigned_role_ar,
    };
    const nextStarters = [...sheetStarters];
    nextStarters[starterIdx] = incoming;
    const nextSubs = [...sheetSubs];
    nextSubs[subIdx] = outgoing;

    setSheetStarters(nextStarters);
    setSheetSubs(nextSubs);
    setSwapStarterJersey(null);
    setSwapMsg(
      isAr
        ? `تم تبديل #${incoming.jersey_number} ${incoming.name_ar} مكان #${outgoing.jersey_number} ${outgoing.name_ar} ✓`
        : `Swapped #${incoming.jersey_number} with #${outgoing.jersey_number} ✓`
    );
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`egy_scout_ops_${club.club_id}`);
      if (raw) setCheckedOps(JSON.parse(raw));
    } catch {}
  }, [club.club_id]);

  const toggleOps = (id: string) => {
    setCheckedOps((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(`egy_scout_ops_${club.club_id}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const filteredRoster = useMemo(() => {
    return club.players.filter((p) => {
      if (statusFilter === "fit") return p.is_eligible_starter;
      if (statusFilter === "blocked") return !p.is_eligible_starter;
      if (statusFilter === "risk") return p.yellow_cards === 2;
      return true;
    });
  }, [club.players, statusFilter]);

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
      {/* Top Foreign Quota Meter Bar */}
      <div className="studio-panel p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <Globe className="w-4 h-4 text-emerald-600" />
          <div>
            <div className="font-extrabold text-slate-900">
              {isAr ? `لائحة الأجانب (الدوري المصري): ${foreignQuota.foreign_count} / ${foreignQuota.limit}` : `Foreign Quota: ${foreignQuota.foreign_count} / ${foreignQuota.limit}`}
            </div>
            <div className="text-[11px] text-slate-500">
              {foreignQuota.foreign_players.map((f) => `${f.nationality_flag} ${f.name_ar}`).join(" • ") || (isAr ? "لا يوجد لاعبون أجانب مسجلون" : "None")}
            </div>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full font-extrabold border ${
            foreignQuota.status === "over_limit"
              ? "bg-rose-50 text-rose-700 border-rose-200"
              : foreignQuota.status === "warning"
                ? "bg-amber-50 text-amber-800 border-amber-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }`}
        >
          {foreignQuota.status === "over_limit"
            ? isAr ? "تجاوز الحد الأقصى" : "Over Limit"
            : isAr ? `متبقي ${foreignQuota.remaining_slots} مكان` : `${foreignQuota.remaining_slots} left`}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left: Availability, Injuries & Yellow-Card Suspension Ledger */}
        <div className="xl:col-span-7 studio-panel p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-extrabold text-slate-900">
                {isAr ? `السجل الطبي والانضباطي — ${club.name_ar}` : `Medical & Discipline Ledger — ${club.name_en}`}
              </h2>
            </div>

            <div className="flex flex-wrap gap-1 text-[11px]">
              {(
                [
                  ["all", isAr ? "الكل" : "All"],
                  ["fit", isAr ? "جاهز" : "Fit"],
                  ["blocked", isAr ? "مستبعد" : "Out"],
                  ["risk", isAr ? "مهدد (2🟨)" : "Risk"],
                ] as const
              ).map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusFilter(id)}
                  className={`px-2.5 py-1 rounded-lg font-bold ${
                    statusFilter === id ? "bg-emerald-600 text-white shadow-2xs" : "bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] bg-slate-50 text-slate-600 border-b border-slate-200">
                  <th className="py-2 px-1.5 text-start">#</th>
                  <th className="py-2 text-start">{isAr ? "اللاعب" : "Player"}</th>
                  <th className="py-2 text-center">{isAr ? "الحالة الطبية" : "Status"}</th>
                  <th className="py-2 text-center">{isAr ? "إنذارات" : "Yellows"}</th>
                  <th className="py-2 text-center">{isAr ? "الجاهزية" : "Ready %"}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoster.map((p) => (
                  <tr
                    key={p.jersey_number}
                    className={`border-b border-slate-100 hover:bg-slate-50/70 ${!p.is_eligible_starter ? "bg-rose-50/70" : ""}`}
                  >
                    <td className="py-2 px-1.5 font-extrabold text-emerald-700">#{p.jersey_number}</td>
                    <td className="py-2">
                      <div className="font-bold text-slate-900">{isAr ? p.name_ar : p.name_en}</div>
                      <div className="text-[10px] text-slate-500">
                        {p.position} {p.age ? `• ${p.age}س` : ""}
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
                        className="rounded-lg bg-white border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-800"
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
                          className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-bold"
                        >
                          -
                        </button>
                        <span
                          className={`min-w-[20px] font-extrabold ${
                            p.yellow_cards >= 3 ? "text-rose-600" : p.yellow_cards === 2 ? "text-amber-600" : "text-slate-700"
                          }`}
                        >
                          {p.yellow_cards}
                        </span>
                        <button
                          type="button"
                          onClick={() => updatePlayerStatus(p, { yellow_cards: p.yellow_cards + 1 })}
                          className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-200 text-amber-700 font-bold"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="py-2 text-center font-bold text-emerald-700">{p.readiness_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Official 20-Man Matchday Sheet + Camp Checklist + Scoresheet Import */}
        <div className="xl:col-span-5 space-y-4">
          <div className="studio-panel p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-emerald-600" />
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {isAr ? "كشف المباراة الرسمي (قائمة الـ 20)" : "Official Matchday Sheet (20-Man Squad)"}
                  </h3>
                  <div className="text-[11px] text-slate-500">
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-2xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{isAr ? "طباعة الكشف الرسمي" : "Print Sheet"}</span>
              </a>
            </div>

            {swapStarterJersey !== null ? (
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-bold flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-amber-700" />
                  <span>{isAr ? `اضغط على أي بديل لتبديله باللاعب #${swapStarterJersey}` : `Click any sub to swap with #${swapStarterJersey}`}</span>
                </span>
                <button type="button" onClick={() => setSwapStarterJersey(null)} className="text-[10px] underline">
                  {isAr ? "إلغاء" : "Cancel"}
                </button>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">
                {isAr ? "انقر على أي لاعب أساسي ثم على أي بديل للتبديل الفوري في الكشف." : "Click a starter then a substitute for 1-click swap."}
              </div>
            )}

            {swapMsg && (
              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[11px]">
                {swapMsg}
              </div>
            )}

            <div>
              <div className="font-extrabold text-emerald-700 mb-1">
                {isAr ? `الأساسيون (${sheetStarters.length})` : `Starters (${sheetStarters.length})`}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {sheetStarters.map((p) => {
                  const activeSwap = swapStarterJersey === p.jersey_number;
                  return (
                    <button
                      key={p.jersey_number}
                      type="button"
                      onClick={() => setSwapStarterJersey(activeSwap ? null : p.jersey_number)}
                      className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between text-start transition ${
                        activeSwap
                          ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/30"
                          : "bg-slate-50 border-slate-200 hover:border-emerald-300"
                      }`}
                    >
                      <span className="font-bold text-slate-900 truncate">
                        #{p.jersey_number} {isAr ? p.name_ar : p.name_en}
                      </span>
                      <span className="text-[10px] font-extrabold text-emerald-700 shrink-0 ms-1">
                        {p.assigned_slot || p.position}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="font-extrabold text-sky-700 mb-1">
                {isAr ? `البدلاء (${sheetSubs.length})` : `Substitutes (${sheetSubs.length})`}
              </div>
              <div className="flex flex-wrap gap-1">
                {sheetSubs.map((p) => (
                  <button
                    key={p.jersey_number}
                    type="button"
                    onClick={() => handleSwapWithSub(p)}
                    className={`px-2 py-1 rounded-full border text-[11px] font-bold transition ${
                      swapStarterJersey !== null
                        ? "bg-sky-50 border-sky-300 text-sky-900 hover:bg-sky-100 cursor-pointer"
                        : "bg-slate-100 border-slate-200 text-slate-700"
                    }`}
                  >
                    #{p.jersey_number} {p.name_ar} ({p.position})
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="font-extrabold text-rose-700 mb-1">
                {isAr ? `المستبعدون (${matchdaySheet.excluded.length})` : `Excluded (${matchdaySheet.excluded.length})`}
              </div>
              {matchdaySheet.excluded.length === 0 ? (
                <div className="text-slate-500">{isAr ? "لا يوجد مستبعدون حالياً" : "No excluded players"}</div>
              ) : (
                <div className="space-y-1">
                  {matchdaySheet.excluded.map((p) => (
                    <div key={p.jersey_number} className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between">
                      <span className="font-bold">#{p.jersey_number} {p.name_ar}</span>
                      <span className="text-[10px] font-bold">{p.block_reason_ar}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Interactive Matchday Camp & Logistics Checklist */}
          <div className="studio-panel p-4 space-y-2 text-xs">
            <div className="font-extrabold text-slate-900">{isAr ? "قائمة مهام المعسكر واللوجستيات" : "Matchday Camp & Logistics Checklist"}</div>
            <div className="space-y-1.5">
              {DEFAULT_LOGISTICS.map((item) => {
                const done = !!checkedOps[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleOps(item.id)}
                    className={`w-full flex items-center gap-2 p-2 rounded-xl border text-start transition ${
                      done ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-white"
                    }`}
                  >
                    {done ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-slate-400 shrink-0" />}
                    <span className={done ? "line-through opacity-80" : ""}>{item.ar}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scoresheet Quick Importer */}
          <div className="studio-panel p-4 space-y-2.5 text-xs">
            <div className="flex items-center gap-2 font-extrabold text-slate-900">
              <Upload className="w-4 h-4 text-emerald-600" />
              <span>{isAr ? "استيراد سريع لاسكور شيت رسمي (30 ثانية)" : "Official Scoresheet Quick Import"}</span>
            </div>
            <textarea
              rows={2}
              value={scoresheetText}
              onChange={(e) => setScoresheetText(e.target.value)}
              placeholder={isAr ? "1 - محمد الشناوي (GK)\n10 - إمام عاشور (CM)..." : "1 - Player Name (GK)..."}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:bg-white"
            />
            {msg && <div className="text-[11px] font-bold text-emerald-700">{msg}</div>}
            <button
              type="button"
              disabled={importing || !scoresheetText.trim()}
              onClick={handleImportScoresheet}
              className="w-full py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 font-extrabold disabled:opacity-50"
            >
              {importing ? (isAr ? "جاري الاستيراد..." : "Importing...") : isAr ? "اعتماد وتحديث قائمة الفريق" : "Apply Scoresheet"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
