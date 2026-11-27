"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Shield, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { loadCachedLeagueClubs, saveCachedLeagueClubs } from "@/lib/coachStorage";
import { COACH_LEAGUES, CoachClubListItem } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  isOpen: boolean;
  myClubId: string;
  currentOpponentId: string;
  initialLeague?: string;
  onClose: () => void;
  onSelectOpponent: (opponentId: string, opponentLeagueId: string) => void;
}

export default function OpponentPickerModal({
  lang,
  isOpen,
  myClubId,
  currentOpponentId,
  initialLeague = "egy.1",
  onClose,
  onSelectOpponent,
}: Props) {
  const isAr = lang === "ar";
  const [leagueId, setLeagueId] = useState(initialLeague || "egy.1");
  const [clubs, setClubs] = useState<CoachClubListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const cached = loadCachedLeagueClubs(leagueId);
    if (cached) setClubs(cached);
    setLoading(true);
    apiFetch<{ clubs: CoachClubListItem[] }>(`/api/coach/clubs?league=${encodeURIComponent(leagueId)}`)
      .then((res) => {
        const list = res.clubs || [];
        setClubs(list);
        saveCachedLeagueClubs(leagueId, list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, leagueId]);

  const filtered = useMemo(() => {
    const clean = q.trim().toLowerCase();
    return clubs.filter((c) => {
      if (c.club_id === myClubId) return false;
      if (!clean) return true;
      return c.name_ar.toLowerCase().includes(clean) || c.name_en.toLowerCase().includes(clean);
    });
  }, [clubs, myClubId, q]);

  if (!isOpen) return null;

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="fixed inset-0 z-[100] bg-[#0B1F3A]/45 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl max-h-[88dvh] bg-white rounded-3xl border border-[#D8E3EB] shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 bg-[#F2F6F8] border-b border-[#D8E3EB] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-sky-600" />
            <div>
              <h3 className="text-sm font-extrabold text-[#0B1F3A]">
                {isAr ? "اختيار أو تغيير فريق الخصم من أي دوري" : "Select Opponent from Any League"}
              </h3>
              <p className="text-[11px] text-[#5C6A7C]">
                {isAr ? "يتم تحميل قائمة الخصم بالصور فور اختياره" : "Opponent roster & portraits load immediately upon selection"}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-xl hover:bg-slate-200 text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {COACH_LEAGUES.map((lg) => (
              <button
                key={lg.id}
                type="button"
                onClick={() => setLeagueId(lg.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold whitespace-nowrap border transition ${
                  leagueId === lg.id ? "bg-[#0D717A] text-white border-[#0D717A]" : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-white"
                }`}
              >
                <img src={lg.logo} alt="" className="w-4 h-4 object-contain" />
                <span>{isAr ? lg.ar : lg.en}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={isAr ? "ابحث باسم فريق الخصم..." : "Search opponent club..."}
                className="w-full rounded-xl bg-slate-50 border border-slate-200 ps-8 pe-3 py-1.5 text-xs outline-none focus:border-[#0FB5AE] focus:bg-white"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onSelectOpponent("none", leagueId);
                onClose();
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
            >
              {isAr ? "إلغاء تحديد الخصم" : "Clear Opponent"}
            </button>
          </div>

          {loading && clubs.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {filtered.map((c) => {
                const active = c.club_id === currentOpponentId;
                return (
                  <button
                    key={c.club_id}
                    type="button"
                    onClick={() => {
                      onSelectOpponent(c.club_id, leagueId);
                      onClose();
                    }}
                    className={`p-2.5 rounded-2xl border text-start flex items-center gap-2.5 transition ${
                      active ? "bg-sky-50 border-sky-500 ring-1 ring-sky-400" : "bg-white border-slate-200 hover:border-[#0FB5AE]"
                    }`}
                  >
                    {c.logo_url ? (
                      <img src={c.logo_url} alt="" className="w-8 h-8 object-contain rounded-lg bg-white border border-slate-100 p-0.5 shrink-0" />
                    ) : (
                      <span className="w-8 h-8 rounded-lg shrink-0 border border-slate-200" style={{ backgroundColor: c.kit_hex || "#38BDF8" }} />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-slate-900 truncate">{isAr ? c.name_ar : c.name_en}</div>
                      {c.live_rank && (
                        <div className="text-[10px] text-slate-500">#{c.live_rank} • {c.live_points ?? 0} ن</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
