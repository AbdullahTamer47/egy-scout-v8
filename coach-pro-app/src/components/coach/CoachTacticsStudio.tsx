"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Camera,
  Download,
  Film,
  Grid,
  Link2,
  Move,
  MoveUpRight,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Shield,
  Sparkles,
  Square,
  Swords,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";
import { apiFetch, BlueprintNode, MathValidationResult } from "@/lib/api";
import {
  CoachClubDetail,
  EditableArrow,
  EditableZone,
  FreehandStroke,
  getShortArabicName,
  isLightHex,
  PlayerTacticalLink,
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
  onFormationChange?: (formation: string) => void;
}

type ToolMode = "drag" | "link_players" | "pass_arrow" | "run_arrow" | "press_arrow" | "zone" | "freehand";
type DisplayMode = "both" | "team_a" | "team_b";

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
  { id: "possession", ar: "1. في حالة الاستحواذ", en: "1. Possession", color: "#0D717A" },
  { id: "attack", ar: "2. في حالة الهجوم", en: "2. Attacking", color: "#E0A526" },
  { id: "defense", ar: "3. قطع الكرة والدفاع", en: "3. Defense & Recovery", color: "#DC2626" },
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
  | null;

interface SetPieceResult {
  baseline_goal_prob_pct: number;
  optimized_goal_prob_pct: number;
  uplift_pct_points: number;
  target_zone_xy: number[];
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
  onFormationChange,
}: Props) {
  const isAr = lang === "ar";
  const [teamSize, setTeamSize] = useState<number>(11);
  const [formA, setFormA] = useState(defaultFormation || "4-2-3-1");
  const [formB, setFormB] = useState("4-4-2");
  const [activePhase, setActivePhase] = useState<TacticalPhaseId>("possession");
  const [phases, setPhases] = useState<Record<TacticalPhaseId, TacticalPhaseSnapshot> | null>(null);
  const [undoStack, setUndoStack] = useState<Record<TacticalPhaseId, TacticalPhaseSnapshot>[]>([]);

  const [tool, setTool] = useState<ToolMode>("drag");
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
  const [morphDisplay, setMorphDisplay] = useState<{ nodesA: BlueprintNode[]; nodesB: BlueprintNode[] } | null>(null);
  const [mathScore, setMathScore] = useState<MathValidationResult | null>(null);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);
  const [lineHeight, setLineHeight] = useState<"low" | "mid" | "high">("mid");
  const [pressingStyle, setPressingStyle] = useState<"contain" | "trigger" | "gegenpress">("trigger");

  const [spRes, setSpRes] = useState<SetPieceResult | null>(null);
  const [runningSp, setRunningSp] = useState(false);

  const cvsRef = useRef<HTMLCanvasElement | null>(null);
  const dragNodeRef = useRef<{ team: "team_a" | "team_b"; index: number } | null>(null);
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

  // 3-Phase Smooth Morph Playback Animation
  useEffect(() => {
    if (!isMorphing || !phases) return;
    const seq: TacticalPhaseId[] = ["possession", "attack", "defense", "possession"];
    const segMs = 1500;
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
        setMorphDisplay({
          nodesA: lerp(p0.nodes, p1.nodes),
          nodesB: lerp(p0.opponent_nodes, p1.opponent_nodes),
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

  // Pitch Canvas Drawing Loop
  useEffect(() => {
    const cvs = cvsRef.current;
    if (!cvs || !currentPhase) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const W = cvs.width;
    const H = cvs.height;
    const pad = 26;
    const pw = W - pad * 2;
    const ph = H - pad * 2;
    const toPx = (xm: number, ym: number) => ({ x: pad + (xm / 105) * pw, y: pad + (ym / 68) * ph });

    // Sunlit stadium turf stripes
    ctx.fillStyle = "#15803D";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = "#166534";
        ctx.fillRect(pad + (i * pw) / 12, pad, pw / 12, ph);
      }
    }

    // FIFA markings
    ctx.strokeStyle = "rgba(255,255,255,0.84)";
    ctx.lineWidth = 1.6;
    ctx.strokeRect(pad, pad, pw, ph);
    ctx.beginPath();
    ctx.moveTo(W / 2, pad);
    ctx.lineTo(W / 2, H - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, ph * (9.15 / 68), 0, Math.PI * 2);
    ctx.stroke();
    const boxW = pw * (16.5 / 105);
    const boxH = ph * (40.32 / 68);
    ctx.strokeRect(pad, (H - boxH) / 2, boxW, boxH);
    ctx.strokeRect(W - pad - boxW, (H - boxH) / 2, boxW, boxH);
    const sixW = pw * (5.5 / 105);
    const sixH = ph * (18.32 / 68);
    ctx.strokeRect(pad, (H - sixH) / 2, sixW, sixH);
    ctx.strokeRect(W - pad - sixW, (H - sixH) / 2, sixW, sixH);

    // 5-Channel Positional Play Grid (Half-spaces + Zone 14 corridors + Vertical Thirds)
    if (showChannelsGrid) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
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

    // Custom / Tactical Zones
    currentPhase.custom_zones.forEach((z, idx) => {
      const p1 = toPx(Math.min(z.x1_m, z.x2_m), Math.min(z.y1_m, z.y2_m));
      const p2 = toPx(Math.max(z.x1_m, z.x2_m), Math.max(z.y1_m, z.y2_m));
      const isSel = selectedEl?.kind === "zone" && selectedEl.idx === idx;
      ctx.save();
      ctx.fillStyle = `${z.color || "#F59E0B"}22`;
      ctx.strokeStyle = isSel ? "#FFFFFF" : z.color || "#F59E0B";
      ctx.lineWidth = isSel ? 2.6 : 1.5;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      ctx.fillStyle = "#E2E8F0";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(z.label_ar || "Zone", p1.x + 6, p1.y + 14);
      ctx.restore();
    });

    const nodesA = morphDisplay ? morphDisplay.nodesA : currentPhase.nodes;
    const nodesB = morphDisplay ? morphDisplay.nodesB : currentPhase.opponent_nodes;

    const findNode = (team: "team_a" | "team_b", slot: string) =>
      (team === "team_a" ? nodesA : nodesB).find((n) => n.slot === slot);

    // Passing & Custom Arrows
    const allArrows: Array<{ ar: EditableArrow; idx: number; isOpp: boolean }> = [
      ...(displayMode !== "team_b" ? currentPhase.passing_arrows.map((ar, idx) => ({ ar, idx, isOpp: false })) : []),
      ...(displayMode !== "team_b" ? currentPhase.custom_arrows.map((ar, idx) => ({ ar, idx: idx + 1000, isOpp: false })) : []),
      ...(displayMode !== "team_a" ? (currentPhase.opponent_passing_arrows || []).map((ar, idx) => ({ ar, idx, isOpp: true })) : []),
    ];

    const drawArrowLine = (fx: number, fy: number, tx: number, ty: number, col: string, dashed: boolean, labelTxt?: string, highlighted = false) => {
      const a = toPx(fx, fy);
      const b = toPx(tx, ty);
      if (Math.hypot(b.x - a.x, b.y - a.y) < 6) return;
      ctx.save();
      ctx.strokeStyle = highlighted ? "#FFFFFF" : col;
      ctx.lineWidth = highlighted ? 3.5 : 2.3;
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
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      if (labelTxt) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.fillStyle = "rgba(9,13,22,0.88)";
        ctx.fillRect(mx - 24, my - 9, 48, 17);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.strokeRect(mx - 24, my - 9, 48, 17);
        ctx.fillStyle = "#F8FAFC";
        ctx.font = "bold 9.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(labelTxt, mx, my);
      }
      ctx.restore();
    };

    allArrows.forEach(({ ar, idx, isOpp }) => {
      const isSel = selectedEl?.kind === "arrow" && selectedEl.idx === idx && selectedEl.isOpp === isOpp;
      const badge = ar.xpass_pct ? `${ar.xpass_pct}%` : ar.label_ar ? ar.label_ar.slice(0, 10) : undefined;
      drawArrowLine(ar.from_x_m, ar.from_y_m, ar.to_x_m, ar.to_y_m, ar.color || (isOpp ? "#38BDF8" : "#FACC15"), ar.kind !== "pass", badge, isSel);
    });

    // Player-to-Player Custom Links
    currentPhase.custom_links.forEach((lk) => {
      const n1 = findNode(lk.fromTeam, lk.fromSlot);
      const n2 = findNode(lk.toTeam, lk.toSlot);
      if (!n1 || !n2) return;
      const dist = Math.hypot(n2.x_m - n1.x_m, n2.y_m - n1.y_m).toFixed(1);
      const isSel = selectedEl?.kind === "link" && selectedEl.id === lk.id;
      const badgeTxt = lk.label ? `${lk.label} (${dist}m)` : `${dist}m`;
      drawArrowLine(n1.x_m, n1.y_m, n2.x_m, n2.y_m, lk.color, lk.kind !== "pass", badgeTxt, isSel);
    });

    // Freehand Chalk Strokes (Persisted + Live Draft)
    const strokes: FreehandStroke[] = [
      ...(currentPhase.freehand_strokes || []),
      ...(liveFreehand.length >= 2 ? [{ id: "__draft__", points: liveFreehand, color: drawColor, width: 3 }] : []),
    ];
    strokes.forEach((st) => {
      if (!st.points || st.points.length < 2) return;
      const isSel = selectedEl?.kind === "stroke" && selectedEl.id === st.id;
      ctx.save();
      ctx.strokeStyle = isSel ? "#FFFFFF" : st.color || "#FACC15";
      ctx.lineWidth = isSel ? 5 : st.width || 3.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      st.points.forEach((pt, idx) => {
        const px = toPx(pt.x, pt.y);
        if (idx === 0) ctx.moveTo(px.x, px.y);
        else ctx.lineTo(px.x, px.y);
      });
      ctx.stroke();
      ctx.restore();
    });

    const drawPlayers = (list: BlueprintNode[], team: "team_a" | "team_b", hex: string) => {
      const lightKit = isLightHex(hex);
      list.forEach((n, idx) => {
        const pt = toPx(n.x_m, n.y_m);
        const isSel = selectedEl?.kind === "node" && selectedEl.team === team && selectedEl.index === idx;
        const isPendingLink = linkPending && linkPending.team === team && linkPending.slot === n.slot;
        const darkInk = n.slot === "GK" || lightKit;
        ctx.save();
        if (isSel || isPendingLink) {
          ctx.strokeStyle = isPendingLink ? "#0FB5AE" : "#E0A526";
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 19, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = n.slot === "GK" ? "#E0A526" : hex;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = darkInk ? "#0B1F3A" : "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = darkInk ? "#0B1F3A" : "#FFFFFF";
        ctx.font = "bold 10.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.jersey_number || n.slot), pt.x, pt.y);

        // Editable position tag pill above circle
        const slotTxt = String(n.slot || "").slice(0, 6);
        ctx.font = "bold 8.5px sans-serif";
        const sw = Math.max(24, ctx.measureText(slotTxt).width + 8);
        ctx.fillStyle = team === "team_a" ? "#0B1F3A" : "#FFFFFF";
        ctx.fillRect(pt.x - sw / 2, pt.y - 26, sw, 11);
        ctx.fillStyle = team === "team_a" ? "#0FB5AE" : "#0B1F3A";
        ctx.fillText(slotTxt, pt.x, pt.y - 20.5);

        // Full 2-word clear Arabic player name pill below circle
        const rawNm = (n.player_label || n.slot).trim();
        const words = rawNm.split(/\s+/).filter(Boolean);
        const fullNm = words.length <= 2 ? rawNm : `${words[0]} ${words[words.length - 1]}`;
        ctx.font = "bold 9.5px sans-serif";
        const nw = Math.max(46, Math.min(118, ctx.measureText(fullNm).width + 12));
        ctx.fillStyle = "rgba(11, 31, 58, 0.9)";
        ctx.fillRect(pt.x - nw / 2, pt.y + 15, nw, 15);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(fullNm, pt.x, pt.y + 22.5);
        ctx.restore();
      });
    };

    if (displayMode !== "team_b") drawPlayers(nodesA, "team_a", club.kit_hex || "#DC2626");
    if (displayMode !== "team_a") drawPlayers(nodesB, "team_b", opponent.kit_hex || "#0284C7");
  }, [currentPhase, morphDisplay, displayMode, showChannelsGrid, selectedEl, linkPending, club.kit_hex, opponent.kit_hex, liveFreehand, drawColor]);

  const toMetersFromEvent = (e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>) => {
    const cvs = cvsRef.current!;
    const rect = cvs.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * cvs.width;
    const cy = ((e.clientY - rect.top) / rect.height) * cvs.height;
    const pad = 26;
    const pw = cvs.width - pad * 2;
    const ph = cvs.height - pad * 2;
    return {
      x_m: Math.max(2, Math.min(103, Math.round((((cx - pad) / pw) * 105) * 10) / 10)),
      y_m: Math.max(2, Math.min(66, Math.round((((cy - pad) / ph) * 68) * 10) / 10)),
    };
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
    const hitN = hitPlayer(x_m, y_m);

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
      // Check arrows & custom links for editing/deletion
      for (let i = 0; i < currentPhase.custom_links.length; i++) {
        const lk = currentPhase.custom_links[i];
        const a = (lk.fromTeam === "team_a" ? currentPhase.nodes : currentPhase.opponent_nodes).find((n) => n.slot === lk.fromSlot);
        const b = (lk.toTeam === "team_a" ? currentPhase.nodes : currentPhase.opponent_nodes).find((n) => n.slot === lk.toSlot);
        if (a && b && distToSegment(x_m, y_m, a.x_m, a.y_m, b.x_m, b.y_m) < 2.3) {
          setSelectedEl({ kind: "link", id: lk.id });
          return;
        }
      }
      for (let i = 0; i < currentPhase.passing_arrows.length; i++) {
        const ar = currentPhase.passing_arrows[i];
        if (distToSegment(x_m, y_m, ar.from_x_m, ar.from_y_m, ar.to_x_m, ar.to_y_m) < 2.3) {
          setSelectedEl({ kind: "arrow", idx: i, isOpp: false });
          return;
        }
      }
      for (let i = 0; i < currentPhase.custom_arrows.length; i++) {
        const ar = currentPhase.custom_arrows[i];
        if (distToSegment(x_m, y_m, ar.from_x_m, ar.from_y_m, ar.to_x_m, ar.to_y_m) < 2.3) {
          setSelectedEl({ kind: "arrow", idx: i + 1000, isOpp: false });
          return;
        }
      }
      for (let i = 0; i < currentPhase.custom_zones.length; i++) {
        const z = currentPhase.custom_zones[i];
        if (x_m >= Math.min(z.x1_m, z.x2_m) && x_m <= Math.max(z.x1_m, z.x2_m) && y_m >= Math.min(z.y1_m, z.y2_m) && y_m <= Math.max(z.y1_m, z.y2_m)) {
          setSelectedEl({ kind: "zone", idx: i });
          return;
        }
      }
      for (const st of currentPhase.freehand_strokes || []) {
        for (let k = 1; k < st.points.length; k++) {
          if (distToSegment(x_m, y_m, st.points[k - 1].x, st.points[k - 1].y, st.points[k].x, st.points[k].y) < 2.2) {
            setSelectedEl({ kind: "stroke", id: st.id });
            return;
          }
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
    if (freehandDraftRef.current) {
      const pts = freehandDraftRef.current;
      freehandDraftRef.current = null;
      setLiveFreehand([]);
      if (pts.length >= 2) {
        const st: FreehandStroke = { id: `fh-${Date.now()}`, points: pts, color: drawColor, width: 3.2 };
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
        } else {
          const kind = tool === "press_arrow" ? "press" : tool === "run_arrow" ? "run" : "pass";
          const ar: EditableArrow = {
            id: `ar-${Date.now()}`,
            from_x_m: sx,
            from_y_m: sy,
            to_x_m: cx,
            to_y_m: cy,
            kind,
            color: kind === "press" ? "#EF4444" : kind === "run" ? "#38BDF8" : drawColor,
            label_ar: kind === "press" ? "ضغط" : kind === "run" ? "تحرك" : "تمرير",
          };
          commitPhaseEdit((p) => ({ ...p, custom_arrows: [...p.custom_arrows, ar] }));
        }
      }
    }
  };

  const deleteSelected = () => {
    if (!selectedEl) return;
    if (selectedEl.kind === "link") {
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
        if (list[selectedEl.index]) {
          list[selectedEl.index] = {
            ...list[selectedEl.index],
            jersey_number: pl.jersey_number,
            player_label: getShortArabicName(pl),
          };
        }
        next[pk] = ph;
      }
      return next;
    });
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

  const saveAllPhases = async () => {
    if (!phases) return;
    await apiFetch(
      "/api/plans",
      {
        method: "POST",
        body: JSON.stringify({
          match_id: `${club.club_id}_vs_${opponent.club_id}`,
          name: `${club.name_ar} (${formA}) × ${opponent.name_ar} — 3 حالات`,
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
    setSavingMsg(isAr ? "تم حفظ الحالات التكتيكية الـ 3 والتعديلات في قاعدة البيانات ✓" : "Saved all 3 phases ✓");
    setTimeout(() => setSavingMsg(null), 3500);
  };

  const exportPng = () => {
    if (!cvsRef.current) return;
    const a = document.createElement("a");
    a.href = cvsRef.current.toDataURL("image/png");
    a.download = `egy_scout_${club.club_id}_${activePhase}_${formA}.png`;
    a.click();
  };

  const runSetPieceLab = async () => {
    setRunningSp(true);
    try {
      const res = await apiFetch<SetPieceResult>(
        "/api/coach/set-pieces/optimize",
        { method: "POST", body: JSON.stringify({ scenario: "right_corner_inswinger" }) },
        "club_demo_egypt",
        "coach"
      );
      setSpRes(res);
    } finally {
      setRunningSp(false);
    }
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
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-3">
      {/* Row 0: Multi-Format Team Size Bar (5v5 .. 11v11) */}
      <div className="studio-panel p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-extrabold text-[#0B1F3A] px-1">
            {isAr ? "مقاس السبورة التكتيكية:" : "Match Format:"}
          </span>
          {TEAM_SIZES.map((sz) => (
            <button
              key={sz}
              type="button"
              onClick={() => handleTeamSizeChange(sz)}
              className={`px-2.5 py-1 rounded-lg font-extrabold border transition ${
                teamSize === sz
                  ? "bg-[#0B1F3A] text-white border-[#0B1F3A] shadow-2xs"
                  : "bg-[#F2F6F8] text-[#5C6A7C] border-[#D8E3EB] hover:border-[#0FB5AE] hover:text-[#0B1F3A]"
              }`}
            >
              {sz}×{sz}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowChannelsGrid((v) => !v)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold border transition ${
              showChannelsGrid
                ? "bg-[#E6F8F7] text-[#0D717A] border-[#0FB5AE]/50"
                : "bg-[#F2F6F8] text-[#5C6A7C] border-[#D8E3EB]"
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>{isAr ? "شبكة المساحات" : "5-Channels Grid"}</span>
          </button>

          <button
            type="button"
            onClick={captureKeyframe}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F2F6F8] hover:bg-[#E6F8F7] border border-[#D8E3EB] text-[#0B1F3A] font-bold"
          >
            <Camera className="w-3.5 h-3.5 text-[#0D717A]" />
            <span>{isAr ? `+ لقطة (${keyframes.length})` : `+ Keyframe (${keyframes.length})`}</span>
          </button>

          {keyframes.length >= 2 && (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsMorphing(false);
                  setPlayingKeyframes((v) => !v);
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-extrabold border ${
                  playingKeyframes
                    ? "bg-[#E0A526] text-[#0B1F3A] border-[#E0A526]"
                    : "bg-[#0D717A] text-white border-[#0D717A]"
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>{playingKeyframes ? (isAr ? "إيقاف" : "Stop") : isAr ? "تشغيل السيناريو" : "Play Playbook"}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlayingKeyframes(false);
                  setKeyframes([]);
                }}
                className="px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold"
              >
                {isAr ? "مسح" : "Clear"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Compact Row 1: 3 Tactical Phase Tabs + Morph Animation + Formations + Presets */}
      <div className="studio-panel p-3 space-y-2.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 3 Tactical Phase States Selector */}
          <div className="flex flex-wrap items-center gap-1.5">
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
                  className={`px-3 py-1.5 rounded-xl font-extrabold border transition flex items-center gap-1.5 ${
                    isAct
                      ? "bg-[#0D717A] text-white border-[#0D717A] shadow-xs"
                      : "bg-[#F2F6F8] text-[#0B1F3A] border-[#D8E3EB] hover:border-[#0FB5AE]"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isAct ? "#E0A526" : pm.color }} />
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
              className={`inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-xl font-extrabold border transition ${
                isMorphing
                  ? "bg-[#E0A526] text-[#0B1F3A] border-[#E0A526] shadow-xs"
                  : "bg-amber-50 text-amber-900 border-[#E0A526]/40 hover:bg-amber-100"
              }`}
            >
              {isMorphing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isMorphing ? (isAr ? "إيقاف التحول" : "Stop Morph") : isAr ? "عرض تحول الحالات الـ 3" : "Animate 3 Phases"}</span>
            </button>
          </div>

          {/* Right Formation & Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
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
              className="rounded-xl bg-[#E6F8F7] border border-[#0FB5AE]/50 px-2.5 py-1.5 font-extrabold text-[#0D717A]"
            >
              {activeFormationsList.map((f) => (
                <option key={f} value={f}>{club.name_ar}: {f}</option>
              ))}
            </select>
            <select
              value={formB}
              aria-label="Opponent Formation"
              onChange={(e) => {
                setFormB(e.target.value);
                loadBlueprintFromApi(formA, e.target.value, "", teamSize);
              }}
              className="rounded-xl bg-[#F2F6F8] border border-[#D8E3EB] px-2.5 py-1.5 font-extrabold text-[#0B1F3A]"
            >
              {activeFormationsList.map((f) => (
                <option key={f} value={f}>{opponent.name_ar}: {f}</option>
              ))}
            </select>
            {teamSize === 11 && PRESET_BUTTONS.map((pr) => (
              <button
                key={pr.label}
                type="button"
                onClick={() => loadBlueprintFromApi(formA, formB, pr.prompt, 11)}
                className="px-2.5 py-1.5 rounded-xl bg-[#F2F6F8] border border-[#D8E3EB] hover:border-[#0FB5AE] text-[11px] font-bold text-[#0B1F3A]"
              >
                {pr.label}
              </button>
            ))}
          </div>
        </div>

        {/* Drawing & Linking Tools Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["drag", isAr ? "سحب / تحديد" : "Drag / Select", <Move key="m" className="w-3.5 h-3.5" />],
                ["link_players", isAr ? "ربط لاعبين" : "Link Players", <Link2 key="l" className="w-3.5 h-3.5" />],
                ["pass_arrow", isAr ? "سهم تمرير" : "Pass Arrow", <MoveUpRight key="p" className="w-3.5 h-3.5" />],
                ["run_arrow", isAr ? "سهم تحرك" : "Run Arrow", <Zap key="r" className="w-3.5 h-3.5" />],
                ["press_arrow", isAr ? "سهم ضغط" : "Press Arrow", <Swords key="pr" className="w-3.5 h-3.5" />],
                ["zone", isAr ? "رسم منطقة" : "Zone", <Square key="z" className="w-3.5 h-3.5" />],
                ["freehand", isAr ? "قلم حر" : "Freehand", <Pencil key="fh" className="w-3.5 h-3.5" />],
              ] as Array<[ToolMode, string, React.ReactNode]>
            ).map(([id, lbl, icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTool(id);
                  setLinkPending(null);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl font-bold transition ${
                  tool === id ? "bg-emerald-600 text-white shadow-2xs" : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100"
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
                className="rounded-xl bg-sky-50 border border-sky-200 px-2 py-1 text-[11px] font-bold text-sky-800"
              >
                <option value="pass">{isAr ? "قناة تمرير" : "Pass Link"}</option>
                <option value="support">{isAr ? "تغطية ومساندة" : "Support Cover"}</option>
                <option value="mark">{isAr ? "رقابة على الخصم" : "Man-Mark"}</option>
              </select>
            )}

            <input
              type="color"
              value={drawColor}
              aria-label="Draw Color"
              onChange={(e) => setDrawColor(e.target.value)}
              className="w-7 h-7 rounded-lg bg-white border border-slate-300 cursor-pointer p-0.5"
            />
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
                className={`px-2 py-1 rounded-lg text-[11px] font-bold ${
                  displayMode === dm ? "bg-[#0D717A] text-white" : "bg-[#F2F6F8] text-[#0B1F3A] border border-[#D8E3EB] hover:bg-slate-100"
                }`}
              >
                {lbl}
              </button>
            ))}
            <button type="button" onClick={handleUndo} disabled={undoStack.length === 0} className="p-1.5 rounded-lg bg-[#F2F6F8] border border-[#D8E3EB] text-[#0B1F3A] disabled:opacity-35" title={isAr ? "تراجع" : "Undo"}>
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => loadBlueprintFromApi(formA, formB, "", teamSize)} className="p-1.5 rounded-lg bg-[#F2F6F8] border border-[#D8E3EB] text-[#0B1F3A]" title={isAr ? "إعادة ضبط" : "Reset"}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={exportPng} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-bold hover:border-emerald-400">
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>PNG</span>
            </button>
            <button type="button" onClick={saveAllPhases} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold shadow-2xs">
              <Save className="w-3.5 h-3.5" />
              <span>{isAr ? "حفظ الـ 3 حالات" : "Save All"}</span>
            </button>
          </div>
        </div>

        {savingMsg && <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold">{savingMsg}</div>}
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

          <canvas
            ref={cvsRef}
            width={960}
            height={590}
            onPointerDown={handleMouseDown}
            onPointerMove={handleMouseMove}
            onPointerUp={handleMouseUp}
            onPointerCancel={handleMouseUp}
            className="w-full rounded-2xl border border-emerald-700/30 bg-[#15803D] cursor-crosshair shadow-sm touch-none"
          />

          <div className="text-[11px] text-slate-600 px-1 flex flex-wrap items-center justify-between">
            <span>
              {tool === "link_players"
                ? linkPending
                  ? isAr
                    ? `اختر اللاعب الثاني لإتمام الربط من ${linkPending.slot}`
                    : `Click second player to link from ${linkPending.slot}`
                  : isAr
                    ? "انقر على اللاعب الأول ثم اللاعب الثاني لربطهما بمسار تمرير أو مساندة أو رقابة"
                    : "Click first player then second player to create tactical link"
                : tool === "freehand"
                  ? isAr
                    ? "ارسم بالماوس أو الإصبع بحرية على الملعب لتوضيح الفكرة التكتيكية."
                    : "Draw freehand chalk lines anywhere on the pitch."
                  : isAr
                    ? "اسحب أي لاعب من الفريقين مباشرةً، أو انقر على أي سهم/منطقة/ربط لتعديله أو حذفه."
                    : "Drag any of the 22 players or click any arrow/link/zone to edit or delete."}
            </span>
            <span className="font-bold text-emerald-700">{fitPlayers.length} {isAr ? "متاحين" : "eligible"}</span>
          </div>
        </div>

        {/* Right 4-Col Tactical Inspector & Set-Piece Lab */}
        <div className="xl:col-span-4 space-y-3 text-xs">
          {/* Selected Element Editor */}
          <div className="studio-panel p-3.5 space-y-2.5">
            <div className="flex items-center justify-between font-extrabold text-slate-900">
              <span className="flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-emerald-600" />
                <span>{isAr ? "تحرير العنصر المحدد" : "Selected Element Editor"}</span>
              </span>
              {selectedEl && selectedEl.kind !== "node" && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{isAr ? "حذف" : "Delete"}</span>
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
                  {isAr ? "تبديل بلاعب آخر من القائمة:" : "Swap with Squad Player:"}
                </label>
                <select
                  value={selectedNodeObj.jersey_number || ""}
                  onChange={(e) => swapSelectedPlayer(Number(e.target.value))}
                  aria-label="Swap Player"
                  className="w-full rounded-lg bg-white border border-[#D8E3EB] px-2.5 py-1.5 text-xs text-[#0B1F3A]"
                >
                  {(selectedEl.team === "team_a" ? fitPlayers : opponent.players).map((p) => (
                    <option key={p.jersey_number} value={p.jersey_number}>
                      #{p.jersey_number} {p.name_ar} ({p.position})
                    </option>
                  ))}
                </select>

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

          {/* Docked Set-Piece Optimizer (Zero Overlap!) */}
          <div className="studio-panel p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 font-extrabold text-slate-900">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>{isAr ? "معمل الكرات الثابتة (9,600 محاكاة)" : "Set-Piece Lab (9,600 Rollouts)"}</span>
            </div>
            {spRes && (
              <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800">
                {isAr
                  ? `احتمال التهديف: ${spRes.baseline_goal_prob_pct}% ← ${spRes.optimized_goal_prob_pct}% (+${spRes.uplift_pct_points}%) • هدف (${spRes.target_zone_xy.join(", ")})`
                  : `Baseline ${spRes.baseline_goal_prob_pct}% -> ${spRes.optimized_goal_prob_pct}% (+${spRes.uplift_pct_points}%)`}
              </div>
            )}
            <button
              type="button"
              onClick={runSetPieceLab}
              disabled={runningSp}
              className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold transition shadow-2xs"
            >
              {runningSp ? (isAr ? "جاري المحاكاة..." : "Running...") : isAr ? "تشغيل 9,600 محاكاة ركنية" : "Run 9,600 Rollouts"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
