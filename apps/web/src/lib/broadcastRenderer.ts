/**
 * Broadcast-Grade AR Tactical Graphics Renderer (Canvas 2D, 60FPS)
 * Premier League Oracle / Sky Sports MNF / LaLiga Beyond Stats style primitives.
 */

export interface RenderPlayer {
  track_id: number;
  role: string;
  team: string;
  x_m: number;
  y_m: number;
  vx_ms?: number;
  vy_ms?: number;
  speed_kmh?: number;
  verified_name?: string | null;
  jersey_number?: number | null;
  bbox: [number, number, number, number];
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return `rgba(56, 189, 248, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(56, 189, 248, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface GroundRingOptions {
  colorHex: string;
  emphasized?: boolean;
  subtle?: boolean;
  phaseRad?: number;
  isCarrier?: boolean;
}

/**
 * Draw a multi-layer European broadcast perspective disc anchored to a player's feet.
 */
export function drawBroadcastGroundRing(
  ctx: CanvasRenderingContext2D,
  p: RenderPlayer,
  opts: GroundRingOptions
): void {
  const [x1, y1, x2, y2] = p.bbox;
  const cx = (x1 + x2) * 0.5;
  const cy = y2;
  const bh = Math.max(22, y2 - y1);
  const rx = Math.max(13, Math.min(36, bh * 0.31));
  const ry = rx * 0.31;
  const { colorHex, emphasized = false, subtle = false, phaseRad = 0, isCarrier = false } = opts;

  ctx.save();

  // Subtle turf drop-shadow ellipse
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1.5, rx * 1.06, ry * 1.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = subtle ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.40)";
  ctx.fill();

  if (subtle && !emphasized && !isCarrier) {
    // Unintrusive quiet micro-ring in Focus Mode
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.78, ry * 0.78, 0, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(colorHex, 0.35);
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Soft floor halo fill
  const floorGrad = ctx.createRadialGradient(cx, cy, rx * 0.1, cx, cy, rx);
  floorGrad.addColorStop(0, hexToRgba(colorHex, emphasized || isCarrier ? 0.32 : 0.14));
  floorGrad.addColorStop(0.75, hexToRgba(colorHex, emphasized ? 0.14 : 0.05));
  floorGrad.addColorStop(1, hexToRgba(colorHex, 0));
  ctx.fillStyle = floorGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outer crisp double-bezel broadcast OPEN BASE ring (270° arc open at front of boots — KlipDraw/Viz Libero style!)
  ctx.shadowColor = hexToRgba(colorHex, emphasized ? 0.85 : 0.55);
  ctx.shadowBlur = emphasized ? 14 : 7;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.72, Math.PI * 2.28);
  ctx.strokeStyle = hexToRgba(colorHex, emphasized || isCarrier ? 0.96 : 0.84);
  ctx.lineWidth = emphasized || isCarrier ? 2.8 : 1.85;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner animated segmented orbital ring for emphasized / ball-carrier focus
  if (emphasized || isCarrier) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.88)";
    for (let s = 0; s < 3; s++) {
      const a0 = phaseRad + (s * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 0.72, ry * 0.72, 0, a0, a0 + Math.PI * 0.38);
      ctx.stroke();
    }
  }

  // Directional velocity chevron cone on pitch when player sprints/runs fast
  const spd = p.speed_kmh ?? 0;
  const vx = p.vx_ms ?? 0;
  const vy = p.vy_ms ?? 0;
  const vMag = Math.hypot(vx, vy);
  if (spd >= 7.0 && vMag > 0.5) {
    const dirX = vx / vMag;
    const dirY = (vy / vMag) * 0.48; // flattened for camera perspective
    const len = Math.min(34, 14 + spd * 0.6);
    const ex = cx + dirX * len;
    const ey = cy + dirY * len;
    const gVel = ctx.createLinearGradient(cx, cy, ex, ey);
    gVel.addColorStop(0, hexToRgba(colorHex, 0.78));
    gVel.addColorStop(1, hexToRgba(colorHex, 0));
    ctx.strokeStyle = gVel;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx + dirX * rx * 0.85, cy + dirY * ry * 0.85);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Sky Sports MNF style translucent Spotlight vertical pillar + crisp Floating Telemetry Callout Card.
 * Call this AFTER green-turf occlusion so text and light beam remain crystal-clear!
 */
export function drawSpotlightBeamAndCard(
  ctx: CanvasRenderingContext2D,
  p: RenderPlayer,
  vw: number,
  vh: number,
  colorHex: string,
  ballXY?: [number, number] | null,
  labelOverride?: string
): void {
  const [x1, y1, x2, y2] = p.bbox;
  const cx = (x1 + x2) * 0.5;
  const cy = y2;
  const bh = Math.max(24, y2 - y1);
  const rx = Math.max(14, Math.min(36, bh * 0.31));

  ctx.save();
  ctx.direction = "ltr";

  // Translucent MNF Spotlight beam from top of frame to player's feet
  const beamTopY = Math.max(0, y1 - bh * 1.45);
  const beamGrad = ctx.createLinearGradient(cx, beamTopY, cx, cy);
  beamGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
  beamGrad.addColorStop(0.55, hexToRgba(colorHex, 0.14));
  beamGrad.addColorStop(1, hexToRgba(colorHex, 0.28));
  ctx.fillStyle = beamGrad;
  ctx.beginPath();
  ctx.moveTo(cx - rx * 0.48, beamTopY);
  ctx.lineTo(cx + rx * 0.48, beamTopY);
  ctx.lineTo(cx + rx * 1.05, cy);
  ctx.lineTo(cx - rx * 1.05, cy);
  ctx.closePath();
  ctx.fill();

  // Leader dot at upper torso -> Broadcast Telemetry Callout Card
  const anchorX = cx;
  const anchorY = Math.max(18, y1 - 8);
  const cardW = 148;
  const cardH = 40;
  const preferLeft = cx > vw * 0.72;
  const rawCardX = preferLeft ? cx - cardW - 18 : cx + 18;
  const cardX = Math.max(8, Math.min(vw - cardW - 8, rawCardX));
  const cardY = Math.max(8, Math.min(vh - cardH - 8, y1 - cardH - 12));

  // Crisp angled leader line + endpoint dot
  ctx.strokeStyle = hexToRgba(colorHex, 0.9);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, y1 + 4);
  ctx.lineTo(anchorX, anchorY);
  ctx.lineTo(preferLeft ? cardX + cardW : cardX, cardY + cardH * 0.5);
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(cx, y1 + 4, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Frosted dark glass callout card with left team accent bar
  ctx.fillStyle = "rgba(9, 13, 22, 0.90)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 7);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colorHex;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, 4, cardH, [7, 0, 0, 7]);
  ctx.fill();

  const title =
    labelOverride ||
    (p.verified_name
      ? p.jersey_number
        ? `#${p.jersey_number} ${p.verified_name}`
        : p.verified_name
      : p.jersey_number
      ? `#${p.jersey_number}`
      : `Track #${p.track_id}`);
  const spdStr = `${(p.speed_kmh ?? 0).toFixed(1)} km/h`;
  const distStr = ballXY
    ? `${Math.hypot(p.x_m - ballXY[0], p.y_m - ballXY[1]).toFixed(1)}m`
    : "—";

  ctx.fillStyle = "#F8FAFC";
  ctx.font = "700 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title.slice(0, 20), cardX + 10, cardY + 13);

  ctx.fillStyle = "#94A3B8";
  ctx.font = "600 10px Inter, monospace";
  ctx.fillText(`${spdStr}  •  ${distStr} ball`, cardX + 10, cardY + 28);

  ctx.restore();
}

