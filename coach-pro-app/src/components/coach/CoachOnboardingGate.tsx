"use client";

import React, { useMemo, useState } from "react";
import { CheckCircle2, Search, Shield, Swords, UserCheck } from "lucide-react";
import BedigitalBrandMark from "./BedigitalBrandMark";
import { CoachClubListItem, CoachProfile, CoachRoleType } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  clubs: CoachClubListItem[];
  initialProfile?: CoachProfile | null;
  saving?: boolean;
  onSubmit: (profile: CoachProfile) => void;
  onCancel?: () => void;
}

const ROLE_OPTIONS: Array<{ id: CoachRoleType; ar: string; en: string; descAr: string }> = [
  { id: "head_coach", ar: "المدير الفني (Head Coach)", en: "Head Coach", descAr: "قيادة الخطط والتدريب والتشكيل" },
  { id: "assistant_coach", ar: "المدرب العام", en: "Assistant Coach", descAr: "تصميم الوحدات والأحمال التدريبية" },
  { id: "technical_director", ar: "المدير الرياضي / الفني", en: "Technical Director", descAr: "عمق القائمة وتحليل المنافسين" },
  { id: "team_admin", ar: "مدير الكرة / الإداري", en: "Team Manager", descAr: "الإنذارات، الإصابات وكشف المباراة" },
];

const FORMATIONS = ["4-2-3-1", "4-3-3", "3-4-2-1", "3-5-2", "4-4-2", "5-3-2"];

