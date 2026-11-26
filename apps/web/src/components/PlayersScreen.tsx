"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeftRight,
  Download,
  Film,
  FolderUp,
  ImagePlus,
  Pin,
  RotateCcw,
  Search,
  ShieldCheck,
  Shirt,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import PlayerCard from "@/components/PlayerCard";
import {
  API_BASE,
  apiFetch,
  PlayerCardPayload,
  PlayerCardSummary,
  UserRole,
  VerifiedRostersResponse,
} from "@/lib/api";
import { exportMiniPlayerCardPng, exportPlayerCardPng } from "@/lib/playerCardPng";

const FairScoutingScreen = dynamic(() => import("@/components/FairScoutingScreen"), {
  ssr: false,
  loading: () => (
    <div className="studio-panel p-8 text-center text-xs text-slate-400 animate-pulse">
      Loading Advanced Scouting...
    </div>
  ),
});

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
  onJumpToClip?: (timeSec: number) => void;
  onNavigateQA?: () => void;
  onPinCardToStudio?: (card: PlayerCardSummary) => void;
}

interface IdentityCandidate {
  jersey_number: number;
  name_ar: string;
  name_en: string;
  position: string;
  compat: number;
  already_assigned: boolean;
}

interface PlayersListResponse {
  match_id: string;
  team_a_name: string;
  team_b_name: string;
  team_a_name_ar: string;
  team_b_name_ar: string;
  players: PlayerCardSummary[];
  count: number;
  short_tracks_count?: number;
}

