"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  Download,
  Link2,
  Move,
  MoveUpRight,
  Pause,
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
}

type ToolMode = "drag" | "link_players" | "pass_arrow" | "run_arrow" | "press_arrow" | "zone";
type DisplayMode = "both" | "team_a" | "team_b";

const FORMATIONS = ["4-2-3-1", "4-3-3", "3-4-2-1", "3-2-4-1", "3-5-2", "4-4-2", "5-3-2"];
const PHASE_META: Array<{ id: TacticalPhaseId; ar: string; en: string; color: string }> = [
  { id: "possession", ar: "1. في حالة الاستحواذ", en: "1. Possession", color: "#10B981" },
  { id: "attack", ar: "2. في حالة الهجوم", en: "2. Attacking", color: "#F59E0B" },
  { id: "defense", ar: "3. قطع الكرة والدفاع", en: "3. Defense & Recovery", color: "#EF4444" },
];
const PRESET_BUTTONS = [
  { label: "ألونسو 3-4-2-1", prompt: "تشابي ألونسو 3-4-2-1" },
  { label: "جوارديولا 3-2-4-1", prompt: "جوارديولا 3-2-4-1" },
  { label: "كلوب 4-3-3", prompt: "كلوب 4-3-3" },
  { label: "إنزاجي 3-5-2", prompt: "إنزاجي 3-5-2" },
];

