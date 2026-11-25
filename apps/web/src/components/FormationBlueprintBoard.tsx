"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlignHorizontalJustifyCenter,
  Bot,
  Compass,
  Download,
  Film,
  FolderOpen,
  Hand,
  Magnet,
  MoveUpRight,
  Pause,
  Pencil,
  Play,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  UserMinus,
  Users,
  Zap,
} from "lucide-react";
import {
  API_BASE,
  apiFetch,
  BlueprintCustomZone,
  BlueprintNode,
  BlueprintPassingArrow,
  FormationBlueprintPayload,
  MathValidationResult,
  useGroqModels,
  UserRole,
} from "@/lib/api";
import GlossaryTooltip from "@/components/GlossaryTooltip";
import TacticalMathValidatorCard from "@/components/TacticalMathValidatorCard";

interface Props {
  lang: "ar" | "en";
  matchId: string;
  role: UserRole;
  defaultFormation?: string;
  team?: "team_a" | "team_b";
  externalBlueprint?: FormationBlueprintPayload | null;
  initialDrillNote?: string | null;
  onAttachBoardSlide?: (pngDataUrl: string) => void;
}

type DrawTool = "drag_player" | "run_arrow" | "pass_arrow" | "press_arrow" | "zone_box" | "freehand";
type TeamDisplayMode = "dual" | "both" | "team_a" | "team_b";
type PitchViewMode = "full" | "half" | "corner";

interface TrainingProp {
  id: string;
  kind: "cone" | "mini_goal" | "mannequin" | "ball";
  x_m: number;
  y_m: number;
}

interface BoardKeyframe {
  label: string;
  nodesA: BlueprintNode[];
  nodesB: BlueprintNode[];
  props: TrainingProp[];
}

interface BoardSnapshot {
  nodesA: BlueprintNode[];
  nodesB: BlueprintNode[];
  userArrows: BlueprintPassingArrow[];
  userZones: BlueprintCustomZone[];
  freehandStrokes: FreehandStroke[];
  trainingProps: TrainingProp[];
}

interface FreehandStroke {
  color: string;
  points: Array<{ x_m: number; y_m: number }>;
}

