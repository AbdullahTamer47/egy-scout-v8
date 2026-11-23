"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Bot,
  Compass,
  Download,
  FolderOpen,
  Hand,
  MoveUpRight,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  UserMinus,
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

const GROQ_AI_MODELS = [
  { id: "openai/gpt-oss-120b", ar: "GPT-OSS 120B (الأقوى للخطط المبتكرة)", en: "GPT-OSS 120B (Flagship)" },
  { id: "qwen/qwen3.8-27b", ar: "Qwen 3.8 27B (ذكي وسريع)", en: "Qwen 3.8 27B (Fast Arabic)" },
  { id: "openai/gpt-oss-20b", ar: "GPT-OSS 20B (فائق السرعة)", en: "GPT-OSS 20B (Turbo)" },
  { id: "allam-2-7b", ar: "ALLaM 2 7B (نموذج عربي)", en: "ALLaM 2 7B (Arabic)" },
];

const DRAW_COLORS = [
  { hex: "#10B981", label: "أخضر تكتيكي" },
  { hex: "#FACC15", label: "أصفر تمرير" },
  { hex: "#EF4444", label: "أحمر ضغط" },
  { hex: "#38BDF8", label: "أزرق سماوي" },
  { hex: "#A855F7", label: "بنفسجي منطقة 14" },
  { hex: "#FFFFFF", label: "أبيض صريح" },
];

interface SavedTacticalPlan {
  id: string;
  name: string;
  savedAt: string;
  formationA: string;
  formationB: string;
  styleA: string;
  styleB: string;
  titleAr: string;
  philosophyAr: string;
  stepsAr: string[];
  nodesA: BlueprintNode[];
  nodesB: BlueprintNode[];
  userArrows: BlueprintPassingArrow[];
  userZones: BlueprintCustomZone[];
  freehandStrokes: FreehandStroke[];
}