/**
 * Draw 3D vertical tactical curtain & luminous bottom tether between linked defenders,
 * plus crystal-clear distance pills above turf occlusion.
 */
export function drawTacticalChainWall(
  ctx: CanvasRenderingContext2D,
  chainPlayers: RenderPlayer[],
  vw: number,
  vh: number,
  drawPillsOnly: boolean
): void {
  if (chainPlayers.length < 2) return;
  ctx.save();
  ctx.direction = "ltr";

  for (let i = 0; i < chainPlayers.length - 1; i++) {
    const a = chainPlayers[i];
    const b = chainPlayers[i + 1];
    const ax = (a.bbox[0] + a.bbox[2]) * 0.5;
    const ay = a.bbox[3];
    const bx = (b.bbox[0] + b.bbox[2]) * 0.5;
    const by = b.bbox[3];
    const ah = Math.max(24, (a.bbox[3] - a.bbox[1]) * 0.42);
    const bh = Math.max(24, (b.bbox[3] - b.bbox[1]) * 0.42);
    const distM = Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m);
    const exposed = distM > 12.0;
    const strokeCol = exposed ? "#EF4444" : "#10B981";

    if (!drawPillsOnly) {
      // Translucent 3D tactical defensive curtain standing on turf
      const wallGrad = ctx.createLinearGradient(0, Math.min(ay - ah, by - bh), 0, Math.max(ay, by));
      wallGrad.addColorStop(0, hexToRgba(strokeCol, 0.02));
      wallGrad.addColorStop(1, hexToRgba(strokeCol, 0.30));
      ctx.fillStyle = wallGrad;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx, by - bh);
      ctx.lineTo(ax, ay - ah);
      ctx.closePath();
      ctx.fill();

      // Luminous top crest + glowing ground chain
      ctx.strokeStyle = hexToRgba(strokeCol, 0.45);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay - ah);
      ctx.lineTo(bx, by - bh);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.shadowColor = hexToRgba(strokeCol, 0.85);
      ctx.shadowBlur = 8;
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Anchor nodes at feet
      for (const [nx, ny] of [
        [ax, ay],
        [bx, by],
      ]) {
        ctx.fillStyle = "#090D16";
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(nx, ny, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else {
      // Crisp floating spacing pill
      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5 - 6;
      const lbl = `${distM.toFixed(1)}m`;
      ctx.font = "700 11px Inter, monospace";
      const pw = Math.max(46, ctx.measureText(lbl).width + 14);
      const px = Math.max(4, Math.min(vw - pw - 4, mx - pw * 0.5));
      const py = Math.max(4, Math.min(vh - 22, my - 10));
      ctx.fillStyle = "rgba(9, 13, 22, 0.90)";
      ctx.strokeStyle = hexToRgba(strokeCol, 0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, 20, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = exposed ? "#FCA5A5" : "#6EE7B7";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lbl, px + pw * 0.5, py + 10.5);
    }
  }

  ctx.restore();
}

