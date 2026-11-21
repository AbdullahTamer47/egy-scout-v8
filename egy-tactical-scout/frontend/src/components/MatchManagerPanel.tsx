"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Film, Loader2, Play, RefreshCw, Search, Trash2, UploadCloud, Video } from "lucide-react";
import { API_BASE, apiFetch, type JobItem, type MatchListItem } from "@/lib/api";
import { useTacticalStore } from "@/store/useTacticalStore";

interface YtResult {
  video_id: string;
  title: string;
  url: string;
  channel?: string;
  duration?: number;
}

interface MatchManagerPanelProps {
  onSelectAndOpenMatch: (matchId: number) => void;
  onMatchesChanged: () => void;
}

export default function MatchManagerPanel({ onSelectAndOpenMatch, onMatchesChanged }: MatchManagerPanelProps) {
  const matches = useTacticalStore((s) => s.matches);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [competition, setCompetition] = useState("الدوري المصري الممتاز");
  const [maxSecLocal, setMaxSecLocal] = useState<number>(0);
  const [uploading, setUploading] = useState(false);

  const [ytInput, setYtInput] = useState("");
  const [ytMaxSec, setYtMaxSec] = useState<number>(60);
  const [ytResults, setYtResults] = useState<YtResult[]>([]);
  const [searchingYt, setSearchingYt] = useState(false);

  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchJobs = () => {
    apiFetch<JobItem[]>("/api/jobs?limit=10").then(setJobs).catch(() => {});
  };

  useEffect(() => {
    fetchJobs();
    const timer = setInterval(() => {
      fetchJobs();
      onMatchesChanged();
    }, 3500);
    return () => clearInterval(timer);
  }, [onMatchesChanged]);

  const handleUploadLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title.trim() || file.name.replace(/\.[^.]+$/, ""));
      form.append("competition", competition);
      form.append("max_sec", String(maxSecLocal));

      const res = await fetch(`${API_BASE}/api/matches/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setNotice(`تم رفع الفيديو وبدء التحليل التلقائي للمباراة #${json.match_id}`);
      setFile(null);
      setTitle("");
      fetchJobs();
      onMatchesChanged();
    } catch (err) {
      setNotice(`خطأ في رفع الفيديو: ${err instanceof Error ? err.message : "خطأ"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleIngestYoutube = async (urlOrQuery: string) => {
    if (!urlOrQuery.trim()) return;
    setNotice(null);
    try {
      const res = await apiFetch<{ match_id: number; job_id: number }>("/api/matches/ingest-youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url_or_query: urlOrQuery.trim(), competition, max_sec: ytMaxSec }),
      });
      setNotice(`جاري سحب وتحليل المقطع (#${res.match_id}) عبر YouTube + Auto-Homography...`);
      fetchJobs();
      onMatchesChanged();
    } catch (err) {
      setNotice(`فشل السحب: ${err instanceof Error ? err.message : "خطأ"}`);
    }
  };

  const handleSearchYt = async () => {
    setSearchingYt(true);
    try {
      const res = await apiFetch<YtResult[]>(`/api/scraper/search?q=${encodeURIComponent(ytInput)}&max_results=4`);
      setYtResults(res);
    } catch (err) {
      setNotice(`تعذر البحث: ${err instanceof Error ? err.message : "خطأ"}`);
    } finally {
      setSearchingYt(false);
    }
  };

  const handleReanalyze = async (matchId: number) => {
    try {
      await apiFetch(`/api/matches/${matchId}/reanalyze`, { method: "POST" });
      setNotice(`تمت إعادة جدولة تحليل المباراة #${matchId}`);
      fetchJobs();
      onMatchesChanged();
    } catch (err) {
      setNotice(`خطأ: ${err instanceof Error ? err.message : "تعذر إعادة التحليل"}`);
    }
  };

  const handleDelete = async (matchId: number) => {
    try {
      await apiFetch(`/api/matches/${matchId}`, { method: "DELETE" });
      onMatchesChanged();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-5">
      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-200">
          {notice}
        </div>
      )}

      {/* Upload Local MP4 + YouTube Quick Harvester */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Local Offline MP4 Upload */}
        <form onSubmit={handleUploadLocal} className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4 space-y-3">
          <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
            <UploadCloud className="h-4 w-4" />
            تحليل ملف فيديو محلي فوراً (Offline MP4)
          </div>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان المباراة (مثال: الأهلي ضد الزمالك - تحليل تكتيكي)"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={competition}
              onChange={(e) => setCompetition(e.target.value)}
              placeholder="البطولة"
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
            <select
              value={maxSecLocal}
              onChange={(e) => setMaxSecLocal(Number(e.target.value))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            >
              <option value={0}>كامل مدة المقطع</option>
              <option value={30}>معالجة أول 30 ثانية (سريع)</option>
              <option value={60}>معالجة أول 60 ثانية</option>
              <option value={120}>معالجة أول دقيقتين</option>
            </select>
          </div>

          <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-5 text-center cursor-pointer hover:border-emerald-500 transition">
            <Film className="h-7 w-7 text-emerald-400 mb-1.5" />
            <span className="text-xs font-semibold text-slate-200">
              {file ? file.name : "اختر ملف MP4 من جهاز النادي"}
            </span>
            <span className="text-[11px] text-slate-500 mt-0.5">يتم توحيد الجودة وتشغيل الـ Auto-Homography و 3D تلقائياً</span>
            <input
              type="file"
              accept="video/mp4,video/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>

          <button
            type="submit"
            disabled={!file || uploading}
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-slate-950 transition hover:bg-emerald-400 disabled:opacity-40"
          >
            {uploading ? "جاري الرفع والتجهيز..." : "رفع وتشغيل التحليل التكتيكي والـ 3D"}
          </button>
        </form>

        {/* YouTube Match Harvester */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4 space-y-3">
          <div className="flex items-center gap-2 font-bold text-sm text-rose-400">
            <Video className="h-4 w-4" />
            السحب التلقائي من قنوات الدوري المصري (YouTube)
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={ytInput}
              onChange={(e) => setYtInput(e.target.value)}
              placeholder="رابط YouTube أو اسم المباراة (مثال: ملخص مباراة الأهلي والزمالك)"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
            />
            <select
              value={ytMaxSec}
              onChange={(e) => setYtMaxSec(Number(e.target.value))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100"
            >
              <option value={30}>30 ثانية</option>
              <option value={60}>60 ثانية</option>
              <option value={120}>120 ثانية</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleIngestYoutube(ytInput)}
              disabled={!ytInput.trim()}
              className="flex-1 rounded-xl bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-40"
            >
              سحب وتحليل مباشر
            </button>
            <button
              type="button"
              onClick={handleSearchYt}
              disabled={searchingYt}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
            >
              <Search className="h-3.5 w-3.5" />
              {searchingYt ? "جاري البحث..." : "بحث ملخصات مصر"}
            </button>
          </div>

          {ytResults.length > 0 && (
            <div className="max-h-36 space-y-1.5 overflow-y-auto pt-1">
              {ytResults.map((yr) => (
                <div key={yr.video_id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs">
                  <div className="truncate">
                    <div className="font-semibold text-slate-200 truncate">{yr.title}</div>
                    <div className="text-[10px] text-slate-500">{yr.channel}</div>
                  </div>
                  <button
                    onClick={() => handleIngestYoutube(yr.url)}
                    className="shrink-0 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/30"
                  >
                    تحليل
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live Job Progress Queue */}
      {jobs.some((j) => j.status === "running" || j.status === "queued") && (
        <div className="rounded-2xl border border-cyan-500/30 bg-[#0d1420] p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            مهام قيد التنفيذ الآن
          </div>
          {jobs
            .filter((j) => j.status === "running" || j.status === "queued")
            .map((j) => (
              <div key={j.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-200">{j.message || j.kind}</span>
                  <span className="font-mono text-cyan-300">{Math.round(j.progress * 100)}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-800">
                  <div
                    className="h-1.5 rounded-full bg-cyan-400 transition-all"
                    style={{ width: `${Math.min(100, Math.round(j.progress * 100))}%` }}
                  />
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Match Registry Table */}
      <div className="rounded-2xl border border-slate-800/80 bg-[#0d1420] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">سجل المباريات المحللة والمحفوظة محلياً ({matches.length})</h3>
          <button
            onClick={onMatchesChanged}
            className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500"
          >
            <RefreshCw className="h-3 w-3" />
            تحديث
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-950 text-[11px] text-slate-400">
              <tr>
                <th className="p-2.5">#</th>
                <th className="p-2.5">المباراة</th>
                <th className="p-2.5">المدة</th>
                <th className="p-2.5">تغطية الملعب</th>
                <th className="p-2.5">الحالة</th>
                <th className="p-2.5">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {matches.map((m: MatchListItem) => (
                <tr key={m.id} className="hover:bg-slate-800/40">
                  <td className="p-2.5 font-mono text-slate-400">{m.id}</td>
                  <td className="p-2.5">
                    <div className="font-bold text-slate-100">{m.title}</div>
                    {m.error && <div className="text-[10px] text-rose-400 truncate max-w-md">{m.error}</div>}
                  </td>
                  <td className="p-2.5 font-mono">{m.duration_s ? `${m.duration_s.toFixed(1)}ث` : "-"}</td>
                  <td className="p-2.5 font-mono text-emerald-400">
                    {m.has_pitch_coords ? `${Math.round(m.pitch_coverage * 100)}%` : "تلقائي"}
                  </td>
                  <td className="p-2.5">
                    {m.status === "ready" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        جاهز
                      </span>
                    ) : m.status === "failed" ? (
                      <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-bold text-rose-300">
                        فشل — أعد التحليل
                      </span>
                    ) : (
                      <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-bold text-cyan-300">
                        {m.status}
                      </span>
                    )}
                  </td>
                  <td className="p-2.5 flex flex-wrap gap-1.5">
                    {m.status === "ready" && (
                      <button
                        onClick={() => onSelectAndOpenMatch(m.id)}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-black text-slate-950 hover:bg-emerald-400"
                      >
                        <Play className="h-3 w-3" />
                        فتح في الاستوديو
                      </button>
                    )}
                    <button
                      onClick={() => handleReanalyze(m.id)}
                      className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200 hover:border-cyan-500"
                    >
                      <RefreshCw className="h-3 w-3" />
                      تحليل / إعادة
                    </button>
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="rounded-lg border border-slate-800 p-1 text-slate-500 hover:border-rose-500 hover:text-rose-400"
                      title="حذف"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
