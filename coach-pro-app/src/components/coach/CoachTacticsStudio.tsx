"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Bot,
  Camera,
  Download,
  Eraser,
  Film,
  Flame,
  FolderOpen,
  Grid,
  Link2,
  Move,
  MoveUpRight,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Shield,
  SlidersHorizontal,
  Square,
  Star,
  Swords,
  Trash2,
  Undo2,
  UserPlus,
  Users,
  X,
  Zap,
} from "lucide-react";
import { apiFetch, BlueprintNode, MathValidationResult } from "@/lib/api";
import { deleteLocalPlan, loadGeneralPlan, loadSavedPlans, saveGeneralPlan, saveLocalPlan } from "@/lib/coachStorage";
import {
  CoachClubDetail,
  CoachPlayer,
  EditableArrow,
  EditableZone,
  FreehandStroke,
  getShortArabicName,
  isLightHex,
  LineupSwapSuggestion,
  MatchSimulationResult,
  PitchExtraMarker,
  PlayerTacticalLink,
  SavedTacticalPlan,
  TacticalPhaseId,
  TacticalPhaseSnapshot,
  ThreePhaseBlueprint,
} from "./coachTypes";

interface Props {
  lang: "ar" | "en";
  club: CoachClubDetail;
  opponent: CoachClubDetail;
  defaultFormation: string;
  externalBlueprint?: ThreePhaseBlueprint | null;
  generalPlan?: SavedTacticalPlan | null;
  onFormationChange?: (formation: string) => void;
  onGeneralPlanSaved?: (plan: SavedTacticalPlan) => void;
  onOpenOpponentPicker?: () => void;
  onAskAiAboutPlayer?: (player: CoachPlayer, ownerClub: CoachClubDetail) => void;
}

type ToolMode =
  | "drag"
  | "swap_players"
  | "eraser"
  | "link_players"
  | "pass_arrow"
  | "run_arrow"
  | "press_arrow"
  | "zone"
  | "freehand"
  | "add_player"
  | "add_ball"
  | "add_cone";
type DisplayMode = "both" | "team_a" | "team_b";

const COLOR_SWATCHES = ["#FACC15", "#EF4444", "#38BDF8", "#22C55E", "#FFFFFF", "#F97316", "#A855F7", "#0F172A"];

const TEAM_SIZES = [5, 6, 7, 8, 9, 10, 11] as const;
const SIZE_FORMATIONS: Record<number, string[]> = {
  5: ["1-2-1", "2-2", "1-1-2"],
  6: ["2-2-1", "2-1-2"],
  7: ["2-3-1", "3-2-1"],
  8: ["3-3-1", "2-3-2"],
  9: ["3-3-2", "3-2-3"],
  10: ["3-4-2", "4-3-2"],
  11: ["4-2-3-1", "4-3-3", "3-4-2-1", "3-2-4-1", "3-5-2", "4-4-2", "5-3-2"],
};
const EDITABLE_SLOTS = [
  "GK", "CB", "RCB", "LCB", "CCB", "RB", "LB", "RWB", "LWB",
  "DM", "RDM", "LDM", "CDM", "CM", "RCM", "LCM", "CAM", "RAM", "LAM",
  "RM", "LM", "RW", "LW", "ST", "RST", "LST", "FIX", "ALA", "PIV",
];
const PHASE_META: Array<{ id: TacticalPhaseId; ar: string; en: string; color: string }> = [
  { id: "attack", ar: "1. الهجوم والإنهاء", en: "1. Attack", color: "#D97706" },
  { id: "possession", ar: "2. الاستحواذ والبناء", en: "2. Possession", color: "#15803D" },
  { id: "defense", ar: "3. الدفاع وقطع الكرة", en: "3. Defense", color: "#DC2626" },
];
const PRESET_BUTTONS = [
  { label: "3-4-2-1", prompt: "3-4-2-1" },
  { label: "3-2-4-1", prompt: "3-2-4-1" },
  { label: "4-3-3", prompt: "4-3-3" },
  { label: "3-5-2", prompt: "3-5-2" },
];

type SelectedElement =
  | { kind: "node"; team: "team_a" | "team_b"; index: number }
  | { kind: "arrow"; idx: number; isOpp: boolean }
  | { kind: "link"; id: string }
  | { kind: "zone"; idx: number }
  | { kind: "stroke"; id: string }
  | { kind: "marker"; id: string }
  | null;

interface MorphDisplayFrame {
  nodesA: BlueprintNode[];
  nodesB: BlueprintNode[];
  arrowsA?: EditableArrow[];
  zones?: EditableZone[];
  strokes?: FreehandStroke[];
  markers?: PitchExtraMarker[];
}

function clonePhase(p: TacticalPhaseSnapshot): TacticalPhaseSnapshot {
  return JSON.parse(JSON.stringify(p));
}

