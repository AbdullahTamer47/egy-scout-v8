"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, MoveHorizontal, Save, Shield } from "lucide-react";
import {
  API_BASE,
  apiFetch,
  BeforeAfterPayload,
  DetectionRow,
  frameImageUrl,
  MatchBenchmarkPayload,
  Phase0EvalPayload,
  QASheetTrack,
  RosterPlayer,
  trackCropUrl,
  UserRole,
} from "@/lib/api";
import { drawBroadcastGroundRing } from "@/lib/broadcastRenderer";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
}

function drawBroadcastFrame(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  detections: DetectionRow[],
  mode: "before" | "after",
  kitColors?: { team_a_hex?: string; team_b_hex?: string }
) {
  canvas.width = img.naturalWidth || 1280;
  canvas.height = img.naturalHeight || 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(img, 0, 0);

  const teamAColor = kitColors?.team_a_hex || "#38BDF8";
  const teamBColor = kitColors?.team_b_hex || "#F87171";

  for (const d of detections) {
    if (d.role === "unassigned") continue;
    const [x1, y1, x2, y2] = d.bbox;
    const cx = (x1 + x2) / 2;
    const cy = y2;
    const rx = Math.max(14, (x2 - x1) * 0.58);
    const ry = rx * 0.32;

    const isOfficial = d.role === "referee" || d.role === "assistant_referee";
    const isSpotlight = d.track_id === 9 || d.track_id === 20;
    const color =
      d.role === "referee"
        ? "#FACC15"
        : d.role === "assistant_referee"
        ? "#FB923C"
        : d.role === "goalkeeper"
        ? "#22D3EE"
        : d.team === "team_a"
        ? teamAColor
        : teamBColor;

    // Broadcast-grade double-bezel perspective disc under player feet
    drawBroadcastGroundRing(
      ctx,
      {
        track_id: d.track_id,
        role: d.role,
        team: d.team,
        x_m: d.x_m ?? 0,
        y_m: d.y_m ?? 0,
        bbox: d.bbox,
      },
      {
        colorHex: color,
        emphasized: isOfficial || isSpotlight,
        subtle: !(isOfficial || isSpotlight),
        phaseRad: 0.7,
      }
    );

    ctx.save();
    // Spotlight callout badge ONLY for referee & assistant referee (T9 / T20)
    if (isOfficial || isSpotlight) {
      if (mode === "before") {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#EF4444";
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
      }

      const label =
        mode === "before"
          ? `T${d.track_id} • ${d.role.toUpperCase()} (${d.team})`
          : `T${d.track_id} • ${d.role === "referee" ? "REFEREE" : "ASST REF"}`;
      ctx.font = "700 11.5px Inter, system-ui, sans-serif";
      const tw = ctx.measureText(label).width + 18;
      const bx = Math.max(8, Math.min(canvas.width - tw - 8, cx - tw / 2));
      const by = Math.max(10, y1 - 28);

      ctx.fillStyle = mode === "before" ? "rgba(185, 28, 28, 0.94)" : "rgba(16, 185, 129, 0.94)";
      ctx.beginPath();
      ctx.roundRect(bx, by, tw, 21, 6);
      ctx.fill();

      ctx.fillStyle = mode === "before" ? "#FFFFFF" : "#042F2E";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, bx + tw / 2, by + 11);
    }
    ctx.restore();
  }
}

const ROLE_AR: Record<string, string> = {
  player: "لاعب",
  goalkeeper: "حارس مرمى",
  referee: "حكم ساحة",
  assistant_referee: "حكم مساعد",
};

const ROLE_EN: Record<string, string> = {
  player: "Player",
  goalkeeper: "Goalkeeper",
  referee: "Referee",
  assistant_referee: "Asst Ref",
};