const SAVED_PLANS_KEY = "egy_scout_saved_tactical_plans_v1";

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
  const [selectedNode, setSelectedNode] = useState<{ team: "team_a" | "team_b"; index: number }>({
    team: "team_a",
    index: 8,
  });

  // Full Drawing Style & Plan Editor State
  const [drawColor, setDrawColor] = useState<string>("#10B981");
  const [drawDashed, setDrawDashed] = useState<boolean>(false);
  const [editingPlanText, setEditingPlanText] = useState<boolean>(false);
  const [savedPlans, setSavedPlans] = useState<SavedTacticalPlan[]>([]);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  // AI Live Drawing Prompt + Multi-Model Picker
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiModel, setAiModel] = useState<string>("openai/gpt-oss-120b");
  const [aiLoading, setAiLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const skipNextFetchRef = useRef<boolean>(false);
  const draggingNodeRef = useRef<{ team: "team_a" | "team_b"; index: number; mode: "body" | "arrow_tip" } | null>(null);
  const draftShapeRef = useRef<{ startX_m: number; startY_m: number; curX_m: number; curY_m: number } | null>(null);
  const activeStrokeRef = useRef<FreehandStroke | null>(null);
  const [, setRenderTick] = useState(0);

  // Load saved custom tactical plans from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_PLANS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setSavedPlans(parsed);
      }
    } catch {}
  }, []);

  // Sync when externalBlueprint arrives from AI Chatbot (preserve custom AI coordinates!)
  useEffect(() => {
    if (externalBlueprint) {
      skipNextFetchRef.current = true;
      setBlueprint(externalBlueprint);
      setNodesA(externalBlueprint.nodes || []);
      setNodesB(externalBlueprint.opponent_nodes || []);
      setFormationA(externalBlueprint.formation_code);
      setCustomInputA(externalBlueprint.formation_code);
      if (externalBlueprint.opponent_formation_code) {
        setFormationB(externalBlueprint.opponent_formation_code);
        setCustomInputB(externalBlueprint.opponent_formation_code);
      }
      if (externalBlueprint.tactical_mode) {
        setStyleA(externalBlueprint.tactical_mode);
      }
      setUserArrows(externalBlueprint.custom_arrows || []);
      setUserZones(externalBlueprint.custom_zones || []);
      setTeamDisplay("both");
    }
  }, [externalBlueprint]);

  // Fetch 22-player two-team blueprint from backend whenever formations or styles change
  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }
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
            model: aiModel,
          }),
        },
        "club_demo_egypt",
        role
      );
      skipNextFetchRef.current = true;
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
      setUserArrows(res.custom_arrows || []);
      setUserZones(res.custom_zones || []);
      setTeamDisplay("both");
    } catch {} finally {
      setAiLoading(false);
    }
  };

  // Update a field on any player of Team A (own club) or Team B (opponent)
  const updateNodeField = (
    team: "team_a" | "team_b",
    index: number,
    patch: Partial<BlueprintNode>
  ) => {
    const setter = team === "team_a" ? setNodesA : setNodesB;
    setter((prev) => prev.map((n, idx) => (idx === index ? { ...n, ...patch } : n)));
  };

  const addPlayerToTeam = (team: "team_a" | "team_b") => {
    const isA = team === "team_a";
    const list = isA ? nodesA : nodesB;
    const nextNum = Math.max(1, ...list.map((n) => Number(n.jersey_number || 0))) + 1;
    const newNode: BlueprintNode = {
      slot: isA ? `SUB${list.length + 1}` : `OPP${list.length + 1}`,
      role_ar: isA ? "لاعب مضاف (تكتيك خاص)" : "لاعب خصم مضاف",
      x_m: isA ? 52.0 : 58.0,
      y_m: 34.0,
      move_to_x_m: isA ? 64.0 : 46.0,
      move_to_y_m: 34.0,
      duty_ar: isA ? "تحرك حر وتفوق عددي حسب تعليمات المدرب" : "مراقبة وتضييق المساحات",
      player_label: isA ? `لاعب جديد #${nextNum}` : `لاعب خصم #${nextNum}`,
      jersey_number: nextNum,
      track_id: null,
      team,
    };
    if (isA) {
      setNodesA((prev) => [...prev, newNode]);
      setSelectedNode({ team: "team_a", index: list.length });
    } else {
      setNodesB((prev) => [...prev, newNode]);
      setSelectedNode({ team: "team_b", index: list.length });
    }
  };

  const removeSelectedPlayer = () => {
    const { team, index } = selectedNode;
    if (team === "team_a" && nodesA.length > 1) {
      setNodesA((prev) => prev.filter((_, i) => i !== index));
      setSelectedNode({ team: "team_a", index: Math.max(0, index - 1) });
    } else if (team === "team_b" && nodesB.length > 1) {
      setNodesB((prev) => prev.filter((_, i) => i !== index));
      setSelectedNode({ team: "team_b", index: Math.max(0, index - 1) });
    }
  };

  const handleDownloadPng = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const url = cvs.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    const cleanA = formationA.replace(/[^0-9A-Za-z-]/g, "");
    const cleanB = formationB.replace(/[^0-9A-Za-z-]/g, "");
    a.download = `egy-scout-plan-${cleanA}-vs-${cleanB}.png`;
    a.click();
  };

  const handleSaveCurrentPlan = () => {
    const planName =
      blueprint?.title_ar || `${blueprint?.team_name || "Team A"} (${formationA}) × (${formationB})`;
    const item: SavedTacticalPlan = {
      id: `plan-${Date.now()}`,
      name: planName.slice(0, 65),
      savedAt: new Date().toLocaleTimeString(isAr ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }),
      formationA,
      formationB,
      styleA,
      styleB,
      titleAr: blueprint?.title_ar || planName,
      philosophyAr: blueprint?.philosophy_ar || "",
      stepsAr: blueprint?.execution_steps_ar || [],
      nodesA,
      nodesB,
      userArrows,
      userZones,
      freehandStrokes,
    };
    const next = [item, ...savedPlans].slice(0, 12);
    setSavedPlans(next);
    try {
      localStorage.setItem(SAVED_PLANS_KEY, JSON.stringify(next));
      setSaveBanner(isAr ? "✅ تم حفظ الخطة بالكامل في جهازك!" : "✅ Plan saved locally!");
      setTimeout(() => setSaveBanner(null), 2600);
    } catch {}
  };

  const handleLoadSavedPlan = (plan: SavedTacticalPlan) => {
    skipNextFetchRef.current = true;
    setFormationA(plan.formationA);
    setCustomInputA(plan.formationA);
    setFormationB(plan.formationB);
    setCustomInputB(plan.formationB);
    setStyleA(plan.styleA);
    setStyleB(plan.styleB);
    setNodesA(plan.nodesA);
    setNodesB(plan.nodesB);
    setUserArrows(plan.userArrows || []);
    setUserZones(plan.userZones || []);
    setFreehandStrokes(plan.freehandStrokes || []);
    setBlueprint((prev) =>
      prev
        ? {
            ...prev,
            formation_code: plan.formationA,
            opponent_formation_code: plan.formationB,
            title_ar: plan.titleAr,
            philosophy_ar: plan.philosophyAr,
            execution_steps_ar: plan.stepsAr,
          }
        : prev
    );
    setTeamDisplay("both");
  };

  const handleDeleteSavedPlan = (id: string) => {
    const next = savedPlans.filter((p) => p.id !== id);
    setSavedPlans(next);
    try {
      localStorage.setItem(SAVED_PLANS_KEY, JSON.stringify(next));
    } catch {}
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
      // 1. Check if clicking the selected player's arrow tip handle first (to resize/re-aim run arrow!)
      const selList = selectedNode.team === "team_a" ? nodesA : nodesB;
      const selNd = selList[selectedNode.index];
      if (
        selNd &&
        Math.hypot(selNd.move_to_x_m - xm, selNd.move_to_y_m - ym) <= 3.8 &&
        Math.hypot(selNd.move_to_x_m - selNd.x_m, selNd.move_to_y_m - selNd.y_m) >= 2.0
      ) {
        draggingNodeRef.current = { team: selectedNode.team, index: selectedNode.index, mode: "arrow_tip" };
        return;
      }

      // 2. Find nearest player node from visible teams within 4.8m
      let bestHit: { team: "team_a" | "team_b"; index: number; dist: number } | null = null;
      if (teamDisplay !== "team_b") {
        nodesA.forEach((nd, idx) => {
          const d = Math.hypot(nd.x_m - xm, nd.y_m - ym);
          if (d <= 4.8 && (!bestHit || d < bestHit.dist)) {
            bestHit = { team: "team_a", index: idx, dist: d };
          }
        });
      }
      if (teamDisplay !== "team_a") {
        nodesB.forEach((nd, idx) => {
          const d = Math.hypot(nd.x_m - xm, nd.y_m - ym);
          if (d <= 4.8 && (!bestHit || d < bestHit.dist)) {
            bestHit = { team: "team_b", index: idx, dist: d };
          }
        });
      }
      if (bestHit) {
        const hit = bestHit as { team: "team_a" | "team_b"; index: number };
        draggingNodeRef.current = { team: hit.team, index: hit.index, mode: "body" };
        setSelectedNode({ team: hit.team, index: hit.index });
      }
      return;
    }

    if (drawTool === "freehand") {
      activeStrokeRef.current = {
        color: drawColor,
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
      const { team, index, mode } = draggingNodeRef.current;
      const setter = team === "team_a" ? setNodesA : setNodesB;
      if (mode === "arrow_tip") {
        setter((prev) =>
          prev.map((n, idx) =>
            idx === index ? { ...n, move_to_x_m: xm, move_to_y_m: ym } : n
          )
        );
      } else {
        setter((prev) =>
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
            color: drawColor,
            label_ar: isAr ? "منطقة ضغط / تفوق تكتيكي" : "Tactical Zone",
          },
        ]);
      } else {
        const kind = drawTool === "pass_arrow" ? "pass" : drawTool === "press_arrow" ? "press" : "run";
        const color = drawColor;
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
            kind: drawDashed ? "pass" : kind,
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
        ctx.fillStyle = `${drawColor}33`;
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = 2;
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.restore();
      } else {
        drawArrowVector(
          d.startX_m,
          d.startY_m,
          d.curX_m,
          d.curY_m,
          drawColor,
          drawDashed || drawTool === "pass_arrow"
        );
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
      list.forEach((nd, idx) => {
        const px = pad + (nd.x_m / 105) * pw;
        const py = pad + (nd.y_m / 68) * ph;
        const tx = pad + (nd.move_to_x_m / 105) * pw;
        const ty = pad + (nd.move_to_y_m / 68) * ph;
        const isSel = selectedNode.team === tKey && selectedNode.index === idx;

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
          // Draggable glowing tip handle on selected player's run arrow!
          if (isSel) {
            ctx.save();
            ctx.fillStyle = "#FACC15";
            ctx.strokeStyle = "#090D16";
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.arc(tx, ty, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
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
      });
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
    selectedNode,
    drawTool,
    drawColor,
    drawDashed,
  ]);

  const activeNodeList = selectedNode.team === "team_a" ? nodesA : nodesB;
  const activeNode = activeNodeList[selectedNode.index] || nodesA[0] || nodesB[0] || null;
  const activeNodeTeam: "team_a" | "team_b" = activeNodeList[selectedNode.index]
    ? selectedNode.team
    : nodesA[0]
    ? "team_a"
    : "team_b";
  const activeNodeIdx = activeNodeList[selectedNode.index] ? selectedNode.index : 0;

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

      {/* AI Live Tactical Drawing Bar (Multi-Model Groq — Custom/Crazy Formations!) */}
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
            <span>{isAr ? "ابتكر وارسم بالـ AI:" : "AI Tactical Drawer:"}</span>
          </div>
          <select
            aria-label={isAr ? "اختيار موديل الذكاء الاصطناعي" : "Select AI Model"}
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            className="bg-[#111827] border border-emerald-500/35 rounded-lg px-2.5 py-2 text-[11px] font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
          >
            {GROQ_AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {isAr ? m.ar : m.en}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={
              isAr
                ? "اكتب أي خطة عادية أو مجنونة لم تُلعب من قبل (مثال: خطة 2-1-6-1 بحارس ليبرو في خط النص وهجوم كاسح على اليسار)..."
                : "Describe any custom, wild, or never-seen-before formation for both teams to draw live..."
            }
            className="flex-1 min-w-[240px] bg-[#111827] border border-white/[0.14] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={aiLoading || !aiPrompt.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-45 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{aiLoading ? (isAr ? "جاري ابتكار ورسم الـ 22 لاعباً..." : "Drawing 22 players...") : isAr ? "🎨 ارسم الخطة الآن" : "🎨 Draw Plan"}</span>
          </button>
        </form>

        {/* 1-Click AI Drawing Presets (Including Wild/Innovative Formations!) */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-400">{isAr ? "أمثلة ابتكار ورسم فوري:" : "Quick AI Prompts:"}</span>
          {[
            `ابتكر خطة مجنونة 2-1-6-1 بحارس ليبرو في منتصف الملعب وهجوم كاسح على الجبهة اليسرى`,
            `اخترع خطة غير متماثلة بتكديس 7 لاعبين على الجبهة اليمنى لعزل الخصم تماماً`,
            `ارسم خطة 3-5-2 بأسلوب تيكي تاكا ومثلثات استحواذ ضد 5-3-2 مع اختراق المنطقة 14`,
            `ارسم خطة 4-3-3 بضغط عالي عكسي ومصيدة ضغط على الأطراف ضد 4-4-2`,
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

      {/* Freeform Interactive Drawing Toolbar + Full Color/Style/Save/Export Bar */}
      <div className="space-y-2 p-2.5 rounded-xl bg-[#090D16] border border-white/[0.08] text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
              <span>{isAr ? "✋ تحريك اللاعبين ورأس السهم" : "✋ Drag Players & Arrow Tips"}</span>
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
              <span>{isAr ? "↗️ سهم تحرك" : "↗️ Run Arrow"}</span>
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
              <span>{isAr ? "⚡ سهم تمريرة" : "⚡ Pass Arrow"}</span>
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
              <span>{isAr ? "🎯 سهم ضغط" : "🎯 Press Arrow"}</span>
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
              <span>{isAr ? "🟦 منطقة تكتيكية" : "🟦 Tactical Zone"}</span>
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
              <span>{isAr ? "✏️ قلم حر" : "✏️ Freehand"}</span>
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
              {isAr ? "خطوط التشكيل" : "Lines"}
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
              {isAr ? "مسارات التمرير" : "Passes"}
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
              className="px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-[11px] font-semibold flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>{isAr ? "إعادة ضبط" : "Reset"}</span>
            </button>
          </div>
        </div>

        {/* Row 2: Color Swatches, Dashed/Solid, Add Players to Own Club / Opponent, Save & Export PNG */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06] text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">{isAr ? "لون الرسم:" : "Color:"}</span>
            <div className="flex items-center gap-1">
              {DRAW_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setDrawColor(c.hex)}
                  title={c.label}
                  className={`w-5 h-5 rounded-full border-2 transition ${
                    drawColor === c.hex ? "border-white scale-110 shadow" : "border-white/25 opacity-75 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDrawDashed((d) => !d)}
              className={`px-2 py-0.5 rounded border font-semibold ${
                drawDashed
                  ? "bg-amber-500/20 border-amber-400/50 text-amber-300"
                  : "bg-[#111827] border-white/10 text-slate-300"
              }`}
            >
              {drawDashed ? (isAr ? "خط متقطع (---)" : "Dashed") : isAr ? "خط متصل (───)" : "Solid"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => addPlayerToTeam("team_a")}
              className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 font-bold flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>{isAr ? `+ لاعب لـ ${blueprint?.team_name || "فريقي"}` : "+ Add Own Player"}</span>
            </button>
            <button
              type="button"
              onClick={() => addPlayerToTeam("team_b")}
              className="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-300 font-bold flex items-center gap-1"
            >
              <Plus className="w-3 h-3" />
              <span>{isAr ? `+ لاعب لـ ${blueprint?.opponent_name || "الخصم"}` : "+ Add Opponent"}</span>
            </button>
            <button
              type="button"
              onClick={handleSaveCurrentPlan}
              className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/40 text-indigo-200 font-bold flex items-center gap-1"
            >
              <Save className="w-3 h-3" />
              <span>{isAr ? "💾 حفظ الخطة" : "💾 Save"}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPng}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-bold flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              <span>{isAr ? "📥 تحميل PNG" : "📥 Export PNG"}</span>
            </button>
          </div>
        </div>

        {saveBanner && <div className="text-[11px] font-bold text-emerald-400 px-1">{saveBanner}</div>}

        {/* Saved Plans Strip (if any) */}
        {savedPlans.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-white/[0.06] text-[11px]">
            <span className="text-slate-400 flex items-center gap-1">
              <FolderOpen className="w-3 h-3 text-indigo-300" />
              {isAr ? "خططي المحفوظة:" : "Saved Plans:"}
            </span>
            {savedPlans.map((sp) => (
              <div
                key={sp.id}
                className="inline-flex items-center gap-1 bg-[#111827] border border-white/[0.1] rounded-lg px-2 py-0.5"
              >
                <button
                  type="button"
                  onClick={() => handleLoadSavedPlan(sp)}
                  className="text-slate-200 hover:text-emerald-300 font-semibold"
                >
                  {sp.name} (<bdi dir="ltr">{sp.formationA}</bdi>)
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSavedPlan(sp.id)}
                  className="text-rose-400 hover:text-rose-300 ps-1"
                  title={isAr ? "حذف الخطة المحفوظة" : "Delete saved plan"}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Quick Delete Chips for Individual Arrows & Zones */}
        {(userArrows.length > 0 || userZones.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-white/[0.06] text-[10px]">
            <span className="text-slate-400">{isAr ? "العناصر المرسومة (اضغط × لحذف عنصر):" : "Drawn items:"}</span>
            {userArrows.map((arw, i) => (
              <button
                key={`arw-${i}`}
                type="button"
                onClick={() => setUserArrows((prev) => prev.filter((_, idx) => idx !== i))}
                className="px-2 py-0.5 rounded bg-[#111827] border border-white/10 hover:border-rose-400 text-slate-300 hover:text-rose-300"
              >
                ↗ {arw.label_ar || `سهم #${i + 1}`} ×
              </button>
            ))}
            {userZones.map((zn, i) => (
              <button
                key={`zn-${i}`}
                type="button"
                onClick={() => setUserZones((prev) => prev.filter((_, idx) => idx !== i))}
                className="px-2 py-0.5 rounded bg-[#111827] border border-white/10 hover:border-rose-400 text-slate-300 hover:text-rose-300"
              >
                🟦 {zn.label_ar || `منطقة #${i + 1}`} ×
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main 22-Player Canvas + Full-Control Side Editor */}
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
          <div className="px-3 py-1.5 bg-[#090D16] border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-slate-400">
            <span>
              {isAr
                ? "💡 اسحب دائرة أي لاعب من ناديك أو الخصم لتغيير مكانه، واسحب النقطة الصفراء في رأس السهم لتوجيه تحركه!"
                : "💡 Drag any player circle (both teams) to reposition, and drag the yellow arrow-tip dot to aim their run!"}
            </span>
            <span className="tabular-nums text-emerald-400 font-semibold">
              <bdi dir="ltr">{formationA}</bdi> vs <bdi dir="ltr">{formationB}</bdi>
            </span>
          </div>
        </div>

        {blueprint && (
          <div className="lg:col-span-4 space-y-3 text-xs">
            {/* Editable Plan Title & Philosophy */}
            <div className="p-3.5 rounded-xl bg-[#090D16] border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-emerald-300">{blueprint.title_ar}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {blueprint.ai_provider && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      {blueprint.ai_provider}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingPlanText((v) => !v)}
                    className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.14] text-[10px] text-slate-200 font-semibold"
                  >
                    {editingPlanText ? (isAr ? "إغلاق التعديل" : "Done") : isAr ? "✏️ تعديل الخطة" : "✏️ Edit"}
                  </button>
                </div>
              </div>
              {editingPlanText ? (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    value={blueprint.title_ar}
                    onChange={(e) =>
                      setBlueprint((prev) => (prev ? { ...prev, title_ar: e.target.value } : prev))
                    }
                    className="w-full bg-[#111827] border border-white/15 rounded px-2 py-1 text-[11px] text-white"
                    placeholder={isAr ? "عنوان الخطة" : "Plan title"}
                  />
                  <textarea
                    rows={2}
                    value={blueprint.philosophy_ar}
                    onChange={(e) =>
                      setBlueprint((prev) => (prev ? { ...prev, philosophy_ar: e.target.value } : prev))
                    }
                    className="w-full bg-[#111827] border border-white/15 rounded px-2 py-1 text-[11px] text-slate-200"
                    placeholder={isAr ? "فلسفة الخطة..." : "Tactical philosophy..."}
                  />
                </div>
              ) : (
                <p className="text-[11px] text-slate-300 leading-relaxed">{blueprint.philosophy_ar}</p>
              )}
            </div>

            {/* Full Player Inspector & Live Editor (Works for BOTH Own Club AND Opponent!) */}
            {activeNode && (
              <div className="p-3.5 rounded-xl bg-[#090D16] border border-sky-500/35 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{
                        backgroundColor:
                          activeNodeTeam === "team_a"
                            ? blueprint.kit_colors?.team_a_hex || "#EF4444"
                            : blueprint.kit_colors?.team_b_hex || "#38BDF8",
                      }}
                    />
                    <span className="font-extrabold text-white">
                      {isAr ? "محرر اللاعب" : "Player Editor"} (
                      {activeNodeTeam === "team_a" ? blueprint.team_name : blueprint.opponent_name})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={removeSelectedPlayer}
                    className="px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 text-[10px] font-bold flex items-center gap-1"
                  >
                    <UserMinus className="w-3 h-3" />
                    <span>{isAr ? "حذف اللاعب" : "Remove"}</span>
                  </button>
                </div>

                {/* Quick Player Picker Dropdown across BOTH Teams */}
                <select
                  aria-label={isAr ? "اختر أي لاعب من الفريقين للتعديل" : "Pick any player to edit"}
                  value={`${activeNodeTeam}:${activeNodeIdx}`}
                  onChange={(e) => {
                    const [t, iStr] = e.target.value.split(":");
                    setSelectedNode({ team: t as "team_a" | "team_b", index: Number(iStr) });
                  }}
                  className="w-full bg-[#111827] border border-white/[0.12] rounded-lg px-2 py-1 text-[11px] text-sky-300 font-bold"
                >
                  <optgroup label={`🔴 ${blueprint.team_name || "فريقي"} (${nodesA.length})`}>
                    {nodesA.map((n, i) => (
                      <option key={`a-${i}`} value={`team_a:${i}`}>
                        #{n.jersey_number ?? i + 1} • {n.slot} — {n.player_label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={`🔵 ${blueprint.opponent_name || "الخصم"} (${nodesB.length})`}>
                    {nodesB.map((n, i) => (
                      <option key={`b-${i}`} value={`team_b:${i}`}>
                        #{n.jersey_number ?? i + 1} • {n.slot} — {n.player_label}
                      </option>
                    ))}
                  </optgroup>
                </select>

                {/* Editable Fields: Name, Number, Slot, Role, Duty */}
                <div className="grid grid-cols-12 gap-1.5 text-[11px]">
                  <div className="col-span-6">
                    <label className="text-[10px] text-slate-400 block mb-0.5">{isAr ? "اسم اللاعب" : "Name"}</label>
                    <input
                      type="text"
                      value={activeNode.player_label}
                      onChange={(e) =>
                        updateNodeField(activeNodeTeam, activeNodeIdx, { player_label: e.target.value })
                      }
                      className="w-full bg-[#111827] border border-white/15 rounded px-2 py-1 text-white font-semibold"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] text-slate-400 block mb-0.5">{isAr ? "الرقم" : "#"}</label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={activeNode.jersey_number ?? ""}
                      onChange={(e) =>
                        updateNodeField(activeNodeTeam, activeNodeIdx, {
                          jersey_number: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="w-full bg-[#111827] border border-white/15 rounded px-1.5 py-1 text-white text-center tabular-nums"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] text-slate-400 block mb-0.5">{isAr ? "المركز" : "Slot"}</label>
                    <input
                      type="text"
                      value={activeNode.slot}
                      onChange={(e) =>
                        updateNodeField(activeNodeTeam, activeNodeIdx, { slot: e.target.value.toUpperCase() })
                      }
                      className="w-full bg-[#111827] border border-white/15 rounded px-1.5 py-1 text-emerald-300 font-bold text-center"
                    />
                  </div>
                  <div className="col-span-12">
                    <label className="text-[10px] text-slate-400 block mb-0.5">{isAr ? "الدور التكتيكي" : "Role"}</label>
                    <input
                      type="text"
                      value={activeNode.role_ar}
                      onChange={(e) =>
                        updateNodeField(activeNodeTeam, activeNodeIdx, { role_ar: e.target.value })
                      }
                      className="w-full bg-[#111827] border border-white/15 rounded px-2 py-1 text-slate-200"
                    />
                  </div>
                  <div className="col-span-12">
                    <label className="text-[10px] text-slate-400 block mb-0.5">{isAr ? "الواجب / التعليمات" : "Duty"}</label>
                    <input
                      type="text"
                      value={activeNode.duty_ar}
                      onChange={(e) =>
                        updateNodeField(activeNodeTeam, activeNodeIdx, { duty_ar: e.target.value })
                      }
                      className="w-full bg-[#111827] border border-white/15 rounded px-2 py-1 text-slate-200"
                    />
                  </div>
                </div>

                {/* Live Coordinates & Arrow Target Reset */}
                <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-400 tabular-nums pt-1 border-t border-white/[0.06]">
                  <span>
                    {isAr
                      ? `موقعه: (${activeNode.x_m}م، ${activeNode.y_m}م) ← السهم: (${activeNode.move_to_x_m}م، ${activeNode.move_to_y_m}م)`
                      : `Pos: (${activeNode.x_m}, ${activeNode.y_m}) → (${activeNode.move_to_x_m}, ${activeNode.move_to_y_m})`}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateNodeField(activeNodeTeam, activeNodeIdx, {
                        move_to_x_m: activeNode.x_m,
                        move_to_y_m: activeNode.y_m,
                      })
                    }
                    className="text-amber-300 hover:underline font-semibold"
                  >
                    {isAr ? "إلغاء سهم اللاعب" : "Clear Run"}
                  </button>
                </div>
              </div>
            )}

            {/* Editable Execution Steps */}
            <div className="p-3.5 rounded-xl bg-[#090D16] border border-white/[0.08] space-y-1.5">
              <div className="font-semibold text-slate-200 flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>{isAr ? "خطوات تنفيذ الخطة للفريقين:" : "Execution Steps:"}</span>
                </span>
                {editingPlanText && (
                  <button
                    type="button"
                    onClick={() =>
                      setBlueprint((prev) =>
                        prev
                          ? {
                              ...prev,
                              execution_steps_ar: [
                                ...prev.execution_steps_ar,
                                `${prev.execution_steps_ar.length + 1}) تعليمات جديدة للمدرب...`,
                              ],
                            }
                          : prev
                      )
                    }
                    className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold"
                  >
                    + {isAr ? "إضافة خطوة" : "Add Step"}
                  </button>
                )}
              </div>
              <div className="space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                {blueprint.execution_steps_ar.map((step, i) =>
                  editingPlanText ? (
                    <div key={i} className="flex items-center gap-1">
                      <input
                        type="text"
                        value={step}
                        onChange={(e) =>
                          setBlueprint((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  execution_steps_ar: prev.execution_steps_ar.map((s, idx) =>
                                    idx === i ? e.target.value : s
                                  ),
                                }
                              : prev
                          )
                        }
                        className="flex-1 bg-[#111827] border border-white/15 rounded px-2 py-1 text-[11px] text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setBlueprint((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  execution_steps_ar: prev.execution_steps_ar.filter((_, idx) => idx !== i),
                                }
                              : prev
                          )
                        }
                        className="text-rose-400 px-1"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div key={i} className="border-b border-white/[0.05] pb-1.5 last:border-0">
                      {step}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