export default function CoachTacticsStudio({
  lang,
  club,
  opponent,
  defaultFormation,
  externalBlueprint = null,
  generalPlan = null,
  onFormationChange,
  onGeneralPlanSaved,
  onOpenOpponentPicker,
  onAskAiAboutPlayer,
}: Props) {
  const isAr = lang === "ar";
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);
  const [teamSize, setTeamSize] = useState<number>(11);
  const [formA, setFormA] = useState(defaultFormation || "4-2-3-1");
  const [formB, setFormB] = useState("4-4-2");
  const [activePhase, setActivePhase] = useState<TacticalPhaseId>("possession");
  const [phases, setPhases] = useState<Record<TacticalPhaseId, TacticalPhaseSnapshot> | null>(null);
  const [undoStack, setUndoStack] = useState<Record<TacticalPhaseId, TacticalPhaseSnapshot>[]>([]);

  const [tool, setTool] = useState<ToolMode>("drag");
  const [swapPending, setSwapPending] = useState<{ team: "team_a" | "team_b"; index: number; label: string } | null>(null);
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapSearch, setSwapSearch] = useState("");
  const [swapPosTab, setSwapPosTab] = useState<"ALL" | "GK" | "DEF" | "MID" | "ATT">("ALL");
  const [savedPlans, setSavedPlans] = useState<SavedTacticalPlan[]>([]);
  const [plansDrawerOpen, setPlansDrawerOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("both");
  const [showChannelsGrid, setShowChannelsGrid] = useState<boolean>(true);
  const [syncSlotAllPhases, setSyncSlotAllPhases] = useState<boolean>(true);
  const [selectedEl, setSelectedEl] = useState<SelectedElement>(null);
  const [linkPending, setLinkPending] = useState<{ team: "team_a" | "team_b"; slot: string } | null>(null);
  const [linkKind, setLinkKind] = useState<"pass" | "support" | "mark">("pass");
  const [drawColor, setDrawColor] = useState("#E0A526");
  const [liveFreehand, setLiveFreehand] = useState<Array<{ x: number; y: number }>>([]);
  const [keyframes, setKeyframes] = useState<Array<{ nodesA: BlueprintNode[]; nodesB: BlueprintNode[] }>>([]);
  const [playingKeyframes, setPlayingKeyframes] = useState(false);

  const [isMorphing, setIsMorphing] = useState(false);
  const [morphDisplay, setMorphDisplay] = useState<MorphDisplayFrame | null>(null);
  const [mathScore, setMathScore] = useState<MathValidationResult | null>(null);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showPlayerCards, setShowPlayerCards] = useState<boolean>(true);
  const [imgTick, setImgTick] = useState<number>(0);
  const imgCacheRef = useRef<Map<string, HTMLImageElement | "error">>(new Map());
  const [lineHeight, setLineHeight] = useState<"low" | "mid" | "high">(
    club.tactical_profile?.line_height || "mid"
  );
  const [pressingStyle, setPressingStyle] = useState<"contain" | "trigger" | "gegenpress">(
    club.tactical_profile?.pressing_style || "trigger"
  );

  const [simMode, setSimMode] = useState<string>("full_match");
  const [simRes, setSimRes] = useState<MatchSimulationResult | null>(null);
  const [runningSim, setRunningSim] = useState(false);

  const [swapAdvisor, setSwapAdvisor] = useState<{
    squad_fit_score: number;
    current_issues_ar: string[];
    suggestions: LineupSwapSuggestion[];
    summary_ar: string;
  } | null>(null);
  const [loadingSwaps, setLoadingSwaps] = useState(false);

  const cvsRef = useRef<HTMLCanvasElement | null>(null);
  const dragNodeRef = useRef<{ team: "team_a" | "team_b"; index: number } | null>(null);
  const dragMarkerRef = useRef<string | null>(null);
  const draftBoxRef = useRef<{ sx: number; sy: number; cx: number; cy: number } | null>(null);
  const freehandDraftRef = useRef<Array<{ x: number; y: number }> | null>(null);

  const loadBlueprintFromApi = async (fA: string, fB: string, presetPrompt = "", tSize = teamSize) => {
    try {
      const bp = await apiFetch<ThreePhaseBlueprint>(
        "/api/coach/tactics/blueprint",
        {
          method: "POST",
          body: JSON.stringify({
            club_id: club.club_id,
            opponent_id: opponent.club_id,
            team_size: tSize,
            formation_code: fA,
            opponent_formation_code: fB,
            masterclass_prompt: presetPrompt,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      if (bp.phase_states) {
        setPhases(bp.phase_states);
        setFormA(bp.formation_code);
        if (bp.opponent_formation_code) setFormB(bp.opponent_formation_code);
        if (bp.team_size) setTeamSize(bp.team_size);
        setSelectedEl(null);
        setUndoStack([]);
      }
    } catch {}
  };

  useEffect(() => {
    if (defaultFormation && teamSize === 11 && defaultFormation !== formA) {
      setFormA(defaultFormation);
      loadBlueprintFromApi(defaultFormation, formB, "", 11);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFormation]);

  useEffect(() => {
    if (externalBlueprint?.phase_states) {
      setPhases(externalBlueprint.phase_states);
      setFormA(externalBlueprint.formation_code);
      if (externalBlueprint.opponent_formation_code) setFormB(externalBlueprint.opponent_formation_code);
      setSelectedEl(null);
      setUndoStack([]);
    }
  }, [externalBlueprint]);

  useEffect(() => {
    if (!externalBlueprint?.phase_states) {
      loadBlueprintFromApi(formA, formB);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.club_id, opponent.club_id]);

  const currentPhase = phases?.[activePhase] || null;

  // Validate tactical geometry whenever current phase nodes change
  useEffect(() => {
    if (!currentPhase || currentPhase.nodes.length === 0) return;
    const t = setTimeout(() => {
      apiFetch<MathValidationResult>(
        "/api/plans/validate",
        {
          method: "POST",
          body: JSON.stringify({
            nodes_a: currentPhase.nodes,
            nodes_b: currentPhase.opponent_nodes,
            formation_code: formA,
          }),
        },
        "club_demo_egypt",
        "coach"
      )
        .then((res) => setMathScore(res))
        .catch(() => {});
    }, 260);
    return () => clearTimeout(t);
  }, [currentPhase, formA]);

  // Preload player portrait photos for Broadcast Face Cards on canvas
  useEffect(() => {
    const urls = new Set<string>();
    for (const p of [...(club.players || []), ...(opponent.players || [])]) {
      if (p.photo_url) urls.add(p.photo_url);
    }
    urls.forEach((url) => {
      if (imgCacheRef.current.has(url)) return;
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        imgCacheRef.current.set(url, img);
        setImgTick((t) => t + 1);
      };
      img.onerror = () => {
        imgCacheRef.current.set(url, "error");
      };
      img.src = url;
    });
  }, [club.players, opponent.players]);

  // Allow Delete / Backspace key to remove any selected drawing or marker directly
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      const tag = (ev.target as HTMLElement | null)?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (selectedEl && selectedEl.kind !== "node") {
        ev.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEl, currentPhase]);

  // 3-Phase Smooth Morph Playback Animation (Attack -> Possession -> Defense — including Players, Arrows, Zones, Chalk Strokes & Markers)
  useEffect(() => {
    if (!isMorphing || !phases) return;
    const seq: TacticalPhaseId[] = ["attack", "possession", "defense", "attack"];
    const segMs = 1550;
    const startTs = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = (now - startTs) % ((seq.length - 1) * segMs);
      const seg = Math.floor(elapsed / segMs);
      const u = (elapsed - seg * segMs) / segMs;
      const ease = u * u * (3 - 2 * u);
      const p0 = phases[seq[seg]];
      const p1 = phases[seq[seg + 1]];
      if (p0 && p1) {
        const lerp = (a: BlueprintNode[], b: BlueprintNode[]) =>
          a.map((n, i) => {
            const t = b[i] || n;
            return {
              ...n,
              x_m: n.x_m + (t.x_m - n.x_m) * ease,
              y_m: n.y_m + (t.y_m - n.y_m) * ease,
            };
          });
        const lNodesA = lerp(p0.nodes, p1.nodes);
        const lNodesB = lerp(p0.opponent_nodes, p1.opponent_nodes);

        const bySlotA = new Map(lNodesA.map((n) => [n.slot, n]));
        const bySlotB = new Map(lNodesB.map((n) => [n.slot, n]));

        // Average team X/Y shift so unanchored custom drawings move dynamically with the team!
        const avgX0 = p0.nodes.reduce((s, n) => s + n.x_m, 0) / Math.max(1, p0.nodes.length);
        const avgX1 = p1.nodes.reduce((s, n) => s + n.x_m, 0) / Math.max(1, p1.nodes.length);
        const avgY0 = p0.nodes.reduce((s, n) => s + n.y_m, 0) / Math.max(1, p0.nodes.length);
        const avgY1 = p1.nodes.reduce((s, n) => s + n.y_m, 0) / Math.max(1, p1.nodes.length);
        const dxTeam = (avgX1 - avgX0) * ease;
        const dyTeam = (avgY1 - avgY0) * ease;

        const baseArr0 = [...p0.passing_arrows, ...p0.custom_arrows];
        const baseArr1 = [...p1.passing_arrows, ...p1.custom_arrows];
        const morphedArrows: EditableArrow[] = baseArr0.map((a, idx) => {
          const fromN = a.from_slot ? bySlotA.get(a.from_slot) : undefined;
          const toN = a.to_slot ? (bySlotA.get(a.to_slot) || bySlotB.get(a.to_slot)) : undefined;
          if (fromN || toN) {
            return {
              ...a,
              from_x_m: fromN ? fromN.x_m : a.from_x_m + dxTeam,
              from_y_m: fromN ? fromN.y_m : a.from_y_m + dyTeam,
              to_x_m: toN ? toN.x_m : a.to_x_m + dxTeam,
              to_y_m: toN ? toN.y_m : a.to_y_m + dyTeam,
            };
          }
          const tA = baseArr1[idx];
          if (tA) {
            return {
              ...a,
              from_x_m: a.from_x_m + (tA.from_x_m - a.from_x_m) * ease,
              from_y_m: a.from_y_m + (tA.from_y_m - a.from_y_m) * ease,
              to_x_m: a.to_x_m + (tA.to_x_m - a.to_x_m) * ease,
              to_y_m: a.to_y_m + (tA.to_y_m - a.to_y_m) * ease,
            };
          }
          return {
            ...a,
            from_x_m: a.from_x_m + dxTeam,
            from_y_m: a.from_y_m + dyTeam,
            to_x_m: a.to_x_m + dxTeam,
            to_y_m: a.to_y_m + dyTeam,
          };
        });

        const morphedZones: EditableZone[] = p0.custom_zones.map((z, idx) => {
          const tz = p1.custom_zones[idx];
          if (tz) {
            return {
              ...z,
              x1_m: z.x1_m + (tz.x1_m - z.x1_m) * ease,
              y1_m: z.y1_m + (tz.y1_m - z.y1_m) * ease,
              x2_m: z.x2_m + (tz.x2_m - z.x2_m) * ease,
              y2_m: z.y2_m + (tz.y2_m - z.y2_m) * ease,
            };
          }
          return { ...z, x1_m: z.x1_m + dxTeam, x2_m: z.x2_m + dxTeam, y1_m: z.y1_m + dyTeam, y2_m: z.y2_m + dyTeam };
        });

        const morphedStrokes: FreehandStroke[] = (p0.freehand_strokes || []).map((st) => ({
          ...st,
          points: st.points.map((pt) => ({ x: pt.x + dxTeam, y: pt.y + dyTeam })),
        }));

        const morphedMarkers: PitchExtraMarker[] = (p0.extra_markers || []).map((mk, idx) => {
          const tm = (p1.extra_markers || [])[idx];
          if (tm) {
            return { ...mk, x_m: mk.x_m + (tm.x_m - mk.x_m) * ease, y_m: mk.y_m + (tm.y_m - mk.y_m) * ease };
          }
          return { ...mk, x_m: mk.x_m + dxTeam, y_m: mk.y_m + dyTeam };
        });

        setMorphDisplay({
          nodesA: lNodesA,
          nodesB: lNodesB,
          arrowsA: morphedArrows,
          zones: morphedZones,
          strokes: morphedStrokes,
          markers: morphedMarkers,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setMorphDisplay(null);
    };
  }, [isMorphing, phases]);

  // Custom Keyframe Sequencer Playback
  useEffect(() => {
    if (!playingKeyframes || keyframes.length < 2) return;
    const segMs = 1350;
    const startTs = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const totalSegs = keyframes.length - 1;
      const elapsed = (now - startTs) % (totalSegs * segMs);
      const seg = Math.floor(elapsed / segMs);
      const u = (elapsed - seg * segMs) / segMs;
      const ease = u * u * (3 - 2 * u);
      const f0 = keyframes[seg];
      const f1 = keyframes[seg + 1];
      if (f0 && f1) {
        const lerp = (a: BlueprintNode[], b: BlueprintNode[]) =>
          a.map((n, i) => {
            const t = b[i] || n;
            return { ...n, x_m: n.x_m + (t.x_m - n.x_m) * ease, y_m: n.y_m + (t.y_m - n.y_m) * ease };
          });
        setMorphDisplay({ nodesA: lerp(f0.nodesA, f1.nodesA), nodesB: lerp(f0.nodesB, f1.nodesB) });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setMorphDisplay(null);
    };
  }, [playingKeyframes, keyframes]);

  const commitPhaseEdit = (mutator: (p: TacticalPhaseSnapshot) => TacticalPhaseSnapshot) => {
    if (!phases) return;
    setUndoStack((prev) => [...prev.slice(-24), JSON.parse(JSON.stringify(phases))]);
    setPhases((prev) => {
      if (!prev) return prev;
      return { ...prev, [activePhase]: mutator(clonePhase(prev[activePhase])) };
    });
  };

  const handleUndo = () => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setPhases(last);
      return prev.slice(0, -1);
    });
  };

  // High-DPI Broadcast Pitch Drawing Loop (2x resolution crispness + Face Cards + Heatmap + Extra Markers)
  const renderPitchScene = (
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    includeSelectedOutline = true,
    allowPortraits = true
  ) => {
    if (!currentPhase) return;
    const pad = 26;
    const pw = W - pad * 2;
    const ph = H - pad * 2;
    const toPx = (xm: number, ym: number) => ({ x: pad + (xm / 105) * pw, y: pad + (ym / 68) * ph });

    // Rich Broadcast Stadium Turf Stripes + Subtle Vignette
    ctx.fillStyle = "#147A3A";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#166534" : "#15803D";
      ctx.fillRect(pad + (i * pw) / 12, pad, pw / 12, ph);
    }

    // FIFA markings
    ctx.strokeStyle = "rgba(255,255,255,0.88)";
    ctx.lineWidth = 1.8;
    ctx.strokeRect(pad, pad, pw, ph);
    ctx.beginPath();
    ctx.moveTo(W / 2, pad);
    ctx.lineTo(W / 2, H - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, ph * (9.15 / 68), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fill();
    const boxW = pw * (16.5 / 105);
    const boxH = ph * (40.32 / 68);
    ctx.strokeRect(pad, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - pad - boxW, (H - boxH) / 2, boxW, boxH);
    const sixW = pw * (5.5 / 105);
    const sixH = ph * (18.32 / 68);
    ctx.strokeRect(pad, (H - sixH) / 2, sixW, sixH);
    ctx.strokeRect(W - pad - sixW, (H - sixH) / 2, sixW, sixH);

    // 5-Channel Positional Play Grid
    if (showChannelsGrid) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      [13.84, 24.5, 43.5, 54.16].forEach((ym) => {
        const pL = toPx(0, ym);
        const pR = toPx(105, ym);
        ctx.beginPath();
        ctx.moveTo(pL.x, pL.y);
        ctx.lineTo(pR.x, pR.y);
        ctx.stroke();
      });
      [35.0, 70.0].forEach((xm) => {
        const pT = toPx(xm, 0);
        const pB = toPx(xm, 68);
        ctx.beginPath();
        ctx.moveTo(pT.x, pT.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      });
      ctx.restore();
    }

    const nodesA = morphDisplay ? morphDisplay.nodesA : currentPhase.nodes;
    const nodesB = morphDisplay ? morphDisplay.nodesB : currentPhase.opponent_nodes;

    // Optional Tactical Team Activity Heatmap Overlay
    if (showHeatmap && displayMode !== "team_b") {
      ctx.save();
      nodesA.forEach((n) => {
        const pt = toPx(n.x_m, n.y_m);
        const rad = n.slot === "GK" ? 42 : 68;
        const grad = ctx.createRadialGradient(pt.x, pt.y, 4, pt.x, pt.y, rad);
        grad.addColorStop(0, "rgba(239, 68, 68, 0.42)");
        grad.addColorStop(0.45, "rgba(245, 158, 11, 0.22)");
        grad.addColorStop(1, "rgba(245, 158, 11, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    // Custom / Tactical Zones (Morph-aware + preserves user-selected color)
    const activeZones = morphDisplay?.zones ?? currentPhase.custom_zones;
    activeZones.forEach((z, idx) => {
      const p1 = toPx(Math.min(z.x1_m, z.x2_m), Math.min(z.y1_m, z.y2_m));
      const p2 = toPx(Math.max(z.x1_m, z.x2_m), Math.max(z.y1_m, z.y2_m));
      const isSel = includeSelectedOutline && selectedEl?.kind === "zone" && selectedEl.idx === idx;
      const zCol = z.color || "#F59E0B";
      ctx.save();
      ctx.fillStyle = `${zCol}33`;
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      if (isSel) {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 4.2;
        ctx.setLineDash([]);
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      }
      ctx.strokeStyle = zCol;
      ctx.lineWidth = isSel ? 2.2 : 1.8;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(z.label_ar || "Zone", p1.x + 6, p1.y + 14);
      ctx.restore();
    });

    const findNode = (team: "team_a" | "team_b", slot: string) =>
      (team === "team_a" ? nodesA : nodesB).find((n) => n.slot === slot);

    // Passing & Custom Arrows (Morph-aware)
    const allArrows: Array<{ ar: EditableArrow; idx: number; isOpp: boolean }> = morphDisplay?.arrowsA
      ? morphDisplay.arrowsA.map((ar, idx) => ({ ar, idx, isOpp: false }))
      : [
          ...(displayMode !== "team_b" ? currentPhase.passing_arrows.map((ar, idx) => ({ ar, idx, isOpp: false })) : []),
          ...(displayMode !== "team_b" ? currentPhase.custom_arrows.map((ar, idx) => ({ ar, idx: idx + 1000, isOpp: false })) : []),
          ...(displayMode !== "team_a" ? (currentPhase.opponent_passing_arrows || []).map((ar, idx) => ({ ar, idx, isOpp: true })) : []),
        ];

    const drawArrowLine = (fx: number, fy: number, tx: number, ty: number, col: string, dashed: boolean, labelTxt?: string, highlighted = false) => {
      const a = toPx(fx, fy);
      const b = toPx(tx, ty);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 6) return;
      ctx.save();
      if (highlighted) {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = highlighted ? 2.8 : 2.3;
      if (dashed) ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - 10 * Math.cos(ang - 0.42), b.y - 10 * Math.sin(ang - 0.42));
      ctx.lineTo(b.x - 10 * Math.cos(ang + 0.42), b.y - 10 * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      if (labelTxt) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.fillStyle = "rgba(15,23,42,0.90)";
        ctx.fillRect(mx - 26, my - 9, 52, 17);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.strokeRect(mx - 26, my - 9, 52, 17);
        ctx.fillStyle = "#F8FAFC";
        ctx.font = "bold 9.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labelTxt, mx, my);
      }
      ctx.restore();
    };

    allArrows.forEach(({ ar, idx, isOpp }) => {
      const isSel = includeSelectedOutline && selectedEl?.kind === "arrow" && selectedEl.idx === idx && selectedEl.isOpp === isOpp;
      const badge = ar.xpass_pct ? `${ar.xpass_pct}%` : ar.label_ar ? ar.label_ar.slice(0, 10) : undefined;
      drawArrowLine(ar.from_x_m, ar.from_y_m, ar.to_x_m, ar.to_y_m, ar.color || (isOpp ? "#38BDF8" : "#FACC15"), ar.kind !== "pass", badge, isSel);
    });

    // Player-to-Player Custom Links
    currentPhase.custom_links.forEach((lk) => {
      const n1 = findNode(lk.fromTeam, lk.fromSlot);
      const n2 = findNode(lk.toTeam, lk.toSlot);
      if (!n1 || !n2) return;
      const dist = Math.hypot(n2.x_m - n1.x_m, n2.y_m - n1.y_m).toFixed(1);
      const isSel = includeSelectedOutline && selectedEl?.kind === "link" && selectedEl.id === lk.id;
      const badgeTxt = lk.label ? `${lk.label} (${dist}m)` : `${dist}m`;
      drawArrowLine(n1.x_m, n1.y_m, n2.x_m, n2.y_m, lk.color, lk.kind !== "pass", badgeTxt, isSel);
    });

    // Freehand Chalk Strokes (Morph-aware + always renders chosen color clearly)
    const strokes: FreehandStroke[] = [
      ...(morphDisplay?.strokes ?? (currentPhase.freehand_strokes || [])),
      ...(liveFreehand.length >= 2 ? [{ id: "__draft__", points: liveFreehand, color: drawColor, width: 3.4 }] : []),
    ];
    strokes.forEach((st) => {
      if (!st.points || st.points.length < 2) return;
      const isSel = includeSelectedOutline && selectedEl?.kind === "stroke" && selectedEl.id === st.id;
      const sCol = st.color || "#FACC15";
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (isSel) {
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = (st.width || 3.4) + 3.5;
        ctx.beginPath();
        st.points.forEach((pt, idx) => {
          const px = toPx(pt.x, pt.y);
          if (idx === 0) ctx.moveTo(px.x, px.y);
          else ctx.lineTo(px.x, px.y);
        });
        ctx.stroke();
      }
      ctx.strokeStyle = sCol;
      ctx.lineWidth = st.width || 3.4;
      ctx.beginPath();
      st.points.forEach((pt, idx) => {
        const px = toPx(pt.x, pt.y);
        if (idx === 0) ctx.moveTo(px.x, px.y);
        else ctx.lineTo(px.x, px.y);
      });
      ctx.stroke();
      ctx.restore();
    });

    // Extra Markers (Balls & Cones — Morph-aware, draggable, erasable)
    const activeMarkers = morphDisplay?.markers ?? (currentPhase.extra_markers || []);
    activeMarkers.forEach((mk) => {
      const pt = toPx(mk.x_m, mk.y_m);
      const isSel = includeSelectedOutline && selectedEl?.kind === "marker" && selectedEl.id === mk.id;
      ctx.save();
      if (isSel) {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (mk.kind === "cone") {
        ctx.fillStyle = mk.color || "#F97316";
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - 8);
        ctx.lineTo(pt.x - 7, pt.y + 7);
        ctx.lineTo(pt.x + 7, pt.y + 7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#0F172A";
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.restore();
    });

    const drawPlayers = (list: BlueprintNode[], team: "team_a" | "team_b", hex: string) => {
      const lightKit = isLightHex(hex);
      const roster = team === "team_a" ? club.players : opponent.players;
      list.forEach((n, idx) => {
        const pt = toPx(n.x_m, n.y_m);
        const isSel = includeSelectedOutline && selectedEl?.kind === "node" && selectedEl.team === team && selectedEl.index === idx;
        const isPendingLink = includeSelectedOutline && linkPending && linkPending.team === team && linkPending.slot === n.slot;
        const darkInk = n.slot === "GK" || lightKit;
        const matchedPl = roster.find(
          (pl) =>
            (n.jersey_number != null && pl.jersey_number === n.jersey_number) ||
            (n.player_label && (pl.name_ar === n.player_label || pl.name_en === n.player_label))
        );
        const cachedImg =
          allowPortraits && showPlayerCards && matchedPl?.photo_url
            ? imgCacheRef.current.get(matchedPl.photo_url)
            : undefined;
        const hasPortrait = Boolean(
          cachedImg && cachedImg !== "error" && cachedImg.complete && cachedImg.naturalWidth > 0
        );

        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.28)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        if (isSel || isPendingLink) {
          ctx.strokeStyle = isPendingLink ? "#22C55E" : "#FACC15";
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, hasPortrait ? 21.5 : 19, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (hasPortrait && cachedImg && cachedImg !== "error") {
          const rad = 16.5;
          ctx.save();
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2);
          ctx.closePath();
          ctx.fillStyle = "#FFFFFF";
          ctx.fill();
          ctx.clip();
          ctx.drawImage(cachedImg, pt.x - rad, pt.y - rad, rad * 2, rad * 2);
          ctx.restore();

          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
          ctx.strokeStyle = n.slot === "GK" ? "#EAB308" : hex;
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2);
          ctx.stroke();

          const jTxt = String(n.jersey_number ?? n.slot);
          ctx.fillStyle = "#0F172A";
          ctx.beginPath();
          ctx.arc(pt.x + 12.5, pt.y + 11.5, 7.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 8.5px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(jTxt, pt.x + 12.5, pt.y + 11.7);
        } else {
          ctx.fillStyle = n.slot === "GK" ? "#EAB308" : hex;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
          ctx.strokeStyle = darkInk ? "#0F172A" : "#FFFFFF";
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = darkInk ? "#0F172A" : "#FFFFFF";
          ctx.font = "bold 10.5px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(n.jersey_number || n.slot), pt.x, pt.y);
        }

        // Editable position tag pill above circle/card
        const slotY = hasPortrait ? pt.y - 29 : pt.y - 26;
        const slotTxt = String(n.slot || "").slice(0, 6);
        ctx.font = "bold 8.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const sw = Math.max(24, ctx.measureText(slotTxt).width + 8);
        ctx.fillStyle = team === "team_a" ? "#0F172A" : "#FFFFFF";
        ctx.fillRect(pt.x - sw / 2, slotY, sw, 11);
        ctx.fillStyle = team === "team_a" ? "#86EFAC" : "#0F172A";
        ctx.fillText(slotTxt, pt.x, slotY + 5.5);

        // Full 2-word clear Arabic player name pill below card
        const nameY = hasPortrait ? pt.y + 18 : pt.y + 15;
        const rawNm = (n.player_label || n.slot).trim();
        const words = rawNm.split(/\s+/).filter(Boolean);
        const fullNm = words.length <= 2 ? rawNm : `${words[0]} ${words[words.length - 1]}`;
        ctx.font = "bold 9.5px sans-serif";
        const nw = Math.max(46, Math.min(118, ctx.measureText(fullNm).width + 12));
        ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
        ctx.fillRect(pt.x - nw / 2, nameY, nw, 15);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(fullNm, pt.x, nameY + 7.5);
        ctx.restore();
      });
    };

    if (displayMode !== "team_b") drawPlayers(nodesA, "team_a", club.kit_hex || "#DC2626");
    if (displayMode !== "team_a") drawPlayers(nodesB, "team_b", opponent.kit_hex || "#0284C7");
  };

  useEffect(() => {
    const cvs = cvsRef.current;
    if (!cvs || !currentPhase) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    renderPitchScene(ctx, 960, 590, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhase, morphDisplay, displayMode, showChannelsGrid, showHeatmap, showPlayerCards, imgTick, selectedEl, linkPending, club.kit_hex, opponent.kit_hex, liveFreehand, drawColor]);

  const toMetersFromEvent = (e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>) => {
    const cvs = cvsRef.current!;
    const rect = cvs.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * 960;
    const cy = ((e.clientY - rect.top) / rect.height) * 590;
    const pad = 26;
    const pw = 960 - pad * 2;
    const ph = 590 - pad * 2;
    return {
      x_m: Math.max(2, Math.min(103, Math.round((((cx - pad) / pw) * 105) * 10) / 10)),
      y_m: Math.max(2, Math.min(66, Math.round((((cy - pad) / ph) * 68) * 10) / 10)),
    };
  };

  const eraseAt = (x_m: number, y_m: number) => {
    if (!currentPhase) return false;
    const mk = (currentPhase.extra_markers || []).find((m) => Math.hypot(m.x_m - x_m, m.y_m - y_m) <= 3.2);
    if (mk) {
      commitPhaseEdit((p) => ({ ...p, extra_markers: (p.extra_markers || []).filter((m) => m.id !== mk.id) }));
      return true;
    }
    for (const st of currentPhase.freehand_strokes || []) {
      for (let k = 1; k < st.points.length; k++) {
        if (distToSegment(x_m, y_m, st.points[k - 1].x, st.points[k - 1].y, st.points[k].x, st.points[k].y) < 3.0) {
          commitPhaseEdit((p) => ({ ...p, freehand_strokes: (p.freehand_strokes || []).filter((s) => s.id !== st.id) }));
          return true;
        }
      }
    }
    for (let i = 0; i < currentPhase.custom_arrows.length; i++) {
      const ar = currentPhase.custom_arrows[i];
      if (distToSegment(x_m, y_m, ar.from_x_m, ar.from_y_m, ar.to_x_m, ar.to_y_m) < 3.0) {
        commitPhaseEdit((p) => ({ ...p, custom_arrows: p.custom_arrows.filter((_, idx) => idx !== i) }));
        return true;
      }
    }
    for (let i = 0; i < currentPhase.custom_links.length; i++) {
      const lk = currentPhase.custom_links[i];
      const a = (lk.fromTeam === "team_a" ? currentPhase.nodes : currentPhase.opponent_nodes).find((n) => n.slot === lk.fromSlot);
      const b = (lk.toTeam === "team_a" ? currentPhase.nodes : currentPhase.opponent_nodes).find((n) => n.slot === lk.toSlot);
      if (a && b && distToSegment(x_m, y_m, a.x_m, a.y_m, b.x_m, b.y_m) < 3.0) {
        commitPhaseEdit((p) => ({ ...p, custom_links: p.custom_links.filter((l) => l.id !== lk.id) }));
        return true;
      }
    }
    for (let i = 0; i < currentPhase.custom_zones.length; i++) {
      const z = currentPhase.custom_zones[i];
      if (x_m >= Math.min(z.x1_m, z.x2_m) && x_m <= Math.max(z.x1_m, z.x2_m) && y_m >= Math.min(z.y1_m, z.y2_m) && y_m <= Math.max(z.y1_m, z.y2_m)) {
        commitPhaseEdit((p) => ({ ...p, custom_zones: p.custom_zones.filter((_, idx) => idx !== i) }));
        return true;
      }
    }
    for (let i = 0; i < currentPhase.passing_arrows.length; i++) {
      const ar = currentPhase.passing_arrows[i];
      if (distToSegment(x_m, y_m, ar.from_x_m, ar.from_y_m, ar.to_x_m, ar.to_y_m) < 3.0) {
        commitPhaseEdit((p) => ({ ...p, passing_arrows: p.passing_arrows.filter((_, idx) => idx !== i) }));
        return true;
      }
    }
    return false;
  };

  const hitPlayer = (xm: number, ym: number) => {
    if (!currentPhase) return null;
    if (displayMode !== "team_b") {
      for (let i = 0; i < currentPhase.nodes.length; i++) {
        if (Math.hypot(currentPhase.nodes[i].x_m - xm, currentPhase.nodes[i].y_m - ym) <= 3.0) {
          return { team: "team_a" as const, index: i, node: currentPhase.nodes[i] };
        }
      }
    }
    if (displayMode !== "team_a") {
      for (let i = 0; i < currentPhase.opponent_nodes.length; i++) {
        if (Math.hypot(currentPhase.opponent_nodes[i].x_m - xm, currentPhase.opponent_nodes[i].y_m - ym) <= 3.0) {
          return { team: "team_b" as const, index: i, node: currentPhase.opponent_nodes[i] };
        }
      }
    }
    return null;
  };

  const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentPhase) return;
    const { x_m, y_m } = toMetersFromEvent(e);

    if (tool === "eraser") {
      eraseAt(x_m, y_m);
      return;
    }

    if (tool === "add_ball" || tool === "add_cone") {
      const mk: PitchExtraMarker = {
        id: `mk-${Date.now()}`,
        kind: tool === "add_ball" ? "ball" : "cone",
        x_m,
        y_m,
        color: tool === "add_cone" ? "#F97316" : "#FFFFFF",
      };
      commitPhaseEdit((p) => ({ ...p, extra_markers: [...(p.extra_markers || []), mk] }));
      setSelectedEl({ kind: "marker", id: mk.id });
      return;
    }

    if (tool === "add_player") {
      if (currentPhase.nodes.length >= teamSize) {
        setTool("drag");
        return;
      }
      const usedJ = new Set(currentPhase.nodes.map((n) => n.jersey_number));
      const candidate = club.players.find((pl) => pl.is_eligible_starter && !usedJ.has(pl.jersey_number)) || club.players.find((pl) => !usedJ.has(pl.jersey_number));
      const nextNode: BlueprintNode = {
        slot: candidate?.position || "CM",
        role_ar: candidate?.name_ar || (isAr ? "لاعب بديل" : "Sub Player"),
        player_label: candidate?.name_ar || `#${currentPhase.nodes.length + 1}`,
        track_id: null,
        jersey_number: candidate?.jersey_number ?? (90 + currentPhase.nodes.length),
        x_m,
        y_m,
        move_to_x_m: x_m,
        move_to_y_m: y_m,
        duty_ar: candidate?.position || "CM",
      };
      commitPhaseEdit((p) => ({ ...p, nodes: [...p.nodes, nextNode] }));
      setSelectedEl({ kind: "node", team: "team_a", index: currentPhase.nodes.length });
      if (currentPhase.nodes.length + 1 >= teamSize) setTool("drag");
      return;
    }

    const hitN = hitPlayer(x_m, y_m);

    if (tool === "swap_players") {
      if (hitN) {
        if (!swapPending) {
          setSwapPending({ team: hitN.team, index: hitN.index, label: `#${hitN.node.jersey_number || ""} ${hitN.node.player_label}` });
          setSelectedEl({ kind: "node", team: hitN.team, index: hitN.index });
        } else if (swapPending.team === hitN.team && swapPending.index !== hitN.index && phases) {
          setUndoStack((prev) => [...prev.slice(-24), JSON.parse(JSON.stringify(phases))]);
          const targetKeys: TacticalPhaseId[] = syncSlotAllPhases ? ["possession", "attack", "defense"] : [activePhase];
          const idx1 = swapPending.index;
          const idx2 = hitN.index;
          const teamKey = hitN.team;
          setPhases((prev) => {
            if (!prev) return prev;
            const next = { ...prev };
            for (const pk of targetKeys) {
              const ph = clonePhase(next[pk]);
              const list = teamKey === "team_a" ? ph.nodes : ph.opponent_nodes;
              if (list[idx1] && list[idx2]) {
                const aLbl = list[idx1].player_label;
                const aNum = list[idx1].jersey_number;
                list[idx1] = { ...list[idx1], player_label: list[idx2].player_label, jersey_number: list[idx2].jersey_number };
                list[idx2] = { ...list[idx2], player_label: aLbl, jersey_number: aNum };
              }
              next[pk] = ph;
            }
            return next;
          });
          setSavingMsg(isAr ? `✓ تم تبديل اللاعبين على الملعب بنجاح` : "✓ Swapped players on pitch");
          setTimeout(() => setSavingMsg(null), 2500);
          setSwapPending(null);
        } else {
          setSwapPending({ team: hitN.team, index: hitN.index, label: `#${hitN.node.jersey_number || ""} ${hitN.node.player_label}` });
          setSelectedEl({ kind: "node", team: hitN.team, index: hitN.index });
        }
      }
      return;
    }

    if (tool === "link_players") {
      if (hitN) {
        if (!linkPending) {
          setLinkPending({ team: hitN.team, slot: hitN.node.slot });
          setSelectedEl({ kind: "node", team: hitN.team, index: hitN.index });
        } else if (linkPending.team !== hitN.team || linkPending.slot !== hitN.node.slot) {
          const newLink: PlayerTacticalLink = {
            id: `lnk-${Date.now()}`,
            fromTeam: linkPending.team,
            fromSlot: linkPending.slot,
            toTeam: hitN.team,
            toSlot: hitN.node.slot,
            kind: linkKind,
            color: linkKind === "mark" ? "#EF4444" : linkKind === "support" ? "#38BDF8" : "#10B981",
            label: linkKind === "mark" ? "رقابة" : linkKind === "support" ? "مساندة" : "ربط تمرير",
          };
          commitPhaseEdit((p) => ({ ...p, custom_links: [...p.custom_links, newLink] }));
          setSelectedEl({ kind: "link", id: newLink.id });
          setLinkPending(null);
        }
      }
      return;
    }

    if (tool === "drag") {
      if (hitN) {
        dragNodeRef.current = { team: hitN.team, index: hitN.index };
        setSelectedEl({ kind: "node", team: hitN.team, index: hitN.index });
        return;
      }
      const mkHit = (currentPhase.extra_markers || []).find((m) => Math.hypot(m.x_m - x_m, m.y_m - y_m) <= 3.6);
      if (mkHit) {
        dragMarkerRef.current = mkHit.id;
        setSelectedEl({ kind: "marker", id: mkHit.id });
        return;
      }
      // Check freehand strokes, arrows, links BEFORE zones so lines over zones select reliably
      for (const st of currentPhase.freehand_strokes || []) {
        if (st.points.length === 1 && Math.hypot(st.points[0].x - x_m, st.points[0].y - y_m) <= 3.6) {
          setSelectedEl({ kind: "stroke", id: st.id });
          return;
        }
        for (let k = 1; k < st.points.length; k++) {
          if (distToSegment(x_m, y_m, st.points[k - 1].x, st.points[k - 1].y, st.points[k].x, st.points[k].y) <= 3.6) {
            setSelectedEl({ kind: "stroke", id: st.id });
            return;
          }
        }
      }
      for (let i = 0; i < currentPhase.custom_links.length; i++) {
        const lk = currentPhase.custom_links[i];
        const a = (lk.fromTeam === "team_a" ? currentPhase.nodes : currentPhase.opponent_nodes).find((n) => n.slot === lk.fromSlot);
        const b = (lk.toTeam === "team_a" ? currentPhase.nodes : currentPhase.opponent_nodes).find((n) => n.slot === lk.toSlot);
        if (a && b && distToSegment(x_m, y_m, a.x_m, a.y_m, b.x_m, b.y_m) <= 3.4) {
          setSelectedEl({ kind: "link", id: lk.id });
          return;
        }
      }
      for (let i = 0; i < currentPhase.custom_arrows.length; i++) {
        const ar = currentPhase.custom_arrows[i];
        if (distToSegment(x_m, y_m, ar.from_x_m, ar.from_y_m, ar.to_x_m, ar.to_y_m) <= 3.4) {
          setSelectedEl({ kind: "arrow", idx: i + 1000, isOpp: false });
          return;
        }
      }
      for (let i = 0; i < currentPhase.passing_arrows.length; i++) {
        const ar = currentPhase.passing_arrows[i];
        if (distToSegment(x_m, y_m, ar.from_x_m, ar.from_y_m, ar.to_x_m, ar.to_y_m) <= 3.4) {
          setSelectedEl({ kind: "arrow", idx: i, isOpp: false });
          return;
        }
      }
      for (let i = 0; i < currentPhase.custom_zones.length; i++) {
        const z = currentPhase.custom_zones[i];
        if (
          x_m >= Math.min(z.x1_m, z.x2_m) - 1.5 &&
          x_m <= Math.max(z.x1_m, z.x2_m) + 1.5 &&
          y_m >= Math.min(z.y1_m, z.y2_m) - 1.5 &&
          y_m <= Math.max(z.y1_m, z.y2_m) + 1.5
        ) {
          setSelectedEl({ kind: "zone", idx: i });
          return;
        }
      }
      setSelectedEl(null);
      return;
    }

    if (tool === "freehand") {
      freehandDraftRef.current = [{ x: x_m, y: y_m }];
      setLiveFreehand([{ x: x_m, y: y_m }]);
      return;
    }

    draftBoxRef.current = { sx: x_m, sy: y_m, cx: x_m, cy: y_m };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>) => {
    const { x_m, y_m } = toMetersFromEvent(e);
    if (tool === "eraser" && e.buttons === 1) {
      eraseAt(x_m, y_m);
      return;
    }
    if (freehandDraftRef.current) {
      const pts = freehandDraftRef.current;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(x_m - last.x, y_m - last.y) >= 0.7) {
        const nextPts = [...pts, { x: x_m, y: y_m }];
        freehandDraftRef.current = nextPts;
        setLiveFreehand(nextPts);
      }
      return;
    }
    if (dragMarkerRef.current && phases) {
      const mid = dragMarkerRef.current;
      setPhases((prev) => {
        if (!prev) return prev;
        const ph = clonePhase(prev[activePhase]);
        ph.extra_markers = (ph.extra_markers || []).map((m) => (m.id === mid ? { ...m, x_m, y_m } : m));
        return { ...prev, [activePhase]: ph };
      });
      return;
    }
    if (dragNodeRef.current && phases) {
      const { team, index } = dragNodeRef.current;
      setPhases((prev) => {
        if (!prev) return prev;
        const ph = clonePhase(prev[activePhase]);
        const list = team === "team_a" ? ph.nodes : ph.opponent_nodes;
        if (list[index]) {
          list[index] = { ...list[index], x_m, y_m };
          // Keep arrows anchored to this slot in sync!
          const sl = list[index].slot;
          const syncAr = (arr: EditableArrow[]) =>
            arr.map((a) => ({
              ...a,
              from_x_m: a.from_slot === sl ? x_m : a.from_x_m,
              from_y_m: a.from_slot === sl ? y_m : a.from_y_m,
              to_x_m: a.to_slot === sl ? x_m : a.to_x_m,
              to_y_m: a.to_slot === sl ? y_m : a.to_y_m,
            }));
          if (team === "team_a") {
            ph.passing_arrows = syncAr(ph.passing_arrows);
          } else {
            ph.opponent_passing_arrows = syncAr(ph.opponent_passing_arrows);
          }
        }
        return { ...prev, [activePhase]: ph };
      });
    } else if (draftBoxRef.current) {
      draftBoxRef.current.cx = x_m;
      draftBoxRef.current.cy = y_m;
    }
  };

  const handleMouseUp = () => {
    dragNodeRef.current = null;
    dragMarkerRef.current = null;
    if (freehandDraftRef.current) {
      const pts = freehandDraftRef.current;
      freehandDraftRef.current = null;
      setLiveFreehand([]);
      if (pts.length >= 2) {
        const st: FreehandStroke = { id: `fh-${Date.now()}`, points: pts, color: drawColor, width: 3.4 };
        commitPhaseEdit((p) => ({ ...p, freehand_strokes: [...(p.freehand_strokes || []), st] }));
        setSelectedEl({ kind: "stroke", id: st.id });
      }
      return;
    }
    if (draftBoxRef.current) {
      const { sx, sy, cx, cy } = draftBoxRef.current;
      draftBoxRef.current = null;
      if (Math.hypot(cx - sx, cy - sy) >= 2.5) {
        if (tool === "zone") {
          const z: EditableZone = {
            id: `z-${Date.now()}`,
            x1_m: sx,
            y1_m: sy,
            x2_m: cx,
            y2_m: cy,
            label_ar: isAr ? "منطقة تكتيكية" : "Zone",
            color: drawColor,
          };
          commitPhaseEdit((p) => ({ ...p, custom_zones: [...p.custom_zones, z] }));
          setSelectedEl({ kind: "zone", idx: currentPhase ? currentPhase.custom_zones.length : 0 });
        } else {
          // Auto-anchor arrows drawn close to players so moving players or morphing phases moves the arrows!
          const nearStart = currentPhase?.nodes.find((n) => Math.hypot(n.x_m - sx, n.y_m - sy) <= 5.5);
          const nearEnd = [...(currentPhase?.nodes || []), ...(currentPhase?.opponent_nodes || [])].find(
            (n) => Math.hypot(n.x_m - cx, n.y_m - cy) <= 5.5
          );
          const kind = tool === "press_arrow" ? "press" : tool === "run_arrow" ? "run" : "pass";
          const ar: EditableArrow = {
            id: `ar-${Date.now()}`,
            from_slot: nearStart?.slot,
            to_slot: nearEnd?.slot,
            from_x_m: nearStart ? nearStart.x_m : sx,
            from_y_m: nearStart ? nearStart.y_m : sy,
            to_x_m: nearEnd ? nearEnd.x_m : cx,
            to_y_m: nearEnd ? nearEnd.y_m : cy,
            kind,
            color: drawColor,
            label_ar: kind === "press" ? "ضغط" : kind === "run" ? "تحرك" : "تمرير",
          };
          commitPhaseEdit((p) => ({ ...p, custom_arrows: [...p.custom_arrows, ar] }));
          setSelectedEl({ kind: "arrow", idx: 1000 + (currentPhase ? currentPhase.custom_arrows.length : 0), isOpp: false });
        }
      }
    }
  };

  const deleteSelected = () => {
    if (!selectedEl) return;
    if (selectedEl.kind === "node") {
      commitPhaseEdit((p) => {
        if (selectedEl.team === "team_a" && p.nodes.length > 1) {
          return { ...p, nodes: p.nodes.filter((_, i) => i !== selectedEl.index) };
        }
        if (selectedEl.team === "team_b" && p.opponent_nodes.length > 1) {
          return { ...p, opponent_nodes: p.opponent_nodes.filter((_, i) => i !== selectedEl.index) };
        }
        return p;
      });
    } else if (selectedEl.kind === "marker") {
      commitPhaseEdit((p) => ({
        ...p,
        extra_markers: (p.extra_markers || []).filter((m) => m.id !== selectedEl.id),
      }));
    } else if (selectedEl.kind === "link") {
      commitPhaseEdit((p) => ({ ...p, custom_links: p.custom_links.filter((l) => l.id !== selectedEl.id) }));
    } else if (selectedEl.kind === "arrow") {
      commitPhaseEdit((p) => {
        if (selectedEl.idx >= 1000) {
          const ci = selectedEl.idx - 1000;
          return { ...p, custom_arrows: p.custom_arrows.filter((_, i) => i !== ci) };
        }
        return { ...p, passing_arrows: p.passing_arrows.filter((_, i) => i !== selectedEl.idx) };
      });
    } else if (selectedEl.kind === "zone") {
      commitPhaseEdit((p) => ({ ...p, custom_zones: p.custom_zones.filter((_, i) => i !== selectedEl.idx) }));
    } else if (selectedEl.kind === "stroke") {
      commitPhaseEdit((p) => ({
        ...p,
        freehand_strokes: (p.freehand_strokes || []).filter((s) => s.id !== selectedEl.id),
      }));
    }
    setSelectedEl(null);
  };

  const clearAllDrawings = () => {
    commitPhaseEdit((p) => ({
      ...p,
      custom_arrows: [],
      custom_links: [],
      custom_zones: [],
      freehand_strokes: [],
      extra_markers: [],
    }));
    setSelectedEl(null);
  };

  const getSelectedLabelAndColor = (): { label: string; color: string } | null => {
    if (!currentPhase || !selectedEl || selectedEl.kind === "node") return null;
    if (selectedEl.kind === "arrow") {
      const ar =
        selectedEl.idx >= 1000
          ? currentPhase.custom_arrows[selectedEl.idx - 1000]
          : currentPhase.passing_arrows[selectedEl.idx];
      if (!ar) return null;
      return { label: ar.label_ar || "", color: ar.color || "#FACC15" };
    }
    if (selectedEl.kind === "link") {
      const lk = currentPhase.custom_links.find((l) => l.id === selectedEl.id);
      if (!lk) return null;
      return { label: lk.label || "", color: lk.color || "#10B981" };
    }
    if (selectedEl.kind === "zone") {
      const z = currentPhase.custom_zones[selectedEl.idx];
      if (!z) return null;
      return { label: z.label_ar || "", color: z.color || "#F59E0B" };
    }
    if (selectedEl.kind === "stroke") {
      const st = (currentPhase.freehand_strokes || []).find((s) => s.id === selectedEl.id);
      if (!st) return null;
      return { label: isAr ? "رسم حر بالقلم" : "Freehand chalk", color: st.color || "#FACC15" };
    }
    return null;
  };

  const updateSelectedProps = (patch: { label?: string; color?: string }) => {
    if (!selectedEl || selectedEl.kind === "node") return;
    commitPhaseEdit((p) => {
      if (selectedEl.kind === "arrow") {
        if (selectedEl.idx >= 1000) {
          const ci = selectedEl.idx - 1000;
          if (p.custom_arrows[ci]) {
            p.custom_arrows[ci] = {
              ...p.custom_arrows[ci],
              ...(patch.label !== undefined ? { label_ar: patch.label } : {}),
              ...(patch.color !== undefined ? { color: patch.color } : {}),
            };
          }
        } else if (p.passing_arrows[selectedEl.idx]) {
          p.passing_arrows[selectedEl.idx] = {
            ...p.passing_arrows[selectedEl.idx],
            ...(patch.label !== undefined ? { label_ar: patch.label } : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
          };
        }
      } else if (selectedEl.kind === "link") {
        p.custom_links = p.custom_links.map((lk) =>
          lk.id === selectedEl.id
            ? {
                ...lk,
                ...(patch.label !== undefined ? { label: patch.label } : {}),
                ...(patch.color !== undefined ? { color: patch.color } : {}),
              }
            : lk
        );
      } else if (selectedEl.kind === "zone") {
        if (p.custom_zones[selectedEl.idx]) {
          p.custom_zones[selectedEl.idx] = {
            ...p.custom_zones[selectedEl.idx],
            ...(patch.label !== undefined ? { label_ar: patch.label } : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
          };
        }
      } else if (selectedEl.kind === "stroke" && patch.color !== undefined) {
        p.freehand_strokes = (p.freehand_strokes || []).map((st) =>
          st.id === selectedEl.id ? { ...st, color: patch.color! } : st
        );
      }
      return p;
    });
  };

  const swapSelectedPlayer = (jerseyNum: number) => {
    if (selectedEl?.kind !== "node") return;
    const pool = selectedEl.team === "team_a" ? club.players : opponent.players;
    const pl = pool.find((x) => x.jersey_number === jerseyNum);
    if (!pl || !phases) return;
    setUndoStack((prev) => [...prev.slice(-24), JSON.parse(JSON.stringify(phases))]);
    const targetKeys: TacticalPhaseId[] = syncSlotAllPhases ? ["possession", "attack", "defense"] : [activePhase];
    setPhases((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const pk of targetKeys) {
        const ph = clonePhase(next[pk]);
        const list = selectedEl.team === "team_a" ? ph.nodes : ph.opponent_nodes;
        const curNode = list[selectedEl.index];
        if (curNode) {
          // Smart swap: if picked player is already on pitch in another slot, exchange them cleanly
          const existingIdx = list.findIndex((n, idx) => idx !== selectedEl.index && n.jersey_number === pl.jersey_number);
          if (existingIdx !== -1) {
            list[existingIdx] = {
              ...list[existingIdx],
              jersey_number: curNode.jersey_number,
              player_label: curNode.player_label,
            };
          }
          list[selectedEl.index] = {
            ...curNode,
            jersey_number: pl.jersey_number,
            player_label: getShortArabicName(pl),
          };
        }
        next[pk] = ph;
      }
      return next;
    });
    setSwapModalOpen(false);
    setSavingMsg(isAr ? `✓ تم إشراك #${pl.jersey_number} ${pl.name_ar}` : `✓ Assigned #${pl.jersey_number} ${pl.name_en}`);
    setTimeout(() => setSavingMsg(null), 2500);
  };

  const updateSelectedPlayerMeta = (patch: { slot?: string; role_ar?: string }) => {
    if (selectedEl?.kind !== "node" || !phases) return;
    setUndoStack((prev) => [...prev.slice(-24), JSON.parse(JSON.stringify(phases))]);
    const targetKeys: TacticalPhaseId[] = syncSlotAllPhases ? ["possession", "attack", "defense"] : [activePhase];
    setPhases((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const pk of targetKeys) {
        const ph = clonePhase(next[pk]);
        const list = selectedEl.team === "team_a" ? ph.nodes : ph.opponent_nodes;
        const oldSlot = list[selectedEl.index]?.slot;
        if (list[selectedEl.index]) {
          list[selectedEl.index] = {
            ...list[selectedEl.index],
            ...(patch.slot !== undefined ? { slot: patch.slot.toUpperCase() } : {}),
            ...(patch.role_ar !== undefined ? { role_ar: patch.role_ar } : {}),
          };
          // Keep arrows & custom links anchored cleanly when slot name changes!
          if (patch.slot && oldSlot && patch.slot.toUpperCase() !== oldSlot) {
            const newSl = patch.slot.toUpperCase();
            if (selectedEl.team === "team_a") {
              ph.passing_arrows = ph.passing_arrows.map((a) => ({
                ...a,
                from_slot: a.from_slot === oldSlot ? newSl : a.from_slot,
                to_slot: a.to_slot === oldSlot ? newSl : a.to_slot,
              }));
            } else {
              ph.opponent_passing_arrows = ph.opponent_passing_arrows.map((a) => ({
                ...a,
                from_slot: a.from_slot === oldSlot ? newSl : a.from_slot,
                to_slot: a.to_slot === oldSlot ? newSl : a.to_slot,
              }));
            }
            ph.custom_links = ph.custom_links.map((lk) => ({
              ...lk,
              fromSlot: lk.fromTeam === selectedEl.team && lk.fromSlot === oldSlot ? newSl : lk.fromSlot,
              toSlot: lk.toTeam === selectedEl.team && lk.toSlot === oldSlot ? newSl : lk.toSlot,
            }));
          }
        }
        next[pk] = ph;
      }
      return next;
    });
  };

  useEffect(() => {
    setSavedPlans(loadSavedPlans(club.club_id));
    apiFetch<{ plans: SavedTacticalPlan[] }>(`/api/coach/plans?club_id=${encodeURIComponent(club.club_id)}`)
      .then((res) => {
        if (Array.isArray(res.plans) && res.plans.length > 0) {
          setSavedPlans(res.plans);
          for (const p of res.plans) saveLocalPlan(club.club_id, p);
        }
      })
      .catch(() => {});

    // Auto-restore saved General Plan if present; else apply Club Tactical DNA
    if (!externalBlueprint?.phase_states) {
      const savedGen =
        generalPlan && generalPlan.club_id === club.club_id && generalPlan.phases
          ? generalPlan
          : loadGeneralPlan(club.club_id);
      if (savedGen && savedGen.phases && Object.keys(savedGen.phases).length > 0) {
        setPhases(savedGen.phases);
        if (savedGen.formation_a) setFormA(savedGen.formation_a);
        if (savedGen.formation_b) setFormB(savedGen.formation_b);
        if (savedGen.lineHeight) setLineHeight(savedGen.lineHeight);
        if (savedGen.pressingStyle) setPressingStyle(savedGen.pressingStyle);
      } else if (club.tactical_profile) {
        if (club.tactical_profile.line_height) setLineHeight(club.tactical_profile.line_height);
        if (club.tactical_profile.pressing_style) setPressingStyle(club.tactical_profile.pressing_style);
        if (club.tactical_profile.default_formation) {
          setFormA(club.tactical_profile.default_formation);
          loadBlueprintFromApi(club.tactical_profile.default_formation, formB, "", teamSize);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [club.club_id]);

  const saveAsGeneralPlan = async () => {
    if (!phases) return;
    const planId = `general_${club.club_id}`;
    const newPlan: SavedTacticalPlan = {
      plan_id: planId,
      club_id: club.club_id,
      name: isAr ? `الخطة العامة — ${club.name_ar} (${formA})` : `General Plan — ${club.name_en} (${formA})`,
      formation_a: formA,
      formation_b: formB,
      phases,
      lineHeight,
      pressingStyle,
      is_general: true,
      updated_at: new Date().toISOString(),
    };
    const savedGen = saveGeneralPlan(club.club_id, newPlan);
    setSavedPlans(loadSavedPlans(club.club_id));
    onGeneralPlanSaved?.(savedGen);
    try {
      await apiFetch<{ plans?: SavedTacticalPlan[] }>(
        "/api/coach/plans",
        {
          method: "POST",
          body: JSON.stringify({
            plan_id: planId,
            club_id: club.club_id,
            match_id: `${club.club_id}_vs_${opponent.club_id}`,
            name: savedGen.name,
            formation_a: formA,
            formation_b: formB,
            phases,
            lineHeight,
            pressingStyle,
            is_general: true,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      setSavingMsg(isAr ? "✓ تم حفظ الخطة العامة وتحديثها مباشرة في الرئيسية" : "✓ General Plan saved and synced to Home");
    } catch {
      setSavingMsg(isAr ? "✓ تم حفظ الخطة العامة محلياً وتحديثها في الرئيسية" : "✓ General Plan synced to Home");
    }
    setTimeout(() => setSavingMsg(null), 4000);
  };

  const promoteToGeneralPlan = (sp: SavedTacticalPlan) => {
    const promoted = saveGeneralPlan(club.club_id, sp);
    setSavedPlans(loadSavedPlans(club.club_id));
    setFormA(promoted.formation_a || formA);
    setFormB(promoted.formation_b || formB);
    if (promoted.lineHeight) setLineHeight(promoted.lineHeight);
    if (promoted.pressingStyle) setPressingStyle(promoted.pressingStyle);
    setPhases(promoted.phases);
    onGeneralPlanSaved?.(promoted);
    setPlansDrawerOpen(false);
    setSavingMsg(isAr ? `✓ تم اعتماد «${promoted.name}» كخطة عامة في الرئيسية` : `✓ Set as General Plan on Home`);
    setTimeout(() => setSavingMsg(null), 3500);
  };

  const saveAllPhases = async () => {
    if (!phases) return;
    const planId = `plan_${club.club_id}_${formA}_${Date.now()}`;
    const oppTag = opponent.club_id === "none" ? "" : ` × ${opponent.name_ar}`;
    const newPlan: SavedTacticalPlan = {
      plan_id: planId,
      club_id: club.club_id,
      name: `${club.name_ar} (${formA})${oppTag} — 3 حالات`,
      formation_a: formA,
      formation_b: formB,
      phases,
      lineHeight,
      pressingStyle,
      updated_at: new Date().toISOString(),
    };
    const nextList = saveLocalPlan(club.club_id, newPlan);
    setSavedPlans(nextList);
    try {
      const res = await apiFetch<{ plans?: SavedTacticalPlan[] }>(
        "/api/coach/plans",
        {
          method: "POST",
          body: JSON.stringify({
            plan_id: planId,
            club_id: club.club_id,
            match_id: `${club.club_id}_vs_${opponent.club_id}`,
            name: newPlan.name,
            formation_a: formA,
            formation_b: formB,
            phases,
            lineHeight,
            pressingStyle,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      if (Array.isArray(res.plans) && res.plans.length > 0) {
        setSavedPlans(res.plans);
      }
      setSavingMsg(isAr ? "✓ تم حفظ الحالات التكتيكية الـ 3 بنجاح في السجل السحابي والمحلي" : "✓ Saved all 3 tactical phases");
    } catch {
      setSavingMsg(isAr ? "✓ تم حفظ الخطة بنجاح محلياً على جهازك" : "✓ Saved locally");
    }
    setTimeout(() => setSavingMsg(null), 4000);
  };

  const handleLoadSavedPlan = (sp: SavedTacticalPlan) => {
    setFormA(sp.formation_a || formA);
    setFormB(sp.formation_b || formB);
    if (sp.lineHeight) setLineHeight(sp.lineHeight);
    if (sp.pressingStyle) setPressingStyle(sp.pressingStyle);
    setPhases(sp.phases);
    setPlansDrawerOpen(false);
    setSavingMsg(isAr ? `✓ تم تحميل خطة: ${sp.name}` : `✓ Loaded ${sp.name}`);
    setTimeout(() => setSavingMsg(null), 3000);
  };

  const handleDeleteSavedPlan = async (pid: string) => {
    const next = deleteLocalPlan(club.club_id, pid);
    setSavedPlans(next);
    apiFetch(`/api/coach/plans/${encodeURIComponent(pid)}?club_id=${encodeURIComponent(club.club_id)}`, { method: "DELETE" }).catch(() => {});
  };

  const exportPng = () => {
    if (!currentPhase) return;
    // Broadcast HD 2400x1560 Export with Clean Club & Phase Banner
    const exp = document.createElement("canvas");
    exp.width = 2400;
    exp.height = 1560;
    const ectx = exp.getContext("2d");
    if (!ectx) return;

    ectx.fillStyle = "#0F172A";
    ectx.fillRect(0, 0, 2400, 1560);
    ectx.fillStyle = "#FFFFFF";
    ectx.font = "bold 36px sans-serif";
    ectx.textAlign = "left";
    ectx.fillText(
      `${club.name_en} (${formA})  •  ${isAr ? currentPhase.label_ar : currentPhase.label_en}`,
      48,
      54
    );
    ectx.fillStyle = "#94A3B8";
    ectx.font = "bold 24px sans-serif";
    ectx.textAlign = "right";
    ectx.fillText("EGY-SCOUT Coach Pro · bedigital", 2352, 52);

    ectx.save();
    ectx.translate(0, 85);
    ectx.scale(2400 / 960, (1560 - 85) / 590);
    renderPitchScene(ectx, 960, 590, false, true);
    ectx.restore();

    let pngUrl = "";
    try {
      pngUrl = exp.toDataURL("image/png");
    } catch {
      ectx.clearRect(0, 85, 2400, 1560 - 85);
      ectx.save();
      ectx.translate(0, 85);
      ectx.scale(2400 / 960, (1560 - 85) / 590);
      renderPitchScene(ectx, 960, 590, false, false);
      ectx.restore();
      pngUrl = exp.toDataURL("image/png");
    }

    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = `egy_scout_${club.club_id}_${activePhase}_${formA}_HD.png`;
    a.click();
  };

  const runMatchSimulator = async (modeOverride?: string) => {
    if (!currentPhase) return;
    const targetMode = modeOverride || simMode;
    setSimMode(targetMode);
    setRunningSim(true);
    try {
      const res = await apiFetch<MatchSimulationResult>(
        "/api/coach/match-simulate",
        {
          method: "POST",
          body: JSON.stringify({
            club_id: club.club_id,
            opponent_id: opponent.club_id,
            league: club.league_id || "egy.1",
            formation_a: formA,
            formation_b: formB,
            nodes_a: currentPhase.nodes,
            nodes_b: currentPhase.opponent_nodes,
            line_height: lineHeight,
            pressing_style: pressingStyle,
            mode: targetMode,
            rollouts: 5000,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      setSimRes(res);
    } finally {
      setRunningSim(false);
    }
  };

  const runLineupSwapAdvisor = async () => {
    if (!currentPhase) return;
    setLoadingSwaps(true);
    try {
      const res = await apiFetch<{
        squad_fit_score: number;
        current_issues_ar: string[];
        suggestions: LineupSwapSuggestion[];
        summary_ar: string;
      }>(
        "/api/coach/tactics/suggest-lineup",
        {
          method: "POST",
          body: JSON.stringify({
            club_id: club.club_id,
            opponent_id: opponent.club_id,
            league: club.league_id || "egy.1",
            formation_code: formA,
            nodes_a: currentPhase.nodes,
            line_height: lineHeight,
            pressing_style: pressingStyle,
          }),
        },
        "club_demo_egypt",
        "coach"
      );
      setSwapAdvisor(res);
    } finally {
      setLoadingSwaps(false);
    }
  };

  const applyRecommendedSwap = (sw: LineupSwapSuggestion) => {
    if (!phases) return;
    setUndoStack((prev) => [...prev.slice(-24), JSON.parse(JSON.stringify(phases))]);
    const targetKeys: TacticalPhaseId[] = ["defense", "possession", "attack"];
    setPhases((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const pk of targetKeys) {
        const ph = clonePhase(next[pk]);
        if (ph.nodes[sw.node_index]) {
          ph.nodes[sw.node_index] = {
            ...ph.nodes[sw.node_index],
            jersey_number: sw.in_jersey,
            player_label: sw.in_name_ar,
          };
        }
        next[pk] = ph;
      }
      return next;
    });
    setSwapAdvisor((prev) =>
      prev ? { ...prev, suggestions: prev.suggestions.filter((s) => s.node_index !== sw.node_index) } : prev
    );
    setSavingMsg(isAr ? `✓ تم إشراك #${sw.in_jersey} ${sw.in_name_ar} في التشكيل` : `✓ Applied swap`);
    setTimeout(() => setSavingMsg(null), 2500);
  };

  const fitPlayers = club.players.filter((p) => p.is_eligible_starter);
  const activeFormationsList = SIZE_FORMATIONS[teamSize] || SIZE_FORMATIONS[11];
  const selectedNodeObj =
    selectedEl?.kind === "node" && currentPhase
      ? (selectedEl.team === "team_a" ? currentPhase.nodes : currentPhase.opponent_nodes)[selectedEl.index]
      : null;

  const selectedMeta = getSelectedLabelAndColor();

  const handleTeamSizeChange = (nextSize: number) => {
    const allowed = SIZE_FORMATIONS[nextSize] || SIZE_FORMATIONS[11];
    const nextFA = allowed[0];
    const nextFB = allowed[Math.min(1, allowed.length - 1)] || allowed[0];
    setTeamSize(nextSize);
    setFormA(nextFA);
    setFormB(nextFB);
    setIsMorphing(false);
    setPlayingKeyframes(false);
    setKeyframes([]);
    loadBlueprintFromApi(nextFA, nextFB, "", nextSize);
  };

  const captureKeyframe = () => {
    if (!currentPhase) return;
    setKeyframes((prev) => [
      ...prev,
      {
        nodesA: JSON.parse(JSON.stringify(currentPhase.nodes)),
        nodesB: JSON.parse(JSON.stringify(currentPhase.opponent_nodes)),
      },
    ]);
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-2.5 sm:space-y-3">
      {/* Compact Primary Bar: 3 Phases (Defense -> Possession -> Attack) + General Plan Save */}
      <div className="studio-panel p-2.5 sm:p-3 space-y-2 text-xs">
        {club.tactical_profile && (
          <div className="hidden sm:flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
            <span className="font-bold text-slate-900 truncate">
              {isAr ? `هوية ${club.name_ar}: ${club.tactical_profile.identity_ar}` : club.tactical_profile.identity_en}
            </span>
            <span className="text-[10px] font-bold text-[#15803D] shrink-0">
              {club.tactical_profile.phase_shapes?.attack} → {club.tactical_profile.phase_shapes?.possession} → {club.tactical_profile.phase_shapes?.defense}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 3 Tactical Phase States Selector (1. Defense, 2. Possession, 3. Attack) */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full">
            {PHASE_META.map((pm) => {
              const isAct = activePhase === pm.id;
              return (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => {
                    setIsMorphing(false);
                    setPlayingKeyframes(false);
                    setActivePhase(pm.id);
                    setSelectedEl(null);
                  }}
                  className={`px-2.5 sm:px-3 py-1.5 min-h-[36px] rounded-lg font-bold border transition whitespace-nowrap flex items-center gap-1.5 ${
                    isAct
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-white"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: isAct ? "#22C55E" : pm.color }} />
                  <span>{isAr ? pm.ar : pm.en}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                setPlayingKeyframes(false);
                setIsMorphing((v) => !v);
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-lg font-bold border transition whitespace-nowrap ${
                isMorphing
                  ? "bg-amber-500 text-slate-950 border-amber-500"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
              title={isAr ? "تحول الحالات والرسومات الـ 3" : "Animate 3 Phases & Drawings"}
            >
              {isMorphing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isMorphing ? (isAr ? "إيقاف" : "Stop") : isAr ? "تحرك الحالات" : "Animate"}</span>
            </button>
          </div>

          {/* Right Formation + Primary General Plan Save */}
          <div className="flex items-center gap-1.5 flex-wrap w-full sm:w-auto justify-between sm:justify-end">
            <select
              value={formA}
              aria-label="Your Formation"
              onChange={(e) => {
                const nextF = e.target.value;
                setFormA(nextF);
                loadBlueprintFromApi(nextF, formB, "", teamSize);
                if (teamSize === 11 && onFormationChange) {
                  onFormationChange(nextF);
                }
              }}
              className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 min-h-[36px] font-extrabold text-slate-900"
            >
              {activeFormationsList.map((f) => (
                <option key={f} value={f}>{club.name_ar}: {f}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={saveAsGeneralPlan}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg bg-[#15803D] hover:bg-[#166534] text-white font-extrabold transition flex-1 sm:flex-none"
            >
              <Save className="w-3.5 h-3.5 shrink-0" />
              <span>{isAr ? "حفظ كخطة عامة (للرئيسية)" : "Save General Plan"}</span>
            </button>
          </div>
        </div>

        {/* Mobile Scrollable Quick-Tools Row + Instant Color Palette */}
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-200">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
            {(
              [
                ["drag", isAr ? "سحب / تحديد" : "Select", <Move key="m" className="w-3.5 h-3.5" />],
                ["swap_players", isAr ? "تبديل" : "Swap", <ArrowRightLeft key="sw" className="w-3.5 h-3.5" />],
                ["eraser", isAr ? "ممحاة" : "Eraser", <Eraser key="er" className="w-3.5 h-3.5" />],
                ["pass_arrow", isAr ? "سهم" : "Arrow", <MoveUpRight key="p" className="w-3.5 h-3.5" />],
                ["zone", isAr ? "منطقة" : "Zone", <Square key="z" className="w-3.5 h-3.5" />],
                ["freehand", isAr ? "قلم" : "Pen", <Pencil key="fh" className="w-3.5 h-3.5" />],
                ...(currentPhase && currentPhase.nodes.length < teamSize
                  ? ([["add_player", isAr ? `استعادة لاعب (${currentPhase.nodes.length}/${teamSize})` : `Restore (${currentPhase.nodes.length}/${teamSize})`, <UserPlus key="ap" className="w-3.5 h-3.5" />]] as Array<[ToolMode, string, React.ReactNode]>)
                  : []),
                ["add_ball", isAr ? "+ كرة" : "+ Ball", <Plus key="ab" className="w-3.5 h-3.5" />],
                ["add_cone", isAr ? "+ قمع" : "+ Cone", <Plus key="ac" className="w-3.5 h-3.5" />],
              ] as Array<[ToolMode, string, React.ReactNode]>
            ).map(([id, lbl, icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTool(id);
                  setLinkPending(null);
                  setSwapPending(null);
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-lg font-bold transition whitespace-nowrap shrink-0 ${
                  tool === id
                    ? id === "eraser"
                      ? "bg-rose-600 text-white"
                      : "bg-slate-900 text-white"
                    : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {icon}
                <span>{lbl}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="p-2 min-h-[36px] rounded-lg bg-slate-50 border border-slate-200 text-slate-700 disabled:opacity-35 shrink-0"
              title={isAr ? "تراجع" : "Undo"}
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={clearAllDrawings}
              className="px-2.5 py-1.5 min-h-[36px] rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-bold whitespace-nowrap shrink-0"
              title={isAr ? "مسح كل الرسومات" : "Clear Drawings"}
            >
              {isAr ? "مسح الرسومات" : "Clear Art"}
            </button>

            <button
              type="button"
              onClick={() => setPlansDrawerOpen((v) => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-lg bg-slate-50 border border-slate-200 text-slate-700 font-bold hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5 text-slate-600" />
              <span>{isAr ? `المحفوظة (${savedPlans.length})` : `Saved (${savedPlans.length})`}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAdvancedTools((v) => !v)}
              className={`lg:hidden inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-lg border font-bold whitespace-nowrap shrink-0 ${
                showAdvancedTools ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{isAr ? "المزيد" : "More"}</span>
            </button>
          </div>

          {/* Instant Active Pen/Zone Color Swatches (updates drawColor AND selected stroke/zone/arrow immediately!) */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-slate-500">
                {isAr ? "لون الرسم والتحديد:" : "Draw Color:"}
              </span>
              {COLOR_SWATCHES.map((cHex) => (
                <button
                  key={cHex}
                  type="button"
                  onClick={() => {
                    setDrawColor(cHex);
                    if (selectedEl && selectedEl.kind !== "node" && selectedEl.kind !== "marker") {
                      updateSelectedProps({ color: cHex });
                    }
                  }}
                  aria-label={`Select color ${cHex}`}
                  className={`w-6 h-6 rounded-full border transition ${
                    drawColor.toUpperCase() === cHex ? "ring-2 ring-slate-900 scale-110 border-white" : "border-slate-300"
                  }`}
                  style={{ backgroundColor: cHex }}
                />
              ))}
              <input
                type="color"
                value={drawColor}
                aria-label="Custom Draw Color"
                onChange={(e) => {
                  const nextC = e.target.value;
                  setDrawColor(nextC);
                  if (selectedEl && selectedEl.kind !== "node" && selectedEl.kind !== "marker") {
                    updateSelectedProps({ color: nextC });
                  }
                }}
                className="w-6 h-6 rounded-md bg-white border border-slate-300 cursor-pointer p-0"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setShowPlayerCards((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold border transition ${
                  showPlayerCards ? "bg-[#15803D] text-white border-[#15803D]" : "bg-slate-50 text-slate-700 border-slate-200"
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>{isAr ? "بطاقات الوجوه" : "Face Cards"}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowHeatmap((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold border transition ${
                  showHeatmap ? "bg-rose-600 text-white border-rose-600" : "bg-slate-50 text-slate-700 border-slate-200"
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>{isAr ? "خريطة حرارية" : "Heatmap"}</span>
              </button>
              <button
                type="button"
                onClick={exportPng}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isAr ? "تنزيل HD" : "HD PNG"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Advanced Controls (Always shown on Desktop lg+, Collapsible on Mobile) */}
        <div className={`${showAdvancedTools ? "block" : "hidden"} lg:block pt-2 border-t border-slate-100 space-y-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-slate-500 text-[11px]">{isAr ? "المقاس:" : "Size:"}</span>
              {TEAM_SIZES.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => handleTeamSizeChange(sz)}
                  className={`px-2 py-1 rounded-md font-bold border transition text-[11px] ${
                    teamSize === sz
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-white"
                  }`}
                >
                  {sz}×{sz}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {opponent.club_id !== "none" ? (
                <select
                  value={formB}
                  aria-label="Opponent Formation"
                  onChange={(e) => {
                    setFormB(e.target.value);
                    loadBlueprintFromApi(formA, e.target.value, "", teamSize);
                  }}
                  className="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-800"
                >
                  {activeFormationsList.map((f) => (
                    <option key={f} value={f}>{opponent.name_ar}: {f}</option>
                  ))}
                </select>
              ) : (
                onOpenOpponentPicker && (
                  <button
                    type="button"
                    onClick={onOpenOpponentPicker}
                    className="px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-bold hover:bg-slate-200"
                  >
                    {isAr ? "+ اختيار الخصم" : "+ Pick Opponent"}
                  </button>
                )
              )}
              {teamSize === 11 && PRESET_BUTTONS.map((pr) => (
                <button
                  key={pr.label}
                  type="button"
                  onClick={() => loadBlueprintFromApi(formA, formB, pr.prompt, 11)}
                  className="px-2 py-1 rounded-md bg-slate-50 border border-slate-200 hover:bg-slate-100 text-[11px] font-bold text-slate-700"
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["link_players", isAr ? "ربط لاعبين" : "Link", <Link2 key="l" className="w-3.5 h-3.5" />],
                  ["run_arrow", isAr ? "سهم تحرك" : "Run", <Zap key="r" className="w-3.5 h-3.5" />],
                  ["press_arrow", isAr ? "سهم ضغط" : "Press", <Swords key="pr" className="w-3.5 h-3.5" />],
                ] as Array<[ToolMode, string, React.ReactNode]>
              ).map(([id, lbl, icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTool(id);
                    setLinkPending(null);
                    setSwapPending(null);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border transition ${
                    tool === id ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-white"
                  }`}
                >
                  {icon}
                  <span>{lbl}</span>
                </button>
              ))}

              {tool === "link_players" && (
                <select
                  value={linkKind}
                  aria-label="Link Type"
                  onChange={(e) => setLinkKind(e.target.value as "pass" | "support" | "mark")}
                  className="rounded-md bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-800"
                >
                  <option value="pass">{isAr ? "قناة تمرير" : "Pass Link"}</option>
                  <option value="support">{isAr ? "تغطية ومساندة" : "Support Cover"}</option>
                  <option value="mark">{isAr ? "رقابة على الخصم" : "Man-Mark"}</option>
                </select>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["both", `${teamSize}v${teamSize}`],
                  ["team_a", club.name_ar],
                  ["team_b", opponent.name_ar],
                ] as Array<[DisplayMode, string]>
              ).map(([dm, lbl]) => (
                <button
                  key={dm}
                  type="button"
                  onClick={() => setDisplayMode(dm)}
                  className={`px-2 py-1 rounded-md text-[11px] font-bold border ${
                    displayMode === dm ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-700 border-slate-200"
                  }`}
                >
                  {lbl}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowChannelsGrid((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border ${
                  showChannelsGrid ? "bg-emerald-50 text-[#15803D] border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"
                }`}
              >
                <Grid className="w-3 h-3" />
                <span>{isAr ? "الشبكة" : "Grid"}</span>
              </button>
              <button
                type="button"
                onClick={captureKeyframe}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-700 text-[11px] font-bold"
              >
                <Camera className="w-3 h-3" />
                <span>{isAr ? `+ لقطة (${keyframes.length})` : `+ Frame (${keyframes.length})`}</span>
              </button>
              {keyframes.length >= 2 && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMorphing(false);
                    setPlayingKeyframes((v) => !v);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border ${
                    playingKeyframes ? "bg-amber-500 text-slate-950 border-amber-500" : "bg-slate-900 text-white border-slate-900"
                  }`}
                >
                  <Film className="w-3 h-3" />
                  <span>{playingKeyframes ? (isAr ? "إيقاف" : "Stop") : isAr ? "تشغيل" : "Play"}</span>
                </button>
              )}
              <button type="button" onClick={() => loadBlueprintFromApi(formA, formB, "", teamSize)} className="p-1.5 rounded-md bg-slate-50 border border-slate-200 text-slate-700" title={isAr ? "إعادة ضبط" : "Reset"}>
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={saveAllPhases} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-slate-300 text-slate-800 text-[11px] font-bold hover:bg-slate-50">
                <Save className="w-3 h-3" />
                <span>{isAr ? "حفظ نسخة إضافية" : "Save Copy"}</span>
              </button>
            </div>
          </div>
        </div>

        {tool === "swap_players" && (
          <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-bold flex items-center justify-between gap-2">
            <span>
              {swapPending
                ? isAr ? `اختر اللاعب الثاني للتبديل مباشرةً مع (${swapPending.label})` : `Tap second player to swap with ${swapPending.label}`
                : isAr ? "اضغط على اللاعب الأول على الملعب ثم اللاعب الثاني لتبديل أماكنهما فوراً" : "Tap first player on pitch then second player to swap"}
            </span>
            {swapPending && (
              <button type="button" onClick={() => setSwapPending(null)} className="text-[11px] underline">
                {isAr ? "إلغاء" : "Cancel"}
              </button>
            )}
          </div>
        )}

        {plansDrawerOpen && (
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between font-extrabold text-slate-900">
              <span>{isAr ? `الخطط المحفوظة (${savedPlans.length})` : `Saved Plans (${savedPlans.length})`}</span>
              <button type="button" onClick={() => setPlansDrawerOpen(false)} className="text-xs text-slate-500 underline">
                {isAr ? "إغلاق" : "Close"}
              </button>
            </div>
            {savedPlans.length === 0 ? (
              <div className="text-slate-500 text-xs">{isAr ? "لم يتم حفظ خطط بعد — اضغط «حفظ كخطة عامة (للرئيسية)»." : "No saved plans yet."}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {savedPlans.map((sp) => (
                  <div key={sp.plan_id} className={`p-2.5 rounded-xl bg-white border flex items-center justify-between gap-2 ${sp.is_general ? "border-[#15803D]" : "border-slate-200"}`}>
                    <button type="button" onClick={() => handleLoadSavedPlan(sp)} className="text-start min-w-0 flex-1 hover:text-[#15803D]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-slate-900 truncate">{sp.name}</span>
                        {sp.is_general && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#15803D] border border-emerald-200 text-[9px] font-bold shrink-0">
                            {isAr ? "الخطة العامة" : "General"}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500">{sp.formation_a} • {sp.updated_at?.slice(0, 10)}</div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {!sp.is_general && (
                        <button
                          type="button"
                          onClick={() => promoteToGeneralPlan(sp)}
                          className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-[#15803D]"
                          title={isAr ? "اعتماد كخطة عامة للرئيسية" : "Set as General Plan"}
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedPlan(sp.plan_id)}
                        className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600"
                        title={isAr ? "حذف" : "Delete"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {savingMsg && <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[#15803D] font-bold">{savingMsg}</div>}
      </div>

      {/* Main Pitch-First 12-Col Layout: 8-Col Hero Pitch + 4-Col Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-8 studio-panel p-3 space-y-2">
          {currentPhase && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
              <span className="font-extrabold text-emerald-700">{isAr ? currentPhase.label_ar : currentPhase.label_en}</span>
              <span className="text-[11px] text-slate-600">{currentPhase.description_ar}</span>
            </div>
          )}

          {selectedEl && selectedEl.kind !== "node" && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-slate-900">
                  {selectedEl.kind === "stroke"
                    ? isAr ? "تم تحديد: خط قلم حر" : "Selected: Freehand"
                    : selectedEl.kind === "zone"
                    ? isAr ? "تم تحديد: منطقة تكتيكية" : "Selected: Zone"
                    : selectedEl.kind === "marker"
                    ? isAr ? "تم تحديد: كرة / قمع" : "Selected: Marker"
                    : isAr ? "تم تحديد: سهم / ربط" : "Selected: Arrow / Link"}
                </span>
                {selectedEl.kind !== "marker" && (
                  <div className="flex items-center gap-1">
                    {["#FACC15", "#EF4444", "#38BDF8", "#22C55E", "#FFFFFF"].map((cHex) => (
                      <button
                        key={cHex}
                        type="button"
                        onClick={() => updateSelectedProps({ color: cHex })}
                        className="w-4 h-4 rounded-full border border-slate-400"
                        style={{ backgroundColor: cHex }}
                        title={cHex}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[11px]"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{isAr ? "حذف العنصر المحدد" : "Delete Selected"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedEl(null)}
                  className="px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-700 text-[11px] font-bold"
                >
                  {isAr ? "إلغاء التحديد" : "Deselect"}
                </button>
              </div>
            </div>
          )}

          <canvas
            ref={cvsRef}
            width={1920}
            height={1180}
            onPointerDown={handleMouseDown}
            onPointerMove={handleMouseMove}
            onPointerUp={handleMouseUp}
            onPointerCancel={handleMouseUp}
            className="w-full rounded-xl border border-emerald-800/30 bg-[#15803D] cursor-crosshair shadow-xs touch-none"
          />

          <div className="text-[11px] text-slate-600 px-1 flex flex-wrap items-center justify-between">
            <span>
              {tool === "eraser"
                ? isAr
                  ? "اضغط أو اسحب على أي رسم أو منطقة أو سهم أو قمع لمسحه فوراً."
                  : "Tap or sweep over any drawing, arrow, zone, or marker to erase."
                : tool === "add_player" || tool === "add_ball" || tool === "add_cone"
                  ? isAr
                    ? "انقر على أي مكان في الملعب لإضافة العنصر المختار."
                    : "Tap anywhere on pitch to place item."
                  : tool === "freehand"
                    ? isAr
                      ? "ارسم بالماوس أو الإصبع — واختر اللون من الألوان بالأعلى."
                      : "Draw freehand chalk lines anywhere on the pitch."
                    : isAr
                      ? "اسحب أي لاعب أو انقر على أي رسم لتعديله أو مسحه."
                      : "Drag any player or click any item to edit or delete."}
            </span>
            <span className="font-bold text-[#15803D]">{fitPlayers.length} {isAr ? "متاحين" : "eligible"}</span>
          </div>
        </div>

        {/* Right 4-Col Tactical Inspector, Lineup Swaps & Full-Match Simulator */}
        <div className="xl:col-span-4 space-y-3 text-xs">
          {/* Selected Element Editor */}
          <div className="studio-panel p-3.5 space-y-2.5">
            <div className="flex items-center justify-between font-extrabold text-slate-900">
              <span className="flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-[#15803D]" />
                <span>{isAr ? "تحرير العنصر المحدد" : "Selected Element"}</span>
              </span>
              {selectedEl && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{isAr ? "مسح العنصر" : "Delete"}</span>
                </button>
              )}
            </div>

            {selectedNodeObj && selectedEl?.kind === "node" ? (
              <div className="space-y-2.5 p-2.5 rounded-xl bg-[#F2F6F8] border border-[#D8E3EB]">
                <div className="font-extrabold text-[#0D717A]">
                  #{selectedNodeObj.jersey_number} {selectedNodeObj.player_label} ({selectedNodeObj.slot})
                </div>
                <div className="text-[11px] text-[#5C6A7C]">
                  {selectedNodeObj.role_ar} • X={selectedNodeObj.x_m}m, Y={selectedNodeObj.y_m}m
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-[#0B1F3A] mb-1">
                      {isAr ? "المركز التكتيكي:" : "Tactical Position:"}
                    </label>
                    <select
                      value={EDITABLE_SLOTS.includes(selectedNodeObj.slot) ? selectedNodeObj.slot : "CUSTOM"}
                      aria-label="Edit Tactical Position"
                      onChange={(e) => {
                        if (e.target.value !== "CUSTOM") updateSelectedPlayerMeta({ slot: e.target.value });
                      }}
                      className="w-full rounded-lg bg-white border border-[#D8E3EB] px-2 py-1 text-[11px] font-extrabold text-[#0B1F3A]"
                    >
                      {EDITABLE_SLOTS.map((sl) => (
                        <option key={sl} value={sl}>{sl}</option>
                      ))}
                      {!EDITABLE_SLOTS.includes(selectedNodeObj.slot) && (
                        <option value="CUSTOM">{selectedNodeObj.slot}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-[#0B1F3A] mb-1">
                      {isAr ? "رمز مخصص:" : "Custom Code:"}
                    </label>
                    <input
                      type="text"
                      maxLength={8}
                      value={selectedNodeObj.slot}
                      onChange={(e) => updateSelectedPlayerMeta({ slot: e.target.value })}
                      className="w-full rounded-lg bg-white border border-[#D8E3EB] px-2 py-1 text-[11px] font-extrabold text-[#0D717A] outline-none focus:border-[#0FB5AE]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-[#0B1F3A] mb-1">
                    {isAr ? "المهمة / الدور التكتيكي للاعب:" : "Player Tactical Duty:"}
                  </label>
                  <input
                    type="text"
                    value={selectedNodeObj.role_ar || ""}
                    onChange={(e) => updateSelectedPlayerMeta({ role_ar: e.target.value })}
                    placeholder={isAr ? "مثال: ظهير عكسي / جناح مقلوب..." : "Custom role..."}
                    className="w-full rounded-lg bg-white border border-[#D8E3EB] px-2 py-1 text-[11px] text-[#0B1F3A] outline-none focus:border-[#0FB5AE]"
                  />
                </div>

                <label className="block text-[11px] font-bold text-[#0B1F3A] pt-1">
                  {isAr ? "تبديل بلاعب آخر من القائمة (بالصور والمركز):" : "Swap with Squad Player:"}
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSwapSearch("");
                      setSwapPosTab("ALL");
                      setSwapModalOpen(true);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#0D717A] hover:bg-[#0B5E66] text-white font-extrabold shadow-2xs"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>{isAr ? "تبديل من القائمة بالصور" : "Visual Squad Swap"}</span>
                  </button>
                  {selectedEl?.team === "team_a" && onAskAiAboutPlayer && (() => {
                    const matched = club.players.find((pl) => pl.jersey_number === selectedNodeObj.jersey_number);
                    if (!matched) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => onAskAiAboutPlayer(matched, club)}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-extrabold"
                      >
                        <Bot className="w-3.5 h-3.5" />
                        <span>{isAr ? "توظيفه بالـ AI" : "AI Role"}</span>
                      </button>
                    );
                  })()}
                </div>

                <label className="flex items-center gap-1.5 text-[10px] font-bold text-[#0D717A] pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncSlotAllPhases}
                    onChange={(e) => setSyncSlotAllPhases(e.target.checked)}
                    className="accent-[#0D717A]"
                  />
                  <span>{isAr ? "تطبيق التعديل على الحالات الـ 3 تلقائياً" : "Apply edit across all 3 phases"}</span>
                </label>
              </div>
            ) : selectedEl && selectedMeta ? (
              <div className="space-y-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800">
                {selectedEl.kind !== "stroke" && (
                  <div className="space-y-1">
                    <label className="block text-[11px] font-bold text-slate-600">
                      {isAr ? "اسم / وصف العنصر على الملعب:" : "Element Label on Pitch:"}
                    </label>
                    <input
                      type="text"
                      value={selectedMeta.label}
                      onChange={(e) => updateSelectedProps({ label: e.target.value })}
                      placeholder={isAr ? "اكتب مسمى السهم أو المنطقة..." : "Type label..."}
                      className="w-full rounded-lg bg-white border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-600">{isAr ? "لون العنصر:" : "Color:"}</span>
                  <div className="flex items-center gap-1.5">
                    {["#FACC15", "#10B981", "#0284C7", "#EF4444", "#FFFFFF"].map((cHex) => (
                      <button
                        key={cHex}
                        type="button"
                        onClick={() => updateSelectedProps({ color: cHex })}
                        className={`w-5 h-5 rounded-full border ${
                          selectedMeta.color.toUpperCase() === cHex ? "ring-2 ring-slate-900 border-white" : "border-slate-300"
                        }`}
                        style={{ backgroundColor: cHex }}
                        aria-label={`Color ${cHex}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-slate-500">
                {isAr ? "انقر على أي لاعب أو سهم أو ربط أو رسم في الملعب لتعديله أو تبديله أو حذفه." : "Click any player, arrow, link, or stroke on the pitch."}
              </div>
            )}
          </div>

          {/* Live Math Validator */}
          <div className="studio-panel p-3.5 space-y-2">
            <div className="flex items-center justify-between font-extrabold text-slate-900">
              <span className="flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? "المدقق الرياضي للحالة" : "Phase Math Validator"}</span>
              </span>
              <span className="text-emerald-700 font-extrabold">
                {mathScore ? `${mathScore.overall_balance_score}/100` : "Live"}
              </span>
            </div>
            {mathScore && (
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500">{isAr ? "عمق الخطوط:" : "Depth:"}</span>{" "}
                  <b className="text-slate-900">{mathScore.vertical_length_m}m</b>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500">{isAr ? "تأمين الدفاع:" : "Rest Def:"}</span>{" "}
                  <b className="text-emerald-700">{mathScore.rest_defenders_count}</b>
                </div>
              </div>
            )}
          </div>

          {/* Match Instructions */}
          <div className="studio-panel p-3.5 space-y-2">
            <div className="font-extrabold text-slate-900">{isAr ? "تعليمات الأسلوب داخل المباراة" : "Game Plan Controls"}</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-slate-500 mb-1">{isAr ? "ارتفاع الخط" : "Line Height"}</div>
                <select
                  value={lineHeight}
                  aria-label="Line Height"
                  onChange={(e) => setLineHeight(e.target.value as "low" | "mid" | "high")}
                  className="w-full rounded-lg bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-800"
                >
                  <option value="low">{isAr ? "منخفض (Low)" : "Low"}</option>
                  <option value="mid">{isAr ? "متوازن (Mid)" : "Mid"}</option>
                  <option value="high">{isAr ? "متقدم (High)" : "High"}</option>
                </select>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-1">{isAr ? "نمط الضغط" : "Pressing"}</div>
                <select
                  value={pressingStyle}
                  aria-label="Pressing Style"
                  onChange={(e) => setPressingStyle(e.target.value as "contain" | "trigger" | "gegenpress")}
                  className="w-full rounded-lg bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-800"
                >
                  <option value="contain">{isAr ? "تغطية ومراقبة" : "Contain"}</option>
                  <option value="trigger">{isAr ? "مصيدة ضغط" : "Trigger"}</option>
                  <option value="gegenpress">{isAr ? "ضغط عكسي فوري" : "Gegenpress"}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Lineup Swap Advisor (AI/Algorithm Formation Fit Recommender) */}
          <div className="studio-panel p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-extrabold text-slate-900 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[#15803D]" />
                <span>{isAr ? "ترشيح وتبديل اللاعبين حسب الخطة" : "Formation Swap Advisor"}</span>
              </span>
              <button
                type="button"
                onClick={runLineupSwapAdvisor}
                disabled={loadingSwaps}
                className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold disabled:opacity-50"
              >
                {loadingSwaps ? (isAr ? "فحص..." : "Checking...") : isAr ? "فحص التشكيل" : "Suggest Swaps"}
              </button>
            </div>

            {swapAdvisor && (
              <div className="space-y-2">
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-800">
                  {swapAdvisor.summary_ar}
                </div>
                {swapAdvisor.suggestions.map((sw) => (
                  <div key={`${sw.node_index}-${sw.in_jersey}`} className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-extrabold text-slate-900 text-[11px] truncate">
                          ({sw.slot}) #{sw.in_jersey} {sw.in_name_ar} <span className="text-slate-400">← بدلاً من #{sw.out_jersey} {sw.out_name_ar}</span>
                        </div>
                        <div className="text-[10px] text-slate-600">{sw.reason_ar}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => applyRecommendedSwap(sw)}
                        className="px-2.5 py-1 rounded-md bg-[#15803D] hover:bg-[#166534] text-white text-[10px] font-extrabold shrink-0"
                      >
                        {isAr ? "تطبيق" : "Apply"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Full-Match Accurate Simulator */}
          <div className="studio-panel p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2 font-extrabold text-slate-900">
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="w-4 h-4 text-[#15803D]" />
                <span>{isAr ? "محاكي المباراة والتكتيك (5,000 محاكاة)" : "Full-Match Simulator (5,000 Runs)"}</span>
              </span>
            </div>

            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {[
                ["full_match", isAr ? "مباراة 90د" : "90m Match"],
                ["high_press_buildup", isAr ? "الضغط العالي" : "High Press"],
                ["counter_attack", isAr ? "المرتدات" : "Counter"],
                ["low_block_break", isAr ? "اختراق التكتل" : "Low Block"],
                ["set_pieces", isAr ? "الكرات الثابتة" : "Set Pieces"],
              ].map(([mid, lbl]) => (
                <button
                  key={mid}
                  type="button"
                  onClick={() => runMatchSimulator(mid)}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold border whitespace-nowrap ${
                    simMode === mid ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-700 border-slate-200"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => runMatchSimulator()}
              disabled={runningSim}
              className="w-full py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white font-bold transition"
            >
              {runningSim ? (isAr ? "جاري المحاكاة..." : "Simulating...") : isAr ? "تشغيل محاكاة المباراة الدقيقة" : "Run Match Simulation"}
            </button>

            {simRes && (
              <div className="space-y-2 pt-1">
                {/* Win / Draw / Loss Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold">
                    <span className="text-[#15803D]">{club.name_ar}: {simRes.win_prob_pct}%</span>
                    <span className="text-slate-500">{isAr ? "تعادل" : "Draw"} {simRes.draw_prob_pct}%</span>
                    <span className="text-rose-600">{opponent.club_id === "none" ? (isAr ? "الخصم" : "Opp") : opponent.name_ar}: {simRes.loss_prob_pct}%</span>
                  </div>
                  <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-slate-100">
                    <div style={{ width: `${simRes.win_prob_pct}%` }} className="bg-[#15803D]" />
                    <div style={{ width: `${simRes.draw_prob_pct}%` }} className="bg-slate-400" />
                    <div style={{ width: `${simRes.loss_prob_pct}%` }} className="bg-rose-500" />
                  </div>
                </div>

                {/* xG / Possession / PPDA */}
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[9.5px] text-slate-500">xG</div>
                    <div className="font-extrabold text-slate-900 tabular-nums">{simRes.xg_team_a} × {simRes.xg_team_b}</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[9.5px] text-slate-500">{isAr ? "الاستحواذ" : "Poss"}</div>
                    <div className="font-extrabold text-slate-900 tabular-nums">{simRes.possession_pct_a}%</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[9.5px] text-slate-500">PPDA</div>
                    <div className="font-extrabold text-slate-900 tabular-nums">{simRes.ppda_a}</div>
                  </div>
                </div>

                {/* Top Scorelines */}
                <div className="flex flex-wrap gap-1">
                  {simRes.top_scorelines.map((ts) => (
                    <span key={ts.score} className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-800">
                      {ts.score} ({ts.prob_pct}%)
                    </span>
                  ))}
                </div>

                {/* 0-90' Momentum Mini Bars */}
                <div className="grid grid-cols-6 gap-1 pt-1">
                  {simRes.momentum_blocks.map((mb) => (
                    <div key={mb.window} className="text-center">
                      <div className="h-8 bg-slate-100 rounded flex items-end overflow-hidden p-0.5">
                        <div style={{ height: `${Math.min(100, mb.control_pct)}%` }} className="w-full bg-[#15803D] rounded-xs" />
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{mb.window}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1 text-[10.5px] text-slate-700">
                  {simRes.tactical_insights_ar.map((ins, i) => (
                    <div key={i} className="p-1.5 rounded bg-slate-50 border border-slate-200">{ins}</div>
                  ))}
                  {simRes.risk_warnings_ar.map((w, i) => (
                    <div key={i} className="p-1.5 rounded bg-amber-50 border border-amber-200 text-amber-900 font-bold">{w}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Visual Photo-Based Squad Swap Modal */}
      {swapModalOpen && selectedEl?.kind === "node" && selectedNodeObj && (
        <div
          dir={isAr ? "rtl" : "ltr"}
          className="fixed inset-0 z-[100] bg-[#0B1F3A]/45 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
          onClick={() => setSwapModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[86dvh] bg-white rounded-3xl border border-[#D8E3EB] shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3.5 bg-[#F2F6F8] border-b border-[#D8E3EB] flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-[#0B1F3A]">
                  {isAr
                    ? `اختر البديل لمركز (${selectedNodeObj.slot}) — بدلاً من #${selectedNodeObj.jersey_number} ${selectedNodeObj.player_label}`
                    : `Replace #${selectedNodeObj.jersey_number} ${selectedNodeObj.player_label} (${selectedNodeObj.slot})`}
                </h3>
                <p className="text-[11px] text-[#5C6A7C]">
                  {isAr ? "اختيار لاعب موجود داخل الملعب سيبدّل مكانهما تلقائياً" : "Selecting an on-pitch player cleanly swaps their slots"}
                </p>
              </div>
              <button type="button" onClick={() => setSwapModalOpen(false)} aria-label="Close" className="p-2 rounded-xl hover:bg-slate-200 text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 start-3" />
                  <input
                    type="text"
                    value={swapSearch}
                    onChange={(e) => setSwapSearch(e.target.value)}
                    placeholder={isAr ? "ابحث باسم اللاعب أو رقمه..." : "Search name or jersey..."}
                    className="w-full rounded-xl bg-slate-50 border border-slate-200 ps-8 pe-3 py-1.5 text-xs outline-none focus:border-[#0FB5AE] focus:bg-white"
                  />
                </div>
                <div className="flex gap-1 text-[11px]">
                  {(
                    [
                      ["ALL", isAr ? "الكل" : "All"],
                      ["GK", isAr ? "حراس" : "GK"],
                      ["DEF", isAr ? "دفاع" : "DEF"],
                      ["MID", isAr ? "وسط" : "MID"],
                      ["ATT", isAr ? "هجوم" : "ATT"],
                    ] as const
                  ).map(([id, lbl]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSwapPosTab(id)}
                      className={`px-2.5 py-1 rounded-lg font-extrabold ${
                        swapPosTab === id ? "bg-[#0D717A] text-white" : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(() => {
                  const pool = selectedEl.team === "team_a" ? club.players : opponent.players;
                  const onPitchNums = new Set(
                    (selectedEl.team === "team_a" ? currentPhase?.nodes || [] : currentPhase?.opponent_nodes || []).map((n) => n.jersey_number)
                  );
                  const q = swapSearch.trim().toLowerCase();
                  return pool
                    .filter((pl) => {
                      const up = pl.position.toUpperCase();
                      if (swapPosTab === "GK" && !up.includes("GK")) return false;
                      if (swapPosTab === "DEF" && !/(CB|RB|LB|WB)/.test(up)) return false;
                      if (swapPosTab === "MID" && !/(DM|CM|AM|RM|LM)/.test(up)) return false;
                      if (swapPosTab === "ATT" && !/(ST|CF|RW|LW)/.test(up)) return false;
                      if (!q) return true;
                      return (
                        pl.name_ar.toLowerCase().includes(q) ||
                        pl.name_en.toLowerCase().includes(q) ||
                        String(pl.jersey_number) === q
                      );
                    })
                    .map((pl) => {
                      const isOnPitch = onPitchNums.has(pl.jersey_number);
                      const isCur = pl.jersey_number === selectedNodeObj.jersey_number;
                      const blocked = !pl.is_eligible_starter;
                      return (
                        <button
                          key={pl.jersey_number}
                          type="button"
                          disabled={isCur || blocked}
                          onClick={() => swapSelectedPlayer(pl.jersey_number)}
                          className={`p-2.5 rounded-2xl border text-start flex items-center gap-3 transition ${
                            isCur
                              ? "bg-emerald-50 border-emerald-400 opacity-75"
                              : blocked
                                ? "bg-rose-50/70 border-rose-200 opacity-60 cursor-not-allowed"
                                : "bg-white border-slate-200 hover:border-[#0FB5AE] hover:bg-[#F7FBFE]"
                          }`}
                        >
                          {pl.photo_url ? (
                            <img src={pl.photo_url} alt={pl.name_ar} className="w-10 h-10 rounded-xl object-cover object-top border border-slate-200 shrink-0 bg-slate-100" />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-[#0D717A] text-white font-extrabold flex items-center justify-center shrink-0">
                              #{pl.jersey_number}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-extrabold text-xs text-slate-900 truncate">
                              #{pl.jersey_number} {isAr ? pl.name_ar : pl.name_en}
                            </div>
                            <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                              <span className="font-bold text-[#0D717A]">{pl.position}</span>
                              {pl.age && <span>• {pl.age}س</span>}
                              {blocked && <span className="text-rose-600 font-bold">• {pl.block_reason_ar}</span>}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                            isCur ? "bg-emerald-600 text-white" : isOnPitch ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"
                          }`}>
                            {isCur ? (isAr ? "الحالي" : "Current") : isOnPitch ? (isAr ? "في الملعب" : "On Pitch") : isAr ? "دكة" : "Bench"}
                          </span>
                        </button>
                      );
                    });
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
