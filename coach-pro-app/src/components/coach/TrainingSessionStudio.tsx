"use client";

import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { Flame, Pause, Play, Plus, Printer, RotateCcw, Save, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CoachClubDetail, DrillSetup, isLightHex, TrainingSessionPlan } from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  club: CoachClubDetail;
  formation: string;
  sessions: TrainingSessionPlan[];
  weeklySafety: { total_weekly_au: number; status: "optimal" | "warning"; warnings_ar: string[] };
  activeSession?: TrainingSessionPlan | null;
  onSessionUpdated: (sess: TrainingSessionPlan, all: TrainingSessionPlan[], safety: Props["weeklySafety"]) => void;
  onSessionsDeleted: (all: TrainingSessionPlan[], safety: Props["weeklySafety"]) => void;
}

const MD_DAYS = [
  { id: "MD-5", label: "MD-5", rpe: 3, dur: 45 },
  { id: "MD-4", label: "MD-4", rpe: 7, dur: 75 },
  { id: "MD-3", label: "MD-3", rpe: 8, dur: 85 },
  { id: "MD-2", label: "MD-2", rpe: 6, dur: 65 },
  { id: "MD-1", label: "MD-1", rpe: 4, dur: 45 },
  { id: "MD", label: "MD", rpe: 9.5, dur: 95 },
  { id: "MD+1", label: "MD+1", rpe: 2.5, dur: 40 },
];

type CanvasTool = "move" | "player_a" | "player_b" | "cone" | "mini_goal" | "mannequin" | "ball" | "pass_arrow" | "press_arrow";

