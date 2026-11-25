import { API_BASE, PlayerCardPayload, PlayerCardSummary } from "@/lib/api";
import { extractCardAttributes } from "@/components/PlayerCard";

const TIER_GRADIENTS = {
  gold: ["#F6DE8A", "#DFB54C", "#A8761E"],
  silver: ["#F8FAFC", "#CBD5E1", "#7B8797"],
  bronze: ["#E7AD77", "#B8763C", "#78481D"],
} as const;

function drawFutShieldPath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(w * 0.14, h * 0.042);
  ctx.quadraticCurveTo(w * 0.5, h * 0.007, w * 0.86, h * 0.042);
  ctx.quadraticCurveTo(w * 0.97, h * 0.063, w * 0.97, h * 0.141);
  ctx.lineTo(w * 0.97, h * 0.831);
  ctx.quadraticCurveTo(w * 0.97, h * 0.937, w * 0.5, h * 0.989);
  ctx.quadraticCurveTo(w * 0.03, h * 0.937, w * 0.03, h * 0.831);
  ctx.lineTo(w * 0.03, h * 0.141);
  ctx.quadraticCurveTo(w * 0.03, h * 0.063, w * 0.14, h * 0.042);
  ctx.closePath();
}

function loadCorsImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

function drawVectorJerseyOnCanvas(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  kitHex: string,
  jerseyNum: number | null,
  posCode: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(-22, -46);
  ctx.lineTo(-42, -34);
  ctx.lineTo(-52, -12);
  ctx.lineTo(-36, -5);
  ctx.lineTo(-29, -20);
  ctx.lineTo(-29, 50);
  ctx.quadraticCurveTo(0, 56, 29, 50);
  ctx.lineTo(29, -20);
  ctx.lineTo(36, -5);
  ctx.lineTo(52, -12);
  ctx.lineTo(42, -34);
  ctx.lineTo(22, -46);
  ctx.quadraticCurveTo(0, -34, -22, -46);
  ctx.closePath();
  const g = ctx.createLinearGradient(-40, -45, 40, 50);
  g.addColorStop(0, kitHex || "#10B981");
  g.addColorStop(1, "#0F172A");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = jerseyNum ? "900 36px Inter, Cairo, sans-serif" : "900 22px Inter, Cairo, sans-serif";
  ctx.fillText(jerseyNum && jerseyNum > 0 ? String(jerseyNum) : posCode, 0, 14);
  ctx.restore();
}

function triggerPngDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPlayerCardPng(
  card: PlayerCardSummary | PlayerCardPayload,
  lang: "ar" | "en",
  photoVersion?: number
): Promise<{ exported: boolean; photoIncluded: boolean }> {
  const isAr = lang === "ar";
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const W = 1080;
  const H = 1540;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");

  ctx.direction = isAr ? "rtl" : "ltr";

  ctx.save();
  drawFutShieldPath(ctx, W, H);
  ctx.clip();

  const [c0, c1, c2] = TIER_GRADIENTS[card.tier] || TIER_GRADIENTS.bronze;
  const grad = ctx.createLinearGradient(0, 0, W * 0.85, H);
  grad.addColorStop(0, c0);
  grad.addColorStop(0.45, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  for (let d = -H; d < W + H; d += 36) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + H, H);
    ctx.stroke();
  }
  ctx.fillStyle = card.kit_hex || "#10B981";
  ctx.fillRect(0, 0, W, 26);

  const isLightTier = card.tier === "gold" || card.tier === "silver";
  const ink = isLightTier ? "#0F172A" : "#FFFBEB";
  const subInk = isLightTier ? "rgba(15,23,42,0.82)" : "rgba(254,243,199,0.90)";
  const divider = isLightTier ? "rgba(15,23,42,0.24)" : "rgba(254,243,199,0.30)";

  let photoIncluded = false;
  const useJersey = Boolean(card.crop_is_low_res) && card.photo_source === "video";
  const basePhoto = card.photo_url.startsWith("http") ? card.photo_url : `${API_BASE}${card.photo_url}`;
  const photoSrc = `${basePhoto}${basePhoto.includes("?") ? "&" : "?"}cb=${photoVersion ?? Date.now()}`;

  if (useJersey) {
    drawVectorJerseyOnCanvas(
      ctx,
      isAr ? 340 : 680,
      390,
      4.3,
      card.kit_hex || "#10B981",
      card.jersey_number,
      card.position_label.code
    );
  }

  try {
    const img = await loadCorsImage(photoSrc);
    if (useJersey) {
      const bx = isAr ? 175 : 830;
      const by = 520;
      const br = 72;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, bx - br, by - br, br * 2, br * 2);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.stroke();
      photoIncluded = true;
    } else {
      const px = isAr ? 95 : 345;
      const py = 105;
      const pw = 640;
      const ph = 600;
      const scale = Math.max(pw / img.width, ph / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = px + (pw - dw) / 2;
      const pCanvas = document.createElement("canvas");
      pCanvas.width = pw;
      pCanvas.height = ph;
      const pCtx = pCanvas.getContext("2d");
      if (pCtx) {
        pCtx.drawImage(img, dx - px, 0, dw, dh);
        pCtx.globalCompositeOperation = "destination-in";
        const maskGrad = pCtx.createLinearGradient(0, 0, 0, ph);
        maskGrad.addColorStop(0, "rgba(0,0,0,1)");
        maskGrad.addColorStop(0.75, "rgba(0,0,0,1)");
        maskGrad.addColorStop(1, "rgba(0,0,0,0)");
        pCtx.fillStyle = maskGrad;
        pCtx.fillRect(0, 0, pw, ph);
        ctx.drawImage(pCanvas, px, py);
        photoIncluded = true;
      }
    }
  } catch {
    photoIncluded = false;
  }

  const colX = isAr ? W - 210 : 210;
  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  ctx.font = "900 112px Cairo, Inter, sans-serif";
  ctx.fillText(card.jersey_number !== null && card.jersey_number > 0 ? String(card.jersey_number) : "—", colX, 250);
  ctx.font = "800 38px Inter, Cairo, sans-serif";
  ctx.fillText(card.position_label.code, colX, 310);

  ctx.fillStyle = divider;
  ctx.fillRect(colX - 48, 334, 96, 3);

  ctx.beginPath();
  ctx.arc(colX, 410, 50, 0, Math.PI * 2);
  ctx.fillStyle = card.kit_hex || "#10B981";
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();

  const words = (card.team_name_en || card.team_name_ar || "FC").trim().split(/\s+/);
  const initials = words.length >= 2 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : words[0].slice(0, 2).toUpperCase();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "900 32px Inter, sans-serif";
  ctx.fillText(initials, colX, 422);

  ctx.fillStyle = subInk;
  ctx.font = "700 24px Cairo, Inter, sans-serif";
  ctx.fillText(isAr ? card.team_name_ar : card.team_name_en, colX, 500);

  const labelText = isAr ? card.display_label : card.display_label_en || card.display_label;
  ctx.fillStyle = divider;
  ctx.fillRect(105, 735, W - 210, 4);
  ctx.fillStyle = ink;
  ctx.font = "800 52px Cairo, Inter, sans-serif";
  ctx.fillText(labelText, W / 2, 805, W - 180);
  ctx.fillStyle = divider;
  ctx.fillRect(105, 842, W - 210, 4);

  // Obsidian attributes panel
  ctx.fillStyle = "rgba(2, 6, 23, 0.80)";
  ctx.beginPath();
  ctx.roundRect(105, 875, W - 210, 385, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const attrs = extractCardAttributes(card, isAr);
  const hasAnyPct = attrs.some((a) => a.pct !== null);
  const cellW = (W - 250) / 2;
  const cellH = 115;
  attrs.forEach((attr, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x0 = 135 + col * (cellW + 20);
    const y0 = 905 + row * cellH;

    if (hasAnyPct) {
      ctx.textAlign = "left";
      ctx.fillStyle = "#FCD34D";
      ctx.font = "900 52px Inter, Cairo, sans-serif";
      ctx.fillText(attr.pct !== null ? String(attr.pct) : "—", x0 + 18, y0 + 58);

      ctx.fillStyle = "#E2E8F0";
      ctx.font = "800 26px Inter, sans-serif";
      ctx.fillText(attr.code, x0 + 106, y0 + 56);

      ctx.textAlign = "right";
      ctx.fillStyle = "#CBD5E1";
      ctx.font = "700 22px Cairo, Inter, sans-serif";
      ctx.fillText(isAr ? attr.ar : attr.en, x0 + cellW - 14, y0 + 36);
      ctx.font = "700 21px Inter, Cairo, sans-serif";
      ctx.fillText(attr.rawText, x0 + cellW - 14, y0 + 70);
    } else {
      ctx.textAlign = "left";
      ctx.fillStyle = "#FCD34D";
      ctx.font = "900 26px Inter, sans-serif";
      ctx.fillText(attr.code, x0 + 16, y0 + 40);

      ctx.fillStyle = "#CBD5E1";
      ctx.font = "700 21px Cairo, Inter, sans-serif";
      ctx.fillText(isAr ? attr.ar : attr.en, x0 + 16, y0 + 72);

      ctx.textAlign = "right";
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "900 32px Inter, Cairo, sans-serif";
      ctx.fillText(attr.rawText, x0 + cellW - 14, y0 + 62);
    }
  });

  // Safe unclipped Footer inside lower wider shield
  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  ctx.font = "700 22px Cairo, Inter, sans-serif";
  const calPct = Math.round((card.quality?.calibrated_ratio ?? 0) * 100);
  const line1 = hasAnyPct
    ? isAr
      ? "ترتيب اللاعب داخل المباراة (0–99)"
      : "In-match percentile (0–99)"
    : isAr
    ? "قياسات فيديو حقيقية مقاسة"
    : "Measured video telemetry";
  const line2 = isAr
    ? `${card.observed_s.toFixed(1)} ث • معايرة ${calPct}% • EGY-SCOUT`
    : `${card.observed_s.toFixed(1)}s • ${calPct}% cal. • EGY-SCOUT`;
  ctx.fillText(line1, W / 2, 1300, W - 360);
  ctx.fillText(line2, W / 2, 1340, W - 380);
  ctx.restore();

  ctx.save();
  drawFutShieldPath(ctx, W, H);
  ctx.lineWidth = 10;
  ctx.strokeStyle = isLightTier ? "rgba(255,255,255,0.82)" : "rgba(253,186,116,0.82)";
  ctx.stroke();
  ctx.restore();

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode PNG");

  const rawName = (labelText || `T${card.base_track_id}`).replace(/[^\w\u0600-\u06FF-]+/g, "_");
  triggerPngDownload(blob, `egy-scout-${rawName}-${card.track_id}.png`);
  return { exported: true, photoIncluded };
}