/**
 * Draw real Kalman ball comet trail + 3D ballistic elevation shadow + velocity vector arrow.
 */
export function drawBallCometAndArc(
  ctx: CanvasRenderingContext2D,
  trail: Array<{ u: number; v: number; z_m: number }>,
  velPx?: { vx: number; vy: number },
  passMode: "ground" | "foreground" | "all" = "all"
): void {
  if (!trail.length) return;
  ctx.save();

  const head = trail[trail.length - 1];
  const elevY = Math.max(0, head.z_m * 6);
  const by = head.v - elevY;

  if (passMode === "ground" || passMode === "all") {
    if (trail.length >= 2) {
      for (let i = 1; i < trail.length; i++) {
        const t0 = trail[i - 1];
        const t1 = trail[i];
        if (Math.hypot(t1.u - t0.u, t1.v - t0.v) > 180) continue;
        const alpha = (i / trail.length) * 0.72;
        ctx.strokeStyle = `rgba(250, 204, 21, ${alpha})`;
        ctx.lineWidth = 1.6 + (i / trail.length) * 2.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(t0.u, t0.v - t0.z_m * 6);
        ctx.lineTo(t1.u, t1.v - t1.z_m * 6);
        ctx.stroke();
      }
    }

    // Turf drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.48)";
    ctx.beginPath();
    ctx.ellipse(head.u, head.v + 3, 6.5, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (passMode === "foreground" || passMode === "all") {
    if (elevY > 4) {
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = "rgba(250, 204, 21, 0.5)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(head.u, head.v);
      ctx.lineTo(head.u, by);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // High-contrast reticle around ball (drawn above turf mask so white ball never erases it)
    ctx.strokeStyle = "rgba(9, 13, 22, 0.78)";
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.arc(head.u, by, 8.2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowColor = "rgba(250, 204, 21, 0.92)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = "#FACC15";
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.arc(head.u, by, 8.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Explicit velocity direction vector arrow along real ball travel
    if (velPx) {
      const spdPx = Math.hypot(velPx.vx, velPx.vy);
      if (spdPx >= 18) {
        const ang = Math.atan2(velPx.vy, velPx.vx);
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        const arrowLen = Math.max(20, Math.min(58, spdPx * 0.14));
        const sx = head.u + ux * 9.5;
        const sy = by + uy * 9.5;
        const ex = head.u + ux * (9.5 + arrowLen);
        const ey = by + uy * (9.5 + arrowLen);

        ctx.strokeStyle = "rgba(9, 13, 22, 0.72)";
        ctx.lineWidth = 4.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        ctx.strokeStyle = "#FACC15";
        ctx.lineWidth = 2.3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        const headLen = 9.5;
        ctx.fillStyle = "#FACC15";
        ctx.beginPath();
        ctx.moveTo(ex + ux * 3.5, ey + uy * 3.5);
        ctx.lineTo(ex - headLen * Math.cos(ang - 0.45), ey - headLen * Math.sin(ang - 0.45));
        ctx.lineTo(ex - headLen * Math.cos(ang + 0.45), ey - headLen * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  ctx.restore();
}

/**
 * Project a translucent LaLiga-style goal-probability cone wedge toward the ACTUAL defended goal.
 */
export function drawGoalProbabilityCone(
  ctx: CanvasRenderingContext2D,
  ballU: number,
  ballV: number,
  vw: number,
  vh: number,
  attackingRight: boolean,
  xgValue: number
): void {
  const goalU = attackingRight ? vw * 0.94 : vw * 0.06;
  const goalVTop = vh * 0.36;
  const goalVBot = vh * 0.56;

  ctx.save();
  ctx.direction = "ltr";
  const grad = ctx.createLinearGradient(ballU, ballV, goalU, (goalVTop + goalVBot) * 0.5);
  grad.addColorStop(0, "rgba(16, 185, 129, 0.32)");
  grad.addColorStop(0.6, "rgba(16, 185, 129, 0.12)");
  grad.addColorStop(1, "rgba(16, 185, 129, 0.02)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(ballU, ballV);
  ctx.lineTo(goalU, goalVTop);
  ctx.lineTo(goalU, goalVBot);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(16, 185, 129, 0.55)";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(ballU, ballV);
  ctx.lineTo(goalU, goalVTop);
  ctx.moveTo(ballU, ballV);
  ctx.lineTo(goalU, goalVBot);
  ctx.stroke();
  ctx.setLineDash([]);

  // Compact directional xG cone badge mid-way along cone
  const mx = ballU * 0.62 + goalU * 0.38;
  const my = ballV * 0.62 + ((goalVTop + goalVBot) * 0.5) * 0.38;
  const pillW = 76;
  const px = Math.max(8, Math.min(vw - pillW - 8, mx - pillW * 0.5));
  const py = Math.max(8, Math.min(vh - 28, my - 10));
  ctx.fillStyle = "rgba(9,13,22,0.88)";
  ctx.strokeStyle = "rgba(16,185,129,0.68)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(px, py, pillW, 20, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#6EE7B7";
  ctx.font = "700 10.5px Inter, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    attackingRight ? `xG ${xgValue.toFixed(2)} ▶` : `◀ xG ${xgValue.toFixed(2)}`,
    px + pillW * 0.5,
    py + 10.5
  );
  ctx.restore();
}

/** Draw arched 3D tactical arrow with turf shadow and glowing triangle head. */
export function draw3DCurvedArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colorHex = "#38BDF8"
): void {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist < 8) return;
  const mx = (x1 + x2) * 0.5;
  const myGround = (y1 + y2) * 0.5;
  const arch = Math.min(48, dist * 0.22);
  const cy = myGround - arch;

  ctx.save();

  // Turf drop shadow
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x1, y1 + 4);
  ctx.lineTo(x2, y2 + 4);
  ctx.stroke();

  // Arched glowing curve
  ctx.shadowColor = hexToRgba(colorHex, 0.8);
  ctx.shadowBlur = 9;
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, cy, x2, y2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Arrowhead tangent at end of quadratic curve
  const ang = Math.atan2(y2 - cy, x2 - mx);
  const headLen = 13;
  ctx.fillStyle = colorHex;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(ang - 0.42), y2 - headLen * Math.sin(ang - 0.42));
  ctx.lineTo(x2 - headLen * Math.cos(ang + 0.42), y2 - headLen * Math.sin(ang + 0.42));
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/** Draw calibrated SkyPad 3D Tape Measure with glowing crosshair anchors and meter pill. */
export function draw3DTapeMeasure(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  vw: number,
  vh: number,
  metersEstimate?: number
): void {
  const pxDist = Math.hypot(x2 - x1, y2 - y1);
  if (pxDist < 6) return;
  const estM = metersEstimate ?? Math.max(0.5, Number((pxDist / 26).toFixed(1)));

  ctx.save();
  ctx.direction = "ltr";
  ctx.strokeStyle = "#F59E0B";
  ctx.lineWidth = 2.4;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const [cx, cy] of [
    [x1, y1],
    [x2, y2],
  ]) {
    ctx.strokeStyle = "#FCD34D";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const mx = (x1 + x2) * 0.5;
  const my = (y1 + y2) * 0.5;
  const lbl = `${estM.toFixed(1)}m`;
  const px = Math.max(4, Math.min(vw - 56, mx - 26));
  const py = Math.max(4, Math.min(vh - 24, my - 11));
  ctx.fillStyle = "rgba(9,13,22,0.92)";
  ctx.strokeStyle = "#F59E0B";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(px, py, 52, 21, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#FDE68A";
  ctx.font = "700 11px Inter, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(lbl, px + 26, py + 10.5);
  ctx.restore();
}

/** Draw translucent perspective elliptical Tactical Zone highlight (e.g. Zone 14). */
export function drawTacticalZone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  colorHex = "#10B981"
): void {
  if (rx < 10 || ry < 6) return;
  ctx.save();
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, Math.max(rx, ry));
  g.addColorStop(0, hexToRgba(colorHex, 0.28));
  g.addColorStop(1, hexToRgba(colorHex, 0.06));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hexToRgba(colorHex, 0.85);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Draw recognizable glowing athletic Ghost Silhouette at virtual defender position
 * with curved dashed move path from original defender.
 */
export function drawGhostSilhouette(
  ctx: CanvasRenderingContext2D,
  p: RenderPlayer,
  gx: number,
  gy: number,
  vw: number,
  vh: number,
  deltaXgPct?: number
): void {
  const cx = (p.bbox[0] + p.bbox[2]) * 0.5;
  const cy = p.bbox[3];
  const bh = Math.max(30, p.bbox[3] - p.bbox[1]);
  const bw = Math.max(14, (p.bbox[2] - p.bbox[0]) * 0.85);
  const rx = Math.max(14, Math.min(34, bh * 0.30));
  const ry = rx * 0.31;

  ctx.save();
  ctx.direction = "ltr";

  // Curved tactical trajectory from real feet to ghost target
  const midX = (cx + gx) * 0.5;
  const midY = (cy + gy) * 0.5 - 12;
  ctx.strokeStyle = "rgba(16, 185, 129, 0.92)";
  ctx.lineWidth = 2.4;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(midX, midY, gx, gy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ground disc at ghost destination
  const gGrad = ctx.createRadialGradient(gx, gy, 2, gx, gy, rx * 1.1);
  gGrad.addColorStop(0, "rgba(16, 185, 129, 0.45)");
  gGrad.addColorStop(1, "rgba(16, 185, 129, 0.04)");
  ctx.fillStyle = gGrad;
  ctx.beginPath();
  ctx.ellipse(gx, gy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#10B981";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Athletic translucent 3D standing silhouette at (gx, gy)
  const headR = bh * 0.10;
  const headY = gy - bh * 0.88;
  ctx.fillStyle = "rgba(16, 185, 129, 0.24)";
  ctx.strokeStyle = "rgba(110, 231, 183, 0.88)";
  ctx.lineWidth = 1.6;

  // Head
  ctx.beginPath();
  ctx.arc(gx, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Shoulders + Torso + Legs athletic path
  ctx.beginPath();
  ctx.moveTo(gx - bw * 0.42, gy - bh * 0.72);
  ctx.lineTo(gx + bw * 0.42, gy - bh * 0.72);
  ctx.lineTo(gx + bw * 0.30, gy - bh * 0.35);
  ctx.lineTo(gx + bw * 0.26, gy);
  ctx.lineTo(gx + bw * 0.06, gy);
  ctx.lineTo(gx, gy - bh * 0.32);
  ctx.lineTo(gx - bw * 0.06, gy);
  ctx.lineTo(gx - bw * 0.26, gy);
  ctx.lineTo(gx - bw * 0.30, gy - bh * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (deltaXgPct !== undefined) {
    const sign = deltaXgPct > 0 ? "+" : "";
    const badge = `Ghost ${sign}${deltaXgPct}% xG`;
    const bwPill = 104;
    const bx = Math.max(6, Math.min(vw - bwPill - 6, gx - bwPill * 0.5));
    const by = Math.min(vh - 24, gy + 12);
    ctx.fillStyle = "rgba(9,13,22,0.92)";
    ctx.strokeStyle = "#10B981";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bwPill, 20, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#6EE7B7";
    ctx.font = "700 10.5px Inter, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(badge, bx + bwPill * 0.5, by + 10.5);
  }

  ctx.restore();
}

/** Draw subtle glowing pass option lanes from ball carrier to open nearby teammates. */
export function drawPassingLanesOverlay(
  ctx: CanvasRenderingContext2D,
  carrier: RenderPlayer,
  players: RenderPlayer[]
): void {
  const cx = (carrier.bbox[0] + carrier.bbox[2]) * 0.5;
  const cy = carrier.bbox[3];
  const mates = players
    .filter((p) => p.team === carrier.team && p.track_id !== carrier.track_id && p.role === "player")
    .map((p) => ({
      p,
      ux: (p.bbox[0] + p.bbox[2]) * 0.5,
      uy: p.bbox[3],
      dM: Math.hypot(p.x_m - carrier.x_m, p.y_m - carrier.y_m),
    }))
    .filter((item) => item.dM >= 4.0 && item.dM <= 32.0)
    .sort((a, b) => a.dM - b.dM)
    .slice(0, 2);

  if (!mates.length) return;
  ctx.save();
  ctx.direction = "ltr";
  for (const m of mates) {
    ctx.strokeStyle = "rgba(250, 204, 21, 0.72)";
    ctx.lineWidth = 2.0;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(m.ux, m.uy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** Draw compact 2D FIFA Tactical Radar Minimap anchored bottom-center of broadcast canvas. */
export function drawBroadcastRadarMinimap(
  ctx: CanvasRenderingContext2D,
  players: RenderPlayer[],
  ballXY: [number, number] | null,
  vw: number,
  vh: number,
  teamAHex: string,
  teamBHex: string
): void {
  if (!players.length) return;
  const mw = Math.min(184, Math.max(132, Math.round(vw * 0.17)));
  const mh = Math.round(mw * 0.64);
  const mx = Math.round((vw - mw) * 0.5);
  const my = vh - mh - 12;

  ctx.save();
  ctx.direction = "ltr";
  ctx.fillStyle = "rgba(9, 20, 16, 0.80)";
  ctx.strokeStyle = "rgba(110, 231, 183, 0.48)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(mx, my, mw, mh, 7);
  ctx.fill();
  ctx.stroke();

  // Pitch markings
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mx + mw * 0.5, my + 3);
  ctx.lineTo(mx + mw * 0.5, my + mh - 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(mx + mw * 0.5, my + mh * 0.5, Math.max(8, mh * 0.16), 0, Math.PI * 2);
  ctx.stroke();

  for (const p of players) {
    const px = mx + 5 + Math.max(0, Math.min(1, p.x_m / 105)) * (mw - 10);
    const py = my + 5 + Math.max(0, Math.min(1, p.y_m / 68)) * (mh - 10);
    ctx.fillStyle =
      p.role === "goalkeeper" ? "#22D3EE" : p.team === "team_a" ? teamAHex : teamBHex;
    ctx.beginPath();
    ctx.arc(px, py, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  if (ballXY) {
    const bx = mx + 5 + Math.max(0, Math.min(1, ballXY[0] / 105)) * (mw - 10);
    const by = my + 5 + Math.max(0, Math.min(1, ballXY[1] / 68)) * (mh - 10);
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(bx, by, 4.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#10B981";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}
