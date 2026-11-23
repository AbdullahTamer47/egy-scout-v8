"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Download,
  Film,
  Mic,
  MicOff,
  Play,
  Presentation,
  Trash2,
  Upload,
} from "lucide-react";
import { API_BASE, apiFetch, ClipTagItem, UserRole } from "@/lib/api";
import GlossaryTooltip from "@/components/GlossaryTooltip";

const QUICK_TAG_CATEGORIES: Array<{
  id: string;
  ar: string;
  en: string;
  color: string;
}> = [
  { id: "buildup", ar: "بناء اللعب", en: "Build-Up", color: "bg-sky-500/20 border-sky-400/40 text-sky-300" },
  { id: "high_press", ar: "ضغط عالٍ", en: "High Press", color: "bg-emerald-500/20 border-emerald-400/40 text-emerald-300" },
  { id: "transition", ar: "تحول هجومي/دفاعي", en: "Transition", color: "bg-amber-500/20 border-amber-400/40 text-amber-300" },
  { id: "def_error", ar: "خطأ دفاعي", en: "Defensive Error", color: "bg-rose-500/20 border-rose-400/40 text-rose-300" },
  { id: "set_piece", ar: "كرة ثابتة", en: "Set Piece", color: "bg-purple-500/20 border-purple-400/40 text-purple-300" },
  { id: "shot_chance", ar: "فرصة / تسديدة", en: "Shot / Chance", color: "bg-indigo-500/20 border-indigo-400/40 text-indigo-300" },
];

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
  currentTimeSec: number;
  selectedPlayerLabel?: string;
  boardSlidePng?: string | null;
  onJumpToTag: (startSec: number, endSec: number) => void;
  onStartPresentMode: (tags: ClipTagItem[]) => void;
  quickTagSignal?: number;
}

