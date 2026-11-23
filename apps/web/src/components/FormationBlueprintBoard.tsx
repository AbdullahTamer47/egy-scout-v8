"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  Compass,
  Hand,
  Layers,
  MoveUpRight,
  Pencil,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Users,
  Zap,
} from "lucide-react";
import {
  apiFetch,
  BlueprintCustomZone,
  BlueprintNode,
  BlueprintPassingArrow,
  FormationBlueprintPayload,
  UserRole,
} from "@/lib/api";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
  defaultFormation?: string;
  team?: "team_a" | "team_b";
  externalBlueprint?: FormationBlueprintPayload | null;
}

type DrawTool = "drag_player" | "run_arrow" | "pass_arrow" | "press_arrow" | "zone_box" | "freehand";
type TeamDisplayMode = "both" | "team_a" | "team_b";

interface FreehandStroke {
  color: string;
  points: Array<{ x_m: number; y_m: number }>;
}

const PRESET_FORMATIONS = ["4-2-3-1", "4-3-3", "3-4-2-1", "3-5-2", "4-4-2", "5-3-2", "4-1-4-1", "4-2-2-2"];

const TACTICAL_STYLES: Array<{ id: string; ar: string; en: string }> = [
  { id: "balanced", ar: "متوازن (Mid-Block)", en: "Balanced" },
  { id: "tiki_taka", ar: "تيكي تاكا واستحواذ (Tiki-Taka)", en: "Tiki-Taka" },
  { id: "aggressive", ar: "ضغط عالٍ عكسي (Gegenpress)", en: "Gegenpress" },
  { id: "counter_attack", ar: "هجوم مرتد خاطف (Counter)", en: "Direct Counter" },
  { id: "inverted_fullbacks", ar: "أظهرة عكسية وصندوق وسط", en: "Inverted Fullbacks" },
  { id: "wing_overload", ar: "اختراق وعرضيات الأطراف", en: "Wing Overload" },
  { id: "conservative", ar: "تكتل دفاعي (Low-Block)", en: "Low-Block" },
];

