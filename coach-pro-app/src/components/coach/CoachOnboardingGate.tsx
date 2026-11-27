"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Globe, Search, Shield, UserCheck } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { loadCachedLeagueClubs, saveCachedLeagueClubs } from "@/lib/coachStorage";
import BedigitalBrandMark from "./BedigitalBrandMark";
import { COACH_LEAGUES, CoachClubListItem, CoachProfile, CoachRoleType } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  clubs?: CoachClubListItem[];
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
  clubs: propClubs = [],
  initialProfile,
  saving = false,
  onSubmit,
  onCancel,
}: Props) {
  const isAr = lang === "ar";
  const [step, setStep] = useState<1 | 2 | 3>(initialProfile ? 2 : 1);
  const [coachName, setCoachName] = useState(initialProfile?.coach_name || "");
  const [coachRole, setCoachRole] = useState<CoachRoleType>(initialProfile?.coach_role || "head_coach");
  const [selectedLeague, setSelectedLeague] = useState<string>(initialProfile?.league_id || "");
  const [leagueClubs, setLeagueClubs] = useState<CoachClubListItem[]>(propClubs);
  const [loadingLeague, setLoadingLeague] = useState(false);

  const [clubId, setClubId] = useState<string>(initialProfile?.club_id || "");
  const [wantOpponentNow, setWantOpponentNow] = useState<boolean>(
    Boolean(initialProfile?.opponent_id && initialProfile.opponent_id !== "none")
  );
  const [oppLeague, setOppLeague] = useState<string>(initialProfile?.opponent_league_id || initialProfile?.league_id || "egy.1");
  const [oppClubs, setOppClubs] = useState<CoachClubListItem[]>([]);
  const [loadingOppLeague, setLoadingOppLeague] = useState(false);
  const [opponentId, setOpponentId] = useState<string>(initialProfile?.opponent_id || "none");

  const [formation, setFormation] = useState(initialProfile?.formation || "4-2-3-1");
  const [searchQ, setSearchQ] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const loadClubsForLeague = async (lid: string, setter: (c: CoachClubListItem[]) => void, setBusy: (b: boolean) => void) => {
    const cached = loadCachedLeagueClubs(lid);
    if (cached && cached.length > 0) {
      setter(cached);
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ clubs: CoachClubListItem[] }>(`/api/coach/clubs?league=${encodeURIComponent(lid)}`);
      const list = res.clubs || [];
      setter(list);
      saveCachedLeagueClubs(lid, list);
    } catch {
      // Keep cached fallback if offline
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!selectedLeague) return;
    loadClubsForLeague(selectedLeague, setLeagueClubs, setLoadingLeague);
  }, [selectedLeague]);

  useEffect(() => {
    if (!wantOpponentNow || !oppLeague) return;
    if (oppLeague === selectedLeague && leagueClubs.length > 0) {
      setOppClubs(leagueClubs);
      return;
    }
    loadClubsForLeague(oppLeague, setOppClubs, setLoadingOppLeague);
  }, [wantOpponentNow, oppLeague, selectedLeague, leagueClubs]);

  const filteredClubs = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return leagueClubs;
    return leagueClubs.filter(
      (c) =>
        c.name_ar.toLowerCase().includes(q) ||
        c.name_en.toLowerCase().includes(q) ||
        (c.city_ar || "").toLowerCase().includes(q)
    );
  }, [leagueClubs, searchQ]);

  const selectedClubObj = leagueClubs.find((c) => c.club_id === clubId) || propClubs.find((c) => c.club_id === clubId);
  const activeLeagueMeta = COACH_LEAGUES.find((l) => l.id === selectedLeague);

  const handleGoStep2 = () => {
    if (!coachName.trim()) {
      setErrorMsg(isAr ? "من فضلك اكتب اسمك أولاً" : "Please enter your name first");
      return;
    }
    if (!selectedLeague) {
      setErrorMsg(isAr ? "من فضلك اختر الدوري أولاً قبل اختيار النادي" : "Please select a league first");
      return;
    }
    setErrorMsg("");
    setSearchQ("");
    setStep(2);
  };

  const handleSelectLeagueCard = (lid: string) => {
    setSelectedLeague(lid);
    if (!oppLeague || lid !== initialProfile?.league_id) {
      setOppLeague(lid);
    }
    if (lid !== initialProfile?.league_id) {
      setClubId("");
      setWantOpponentNow(false);
      setOpponentId("none");
    }
    setErrorMsg("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = coachName.trim();
    if (!clean || !selectedLeague || !clubId) {
      setErrorMsg(isAr ? "أكمل اختيار الاسم والدوري والنادي للمتابعة" : "Complete name, league and club first");
      return;
    }
    setErrorMsg("");
    onSubmit({
      coach_name: clean,
      coach_role: coachRole,
      league_id: selectedLeague,
      club_id: clubId,
      opponent_id: wantOpponentNow && opponentId && opponentId !== clubId ? opponentId : "none",
      opponent_league_id: wantOpponentNow ? oppLeague : selectedLeague,
      formation,
    });
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="coach-light min-h-[100dvh] bg-[#F5F6F8] text-slate-900 flex items-center justify-center p-3 sm:p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-5xl rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden"
      >
        {/* Top Clean Editorial Header + Stepper */}
        <div className="px-4 sm:px-6 py-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BedigitalBrandMark showWordmark={false} />
            <div>
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900">
                {isAr ? "EGY-SCOUT Coach Pro — إعداد حساب المدرب" : "EGY-SCOUT Coach Pro — Progressive Setup"}
              </h1>
              <p className="text-[11px] text-slate-500">
                {isAr
                  ? "1. الاسم والدوري  ←  2. ناديك  ←  3. التشكيل والخصم"
                  : "1. League  →  2. Your Club  →  3. Setup"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  if (n === 1 || (n === 2 && selectedLeague) || (n === 3 && clubId)) setStep(n);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition whitespace-nowrap ${
                  step === n
                    ? "bg-slate-900 text-white border-slate-900"
                    : n < step
                      ? "bg-emerald-50 text-[#15803D] border-emerald-200"
                      : "bg-slate-50 text-slate-400 border-slate-200"
                }`}
              >
                {n}. {n === 1 ? (isAr ? "الدوري" : "League") : n === 2 ? (isAr ? "النادي" : "Club") : isAr ? "التشكيل" : "Setup"}
              </button>
            ))}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
              >
                {isAr ? "إلغاء" : "Cancel"}
              </button>
            )}
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-extrabold text-rose-700">
              {errorMsg}
            </div>
          )}

          {/* STEP 1: Name, Role & League Selection */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-5 space-y-2">
                  <label htmlFor="coach-name-input" className="block text-xs font-extrabold text-[#0D717A]">
                    {isAr ? "1. اسم المدرب / المدير الفني" : "1. Coach Name"}
                  </label>
                  <input
                    id="coach-name-input"
                    type="text"
                    value={coachName}
                    onChange={(e) => setCoachName(e.target.value)}
                    placeholder={isAr ? "اكتب اسمك هنا (مثال: كابتن محمد أحمد)" : "Enter your name"}
                    className="w-full rounded-xl bg-slate-50 border border-slate-200 focus:border-[#0FB5AE] focus:bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 outline-none"
                  />
                </div>

                <div className="lg:col-span-7 space-y-2">
                  <span className="block text-xs font-extrabold text-[#0D717A]">
                    {isAr ? "2. المنصب الوظيفي في الجهاز الفني" : "2. Role"}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {ROLE_OPTIONS.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setCoachRole(r.id)}
                        className={`p-2.5 rounded-xl border text-start transition ${
                          coachRole === r.id
                            ? "bg-[#E6F8F7] border-[#0FB5AE] text-[#0B1F3A] ring-1 ring-[#0FB5AE]/30"
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

              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-extrabold text-[#0D717A]">
                  <Globe className="w-4 h-4" />
                  <span>{isAr ? "3. اختر الدوري الذي تريد العمل عليه (لتحميل أنديته فقط وبسرعة):" : "3. Choose League:"}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {COACH_LEAGUES.map((lg) => {
                    const active = selectedLeague === lg.id;
                    return (
                      <button
                        key={lg.id}
                        type="button"
                        onClick={() => handleSelectLeagueCard(lg.id)}
                        className={`p-3 rounded-2xl border flex items-center gap-3 text-start transition ${
                          active
                            ? "bg-[#E6F8F7] border-[#0D717A] ring-2 ring-[#0FB5AE]/30 shadow-xs"
                            : "bg-white border-slate-200 hover:border-[#0FB5AE]/60 hover:bg-slate-50"
                        }`}
                      >
                        <img
                          src={lg.logo}
                          alt={lg.en}
                          className="w-9 h-9 rounded-xl object-contain bg-white border border-slate-100 p-0.5 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-slate-900 truncate">{isAr ? lg.ar : lg.en}</div>
                          <div className="text-[10px] font-bold text-[#0D717A]">{active ? (isAr ? "✓ محدد" : "Selected") : lg.en}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleGoStep2}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-[#0D717A] hover:bg-[#0B5E66] text-white font-extrabold text-sm shadow-md transition"
                >
                  <span>{isAr ? "التالي: اختيار النادي" : "Next: Select Club"}</span>
                  {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Progressive League Clubs Grid (Zero Pre-Selected Hardcoded Club) */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {activeLeagueMeta && (
                    <img src={activeLeagueMeta.logo} alt="" className="w-7 h-7 object-contain rounded-lg bg-white border border-slate-200 p-0.5" />
                  )}
                  <div>
                    <div className="text-sm font-extrabold text-[#0B1F3A]">
                      {isAr ? `اختر ناديك من ${activeLeagueMeta?.ar || selectedLeague}` : `Select Club from ${activeLeagueMeta?.en || selectedLeague}`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {isAr ? "يتم تحميل قائمة اللاعبين بالصور فور اختيار النادي فقط لتسريع التصفح" : "Roster & portraits load on-demand once you pick your club"}
                    </div>
                  </div>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
                  <input
                    type="text"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    placeholder={isAr ? "ابحث باسم النادي..." : "Search club..."}
                    className="w-full rounded-xl bg-slate-50 border border-slate-200 ps-8 pe-3 py-1.5 text-xs text-slate-900 outline-none focus:border-[#0FB5AE] focus:bg-white"
                  />
                </div>
              </div>

              {loadingLeague && leagueClubs.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse border border-slate-200" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[320px] overflow-y-auto pe-1">
                  {filteredClubs.map((c) => {
                    const isMine = c.club_id === clubId;
                    return (
                      <button
                        key={c.club_id}
                        type="button"
                        onClick={() => {
                          setClubId(c.club_id);
                          setErrorMsg("");
                        }}
                        className={`p-3 rounded-2xl border text-start transition flex items-center gap-2.5 ${
                          isMine
                            ? "bg-[#E6F8F7] border-[#0D717A] ring-2 ring-[#0FB5AE]/30 shadow-xs"
                            : "bg-white border-slate-200 hover:border-[#0FB5AE]/60 hover:bg-slate-50"
                        }`}
                      >
                        {c.logo_url ? (
                          <img src={c.logo_url} alt={c.name_en} className="w-9 h-9 rounded-xl object-contain bg-white border border-slate-100 p-0.5 shrink-0" />
                        ) : (
                          <span className="w-9 h-9 rounded-xl border border-slate-200 shrink-0" style={{ backgroundColor: c.kit_hex || "#0FB5AE" }} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-extrabold text-slate-900 truncate">{isAr ? c.name_ar : c.name_en}</div>
                          <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            {c.live_rank && <span className="font-bold text-amber-700">#{c.live_rank}</span>}
                            {c.live_points !== null && c.live_points !== undefined && <span>{c.live_points} ن</span>}
                          </div>
                        </div>
                        {isMine && <CheckCircle2 className="w-4 h-4 text-[#0D717A] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
                >
                  {isAr ? "السابق: تغيير الدوري" : "Back: League"}
                </button>
                <button
                  type="button"
                  disabled={!clubId}
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-[#0D717A] hover:bg-[#0B5E66] text-white font-extrabold text-sm shadow-md disabled:opacity-40 transition"
                >
                  <span>{isAr ? "التالي: التشكيل والخصم" : "Next: Formation & Opponent"}</span>
                  {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Formation + Optional Opponent */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#F2F6F8] border border-[#D8E3EB] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {selectedClubObj?.logo_url ? (
                    <img src={selectedClubObj.logo_url} alt="" className="w-11 h-11 rounded-2xl object-contain bg-white border border-slate-200 p-1" />
                  ) : (
                    <Shield className="w-8 h-8 text-[#0D717A]" />
                  )}
                  <div>
                    <div className="text-[11px] font-bold text-[#0D717A]">{isAr ? "ناديك المختار:" : "Selected Club:"}</div>
                    <div className="text-base font-extrabold text-[#0B1F3A]">
                      {isAr ? selectedClubObj?.name_ar || clubId : selectedClubObj?.name_en || clubId}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:border-[#0FB5AE]"
                >
                  {isAr ? "تغيير النادي" : "Change Club"}
                </button>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-extrabold text-[#0D717A]">
                  {isAr ? "التشكيل المبدئي للعمل:" : "Base Formation:"}
                </span>
                <div className="flex flex-wrap gap-2">
                  {FORMATIONS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormation(f)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition border ${
                        formation === f
                          ? "bg-[#0D717A] text-white border-[#0D717A] shadow-xs"
                          : "bg-slate-50 text-slate-700 border-slate-200 hover:border-[#0FB5AE]"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Opponent Selection — STRICTLY OPTIONAL */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      {isAr ? "تحديد فريق الخصم (اختياري تماماً)" : "Select Opponent (Optional)"}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {isAr ? "يمكنك الدخول مباشرة بناديك فقط وتحديد أو تغيير الخصم لاحقاً من أي شاشة" : "You can enter directly and pick or switch opponent anytime later"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setWantOpponentNow(false);
                        setOpponentId("none");
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border ${
                        !wantOpponentNow ? "bg-[#0B1F3A] text-white border-[#0B1F3A]" : "bg-white text-slate-700 border-slate-200"
                      }`}
                    >
                      {isAr ? "تحديد الخصم لاحقاً ✓" : "Decide Later ✓"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWantOpponentNow(true)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border ${
                        wantOpponentNow ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-700 border-slate-200"
                      }`}
                    >
                      {isAr ? "اختيار الخصم الآن" : "Pick Opponent Now"}
                    </button>
                  </div>
                </div>

                {wantOpponentNow && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-200">
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {COACH_LEAGUES.map((lg) => (
                        <button
                          key={lg.id}
                          type="button"
                          onClick={() => setOppLeague(lg.id)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold whitespace-nowrap border ${
                            oppLeague === lg.id ? "bg-sky-600 text-white border-sky-600" : "bg-white text-slate-700 border-slate-200"
                          }`}
                        >
                          <img src={lg.logo} alt="" className="w-4 h-4 object-contain" />
                          <span>{isAr ? lg.ar : lg.en}</span>
                        </button>
                      ))}
                    </div>
                    {loadingOppLeague ? (
                      <div className="text-xs text-slate-500">{isAr ? "جاري تحميل أندية الدوري..." : "Loading clubs..."}</div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-44 overflow-y-auto">
                        {oppClubs
                          .filter((c) => c.club_id !== clubId)
                          .map((c) => (
                            <button
                              key={c.club_id}
                              type="button"
                              onClick={() => setOpponentId(c.club_id)}
                              className={`p-2 rounded-xl border text-start flex items-center gap-2 ${
                                opponentId === c.club_id ? "bg-sky-50 border-sky-500 ring-1 ring-sky-400" : "bg-white border-slate-200"
                              }`}
                            >
                              {c.logo_url && <img src={c.logo_url} alt="" className="w-6 h-6 object-contain shrink-0" />}
                              <span className="text-[11px] font-extrabold truncate">{isAr ? c.name_ar : c.name_en}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-extrabold text-slate-700"
                >
                  {isAr ? "السابق: النادي" : "Back"}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[44px] rounded-xl bg-[#15803D] hover:bg-[#166534] text-white font-extrabold text-sm shadow-xs disabled:opacity-50 transition w-full sm:w-auto"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>
                    {saving
                      ? isAr ? "جاري تحميل لاعبي النادي..." : "Loading squad..."
                      : isAr ? "دخول إلى لوحة الفريق" : "Enter Workspace"}
                  </span>
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 pt-1">
            <span>{isAr ? "بيانات موسم 2026/27 محدثة مع حفظ تلقائي على جهازك" : "Live 2026/27 data with automatic session persistence"}</span>
          </div>
        </div>
      </form>
    </div>
  );
}
