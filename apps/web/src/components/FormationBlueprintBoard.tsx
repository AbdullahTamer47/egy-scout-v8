"use client";

import React, { useEffect, useRef, useState } from "react";
import { Compass, Layers, Shield, Sparkles } from "lucide-react";
import { apiFetch, FormationBlueprintPayload, UserRole } from "@/lib/api";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
  defaultFormation?: string;
  team?: "team_a" | "team_b";
  externalBlueprint?: FormationBlueprintPayload | null;
}

const FORMATIONS = ["4-2-3-1", "4-3-3", "3-4-2-1", "4-4-2"];
const MODES: Array<{ id: string; ar: string; en: string }> = [
  { id: "balanced", ar: "متوازن (Mid-Block)", en: "Balanced" },
  { id: "aggressive", ar: "ضغط عالٍ (High Press)", en: "High Press" },
  { id: "conservative", ar: "تأمين دفاعي (Low Block)", en: "Low Block" },
];

export default function FormationBlueprintBoard({
  lang,
  matchId,
  role,
  defaultFormation = "4-2-3-1",
  team = "team_a",
  externalBlueprint = null,
}: Props) {
  const isAr = lang === "ar";
  const [formationCode, setFormationCode] = useState(defaultFormation);
  const [activeTeam, setActiveTeam] = useState<"team_a" | "team_b">(team);
  const [tacticalMode, setTacticalMode] = useState("balanced");
  const [blueprint, setBlueprint] = useState<FormationBlueprintPayload | null>(externalBlueprint);
  const [selectedSlot, setSelectedSlot] = useState<string | null>("CAM");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (defaultFormation && FORMATIONS.includes(defaultFormation)) {
      setFormationCode(defaultFormation);
    }
  }, [defaultFormation]);

  useEffect(() => {
    let alive = true;
    apiFetch<FormationBlueprintPayload>(
      `/api/matches/${matchId}/formation-blueprint?formation_code=${encodeURIComponent(
        formationCode
      )}&team=${activeTeam}&tactical_mode=${tacticalMode}`,
      {},
      "club_demo_egypt",
      role
    )
      .then((res) => {
        if (alive) setBlueprint(res);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [matchId, formationCode, activeTeam, tacticalMode, role]);

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !blueprint) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const W = cvs.width;
    const H = cvs.height;
    const pad = 22;
    const pw = W - pad * 2;
    const ph = H - pad * 2;

    // 1. Stadium Turf Background with Mowed Stripes
    ctx.fillStyle = "#061A13";
    ctx.fillRect(0, 0, W, H);
    const nStripes = 12;
    for (let i = 0; i < nStripes; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = "#09251B";
        ctx.fillRect(pad + (i * pw) / nStripes, pad, pw / nStripes, ph);
      }
    }

    // 2. FIFA Pitch Markings
    ctx.strokeStyle = "rgba(255, 255, 255, 0.30)";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(pad, pad, pw, ph);
    ctx.beginPath();
    ctx.moveTo(W / 2, pad);
    ctx.lineTo(W / 2, H - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, ph * 0.14, 0, Math.PI * 2);
    ctx.stroke();

    const boxW = pw * (16.5 / 105);
    const boxH = ph * (40.32 / 68);
    const sixW = pw * (5.5 / 105);
    const sixH = ph * (18.32 / 68);
    ctx.strokeRect(pad, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - pad - boxW, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(pad, (H - sixH) / 2, sixW, sixH);
    ctx.strokeRect(W - pad - sixW, (H - sixH) / 2, sixW, sixH);

    // 3. Tactical Zones (Zone 14 & Half-Spaces)
    for (const tz of blueprint.tactical_zones) {
      const x1 = pad + (Math.min(tz.x1_m, tz.x2_m) / 105) * pw;
      const x2 = pad + (Math.max(tz.x1_m, tz.x2_m) / 105) * pw;
      const y1 = pad + (tz.y1_m / 68) * ph;
      const y2 = pad + (tz.y2_m / 68) * ph;
      const isZ14 = tz.zone_id === "zone_14";

      ctx.save();
      ctx.fillStyle = isZ14 ? "rgba(245, 158, 11, 0.14)" : "rgba(56, 189, 248, 0.08)";
      ctx.strokeStyle = isZ14 ? "rgba(250, 204, 21, 0.55)" : "rgba(56, 189, 248, 0.32)";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = isZ14 ? 1.6 : 1.1;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.setLineDash([]);

      ctx.fillStyle = isZ14 ? "#FACC15" : "#7DD3FC";
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(tz.label_ar, (x1 + x2) / 2, y1 + 12);
      ctx.restore();
    }

    const kitHex =
      activeTeam === "team_a"
        ? blueprint.kit_colors?.team_a_hex || "#EF4444"
        : blueprint.kit_colors?.team_b_hex || "#38BDF8";

    // 4. Connected Tactical Formation Lines (Backline, Midfield, Attack)
    const lineColors: Record<string, string> = {
      backline: "#38BDF8",
      midfield: "#FACC15",
      attack: "#10B981",
    };

    for (const ln of blueprint.lines) {
      if (ln.points.length < 2) continue;
      const lCol = lineColors[ln.line_type] || "#10B981";
      ctx.save();
      ctx.strokeStyle = lCol;
      ctx.lineWidth = 3;
      ctx.shadowColor = lCol;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ln.points.forEach((pt, idx) => {
        const px = pad + (pt.x_m / 105) * pw;
        const py = pad + (pt.y_m / 68) * ph;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    // 5. Tactical Movement Arrows & 11 Player Nodes
    for (const nd of blueprint.nodes) {
      const px = pad + (nd.x_m / 105) * pw;
      const py = pad + (nd.y_m / 68) * ph;
      const tx = pad + (nd.move_to_x_m / 105) * pw;
      const ty = pad + (nd.move_to_y_m / 68) * ph;
      const isSel = selectedSlot === nd.slot;

      // Movement vector arrow
      if (Math.hypot(tx - px, ty - py) > 8) {
        ctx.save();
        ctx.strokeStyle = isSel ? "#10B981" : "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = isSel ? 2.4 : 1.6;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);

        const ang = Math.atan2(ty - py, tx - px);
        ctx.fillStyle = isSel ? "#10B981" : "rgba(255, 255, 255, 0.75)";
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 8 * Math.cos(ang - 0.42), ty - 8 * Math.sin(ang - 0.42));
        ctx.lineTo(tx - 8 * Math.cos(ang + 0.42), ty - 8 * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Outer selection halo
      if (isSel) {
        ctx.save();
        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Player Circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.fillStyle = nd.slot === "GK" ? "#22D3EE" : kitHex;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#FFFFFF";
      ctx.stroke();

      // Jersey # or Slot inside circle
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "800 10px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(nd.jersey_number ? `${nd.jersey_number}` : nd.slot, px, py);

      // Name + Role Pill below circle
      const shortName = nd.player_label.replace(/\s*\([^)]*\)/g, "").slice(0, 16);
      const pillText = `${nd.slot} • ${shortName}`;
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      const tw = ctx.measureText(pillText).width + 12;
      ctx.fillStyle = "rgba(9, 13, 22, 0.88)";
      ctx.beginPath();
      ctx.roundRect(px - tw / 2, py + 15, tw, 17, 4);
      ctx.fill();
      ctx.strokeStyle = isSel ? "#10B981" : "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = isSel ? "#6EE7B7" : "#F8FAFC";
      ctx.fillText(pillText, px, py + 23.5);
      ctx.restore();
    }
  }, [blueprint, activeTeam, selectedSlot]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = canvasRef.current;
    if (!cvs || !blueprint) return;
    const rect = cvs.getBoundingClientRect();
    const pad = 22;
    const pw = cvs.width - pad * 2;
    const ph = cvs.height - pad * 2;
    const cx = ((e.clientX - rect.left) / rect.width) * cvs.width;
    const cy = ((e.clientY - rect.top) / rect.height) * cvs.height;

    for (const nd of blueprint.nodes) {
      const px = pad + (nd.x_m / 105) * pw;
      const py = pad + (nd.y_m / 68) * ph;
      if (Math.hypot(cx - px, cy - py) <= 22) {
        setSelectedSlot(nd.slot);
        return;
      }
    }
  };

  const activeNode = blueprint?.nodes.find((n) => n.slot === selectedSlot) || blueprint?.nodes[8] || null;

  return (
    <div className="studio-panel p-4 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-bold text-white">
            {isAr ? "لوحة رسم الخطط والتشكيل التكتيكي الدقيق (11v11 Blueprint)" : "Interactive 11v11 Tactical Formation Blueprint"}
          </h3>
        </div>

        {/* Formation & Team Selectors */}
        <div className="flex flex-wrap items-center gap-1.5">
          {FORMATIONS.map((f) => (
            <button
              key={f}
              onClick={() => setFormationCode(f)}
              className={`px-2.5 py-1 rounded-md text-xs font-bold tabular-nums transition ${
                formationCode === f
                  ? "bg-emerald-500 text-slate-950 shadow-sm"
                  : "bg-[#090D16] text-slate-300 border border-white/[0.1] hover:border-emerald-400/50"
              }`}
            >
              {f}
            </button>
          ))}
          <div className="h-4 w-px bg-white/10 mx-1" />
          <button
            onClick={() => setActiveTeam("team_a")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
              activeTeam === "team_a"
                ? "bg-white/15 text-white border border-white/30"
                : "bg-[#090D16] text-slate-400 border border-white/[0.08]"
            }`}
          >
            {blueprint?.team_name && activeTeam === "team_a" ? blueprint.team_name : isAr ? "الفريق الأول" : "Team A"}
          </button>
          <button
            onClick={() => setActiveTeam("team_b")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
              activeTeam === "team_b"
                ? "bg-white/15 text-white border border-white/30"
                : "bg-[#090D16] text-slate-400 border border-white/[0.08]"
            }`}
          >
            {blueprint?.team_name && activeTeam === "team_b" ? blueprint.team_name : isAr ? "الفريق الثاني" : "Team B"}
          </button>
        </div>
      </div>

      {/* Tactical Block Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-slate-400">{isAr ? "نمط انتشار الخطوط:" : "Block Height:"}</span>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setTacticalMode(m.id)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                tacticalMode === m.id
                  ? "bg-sky-500/25 text-sky-300 border border-sky-400/40"
                  : "bg-[#090D16] text-slate-400 border border-white/[0.06]"
              }`}
            >
              {isAr ? m.ar : m.en}
            </button>
          ))}
        </div>
        {blueprint && (
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-sky-300">
              <span className="w-2.5 h-0.5 bg-sky-400 inline-block" /> {isAr ? "خط الدفاع" : "Backline"}
            </span>
            <span className="inline-flex items-center gap-1 text-amber-300">
              <span className="w-2.5 h-0.5 bg-amber-400 inline-block" /> {isAr ? "خط الوسط" : "Midfield"}
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-300">
              <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> {isAr ? "خط الهجوم" : "Attack"}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 rounded-xl overflow-hidden border border-white/[0.1] bg-[#061A13]">
          <canvas
            ref={canvasRef}
            width={680}
            height={420}
            onClick={handleCanvasClick}
            className="w-full block cursor-pointer"
          />
        </div>

        {blueprint && (
          <div className="lg:col-span-4 space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-[#090D16] border border-emerald-500/30 space-y-1.5">
              <div className="font-bold text-emerald-300">{blueprint.title_ar}</div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{blueprint.philosophy_ar}</p>
            </div>

            {activeNode && (
              <div className="p-3 rounded-lg bg-[#090D16] border border-sky-500/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">
                    {activeNode.slot} — {activeNode.role_ar}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[11px] font-bold">
                    {activeNode.player_label}
                  </span>
                </div>
                <div className="text-[11px] text-slate-300">
                  <span className="text-slate-400">{isAr ? "الواجب التكتيكي:" : "Tactical Duty:"} </span>
                  {activeNode.duty_ar}
                </div>
                <div className="text-[10px] text-slate-400 tabular-nums">
                  {isAr
                    ? `التمركز الأساسي: (X=${activeNode.x_m}م، Y=${activeNode.y_m}م) ← التحرك إلى: (X=${activeNode.move_to_x_m}م، Y=${activeNode.move_to_y_m}م)`
                    : `Base: (${activeNode.x_m}m, ${activeNode.y_m}m) -> Move: (${activeNode.move_to_x_m}m, ${activeNode.move_to_y_m}m)`}
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-[#090D16] border border-white/[0.08] space-y-1.5">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>{isAr ? "خطوات تنفيذ الخطة على أرض الملعب:" : "On-Pitch Execution Steps:"}</span>
              </div>
              <div className="space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                {blueprint.execution_steps_ar.map((step, i) => (
                  <div key={i} className="border-b border-white/[0.05] pb-1 last:border-0">
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