type SelectedElement =
  | { kind: "node"; team: "team_a" | "team_b"; index: number }
  | { kind: "arrow"; idx: number; isOpp: boolean }
  | { kind: "link"; id: string }
  | { kind: "zone"; idx: number }
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
}: Props) {
  const isAr = lang === "ar";
  const [formA, setFormA] = useState(defaultFormation || "4-2-3-1");
  const [formB, setFormB] = useState("4-4-2");
  const [activePhase, setActivePhase] = useState<TacticalPhaseId>("possession");
  const [phases, setPhases] = useState<Record<TacticalPhaseId, TacticalPhaseSnapshot> | null>(null);
  const [undoStack, setUndoStack] = useState<Record<TacticalPhaseId, TacticalPhaseSnapshot>[]>([]);

  const [tool, setTool] = useState<ToolMode>("drag");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("both");
  const [selectedEl, setSelectedEl] = useState<SelectedElement>(null);
  const [linkPending, setLinkPending] = useState<{ team: "team_a" | "team_b"; slot: string } | null>(null);
  const [linkKind, setLinkKind] = useState<"pass" | "support" | "mark">("pass");
  const [drawColor, setDrawColor] = useState("#FACC15");

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

  const loadBlueprintFromApi = async (fA: string, fB: string, presetPrompt = "") => {
    try {
      const bp = await apiFetch<ThreePhaseBlueprint>(
        "/api/coach/tactics/blueprint",
        {
          method: "POST",
          body: JSON.stringify({
            club_id: club.club_id,
            opponent_id: opponent.club_id,
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
        setSelectedEl(null);
        setUndoStack([]);
      }
    } catch {}
  };

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

    // Turf stripes
    ctx.fillStyle = "#062016";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = "#08291D";
        ctx.fillRect(pad + (i * pw) / 12, pad, pw / 12, ph);
      }
    }

    // FIFA markings
    ctx.strokeStyle = "rgba(255,255,255,0.42)";
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
      drawArrowLine(n1.x_m, n1.y_m, n2.x_m, n2.y_m, lk.color, lk.kind !== "pass", `${dist}m`, isSel);
    });

    const drawPlayers = (list: BlueprintNode[], team: "team_a" | "team_b", hex: string) => {
      list.forEach((n, idx) => {
        const pt = toPx(n.x_m, n.y_m);
        const isSel = selectedEl?.kind === "node" && selectedEl.team === team && selectedEl.index === idx;
        const isPendingLink = linkPending && linkPending.team === team && linkPending.slot === n.slot;
        ctx.save();
        if (isSel || isPendingLink) {
          ctx.strokeStyle = isPendingLink ? "#38BDF8" : "#10B981";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 19, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = n.slot === "GK" ? "#F59E0B" : hex;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = hex.toUpperCase() === "#F8FAFC" || n.slot === "GK" ? "#090D16" : "#FFFFFF";
        ctx.font = "bold 10.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.jersey_number || n.slot), pt.x, pt.y);

        const nm = (n.player_label || n.slot).split(" ").slice(-1)[0];
        ctx.fillStyle = "rgba(9,13,22,0.85)";
        ctx.fillRect(pt.x - 28, pt.y + 15, 56, 13);
        ctx.fillStyle = "#F8FAFC";
        ctx.font = "bold 9px sans-serif";
        ctx.fillText(`${n.slot} ${nm}`.slice(0, 12), pt.x, pt.y + 21.5);
        ctx.restore();
      });
    };

    if (displayMode !== "team_b") drawPlayers(nodesA, "team_a", club.kit_hex || "#EF4444");
    if (displayMode !== "team_a") drawPlayers(nodesB, "team_b", opponent.kit_hex || "#38BDF8");
  }, [currentPhase, morphDisplay, displayMode, selectedEl, linkPending, club.kit_hex, opponent.kit_hex]);

  const toMetersFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
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

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
      setSelectedEl(null);
      return;
    }

    draftBoxRef.current = { sx: x_m, sy: y_m, cx: x_m, cy: y_m };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x_m, y_m } = toMetersFromEvent(e);
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
    }
    setSelectedEl(null);
  };

  const swapSelectedPlayer = (jerseyNum: number) => {
    if (selectedEl?.kind !== "node") return;
    const pool = selectedEl.team === "team_a" ? club.players : opponent.players;
    const pl = pool.find((x) => x.jersey_number === jerseyNum);
    if (!pl) return;
    commitPhaseEdit((p) => {
      const list = selectedEl.team === "team_a" ? p.nodes : p.opponent_nodes;
      list[selectedEl.index] = {
        ...list[selectedEl.index],
        jersey_number: pl.jersey_number,
        player_label: isAr ? pl.name_ar || pl.name_en : pl.name_en,
      };
      return p;
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
  const selectedNodeObj =
    selectedEl?.kind === "node" && currentPhase
      ? (selectedEl.team === "team_a" ? currentPhase.nodes : currentPhase.opponent_nodes)[selectedEl.index]
      : null;

  return (
    <div dir={isAr ? "rtl" : "ltr"} className="space-y-3">
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
                    setActivePhase(pm.id);
                    setSelectedEl(null);
                  }}
                  className={`px-3 py-1.5 rounded-xl font-extrabold border transition flex items-center gap-1.5 ${
                    isAct
                      ? "bg-emerald-500 text-slate-950 border-emerald-300 shadow"
                      : "bg-[#090D16] text-slate-200 border-white/10 hover:border-white/25"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isAct ? "#090D16" : pm.color }} />
                  <span>{isAr ? pm.ar : pm.en}</span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => setIsMorphing((v) => !v)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl font-extrabold border transition ${
                isMorphing
                  ? "bg-amber-400 text-slate-950 border-amber-300"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/35 hover:bg-amber-500/25"
              }`}
            >
              {isMorphing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isMorphing ? (isAr ? "إيقاف التحوّل" : "Stop Morph") : isAr ? "عرض تحوّل الحالات الـ 3" : "Animate 3 Phases"}</span>
            </button>
          </div>

          {/* Right Formation & Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={formA}
              aria-label="Your Formation"
              onChange={(e) => {
                setFormA(e.target.value);
                loadBlueprintFromApi(e.target.value, formB);
              }}
              className="rounded-xl bg-[#090D16] border border-emerald-500/35 px-2.5 py-1.5 font-extrabold text-emerald-300"
            >
              {FORMATIONS.map((f) => (
                <option key={f} value={f}>{club.name_ar}: {f}</option>
              ))}
            </select>
            <select
              value={formB}
              aria-label="Opponent Formation"
              onChange={(e) => {
                setFormB(e.target.value);
                loadBlueprintFromApi(formA, e.target.value);
              }}
              className="rounded-xl bg-[#090D16] border border-sky-500/35 px-2.5 py-1.5 font-extrabold text-sky-300"
            >
              {FORMATIONS.map((f) => (
                <option key={f} value={f}>{opponent.name_ar}: {f}</option>
              ))}
            </select>
            {PRESET_BUTTONS.map((pr) => (
              <button
                key={pr.label}
                type="button"
                onClick={() => loadBlueprintFromApi(formA, formB, pr.prompt)}
                className="px-2.5 py-1.5 rounded-xl bg-[#090D16] border border-white/10 hover:border-emerald-400 text-[11px] font-bold text-slate-200"
              >
                {pr.label}
              </button>
            ))}
          </div>
        </div>

        {/* Drawing & Linking Tools Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.07]">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["drag", isAr ? "سحب / تحديد" : "Drag / Select", <Move key="m" className="w-3.5 h-3.5" />],
                ["link_players", isAr ? "ربط لاعبين" : "Link Players", <Link2 key="l" className="w-3.5 h-3.5" />],
                ["pass_arrow", isAr ? "سهم تمرير" : "Pass Arrow", <MoveUpRight key="p" className="w-3.5 h-3.5" />],
                ["run_arrow", isAr ? "سهم تحرك" : "Run Arrow", <Zap key="r" className="w-3.5 h-3.5" />],
                ["press_arrow", isAr ? "سهم ضغط" : "Press Arrow", <Swords key="pr" className="w-3.5 h-3.5" />],
                ["zone", isAr ? "رسم منطقة" : "Zone", <Square key="z" className="w-3.5 h-3.5" />],
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
                  tool === id ? "bg-emerald-500 text-slate-950" : "bg-[#090D16] border border-white/10 text-slate-300"
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
                className="rounded-xl bg-[#090D16] border border-sky-400/50 px-2 py-1 text-[11px] font-bold text-sky-300"
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
              className="w-7 h-7 rounded-lg bg-transparent border border-white/15 cursor-pointer"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["both", "11v11"],
                ["team_a", club.name_ar],
                ["team_b", opponent.name_ar],
              ] as Array<[DisplayMode, string]>
            ).map(([dm, lbl]) => (
              <button
                key={dm}
                type="button"
                onClick={() => setDisplayMode(dm)}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold ${
                  displayMode === dm ? "bg-sky-500 text-slate-950" : "bg-[#090D16] text-slate-300 border border-white/10"
                }`}
              >
                {lbl}
              </button>
            ))}
            <button type="button" onClick={handleUndo} disabled={undoStack.length === 0} className="p-1.5 rounded-lg bg-[#090D16] border border-white/10 text-slate-300 disabled:opacity-35" title={isAr ? "تراجع" : "Undo"}>
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => loadBlueprintFromApi(formA, formB)} className="p-1.5 rounded-lg bg-[#090D16] border border-white/10 text-slate-300" title={isAr ? "إعادة ضبط" : "Reset"}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={exportPng} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#090D16] border border-white/15 text-slate-200 font-bold">
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>PNG</span>
            </button>
            <button type="button" onClick={saveAllPhases} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500 text-slate-950 font-extrabold">
              <Save className="w-3.5 h-3.5" />
              <span>{isAr ? "حفظ الـ 3 حالات" : "Save All"}</span>
            </button>
          </div>
        </div>

        {savingMsg && <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 font-bold">{savingMsg}</div>}
      </div>

      {/* Main Pitch-First 12-Col Layout: 8-Col Hero Pitch + 4-Col Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-8 studio-panel p-3 space-y-2">
          {currentPhase && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
              <span className="font-extrabold text-emerald-300">{isAr ? currentPhase.label_ar : currentPhase.label_en}</span>
              <span className="text-[11px] text-slate-400">{currentPhase.description_ar}</span>
            </div>
          )}

          <canvas
            ref={cvsRef}
            width={960}
            height={590}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="w-full rounded-2xl border border-emerald-500/30 bg-[#062016] cursor-crosshair"
          />

          <div className="text-[11px] text-slate-400 px-1 flex flex-wrap items-center justify-between">
            <span>
              {tool === "link_players"
                ? linkPending
                  ? isAr
                    ? `اختر اللاعب الثاني لإتمام الربط من ${linkPending.slot}`
                    : `Click second player to link from ${linkPending.slot}`
                  : isAr
                    ? "انقر على اللاعب الأول ثم اللاعب الثاني لربطهما بمسار تمرير أو مساندة أو رقابة"
                    : "Click first player then second player to create tactical link"
                : isAr
                  ? "اسحب أي لاعب من الفريقين مباشرةً، أو انقر على أي سهم/منطقة/ربط لتعديله أو حذفه."
                  : "Drag any of the 22 players or click any arrow/link/zone to edit or delete."}
            </span>
            <span>{fitPlayers.length} {isAr ? "متاحين" : "eligible"}</span>
          </div>
        </div>

        {/* Right 4-Col Tactical Inspector & Set-Piece Lab */}
        <div className="xl:col-span-4 space-y-3 text-xs">
          {/* Selected Element Editor */}
          <div className="studio-panel p-3.5 space-y-2.5">
            <div className="flex items-center justify-between font-extrabold text-white">
              <span className="flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4 text-emerald-400" />
                <span>{isAr ? "تحرير العنصر المحدد" : "Selected Element Editor"}</span>
              </span>
              {selectedEl && selectedEl.kind !== "node" && (
                <button
                  type="button"
                  onClick={deleteSelected}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{isAr ? "حذف" : "Delete"}</span>
                </button>
              )}
            </div>

            {selectedNodeObj && selectedEl?.kind === "node" ? (
              <div className="space-y-2 p-2.5 rounded-xl bg-[#090D16] border border-white/[0.08]">
                <div className="font-extrabold text-emerald-300">
                  #{selectedNodeObj.jersey_number} {selectedNodeObj.player_label} ({selectedNodeObj.slot})
                </div>
                <div className="text-[11px] text-slate-400">
                  {selectedNodeObj.role_ar} • X={selectedNodeObj.x_m}m, Y={selectedNodeObj.y_m}m
                </div>
                <label className="block text-[11px] font-bold text-slate-300 pt-1">
                  {isAr ? "تبديل بلاعب آخر من القائمة:" : "Swap with Squad Player:"}
                </label>
                <select
                  value={selectedNodeObj.jersey_number || ""}
                  onChange={(e) => swapSelectedPlayer(Number(e.target.value))}
                  aria-label="Swap Player"
                  className="w-full rounded-lg bg-[#0C1220] border border-white/15 px-2.5 py-1.5 text-xs text-white"
                >
                  {(selectedEl.team === "team_a" ? fitPlayers : opponent.players).map((p) => (
                    <option key={p.jersey_number} value={p.jersey_number}>
                      #{p.jersey_number} {p.name_ar} ({p.position})
                    </option>
                  ))}
                </select>
              </div>
            ) : selectedEl ? (
              <div className="p-2.5 rounded-xl bg-[#090D16] border border-white/[0.08] text-slate-200">
                {isAr ? "تم تحديد العنصر التكتيكي — يمكنك حذفه من الزر بالأعلى أو الرسم بحرية." : "Element selected — delete or continue drawing."}
              </div>
            ) : (
              <div className="text-slate-400">
                {isAr ? "انقر على أي لاعب أو سهم أو ربط في الملعب لتعديله أو تبديله أو حذفه." : "Click any player, arrow, or link on the pitch."}
              </div>
            )}
          </div>

          {/* Live Math Validator */}
          <div className="studio-panel p-3.5 space-y-2">
            <div className="flex items-center justify-between font-extrabold text-white">
              <span className="flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span>{isAr ? "المدقق الرياضي للحالة" : "Phase Math Validator"}</span>
              </span>
              <span className="text-emerald-300 font-extrabold">
                {mathScore ? `${mathScore.overall_balance_score}/100` : "Live"}
              </span>
            </div>
            {mathScore && (
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="p-2 rounded-lg bg-[#090D16] border border-white/[0.06]">
                  <span className="text-slate-400">{isAr ? "عمق الخطوط:" : "Depth:"}</span>{" "}
                  <b className="text-white">{mathScore.vertical_length_m}m</b>
                </div>
                <div className="p-2 rounded-lg bg-[#090D16] border border-white/[0.06]">
                  <span className="text-slate-400">{isAr ? "تأمين الدفاع:" : "Rest Def:"}</span>{" "}
                  <b className="text-emerald-300">{mathScore.rest_defenders_count}</b>
                </div>
              </div>
            )}
          </div>

          {/* Match Instructions */}
          <div className="studio-panel p-3.5 space-y-2">
            <div className="font-extrabold text-white">{isAr ? "تعليمات الأسلوب داخل المباراة" : "Game Plan Controls"}</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] text-slate-400 mb-1">{isAr ? "ارتفاع الخط" : "Line Height"}</div>
                <select
                  value={lineHeight}
                  aria-label="Line Height"
                  onChange={(e) => setLineHeight(e.target.value as "low" | "mid" | "high")}
                  className="w-full rounded-lg bg-[#090D16] border border-white/15 px-2 py-1 text-[11px] text-white"
                >
                  <option value="low">{isAr ? "منخفض (Low)" : "Low"}</option>
                  <option value="mid">{isAr ? "متوازن (Mid)" : "Mid"}</option>
                  <option value="high">{isAr ? "متقدم (High)" : "High"}</option>
                </select>
              </div>
              <div>
                <div className="text-[10px] text-slate-400 mb-1">{isAr ? "نمط الضغط" : "Pressing"}</div>
                <select
                  value={pressingStyle}
                  aria-label="Pressing Style"
                  onChange={(e) => setPressingStyle(e.target.value as "contain" | "trigger" | "gegenpress")}
                  className="w-full rounded-lg bg-[#090D16] border border-white/15 px-2 py-1 text-[11px] text-white"
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
            <div className="flex items-center gap-1.5 font-extrabold text-white">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>{isAr ? "معمل الكرات الثابتة (9,600 محاكاة)" : "Set-Piece Lab (9,600 Rollouts)"}</span>
            </div>
            {spRes && (
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-200">
                {isAr
                  ? `احتمال التهديف: ${spRes.baseline_goal_prob_pct}% ← ${spRes.optimized_goal_prob_pct}% (+${spRes.uplift_pct_points}%) • هدف (${spRes.target_zone_xy.join(", ")})`
                  : `Baseline ${spRes.baseline_goal_prob_pct}% -> ${spRes.optimized_goal_prob_pct}% (+${spRes.uplift_pct_points}%)`}
              </div>
            )}
            <button
              type="button"
              onClick={runSetPieceLab}
              disabled={runningSp}
              className="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold transition"
            >
              {runningSp ? (isAr ? "جاري المحاكاة..." : "Running...") : isAr ? "تشغيل 9,600 محاكاة ركنية" : "Run 9,600 Rollouts"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
