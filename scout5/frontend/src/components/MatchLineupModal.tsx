"use client";

import React, { useEffect, useState } from "react";
import { CheckCheck, Save, Sparkles, UserCheck, Users, X } from "lucide-react";
import { API_BASE, apiFetch, type LineupResponse } from "@/lib/api";
import { useScoutStore } from "@/store/useScoutStore";

export default function MatchLineupModal() {
  const showLineupModal = useScoutStore((s) => s.showLineupModal);
  const setShowLineupModal = useScoutStore((s) => s.setShowLineupModal);
  const selectedSlug = useScoutStore((s) => s.selectedSlug);
  const triggerMatchRefresh = useScoutStore((s) => s.triggerMatchRefresh);

  const [data, setData] = useState<LineupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { player_id?: number | null; custom_name?: string }>>({});

  useEffect(() => {
    if (!showLineupModal || !selectedSlug) return;
    setLoading(true);
    setMsg(null);
    setOverrides({});
    void apiFetch<LineupResponse>(`/api/matches/${selectedSlug}/lineup`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [showLineupModal, selectedSlug]);

  if (!showLineupModal) return null;

  const confirmAll = async () => {
    if (!selectedSlug) return;
    setSaving(true);
    setMsg(null);
    try {
      const customItems = Object.entries(overrides).map(([identity_key, v]) => ({
        identity_key,
        player_id: v.player_id || null,
        custom_name: v.custom_name || null,
      }));
      const res = await apiFetch<{ ok: boolean; saved_count: number }>(`/api/matches/${selectedSlug}/lineup/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_auto_all: true, items: customItems }),
      });
      setMsg(`تم تأكيد وحفظ ${res.saved_count} لاعباً في تشكيلة المباراة وتحديث الفيديو والتقارير بالكامل!`);
      triggerMatchRefresh();
      const refreshed = await apiFetch<LineupResponse>(`/api/matches/${selectedSlug}/lineup`);
      setData(refreshed);
    } catch (err) {
      setMsg(`خطأ: ${err instanceof Error ? err.message : "تعذر الحفظ"}`);
    } finally {
      setSaving(false);
    }
  };

  const saveOverridesOnly = async () => {
    if (!selectedSlug) return;
    const customItems = Object.entries(overrides).map(([identity_key, v]) => ({
      identity_key,
      player_id: v.player_id || null,
      custom_name: v.custom_name || null,
    }));
    if (customItems.length === 0) {
      setMsg("لم تقم بتغيير أي اسم — استخدم زر «تأكيد كل الأسماء التلقائية» أو اختر اسماً لتعديله.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; saved_count: number }>(`/api/matches/${selectedSlug}/lineup/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_auto_all: false, items: customItems }),
      });
      setMsg(`تم حفظ ${res.saved_count} تعديلات وتحديث الفيديو والتقارير!`);
      triggerMatchRefresh();
      const refreshed = await apiFetch<LineupResponse>(`/api/matches/${selectedSlug}/lineup`);
      setData(refreshed);
    } catch (err) {
      setMsg(`خطأ: ${err instanceof Error ? err.message : "تعذر الحفظ"}`);
    } finally {
      setSaving(false);
    }
  };

  const statusPill = (st: string, lbl: string) => {
    if (st === "confirmed_manual") return <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 text-[9px] font-black text-emerald-300">{lbl}</span>;
    if (st === "confirmed_ocr") return <span className="rounded bg-cyan-500/20 border border-cyan-500/40 px-1.5 py-0.5 text-[9px] font-black text-cyan-200">{lbl}</span>;
    if (st === "auto_lineup") return <span className="rounded bg-amber-500/15 border border-amber-500/35 px-1.5 py-0.5 text-[9px] font-bold text-amber-200">{lbl}</span>;
    return <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400">{lbl}</span>;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm"
      onClick={() => setShowLineupModal(false)}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-[1100px] overflow-y-auto rounded-3xl border border-slate-700/90 bg-[#0a101b] p-5 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setShowLineupModal(false)}
          className="absolute left-4 top-4 rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="pl-12 space-y-1">
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/35 bg-cyan-500/15 px-2.5 py-0.5 text-[11px] font-black text-cyan-200">
            <Sparkles className="h-3.5 w-3.5" />
            المطابقة شبه التلقائية للتشكيلة (Auto-Lineup + OCR)
          </div>
          <h2 className="text-lg font-black text-white">تشكيلة المباراة وأسماء اللاعبين على الفيديو والتقارير</h2>
          <p className="text-xs text-slate-300">
            قام النظام تلقائياً بربط هويات الفيديو بقوائم الناديين المسجّلين عبر رقم القميص (OCR) والمركز الميداني المعايَر. يمكنك تأكيد الكل بضغطة واحدة أو تعديل أي لاعب (أو كتابة اسم لاعب درجة ثانية/ثالثة غير مسجّل).
          </p>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-950/80 p-3 text-xs">
          <div className="flex items-center gap-3 tabular-nums">
            <span className="inline-flex items-center gap-1 text-emerald-300 font-bold">
              <UserCheck className="h-4 w-4" />
              مؤكد يدوياً: {data?.confirmed_count ?? 0}
            </span>
            <span className="inline-flex items-center gap-1 text-amber-300 font-bold">
              <Users className="h-4 w-4" />
              مطابقة تلقائية جاهزة: {data?.auto_matched_count ?? 0}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void saveOverridesOnly()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3.5 py-2 font-black text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              حفظ التعديلات المحددة
            </button>
            <button
              onClick={() => void confirmAll()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50 shadow-lg shadow-emerald-500/20"
            >
              <CheckCheck className="h-4 w-4" />
              تأكيد كل الأسماء التلقائية بضغطة واحدة
            </button>
          </div>
        </div>

        {msg && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3.5 py-2 text-xs font-bold text-emerald-200">
            {msg}
          </div>
        )}

        {loading || !data ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-400">جاري تحميل تشكيلة الناديين...</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(["0", "1"] as const).map((tid) => {
              const team = data.teams[tid];
              if (!team) return null;
              const col = team.kit?.ring || (tid === "0" ? "#f43f5e" : "#38bdf8");
              return (
                <div key={tid} className="rounded-2xl border border-slate-800 bg-[#0d1422] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="flex items-center gap-2 text-sm font-black text-white">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: col }} />
                      {team.team_name}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {team.squad_roster.length} لاعب في قائمة النادي
                    </span>
                  </div>

                  <div className="space-y-2 max-h-[420px] overflow-y-auto pl-1">
                    {team.identities.map((idn) => {
                      const ov = overrides[idn.identity_key];
                      const currentPid = ov?.player_id !== undefined ? ov.player_id : idn.matched_player_id;
                      return (
                        <div
                          key={idn.identity_key}
                          className="rounded-xl border border-slate-800/90 bg-slate-950/80 p-2.5 text-xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {idn.portrait_url ? (
                                <img
                                  src={`${API_BASE}${idn.portrait_url}`}
                                  alt={idn.identity_key}
                                  className="h-10 w-9 shrink-0 rounded-lg border object-cover bg-slate-900"
                                  style={{ borderColor: col }}
                                />
                              ) : (
                                <div className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 font-mono text-[10px] font-bold">
                                  {idn.inferred_role_code}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-black text-white truncate">{idn.display_name}</span>
                                  <span className="font-mono text-[10px] text-cyan-300">{idn.inferred_role_code}</span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {statusPill(idn.identity_status, idn.status_label_ar)}
                                  {idn.jersey_ocr && (
                                    <span className="font-mono text-[10px] text-emerald-300">OCR #{idn.jersey_ocr}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className="font-mono text-[11px] font-bold text-slate-400">{idn.n_cal_frames}f</span>
                          </div>

                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            <select
                              value={currentPid ?? ""}
                              onChange={(e) => {
                                const val = e.target.value ? Number(e.target.value) : null;
                                setOverrides((prev) => ({
                                  ...prev,
                                  [idn.identity_key]: { player_id: val, custom_name: "" },
                                }));
                              }}
                              className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] text-slate-100"
                            >
                              <option value="">اختر من قائمة {team.team_name}...</option>
                              {team.squad_roster.map((rp) => (
                                <option key={rp.id} value={rp.id}>
                                  {rp.jersey_number ? `#${rp.jersey_number} ` : ""}
                                  {rp.name} ({rp.position})
                                </option>
                              ))}
                            </select>
                            <input
                              value={ov?.custom_name ?? ""}
                              onChange={(e) =>
                                setOverrides((prev) => ({
                                  ...prev,
                                  [idn.identity_key]: { player_id: null, custom_name: e.target.value },
                                }))
                              }
                              placeholder="أو اكتب اسماً جديداً..."
                              className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-100"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