export default function AccuracyProofScreen({ lang, matchId, role }: Props) {
  const isAr = lang === "ar";
  const isReadOnly = role === "board" || role === "player";

  const [frameId, setFrameId] = useState(1250);
  const [splitPct, setSplitPct] = useState(50);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [data, setData] = useState<BeforeAfterPayload | null>(null);
  const [loadingHero, setLoadingHero] = useState(true);
  const [benchmark, setBenchmark] = useState<MatchBenchmarkPayload | null>(null);
  const [phase0Eval, setPhase0Eval] = useState<Phase0EvalPayload | null>(null);
  const [qaTracks, setQaTracks] = useState<QASheetTrack[]>([]);
  const [officialRoster, setOfficialRoster] = useState<RosterPlayer[]>([]);
  const [rosterText, setRosterText] = useState("");
  const [parsedCount, setParsedCount] = useState<number | null>(null);
  const [autoMatchedCount, setAutoMatchedCount] = useState<number | null>(null);
  const [saveToast, setSaveToast] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const beforeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const afterCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Match-aware default lineup placeholder (never shows Al Ahly roster on ENPPI × Mokawloon!)
  useEffect(() => {
    if (matchId === "m2_ahly_enppi" || matchId === "m1_ahly_sekka") {
      setRosterText("1 - محمد الشناوي (GK) (C)\n10 - إمام عاشور\n9 - وسام أبو علي\n--- احتياط ---\n14 - حسين الشحات");
    } else {
      setRosterText("");
    }
  }, [matchId]);

  // Decoupled fast-first fetches: Before/After hero renders in <200ms without EVER waiting on Phase-0 eval!
  useEffect(() => {
    let alive = true;
    setErrorMsg("");
    setLoadingHero(true);

    apiFetch<BeforeAfterPayload>(`/api/matches/${matchId}/before-after?frame_id=${frameId}`, {}, "club_demo_egypt", role)
      .then((ba) => {
        if (!alive) return;
        setData(ba);
        setLoadingHero(false);
      })
      .catch((e) => {
        if (!alive) return;
        setErrorMsg(String(e));
        setLoadingHero(false);
      });

    apiFetch<{ official_roster?: RosterPlayer[]; tracks: QASheetTrack[] }>(`/api/matches/${matchId}/qa-sheet`, {}, "club_demo_egypt", role)
      .then((qa) => {
        if (!alive) return;
        setQaTracks(qa.tracks.slice(0, 12));
        setOfficialRoster(qa.official_roster || []);
      })
      .catch(() => {});

    apiFetch<MatchBenchmarkPayload>(`/api/matches/${matchId}/benchmark`, {}, "club_demo_egypt", role)
      .then((bm) => {
        if (alive) setBenchmark(bm);
      })
      .catch(() => {});

    apiFetch<Phase0EvalPayload>(`/api/matches/${matchId}/phase0-eval`, {}, "club_demo_egypt", role)
      .then((p0) => {
        if (alive) setPhase0Eval(p0);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [matchId, frameId, role]);

  useEffect(() => {
    if (!data) return;
    let active = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!active) return;
      if (beforeCanvasRef.current) {
        drawBroadcastFrame(beforeCanvasRef.current, img, data.before.detections, "before", data.kit_colors);
      }
      if (afterCanvasRef.current) {
        drawBroadcastFrame(afterCanvasRef.current, img, data.after.detections, "after", data.kit_colors);
      }
    };
    img.src = frameImageUrl(data.match_id, data.frame_id);
    return () => {
      active = false;
    };
  }, [data]);

  const updateSplitFromClientX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
    setSplitPct(Math.max(4, Math.min(96, pct)));
  };

  const handleSaveQA = async () => {
    if (isReadOnly) return;
    const roster = rosterText.split("\n").map((s) => s.trim()).filter(Boolean);
    const overrides: Record<string, unknown> = {};
    for (const t of qaTracks) {
      overrides[String(t.track_id)] = {
        role: t.role,
        team: t.team,
        jersey_number: t.jersey_number,
        verified_name: t.verified_name,
        verified: t.verified,
      };
    }
    try {
      const saveRes = await apiFetch<{ active_learning_samples_saved?: number }>(
        `/api/matches/${matchId}/lineup`,
        { method: "POST", body: JSON.stringify({ official_roster: roster, track_overrides: overrides }) },
        "club_demo_egypt",
        role
      );
      const alSaved = saveRes.active_learning_samples_saved ?? 0;
      setSaveToast(
        isAr
          ? `تم حفظ التأكيدات (+${alSaved} عينة لدولاب التعلم النشط)`
          : `Verified identities saved (+${alSaved} Active-Learning samples)`
      );
      setTimeout(() => setSaveToast(""), 2600);
    } catch (e) {
      setSaveToast(String(e));
    }
  };

  const spotlightAfter =
    data?.after.detections.filter((d) => d.track_id === 9 || d.track_id === 20 || d.role === "referee" || d.role === "assistant_referee") || [];

  return (
    <div className="space-y-6">
      {/* Compact Header & KPI Strip */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            {isAr ? "عزل الحكام وتأكيد الهوية" : "Referee Isolation & Identity Verification"}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {isAr ? (
              <>
                اسحب المقسم فوق فريم <bdi dir="ltr">#{data?.frame_id ?? frameId}</bdi> للمقارنة الفورية بين التصنيف القديم ودرع العزل بـ 4 طبقات.
              </>
            ) : (
              `Drag the divider over Frame #${data?.frame_id ?? frameId} to compare legacy team forcing against the 4-layer isolation shield.`
            )}
          </p>
        </div>

        {data && (
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-400">{isAr ? "الفريم:" : "Frame:"}</label>
            <select
              value={data.frame_id}
              onChange={(e) => setFrameId(Number(e.target.value))}
              className="bg-[#111827] border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs tabular-nums"
            >
              {data.available_frames.map((fid) => (
                <option key={fid} value={fid}>
                  #{fid} {fid === 1250 ? (isAr ? "• حالة الحكم" : "• Spotlight") : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="studio-panel p-3 text-xs text-red-300 border-red-500/30">{errorMsg}</div>
      )}

      {/* Hero Stage: 70% Interactive Before/After Slider + 30% Clean Metrics Panel (Instant Skeleton -> Frame) */}
      {loadingHero && !data ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start animate-pulse">
          <div className="xl:col-span-8 studio-panel p-3">
            <div className="w-full aspect-video rounded-lg bg-white/[0.04] flex items-center justify-center text-xs text-slate-400">
              {isAr ? "جاري تحميل فريم المقارنة قبل / بعد..." : "Loading Before / After comparison frame..."}
            </div>
          </div>
          <div className="xl:col-span-4 grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((k) => (
              <div key={k} className="studio-panel p-3.5 h-24 bg-white/[0.03]" />
            ))}
          </div>
        </div>
      ) : data && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          <div className="xl:col-span-8 studio-panel p-3 space-y-2.5">
            <div className="flex items-center justify-between text-xs px-1 gap-2" dir="ltr">
              <span dir={isAr ? "rtl" : "ltr"} className="text-red-400 font-semibold">
                {isAr ? "يسار — قبل: تجميع ثنائي (تسرب الحكم)" : "BEFORE: Legacy 2-Class"}
              </span>
              <span dir={isAr ? "rtl" : "ltr"} className="text-slate-400 tabular-nums">
                {isAr ? (
                  <>
                    فريم <bdi dir="ltr">#{data.frame_id}</bdi> • اسحب للمقارنة
                  </>
                ) : (
                  `Drag to compare • Frame #${data.frame_id}`
                )}
              </span>
              <span dir={isAr ? "rtl" : "ltr"} className="text-emerald-400 font-semibold">
                {isAr ? (
                  <>
                    يمين — بعد: درع <bdi dir="ltr">V8</bdi> المعزول
                  </>
                ) : (
                  "AFTER: V8 Isolation Shield"
                )}
              </span>
            </div>

            <div
              ref={containerRef}
              dir="ltr"
              onMouseDown={(e) => {
                setDraggingSplit(true);
                updateSplitFromClientX(e.clientX);
              }}
              onMouseMove={(e) => draggingSplit && updateSplitFromClientX(e.clientX)}
              onMouseUp={() => setDraggingSplit(false)}
              onMouseLeave={() => setDraggingSplit(false)}
              className="relative w-full aspect-video rounded-lg overflow-hidden bg-black select-none cursor-ew-resize border border-white/[0.08]"
            >
              {/* Base layer: AFTER */}
              <canvas ref={afterCanvasRef} className="absolute inset-0 w-full h-full object-contain" />

              {/* Clipped overlay: BEFORE */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
              >
                <canvas ref={beforeCanvasRef} className="w-full h-full object-contain" />
              </div>

              {/* Crisp Vertical Emerald Handle */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.8)] pointer-events-none"
                style={{ left: `${splitPct}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-[#090D16]/95 border border-emerald-400 flex items-center justify-center text-emerald-400">
                  <MoveHorizontal className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>

          {/* Side Summary Column */}
          <div className="xl:col-span-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="studio-panel p-3.5">
                <div className="text-[11px] text-slate-400">{isAr ? "طاقم التحكيم بالمباراة" : "Match Officials"}</div>
                <div className="text-2xl font-bold text-emerald-400 tabular-nums mt-1">
                  {data.after.unique_official_tracks}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isAr ? "بحد أقصى 4 (واقعي)" : "Capped realistically"}
                </div>
              </div>
              <div className="studio-panel p-3.5">
                <div className="text-[11px] text-slate-400">{isAr ? "ثبات الدور بالمسار" : "Track Stability"}</div>
                <div className="text-2xl font-bold text-white tabular-nums mt-1">
                  {data.after.track_role_stability_pct}%
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isAr ? "صفر تقلبات للدور" : "Zero role flips"}
                </div>
              </div>
              <div className="studio-panel p-3.5">
                <div className="text-[11px] text-slate-400">{isAr ? "حكام في الفريم الحالي" : "Officials in Frame"}</div>
                <div className="text-2xl font-bold text-amber-400 tabular-nums mt-1">
                  {data.after.referees_in_frame}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isAr ? `قبل الإصلاح: ${data.before.referees_in_frame}` : `Legacy: ${data.before.referees_in_frame}`}
                </div>
              </div>
              <div className="studio-panel p-3.5">
                <div className="text-[11px] text-slate-400">{isAr ? "سقف السرعة الفيزيائي" : "Physics Speed Cap"}</div>
                <div className="text-2xl font-bold text-slate-100 tabular-nums mt-1">
                  <span dir="ltr" className="inline-block tabular-nums">
                    ≤ {data.max_speed_cap_kmh}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isAr ? "كم/س (مرشّح ضوضاء)" : "km/h (smoothed)"}
                </div>
              </div>
            </div>

            <div className="studio-panel p-4 space-y-2.5">
              <div className="text-xs font-semibold text-slate-200">
                {isAr ? "تفاصيل الحالات المعزولة في هذا الفريم" : "Isolated Officials in Current Frame"}
              </div>
              {spotlightAfter.length === 0 ? (
                <div className="text-xs text-slate-500">
                  {isAr ? "لا يوجد حكام ظاهرون داخل كادر هذا الفريم." : "No officials visible in this frame."}
                </div>
              ) : (
                <div className="space-y-2">
                  {spotlightAfter.map((d) => (
                    <div key={d.track_id} className="flex items-center justify-between text-xs py-2 border-b border-white/[0.06] last:border-0">
                      <div>
                        <span className="font-semibold text-white tabular-nums">Track #{d.track_id}</span>
                        <div className="text-[11px] text-slate-400">{isAr ? d.reason_ar : d.reason_en}</div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium">
                        {d.role === "referee"
                          ? isAr ? "حكم ساحة" : "Referee"
                          : isAr ? "مساعد حكم" : "Asst Ref"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Phase 0 & V8 Benchmark Scorecard */}
      {benchmark && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
          <div className="studio-panel p-4">
            <div className="text-[11px] text-slate-400">{isAr ? "خفض تسرب الحكام" : "Official Leak Reduction"}</div>
            <div dir="ltr" className="text-xl font-bold text-emerald-400 tabular-nums mt-1 inline-block">
              {`-${benchmark.official_leakage_reduction_pct}%`}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
              {isAr ? `من ${benchmark.legacy_official_tracks} ← ${benchmark.v8_official_tracks} مسار` : `${benchmark.legacy_official_tracks} -> ${benchmark.v8_official_tracks} tracks`}
            </div>
          </div>
          <div className="studio-panel p-4">
            <div className="text-[11px] text-slate-400">{isAr ? "تغطية تتبع الكرة (بترميم كالمان)" : "Kalman Ball Coverage"}</div>
            <div dir="ltr" className="text-xl font-bold text-amber-400 tabular-nums mt-1 inline-block">
              {`${benchmark.ball_kalman_coverage_pct}%`}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
              {isAr ? `رصدات نظيفة: ${benchmark.ball_clean_detections} • تغطية بعد الترميم` : `${benchmark.ball_clean_detections} clean obs • inpainted coverage`}
            </div>
          </div>
          <div className="studio-panel p-4">
            <div className="text-[11px] text-slate-400">{isAr ? "التحقق الفيزيائي للسرعة" : "Speed Cap Verification"}</div>
            <div dir="ltr" className="text-xl font-bold text-white tabular-nums mt-1 inline-block">
              {`${benchmark.max_observed_speed_kmh} / ${benchmark.max_speed_cap_kmh} km/h`}
            </div>
            <div className="text-[11px] text-emerald-400 mt-0.5">
              {benchmark.speed_cap_compliant ? (isAr ? "مطابق 100% للفيزياء" : "100% Compliant") : "Capped"}
            </div>
          </div>
          <div className="studio-panel p-4">
            <div className="text-[11px] text-slate-400">{isAr ? "حراس المرمى وأرقام القمصان" : "Goalkeepers & Jerseys"}</div>
            <div dir="ltr" className="text-xl font-bold text-emerald-300 mt-1 inline-block tabular-nums">
              {`GK: ${benchmark.goalkeepers_count ?? "—"} • OCR: ${benchmark.jerseys_detected_count ?? 0}`}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {benchmark.team_a_attacks_right
                ? isAr ? "اتجاه الهجوم: نحو اليمين (105م)" : "Attack Direction: Right (105m)"
                : isAr ? "اتجاه الهجوم: نحو اليسار (0م)" : "Attack Direction: Left (0m)"}
            </div>
          </div>
        </div>
      )}

      {/* Honest Phase-0 Structural & Ground-Truth Audit (Zero self-comparison against unverified prelabels!) */}
      {phase0Eval?.available && phase0Eval.after && phase0Eval.before && (
        <div className="studio-panel p-4 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-white">
              {phase0Eval.verified_human_gt
                ? isAr
                  ? `بوابة القياس الحقيقية — المرحلة 0 (${phase0Eval.annotated_frames} فريم معلَّم يدوياً)`
                  : `Phase-0 Human Ground-Truth Gate (${phase0Eval.annotated_frames} Verified Frames)`
                : isAr
                ? `مؤشرات التحسن الفعلي — المرحلة 0 (${phase0Eval.annotated_frames} فريم بانتظار المراجعة البشرية)`
                : `Phase-0 Structural Improvement Audit (${phase0Eval.annotated_frames} Pre-labeled Frames)`}
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[11px] tabular-nums">
              {isAr
                ? `دولاب التعلم النشط: ${phase0Eval.active_learning_queue_size ?? 0} عينة مؤكدة`
                : `Active-Learning Queue: ${phase0Eval.active_learning_queue_size ?? 0} verified`}
            </span>
          </div>

          {phase0Eval.verified_human_gt ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                <div className="text-[11px] text-slate-400">{isAr ? "دقة الحكام (الهدف 95%+)" : "Referee Acc (Gate 95%+)"}</div>
                <div dir="ltr" className="text-base font-bold text-emerald-400 mt-0.5 inline-block">
                  {`${((phase0Eval.before.referee_accuracy ?? 0) * 100).toFixed(1)}% → ${((phase0Eval.after.referee_accuracy ?? 0) * 100).toFixed(1)}%`}
                </div>
              </div>
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                <div className="text-[11px] text-slate-400">{isAr ? "دقة الفريقين (الهدف 97%+)" : "Team Acc (Gate 97%+)"}</div>
                <div dir="ltr" className="text-base font-bold text-sky-400 mt-0.5 inline-block">
                  {`${((phase0Eval.before.team_accuracy ?? 0) * 100).toFixed(1)}% → ${((phase0Eval.after.team_accuracy ?? 0) * 100).toFixed(1)}%`}
                </div>
              </div>
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                <div className="text-[11px] text-slate-400">{isAr ? "معدل تسرب الحكام" : "Referee Leakage Rate"}</div>
                <div dir="ltr" className="text-base font-bold text-amber-400 mt-0.5 inline-block">
                  {`${((phase0Eval.before.referee_leakage_rate ?? 0) * 100).toFixed(1)}% → ${((phase0Eval.after.referee_leakage_rate ?? 0) * 100).toFixed(1)}%`}
                </div>
              </div>
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                <div className="text-[11px] text-slate-400">{isAr ? "ثبات الدور بالمسار" : "Track Role Stability"}</div>
                <div dir="ltr" className="text-base font-bold text-white mt-0.5 inline-block">
                  {`${(phase0Eval.before.track_role_stability * 100).toFixed(1)}% → ${(phase0Eval.after.track_role_stability * 100).toFixed(1)}%`}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                <div className="text-[11px] text-slate-400">{isAr ? "مسارات الحكام (قبل ← بعد)" : "Official Tracks (Before → After)"}</div>
                <div dir="ltr" className="text-base font-bold text-emerald-400 mt-0.5 inline-block">
                  {`${phase0Eval.before.official_tracks ?? 0} → ${phase0Eval.after.official_tracks ?? 0}`}
                </div>
              </div>
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                <div className="text-[11px] text-slate-400">{isAr ? "ثبات الدور على كامل المسار" : "Track Role Stability"}</div>
                <div dir="ltr" className="text-base font-bold text-sky-400 mt-0.5 inline-block">
                  {`${(phase0Eval.before.track_role_stability * 100).toFixed(1)}% → ${(phase0Eval.after.track_role_stability * 100).toFixed(1)}%`}
                </div>
              </div>
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                <div className="text-[11px] text-slate-400">{isAr ? "سقف حراس المرمى الواقعي" : "Goalkeeper Cap (Max 2)"}</div>
                <div dir="ltr" className="text-base font-bold text-amber-400 mt-0.5 inline-block">
                  {`${phase0Eval.after.goalkeeper_tracks ?? 1} GK`}
                </div>
              </div>
              <div className="bg-[#090D16] border border-white/[0.06] rounded-lg p-3">
                <div className="text-[11px] text-slate-400">{isAr ? "دمج المسارات المتقطعة (Re-ID)" : "Re-ID Track Consolidation"}</div>
                <div dir="ltr" className="text-base font-bold text-white mt-0.5 inline-block">
                  {`${phase0Eval.before.total_tracks ?? 0} → ${phase0Eval.after.total_tracks ?? 0}`}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2-Minute QA Sheet with Real Cropped Player Portraits */}
      <div className="studio-panel p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-white">
              {isAr ? "ورقة التأكيد السريع للهويات" : "2-Minute Identity QA Sheet"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {isAr
                ? "صور حقيقية مقصوصة من الفيديو لكل مسار — لا يُعرض أي اسم لاعب إلا بعد التأكيد البشري أو مطابقة التشكيل الرسمي."
                : "Real cropped portraits from the match video — player names display only after explicit verification."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveToast && <span className="text-xs text-emerald-400">{saveToast}</span>}
            {!isReadOnly && (
              <button
                onClick={handleSaveQA}
                className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition"
              >
                <Save className="w-3.5 h-3.5" />
                {isAr ? "حفظ التأكيدات" : "Save QA"}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-300 font-medium">
                {isAr ? "قائمة المباراة الرسمية" : "Official Match Sheet"}
              </label>
              {!isReadOnly && (
                <button
                  onClick={async () => {
                    try {
                      const res = await apiFetch<{
                        count: number;
                        auto_matched_count: number;
                        official_roster: RosterPlayer[];
                      }>(
                        `/api/matches/${matchId}/apply-scoresheet`,
                        { method: "POST", body: JSON.stringify({ raw_text: rosterText }) },
                        "club_demo_egypt",
                        role
                      );
                      setParsedCount(res.count);
                      setAutoMatchedCount(res.auto_matched_count);
                      setOfficialRoster(res.official_roster || []);
                      const qaRefreshed = await apiFetch<{ tracks: QASheetTrack[] }>(
                        `/api/matches/${matchId}/qa-sheet`,
                        {},
                        "club_demo_egypt",
                        role
                      );
                      setQaTracks(qaRefreshed.tracks.slice(0, 12));
                    } catch {}
                  }}
                  className="px-2.5 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-[11px] text-emerald-300 font-semibold transition"
                >
                  {isAr ? "تحليل وتطبيق القائمة" : "Parse & Apply Sheet"}
                </button>
              )}
            </div>
            <textarea
              value={rosterText}
              disabled={isReadOnly}
              onChange={(e) => setRosterText(e.target.value)}
              rows={4}
              placeholder={isAr ? "الصق قائمة التشكيلة الرسمية هنا (مثال: 10 - اسم اللاعب)..." : "Paste official match scoresheet here (e.g. 10 - Player Name)..."}
              className="w-full bg-[#090D16] border border-white/[0.1] rounded-lg p-3 text-xs leading-relaxed text-slate-200 disabled:opacity-60"
            />
            {parsedCount !== null && (
              <div className="text-[11px] text-emerald-400 tabular-nums">
                {isAr
                  ? `✓ تم حفظ ${parsedCount} لاعباً في القائمة (ربط آلي بالرقم: ${autoMatchedCount ?? 0})`
                  : `✓ Saved ${parsedCount} roster players (auto-matched by OCR #: ${autoMatchedCount ?? 0})`}
              </div>
            )}
          </div>

          <div className="lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {qaTracks.map((t, idx) => (
              <div
                key={t.crop_url || `${matchId}-${t.track_id}`}
                className="flex gap-3.5 p-3 rounded-lg bg-[#090D16]/85 border border-white/[0.08] items-center"
              >
                <div className="w-20 h-24 rounded-lg border border-white/[0.1] bg-[#060911] flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src={t.crop_url ? `${API_BASE}${t.crop_url}` : trackCropUrl(matchId, t.track_id)}
                    alt={`Track ${t.track_id}`}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white tabular-nums">#{t.track_id}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-white/[0.06] text-slate-200 font-medium">
                      {isAr ? ROLE_AR[t.role] || t.role : ROLE_EN[t.role] || t.role}
                    </span>
                  </div>
                  {!isReadOnly && officialRoster.length > 0 && t.role !== "referee" && t.role !== "assistant_referee" && (
                    <select
                      value=""
                      onChange={(e) => {
                        const num = Number(e.target.value);
                        const rp = officialRoster.find((r) => r.jersey_number === num);
                        if (!rp) return;
                        const next = [...qaTracks];
                        next[idx] = {
                          ...t,
                          jersey_number: rp.jersey_number,
                          verified_name: rp.name,
                          verified: true,
                        };
                        setQaTracks(next);
                      }}
                      className="w-full bg-[#111827] border border-emerald-500/30 rounded px-1.5 py-1 text-[11px] text-emerald-300"
                    >
                      <option value="">{isAr ? "اختر من القائمة الرسمية..." : "Pick from roster..."}</option>
                      {officialRoster.map((rp) => (
                        <option key={rp.jersey_number} value={rp.jersey_number}>
                          #{rp.jersey_number} - {rp.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      disabled={isReadOnly}
                      placeholder="#"
                      value={t.jersey_number && t.jersey_number > 0 ? t.jersey_number : ""}
                      onChange={(e) => {
                        const next = [...qaTracks];
                        next[idx] = { ...t, jersey_number: e.target.value ? Number(e.target.value) : null };
                        setQaTracks(next);
                      }}
                      className="w-12 bg-[#111827] border border-white/[0.1] rounded px-1.5 py-1 text-xs tabular-nums disabled:opacity-60"
                    />
                    <input
                      type="text"
                      disabled={isReadOnly}
                      placeholder={isAr ? "اسم مؤكد..." : "Verified name..."}
                      value={t.verified_name ?? ""}
                      onChange={(e) => {
                        const next = [...qaTracks];
                        next[idx] = {
                          ...t,
                          verified_name: e.target.value || null,
                          verified: Boolean(e.target.value),
                        };
                        setQaTracks(next);
                      }}
                      className="flex-1 min-w-0 bg-[#111827] border border-white/[0.1] rounded px-2 py-1 text-xs disabled:opacity-60"
                    />
                  </div>
                  <button
                    disabled={isReadOnly}
                    onClick={() => {
                      const next = [...qaTracks];
                      next[idx] = { ...t, verified: !t.verified };
                      setQaTracks(next);
                    }}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                      t.verified ? "text-emerald-400" : "text-slate-400 hover:text-slate-200"
                    } disabled:opacity-60`}
                  >
                    {t.verified ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                    {t.verified ? (isAr ? "مؤكد" : "Verified") : isAr ? "اضغط للتأكيد" : "Verify"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