export default function TrainingSessionStudio({
  lang,
  club,
  formation,
  sessions,
  weeklySafety,
  activeSession = null,
  onSessionUpdated,
  onSessionsDeleted,
}: Props) {
  const isAr = lang === "ar";
  const [drills, setDrills] = useState<DrillSetup[]>([]);
  const [selectedMd, setSelectedMd] = useState("MD-3");
  const [selectedDrillId, setSelectedDrillId] = useState("rondo_6v3_pressing");
  const [focusTopic, setFocusTopic] = useState("");
  const [durationMin, setDurationMin] = useState(75);
  const [targetRpe, setTargetRpe] = useState(7.0);
  const [generating, setGenerating] = useState(false);

  const [currentSession, setCurrentSession] = useState<TrainingSessionPlan | null>(activeSession || sessions[0] || null);
  const [tool, setTool] = useState<CanvasTool>("move");
  const [pitchView, setPitchView] = useState<"full" | "half" | "corner">("half");
  const [drillPlayers, setDrillPlayers] = useState<DrillSetup["players"]>([]);
  const [drillProps, setDrillProps] = useState<DrillSetup["props"]>([]);
  const [drillArrows, setDrillArrows] = useState<DrillSetup["arrows"]>([]);
  const [drillZones, setDrillZones] = useState<DrillSetup["zones"]>([]);

  const [animating, setAnimating] = useState(false);
  const [animBallPos, setAnimBallPos] = useState<{ x_m: number; y_m: number } | null>(null);

  const cvsRef = useRef<HTMLCanvasElement | null>(null);
  const loadChartRef = useRef<HTMLDivElement | null>(null);
  const dragItemRef = useRef<{ type: "player" | "prop"; idx: number } | null>(null);
  const arrowStartRef = useRef<{ x_m: number; y_m: number } | null>(null);

  useEffect(() => {
    apiFetch<{ pro_drills: DrillSetup[] }>("/api/coach/training/catalog", {}, "club_demo_egypt", "coach")
      .then((res) => {
        const list = res.pro_drills || [];
        setDrills(list);
        if (!currentSession && list.length > 0) {
          applyDrillTemplate(list[0]);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeSession) loadSessionIntoCanvas(activeSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession]);

  // ECharts Weekly Microcycle Load Bar + RPE Line
  useEffect(() => {
    const el = loadChartRef.current;
    if (!el) return;
    const chart = echarts.init(el);
    const merged = MD_DAYS.map((d) => {
      const saved = sessions.find((s) => s.md_code === d.id);
      const rpe = saved ? saved.target_rpe : 0;
      const au = saved ? saved.srpe_au : 0;
      const refAu = Math.round(d.dur * d.rpe);
      return { id: d.id, rpe, au, refAu };
    });
    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "#FFFFFF",
        borderColor: "#D8E3EB",
        textStyle: { color: "#0B1F3A", fontSize: 11 },
      },
      grid: { left: 36, right: 32, top: 20, bottom: 24 },
      xAxis: { type: "category", data: merged.map((m) => m.id), axisLabel: { color: "#5C6A7C", fontSize: 10 }, axisLine: { lineStyle: { color: "#D8E3EB" } } },
      yAxis: [
        { type: "value", name: "AU", nameTextStyle: { color: "#5C6A7C", fontSize: 10 }, axisLabel: { color: "#5C6A7C", fontSize: 10 }, splitLine: { lineStyle: { color: "#EEF3F6" } } },
        { type: "value", name: "RPE", min: 0, max: 10, nameTextStyle: { color: "#0D717A", fontSize: 10 }, axisLabel: { color: "#0D717A", fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        {
          name: isAr ? "المسجل فعلياً (AU)" : "Logged (AU)",
          type: "bar",
          barWidth: "42%",
          data: merged.map((m) => ({
            value: m.au,
            itemStyle: { borderRadius: [5, 5, 0, 0], color: m.rpe >= 8 ? "#EF4444" : m.rpe >= 6 ? "#E0A526" : "#0FB5AE" },
          })),
        },
        {
          name: isAr ? "المرجع الإرشادي (UEFA)" : "UEFA Ref",
          type: "line",
          smooth: true,
          symbol: "none",
          data: merged.map((m) => m.refAu),
          lineStyle: { color: "#0B1F3A", type: "dashed", width: 1.5, opacity: 0.45 },
        },
      ],
    });
    const onR = () => chart.resize();
    window.addEventListener("resize", onR);
    return () => {
      window.removeEventListener("resize", onR);
      chart.dispose();
    };
  }, [sessions]);

  // 60fps Ball / Drill Playback along Arrows
  useEffect(() => {
    if (!animating || drillArrows.length === 0) return;
    let raf = 0;
    const segMs = 950;
    const startTs = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - startTs) % (drillArrows.length * segMs);
      const idx = Math.floor(elapsed / segMs);
      const u = (elapsed - idx * segMs) / segMs;
      const ar = drillArrows[idx];
      if (ar) {
        setAnimBallPos({
          x_m: ar.from_x_m + (ar.to_x_m - ar.from_x_m) * u,
          y_m: ar.from_y_m + (ar.to_y_m - ar.from_y_m) * u,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setAnimBallPos(null);
    };
  }, [animating, drillArrows]);

  const applyDrillTemplate = (d: DrillSetup) => {
    setAnimating(false);
    setSelectedDrillId(d.drill_id);
    setPitchView(d.pitch_view || "half");
    setDrillPlayers(d.players.map((p) => ({ ...p })));
    setDrillProps(d.props.map((p) => ({ ...p })));
    setDrillArrows(d.arrows.map((a) => ({ ...a })));
    setDrillZones((d.zones || []).map((z) => ({ ...z })));
  };

  const loadSessionIntoCanvas = (s: TrainingSessionPlan) => {
    setCurrentSession(s);
    setSelectedMd(s.md_code || "MD-3");
    setDurationMin(s.duration_min || 60);
    setTargetRpe(s.target_rpe || 6);
    if (s.drill_setup) applyDrillTemplate(s.drill_setup);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await apiFetch<{
        session: TrainingSessionPlan;
        sessions: TrainingSessionPlan[];
        weekly_load_safety: Props["weeklySafety"];
      }>(
        "/api/coach/training/sessions",
        {
          method: "POST",
          body: JSON.stringify({
            club_id: club.club_id,
            md_code: selectedMd,
            drill_id: selectedDrillId,
            focus_topic: focusTopic,
            formation,
            duration_min: durationMin,
            target_rpe: targetRpe,
            save: true,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      loadSessionIntoCanvas(res.session);
      onSessionUpdated(res.session, res.sessions, res.weekly_load_safety);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveBoardEdits = async () => {
    if (!currentSession) {
      await handleGenerate();
      return;
    }
    const updated: TrainingSessionPlan = {
      ...currentSession,
      duration_min: durationMin,
      target_rpe: targetRpe,
      srpe_au: Math.round(durationMin * targetRpe * 10) / 10,
      drill_setup: {
        ...(currentSession.drill_setup || drills[0]),
        pitch_view: pitchView,
        players: drillPlayers,
        props: drillProps,
        arrows: drillArrows,
        zones: drillZones,
      },
    };
    const res = await apiFetch<{
      session: TrainingSessionPlan;
      sessions: TrainingSessionPlan[];
      weekly_load_safety: Props["weeklySafety"];
    }>(
      "/api/coach/training/sessions",
      { method: "POST", body: JSON.stringify({ ...updated, club_id: club.club_id, save: true }) },
      "club_demo_egypt",
      "coach"
    );
    loadSessionIntoCanvas(res.session);
    onSessionUpdated(res.session, res.sessions, res.weekly_load_safety);
  };

  const handleDeleteSession = async (sid: string) => {
    const res = await apiFetch<{ sessions: TrainingSessionPlan[]; weekly_load_safety: Props["weeklySafety"] }>(
      `/api/coach/training/sessions/${encodeURIComponent(sid)}?club_id=${encodeURIComponent(club.club_id)}`,
      { method: "DELETE" },
      "club_demo_egypt",
      "coach"
    );
    onSessionsDeleted(res.sessions, res.weekly_load_safety);
  };

  const getDomain = () => {
    if (pitchView === "half") return { xMin: 50, xMax: 105, yMin: 0, yMax: 68 };
    if (pitchView === "corner") return { xMin: 74, xMax: 105, yMin: 12, yMax: 68 };
    return { xMin: 0, xMax: 105, yMin: 0, yMax: 68 };
  };

  const toCanvas = (x_m: number, y_m: number, W: number, H: number) => {
    const d = getDomain();
    const pad = 20;
    return {
      x: pad + ((x_m - d.xMin) / (d.xMax - d.xMin)) * (W - pad * 2),
      y: pad + ((y_m - d.yMin) / (d.yMax - d.yMin)) * (H - pad * 2),
    };
  };

  const toMeters = (cx: number, cy: number, W: number, H: number) => {
    const d = getDomain();
    const pad = 20;
    const x_m = d.xMin + ((cx - pad) / (W - pad * 2)) * (d.xMax - d.xMin);
    const y_m = d.yMin + ((cy - pad) / (H - pad * 2)) * (d.yMax - d.yMin);
    return {
      x_m: Math.max(d.xMin, Math.min(d.xMax, Math.round(x_m * 10) / 10)),
      y_m: Math.max(d.yMin, Math.min(d.yMax, Math.round(y_m * 10) / 10)),
    };
  };

  useEffect(() => {
    const cvs = cvsRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const W = cvs.width;
    const H = cvs.height;
    ctx.fillStyle = "#15803D";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = "#166534";
        ctx.fillRect((i * W) / 12, 0, W / 12, H);
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,0.82)";
    ctx.lineWidth = 1.6;
    const tl = toCanvas(0, 0, W, H);
    const br = toCanvas(105, 68, W, H);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    const midT = toCanvas(52.5, 0, W, H);
    const midB = toCanvas(52.5, 68, W, H);
    ctx.beginPath();
    ctx.moveTo(midT.x, midT.y);
    ctx.lineTo(midB.x, midB.y);
    ctx.stroke();

    const boxTL = toCanvas(88.5, 13.84, W, H);
    const boxBR = toCanvas(105, 54.16, W, H);
    ctx.strokeRect(boxTL.x, boxTL.y, boxBR.x - boxTL.x, boxBR.y - boxTL.y);
    const boxL_TL = toCanvas(0, 13.84, W, H);
    const boxL_BR = toCanvas(16.5, 54.16, W, H);
    ctx.strokeRect(boxL_TL.x, boxL_TL.y, boxL_BR.x - boxL_TL.x, boxL_BR.y - boxL_TL.y);

    for (const z of drillZones) {
      const p1 = toCanvas(z.x1_m, z.y1_m, W, H);
      const p2 = toCanvas(z.x2_m, z.y2_m, W, H);
      ctx.save();
      ctx.fillStyle = "rgba(16, 185, 129, 0.14)";
      ctx.strokeStyle = "rgba(52, 211, 153, 0.55)";
      ctx.setLineDash([5, 4]);
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.restore();
    }

    for (const ar of drillArrows) {
      const a = toCanvas(ar.from_x_m, ar.from_y_m, W, H);
      const b = toCanvas(ar.to_x_m, ar.to_y_m, W, H);
      ctx.save();
      ctx.strokeStyle = ar.kind === "press" ? "#EF4444" : ar.kind === "run" ? "#38BDF8" : "#FACC15";
      ctx.lineWidth = 2.4;
      if (ar.kind !== "pass") ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - 10 * Math.cos(ang - 0.45), b.y - 10 * Math.sin(ang - 0.45));
      ctx.lineTo(b.x - 10 * Math.cos(ang + 0.45), b.y - 10 * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      ctx.restore();
    }

    for (const pr of drillProps) {
      const pt = toCanvas(pr.x_m, pr.y_m, W, H);
      ctx.save();
      if (pr.kind === "cone") {
        ctx.fillStyle = "#F97316";
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - 7);
        ctx.lineTo(pt.x - 6, pt.y + 6);
        ctx.lineTo(pt.x + 6, pt.y + 6);
        ctx.closePath();
        ctx.fill();
      } else if (pr.kind === "mini_goal") {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(pt.x - 7, pt.y - 14, 14, 28);
      } else if (pr.kind === "mannequin") {
        ctx.fillStyle = "#FACC15";
        ctx.fillRect(pt.x - 5, pt.y - 10, 10, 20);
      } else {
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0F172A";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }

    if (animBallPos) {
      const bp = toCanvas(animBallPos.x_m, animBallPos.y_m, W, H);
      ctx.save();
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    }

    for (const pl of drillPlayers) {
      const pt = toCanvas(pl.x_m, pl.y_m, W, H);
      const teamAColor = club.kit_hex || "#DC2626";
      const isTeamALight = pl.team === "a" && isLightHex(teamAColor);
      ctx.save();
      ctx.fillStyle = pl.team === "a" ? teamAColor : pl.team === "joker" ? "#FACC15" : "#0284C7";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pl.team === "joker" || isTeamALight ? "#0F172A" : "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = pl.team === "joker" || isTeamALight ? "#0F172A" : "#FFFFFF";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(pl.label || pl.id), pt.x, pt.y);
      if (pl.player_name) {
        ctx.fillStyle = "rgba(15,23,42,0.84)";
        ctx.fillRect(pt.x - 24, pt.y + 14, 48, 12);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "600 9px sans-serif";
        ctx.fillText(pl.player_name.split(" ")[0], pt.x, pt.y + 20);
      }
      ctx.restore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchView, drillPlayers, drillProps, drillArrows, drillZones, animBallPos, club.kit_hex]);

  const getCvsCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = cvsRef.current!;
    const rect = cvs.getBoundingClientRect();
    return {
      cx: ((e.clientX - rect.left) / rect.width) * cvs.width,
      cy: ((e.clientY - rect.top) / rect.height) * cvs.height,
      W: cvs.width,
      H: cvs.height,
    };
  };

  const handleCanvasDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { cx, cy, W, H } = getCvsCoords(e);
    const m = toMeters(cx, cy, W, H);
    if (tool === "move") {
      for (let i = 0; i < drillPlayers.length; i++) {
        const pt = toCanvas(drillPlayers[i].x_m, drillPlayers[i].y_m, W, H);
        if (Math.hypot(pt.x - cx, pt.y - cy) < 18) {
          dragItemRef.current = { type: "player", idx: i };
          return;
        }
      }
      for (let i = 0; i < drillProps.length; i++) {
        const pt = toCanvas(drillProps[i].x_m, drillProps[i].y_m, W, H);
        if (Math.hypot(pt.x - cx, pt.y - cy) < 18) {
          dragItemRef.current = { type: "prop", idx: i };
          return;
        }
      }
    } else if (tool === "player_a" || tool === "player_b") {
      setDrillPlayers((prev) => [
        ...prev,
        { id: `N${prev.length + 1}`, team: tool === "player_a" ? "a" : "b", label: `${prev.length + 1}`, x_m: m.x_m, y_m: m.y_m },
      ]);
    } else if (tool === "cone" || tool === "mini_goal" || tool === "mannequin" || tool === "ball") {
      setDrillProps((prev) => [...prev, { id: `P${Date.now()}`, kind: tool, x_m: m.x_m, y_m: m.y_m }]);
    } else if (tool === "pass_arrow" || tool === "press_arrow") {
      arrowStartRef.current = m;
    }
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragItemRef.current) return;
    const { cx, cy, W, H } = getCvsCoords(e);
    const m = toMeters(cx, cy, W, H);
    if (dragItemRef.current.type === "player") {
      const idx = dragItemRef.current.idx;
      setDrillPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, x_m: m.x_m, y_m: m.y_m } : p)));
    } else {
      const idx = dragItemRef.current.idx;
      setDrillProps((prev) => prev.map((p, i) => (i === idx ? { ...p, x_m: m.x_m, y_m: m.y_m } : p)));
    }
  };

  const handleCanvasUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragItemRef.current = null;
    if (arrowStartRef.current && (tool === "pass_arrow" || tool === "press_arrow")) {
      const { cx, cy, W, H } = getCvsCoords(e);
      const endM = toMeters(cx, cy, W, H);
      if (Math.hypot(endM.x_m - arrowStartRef.current.x_m, endM.y_m - arrowStartRef.current.y_m) >= 2.0) {
        setDrillArrows((prev) => [
          ...prev,
          { from_x_m: arrowStartRef.current!.x_m, from_y_m: arrowStartRef.current!.y_m, to_x_m: endM.x_m, to_y_m: endM.y_m, kind: tool === "pass_arrow" ? "pass" : "press" },
        ]);
      }
      arrowStartRef.current = null;
    }
  };

  const srpePreview = Math.round(durationMin * targetRpe);

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-4">
      {/* Weekly Microcycle Load Strip + ECharts ACWR Chart */}
      <div className="studio-panel p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-extrabold text-slate-900">
              {isAr ? `الجدول الأسبوعي ومؤشر الأحمال (sRPE & RPE) — ${club.name_ar}` : `Weekly Periodization & sRPE — ${club.name_en}`}
            </h2>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-extrabold border ${
              weeklySafety.status === "warning"
                ? "bg-amber-50 text-amber-800 border-amber-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
            }`}
          >
            {isAr ? `حمل الأسبوع: ${weeklySafety.total_weekly_au} AU` : `Weekly Load: ${weeklySafety.total_weekly_au} AU`}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
          <div className="lg:col-span-7 grid grid-cols-4 sm:grid-cols-7 gap-2">
            {MD_DAYS.map((d) => {
              const active = selectedMd === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setSelectedMd(d.id);
                    setDurationMin(d.dur);
                    setTargetRpe(d.rpe);
                  }}
                  className={`p-2 rounded-xl border text-center transition ${
                    active
                      ? "bg-emerald-50 border-emerald-500 text-emerald-950 ring-1 ring-emerald-500/25 shadow-2xs"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-white"
                  }`}
                >
                  <div className="text-xs font-extrabold">{d.label}</div>
                  <div className="text-[10px] text-slate-500">RPE {d.rpe}</div>
                  <div className="text-[10px] text-emerald-700 font-bold">{d.dur}m</div>
                </button>
              );
            })}
          </div>
          <div className="lg:col-span-5">
            <div ref={loadChartRef} className="w-full h-36" />
          </div>
        </div>

        {weeklySafety.warnings_ar.map((w, i) => (
          <div key={i} className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800">
            {w}
          </div>
        ))}
      </div>

      {/* Main Split: Interactive Animated 2D Drill Canvas + Session Generator */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7 studio-panel p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={selectedDrillId}
              onChange={(e) => {
                const found = drills.find((x) => x.drill_id === e.target.value);
                if (found) applyDrillTemplate(found);
              }}
              aria-label={isAr ? "اختيار تمرين معتمد" : "Select UEFA Pro Drill"}
              className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-900"
            >
              {drills.map((d) => (
                <option key={d.drill_id} value={d.drill_id}>
                  {isAr ? d.title_ar : d.title_en}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setAnimating((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-extrabold border ${
                  animating ? "bg-amber-500 text-white border-amber-500" : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                }`}
              >
                {animating ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{animating ? (isAr ? "إيقاف" : "Stop") : isAr ? "تشغيل التمرين" : "Animate"}</span>
              </button>
              <button
                type="button"
                onClick={() => setDrillArrows([])}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-100"
                title={isAr ? "مسح الأسهم" : "Clear Arrows"}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              {(["half", "full", "corner"] as const).map((pv) => (
                <button
                  key={pv}
                  type="button"
                  onClick={() => setPitchView(pv)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-bold ${
                    pitchView === pv ? "bg-emerald-600 text-white" : "bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {pv === "half" ? (isAr ? "نصف" : "Half") : pv === "full" ? (isAr ? "كامل" : "Full") : isAr ? "ركنية" : "Corner"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {(
              [
                ["move", isAr ? "سحب" : "Move"],
                ["player_a", isAr ? "+ لاعب فريقك" : "+ Player A"],
                ["player_b", isAr ? "+ ضاغط" : "+ Press"],
                ["cone", isAr ? "+ قمع" : "+ Cone"],
                ["mini_goal", isAr ? "+ مرمى صغير" : "+ Mini Goal"],
                ["mannequin", isAr ? "+ حائط" : "+ Mannequin"],
                ["ball", isAr ? "+ كرة" : "+ Ball"],
                ["pass_arrow", isAr ? "سهم تمرير" : "Pass Arrow"],
                ["press_arrow", isAr ? "سهم ضغط" : "Press Arrow"],
              ] as Array<[CanvasTool, string]>
            ).map(([tid, lbl]) => (
              <button
                key={tid}
                type="button"
                onClick={() => setTool(tid)}
                className={`px-2.5 py-1 rounded-lg font-bold transition ${
                  tool === tid ? "bg-emerald-600 text-white shadow-2xs" : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <canvas
            ref={cvsRef}
            width={760}
            height={440}
            onMouseDown={handleCanvasDown}
            onMouseMove={handleCanvasMove}
            onMouseUp={handleCanvasUp}
            className="w-full rounded-2xl border border-emerald-700/30 cursor-crosshair bg-[#15803D] shadow-sm"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-500">
              {isAr ? "اسحب أي لاعب أو قمع مباشرة أو شغّل حركة الكرة بالزر بالأعلى" : "Drag players/props or click Animate"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveBoardEdits}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-2xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isAr ? "حفظ الوحدة والتمرين" : "Save Session"}</span>
              </button>
              {currentSession && (
                <a
                  href={`http://127.0.0.1:8080/api/coach/training/sessions/${encodeURIComponent(currentSession.session_id)}/print`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-bold hover:border-emerald-400"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{isAr ? "طباعة" : "Print"}</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Right: Session Generator + 4 Phases + Saved Sessions */}
        <div className="xl:col-span-5 space-y-4">
          <div className="studio-panel p-4 space-y-3 text-xs">
            <h3 className="text-xs font-extrabold text-emerald-700">
              {isAr ? "توليد خطة الوحدة التدريبية الذكية" : "Smart Session Builder"}
            </h3>

            <input
              type="text"
              value={focusTopic}
              onChange={(e) => setFocusTopic(e.target.value)}
              placeholder={isAr ? "هدف الحصة (مثال: كسر الضغط العالي والتحول السريع)" : "Session focus topic..."}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-emerald-500 focus:bg-white"
            />

            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-500">{isAr ? "المدة (دقيقة)" : "Duration"}</div>
                <input
                  type="number"
                  min={20}
                  max={130}
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  className="w-full bg-transparent text-sm font-extrabold text-slate-900 outline-none"
                />
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-500">RPE (1–10)</div>
                <input
                  type="number"
                  step={0.5}
                  min={1}
                  max={10}
                  value={targetRpe}
                  onChange={(e) => setTargetRpe(Number(e.target.value))}
                  className="w-full bg-transparent text-sm font-extrabold text-slate-900 outline-none"
                />
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-500">{isAr ? "حمل sRPE" : "Load AU"}</div>
                <div className="text-sm font-extrabold text-emerald-700">{srpePreview} AU</div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold transition shadow-2xs"
            >
              <Plus className="w-4 h-4" />
              <span>{generating ? (isAr ? "جاري التوليد..." : "Generating...") : isAr ? `توليد وحفظ حصة ${selectedMd}` : `Build ${selectedMd} Session`}</span>
            </button>

            {currentSession && (
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="font-extrabold text-slate-900">{currentSession.title_ar}</div>
                <div className="space-y-1.5">
                  {currentSession.phases.map((ph, i) => (
                    <div key={i} className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                      <div className="flex items-center justify-between font-bold text-emerald-700">
                        <span>{ph.title_ar}</span>
                        <span>{ph.duration_min} د</span>
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">{ph.notes_ar}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="studio-panel p-4 space-y-2 text-xs">
            <div className="font-extrabold text-slate-900">
              {isAr ? `الحصص المحفوظة (${sessions.length})` : `Saved Sessions (${sessions.length})`}
            </div>
            {sessions.length === 0 ? (
              <div className="text-slate-500">{isAr ? "اضغط توليد لإنشاء أول حصة تدريبية." : "Click generate to create your first session."}</div>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {sessions.map((s) => (
                  <div
                    key={s.session_id}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200"
                  >
                    <button
                      type="button"
                      onClick={() => loadSessionIntoCanvas(s)}
                      className="text-start min-w-0 flex-1 hover:text-emerald-700"
                    >
                      <div className="font-bold text-slate-900 truncate">{s.title_ar}</div>
                      <div className="text-[10px] text-slate-500">
                        {s.session_date} • {s.duration_min} د • {s.srpe_au} AU
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSession(s.session_id)}
                      className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600"
                      title={isAr ? "حذف" : "Delete"}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