export default function CoachOnboardingGate({
  lang,
  clubs,
  initialProfile,
  saving = false,
  onSubmit,
  onCancel,
}: Props) {
  const isAr = lang === "ar";
  const [coachName, setCoachName] = useState(initialProfile?.coach_name || "");
  const [coachRole, setCoachRole] = useState<CoachRoleType>(initialProfile?.coach_role || "head_coach");
  const [clubId, setClubId] = useState(initialProfile?.club_id || "al_ahly");
  const [opponentId, setOpponentId] = useState(initialProfile?.opponent_id || "zamalek");
  const [formation, setFormation] = useState(initialProfile?.formation || "4-2-3-1");
  const [searchQ, setSearchQ] = useState("");
  const [pickTarget, setPickTarget] = useState<"club" | "opponent">("club");
  const [errorMsg, setErrorMsg] = useState("");

  const filteredClubs = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return clubs;
    return clubs.filter(
      (c) =>
        c.name_ar.toLowerCase().includes(q) ||
        c.name_en.toLowerCase().includes(q) ||
        (c.city_ar || "").toLowerCase().includes(q)
    );
  }, [clubs, searchQ]);

  const selectedClub = clubs.find((c) => c.club_id === clubId);
  const selectedOpp = clubs.find((c) => c.club_id === opponentId);

  const handleSelectClub = (cid: string) => {
    if (pickTarget === "club") {
      setClubId(cid);
      if (cid === opponentId) {
        const alt = clubs.find((c) => c.club_id !== cid);
        if (alt) setOpponentId(alt.club_id);
      }
      setPickTarget("opponent");
    } else {
      if (cid === clubId) return;
      setOpponentId(cid);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = coachName.trim();
    if (!clean) {
      setErrorMsg(isAr ? "من فضلك اكتب اسمك أولاً قبل الدخول لغرفة القيادة" : "Please enter your coach name first");
      return;
    }
    setErrorMsg("");
    onSubmit({
      coach_name: clean,
      coach_role: coachRole,
      club_id: clubId,
      opponent_id: opponentId === clubId ? (clubs.find((c) => c.club_id !== clubId)?.club_id || "zamalek") : opponentId,
      formation,
    });
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="coach-light min-h-screen bg-gradient-to-br from-emerald-50 via-[#F4F7FA] to-sky-50 text-slate-900 flex items-center justify-center p-4 lg:p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-5xl rounded-3xl bg-white border border-slate-200 shadow-xl shadow-slate-900/5 overflow-hidden"
      >
        {/* Top Hero Banner */}
        <div className="px-6 py-5 bg-gradient-to-l from-[#E6F8F7] via-white to-[#F2F6F8] border-b border-[#D8E3EB] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <BedigitalBrandMark showWordmark={false} />
            <div>
              <h1 className="text-lg font-extrabold text-[#0B1F3A]">
                {isAr ? "EGY-SCOUT Coach Pro — بوابة المدير الفني والمدرب" : "EGY-SCOUT Coach Pro — Technical Staff Sign-In"}
              </h1>
              <p className="text-xs text-[#5C6A7C]">
                {isAr
                  ? `قاعدة الدوري المصري الممتاز الحية 2026/2027 (${clubs.length} نادٍ بقوائم وأسماء وأعمار محدثة تلقائياً)`
                  : `Live Egyptian Premier League 2026/27 database (${clubs.length} auto-updated clubs)`}
              </p>
            </div>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
            >
              {isAr ? "إلغاء والعودة" : "Cancel"}
            </button>
          )}
        </div>

        <div className="p-6 space-y-6">
          {/* Step 1: Coach Name & Role */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5 space-y-2">
              <label htmlFor="coach-name-input" className="block text-xs font-extrabold text-emerald-700">
                {isAr ? "1. اسم المدرب / المدير الفني" : "1. Coach / Director Name"}
              </label>
              <input
                id="coach-name-input"
                type="text"
                value={coachName}
                onChange={(e) => setCoachName(e.target.value)}
                placeholder={isAr ? "مثال: كابتن عبدالله ياسين" : "e.g. Coach Abdullah Yassen"}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 placeholder:text-slate-400 outline-none"
              />
              {errorMsg && <div className="text-xs font-bold text-rose-600">{errorMsg}</div>}
            </div>

            <div className="lg:col-span-7 space-y-2">
              <span className="block text-xs font-extrabold text-emerald-700">
                {isAr ? "2. المنصب الوظيفي في الجهاز الفني" : "2. Coaching / Management Role"}
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ROLE_OPTIONS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setCoachRole(r.id)}
                    className={`p-2.5 rounded-xl border text-start transition ${
                      coachRole === r.id
                        ? "bg-emerald-50 border-emerald-500 text-emerald-900 ring-1 ring-emerald-500/30"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <div className="text-[11px] font-extrabold truncate">{isAr ? r.ar : r.en}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{r.descAr}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Selected Matchup Summary Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <button
              type="button"
              onClick={() => setPickTarget("club")}
              className={`flex items-center justify-between gap-2 p-3 rounded-xl border transition ${
                pickTarget === "club" ? "bg-emerald-50 border-emerald-500 shadow-2xs" : "bg-white border-slate-200"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-4 h-4 rounded-full border border-slate-400 shrink-0"
                  style={{ backgroundColor: selectedClub?.kit_hex || "#10B981" }}
                />
                <div className="text-start min-w-0">
                  <div className="text-[10px] text-emerald-700 font-bold">{isAr ? "فريقك المختار (اضغط للتعديل)" : "Your Club"}</div>
                  <div className="text-sm font-extrabold text-slate-900 truncate">
                    {isAr ? selectedClub?.name_ar || clubId : selectedClub?.name_en || clubId}
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                {selectedClub?.player_count || 0} {isAr ? "لاعب" : "ply"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setPickTarget("opponent")}
              className={`flex items-center justify-between gap-2 p-3 rounded-xl border transition ${
                pickTarget === "opponent" ? "bg-sky-50 border-sky-500 shadow-2xs" : "bg-white border-slate-200"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-4 h-4 rounded-full border border-slate-400 shrink-0"
                  style={{ backgroundColor: selectedOpp?.kit_hex || "#38BDF8" }}
                />
                <div className="text-start min-w-0">
                  <div className="text-[10px] text-sky-700 font-bold">{isAr ? "فريق الخصم (اضغط للتعديل)" : "Opponent Club"}</div>
                  <div className="text-sm font-extrabold text-slate-900 truncate">
                    {isAr ? selectedOpp?.name_ar || opponentId : selectedOpp?.name_en || opponentId}
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                {selectedOpp?.player_count || 0} {isAr ? "لاعب" : "ply"}
              </span>
            </button>

            <div className="flex flex-col justify-center p-2.5 rounded-xl bg-white border border-slate-200">
              <span className="text-[10px] text-slate-500 font-bold mb-1">{isAr ? "التشكيل المبدئي للعمل" : "Base Formation"}</span>
              <div className="flex flex-wrap gap-1.5">
                {FORMATIONS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormation(f)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-extrabold transition ${
                      formation === f ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Searchable All Egyptian Premier League Clubs Grid */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-extrabold text-slate-900">
                  {pickTarget === "club"
                    ? isAr
                      ? "3. اختر فريقك من جميع أندية الدوري المصري الممتاز:"
                      : "3. Pick YOUR Club:"
                    : isAr
                      ? "4. اختر فريق الخصم من جميع أندية الدوري المصري الممتاز:"
                      : "4. Pick OPPONENT Club:"}
                </span>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
                <input
                  type="text"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder={isAr ? "ابحث باسم النادي أو المدينة..." : "Search club or city..."}
                  className="w-full rounded-xl bg-slate-50 border border-slate-200 ps-8 pe-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[260px] overflow-y-auto pe-1">
              {filteredClubs.map((c) => {
                const isMine = c.club_id === clubId;
                const isOpp = c.club_id === opponentId;
                const disabledOpp = pickTarget === "opponent" && isMine;
                return (
                  <button
                    key={c.club_id}
                    type="button"
                    disabled={disabledOpp}
                    onClick={() => handleSelectClub(c.club_id)}
                    className={`p-2.5 rounded-xl border text-start transition relative ${
                      isMine
                        ? "bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500/25"
                        : isOpp
                          ? "bg-sky-50 border-sky-500 ring-1 ring-sky-500/25"
                          : "bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-white"
                    } ${disabledOpp ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full border border-slate-400 shrink-0"
                          style={{ backgroundColor: c.kit_hex || "#10B981" }}
                        />
                        <span className="text-xs font-extrabold text-slate-900 truncate">
                          {isAr ? c.name_ar : c.name_en}
                        </span>
                      </div>
                      {c.live_rank ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                          #{c.live_rank}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1.5">
                      <span className="truncate">{c.city_ar || c.league_id}</span>
                      <span className="font-bold text-emerald-700 shrink-0">
                        {c.player_count} {isAr ? "لاعب" : "players"}
                      </span>
                    </div>
                    {(isMine || isOpp) && (
                      <div
                        className={`mt-1 text-[10px] font-extrabold inline-flex items-center gap-1 ${
                          isMine ? "text-emerald-700" : "text-sky-700"
                        }`}
                      >
                        {isMine ? <CheckCircle2 className="w-3 h-3" /> : <Swords className="w-3 h-3" />}
                        <span>{isMine ? (isAr ? "فريقك" : "Your Team") : isAr ? "الخصم" : "Opponent"}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-md shadow-emerald-600/20 transition disabled:opacity-60"
          >
            <UserCheck className="w-4 h-4" />
            <span>
              {saving
                ? isAr ? "جاري تجهيز غرفة القيادة..." : "Initializing Workspace..."
                : isAr
                  ? `دخول غرفة القيادة الفنية (${selectedClub?.name_ar || clubId} × ${selectedOpp?.name_ar || opponentId})`
                  : "Enter Coach Pro Workspace"}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