export default function FormationBlueprintBoard({
  lang,
  matchId,
  role,
  defaultFormation = "4-2-3-1",
  externalBlueprint = null,
}: Props) {
  const isAr = lang === "ar";
  const [formationA, setFormationA] = useState(defaultFormation);
  const [formationB, setFormationB] = useState("4-4-2");
  const [customInputA, setCustomInputA] = useState(defaultFormation);
  const [customInputB, setCustomInputB] = useState("4-4-2");
  const [styleA, setStyleA] = useState("tiki_taka");
  const [styleB, setStyleB] = useState("balanced");
  const [teamDisplay, setTeamDisplay] = useState<TeamDisplayMode>("both");
  const [drawTool, setDrawTool] = useState<DrawTool>("drag_player");
  const [showLines, setShowLines] = useState(true);
  const [showPassVectors, setShowPassVectors] = useState(true);

  const [blueprint, setBlueprint] = useState<FormationBlueprintPayload | null>(externalBlueprint);
  const [nodesA, setNodesA] = useState<BlueprintNode[]>([]);
  const [nodesB, setNodesB] = useState<BlueprintNode[]>([]);
  const [userArrows, setUserArrows] = useState<BlueprintPassingArrow[]>([]);
  const [userZones, setUserZones] = useState<BlueprintCustomZone[]>([]);
  const [freehandStrokes, setFreehandStrokes] = useState<FreehandStroke[]>([]);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string>("team_a:CAM");

  // AI Live Drawing Prompt
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingNodeRef = useRef<{ team: "team_a" | "team_b"; index: number } | null>(null);
  const draftShapeRef = useRef<{ startX_m: number; startY_m: number; curX_m: number; curY_m: number } | null>(null);
  const activeStrokeRef = useRef<FreehandStroke | null>(null);
  const [, setRenderTick] = useState(0);

  // Sync when externalBlueprint arrives from AI Chatbot
  useEffect(() => {
    if (externalBlueprint) {
      setBlueprint(externalBlueprint);
      setNodesA(externalBlueprint.nodes || []);
      setNodesB(externalBlueprint.opponent_nodes || []);
      setFormationA(externalBlueprint.formation_code);
      setCustomInputA(externalBlueprint.formation_code);
      if (externalBlueprint.opponent_formation_code) {
        setFormationB(externalBlueprint.opponent_formation_code);
        setCustomInputB(externalBlueprint.opponent_formation_code);
      }
      if (externalBlueprint.custom_arrows?.length) {
        setUserArrows(externalBlueprint.custom_arrows);
      }
      if (externalBlueprint.custom_zones?.length) {
        setUserZones(externalBlueprint.custom_zones);
      }
    }
  }, [externalBlueprint]);

  // Fetch 22-player two-team blueprint from backend whenever formations or styles change
  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({
      formation_code: formationA,
      opponent_formation_code: formationB,
      team: "team_a",
      tactical_mode: styleA,
      opponent_tactical_mode: styleB,
    });
    apiFetch<FormationBlueprintPayload>(
      `/api/matches/${encodeURIComponent(matchId)}/formation-blueprint?${qs.toString()}`,
      {},
      "club_demo_egypt",
      role
    )
      .then((res) => {
        if (!alive) return;
        setBlueprint(res);
        setNodesA(res.nodes || []);
        setNodesB(res.opponent_nodes || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [matchId, formationA, formationB, styleA, styleB, role]);

  const handleAskAiDraw = async (customText?: string) => {
    const pText = (customText ?? aiPrompt).trim();
    if (!pText || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await apiFetch<FormationBlueprintPayload>(
        `/api/matches/${encodeURIComponent(matchId)}/ai-draw`,
        {
          method: "POST",
          body: JSON.stringify({
            prompt: pText,
            formation_code: formationA,
            opponent_formation_code: formationB,
            tactical_mode: styleA,
          }),
        },
        "club_demo_egypt",
        role
      );
      setBlueprint(res);
      setNodesA(res.nodes || []);
      setNodesB(res.opponent_nodes || []);
      setFormationA(res.formation_code);
      setCustomInputA(res.formation_code);
      if (res.opponent_formation_code) {
        setFormationB(res.opponent_formation_code);
        setCustomInputB(res.opponent_formation_code);
      }
      if (res.tactical_mode) setStyleA(res.tactical_mode);
      if (res.custom_arrows) setUserArrows(res.custom_arrows);
      if (res.custom_zones) setUserZones(res.custom_zones);
      setTeamDisplay("both");
    } catch {} finally {
      setAiLoading(false);
    }
  };

  // Convert canvas client event -> pitch meters (0..105, 0..68)
  const clientToPitchMeters = (clientX: number, clientY: number): [number, number] => {
    const cvs = canvasRef.current;
    if (!cvs) return [52.5, 34.0];
    const rect = cvs.getBoundingClientRect();
    const pad = 24;
    const pw = cvs.width - pad * 2;
    const ph = cvs.height - pad * 2;
    const cx = ((clientX - rect.left) / Math.max(1, rect.width)) * cvs.width;
    const cy = ((clientY - rect.top) / Math.max(1, rect.height)) * cvs.height;
    const xm = Math.max(1.0, Math.min(104.0, ((cx - pad) / pw) * 105.0));
    const ym = Math.max(1.0, Math.min(67.0, ((cy - pad) / ph) * 68.0));
    return [Math.round(xm * 10) / 10, Math.round(ym * 10) / 10];
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const [xm, ym] = clientToPitchMeters(e.clientX, e.clientY);

    if (drawTool === "drag_player") {
      // Find nearest node from visible teams within 4.8m
      let bestHit: { team: "team_a" | "team_b"; index: number; dist: number; slot: string } | null = null;
      if (teamDisplay !== "team_b") {
        nodesA.forEach((nd, idx) => {
          const d = Math.hypot(nd.x_m - xm, nd.y_m - ym);
          if (d <= 4.8 && (!bestHit || d < bestHit.dist)) {
            bestHit = { team: "team_a", index: idx, dist: d, slot: nd.slot };
          }
        });
      }
      if (teamDisplay !== "team_a") {
        nodesB.forEach((nd, idx) => {
          const d = Math.hypot(nd.x_m - xm, nd.y_m - ym);
          if (d <= 4.8 && (!bestHit || d < bestHit.dist)) {
            bestHit = { team: "team_b", index: idx, dist: d, slot: nd.slot };
          }
        });
      }
      if (bestHit) {
        const hit = bestHit as { team: "team_a" | "team_b"; index: number; slot: string };
        draggingNodeRef.current = { team: hit.team, index: hit.index };
        setSelectedNodeKey(`${hit.team}:${hit.slot}`);
      }
      return;
    }

    if (drawTool === "freehand") {
      activeStrokeRef.current = {
        color: "#FACC15",
        points: [{ x_m: xm, y_m: ym }],
      };
      setRenderTick((t) => t + 1);
      return;
    }

    draftShapeRef.current = { startX_m: xm, startY_m: ym, curX_m: xm, curY_m: ym };
    setRenderTick((t) => t + 1);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const [xm, ym] = clientToPitchMeters(e.clientX, e.clientY);

    if (draggingNodeRef.current) {
      const { team, index } = draggingNodeRef.current;
      if (team === "team_a") {
        setNodesA((prev) =>
          prev.map((n, idx) =>
            idx === index
              ? {
                  ...n,
                  x_m: xm,
                  y_m: ym,
                  move_to_x_m: Math.round(Math.min(103, Math.max(2, xm + (n.move_to_x_m - n.x_m))) * 10) / 10,
                  move_to_y_m: Math.round(Math.min(66, Math.max(2, ym + (n.move_to_y_m - n.y_m))) * 10) / 10,
                }
              : n
          )
        );
      } else {
        setNodesB((prev) =>
          prev.map((n, idx) =>
            idx === index
              ? {
                  ...n,
                  x_m: xm,
                  y_m: ym,
                  move_to_x_m: Math.round(Math.min(103, Math.max(2, xm + (n.move_to_x_m - n.x_m))) * 10) / 10,
                  move_to_y_m: Math.round(Math.min(66, Math.max(2, ym + (n.move_to_y_m - n.y_m))) * 10) / 10,
                }
              : n
          )
        );
      }
      return;
    }

    if (activeStrokeRef.current) {
      activeStrokeRef.current.points.push({ x_m: xm, y_m: ym });
      setRenderTick((t) => t + 1);
      return;
    }

    if (draftShapeRef.current) {
      draftShapeRef.current.curX_m = xm;
      draftShapeRef.current.curY_m = ym;
      setRenderTick((t) => t + 1);
    }
  };

  const handleMouseUp = () => {
    draggingNodeRef.current = null;
    if (activeStrokeRef.current) {
      const finished = activeStrokeRef.current;
      activeStrokeRef.current = null;
      if (finished.points.length >= 2) {
        setFreehandStrokes((prev) => [...prev, finished]);
      }
      return;
    }
    if (draftShapeRef.current) {
      const d = draftShapeRef.current;
      draftShapeRef.current = null;
      const dist = Math.hypot(d.curX_m - d.startX_m, d.curY_m - d.startY_m);
      if (dist < 2.0) {
        setRenderTick((t) => t + 1);
        return;
      }
      if (drawTool === "zone_box") {
        setUserZones((prev) => [
          ...prev,
          {
            x1_m: Math.min(d.startX_m, d.curX_m),
            y1_m: Math.min(d.startY_m, d.curY_m),
            x2_m: Math.max(d.startX_m, d.curX_m),
            y2_m: Math.max(d.startY_m, d.curY_m),
            color: "#10B981",
            label_ar: isAr ? "منطقة ضغط / تفوق تكتيكي" : "Tactical Zone",
          },
        ]);
      } else {
        const kind = drawTool === "pass_arrow" ? "pass" : drawTool === "press_arrow" ? "press" : "run";
        const color = kind === "pass" ? "#FACC15" : kind === "press" ? "#EF4444" : "#10B981";
        const label =
          kind === "pass"
            ? isAr
              ? "مسار تمريرة"
              : "Pass"
            : kind === "press"
            ? isAr
              ? "ضغط عكسي"
              : "Press"
            : isAr
            ? "تحرك تكتيكي"
            : "Run";
        setUserArrows((prev) => [
          ...prev,
          {
            from_x_m: d.startX_m,
            from_y_m: d.startY_m,
            to_x_m: d.curX_m,
            to_y_m: d.curY_m,
            kind,
            color,
            label_ar: label,
          },
        ]);
      }
    }
  };

  // Master Canvas Render Effect
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !blueprint) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const W = cvs.width;
    const H = cvs.height;
    const pad = 24;
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
    ctx.lineWidth = 1.5;
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

    // 3. Built-in Tactical Zones (Zone 14 & Half-Spaces) + Custom / AI Zones
    for (const tz of blueprint.tactical_zones) {
      const x1 = pad + (Math.min(tz.x1_m, tz.x2_m) / 105) * pw;
      const x2 = pad + (Math.max(tz.x1_m, tz.x2_m) / 105) * pw;
      const y1 = pad + (tz.y1_m / 68) * ph;
      const y2 = pad + (tz.y2_m / 68) * ph;
      const isZ14 = tz.zone_id === "zone_14";

      ctx.save();
      ctx.fillStyle = isZ14 ? "rgba(245, 158, 11, 0.12)" : "rgba(56, 189, 248, 0.06)";
      ctx.strokeStyle = isZ14 ? "rgba(250, 204, 21, 0.45)" : "rgba(56, 189, 248, 0.25)";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = isZ14 ? 1.5 : 1.0;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.setLineDash([]);
      ctx.fillStyle = isZ14 ? "#FACC15" : "#7DD3FC";
      ctx.font = "700 9.5px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(tz.label_ar, (x1 + x2) / 2, y1 + 11);
      ctx.restore();
    }

    for (const cz of userZones) {
      const x1 = pad + (Math.min(cz.x1_m, cz.x2_m) / 105) * pw;
      const x2 = pad + (Math.max(cz.x1_m, cz.x2_m) / 105) * pw;
      const y1 = pad + (Math.min(cz.y1_m, cz.y2_m) / 68) * ph;
      const y2 = pad + (Math.max(cz.y1_m, cz.y2_m) / 68) * ph;
      ctx.save();
      ctx.fillStyle = "rgba(16, 185, 129, 0.18)";
      ctx.strokeStyle = cz.color || "#10B981";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.setLineDash([]);
      ctx.fillStyle = "#6EE7B7";
      ctx.font = "700 10.5px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(cz.label_ar, (x1 + x2) / 2, y1 + 14);
      ctx.restore();
    }

    const hexA = blueprint.kit_colors?.team_a_hex || "#EF4444";
    const hexB = blueprint.kit_colors?.team_b_hex || "#38BDF8";

    // Helper to draw dynamic connected lines using the live dragged node positions!
    const drawTeamFormationLines = (
      linesSpec: FormationBlueprintPayload["lines"],
      liveNodes: BlueprintNode[],
      teamColor: string
    ) => {
      if (!showLines) return;
      const slotMap = new Map<string, { x_m: number; y_m: number }>();
      for (const n of liveNodes) {
        slotMap.set(n.slot, { x_m: n.x_m, y_m: n.y_m });
      }
      for (const ln of linesSpec) {
        const pts = ln.points.map((pt) => slotMap.get(pt.slot) || pt);
        if (pts.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = teamColor;
        ctx.globalAlpha = 0.72;
        ctx.lineWidth = 2.4;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        pts.forEach((pt, idx) => {
          const px = pad + (pt.x_m / 105) * pw;
          const py = pad + (pt.y_m / 68) * ph;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    };

    if (teamDisplay !== "team_b") {
      drawTeamFormationLines(blueprint.lines || [], nodesA, hexA);
    }
    if (teamDisplay !== "team_a" && blueprint.opponent_lines) {
      drawTeamFormationLines(blueprint.opponent_lines, nodesB, hexB);
    }

    // Helper to draw an arrow on the pitch
    const drawArrowVector = (
      fx_m: number,
      fy_m: number,
      tx_m: number,
      ty_m: number,
      color: string,
      dashed: boolean,
      label?: string
    ) => {
      const fx = pad + (fx_m / 105) * pw;
      const fy = pad + (fy_m / 68) * ph;
      const tx = pad + (tx_m / 105) * pw;
      const ty = pad + (ty_m / 68) * ph;
      if (Math.hypot(tx - fx, ty - fy) < 8) return;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      if (dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      const ang = Math.atan2(ty - fy, tx - fx);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 9 * Math.cos(ang - 0.42), ty - 9 * Math.sin(ang - 0.42));
      ctx.lineTo(tx - 9 * Math.cos(ang + 0.42), ty - 9 * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();

      if (label) {
        const mx = (fx + tx) * 0.5;
        const my = (fy + ty) * 0.5 - 6;
        ctx.font = "700 9.5px Inter, system-ui, sans-serif";
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(9, 13, 22, 0.85)";
        ctx.beginPath();
        ctx.roundRect(mx - tw / 2, my - 8, tw, 15, 4);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, mx, my);
      }
      ctx.restore();
    };

    // 4. Built-in Style Passing Arrows & User/AI Custom Arrows
    if (showPassVectors) {
      if (teamDisplay !== "team_b" && blueprint.passing_arrows) {
        for (const pa of blueprint.passing_arrows) {
          drawArrowVector(pa.from_x_m, pa.from_y_m, pa.to_x_m, pa.to_y_m, "#FACC15", true, pa.label_ar);
        }
      }
      if (teamDisplay !== "team_a" && blueprint.opponent_passing_arrows) {
        for (const pa of blueprint.opponent_passing_arrows) {
          drawArrowVector(pa.from_x_m, pa.from_y_m, pa.to_x_m, pa.to_y_m, "#38BDF8", true);
        }
      }
    }

    for (const ua of userArrows) {
      const col = ua.color || (ua.kind === "pass" ? "#FACC15" : ua.kind === "press" ? "#EF4444" : "#10B981");
      drawArrowVector(ua.from_x_m, ua.from_y_m, ua.to_x_m, ua.to_y_m, col, ua.kind === "pass", ua.label_ar);
    }

    // Active drag shape preview
    if (draftShapeRef.current) {
      const d = draftShapeRef.current;
      if (drawTool === "zone_box") {
        const x1 = pad + (Math.min(d.startX_m, d.curX_m) / 105) * pw;
        const x2 = pad + (Math.max(d.startX_m, d.curX_m) / 105) * pw;
        const y1 = pad + (Math.min(d.startY_m, d.curY_m) / 68) * ph;
        const y2 = pad + (Math.max(d.startY_m, d.curY_m) / 68) * ph;
        ctx.save();
        ctx.fillStyle = "rgba(16, 185, 129, 0.22)";
        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = 2;
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.restore();
      } else {
        const col = drawTool === "pass_arrow" ? "#FACC15" : drawTool === "press_arrow" ? "#EF4444" : "#10B981";
        drawArrowVector(d.startX_m, d.startY_m, d.curX_m, d.curY_m, col, drawTool === "pass_arrow");
      }
    }

    // Freehand strokes
    const allStrokes = activeStrokeRef.current ? [...freehandStrokes, activeStrokeRef.current] : freehandStrokes;
    for (const st of allStrokes) {
      if (st.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = st.color;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      st.points.forEach((pt, idx) => {
        const px = pad + (pt.x_m / 105) * pw;
        const py = pad + (pt.y_m / 68) * ph;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    // 5. Render Player Nodes for Team A and/or Team B
    const renderTeamNodes = (list: BlueprintNode[], tKey: "team_a" | "team_b", kitHex: string) => {
      for (const nd of list) {
        const px = pad + (nd.x_m / 105) * pw;
        const py = pad + (nd.y_m / 68) * ph;
        const tx = pad + (nd.move_to_x_m / 105) * pw;
        const ty = pad + (nd.move_to_y_m / 68) * ph;
        const nodeKey = `${tKey}:${nd.slot}`;
        const isSel = selectedNodeKey === nodeKey;

        // Player run vector
        if (Math.hypot(tx - px, ty - py) > 8) {
          drawArrowVector(
            nd.x_m,
            nd.y_m,
            nd.move_to_x_m,
            nd.move_to_y_m,
            isSel ? "#10B981" : tKey === "team_a" ? "rgba(255,255,255,0.65)" : "rgba(125,211,252,0.55)",
            false
          );
        }

        if (isSel) {
          ctx.save();
          ctx.strokeStyle = "#10B981";
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(px, py, 17, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 12.5, 0, Math.PI * 2);
        ctx.fillStyle = nd.slot === "GK" ? (tKey === "team_a" ? "#F59E0B" : "#22D3EE") : kitHex;
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = tKey === "team_a" ? "#FFFFFF" : "#0F172A";
        ctx.stroke();

        ctx.fillStyle = "#FFFFFF";
        ctx.font = "800 9.5px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(nd.jersey_number ? `${nd.jersey_number}` : nd.slot, px, py);

        const shortName = nd.player_label.replace(/\s*\([^)]*\)/g, "").slice(0, 14);
        const pillText = `${nd.slot} • ${shortName}`;
        ctx.font = "700 9.5px Inter, system-ui, sans-serif";
        const tw = ctx.measureText(pillText).width + 10;
        const labelOffsetY = tKey === "team_a" ? 15 : -29;
        ctx.fillStyle = tKey === "team_a" ? "rgba(9, 13, 22, 0.90)" : "rgba(15, 23, 42, 0.88)";
        ctx.beginPath();
        ctx.roundRect(px - tw / 2, py + labelOffsetY, tw, 15.5, 4);
        ctx.fill();
        ctx.strokeStyle = isSel ? "#10B981" : kitHex;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = isSel ? "#6EE7B7" : "#F8FAFC";
        ctx.fillText(pillText, px, py + labelOffsetY + 8);
        ctx.restore();
      }
    };

    if (teamDisplay !== "team_a") {
      renderTeamNodes(nodesB, "team_b", hexB);
    }
    if (teamDisplay !== "team_b") {
      renderTeamNodes(nodesA, "team_a", hexA);
    }
  }, [
    blueprint,
    nodesA,
    nodesB,
    teamDisplay,
    showLines,
    showPassVectors,
    userArrows,
    userZones,
    freehandStrokes,
    selectedNodeKey,
    drawTool,
  ]);

  const activeNode =
    [...nodesA.map((n) => ({ ...n, _t: "team_a" })), ...nodesB.map((n) => ({ ...n, _t: "team_b" }))].find(
      (n) => `${n._t}:${n.slot}` === selectedNodeKey
    ) ||
    nodesA[8] ||
    nodesA[0] ||
    null;

  return (
    <div className="studio-panel p-5 space-y-4">
      {/* Top Header: Title + Two-Team View Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-extrabold text-white">
              {isAr
                ? "مرسم الخطط التكتيكي الحر والذكاء الاصطناعي (22 لاعباً — الفريقان معاً بأي تشكيل وأي ستايل)"
                : "Freeform 22-Player Tactical Studio & AI Plan Drawer (Both Teams • Any Formation & Style)"}
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {isAr
              ? "اسحب أي لاعب من الفريقين بالماوس، أو ارسم أسهم التحرك والتمرير ومناطق الضغط بحرية، أو اكتب أي خطة ليرسمها الذكاء الاصطناعي فوراً."
              : "Drag any of the 22 players, draw custom run/pass/press arrows & zones freely, or ask the AI to draw any tactical plan."}
          </p>
        </div>

        {/* Display Both Teams vs Single Team */}
        <div className="flex items-center gap-1.5 bg-[#090D16] border border-white/[0.1] rounded-xl p-1 text-xs">
          <button
            type="button"
            onClick={() => setTeamDisplay("both")}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              teamDisplay === "both" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{isAr ? "الفريقان معاً (11 ضد 11)" : "Both Teams (11v11)"}</span>
          </button>
          <button
            type="button"
            onClick={() => setTeamDisplay("team_a")}
            className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
              teamDisplay === "team_a" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {blueprint?.team_name || (isAr ? "الفريق الأول" : "Team A")}
          </button>
          <button
            type="button"
            onClick={() => setTeamDisplay("team_b")}
            className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
              teamDisplay === "team_b" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {blueprint?.opponent_name || (isAr ? "الفريق الثاني" : "Team B")}
          </button>
        </div>
      </div>

      {/* AI Live Tactical Drawing Bar (Groq Llama-3.3-70B) */}
      <div className="p-3.5 rounded-xl bg-[#090D16] border border-emerald-500/35 space-y-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAskAiDraw();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-400 shrink-0">
            <Bot className="w-4 h-4" />
            <span>{isAr ? "ارسم بالذكاء الاصطناعي (Llama-3.3-70B):" : "AI Tactical Plan Drawer:"}</span>
          </div>
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={
              isAr
                ? "اكتب أي خطة وأي ستايل (مثال: ارسم خطة 3-5-2 للأهلي بأسلوب تيكي تاكا ضد 5-3-2 لإنبي مع أسهم اختراق للعمق)..."
                : "Describe any formation & tactical style for both teams to draw live on the pitch..."
            }
            className="flex-1 min-w-[240px] bg-[#111827] border border-white/[0.14] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={aiLoading || !aiPrompt.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-45 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{aiLoading ? (isAr ? "جاري الرسم..." : "Drawing...") : isAr ? "🎨 ارسم الخطة الآن" : "🎨 Draw Plan"}</span>
          </button>
        </form>

        {/* 1-Click AI Drawing Presets */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-400">{isAr ? "أمثلة رسم فوري:" : "Quick AI Prompts:"}</span>
          {[
            `ارسم خطة 4-3-3 بأسلوب تيكي تاكا ومثلثات استحواذ ضد 4-4-2 بتكتل دفاعي`,
            `ارسم خطة 3-5-2 بضغط عالي عكسي ومصيدة في المنطقة 14 ضد 5-3-2`,
            `ارسم خطة 4-2-3-1 بأظهرة عكسية تدخل لعمق الوسط وأسهم اختراق للأجنحة`,
            `ارسم خطة 3-4-2-1 بهجوم مرتد خاطف وتحولات عمودية خلف خط الدفاع`,
          ].map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setAiPrompt(preset);
                handleAskAiDraw(preset);
              }}
              className="px-2.5 py-1 rounded-lg bg-[#111827] hover:bg-emerald-500/15 border border-white/[0.08] hover:border-emerald-500/40 text-slate-300 hover:text-emerald-300 transition"
            >
              ✨ {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Two-Team Formation & Style Controls (Preset + Any Custom Formation Input!) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
        {/* Team A Control Box */}
        <div className="p-3 rounded-xl bg-[#090D16] border border-white/[0.08] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-white flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-full inline-block border border-white/40"
                style={{ backgroundColor: blueprint?.kit_colors?.team_a_hex || "#EF4444" }}
              />
              <span>{blueprint?.team_name || "Team A"} — {isAr ? "التشكيل والستايل:" : "Formation & Style:"}</span>
            </span>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={customInputA}
                onChange={(e) => setCustomInputA(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customInputA.trim()) setFormationA(customInputA.trim());
                }}
                placeholder="3-2-4-1"
                className="w-20 bg-[#111827] border border-white/[0.15] rounded px-2 py-0.5 text-xs font-bold text-emerald-300 text-center tabular-nums"
              />
              <button
                type="button"
                onClick={() => {
                  if (customInputA.trim()) setFormationA(customInputA.trim());
                }}
                className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold"
              >
                {isAr ? "تطبيق" : "Set"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESET_FORMATIONS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFormationA(f);
                  setCustomInputA(f);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold tabular-nums transition ${
                  formationA === f
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-[#111827] text-slate-300 border border-white/[0.08] hover:border-emerald-400/50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-slate-400 text-[11px]">{isAr ? "الستايل التكتيكي:" : "Style:"}</span>
            <select
              value={styleA}
              onChange={(e) => setStyleA(e.target.value)}
              className="flex-1 bg-[#111827] border border-white/[0.12] rounded-lg px-2 py-1 text-[11px] text-emerald-300 font-semibold"
            >
              {TACTICAL_STYLES.map((st) => (
                <option key={st.id} value={st.id}>
                  {isAr ? st.ar : st.en}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Team B Control Box */}
        <div className="p-3 rounded-xl bg-[#090D16] border border-white/[0.08] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-white flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-full inline-block border border-white/40"
                style={{ backgroundColor: blueprint?.kit_colors?.team_b_hex || "#38BDF8" }}
              />
              <span>{blueprint?.opponent_name || "Team B"} — {isAr ? "التشكيل والستايل:" : "Formation & Style:"}</span>
            </span>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={customInputB}
                onChange={(e) => setCustomInputB(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customInputB.trim()) setFormationB(customInputB.trim());
                }}
                placeholder="5-3-2"
                className="w-20 bg-[#111827] border border-white/[0.15] rounded px-2 py-0.5 text-xs font-bold text-sky-300 text-center tabular-nums"
              />
              <button
                type="button"
                onClick={() => {
                  if (customInputB.trim()) setFormationB(customInputB.trim());
                }}
                className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[11px] font-bold"
              >
                {isAr ? "تطبيق" : "Set"}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESET_FORMATIONS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFormationB(f);
                  setCustomInputB(f);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold tabular-nums transition ${
                  formationB === f
                    ? "bg-sky-400 text-slate-950"
                    : "bg-[#111827] text-slate-300 border border-white/[0.08] hover:border-sky-400/50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <span className="text-slate-400 text-[11px]">{isAr ? "الستايل التكتيكي:" : "Style:"}</span>
            <select
              value={styleB}
              onChange={(e) => setStyleB(e.target.value)}
              className="flex-1 bg-[#111827] border border-white/[0.12] rounded-lg px-2 py-1 text-[11px] text-sky-300 font-semibold"
            >
              {TACTICAL_STYLES.map((st) => (
                <option key={st.id} value={st.id}>
                  {isAr ? st.ar : st.en}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Freeform Interactive Drawing Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-[#090D16] border border-white/[0.08] text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDrawTool("drag_player")}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              drawTool === "drag_player"
                ? "bg-emerald-500 text-slate-950"
                : "bg-[#111827] text-slate-300 border border-white/[0.08]"
            }`}
          >
            <Hand className="w-3.5 h-3.5" />
            <span>{isAr ? "✋ سحب وتحريك اللاعبين" : "✋ Drag Players"}</span>
          </button>
          <button
            type="button"
            onClick={() => setDrawTool("run_arrow")}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              drawTool === "run_arrow"
                ? "bg-emerald-500 text-slate-950"
                : "bg-[#111827] text-slate-300 border border-white/[0.08]"
            }`}
          >
            <MoveUpRight className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isAr ? "↗️ رسم سهم تحرك" : "↗️ Run Arrow"}</span>
          </button>
          <button
            type="button"
            onClick={() => setDrawTool("pass_arrow")}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              drawTool === "pass_arrow"
                ? "bg-amber-400 text-slate-950"
                : "bg-[#111827] text-slate-300 border border-white/[0.08]"
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>{isAr ? "⚡ رسم سهم تمريرة" : "⚡ Pass Arrow"}</span>
          </button>
          <button
            type="button"
            onClick={() => setDrawTool("press_arrow")}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              drawTool === "press_arrow"
                ? "bg-rose-500 text-white"
                : "bg-[#111827] text-slate-300 border border-white/[0.08]"
            }`}
          >
            <MoveUpRight className="w-3.5 h-3.5 text-rose-400" />
            <span>{isAr ? "🎯 سهم ضغط عكسي" : "🎯 Press Arrow"}</span>
          </button>
          <button
            type="button"
            onClick={() => setDrawTool("zone_box")}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              drawTool === "zone_box"
                ? "bg-sky-400 text-slate-950"
                : "bg-[#111827] text-slate-300 border border-white/[0.08]"
            }`}
          >
            <Square className="w-3.5 h-3.5 text-sky-400" />
            <span>{isAr ? "🟦 رسم منطقة تكتيكية" : "🟦 Tactical Zone"}</span>
          </button>
          <button
            type="button"
            onClick={() => setDrawTool("freehand")}
            className={`px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              drawTool === "freehand"
                ? "bg-amber-400 text-slate-950"
                : "bg-[#111827] text-slate-300 border border-white/[0.08]"
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>{isAr ? "✏️ قلم رسم حر" : "✏️ Freehand Pen"}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowLines((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] font-semibold ${
              showLines
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                : "bg-[#111827] border-white/10 text-slate-400"
            }`}
          >
            {isAr ? "خطوط التشكيل" : "Formation Lines"}
          </button>
          <button
            type="button"
            onClick={() => setShowPassVectors((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] font-semibold ${
              showPassVectors
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                : "bg-[#111827] border-white/10 text-slate-400"
            }`}
          >
            {isAr ? "مسارات التمرير" : "Pass Vectors"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (freehandStrokes.length > 0) {
                setFreehandStrokes((p) => p.slice(0, -1));
              } else if (userArrows.length > 0) {
                setUserArrows((p) => p.slice(0, -1));
              } else if (userZones.length > 0) {
                setUserZones((p) => p.slice(0, -1));
              }
            }}
            className="p-1.5 rounded-lg bg-[#111827] hover:bg-white/10 border border-white/10 text-slate-300"
            title={isAr ? "تراجع عن آخر رسم" : "Undo last drawing"}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setUserArrows([]);
              setUserZones([]);
              setFreehandStrokes([]);
              if (blueprint) {
                setNodesA(blueprint.nodes || []);
                setNodesB(blueprint.opponent_nodes || []);
              }
            }}
            className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-[11px] font-semibold flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            <span>{isAr ? "إعادة ضبط الملعب" : "Reset Board"}</span>
          </button>
        </div>
      </div>

      {/* Main 22-Player Canvas + Side Tactical Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 rounded-xl overflow-hidden border border-white/[0.12] bg-[#061A13] shadow-xl">
          <canvas
            ref={canvasRef}
            width={760}
            height={470}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`w-full block ${
              drawTool === "drag_player" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
            }`}
          />
        </div>

        {blueprint && (
          <div className="lg:col-span-4 space-y-3 text-xs">
            <div className="p-3.5 rounded-xl bg-[#090D16] border border-emerald-500/30 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-emerald-300">{blueprint.title_ar}</span>
                {blueprint.ai_provider && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    AI
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{blueprint.philosophy_ar}</p>
            </div>

            {activeNode && (
              <div className="p-3.5 rounded-xl bg-[#090D16] border border-sky-500/30 space-y-1.5">
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
                    ? `الإحداثي الحالي: (X=${activeNode.x_m}م، Y=${activeNode.y_m}م) ← هدف التحرك: (X=${activeNode.move_to_x_m}م، Y=${activeNode.move_to_y_m}م)`
                    : `Current: (${activeNode.x_m}m, ${activeNode.y_m}m) -> Move: (${activeNode.move_to_x_m}m, ${activeNode.move_to_y_m}m)`}
                </div>
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-[#090D16] border border-white/[0.08] space-y-1.5">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>{isAr ? "خطوات تنفيذ الخطة للفريقين على الملعب:" : "Execution Steps:"}</span>
              </div>
              <div className="space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                {blueprint.execution_steps_ar.map((step, i) => (
                  <div key={i} className="border-b border-white/[0.05] pb-1.5 last:border-0">
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