const PRESET_FORMATIONS = ["4-2-3-1", "4-3-3", "3-4-2-1", "3-5-2", "4-4-2", "5-3-2", "4-1-4-1", "4-2-2-2"];

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
  initialDrillNote = null,
  onAttachBoardSlide,
}: Props) {
  const isAr = lang === "ar";
  const [formationA, setFormationA] = useState(defaultFormation);
  const [formationB, setFormationB] = useState("4-4-2");
  const [customInputA, setCustomInputA] = useState(defaultFormation);
  const [customInputB, setCustomInputB] = useState("4-4-2");
  const [styleA, setStyleA] = useState("tiki_taka");
  const [styleB, setStyleB] = useState("balanced");
  const [teamDisplay, setTeamDisplay] = useState<TeamDisplayMode>("dual");
  const [drawTool, setDrawTool] = useState<DrawTool>("drag_player");
  const [showLines, setShowLines] = useState(true);
  const [showRunArrows, setShowRunArrows] = useState(true);
  const [showPassVectors, setShowPassVectors] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [showMiniCardsOnPitch, setShowMiniCardsOnPitch] = useState(false);

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

  // V8.5 Pro Lab State: Multi-Pitch Views, Snap-to-Grid, Training Props, 50-Step Undo/Redo, Keyframe Animation & Math Validator
  const [pitchView, setPitchView] = useState<PitchViewMode>("full");
  const [snapGrid, setSnapGrid] = useState<boolean>(false);
  const [trainingProps, setTrainingProps] = useState<TrainingProp[]>([
    { id: "ball-main", kind: "ball", x_m: 52.5, y_m: 34.0 },
  ]);
  const [keyframes, setKeyframes] = useState<BoardKeyframe[]>([]);
  const [activeKfIdx, setActiveKfIdx] = useState<number>(0);
  const [isAnimating, setIsAnimating] = useState<boolean>(false);
  const [animStepProgress, setAnimStepProgress] = useState<number>(0);
  const [recordingVideo, setRecordingVideo] = useState<boolean>(false);
  const [undoStack, setUndoStack] = useState<BoardSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<BoardSnapshot[]>([]);
  const [mathValidation, setMathValidation] = useState<MathValidationResult | null>(null);

  // AI Live Drawing Prompt + Auto Smart Router (raw models cleanly expandable!)
  const { models: groqModels } = useGroqModels(role);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiModel, setAiModel] = useState<string>("auto");
  const [showAdvancedModel, setShowAdvancedModel] = useState<boolean>(false);
  const [aiLoading, setAiLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasBRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const skipNextFetchRef = useRef<boolean>(false);
  const draggingNodeRef = useRef<
    { team: "team_a" | "team_b"; index: number; mode: "body" | "arrow_tip" } | { propId: string } | null
  >(null);
  const draftShapeRef = useRef<{ startX_m: number; startY_m: number; curX_m: number; curY_m: number } | null>(null);
  const activeStrokeRef = useRef<FreehandStroke | null>(null);
  const [, setRenderTick] = useState(0);

  const cloneSnap = (): BoardSnapshot => ({
    nodesA: nodesA.map((n) => ({ ...n })),
    nodesB: nodesB.map((n) => ({ ...n })),
    userArrows: userArrows.map((a) => ({ ...a })),
    userZones: userZones.map((z) => ({ ...z })),
    freehandStrokes: freehandStrokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
    trainingProps: trainingProps.map((p) => ({ ...p })),
  });

  const pushHistory = () => {
    setUndoStack((prev) => [...prev.slice(-49), cloneSnap()]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r.slice(-49), cloneSnap()]);
      setNodesA(last.nodesA);
      setNodesB(last.nodesB);
      setUserArrows(last.userArrows);
      setUserZones(last.userZones);
      setFreehandStrokes(last.freehandStrokes);
      setTrainingProps(last.trainingProps);
      return prev.slice(0, -1);
    });
  };

  const handleRedo = () => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setUndoStack((u) => [...u.slice(-49), cloneSnap()]);
      setNodesA(next.nodesA);
      setNodesB(next.nodesB);
      setUserArrows(next.userArrows);
      setUserZones(next.userZones);
      setFreehandStrokes(next.freehandStrokes);
      setTrainingProps(next.trainingProps);
      return prev.slice(0, -1);
    });
  };

  // Ctrl+Z / Ctrl+Y 50-step Undo/Redo keyboard binding
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesA, nodesB, userArrows, userZones, freehandStrokes, trainingProps]);

  // Seed drill mode when bridged from Moment State "Turn Into Drill"
  useEffect(() => {
    if (initialDrillNote) {
      setPitchView("half");
      setBlueprint((prev) =>
        prev
          ? {
              ...prev,
              title_ar: initialDrillNote.slice(0, 75),
              philosophy_ar: initialDrillNote,
            }
          : prev
      );
      setTrainingProps([
        { id: "ball-main", kind: "ball", x_m: 66, y_m: 34 },
        { id: "cone-1", kind: "cone", x_m: 74, y_m: 20 },
        { id: "cone-2", kind: "cone", x_m: 74, y_m: 48 },
        { id: "man-1", kind: "mannequin", x_m: 82, y_m: 34 },
      ]);
    }
  }, [initialDrillNote]);

  // Load saved custom tactical plans from SQLite Server API (with localStorage fallback)
  useEffect(() => {
    let alive = true;
    apiFetch<{ plans: SavedTacticalPlan[] }>(
      `/api/plans?match_id=${encodeURIComponent(matchId)}`,
      {},
      "club_demo_egypt",
      role
    )
      .then((res) => {
        if (alive && Array.isArray(res.plans)) setSavedPlans(res.plans);
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem(SAVED_PLANS_KEY);
          if (raw && alive) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) setSavedPlans(parsed);
          }
        } catch {}
      });
    return () => {
      alive = false;
    };
  }, [matchId, role]);

  // Live Deterministic Tactical Math Validation (Math-First, debounced 240ms on every drag/edit)
  useEffect(() => {
    if (nodesA.length === 0) return;
    const t = setTimeout(() => {
      apiFetch<MathValidationResult>(
        "/api/plans/validate",
        {
          method: "POST",
          body: JSON.stringify({
            nodes_a: nodesA,
            nodes_b: nodesB,
            formation_code: formationA,
          }),
        },
        "club_demo_egypt",
        role
      )
        .then((res) => setMathValidation(res))
        .catch(() => {});
    }, 240);
    return () => clearTimeout(t);
  }, [nodesA, nodesB, formationA, role]);

  // Smooth 60FPS Keyframe Animation Playback Loop
  useEffect(() => {
    if (!isAnimating || keyframes.length < 2) return;
    let rafId = 0;
    const totalSegments = keyframes.length - 1;
    const segMs = 1500;
    const startTs = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTs;
      const totalDuration = totalSegments * segMs;
      const clamped = elapsed % totalDuration;
      const segIdx = Math.min(totalSegments - 1, Math.floor(clamped / segMs));
      const u = (clamped - segIdx * segMs) / segMs;
      // Smoothstep easing
      const ease = u * u * (3 - 2 * u);

      const k0 = keyframes[segIdx];
      const k1 = keyframes[segIdx + 1];
      const lerpNodes = (aList: BlueprintNode[], bList: BlueprintNode[]) =>
        aList.map((n, i) => {
          const target = bList[i] || n;
          return {
            ...n,
            x_m: Number((n.x_m + (target.x_m - n.x_m) * ease).toFixed(1)),
            y_m: Number((n.y_m + (target.y_m - n.y_m) * ease).toFixed(1)),
          };
        });

      setNodesA(lerpNodes(k0.nodesA, k1.nodesA));
      setNodesB(lerpNodes(k0.nodesB, k1.nodesB));
      setTrainingProps(
        k0.props.map((pr, i) => {
          const tp = k1.props[i] || pr;
          return {
            ...pr,
            x_m: Number((pr.x_m + (tp.x_m - pr.x_m) * ease).toFixed(1)),
            y_m: Number((pr.y_m + (tp.y_m - pr.y_m) * ease).toFixed(1)),
          };
        })
      );
      setAnimStepProgress(segIdx + u);
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isAnimating, keyframes]);

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
      if ((externalBlueprint.passing_arrows?.length || 0) > 0) {
        setShowPassVectors(true);
      }
      setUserArrows(externalBlueprint.custom_arrows || []);
      setUserZones(externalBlueprint.custom_zones || []);
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
      if ((res.passing_arrows?.length || 0) > 0) setShowPassVectors(true);
      setShowLines(true);
      setUserArrows(res.custom_arrows || []);
      setUserZones(res.custom_zones || []);
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

  const handleSaveCurrentPlan = async () => {
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
    try {
      const res = await apiFetch<{ plans: SavedTacticalPlan[] }>(
        "/api/plans",
        {
          method: "POST",
          body: JSON.stringify({ ...item, match_id: matchId, trainingProps, keyframes }),
        },
        "club_demo_egypt",
        role
      );
      setSavedPlans(res.plans || [item, ...savedPlans]);
      setSaveBanner(isAr ? "تم حفظ الخطة دائماً في قاعدة بيانات السيرفر" : "Saved permanently to Server SQLite DB");
      setTimeout(() => setSaveBanner(null), 2800);
    } catch {
      const next = [item, ...savedPlans].slice(0, 12);
      setSavedPlans(next);
      try {
        localStorage.setItem(SAVED_PLANS_KEY, JSON.stringify(next));
      } catch {}
      setSaveBanner(isAr ? "تم حفظ الخطة محلياً" : "Saved locally");
      setTimeout(() => setSaveBanner(null), 2600);
    }
  };

  const handleLoadSavedPlan = (plan: SavedTacticalPlan) => {
    pushHistory();
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
  };

  const handleDeleteSavedPlan = async (id: string) => {
    setSavedPlans((prev) => prev.filter((p) => p.id !== id));
    try {
      await apiFetch(
        `/api/plans/${encodeURIComponent(id)}?match_id=${encodeURIComponent(matchId)}`,
        { method: "DELETE" },
        "club_demo_egypt",
        role
      );
    } catch {}
  };

  const handleExportEgyPlan = () => {
    const payload = {
      schema: "egy-scout-plan-v9",
      matchId,
      formationA,
      formationB,
      styleA,
      styleB,
      titleAr: blueprint?.title_ar || "",
      philosophyAr: blueprint?.philosophy_ar || "",
      stepsAr: blueprint?.execution_steps_ar || [],
      nodesA,
      nodesB,
      userArrows,
      userZones,
      freehandStrokes,
      trainingProps,
      keyframes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `egy-scout-${formationA.replace(/[^0-9A-Za-z-]/g, "")}.egyplan`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportEgyPlan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      pushHistory();
      skipNextFetchRef.current = true;
      if (parsed.formationA) {
        setFormationA(parsed.formationA);
        setCustomInputA(parsed.formationA);
      }
      if (parsed.formationB) {
        setFormationB(parsed.formationB);
        setCustomInputB(parsed.formationB);
      }
      if (parsed.nodesA) setNodesA(parsed.nodesA);
      if (parsed.nodesB) setNodesB(parsed.nodesB);
      if (parsed.userArrows) setUserArrows(parsed.userArrows);
      if (parsed.userZones) setUserZones(parsed.userZones);
      if (parsed.trainingProps) setTrainingProps(parsed.trainingProps);
      if (parsed.keyframes) setKeyframes(parsed.keyframes);
      setSaveBanner(isAr ? "تم استيراد ملف .egyplan بنجاح" : "Imported .egyplan file");
      setTimeout(() => setSaveBanner(null), 2600);
    } catch {} finally {
      e.target.value = "";
    }
  };

  const addTrainingProp = (kind: TrainingProp["kind"]) => {
    pushHistory();
    const xBase = pitchView === "corner" ? 88 : pitchView === "half" ? 74 : 55;
    setTrainingProps((prev) => [
      ...prev,
      {
        id: `${kind}-${Date.now()}`,
        kind,
        x_m: Number((xBase + (prev.length % 4) * 3.5).toFixed(1)),
        y_m: Number((22 + (prev.length % 5) * 6.5).toFixed(1)),
      },
    ]);
  };

  const autoAlignLines = () => {
    pushHistory();
    const alignTeam = (list: BlueprintNode[]) => {
      // Group outfield players into 3 vertical bands by X and align each band cleanly
      const gk = list.filter((n) => n.slot === "GK");
      const out = list.filter((n) => n.slot !== "GK");
      if (out.length < 3) return list;
      const xs = out.map((n) => n.x_m).sort((a, b) => a - b);
      const t1 = xs[Math.floor(xs.length / 3)];
      const t2 = xs[Math.floor((2 * xs.length) / 3)];
      const bands: BlueprintNode[][] = [[], [], []];
      out.forEach((n) => {
        if (n.x_m <= t1) bands[0].push(n);
        else if (n.x_m <= t2) bands[1].push(n);
        else bands[2].push(n);
      });
      const updatedMap = new Map<BlueprintNode, BlueprintNode>();
      bands.forEach((b) => {
        if (b.length === 0) return;
        const avgX = Math.round((b.reduce((s, n) => s + n.x_m, 0) / b.length) * 2) / 2;
        const sortedY = [...b].sort((a, c) => a.y_m - c.y_m);
        sortedY.forEach((n, idx) => {
          const evenY =
            sortedY.length === 1 ? 34 : Number((10 + (idx / (sortedY.length - 1)) * 48).toFixed(1));
          updatedMap.set(n, { ...n, x_m: avgX, y_m: evenY });
        });
      });
      return [...gk, ...out.map((n) => updatedMap.get(n) || n)];
    };
    setNodesA((prev) => alignTeam(prev));
    setNodesB((prev) => alignTeam(prev));
    setSaveBanner(isAr ? "تمت محاذاة خطوط التشكيل تلقائياً" : "Formation lines aligned");
    setTimeout(() => setSaveBanner(null), 2200);
  };

  const captureKeyframe = (createNew: boolean) => {
    const snap: BoardKeyframe = {
      label: isAr ? `المرحلة ${createNew ? keyframes.length + 1 : Math.max(1, activeKfIdx + 1)}` : `Phase ${createNew ? keyframes.length + 1 : Math.max(1, activeKfIdx + 1)}`,
      nodesA: nodesA.map((n) => ({ ...n })),
      nodesB: nodesB.map((n) => ({ ...n })),
      props: trainingProps.map((p) => ({ ...p })),
    };
    if (createNew || keyframes.length === 0) {
      const next = [...keyframes, snap];
      setKeyframes(next);
      setActiveKfIdx(next.length - 1);
      // Also advance players slightly along their run arrows when creating Phase 2+ so motion is instant!
      if (next.length >= 2) {
        setNodesA((prev) =>
          prev.map((n) => ({
            ...n,
            x_m: n.move_to_x_m || n.x_m,
            y_m: n.move_to_y_m || n.y_m,
          }))
        );
      }
    } else {
      setKeyframes((prev) => prev.map((k, i) => (i === activeKfIdx ? snap : k)));
    }
  };

  const selectKeyframe = (idx: number) => {
    setIsAnimating(false);
    const kf = keyframes[idx];
    if (!kf) return;
    setActiveKfIdx(idx);
    setNodesA(kf.nodesA.map((n) => ({ ...n })));
    setNodesB(kf.nodesB.map((n) => ({ ...n })));
    setTrainingProps(kf.props.map((p) => ({ ...p })));
  };

  const handleRecordAnimatedVideo = (targetFmt: "webm" | "mp4" | "gif" = "mp4") => {
    const cvs = canvasRef.current;
    if (!cvs || keyframes.length < 2 || recordingVideo) return;
    try {
      const stream = cvs.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      rec.onstop = async () => {
        const webmBlob = new Blob(chunks, { type: "video/webm" });
        const baseName = `egy-scout-animated-${formationA.replace(/[^0-9A-Za-z-]/g, "")}`;
        try {
          if (targetFmt === "mp4" || targetFmt === "gif") {
            const fd = new FormData();
            fd.append("file", webmBlob, `${baseName}.webm`);
            fd.append("target_format", targetFmt);
            const res = await fetch(`${API_BASE}/api/plans/convert-video`, {
              method: "POST",
              headers: { "X-Tenant-Id": "club_demo_egypt", "X-User-Role": role },
              body: fd,
            });
            if (res.ok) {
              const converted = await res.blob();
              const url = URL.createObjectURL(converted);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${baseName}.${targetFmt}`;
              a.click();
              URL.revokeObjectURL(url);
              setSaveBanner(
                isAr ? `تم تصدير الخطة المتحركة بصيغة ${targetFmt.toUpperCase()}` : `Exported ${targetFmt.toUpperCase()}`
              );
              setTimeout(() => setSaveBanner(null), 2600);
              return;
            }
          }
          // Fallback to direct WebM download
          const url = URL.createObjectURL(webmBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${baseName}.webm`;
          a.click();
          URL.revokeObjectURL(url);
        } finally {
          setRecordingVideo(false);
          setIsAnimating(false);
        }
      };
      setRecordingVideo(true);
      setIsAnimating(true);
      rec.start();
      const totalMs = Math.max(2200, (keyframes.length - 1) * 1500 + 300);
      setTimeout(() => {
        if (rec.state !== "inactive") rec.stop();
      }, totalMs);
    } catch {
      setRecordingVideo(false);
    }
  };

  const getViewBounds = () =>
    pitchView === "half"
      ? { x0: 48, x1: 105, y0: 0, y1: 68 }
      : pitchView === "corner"
      ? { x0: 68, x1: 105, y0: 0, y1: 48 }
      : { x0: 0, x1: 105, y0: 0, y1: 68 };

  // Convert canvas client event -> pitch meters (respecting Full / Half / Corner pitchView + optional Snap-to-Grid!)
  const clientToPitchMeters = (clientX: number, clientY: number, targetCvs?: HTMLCanvasElement | null): [number, number] => {
    const cvs = targetCvs || activeCanvasRef.current || canvasRef.current;
    if (!cvs) return [52.5, 34.0];
    const rect = cvs.getBoundingClientRect();
    const pad = 24;
    const pw = cvs.width - pad * 2;
    const ph = cvs.height - pad * 2;
    const vb = getViewBounds();
    const cx = ((clientX - rect.left) / Math.max(1, rect.width)) * cvs.width;
    const cy = ((clientY - rect.top) / Math.max(1, rect.height)) * cvs.height;
    let xm = vb.x0 + ((cx - pad) / pw) * (vb.x1 - vb.x0);
    let ym = vb.y0 + ((cy - pad) / ph) * (vb.y1 - vb.y0);
    if (snapGrid) {
      xm = Math.round(xm / 2.5) * 2.5;
      ym = Math.round(ym / 2.5) * 2.5;
    }
    xm = Math.max(1.0, Math.min(104.0, xm));
    ym = Math.max(1.0, Math.min(67.0, ym));
    return [Math.round(xm * 10) / 10, Math.round(ym * 10) / 10];
  };

  const handleMouseDown = (
    e: React.MouseEvent<HTMLCanvasElement>,
    boardScope: "both" | "team_a" | "team_b" = "both"
  ) => {
    activeCanvasRef.current = e.currentTarget;
    const [xm, ym] = clientToPitchMeters(e.clientX, e.clientY, e.currentTarget);

    if (drawTool === "drag_player") {
      // 0. Check training props (ball, cone, mini_goal, mannequin) within 3.2m
      const hitProp = trainingProps.find((pr) => Math.hypot(pr.x_m - xm, pr.y_m - ym) <= 3.2);
      if (hitProp) {
        pushHistory();
        draggingNodeRef.current = { propId: hitProp.id };
        return;
      }

      // 1. Check if clicking the selected player's arrow tip handle first (to resize/re-aim run arrow!)
      const selList = selectedNode.team === "team_a" ? nodesA : nodesB;
      const selNd = selList[selectedNode.index];
      if (
        selNd &&
        showRunArrows &&
        (boardScope === "both" || boardScope === selectedNode.team) &&
        Math.hypot(selNd.move_to_x_m - xm, selNd.move_to_y_m - ym) <= 3.8 &&
        Math.hypot(selNd.move_to_x_m - selNd.x_m, selNd.move_to_y_m - selNd.y_m) >= 2.0
      ) {
        pushHistory();
        draggingNodeRef.current = { team: selectedNode.team, index: selectedNode.index, mode: "arrow_tip" };
        return;
      }

      // 2. Find nearest player node from visible teams on this board within 4.8m
      let bestHit: { team: "team_a" | "team_b"; index: number; dist: number } | null = null;
      if (boardScope !== "team_b") {
        nodesA.forEach((nd, idx) => {
          const d = Math.hypot(nd.x_m - xm, nd.y_m - ym);
          if (d <= 4.8 && (!bestHit || d < bestHit.dist)) {
            bestHit = { team: "team_a", index: idx, dist: d };
          }
        });
      }
      if (boardScope !== "team_a") {
        nodesB.forEach((nd, idx) => {
          const d = Math.hypot(nd.x_m - xm, nd.y_m - ym);
          if (d <= 4.8 && (!bestHit || d < bestHit.dist)) {
            bestHit = { team: "team_b", index: idx, dist: d };
          }
        });
      }
      if (bestHit) {
        const hit = bestHit as { team: "team_a" | "team_b"; index: number };
        pushHistory();
        draggingNodeRef.current = { team: hit.team, index: hit.index, mode: "body" };
        setSelectedNode({ team: hit.team, index: hit.index });
      }
      return;
    }

    pushHistory();
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
      if ("propId" in draggingNodeRef.current) {
        const pid = draggingNodeRef.current.propId;
        setTrainingProps((prev) => prev.map((p) => (p.id === pid ? { ...p, x_m: xm, y_m: ym } : p)));
        return;
      }
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
        const effectiveKind = drawDashed ? "pass" : kind;
        const newArrow: BlueprintPassingArrow = {
          from_x_m: d.startX_m,
          from_y_m: d.startY_m,
          to_x_m: d.curX_m,
          to_y_m: d.curY_m,
          kind: effectiveKind,
          color,
          label_ar: label,
        };
        let nextArrows: BlueprintPassingArrow[] = [];
        setUserArrows((prev) => {
          nextArrows = [...prev, newArrow];
          return nextArrows;
        });
        if (effectiveKind === "pass") {
          apiFetch<{ arrows: BlueprintPassingArrow[] }>(
            "/api/plans/pass-probabilities",
            {
              method: "POST",
              body: JSON.stringify({
                arrows: [newArrow],
                nodes_a: nodesA,
                nodes_b: nodesB,
                attack_right: true,
              }),
            },
            "club_demo_egypt",
            role
          )
            .then((res) => {
              const scored = res.arrows?.[0];
              if (!scored) return;
              setUserArrows((prev) =>
                prev.map((a) =>
                  a.from_x_m === newArrow.from_x_m && a.to_x_m === newArrow.to_x_m && a.from_y_m === newArrow.from_y_m
                    ? { ...a, xpass_pct: scored.xpass_pct, obv_delta: scored.obv_delta }
                    : a
                )
              );
            })
            .catch(() => {});
        }
      }
    }
  };

  // Master Canvas Render Effect (Supports Dual Side-by-Side Boards OR Single Combined/Filtered Board)
  useEffect(() => {
    if (!blueprint) return;

    const renderBoardCanvas = (cvs: HTMLCanvasElement, scope: "both" | "team_a" | "team_b") => {
      const ctx = cvs.getContext("2d");
      if (!ctx) return;

      const W = cvs.width;
      const H = cvs.height;
      const pad = 24;
      const pw = W - pad * 2;
      const ph = H - pad * 2;

      // 1. Stadium Turf Background with Mowed Stripes + Multi-Pitch View Zoom Transform
      ctx.fillStyle = "#061A13";
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      const vb = getViewBounds();
      if (pitchView !== "full") {
        ctx.beginPath();
        ctx.rect(pad, pad, pw, ph);
        ctx.clip();
        const sx = 105 / (vb.x1 - vb.x0);
        const sy = 68 / (vb.y1 - vb.y0);
        ctx.translate(pad, pad);
        ctx.scale(sx, sy);
        ctx.translate(-(pad + (vb.x0 / 105) * pw), -(pad + (vb.y0 / 68) * ph));
      }

      const nStripes = 12;
      for (let i = 0; i < nStripes; i++) {
        if (i % 2 === 0) {
          ctx.fillStyle = "#09251B";
          ctx.fillRect(pad + (i * pw) / nStripes, pad, pw / nStripes, ph);
        }
      }

      // Optional Magnetic Snap-to-Grid Overlay (2.5m spacing)
      if (snapGrid) {
        ctx.save();
        ctx.strokeStyle = "rgba(16, 185, 129, 0.14)";
        ctx.lineWidth = 0.8;
        for (let gx = 5; gx < 105; gx += 5) {
          const px = pad + (gx / 105) * pw;
          ctx.beginPath();
          ctx.moveTo(px, pad);
          ctx.lineTo(px, H - pad);
          ctx.stroke();
        }
        for (let gy = 5; gy < 68; gy += 5) {
          const py = pad + (gy / 68) * ph;
          ctx.beginPath();
          ctx.moveTo(pad, py);
          ctx.lineTo(W - pad, py);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 2. FIFA Pitch Markings
      ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
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

      // 3. Built-in Tactical Zones (only when showZones is toggled ON — zero default clutter!)
      if (showZones) {
        for (const tz of blueprint.tactical_zones) {
          const x1 = pad + (Math.min(tz.x1_m, tz.x2_m) / 105) * pw;
          const x2 = pad + (Math.max(tz.x1_m, tz.x2_m) / 105) * pw;
          const y1 = pad + (tz.y1_m / 68) * ph;
          const y2 = pad + (tz.y2_m / 68) * ph;
          const isZ14 = tz.zone_id === "zone_14";

          ctx.save();
          ctx.fillStyle = isZ14 ? "rgba(245, 158, 11, 0.10)" : "rgba(56, 189, 248, 0.05)";
          ctx.strokeStyle = isZ14 ? "rgba(250, 204, 21, 0.35)" : "rgba(56, 189, 248, 0.22)";
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.2;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]);
          ctx.fillStyle = isZ14 ? "#FACC15" : "#7DD3FC";
          ctx.font = "700 9px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(tz.label_ar, (x1 + x2) / 2, y1 + 11);
          ctx.restore();
        }
      }

      if (showZones || drawTool === "zone_box") {
        for (const cz of userZones) {
          const x1 = pad + (Math.min(cz.x1_m, cz.x2_m) / 105) * pw;
          const x2 = pad + (Math.max(cz.x1_m, cz.x2_m) / 105) * pw;
          const y1 = pad + (Math.min(cz.y1_m, cz.y2_m) / 68) * ph;
          const y2 = pad + (Math.max(cz.y1_m, cz.y2_m) / 68) * ph;
          ctx.save();
          ctx.fillStyle = "rgba(16, 185, 129, 0.14)";
          ctx.strokeStyle = cz.color || "#10B981";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([6, 4]);
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.setLineDash([]);
          ctx.fillStyle = "#6EE7B7";
          ctx.font = "700 10px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(cz.label_ar, (x1 + x2) / 2, y1 + 13);
          ctx.restore();
        }
      }

      const hexA = blueprint.kit_colors?.team_a_hex || "#EF4444";
      const hexB = blueprint.kit_colors?.team_b_hex || "#38BDF8";

      // Clean non-crossing formation lines: cluster outfield nodes by depth (x_m) & sort each line strictly by y_m (top-to-bottom)
      const drawTeamFormationLines = (
        liveNodes: BlueprintNode[],
        teamColor: string,
        teamKey: "team_a" | "team_b"
      ) => {
        if (!showLines) return;
        const outfield = liveNodes.filter((n) => n.slot.toUpperCase() !== "GK" && n.x_m > 9 && n.x_m < 96);
        if (outfield.length < 3) return;
        const orderedX = [...outfield].sort((a, b) => (teamKey === "team_a" ? a.x_m - b.x_m : b.x_m - a.x_m));
        const nDef = Math.min(4, Math.max(2, Math.floor(orderedX.length / 3)));
        const nMid = Math.min(4, Math.max(2, Math.floor((orderedX.length - nDef) / 2)));
        const bands = [
          orderedX.slice(0, nDef),
          orderedX.slice(nDef, nDef + nMid),
          orderedX.slice(nDef + nMid),
        ];

        for (const band of bands) {
          if (band.length < 2) continue;
          const pts = [...band].sort((a, b) => a.y_m - b.y_m);
          ctx.save();
          ctx.strokeStyle = teamColor;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 2.0;
          ctx.setLineDash([6, 5]);
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

      if (scope !== "team_b") {
        drawTeamFormationLines(nodesA, hexA, "team_a");
      }
      if (scope !== "team_a") {
        drawTeamFormationLines(nodesB, hexB, "team_b");
      }

      // Helper to draw a straight or curved arrow on the pitch with optional xPass % badge
      const drawArrowVector = (
        fx_m: number,
        fy_m: number,
        tx_m: number,
        ty_m: number,
        color: string,
        dashed: boolean,
        label?: string,
        curved: boolean = false,
        xpassPct?: number,
        obvDelta?: number
      ) => {
        const fx = pad + (fx_m / 105) * pw;
        const fy = pad + (fy_m / 68) * ph;
        const tx = pad + (tx_m / 105) * pw;
        const ty = pad + (ty_m / 68) * ph;
        if (Math.hypot(tx - fx, ty - fy) < 8) return;

        const dx = tx - fx;
        const dy = ty - fy;
        const cpx = (fx + tx) * 0.5 - dy * 0.14;
        const cpy = (fy + ty) * 0.5 + dx * 0.14;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = curved ? 2.4 : 2.0;
        if (dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        if (curved) {
          ctx.quadraticCurveTo(cpx, cpy, tx, ty);
        } else {
          ctx.lineTo(tx, ty);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        const ang = curved ? Math.atan2(ty - cpy, tx - cpx) : Math.atan2(dy, dx);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - 8 * Math.cos(ang - 0.42), ty - 8 * Math.sin(ang - 0.42));
        ctx.lineTo(tx - 8 * Math.cos(ang + 0.42), ty - 8 * Math.sin(ang + 0.42));
        ctx.closePath();
        ctx.fill();

        const midX = curved ? 0.25 * fx + 0.5 * cpx + 0.25 * tx : (fx + tx) * 0.5;
        const midY = (curved ? 0.25 * fy + 0.5 * cpy + 0.25 * ty : (fy + ty) * 0.5) - 7;
        const shortLabel = label ? (label.length > 18 ? `${label.slice(0, 17)}…` : label) : "";
        const badgeText =
          typeof xpassPct === "number"
            ? `${Math.round(xpassPct)}% xPass`
            : shortLabel;

        if (badgeText) {
          ctx.font = "800 9px Inter, system-ui, sans-serif";
          const tw = ctx.measureText(badgeText).width + 10;
          ctx.fillStyle = "rgba(9, 13, 22, 0.90)";
          ctx.beginPath();
          ctx.roundRect(midX - tw / 2, midY - 8, tw, 15, 5);
          ctx.fill();
          ctx.strokeStyle =
            typeof xpassPct === "number" ? (xpassPct >= 75 ? "#10B981" : xpassPct >= 50 ? "#FACC15" : "#FB7185") : color;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle =
            typeof xpassPct === "number" ? (xpassPct >= 75 ? "#34D399" : xpassPct >= 50 ? "#FACC15" : "#FDA4AF") : color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(badgeText, midX, midY);
        }
        ctx.restore();
      };

      // 4. Built-in / AI Passing Arrows with curved arcs & xPass %
      if (showPassVectors) {
        if (scope !== "team_b" && blueprint.passing_arrows) {
          for (const pa of blueprint.passing_arrows) {
            drawArrowVector(
              pa.from_x_m,
              pa.from_y_m,
              pa.to_x_m,
              pa.to_y_m,
              "#FACC15",
              true,
              isAr ? pa.label_ar : pa.label_en || pa.label_ar,
              true,
              pa.xpass_pct,
              pa.obv_delta
            );
          }
        }
        if (scope !== "team_a" && blueprint.opponent_passing_arrows) {
          for (const pa of blueprint.opponent_passing_arrows) {
            drawArrowVector(
              pa.from_x_m,
              pa.from_y_m,
              pa.to_x_m,
              pa.to_y_m,
              "#38BDF8",
              true,
              isAr ? pa.label_ar : pa.label_en || pa.label_ar,
              true,
              pa.xpass_pct,
              pa.obv_delta
            );
          }
        }
      }

      if (scope !== "team_b" && (showPassVectors || drawTool !== "drag_player")) {
        for (const ua of userArrows) {
          const col = ua.color || (ua.kind === "pass" ? "#FACC15" : ua.kind === "press" ? "#EF4444" : "#10B981");
          drawArrowVector(
            ua.from_x_m,
            ua.from_y_m,
            ua.to_x_m,
            ua.to_y_m,
            col,
            ua.kind === "pass",
            ua.label_ar,
            ua.kind === "pass",
            ua.xpass_pct,
            ua.obv_delta
          );
        }
      }

      // Active drag shape preview
      if (draftShapeRef.current && activeCanvasRef.current === cvs) {
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
        ctx.lineWidth = 2.4;
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

      // 5. Render Player Nodes
      const renderTeamNodes = (list: BlueprintNode[], tKey: "team_a" | "team_b", kitHex: string) => {
        list.forEach((nd, idx) => {
          const px = pad + (nd.x_m / 105) * pw;
          const py = pad + (nd.y_m / 68) * ph;
          const tx = pad + (nd.move_to_x_m / 105) * pw;
          const ty = pad + (nd.move_to_y_m / 68) * ph;
          const isSel = selectedNode.team === tKey && selectedNode.index === idx;
          const isGk = nd.slot.toUpperCase() === "GK";

          // Player run vector (never on GK unless explicitly selected & dragged; only when showRunArrows is ON)
          if (showRunArrows && !isGk && Math.hypot(tx - px, ty - py) > 10) {
            drawArrowVector(
              nd.x_m,
              nd.y_m,
              nd.move_to_x_m,
              nd.move_to_y_m,
              isSel ? "#10B981" : tKey === "team_a" ? "rgba(255,255,255,0.55)" : "rgba(125,211,252,0.50)",
              false
            );
            if (isSel) {
              ctx.save();
              ctx.fillStyle = "#FACC15";
              ctx.strokeStyle = "#090D16";
              ctx.lineWidth = 1.8;
              ctx.beginPath();
              ctx.arc(tx, ty, 5.2, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
              ctx.restore();
            }
          }

          if (isSel) {
            ctx.save();
            ctx.strokeStyle = "#10B981";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(px, py, 16.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          ctx.save();
          ctx.beginPath();
          ctx.arc(px, py, 12.0, 0, Math.PI * 2);
          ctx.fillStyle = isGk ? (tKey === "team_a" ? "#F59E0B" : "#22D3EE") : kitHex;
          ctx.fill();
          ctx.lineWidth = 2.0;
          ctx.strokeStyle = tKey === "team_a" ? "#FFFFFF" : "#0F172A";
          ctx.stroke();

          ctx.fillStyle = "#FFFFFF";
          ctx.font = "800 9.5px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(nd.jersey_number ? `${nd.jersey_number}` : nd.slot, px, py);

          const shortName = nd.player_label.replace(/\s*\([^)]*\)/g, "").slice(0, 14);
          const pillText = `${nd.slot} • ${shortName}`;
          ctx.font = "700 9.2px Inter, system-ui, sans-serif";
          const tw = ctx.measureText(pillText).width + 10;
          const labelOffsetY = tKey === "team_a" || scope === "team_b" ? 15 : -28;
          ctx.fillStyle = "rgba(9, 13, 22, 0.92)";
          ctx.beginPath();
          ctx.roundRect(px - tw / 2, py + labelOffsetY, tw, 15, 4);
          ctx.fill();
          ctx.strokeStyle = isSel ? "#10B981" : kitHex;
          ctx.lineWidth = 1;
          ctx.stroke();

          if (showMiniCardsOnPitch && tKey === "team_a") {
            const cw = 42;
            const ch = 54;
            const cx0 = px - cw / 2;
            const cy0 = py - ch / 2;
            ctx.beginPath();
            ctx.moveTo(cx0 + 5, cy0);
            ctx.lineTo(cx0 + cw - 5, cy0);
            ctx.quadraticCurveTo(cx0 + cw, cy0, cx0 + cw, cy0 + 8);
            ctx.lineTo(cx0 + cw, cy0 + ch * 0.78);
            ctx.quadraticCurveTo(cx0 + cw, cy0 + ch * 0.92, px, cy0 + ch);
            ctx.quadraticCurveTo(cx0, cy0 + ch * 0.92, cx0, cy0 + ch * 0.78);
            ctx.lineTo(cx0, cy0 + 8);
            ctx.quadraticCurveTo(cx0, cy0, cx0 + 5, cy0);
            ctx.closePath();
            const gCard = ctx.createLinearGradient(cx0, cy0, cx0 + cw, cy0 + ch);
            gCard.addColorStop(0, "#E7AD77");
            gCard.addColorStop(1, "#78481D");
            ctx.fillStyle = gCard;
            ctx.fill();
            ctx.lineWidth = isSel ? 2.4 : 1.5;
            ctx.strokeStyle = isSel ? "#10B981" : "#FEF08A";
            ctx.stroke();

            ctx.fillStyle = kitHex;
            ctx.fillRect(cx0 + 4, cy0 + 2, cw - 8, 4);
            ctx.fillStyle = "#0F172A";
            ctx.font = "900 11px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(nd.jersey_number ? `${nd.jersey_number}` : nd.slot, px, cy0 + 18);
            ctx.fillStyle = "rgba(2,6,23,0.88)";
            ctx.fillRect(cx0 + 4, cy0 + 26, cw - 8, 12);
            ctx.fillStyle = "#FACC15";
            ctx.font = "800 7.5px Inter, sans-serif";
            ctx.fillText(nd.slot.slice(0, 4), px, cy0 + 35);
            const miniNm = nd.player_label.replace(/\s*\([^)]*\)/g, "").split(" ").pop() || nd.slot;
            ctx.fillStyle = "#FFFBEB";
            ctx.font = "700 7.5px Cairo, Inter, sans-serif";
            ctx.fillText(miniNm.slice(0, 8), px, cy0 + 46);
            ctx.restore();
            return;
          }

          ctx.fillStyle = isSel ? "#6EE7B7" : "#F8FAFC";
          ctx.fillText(pillText, px, py + labelOffsetY + 7.5);
          ctx.restore();
        });
      };

      if (scope !== "team_a") {
        renderTeamNodes(nodesB, "team_b", hexB);
      }
      if (scope !== "team_b") {
        renderTeamNodes(nodesA, "team_a", hexA);
      }

      // 6. Render Training Equipment Props
      for (const pr of trainingProps) {
        const px = pad + (pr.x_m / 105) * pw;
        const py = pad + (pr.y_m / 68) * ph;
        ctx.save();
        if (pr.kind === "ball") {
          ctx.beginPath();
          ctx.arc(px, py, 6.0, 0, Math.PI * 2);
          ctx.fillStyle = "#FFFFFF";
          ctx.fill();
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = "#0F172A";
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, py, 2.0, 0, Math.PI * 2);
          ctx.fillStyle = "#1E293B";
          ctx.fill();
        } else if (pr.kind === "cone") {
          ctx.fillStyle = "#F97316";
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(px, py - 8);
          ctx.lineTo(px + 7, py + 6);
          ctx.lineTo(px - 7, py + 6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (pr.kind === "mini_goal") {
          ctx.fillStyle = "rgba(255,255,255,0.18)";
          ctx.strokeStyle = "#F8FAFC";
          ctx.lineWidth = 2.2;
          ctx.fillRect(px - 14, py - 7, 28, 14);
          ctx.strokeRect(px - 14, py - 7, 28, 14);
        } else if (pr.kind === "mannequin") {
          ctx.fillStyle = "#FACC15";
          ctx.strokeStyle = "#0F172A";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(px, py - 7, 4.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillRect(px - 4.5, py - 2, 9, 12);
          ctx.strokeRect(px - 4.5, py - 2, 9, 12);
        }
        ctx.restore();
      }

      ctx.restore();
    };

    if (teamDisplay === "dual") {
      if (canvasRef.current) renderBoardCanvas(canvasRef.current, "team_a");
      if (canvasBRef.current) renderBoardCanvas(canvasBRef.current, "team_b");
    } else {
      if (canvasRef.current) renderBoardCanvas(canvasRef.current, teamDisplay);
    }
  }, [
    blueprint,
    nodesA,
    nodesB,
    teamDisplay,
    showLines,
    showRunArrows,
    showPassVectors,
    showZones,
    showMiniCardsOnPitch,
    userArrows,
    userZones,
    freehandStrokes,
    selectedNode,
    drawTool,
    drawColor,
    drawDashed,
    pitchView,
    snapGrid,
    trainingProps,
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

        {/* Dual Separate Boards vs Combined vs Single Team */}
        <div className="flex flex-wrap items-center gap-1.5 bg-[#090D16] border border-white/[0.1] rounded-xl p-1 text-xs">
          <button
            type="button"
            onClick={() => setTeamDisplay("dual")}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition ${
              teamDisplay === "dual" ? "bg-emerald-500 text-slate-950" : "text-slate-300 hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{isAr ? "سبورتان منفصلتان (فريقي | الخصم)" : "Dual Boards (Own | Opponent)"}</span>
          </button>
          <button
            type="button"
            onClick={() => setTeamDisplay("team_a")}
            className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
              teamDisplay === "team_a" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {isAr ? `سبورة ${blueprint?.team_name || "فريقي"}` : `${blueprint?.team_name || "Team A"} Board`}
          </button>
          <button
            type="button"
            onClick={() => setTeamDisplay("team_b")}
            className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
              teamDisplay === "team_b" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {isAr ? `سبورة ${blueprint?.opponent_name || "الخصم"}` : `${blueprint?.opponent_name || "Team B"} Board`}
          </button>
          <button
            type="button"
            onClick={() => setTeamDisplay("both")}
            className={`px-2.5 py-1.5 rounded-lg font-semibold transition ${
              teamDisplay === "both" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {isAr ? "مدمجة (11 ضد 11)" : "Combined (11v11)"}
          </button>
        </div>
      </div>

      {/* AI Live Tactical Drawing Bar */}
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
            <span>{isAr ? "توليد الخطة بالذكاء الاصطناعي:" : "AI Tactical Generator:"}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedModel((v) => !v)}
            className="px-2 py-2 rounded-lg bg-[#111827] border border-emerald-500/30 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/15 shrink-0"
            title={isAr ? "اختيار موديل الذكاء الاصطناعي يدوياً" : "Advanced AI Model Selection"}
          >
            {aiModel === "auto" ? (isAr ? "تلقائي ذكي" : "Auto Router") : aiModel.split("/").pop()}
          </button>
          {showAdvancedModel && (
            <select
              aria-label={isAr ? "اختيار موديل الذكاء الاصطناعي" : "Select AI Model"}
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              className="bg-[#111827] border border-emerald-500/35 rounded-lg px-2.5 py-2 text-[11px] font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
            >
              {groqModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {isAr ? m.ar : m.en}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={
              isAr
                ? "اكتب التشكيل أو الفكرة التكتيكية (مثال: خطة 3-2-4-1 بأظهرة عكسية وضغط عالٍ ضد 4-4-2)..."
                : "Describe any tactical formation or pressing structure for both teams..."
            }
            className="flex-1 min-w-[240px] bg-[#111827] border border-white/[0.14] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={aiLoading || !aiPrompt.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-45 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{aiLoading ? (isAr ? "جاري رسم السبورتين..." : "Drawing boards...") : isAr ? "رسم التشكيل الآن" : "Draw Tactical Plan"}</span>
          </button>
        </form>

        {/* 1-Click AI Drawing Presets */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-400">{isAr ? "نماذج خطط جاهزة:" : "Tactical Presets:"}</span>
          {[
            "خطة 4-3-3 ضغط عالي عكسي كلوب بالخطوط والتمريرات والاحتمالات",
            "خطة إنزاجي 3-5-2 التحولات العمودية السريعة",
            "خطة مانشستر سيتي جوارديولا 3-2-4-1 بصندوق الوسط والاستحواذ",
            "خطة باير ليفركوزن تشابي ألونسو 3-4-2-1 بالخطوط والباصات والاحتمالات",
            "خطة 4-2-3-1 تيكي تاكا واختراق المنطقة 14",
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
              {preset}
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
              <span>{isAr ? "تحريك اللاعبين ورأس السهم" : "Drag Players & Arrow Tips"}</span>
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
              <span>{isAr ? "سهم تحرك" : "Run Arrow"}</span>
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
              <span>{isAr ? "سهم تمريرة" : "Pass Arrow"}</span>
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
              <span>{isAr ? "سهم ضغط" : "Press Arrow"}</span>
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
              <span>{isAr ? "منطقة تكتيكية" : "Tactical Zone"}</span>
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
              <span>{isAr ? "قلم حر" : "Freehand"}</span>
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
              onClick={() => setShowRunArrows((v) => !v)}
              className={`px-2 py-1 rounded border text-[11px] font-semibold ${
                showRunArrows
                  ? "bg-sky-500/20 border-sky-500/40 text-sky-300"
                  : "bg-[#111827] border-white/10 text-slate-400"
              }`}
            >
              {isAr ? "أسهم التحرك" : "Player Runs"}
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
              {isAr ? "مسارات التمرير" : "Passing Lanes"}
            </button>
            <button
              type="button"
              onClick={() => setShowZones((v) => !v)}
              className={`px-2 py-1 rounded border text-[11px] font-semibold ${
                showZones
                  ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                  : "bg-[#111827] border-white/10 text-slate-400"
              }`}
            >
              {isAr ? "مناطق الملعب" : "Pitch Zones"}
            </button>
            <button
              type="button"
              onClick={() => setShowMiniCardsOnPitch((v) => !v)}
              className={`px-2 py-1 rounded border text-[11px] font-semibold ${
                showMiniCardsOnPitch
                  ? "bg-amber-500/20 border-amber-400/50 text-amber-200"
                  : "bg-[#111827] border-white/10 text-slate-400"
              }`}
            >
              {isAr ? "كروت مصغّرة" : "Mini Cards"}
            </button>
            <button
              type="button"
              onClick={() => setSnapGrid((g) => !g)}
              className={`px-2 py-1 rounded border text-[11px] font-semibold flex items-center gap-1 ${
                snapGrid
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                  : "bg-[#111827] border-white/10 text-slate-400"
              }`}
              title={isAr ? "شبكة ملعب مغناطيسية (Snap-to-Grid)" : "Snap-to-Grid (2.5m)"}
            >
              <Magnet className="w-3 h-3" />
              <span>{isAr ? "شبكة" : "Grid"}</span>
            </button>
            <button
              type="button"
              onClick={autoAlignLines}
              className="px-2 py-1 rounded border bg-[#111827] hover:bg-white/10 border-white/10 text-slate-300 text-[11px] font-semibold flex items-center gap-1"
              title={isAr ? "محاذاة خطوط التشكيل تلقائياً" : "Auto-Align Formation Lines"}
            >
              <AlignHorizontalJustifyCenter className="w-3 h-3 text-sky-400" />
              <span>{isAr ? "محاذاة" : "Align"}</span>
            </button>
            <button
              type="button"
              disabled={undoStack.length === 0}
              onClick={handleUndo}
              className="p-1.5 rounded-lg bg-[#111827] hover:bg-white/10 disabled:opacity-35 border border-white/10 text-slate-300"
              title={isAr ? `تراجع Ctrl+Z (${undoStack.length})` : `Undo Ctrl+Z (${undoStack.length})`}
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={redoStack.length === 0}
              onClick={handleRedo}
              className="p-1.5 rounded-lg bg-[#111827] hover:bg-white/10 disabled:opacity-35 border border-white/10 text-slate-300"
              title={isAr ? `إعادة Ctrl+Y (${redoStack.length})` : `Redo Ctrl+Y (${redoStack.length})`}
            >
              <Redo2 className="w-3.5 h-3.5" />
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
              <span>{isAr ? "حفظ الخطة" : "Save Plan"}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPng}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-bold flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              <span>{isAr ? "تحميل PNG" : "Export PNG"}</span>
            </button>
            <button
              type="button"
              onClick={handleExportEgyPlan}
              className="px-2 py-1 rounded-lg bg-[#111827] hover:bg-white/10 border border-white/15 text-slate-200 font-semibold"
              title={isAr ? "تصدير ملف .egyplan للمشاركة مع الجهاز الفني" : "Export .egyplan file"}
            >
              .egyplan ↓
            </button>
            <input ref={importFileRef} type="file" accept=".egyplan,.json" onChange={handleImportEgyPlan} className="hidden" />
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              className="px-2 py-1 rounded-lg bg-[#111827] hover:bg-white/10 border border-white/15 text-slate-200 font-semibold flex items-center gap-1"
              title={isAr ? "استيراد ملف .egyplan" : "Import .egyplan file"}
            >
              <Upload className="w-3 h-3 text-sky-400" />
              <span>{isAr ? "استيراد" : "Import"}</span>
            </button>
          </div>
        </div>

        {/* Row 3 (V8.5): Multi-Pitch Views + Training Equipment Props + Keyframe Animation Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06] text-[11px]">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-slate-400">{isAr ? "منظور الملعب:" : "View:"}</span>
            {(
              [
                { id: "full" as PitchViewMode, ar: "ملعب كامل", en: "Full" },
                { id: "half" as PitchViewMode, ar: "نصف هجومي", en: "Half" },
                { id: "corner" as PitchViewMode, ar: "منظور ركنية", en: "Corner" },
              ]
            ).map((pv) => (
              <button
                key={pv.id}
                type="button"
                onClick={() => setPitchView(pv.id)}
                className={`px-2 py-0.5 rounded font-bold transition ${
                  pitchView === pv.id
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-[#111827] text-slate-300 border border-white/10 hover:text-white"
                }`}
              >
                {isAr ? pv.ar : pv.en}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="text-slate-400">{isAr ? "أدوات التدريب:" : "Drills:"}</span>
            <button
              type="button"
              onClick={() => addTrainingProp("cone")}
              className="px-2 py-0.5 rounded bg-[#111827] hover:bg-orange-500/20 border border-white/10 text-orange-300 font-semibold"
            >
              + {isAr ? "قمع تدريب" : "Cone"}
            </button>
            <button
              type="button"
              onClick={() => addTrainingProp("mini_goal")}
              className="px-2 py-0.5 rounded bg-[#111827] hover:bg-white/15 border border-white/10 text-slate-200 font-semibold"
            >
              + {isAr ? "مرمى صغير" : "Mini-Goal"}
            </button>
            <button
              type="button"
              onClick={() => addTrainingProp("mannequin")}
              className="px-2 py-0.5 rounded bg-[#111827] hover:bg-amber-500/20 border border-white/10 text-amber-300 font-semibold"
            >
              + {isAr ? "دمية حائط" : "Wall"}
            </button>
            <button
              type="button"
              onClick={() => addTrainingProp("ball")}
              className="px-2 py-0.5 rounded bg-[#111827] hover:bg-white/15 border border-white/10 text-white font-semibold"
            >
              + {isAr ? "كرة" : "Ball"}
            </button>
            {trainingProps.length > 1 && (
              <button
                type="button"
                onClick={() => setTrainingProps([{ id: "ball-main", kind: "ball", x_m: 52.5, y_m: 34.0 }])}
                className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300"
              >
                ×
              </button>
            )}
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
                {zn.label_ar || `منطقة #${i + 1}`} ×
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Tactical Boards (Dual Side-by-Side Boards OR Single Board) + Full-Control Side Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 rounded-xl overflow-hidden border border-white/[0.12] bg-[#061A13] shadow-xl">
          {teamDisplay === "dual" ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x xl:divide-x-reverse divide-white/[0.12]">
              {/* Board 1: Own Team */}
              <div className="bg-[#061A13]">
                <div className="px-3 py-2 bg-[#090D16] border-b border-white/[0.08] flex items-center justify-between text-xs">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: blueprint?.kit_colors?.team_a_hex || "#EF4444" }}
                    />
                    <span>
                      {isAr
                        ? `السبورة 1: تمركز ومهام ${blueprint?.team_name || "فريقي"}`
                        : `Board 1: ${blueprint?.team_name || "Own Team"}`}
                    </span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 font-bold tabular-nums text-[11px]">
                    <bdi dir="ltr">{formationA}</bdi>
                  </span>
                </div>
                <canvas
                  ref={canvasRef}
                  width={680}
                  height={440}
                  onMouseDown={(e) => handleMouseDown(e, "team_a")}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  className={`w-full block ${
                    drawTool === "drag_player" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
                  }`}
                />
              </div>

              {/* Board 2: Opponent Team */}
              <div className="bg-[#061A13]">
                <div className="px-3 py-2 bg-[#090D16] border-b border-white/[0.08] flex items-center justify-between text-xs">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: blueprint?.kit_colors?.team_b_hex || "#38BDF8" }}
                    />
                    <span>
                      {isAr
                        ? `السبورة 2: تمركز وتشكيل ${blueprint?.opponent_name || "الخصم"}`
                        : `Board 2: ${blueprint?.opponent_name || "Opponent"}`}
                    </span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/35 text-sky-300 font-bold tabular-nums text-[11px]">
                    <bdi dir="ltr">{formationB}</bdi>
                  </span>
                </div>
                <canvas
                  ref={canvasBRef}
                  width={680}
                  height={440}
                  onMouseDown={(e) => handleMouseDown(e, "team_b")}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  className={`w-full block ${
                    drawTool === "drag_player" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
                  }`}
                />
              </div>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={760}
              height={470}
              onMouseDown={(e) => handleMouseDown(e, teamDisplay)}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={`w-full block ${
                drawTool === "drag_player" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"
              }`}
            />
          )}
          <div className="px-3 py-2 bg-[#090D16] border-t border-white/[0.06] space-y-2 text-[11px]">
            {/* V8.5 Keyframe Tactical Animation Timeline (TacticalPad / Metrica Nexus style!) */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <GlossaryTooltip term="keyframe" lang={lang}>
                  <span className="font-bold text-emerald-300 flex items-center gap-1">
                    <Film className="w-3.5 h-3.5" />
                    {isAr ? "تحريك الخطة (المراحل):" : "Animation Phases:"}
                  </span>
                </GlossaryTooltip>
                {keyframes.map((kf, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => selectKeyframe(idx)}
                    className={`px-2 py-0.5 rounded font-bold transition ${
                      activeKfIdx === idx && !isAnimating
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-[#111827] text-slate-300 border border-white/10 hover:text-white"
                    }`}
                  >
                    {kf.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => captureKeyframe(true)}
                  className="px-2.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold"
                >
                  + {isAr ? `إضافة المرحلة ${keyframes.length + 1}` : `Add Phase ${keyframes.length + 1}`}
                </button>
                {keyframes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => captureKeyframe(false)}
                    className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 font-semibold"
                  >
                    {isAr ? "تحديث المرحلة" : "Update"}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={keyframes.length < 2}
                  onClick={() => setIsAnimating((v) => !v)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-35 text-slate-950 font-extrabold flex items-center gap-1"
                >
                  {isAnimating ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  <span>
                    {isAnimating
                      ? isAr ? `إيقاف (${(animStepProgress + 1).toFixed(1)})` : "Stop"
                      : isAr ? "تشغيل الحركة" : "Animate"}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={keyframes.length < 2 || recordingVideo}
                  onClick={() => handleRecordAnimatedVideo("mp4")}
                  className="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 disabled:opacity-35 border border-sky-400/40 text-sky-300 font-bold"
                >
                  {recordingVideo ? (isAr ? "جاري التحويل..." : "Converting...") : isAr ? "تصدير فيديو MP4" : "Export MP4"}
                </button>
                <button
                  type="button"
                  disabled={keyframes.length < 2 || recordingVideo}
                  onClick={() => handleRecordAnimatedVideo("gif")}
                  className="px-2 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-35 border border-purple-400/40 text-purple-200 font-bold"
                >
                  GIF
                </button>
                {onAttachBoardSlide && (
                  <button
                    type="button"
                    onClick={() => {
                      const cvs = canvasRef.current;
                      if (cvs) {
                        onAttachBoardSlide(cvs.toDataURL("image/png"));
                        setSaveBanner(isAr ? "تم إدراج شريحة السبورة في محاضرة غرفة الملابس" : "Slide added to Locker-Room Lecture");
                        setTimeout(() => setSaveBanner(null), 2600);
                      }
                    }}
                    className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-bold"
                  >
                    {isAr ? "إدراج كشريحة للمحاضرة" : "Add Lecture Slide"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-slate-400">
              <span>
                {isAr
                  ? "اسحب أي لاعب في أي من السبورتين بالماوس لتعديل تمركزه — واستخدم Ctrl+Z للتراجع."
                  : "Drag any player on either board to adjust positioning — press Ctrl+Z / Ctrl+Y for Undo/Redo."}
              </span>
              <span className="tabular-nums text-emerald-400 font-semibold">
                <bdi dir="ltr">{formationA}</bdi> vs <bdi dir="ltr">{formationB}</bdi>
              </span>
            </div>
          </div>
        </div>

        {blueprint && (
          <div className="lg:col-span-4 space-y-3 text-xs">
            {/* V8.5 Deterministic Tactical Math Validator (Math-First Audit!) */}
            <TacticalMathValidatorCard lang={lang} validation={mathValidation || blueprint.math_validation || null} />
            {/* Editable Plan Title & Philosophy */}
            <div className="p-3.5 rounded-xl bg-[#090D16] border border-emerald-500/30 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="font-extrabold text-emerald-300 leading-snug min-w-[200px] flex-1">
                  {blueprint.title_ar}
                </span>
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
                    {editingPlanText ? (isAr ? "إغلاق التعديل" : "Done") : isAr ? "تعديل النص" : "Edit"}
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

              {blueprint.passing_arrows && blueprint.passing_arrows.length > 0 && (
                <div className="pt-2 border-t border-white/[0.06] space-y-1">
                  <div className="text-[10.5px] font-extrabold text-amber-300">
                    {isAr ? "قنوات التمرير واحتمالات النجاح (xPass):" : "Passing Lanes & xPass Probabilities:"}
                  </div>
                  <div className="space-y-1">
                    {blueprint.passing_arrows.slice(0, 6).map((pa, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 text-[10.5px] bg-[#111827]/75 rounded px-2 py-1 border border-white/[0.05]"
                      >
                        <span className="text-slate-200 truncate">
                          {isAr ? pa.label_ar : pa.label_en || pa.label_ar}
                        </span>
                        <span dir="ltr" className="shrink-0 font-extrabold tabular-nums text-emerald-300">
                          {typeof pa.xpass_pct === "number" ? `${Math.round(pa.xpass_pct)}% xPass` : "—"}
                          {typeof pa.obv_delta === "number"
                            ? ` (${pa.obv_delta >= 0 ? "+" : ""}${pa.obv_delta.toFixed(2)})`
                            : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
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
                  <optgroup label={`${blueprint.team_name || "فريقي"} (${nodesA.length})`}>
                    {nodesA.map((n, i) => (
                      <option key={`a-${i}`} value={`team_a:${i}`}>
                        #{n.jersey_number ?? i + 1} • {n.slot} — {n.player_label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={`${blueprint.opponent_name || "الخصم"} (${nodesB.length})`}>
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
