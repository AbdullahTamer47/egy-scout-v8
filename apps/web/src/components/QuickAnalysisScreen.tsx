"use client";

import React, { useEffect, useState } from "react";
import { Cloud, Download, FileVideo, Globe, Link2, Loader2, Play, Settings2, UploadCloud } from "lucide-react";
import { API_BASE, apiFetch, UserRole } from "@/lib/api";

interface Props {
  lang: "ar" | "en";
  role: UserRole;
  onMatchIngested?: (matchId: string) => void;
}

interface LiveProofResponse {
  match_id?: string;
  elapsed_s: number;
  processed_seconds?: number;
  rows_exported: number;
  players_tracked: number;
  officials_isolated: number;
  ball_detections?: number;
  preview_image_data_url: string;
  parquet_download_url?: string;
  parquet_filename?: string;
}

export default function QuickAnalysisScreen({ lang, role, onMatchIngested }: Props) {
  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  const [sourceMode, setSourceMode] = useState<"upload" | "url">("upload");
  const [importUrl, setImportUrl] = useState("");
  const [maxDurationS, setMaxDurationS] = useState(45);
  const [file, setFile] = useState<File | null>(null);
  const [teamAName, setTeamAName] = useState("Team A");
  const [teamBName, setTeamBName] = useState("Team B");
  const [officialRosterText, setOfficialRosterText] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [running, setRunning] = useState(false);
  const [ingestingMatch, setIngestingMatch] = useState(false);
  const [matchFormat, setMatchFormat] = useState<"11v11" | "9v9" | "7v7" | "6v6" | "5v5">("11v11");
  const [autoFaceBlur, setAutoFaceBlur] = useState(false);
  const [exportingClip, setExportingClip] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<LiveProofResponse | null>(null);
  const [computeStatus, setComputeStatus] = useState<{
    active_mode: string;
    has_groq_vision: boolean;
    has_roboflow_key: boolean;
    has_cloud_worker_url: boolean;
    cloud_worker_host?: string | null;
    local_cuda_available: boolean;
  } | null>(null);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudWorkerUrl, setCloudWorkerUrl] = useState("");
  const [roboflowKey, setRoboflowKey] = useState("");
  const [savingCloud, setSavingCloud] = useState(false);
  const [cloudMsg, setCloudMsg] = useState("");

  useEffect(() => {
    apiFetch<typeof computeStatus>("/api/compute/status", {}, "club_demo_egypt", role)
      .then((res) => setComputeStatus(res))
      .catch(() => {});
  }, [role]);

  const handleSaveCloudConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    setSavingCloud(true);
    setCloudMsg("");
    try {
      const res = await apiFetch<NonNullable<typeof computeStatus>>(
        "/api/compute/config",
        {
          method: "POST",
          body: JSON.stringify({
            cloud_worker_url: cloudWorkerUrl.trim(),
            roboflow_api_key: roboflowKey.trim(),
          }),
        },
        "club_demo_egypt",
        role
      );
      setComputeStatus(res);
      setCloudMsg(isAr ? "تم تحديث إعدادات المعالجة السحابية." : "Cloud compute settings updated.");
    } catch (err) {
      setCloudMsg(String(err));
    } finally {
      setSavingCloud(false);
    }
  };

  const exportWatermarkedMp4 = async () => {
    setExportingClip(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/matches/m2_ahly_enppi/export-clip`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-Id": "club_demo_egypt",
          "X-User-Role": role,
        },
        body: JSON.stringify({ start_s: 50.0, end_s: 55.0, auto_face_blur: autoFaceBlur }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `m2_ahly_enppi_${matchFormat}_clip.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setExportingClip(false);
    }
  };

  const runClipAnalysis = async (useUpload: boolean) => {
    if (isReadOnly) return;
    setRunning(true);
    setErrorMsg("");
    try {
      const form = new FormData();
      if (useUpload && file) form.append("file", file);
      const res = await apiFetch<LiveProofResponse>(
        "/api/live-proof",
        { method: "POST", body: useUpload && file ? form : undefined },
        "club_demo_egypt",
        role
      );
      setResult(res);
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setRunning(false);
    }
  };

  const ingestAsStudioMatch = async () => {
    if (isReadOnly || !file) return;
    setIngestingMatch(true);
    setErrorMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("team_a_name", teamAName.trim() || "Team A");
      form.append("team_b_name", teamBName.trim() || "Team B");
      form.append("match_format", matchFormat);
      if (officialRosterText.trim()) form.append("official_roster_text", officialRosterText.trim());
      const res = await apiFetch<LiveProofResponse>(
        "/api/matches/ingest",
        { method: "POST", body: form },
        "club_demo_egypt",
        role
      );
      setResult(res);
      if (res.match_id && onMatchIngested) {
        onMatchIngested(res.match_id);
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIngestingMatch(false);
    }
  };

  const ingestFromUrl = async () => {
    if (isReadOnly || !importUrl.trim()) return;
    setIngestingMatch(true);
    setErrorMsg("");
    try {
      const res = await apiFetch<LiveProofResponse>(
        "/api/matches/ingest-url",
        {
          method: "POST",
          body: JSON.stringify({
            url: importUrl.trim(),
            team_a_name: teamAName.trim() || "Team A",
            team_b_name: teamBName.trim() || "Team B",
            match_format: matchFormat,
            max_duration_s: maxDurationS,
            official_roster_text: officialRosterText.trim(),
          }),
        },
        "club_demo_egypt",
        role
      );
      setResult(res);
      if (res.match_id && onMatchIngested) {
        onMatchIngested(res.match_id);
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIngestingMatch(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white">
            {isAr ? "رفع وتحليل مباراتك الخاصة (الوظيفة الأساسية للنظام)" : "Upload & Analyze Your Match Video (Primary Hub)"}
          </h1>
          <p className="text-xs text-slate-300 mt-0.5">
            {isAr
              ? "هذا البرنامج مصمم أساساً لرفع فيديو مباراتك الخاصة (ملف MP4 أو رابط YouTube / بث مباشر) وتحليله سحابياً بالكامل. المباريات الأخرى في القائمة العلوية هي نماذج تجريبية."
              : "EGY-SCOUT analyzes your uploaded match videos (MP4 or YouTube/Stream URL) with Cloud-First acceleration."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-[11px] font-bold text-emerald-300">
            <Cloud className="w-3.5 h-3.5" />
            <span>
              {computeStatus?.has_cloud_worker_url
                ? isAr
                  ? `سحابة GPU متصلة (${computeStatus.cloud_worker_host || "Modal L4"})`
                  : `Cloud GPU (${computeStatus.cloud_worker_host || "Worker"})`
                : computeStatus?.has_roboflow_key
                ? isAr
                  ? "Roboflow Serverless GPU + Groq Vision"
                  : "Roboflow Cloud GPU + Groq Vision"
                : computeStatus?.has_groq_vision
                ? isAr
                  ? "الذكاء السحابي Groq Vision نشط (خفيف على جهازك)"
                  : "Groq Cloud Vision Active (CPU-Safe)"
                : isAr
                ? "وضع المعالجة السحابية جاهز"
                : "Cloud-First Ready"}
            </span>
          </div>
          {!isReadOnly && (
            <button
              type="button"
              onClick={() => setCloudOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#0C1220] hover:bg-white/[0.06] border border-white/[0.12] text-[11px] font-semibold text-slate-200"
            >
              <Settings2 className="w-3.5 h-3.5 text-sky-400" />
              <span>{isAr ? "ربط GPU سحابي" : "Cloud GPU Setup"}</span>
            </button>
          )}
        </div>
      </div>

      {cloudOpen && !isReadOnly && (
        <form onSubmit={handleSaveCloudConfig} className="studio-panel p-4 border-sky-500/30 space-y-3 text-xs">
          <div className="font-bold text-sky-300">
            {isAr
              ? "ربط المعالجة السحابية (لتشغيل تحليل كامل بدون ضغط على جهازك أو كارت شاشة قوي)"
              : "Connect Online Cloud GPU (Modal L4 / Roboflow Serverless) — zero local GPU needed"}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="block text-[11px] text-slate-300">
                {isAr ? "رابط Modal / Cloud GPU Worker (اختياري)" : "Modal / Cloud GPU Worker Endpoint URL"}
              </span>
              <input
                type="url"
                dir="ltr"
                value={cloudWorkerUrl}
                onChange={(e) => setCloudWorkerUrl(e.target.value)}
                placeholder="https://your-workspace--egy-scout-cv-worker-analyze-clip.modal.run"
                className="w-full bg-[#090D16] border border-white/[0.12] rounded-lg px-3 py-1.5 text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] text-slate-300">
                {isAr ? "مفتاح Roboflow Serverless API (اختياري — باقة مجانية)" : "Roboflow Serverless API Key (Optional Free Tier)"}
              </span>
              <input
                type="password"
                dir="ltr"
                value={roboflowKey}
                onChange={(e) => setRoboflowKey(e.target.value)}
                placeholder="rf_..."
                className="w-full bg-[#090D16] border border-white/[0.12] rounded-lg px-3 py-1.5 text-slate-100"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">
              {isAr
                ? "ملاحظة: قراءة الأرقام ولوحة النتيجة أونلاين عبر Groq Cloud Vision تعمل بالفعل تلقائياً."
                : "Note: Online jersey & scoreboard reading via Groq Cloud Vision is already active."}
            </span>
            <button
              type="submit"
              disabled={savingCloud}
              className="px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold disabled:opacity-50"
            >
              {savingCloud ? (isAr ? "جاري الحفظ..." : "Saving...") : isAr ? "حفظ وتفعيل" : "Save & Activate"}
            </button>
          </div>
          {cloudMsg && <div className="text-[11px] text-emerald-300">{cloudMsg}</div>}
        </form>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-5 studio-panel p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-white">
              {isAr ? "مركز الاستيراد الهجين (ملف أو رابط)" : "Hybrid Video Ingestion Hub"}
            </div>
            <div className="inline-flex bg-[#090D16] border border-white/[0.08] rounded-lg p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setSourceMode("upload")}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  sourceMode === "upload" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                }`}
              >
                {isAr ? "ملف MP4" : "Upload MP4"}
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("url")}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition ${
                  sourceMode === "url" ? "bg-emerald-500 text-slate-950" : "text-slate-400 hover:text-white"
                }`}
              >
                <Link2 className="w-3 h-3" />
                <span>{isAr ? "رابط YouTube/URL" : "YouTube / URL"}</span>
              </button>
            </div>
          </div>

          {sourceMode === "upload" ? (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setFile(f);
              }}
              className={`flex flex-col items-center justify-center gap-2.5 p-7 rounded-xl border-2 border-dashed transition cursor-pointer ${
                dragActive
                  ? "border-emerald-400 bg-emerald-500/10"
                  : "border-white/[0.12] bg-[#090D16]/80 hover:border-emerald-500/50"
              }`}
            >
              <UploadCloud className="w-8 h-8 text-emerald-400" />
              <div className="text-xs font-semibold text-slate-200 text-center">
                {file ? file.name : isAr ? "اسحب مقطع MP4 هنا أو اضغط للاختيار" : "Drop an MP4 clip here or click to browse"}
              </div>
              <div className="text-[11px] text-slate-500">
                {isAr ? (
                  <>
                    معايرة 32 نقطة + <bdi dir="ltr">SAHI</bdi> للكرة + <bdi dir="ltr">SigLIP</bdi> + تصدير <bdi dir="ltr">Parquet</bdi>
                  </>
                ) : (
                  "32-KP Pitch Homography + SAHI Ball + SigLIP + Parquet Export"
                )}
              </div>
              <input
                type="file"
                accept="video/mp4,video/*"
                className="hidden"
                disabled={isReadOnly}
                onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
              />
            </label>
          ) : (
            <div className="p-4 rounded-xl border border-white/[0.1] bg-[#090D16]/90 space-y-3 text-xs">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <Globe className="w-4 h-4" />
                <span>{isAr ? "استيراد تلقائي (YouTube / Drive / بث حي RTSP أو HLS .m3u8)" : "Auto-Import (YouTube / Drive / Live RTSP or .m3u8 Stream)"}</span>
              </div>
              <input
                type="url"
                dir="ltr"
                value={importUrl}
                disabled={isReadOnly}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=...  OR  rtsp://... / https://.../live.m3u8"
                className="w-full bg-[#111827] border border-white/[0.12] rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60"
              />
              <div className="flex items-center gap-3 text-[11px] text-slate-300">
                <span>{isAr ? "مدة المقطع المستورد (ثانية):" : "Import window (seconds):"}</span>
                <select
                  value={maxDurationS}
                  onChange={(e) => setMaxDurationS(Number(e.target.value))}
                  className="bg-[#111827] border border-white/[0.14] rounded-md px-2.5 py-1 text-slate-100 tabular-nums"
                >
                  {[15, 30, 45, 90, 120].map((s) => (
                    <option key={s} value={s}>{`${s}s`}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#090D16] border border-white/[0.06] rounded-lg px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-1">
              {(["11v11", "9v9", "7v7", "6v6", "5v5"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setMatchFormat(f)}
                  className={`px-2 py-1 rounded-md border tabular-nums font-semibold text-[11px] ${
                    matchFormat === f
                      ? "bg-emerald-500 text-slate-950 border-emerald-400"
                      : "bg-[#111827] border-white/[0.08] text-slate-300"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoFaceBlur}
                onChange={(e) => setAutoFaceBlur(e.target.checked)}
                className="accent-emerald-500"
              />
              <span>{isAr ? "طمس وجوه الناشئين (Privacy)" : "Auto Face-Blur"}</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <label className="space-y-1">
              <span className="block text-[11px] text-slate-400 font-medium">
                {isAr ? "الفريق الأول (صاحب الأرض)" : "Team A (Home)"}
              </span>
              <input
                type="text"
                value={teamAName}
                disabled={isReadOnly}
                onChange={(e) => setTeamAName(e.target.value)}
                placeholder={isAr ? "مثال: الأهلي" : "Home Team Name"}
                className="w-full bg-[#090D16] border border-white/[0.12] rounded-lg px-2.5 py-1.5 text-slate-100 disabled:opacity-50"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] text-slate-400 font-medium">
                {isAr ? "الفريق الثاني (الضيف)" : "Team B (Away)"}
              </span>
              <input
                type="text"
                value={teamBName}
                disabled={isReadOnly}
                onChange={(e) => setTeamBName(e.target.value)}
                placeholder={isAr ? "مثال: إنبي" : "Away Team Name"}
                className="w-full bg-[#090D16] border border-white/[0.12] rounded-lg px-2.5 py-1.5 text-slate-100 disabled:opacity-50"
              />
            </label>
          </div>

          <div className="space-y-1 text-xs">
            <label className="block text-[11px] text-emerald-300 font-semibold">
              {isAr
                ? "قائمة أسماء وأرقام التشكيلة الرسمية (اختياري — خطوة واحدة مع الفيديو وتُطبّق تلقائياً)"
                : "Paste Official Match Roster (Optional — unified Step 1, auto-applied on ingest)"}
            </label>
            <textarea
              rows={3}
              value={officialRosterText}
              disabled={isReadOnly}
              onChange={(e) => setOfficialRosterText(e.target.value)}
              placeholder={
                isAr
                  ? "مثال:\n1 - محمد الشناوي (GK)\n22 - إمام عاشور (CM)\n9 - محمد شريف (ST)"
                  : "Example:\n1 - Mohamed El Shenawy (GK)\n22 - Emam Ashour (CM)"
              }
              className="w-full bg-[#090D16] border border-white/[0.12] rounded-lg px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60"
            />
          </div>

          <div className="rounded-lg bg-sky-500/10 border border-sky-500/25 px-3 py-2 text-[11px] text-sky-200">
            {isAr
              ? "يتم تحليل المقطع بالكامل (حتى 260 لقطة متتبعة) بمعايرة الملعب 32 نقطة وفصل ألوان القمصان وقراءة الأرقام آلياً."
              : "Analyzes the uploaded clip (up to 260 tracked frames) with 32-keypoint homography, kit separation, and OCR."}
          </div>

          <div className="flex flex-wrap gap-2.5">
            {sourceMode === "url" ? (
              <button
                disabled={running || ingestingMatch || !importUrl.trim() || isReadOnly}
                onClick={ingestFromUrl}
                className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800/90 disabled:text-slate-300/75 disabled:border disabled:border-white/[0.12] text-slate-950 font-bold text-xs py-2.5 px-4 rounded-lg transition"
              >
                {ingestingMatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {ingestingMatch
                  ? isAr ? "جاري التحميل وتحليل العينة وفتح الاستوديو..." : "Downloading & analyzing sample..."
                  : isAr ? "تحليل عيّنة من الرابط وفتح الاستوديو" : "Analyze URL sample & open Studio"}
              </button>
            ) : (
              <button
                disabled={running || ingestingMatch || !file || isReadOnly}
                onClick={ingestAsStudioMatch}
                className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800/90 disabled:text-slate-300/75 disabled:border disabled:border-white/[0.12] text-slate-950 font-bold text-xs py-2.5 px-4 rounded-lg transition"
              >
                {ingestingMatch ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileVideo className="w-4 h-4" />}
                {ingestingMatch
                  ? isAr ? "جاري تحليل العينة وفتح الاستوديو..." : "Analyzing sample & opening Studio..."
                  : isAr ? "تحليل عيّنة سريعة وفتح الاستوديو" : "Analyze quick sample & open Studio"}
              </button>
            )}
            <button
              disabled={running || ingestingMatch || !file || isReadOnly}
              onClick={() => runClipAnalysis(true)}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-[#111827] hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 border border-white/[0.14] text-slate-200 font-semibold text-xs py-2 px-3 rounded-lg transition"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" /> : <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />}
              {running ? (isAr ? "جاري التحليل..." : "Analyzing...") : isAr ? "فحص سريع (Parquet)" : "Quick Frame Proof"}
            </button>
            <button
              disabled={running || ingestingMatch || isReadOnly}
              onClick={() => runClipAnalysis(false)}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-[#111827] hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 border border-emerald-500/35 text-emerald-300 font-semibold text-xs py-2 px-3 rounded-lg transition"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
              {running ? (isAr ? "جاري التشغيل..." : "Running...") : isAr ? "تشغيل من عينة الفيديو" : "Run Sample Clip"}
            </button>
          </div>

          {(running || ingestingMatch) && (
            <div className="space-y-1.5">
              <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                <div className="h-full w-2/3 bg-emerald-500 animate-pulse rounded-full" />
              </div>
              <div className="text-[11px] text-emerald-400">
                {isAr ? "جاري عزل اللاعبين والحكام وتصدير التتبع..." : "Isolating players & officials and exporting tracking..."}
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-lg bg-rose-500/15 border border-rose-500/35 px-3 py-2 text-xs text-rose-300">
              {errorMsg.includes("413")
                ? isAr
                  ? "حجم ملف الفيديو يتجاوز الحد الأقصى المسموح به."
                  : "Uploaded video exceeds the maximum allowed size."
                : errorMsg.includes("400")
                ? isAr
                  ? `تعذّر قبول الملف أو الرابط: ${errorMsg}`
                  : `Invalid file or URL: ${errorMsg}`
                : errorMsg}
            </div>
          )}
        </div>

        <div className="xl:col-span-7 studio-panel p-5 space-y-4">
          <div className="text-sm font-bold text-white">
            {isAr ? "نتيجة المعالجة البصرية" : "Processed Visual Output"}
          </div>

          {running || ingestingMatch ? (
            <div className="h-72 rounded-xl bg-[#090D16] border border-emerald-500/30 flex flex-col items-center justify-center gap-3 text-xs text-slate-300">
              <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
              <span>
                {ingestingMatch
                  ? isAr ? "جاري تشغيل 4-Class Football YOLO وبناء المباراة للاستوديو..." : "Running 4-Class Football YOLO & building Studio match..."
                  : isAr ? "جاري معالجة الفريمات وتوليد المعاينة البصرية..." : "Processing frames & rendering preview..."}
              </span>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {result.preview_image_data_url && (
                <img
                  src={result.preview_image_data_url}
                  alt="Processed Frame"
                  className="w-full rounded-lg border border-white/[0.08]"
                />
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
                <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                  <div className="text-[11px] text-slate-400">
                    {result.processed_seconds !== undefined
                      ? isAr ? "المدة المحلّلة / الزمن" : "Sample / Latency"
                      : isAr ? "زمن المعالجة" : "Latency"}
                  </div>
                  <div dir="ltr" className="text-lg font-bold text-emerald-400 mt-0.5 inline-block">
                    {result.processed_seconds !== undefined
                      ? `${result.processed_seconds}s • ${result.elapsed_s}s`
                      : `${result.elapsed_s}s`}
                  </div>
                </div>
                <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                  <div className="text-[11px] text-slate-400">{isAr ? "مسارات اللاعبين" : "Players"}</div>
                  <div className="text-lg font-bold text-white mt-0.5">{result.players_tracked}</div>
                </div>
                <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                  <div className="text-[11px] text-slate-400">{isAr ? "حكام معزولون" : "Officials"}</div>
                  <div className="text-lg font-bold text-amber-400 mt-0.5">{result.officials_isolated}</div>
                </div>
                <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                  <div className="text-[11px] text-slate-400">
                    {result.ball_detections !== undefined
                      ? isAr ? "رصدة الكرة" : "Ball Detections"
                      : isAr ? "صفوف Parquet" : "Parquet Rows"}
                  </div>
                  <div className="text-lg font-bold text-slate-200 mt-0.5">
                    {result.ball_detections !== undefined ? result.ball_detections : result.rows_exported}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {result.match_id && onMatchIngested && (
                  <button
                    type="button"
                    onClick={() => onMatchIngested(result.match_id!)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition"
                  >
                    <Play className="w-4 h-4 shrink-0" />
                    <span>{isAr ? "افتح في استوديو البث" : "Open in Broadcast Studio"}</span>
                  </button>
                )}
                {result.parquet_download_url && (
                  <a
                    href={`${API_BASE}${result.parquet_download_url}`}
                    download={result.parquet_filename || "live_proof.parquet"}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition"
                  >
                    <Download className="w-4 h-4 shrink-0" />
                    <span>
                      {isAr ? (
                        <>
                          تحميل ملف التتبع <bdi dir="ltr">Apache Parquet ({result.parquet_filename || "tracking.parquet"})</bdi>
                        </>
                      ) : (
                        `Download Apache Parquet (${result.parquet_filename || "tracking.parquet"})`
                      )}
                    </span>
                  </a>
                )}
                <button
                  type="button"
                  disabled={exportingClip}
                  onClick={exportWatermarkedMp4}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#090D16] hover:bg-slate-800 border border-white/[0.12] text-slate-200 text-xs font-bold transition disabled:opacity-50"
                >
                  <FileVideo className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {exportingClip
                      ? isAr ? "جاري التصدير..." : "Exporting MP4..."
                      : isAr ? "تصدير MP4 بعلامة النادي" : "Export Watermarked MP4"}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="h-72 rounded-xl bg-[#090D16] border border-white/[0.06] flex items-center justify-center text-xs text-slate-500">
              {isAr ? "ارفع مقطعاً أو اضغط «تشغيل من عينة الفيديو» لعرض النتيجة البصرية هنا." : "Upload a clip or run the sample clip to view processed results."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