/** Export a compact 420x588 transparent-background Mini FUT Card PNG ready for pitch/video overlays. */
export async function exportMiniPlayerCardPng(
  card: PlayerCardSummary | PlayerCardPayload,
  lang: "ar" | "en",
  photoVersion?: number
): Promise<{ exported: boolean; photoIncluded: boolean }> {
  const isAr = lang === "ar";
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const W = 420;
  const H = 588;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");

  ctx.save();
  drawFutShieldPath(ctx, W, H);
  ctx.clip();

  const [c0, c1, c2] = TIER_GRADIENTS[card.tier] || TIER_GRADIENTS.bronze;
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, c0);
  grad.addColorStop(0.5, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = card.kit_hex || "#10B981";
  ctx.fillRect(0, 0, W, 14);

  const isLight = card.tier === "gold" || card.tier === "silver";
  const ink = isLight ? "#0F172A" : "#FFFBEB";

  // Top jersey number + position badge
  ctx.fillStyle = ink;
  ctx.font = "900 44px Inter, Cairo, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(card.jersey_number && card.jersey_number > 0 ? String(card.jersey_number) : "—", 46, 86);

  ctx.fillStyle = "rgba(2,6,23,0.85)";
  ctx.beginPath();
  ctx.roundRect(W - 118, 46, 74, 36, 10);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 20px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(card.position_label.code, W - 81, 71);

  let photoIncluded = false;
  const useJersey = Boolean(card.crop_is_low_res) && card.photo_source === "video";
  if (useJersey) {
    drawVectorJerseyOnCanvas(ctx, W / 2, 240, 2.2, card.kit_hex || "#10B981", card.jersey_number, card.position_label.code);
  } else {
    try {
      const basePhoto = card.photo_url.startsWith("http") ? card.photo_url : `${API_BASE}${card.photo_url}`;
      const img = await loadCorsImage(`${basePhoto}${basePhoto.includes("?") ? "&" : "?"}cb=${photoVersion ?? Date.now()}`);
      ctx.save();
      ctx.beginPath();
      ctx.arc(W / 2, 235, 112, 0, Math.PI * 2);
      ctx.clip();
      const s = Math.max(224 / img.width, 224 / img.height);
      ctx.drawImage(img, W / 2 - (img.width * s) / 2, 123, img.width * s, img.height * s);
      ctx.restore();
      photoIncluded = true;
    } catch {
      drawVectorJerseyOnCanvas(ctx, W / 2, 240, 2.2, card.kit_hex || "#10B981", card.jersey_number, card.position_label.code);
    }
  }

  const labelText = isAr ? card.display_label : card.display_label_en || card.display_label;
  ctx.fillStyle = ink;
  ctx.font = "900 32px Cairo, Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(labelText, W / 2, 412, W - 80);

  // Dark speed/distance stamp
  ctx.fillStyle = "rgba(2,6,23,0.88)";
  ctx.beginPath();
  ctx.roundRect(70, 442, W - 140, 56, 16);
  ctx.fill();
  ctx.fillStyle = "#34D399";
  ctx.font = "800 22px Inter, sans-serif";
  const spd = card.top_speed_kmh !== null ? `${card.top_speed_kmh.toFixed(0)} km/h` : "—";
  const dst = card.distance_m !== null ? `${Math.round(card.distance_m)}m` : "—";
  ctx.fillText(`${spd}  •  ${dst}`, W / 2, 478);

  ctx.restore();
  ctx.save();
  drawFutShieldPath(ctx, W, H);
  ctx.lineWidth = 6;
  ctx.strokeStyle = isLight ? "rgba(255,255,255,0.85)" : "rgba(253,186,116,0.85)";
  ctx.stroke();
  ctx.restore();

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode mini PNG");
  const rawName = (labelText || `T${card.base_track_id}`).replace(/[^\w\u0600-\u06FF-]+/g, "_");
  triggerPngDownload(blob, `egy-scout-mini-${rawName}-${card.track_id}.png`);
  return { exported: true, photoIncluded };
}
