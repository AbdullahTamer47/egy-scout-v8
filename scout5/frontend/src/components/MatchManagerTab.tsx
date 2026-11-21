"use client";

import React, { useEffect, useState } from "react";
import { Film, Globe, Play, UploadCloud } from "lucide-react";
import { API_BASE, apiFetch } from "@/lib/api";
import { useScoutStore } from "@/store/useScoutStore";

interface JobRow {
  id: number;
  match_slug: string;
  kind: string;
  status: string;
  progress: number;
  message: string;
}

export default function MatchManagerTab({ onOpenMatch }: { onOpenMatch: (slug: string) => void }) {
  const matches = useScoutStore((s) => s.matches);
  const setMatches = useScoutStore((s) => s.setMatches);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [maxSec, setMaxSec] = useState(30);
  const [ytUrl, setYtUrl] = useState("");
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    void apiFetch<JobRow[]>("/api/jobs?limit=8").then(setJobs).catch(() => {});
    void apiFetch<typeof matches>("/api/matches").then(setMatches).catch(() => {});
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, []);

  const uploadLocal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("title", title.trim() || file.name);
    form.append("max_sec", String(maxSec));
    const res = await fetch(`${API_BASE}/api/matches/upload`, { method: "POST", body: form });
    if (res.ok) {
      const json = await res.json();
      setNotice(`تم بدء التحليل المحلي المعاير للمباراة ${json.slug}`);
      setFile(null);
      setTitle("");
      refresh();
    }
  };

  const pullYoutube = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytUrl.trim()) return;
    const res = await apiFetch<{ slug: string }>("/api/matches/ingest-youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url_or_query: ytUrl.trim(), max_sec: 35 }),
    });
    setNotice(`بدأ السحب والتحليل للمقطع ${res.slug}`);
    setYtUrl("");
    refresh();
  };

  return (
    <div className="space-y-5">
      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-4 py-2 text-xs text-emerald-200">{notice}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form onSubmit={uploadLocal} className="rounded-2xl border border-slate-800 bg-[#0d1420] p-4 space-y-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
            <UploadCloud className="h-4 w-4" />
            رفع فيديو محلي أوفلاين (MP4)
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان المباراة"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          />
          <div className="flex gap-2">
            <select
              value={maxSec}
              onChange={(e) => setMaxSec(Number(e.target.value))}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            >
              <option value={25}>أول 25 ثانية (سريع على CPU)</option>
              <option value={60}>أول 60 ثانية</option>
              <option value={0}>كامل الفيديو</option>
            </select>
            <label className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 bg-slate-950 px-3 py-2 cursor-pointer hover:border-emerald-500">
              <Film className="h-4 w-4 text-emerald-400" />
              <span className="truncate">{file ? file.name : "اختر MP4..."}</span>
              <input type="file" accept="video/mp4,video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </div>
          <button disabled={!file} className="w-full rounded-xl bg-emerald-500 py-2 font-black text-slate-950 disabled:opacity-40">
            تحليل الفيديو بمحرك V5
          </button>
        </form>

        <form onSubmit={pullYoutube} className="rounded-2xl border border-slate-800 bg-[#0d1420] p-4 space-y-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-sm text-rose-400">
            <Globe className="h-4 w-4" />
            سحب مقطع أونلاين (اختياري)
          </div>
          <input
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
            placeholder="رابط يوتيوب أو اسم المباراة..."
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          />
          <button disabled={!ytUrl.trim()} className="w-full rounded-xl bg-rose-500 py-2 font-black text-white disabled:opacity-40">
            سحب وتحليل أول 35 ثانية
          </button>
        </form>
      </div>

      {/* Active Jobs */}
      {jobs.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-4 space-y-2 text-xs">
          <div className="font-bold text-slate-200">المهام الجارية والمنتهية</div>
          {jobs.map((j) => (
            <div key={j.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2">
              <span className="font-mono text-slate-300">{j.match_slug} • {j.message}</span>
              <span className="font-mono font-bold text-emerald-400">{Math.round(j.progress * 100)}% ({j.status})</span>
            </div>
          ))}
        </div>
      )}

      {/* Match List */}
      <div className="rounded-2xl border border-slate-800 bg-[#0d1420] p-4 space-y-2 text-xs">
        <div className="font-bold text-slate-200">المباريات المسجلة ({matches.length})</div>
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {matches.map((m) => (
            <div key={m.slug} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div>
                <div className="font-bold text-slate-100">{m.title}</div>
                <div className="text-[11px] text-slate-400 tabular-nums">
                  الحالة: {m.status} • التغطية: {m.cal_coverage_pct}% • الخطأ: {m.median_rep_err_px ?? "—"}px
                </div>
              </div>
              {m.status === "ready" && (
                <button
                  onClick={() => onOpenMatch(m.slug)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 font-black text-slate-950 hover:bg-emerald-400"
                >
                  <Play className="h-3.5 w-3.5" />
                  فتح
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