export default function TaggingPlaylistPanel({
  lang,
  matchId,
  role,
  currentTimeSec,
  selectedPlayerLabel = "",
  boardSlidePng = null,
  onJumpToTag,
  onStartPresentMode,
  quickTagSignal = 0,
}: Props) {
  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  const [tags, setTags] = useState<ClipTagItem[]>([]);
  const [preRoll, setPreRoll] = useState<number>(4);
  const [postRoll, setPostRoll] = useState<number>(4);
  const [playlistName, setPlaylistName] = useState<string>("محاضرة غرفة الملابس");
  const [filterPlaylist, setFilterPlaylist] = useState<string>("ALL");
  const [note, setNote] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [exportingMerged, setExportingMerged] = useState<boolean>(false);
  const [muxingVoice, setMuxingVoice] = useState<boolean>(false);

  // Coach Voiceover Recorder
  const [recording, setRecording] = useState<boolean>(false);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const xmlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<{ tags: ClipTagItem[] }>(`/api/matches/${encodeURIComponent(matchId)}/tags`, {}, "club_demo_egypt", role)
      .then((res) => {
        if (alive) setTags(res.tags || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [matchId, role]);

  const addQuickTag = async (cat: (typeof QUICK_TAG_CATEGORIES)[number]) => {
    if (isReadOnly) return;
    try {
      const res = await apiFetch<{ tags: ClipTagItem[] }>(
        `/api/matches/${encodeURIComponent(matchId)}/tags`,
        {
          method: "POST",
          body: JSON.stringify({
            category: cat.id,
            label_ar: cat.ar,
            label_en: cat.en,
            time_s: currentTimeSec,
            pre_roll_s: preRoll,
            post_roll_s: postRoll,
            playlist_name: playlistName.trim() || "محاضرة غرفة الملابس",
            player_label: selectedPlayerLabel,
            note: note.trim(),
          }),
        },
        "club_demo_egypt",
        role
      );
      setTags(res.tags || []);
      setNote("");
      setStatusMsg(isAr ? `تم حفظ وسم "${cat.ar}" عند ${currentTimeSec.toFixed(1)}ث` : `Tagged "${cat.en}" at ${currentTimeSec.toFixed(1)}s`);
      setTimeout(() => setStatusMsg(null), 2600);
    } catch (e) {
      setStatusMsg(String(e));
    }
  };

  // Trigger quick tag via keyboard shortcut 'T'
  const lastSigRef = useRef(0);
  useEffect(() => {
    if (quickTagSignal > 0 && quickTagSignal !== lastSigRef.current) {
      lastSigRef.current = quickTagSignal;
      addQuickTag(QUICK_TAG_CATEGORIES[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickTagSignal]);

  const handleDeleteTag = async (tagId: string) => {
    if (isReadOnly) return;
    try {
      const res = await apiFetch<{ tags: ClipTagItem[] }>(
        `/api/matches/${encodeURIComponent(matchId)}/tags/${encodeURIComponent(tagId)}`,
        { method: "DELETE" },
        "club_demo_egypt",
        role
      );
      setTags(res.tags || []);
    } catch {}
  };

  const handleImportXml = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isReadOnly) return;
    try {
      const text = await file.text();
      const res = await apiFetch<{ imported_count: number; tags: ClipTagItem[] }>(
        `/api/matches/${encodeURIComponent(matchId)}/tags/import-xml`,
        {
          method: "POST",
          body: JSON.stringify({ xml_text: text }),
        },
        "club_demo_egypt",
        role
      );
      setTags(res.tags || []);
      setStatusMsg(
        isAr
          ? `تم استيراد ${res.imported_count} لقطة من ملف Sportscode / Nacsport XML`
          : `Imported ${res.imported_count} Sportscode XML instances`
      );
      setTimeout(() => setStatusMsg(null), 3200);
    } catch (err) {
      setStatusMsg(String(err));
    } finally {
      e.target.value = "";
    }
  };

  const toggleVoiceover = async () => {
    if (recording) {
      mediaRecRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      voiceChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) voiceChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, { type: "audio/webm" });
        setVoiceBlob(blob);
        const url = URL.createObjectURL(blob);
        setVoiceUrl(url);
        stream.getTracks().forEach((tr) => tr.stop());
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setStatusMsg(isAr ? "تعذّر الوصول إلى المايكروفون في المتصفح." : "Microphone permission unavailable.");
    }
  };

  const handleMuxVoiceoverMp4 = async () => {
    if (!voiceBlob || muxingVoice) return;
    setMuxingVoice(true);
    try {
      const fd = new FormData();
      fd.append("start_s", String(Math.max(0, currentTimeSec - preRoll)));
      fd.append("end_s", String(currentTimeSec + postRoll));
      fd.append("auto_face_blur", "false");
      fd.append("voiceover", voiceBlob, "coach_voiceover.webm");
      const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/export-clip-with-audio`, {
        method: "POST",
        headers: { "X-Tenant-Id": "club_demo_egypt", "X-User-Role": role },
        body: fd,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const outBlob = await res.blob();
      const url = URL.createObjectURL(outBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `egy-scout-voiced-${matchId}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg(isAr ? "تم دمج التعليق الصوتي مع رسوم البث في ملف MP4 واحد" : "Muxed voiceover into MP4");
    } catch (e) {
      setStatusMsg(String(e));
    } finally {
      setMuxingVoice(false);
    }
  };

  const handleExportMergedPlaylistMp4 = async () => {
    if (visibleTags.length === 0 || exportingMerged) return;
    setExportingMerged(true);
    try {
      const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/tags/export-playlist-mp4`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": "club_demo_egypt",
          "X-User-Role": role,
        },
        body: JSON.stringify({
          playlist_name: filterPlaylist,
          board_slide_png_data_url: boardSlidePng || "",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const outBlob = await res.blob();
      const url = URL.createObjectURL(outBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `egy-scout-lecture-${matchId}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg(
        isAr
          ? `تم تصدير محاضرة غرفة الملابس كاملة (${visibleTags.length} لقطات${boardSlidePng ? " + شريحة السبورة" : ""}) كفيديو MP4 واحد`
          : "Merged lecture MP4 downloaded"
      );
    } catch (e) {
      setStatusMsg(String(e));
    } finally {
      setExportingMerged(false);
    }
  };

  const playlists = Array.from(new Set(tags.map((t) => t.playlist_name).filter(Boolean)));
  const visibleTags = filterPlaylist === "ALL" ? tags : tags.filter((t) => t.playlist_name === filterPlaylist);

  return (
    <div className="studio-panel p-4 space-y-3.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookmarkPlus className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-extrabold text-white">
            {isAr ? "نافذة التكويد السريع وقوائم عرض غرفة الملابس (Tagging & Playlists)" : "Quick Tagging Panel & Locker-Room Playlists"}
          </h3>
          <GlossaryTooltip term="pre_post_roll" lang={lang} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={toggleVoiceover}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-bold transition ${
              recording
                ? "bg-rose-500 text-white border-rose-400 animate-pulse"
                : "bg-[#090D16] hover:bg-white/[0.06] border-white/[0.12] text-slate-200"
            }`}
          >
            {recording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-rose-400" />}
            <span>{recording ? (isAr ? "إيقاف التسجيل" : "Stop Voice") : isAr ? "تعليق صوتي" : "Voiceover"}</span>
          </button>

          {voiceUrl && (
            <>
              <button
                type="button"
                disabled={muxingVoice}
                onClick={handleMuxVoiceoverMp4}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-200 font-bold"
              >
                <Film className="w-3.5 h-3.5" />
                <span>{muxingVoice ? (isAr ? "جاري الدمج..." : "Muxing...") : isAr ? "دمج الصوت في MP4" : "Mux MP4"}</span>
              </button>
              <a
                href={voiceUrl}
                download={`egy-scout-voiceover-${matchId}.webm`}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isAr ? "الصوت فقط" : "Audio"}</span>
              </a>
            </>
          )}

          <button
            type="button"
            disabled={visibleTags.length === 0 || exportingMerged}
            onClick={handleExportMergedPlaylistMp4}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 disabled:opacity-40 border border-indigo-400/40 text-indigo-200 font-bold"
            title={isAr ? "تصدير كل لقطات القائمة + شريحة السبورة في فيديو محاضرة MP4 واحد" : "Export Merged Lecture MP4"}
          >
            <Film className="w-3.5 h-3.5" />
            <span>
              {exportingMerged
                ? isAr ? "جاري تجميع المحاضرة..." : "Merging..."
                : isAr
                ? `تصدير المحاضرة MP4${boardSlidePng ? " (+شريحة)" : ""}`
                : "Export Lecture MP4"}
            </span>
          </button>

          <a
            href={`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/tags/export-xml`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.06] border border-sky-500/35 text-sky-300 font-bold"
          >
            <Download className="w-3.5 h-3.5" />
            <GlossaryTooltip term="sportscode_xml" lang={lang}>
              <span>{isAr ? "تصدير XML" : "Export XML"}</span>
            </GlossaryTooltip>
          </a>

          {!isReadOnly && (
            <>
              <input ref={xmlInputRef} type="file" accept=".xml,text/xml" onChange={handleImportXml} className="hidden" />
              <button
                type="button"
                onClick={() => xmlInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#090D16] hover:bg-white/[0.06] border border-white/[0.12] text-slate-200 font-bold"
              >
                <Upload className="w-3.5 h-3.5 text-amber-400" />
                <span>{isAr ? "استيراد XML" : "Import XML"}</span>
              </button>
            </>
          )}

          <button
            type="button"
            disabled={visibleTags.length === 0}
            onClick={() => onStartPresentMode(visibleTags)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-extrabold transition"
          >
            <Presentation className="w-3.5 h-3.5" />
            <span>{isAr ? `عرض غرفة الملابس (${visibleTags.length})` : `Present (${visibleTags.length})`}</span>
          </button>
        </div>
      </div>

      {/* Tagging Controls Row: Pre/Post-roll + Playlist + Note + 6 One-Click Tag Buttons */}
      {!isReadOnly && (
        <div className="p-3 rounded-xl bg-[#090D16] border border-white/[0.08] space-y-2.5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
            <div className="md:col-span-3 flex items-center gap-1.5">
              <span className="text-slate-400 shrink-0">{isAr ? "قبل/بعد (ث):" : "Pre/Post (s):"}</span>
              <input
                type="number"
                min={1}
                max={15}
                value={preRoll}
                onChange={(e) => setPreRoll(Number(e.target.value) || 4)}
                className="w-12 bg-[#111827] border border-white/15 rounded px-1.5 py-1 text-center text-emerald-300 font-bold tabular-nums"
              />
              <span className="text-slate-500">/</span>
              <input
                type="number"
                min={1}
                max={15}
                value={postRoll}
                onChange={(e) => setPostRoll(Number(e.target.value) || 4)}
                className="w-12 bg-[#111827] border border-white/15 rounded px-1.5 py-1 text-center text-emerald-300 font-bold tabular-nums"
              />
            </div>
            <input
              type="text"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              placeholder={isAr ? "اسم قائمة العرض (مثال: محاضرة الدفاع)" : "Playlist name..."}
              className="md:col-span-4 bg-[#111827] border border-white/15 rounded-lg px-2.5 py-1.5 text-white"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isAr ? "ملاحظة المدرب على اللقطة الحالية..." : "Coach note for this clip..."}
              className="md:col-span-5 bg-[#111827] border border-white/15 rounded-lg px-2.5 py-1.5 text-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400 text-[11px] font-semibold">
              {isAr ? `تكويد فوري عند ${currentTimeSec.toFixed(1)}ث (اختصار T):` : `Instant Tag at ${currentTimeSec.toFixed(1)}s (Key T):`}
            </span>
            {QUICK_TAG_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => addQuickTag(cat)}
                className={`px-2.5 py-1 rounded-lg border font-bold transition hover:brightness-110 ${cat.color}`}
              >
                + {isAr ? cat.ar : cat.en}
              </button>
            ))}
          </div>
        </div>
      )}

      {statusMsg && <div className="text-[11px] font-bold text-emerald-400 px-1">{statusMsg}</div>}

      {/* Saved Playlist Clips */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-bold text-slate-200">
              {isAr ? `لقطات قائمة العرض المحفوظة على السيرفر (${visibleTags.length})` : `Server-Saved Playlist Clips (${visibleTags.length})`}
            </span>
          </div>
          {playlists.length > 0 && (
            <select
              value={filterPlaylist}
              onChange={(e) => setFilterPlaylist(e.target.value)}
              className="bg-[#090D16] border border-white/15 rounded-lg px-2 py-1 text-[11px] text-slate-200"
            >
              <option value="ALL">{isAr ? "كل القوائم" : "All Playlists"}</option>
              {playlists.map((pl) => (
                <option key={pl} value={pl}>
                  {pl}
                </option>
              ))}
            </select>
          )}
        </div>

        {visibleTags.length === 0 ? (
          <div className="p-3 rounded-xl bg-[#090D16] border border-white/[0.06] text-slate-400 text-[11px]">
            {isAr
              ? "لا توجد لقطات مكوّدة بعد — اضغط أي زر تكويد بالأعلى (أو اضغط حرف T) أثناء مشاهدة الفيديو لبناء محاضرة غرفة الملابس!"
              : "No clips tagged yet — click any quick tag button above (or press T) while watching to build a locker-room playlist!"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {visibleTags.map((t) => (
              <div
                key={t.id}
                className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.08] hover:border-emerald-500/40 flex items-start justify-between gap-2 transition"
              >
                <button
                  type="button"
                  onClick={() => onJumpToTag(t.start_s, t.end_s)}
                  className="text-start flex-1 min-w-0 space-y-0.5"
                >
                  <div className="flex items-center gap-1.5">
                    <Play className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="font-bold text-white truncate">{isAr ? t.label_ar : t.label_en}</span>
                    <span dir="ltr" className="text-[10px] text-sky-300 tabular-nums shrink-0">
                      {t.start_s.toFixed(1)}s–{t.end_s.toFixed(1)}s
                    </span>
                  </div>
                  <div className="text-[10.5px] text-slate-400 truncate">
                    {t.playlist_name} {t.player_label ? `• ${t.player_label}` : ""}
                  </div>
                  {t.note && <div className="text-[10.5px] text-amber-200/90 line-clamp-2">{t.note}</div>}
                </button>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={() => handleDeleteTag(t.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                    title={isAr ? "حذف اللقطة" : "Delete tag"}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