export default function PlayersScreen({
  lang,
  matchId,
  role,
  onJumpToClip,
  onNavigateQA,
  onPinCardToStudio,
}: Props) {
  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  const [viewMode, setViewMode] = useState<"cards" | "advanced">("cards");
  const [data, setData] = useState<PlayersListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [teamFilter, setTeamFilter] = useState<"all" | "team_a" | "team_b">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [photoVersion, setPhotoVersion] = useState<number>(() => Date.now());
  const [portraitMode, setPortraitMode] = useState<"auto" | "photo" | "jersey">("auto");

  const [selectedCard, setSelectedCard] = useState<PlayerCardPayload | null>(null);
  const [compareTid, setCompareTid] = useState<number | null>(null);
  const [compareCard, setCompareCard] = useState<PlayerCardPayload | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const [rostersOpen, setRostersOpen] = useState(false);
  const [rostersData, setRostersData] = useState<VerifiedRostersResponse | null>(null);
  const [clubAId, setClubAId] = useState("al_ahly");
  const [clubBId, setClubBId] = useState("enppi");

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<PlayersListResponse>(
        `/api/matches/${encodeURIComponent(matchId)}/players`,
        {},
        "club_demo_egypt",
        role
      );
      setData(res);
    } catch (err) {
      setErrorMsg(String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [matchId, role]);

  useEffect(() => {
    loadPlayers();
    setSelectedCard(null);
    setCompareCard(null);
    setCompareOpen(false);
  }, [loadPlayers]);

  const openCardModal = useCallback(
    async (summary: PlayerCardSummary) => {
      setPortraitMode("auto");
      setAssignOpen(false);
      setCandidates([]);
      setSelectedCard({ ...summary, heatmap: null });
      setCompareOpen(false);
      setCompareTid(null);
      setCompareCard(null);
      try {
        const full = await apiFetch<PlayerCardPayload>(
          `/api/matches/${encodeURIComponent(matchId)}/players/${summary.track_id}/card`,
          {},
          "club_demo_egypt",
          role
        );
        setSelectedCard(full);
      } catch {
        // Keep summary visible even if detail fetch fails
      }
    },
    [matchId, role]
  );

  useEffect(() => {
    if (!selectedCard) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCard(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCard]);

  useEffect(() => {
    if (!compareOpen || compareTid === null) {
      setCompareCard(null);
      return;
    }
    let active = true;
    apiFetch<PlayerCardPayload>(
      `/api/matches/${encodeURIComponent(matchId)}/players/${compareTid}/card`,
      {},
      "club_demo_egypt",
      role
    )
      .then((res) => {
        if (active) setCompareCard(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [compareOpen, compareTid, matchId, role]);

  const filteredPlayers = useMemo(() => {
    const list = data?.players || [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((p) => {
      if (teamFilter !== "all" && p.team !== teamFilter) return false;
      if (!q) return true;
      return (
        p.display_label.toLowerCase().includes(q) ||
        (p.display_label_en || "").toLowerCase().includes(q) ||
        (p.verified_name || "").toLowerCase().includes(q) ||
        String(p.jersey_number ?? "").includes(q) ||
        p.position_label.code.toLowerCase().includes(q)
      );
    });
  }, [data, teamFilter, searchQuery]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedCard) return;
    if (file.size > 5 * 1024 * 1024) {
      setToastMsg(isAr ? "الحد الأقصى لحجم الصورة 5 ميجابايت." : "Photo must be under 5 MB.");
      return;
    }
    setBusyAction("upload");
    setToastMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `${API_BASE}/api/matches/${encodeURIComponent(matchId)}/players/${selectedCard.track_id}/photo`,
        {
          method: "POST",
          headers: {
            "X-Tenant-Id": "club_demo_egypt",
            "X-User-Role": role,
          },
          body: form,
        }
      );
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { card: PlayerCardPayload };
      const nowV = Date.now();
      setPhotoVersion(nowV);
      setSelectedCard(payload.card);
      setData((prev) =>
        prev
          ? {
              ...prev,
              players: prev.players.map((p) =>
                p.track_id === payload.card.track_id ? { ...p, ...payload.card } : p
              ),
            }
          : prev
      );
      setToastMsg(isAr ? "تم تحديث صورة الكارت بنجاح." : "Player card photo updated.");
    } catch (err) {
      setToastMsg(
        isAr ? `تعذّر رفع الصورة: ${String(err)}` : `Photo upload failed: ${String(err)}`
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeletePhoto = async () => {
    if (!selectedCard) return;
    setBusyAction("delete");
    setToastMsg(null);
    try {
      const res = await apiFetch<{ card: PlayerCardPayload }>(
        `/api/matches/${encodeURIComponent(matchId)}/players/${selectedCard.track_id}/photo`,
        { method: "DELETE" },
        "club_demo_egypt",
        role
      );
      const nowV = Date.now();
      setPhotoVersion(nowV);
      setSelectedCard(res.card);
      setData((prev) =>
        prev
          ? {
              ...prev,
              players: prev.players.map((p) =>
                p.track_id === res.card.track_id ? { ...p, ...res.card } : p
              ),
            }
          : prev
      );
      setToastMsg(isAr ? "تم استرجاع أفضل لقطة من الفيديو." : "Restored best video frame shot.");
    } catch (err) {
      setToastMsg(String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleFetchOfficialPhoto = async () => {
    if (!selectedCard) return;
    setBusyAction("fetch_photo");
    setToastMsg(null);
    try {
      const res = await apiFetch<{ card: PlayerCardPayload }>(
        `/api/matches/${encodeURIComponent(matchId)}/players/${selectedCard.track_id}/fetch-photo`,
        { method: "POST" },
        "club_demo_egypt",
        role
      );
      setPhotoVersion(Date.now());
      setSelectedCard(res.card);
      setData((prev) =>
        prev
          ? {
              ...prev,
              players: prev.players.map((p) => (p.track_id === res.card.track_id ? { ...p, ...res.card } : p)),
            }
          : prev
      );
      setToastMsg(isAr ? "تم جلب الصورة الرسمية عالية الدقة بنجاح." : "Fetched official player portrait.");
    } catch (err) {
      setToastMsg(String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadMiniPng = async () => {
    if (!selectedCard) return;
    setBusyAction("mini_png");
    setToastMsg(null);
    try {
      await exportMiniPlayerCardPng(selectedCard, lang, photoVersion);
      setToastMsg(isAr ? "تم تحميل الكارت المصغّر PNG بخلفية شفافة." : "Mini card PNG downloaded.");
    } catch (err) {
      setToastMsg(isAr ? `تعذّر تصدير المصغّر: ${String(err)}` : `Mini PNG failed: ${String(err)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleBatchFetchOfficialPhotos = async () => {
    setBusyAction("batch_fetch");
    setToastMsg(null);
    try {
      const res = await apiFetch<{ fetched_count: number; card_count?: number }>(
        `/api/matches/${encodeURIComponent(matchId)}/players/fetch-verified-photos`,
        { method: "POST" },
        "club_demo_egypt",
        role
      );
      setPhotoVersion(Date.now());
      await loadPlayers();
      setToastMsg(
        isAr
          ? `تم جلب صور اللاعبين الحقيقية (${res.fetched_count} لاعب).`
          : `Fetched official player portraits (${res.fetched_count} players).`
      );
    } catch (err) {
      setToastMsg(String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenAssign = async () => {
    if (!selectedCard) return;
    if (assignOpen) {
      setAssignOpen(false);
      return;
    }
    setAssignOpen(true);
    setLoadingCandidates(true);
    try {
      const res = await apiFetch<{ candidates: IdentityCandidate[] }>(
        `/api/matches/${encodeURIComponent(matchId)}/players/${selectedCard.track_id}/identity-candidates`,
        {},
        "club_demo_egypt",
        role
      );
      setCandidates(res.candidates || []);
    } catch (err) {
      setToastMsg(String(err));
    } finally {
      setLoadingCandidates(false);
    }
  };

  const handleAssignIdentity = async (jerseyNumber: number | null) => {
    if (!selectedCard) return;
    setBusyAction("assign");
    setToastMsg(null);
    try {
      const res = await apiFetch<{ card: PlayerCardPayload }>(
        `/api/matches/${encodeURIComponent(matchId)}/players/${selectedCard.track_id}/identity`,
        {
          method: "POST",
          body: JSON.stringify({ team: selectedCard.team, jersey_number: jerseyNumber }),
        },
        "club_demo_egypt",
        role
      );
      setPhotoVersion(Date.now());
      setSelectedCard(res.card);
      setAssignOpen(false);
      await loadPlayers();
      setToastMsg(
        jerseyNumber === null
          ? isAr
            ? "تم إلغاء تحديد اللاعب."
            : "Cleared player assignment."
          : isAr
          ? `تم تحديد هوية اللاعب (#${jerseyNumber} ${res.card.display_label}) بنجاح.`
          : `Assigned player (#${jerseyNumber} ${res.card.display_label_en || res.card.display_label}).`
      );
    } catch (err) {
      setToastMsg(String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenRosters = async () => {
    setRostersOpen(true);
    if (!rostersData) {
      try {
        const res = await apiFetch<VerifiedRostersResponse>("/api/rosters", {}, "club_demo_egypt", role);
        setRostersData(res);
      } catch (err) {
        setToastMsg(String(err));
      }
    }
  };

  const handleImportRoster = async () => {
    setBusyAction("roster");
    setToastMsg(null);
    try {
      const res = await apiFetch<PlayersListResponse>(
        `/api/matches/${encodeURIComponent(matchId)}/import-roster`,
        {
          method: "POST",
          body: JSON.stringify({ club_a_id: clubAId, club_b_id: clubBId }),
        },
        "club_demo_egypt",
        role
      );
      setData(res);
      setRostersOpen(false);
      setToastMsg(isAr ? "تم تحديث كروت المباراة من القوائم المعتمدة." : "Match cards updated from verified club squads.");
    } catch (err) {
      setToastMsg(String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleBatchPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusyAction("batch");
    setToastMsg(null);
    try {
      const form = new FormData();
      form.append("team", teamFilter === "team_b" ? "team_b" : "team_a");
      files.slice(0, 25).forEach((f) => form.append("files", f));
      const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/players/batch-photos`, {
        method: "POST",
        headers: { "X-Tenant-Id": "club_demo_egypt", "X-User-Role": role },
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const out = (await res.json()) as { uploaded_count: number; unmatched: string[] };
      setPhotoVersion(Date.now());
      await loadPlayers();
      setToastMsg(
        isAr
          ? `تم تحديث ${out.uploaded_count} صورة${out.unmatched.length ? ` (${out.unmatched.length} غير مطابق — سمّ الملف برقم القميص مثل 22.png)` : ""}`
          : `Updated ${out.uploaded_count} photos${out.unmatched.length ? ` (${out.unmatched.length} unmatched — name files by jersey # like 22.png)` : ""}`
      );
    } catch (err) {
      setToastMsg(String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadPng = async () => {
    if (!selectedCard) return;
    setBusyAction("png");
    setToastMsg(null);
    try {
      const out = await exportPlayerCardPng(selectedCard, lang, photoVersion);
      setToastMsg(
        out.photoIncluded
          ? isAr
            ? "تم تحميل كارت اللاعب PNG بنجاح."
            : "Player card PNG downloaded."
          : isAr
          ? "تم تحميل الكارت بدون الصورة لتعذّر قراءتها."
          : "PNG exported without photo due to image CORS."
      );
    } catch (err) {
      setToastMsg(isAr ? `تعذّر تصدير PNG: ${String(err)}` : `PNG export failed: ${String(err)}`);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Bar: Title + Cards vs Advanced Scouting Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <span>{isAr ? "كروت اللاعبين والكشافة" : "Player Cards & Scouting"}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {isAr
              ? "إحصائيات مقاسة من التتبع الحقيقي مع ترتيب اللاعب داخل المباراة (0–99) — لون الكارت يعبّر عن درجة ثقة البيانات."
              : "Measured tracking metrics with in-match percentiles (0–99). Card color indicates data confidence."}
          </p>
        </div>

        <div className="inline-flex items-center bg-[#0C1220] border border-white/[0.1] rounded-xl p-1 text-xs">
          <button
            type="button"
            onClick={() => setViewMode("cards")}
            className={`px-3 py-1.5 rounded-lg font-bold transition ${
              viewMode === "cards" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:text-white"
            }`}
          >
            {isAr ? "كروت اللاعبين" : "Player Cards"}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("advanced")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition ${
              viewMode === "advanced" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:text-white"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{isAr ? "الكشافة المتقدمة" : "Advanced Scouting"}</span>
          </button>
        </div>
      </div>

      {viewMode === "advanced" ? (
        <FairScoutingScreen
          lang={lang}
          matchId={matchId}
          role={role}
          onJumpToClip={onJumpToClip}
        />
      ) : (
        <>
          {/* Filters + Tier Legend */}
          <div className="studio-panel p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex bg-[#090D16] border border-white/[0.08] rounded-lg p-1">
                {(
                  [
                    { id: "all", label: isAr ? "الكل" : "All" },
                    { id: "team_a", label: data ? (isAr ? data.team_a_name_ar : data.team_a_name) : "Team A" },
                    { id: "team_b", label: data ? (isAr ? data.team_b_name_ar : data.team_b_name) : "Team B" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTeamFilter(t.id)}
                    className={`px-3 py-1 rounded-md font-bold transition ${
                      teamFilter === t.id
                        ? "bg-emerald-500 text-slate-950"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label={isAr ? "بحث باسم اللاعب أو رقمه" : "Search player name or number"}
                  placeholder={isAr ? "ابحث بالاسم، الرقم، أو المركز..." : "Search name, #, or role..."}
                  className="bg-[#090D16] border border-white/[0.1] rounded-lg ps-8 pe-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60 w-56"
                />
              </div>
              {!isReadOnly && (
                <>
                  <input
                    ref={batchFileInputRef}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleBatchPhotos}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleBatchFetchOfficialPhotos}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/40 text-amber-200 font-bold transition disabled:opacity-50"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>
                      {busyAction === "batch_fetch"
                        ? isAr
                          ? "جاري جلب الصور..."
                          : "Fetching..."
                        : isAr
                        ? "جلب صور اللاعبين الحقيقية"
                        : "Fetch Real Portraits"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenRosters}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 font-bold transition"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{isAr ? "توريد قائمة نادي معتمدة" : "Import Club Roster"}</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => batchFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.06] border border-white/[0.12] text-slate-200 font-semibold transition disabled:opacity-50"
                    title={isAr ? "سمّ الملفات بأرقام القمصان (مثل 1.png, 22.jpg)" : "Name files by jersey number (1.png, 22.jpg)"}
                  >
                    <FolderUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isAr ? "رفع صور جماعي" : "Bulk Photos"}</span>
                  </button>
                </>
              )}
            </div>

            {/* Honest Tier Legend */}
            <div
              className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300"
              title={
                isAr
                  ? "لون الكارت = درجة الثقة في البيانات (عينة قصيرة — ارفع مباراة أطول لكارت فضي/ذهبي)"
                  : "Card color = data confidence tier"
              }
            >
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-400/15 border border-amber-400/35 text-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-300" />
                {isAr ? "ذهبي: ≥80% معايرة و60ث+" : "Gold: ≥80% & 60s+"}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-300/15 border border-slate-300/35 text-slate-200">
                <span className="w-2 h-2 rounded-full bg-slate-300" />
                {isAr ? "فضي: ≥50% و20ث+" : "Silver: ≥50% & 20s+"}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-400/15 border border-orange-400/35 text-orange-200">
                <span className="w-2 h-2 rounded-full bg-orange-400" />
                {isAr ? "برونزي: عينة قصيرة" : "Bronze: Short sample"}
              </span>
            </div>
          </div>

          {errorMsg && (
            <div className="studio-panel p-4 border-rose-500/30 text-xs text-rose-300">{errorMsg}</div>
          )}

          {/* Cards Grid */}
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div
                  key={idx}
                  className="aspect-[0.70] rounded-3xl bg-white/[0.04] border border-white/[0.06] animate-pulse"
                />
              ))}
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="studio-panel p-10 text-center space-y-3">
              <div className="text-sm font-bold text-slate-200">
                {isAr
                  ? "لا يوجد لاعبون متتبعون بما يكفي — راجع الهويات أولاً"
                  : "Not enough tracked players — check Identity QA first"}
              </div>
              {onNavigateQA && (
                <button
                  type="button"
                  onClick={onNavigateQA}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isAr ? "الانتقال لمراجعة الهويات" : "Go to Identity QA"}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
              {filteredPlayers.map((p) => (
                <PlayerCard
                  key={p.track_id}
                  card={p}
                  lang={lang}
                  compact
                  photoVersion={photoVersion}
                  onClick={() => openCardModal(p)}
                />
              ))}
            </div>
          )}

          {(data?.short_tracks_count ?? 0) > 0 && (
            <div className="text-center text-[11px] text-slate-400 py-1">
              {isAr
                ? `تم إخفاء ${data?.short_tracks_count} لقطات قصيرة (< 3 ث) غير كافية للتحليل`
                : `${data?.short_tracks_count} short tracks (<3s) hidden`}
            </div>
          )}
        </>
      )}

      {/* Full Card + Upload + PNG + Compare Modal */}
      {selectedCard && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={selectedCard.display_label}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setSelectedCard(null)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl bg-[#0C1220] border border-white/[0.12] shadow-2xl p-5 space-y-4 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
              <div className="text-sm font-extrabold text-white">
                {selectedCard.display_label} —{" "}
                <span className="text-emerald-400">
                  {isAr ? selectedCard.position_label.ar : selectedCard.position_label.en}
                </span>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                aria-label={isAr ? "إغلاق" : "Close"}
                onClick={() => setSelectedCard(null)}
                className="p-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.08] text-slate-300 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Action Toolbar */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              {!isReadOnly && (
                <>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleOpenAssign}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold disabled:opacity-50 ${
                      assignOpen
                        ? "bg-amber-400 text-slate-950 border-amber-300"
                        : "bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/45 text-amber-200"
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{isAr ? "تحديد هوية اللاعب" : "Assign Player"}</span>
                  </button>
                  {selectedCard.identity_source === "qa_verified" && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => handleAssignIdentity(null)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 text-rose-200 font-bold disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{isAr ? "إلغاء التحديد" : "Clear ID"}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 font-bold disabled:opacity-50"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    <span>{isAr ? "رفع صورة" : "Upload Photo"}</span>
                  </button>
                  {selectedCard.identity_source !== "unverified" && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleFetchOfficialPhoto}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 font-bold disabled:opacity-50"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>
                        {busyAction === "fetch_photo"
                          ? isAr
                            ? "جاري الجلب..."
                            : "Fetching..."
                          : isAr
                          ? "جلب صورة اللاعب الرسمية"
                          : "Fetch Official Photo"}
                      </span>
                    </button>
                  )}
                  {selectedCard.photo_source === "upload" && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleDeletePhoto}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] hover:bg-white/[0.08] border border-white/[0.12] text-slate-200 font-semibold disabled:opacity-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{isAr ? "استرجاع صورة الفيديو" : "Restore Video Shot"}</span>
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleDownloadPng}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{busyAction === "png" ? (isAr ? "جاري التصدير..." : "Exporting...") : isAr ? "تحميل PNG" : "Download PNG"}</span>
              </button>

              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleDownloadMiniPng}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-bold disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isAr ? "كارت مصغّر PNG" : "Mini Card PNG"}</span>
              </button>

              {selectedCard.photo_source === "video" && (
                <button
                  type="button"
                  onClick={() => setPortraitMode((m) => (m === "photo" ? "jersey" : "photo"))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] hover:bg-white/[0.08] border border-white/[0.12] text-slate-200 font-semibold"
                >
                  <Shirt className="w-3.5 h-3.5 text-sky-400" />
                  <span>
                    {portraitMode === "photo"
                      ? isAr
                        ? "عرض قميص النادي"
                        : "Show Kit Jersey"
                      : isAr
                      ? "عرض لقطة الفيديو"
                      : "Show Video Crop"}
                  </span>
                </button>
              )}

              {onPinCardToStudio && (
                <button
                  type="button"
                  onClick={() => {
                    onPinCardToStudio(selectedCard);
                    setSelectedCard(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 font-bold"
                >
                  <Pin className="w-3.5 h-3.5" />
                  <span>{isAr ? "تثبيت على الاستوديو" : "Pin to Studio"}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const nextOpen = !compareOpen;
                  setCompareOpen(nextOpen);
                  if (nextOpen && compareTid === null && data?.players) {
                    const other = data.players.find((p) => p.track_id !== selectedCard.track_id);
                    if (other) setCompareTid(other.track_id);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold transition ${
                  compareOpen
                    ? "bg-sky-500 text-slate-950 border-sky-400"
                    : "bg-[#111827] hover:bg-white/[0.08] border-white/[0.12] text-sky-300"
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>{isAr ? "قارن" : "Compare"}</span>
              </button>

              {onJumpToClip && (
                <button
                  type="button"
                  onClick={() => {
                    const tSec = selectedCard.first_time_s;
                    setSelectedCard(null);
                    onJumpToClip(tSec);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] hover:bg-white/[0.08] border border-white/[0.12] text-slate-200 font-semibold"
                >
                  <Film className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{isAr ? "اذهب للقطة" : "Jump to Clip"}</span>
                </button>
              )}
            </div>

            {assignOpen && (
              <div className="p-3 rounded-xl bg-[#090D16] border border-amber-400/35 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-amber-200">
                  <span>
                    {isAr
                      ? "اختر اللاعب المطابق من قائمة الفريق:"
                      : "Pick matching squad player:"}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {isAr ? "اقتراحات مرتبة حسب المركز (ليست تخميناً تلقائياً)" : "Position-ranked suggestions"}
                  </span>
                </div>
                {loadingCandidates ? (
                  <div className="text-xs text-slate-400 py-2">
                    {isAr ? "جاري تحميل القائمة..." : "Loading candidates..."}
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="text-xs text-slate-400 py-2">
                    {isAr ? "لا توجد قائمة معتمدة لهذا الفريق — قم بتوريد القائمة أولاً." : "No squad roster loaded for this team."}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto">
                    {candidates.map((c, idx) => (
                      <button
                        key={`${c.jersey_number}-${c.name_en}`}
                        type="button"
                        disabled={c.already_assigned || busyAction !== null}
                        onClick={() => handleAssignIdentity(c.jersey_number)}
                        className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#111827] hover:bg-emerald-500/20 border border-white/[0.1] hover:border-emerald-400/50 text-start text-xs disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span dir="ltr" className="px-1.5 py-0.5 rounded bg-white/10 font-black text-amber-300 tabular-nums shrink-0">
                            #{c.jersey_number}
                          </span>
                          <span className="font-bold text-white truncate">
                            {isAr ? c.name_ar : c.name_en}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {idx < 3 && c.compat >= 60 && !c.already_assigned && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                              {isAr ? "مقترح" : "Suggested"}
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-bold">
                            {c.position}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {toastMsg && (
              <div className="px-3 py-2 rounded-lg bg-[#090D16] border border-emerald-500/35 text-xs text-emerald-300">
                {toastMsg}
              </div>
            )}

            {compareOpen && data?.players && (
              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="compare-select" className="text-slate-400">
                  {isAr ? "قارن مع اللاعب:" : "Compare with:"}
                </label>
                <select
                  id="compare-select"
                  value={compareTid ?? ""}
                  onChange={(e) => setCompareTid(e.target.value ? Number(e.target.value) : null)}
                  className="bg-[#090D16] border border-white/[0.12] rounded-lg px-2.5 py-1.5 text-slate-100"
                >
                  {data.players
                    .filter((p) => p.track_id !== selectedCard.track_id)
                    .map((p) => (
                      <option key={p.track_id} value={p.track_id}>
                        {p.jersey_number ? `#${p.jersey_number} ` : ""}
                        {p.display_label} ({p.position_label.code})
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Single Card OR Side-by-Side Comparison */}
            <div
              className={`grid gap-6 items-start ${
                compareOpen && compareCard ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
              }`}
            >
              <PlayerCard
                card={selectedCard}
                lang={lang}
                forcePortraitMode={portraitMode}
                photoVersion={photoVersion}
                compareTo={compareOpen ? compareCard : null}
              />
              {compareOpen && compareCard && (
                <PlayerCard
                  card={compareCard}
                  lang={lang}
                  photoVersion={photoVersion}
                  compareTo={selectedCard}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Verified Club Roster Importer Modal */}
      {rostersOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={isAr ? "توريد قوائم الأندية المعتمدة" : "Import Verified Club Rosters"}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setRostersOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-[#0C1220] border border-white/[0.12] shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="text-sm font-extrabold text-white">
                {isAr ? "توريد قوائم الأندية المعتمدة (2025/2026)" : "Import Verified Club Squads (2025/26)"}
              </div>
              <button
                type="button"
                aria-label={isAr ? "إغلاق" : "Close"}
                onClick={() => setRostersOpen(false)}
                className="p-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.08] text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              {isAr
                ? "اختر قائمة الفريق الأول والخصم من قاعدة البيانات الموثقة ليتم ربط مراكز اللاعبين تلقائياً بالكروت والتشكيل."
                : "Select verified home & away squads to map positions automatically onto cards and tactical lineups."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label htmlFor="roster-a" className="block text-slate-300 font-bold mb-1">
                  {isAr ? "فريقنا (Team A)" : "Home Squad (Team A)"}
                </label>
                <select
                  id="roster-a"
                  value={clubAId}
                  onChange={(e) => setClubAId(e.target.value)}
                  className="w-full bg-[#090D16] border border-white/[0.12] rounded-lg px-2.5 py-2 text-slate-100"
                >
                  {Object.values(rostersData?.clubs || {}).map((c) => (
                    <option key={c.club_id} value={c.club_id}>
                      {isAr ? c.name_ar : c.name_en} ({c.players.length})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="roster-b" className="block text-slate-300 font-bold mb-1">
                  {isAr ? "الخصم (Team B)" : "Away Squad (Team B)"}
                </label>
                <select
                  id="roster-b"
                  value={clubBId}
                  onChange={(e) => setClubBId(e.target.value)}
                  className="w-full bg-[#090D16] border border-white/[0.12] rounded-lg px-2.5 py-2 text-slate-100"
                >
                  {Object.values(rostersData?.clubs || {}).map((c) => (
                    <option key={c.club_id} value={c.club_id}>
                      {isAr ? c.name_ar : c.name_en} ({c.players.length})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRostersOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#090D16] text-slate-300 text-xs font-bold"
              >
                {isAr ? "إلغاء" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={busyAction === "roster"}
                onClick={handleImportRoster}
                className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold disabled:opacity-50"
              >
                {busyAction === "roster"
                  ? isAr
                    ? "جاري التوريد..."
                    : "Importing..."
                  : isAr
                  ? "تطبيق القوائم على الكروت"
                  : "Apply Verified Squads"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
