import { API_BASE, PlayerCardPayload, PlayerCardSummary } from "@/lib/api";
import { extractCardAttributes } from "@/components/PlayerCard";

const TIER_GRADIENTS = {
  gold: ["#FBF0AD", "#ECCB5E", "#9F6F19"],
  silver: ["#FFFFFF", "#CBD5E1", "#64748B"],
  bronze: ["#F3C499", "#D28B50", "#6E3F18"],
} as const;

function drawFc25ShieldPath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(w * 0.11, h * 0.069);
  ctx.lineTo(w * 0.18, h * 0.069);
  ctx.quadraticCurveTo(w * 0.32, h * 0.069, w * 0.42, h * 0.035);
  ctx.quadraticCurveTo(w * 0.5, h * 0.007, w * 0.58, h * 0.035);
  ctx.quadraticCurveTo(w * 0.68, h * 0.069, w * 0.82, h * 0.069);
  ctx.lineTo(w * 0.89, h * 0.069);
  ctx.quadraticCurveTo(w * 0.97, h * 0.069, w * 0.97, h * 0.153);
  ctx.lineTo(w * 0.97, h * 0.847);
  ctx.quadraticCurveTo(w * 0.97, h * 0.917, w * 0.5, h * 0.986);
  ctx.quadraticCurveTo(w * 0.03, h * 0.917, w * 0.03, h * 0.847);
  ctx.lineTo(w * 0.03, h * 0.153);
  ctx.quadraticCurveTo(w * 0.03, h * 0.069, w * 0.11, h * 0.069);
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

function drawFlagOnCanvas(ctx: CanvasRenderingContext2D, cx: number, cy: number, code: string) {
  const fw = 64;
  const fh = 42;
  const x = cx - fw / 2;
  const y = cy - fh / 2;
  const cc = (code || "EG").toUpperCase();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, fw, fh, 5);
  ctx.clip();
  if (cc === "MA") {
    ctx.fillStyle = "#C1272D";
    ctx.fillRect(x, y, fw, fh);
  } else if (cc === "DE") {
    ctx.fillStyle = "#111827";
    ctx.fillRect(x, y, fw, fh / 3);
    ctx.fillStyle = "#DC2626";
    ctx.fillRect(x, y + fh / 3, fw, fh / 3);
    ctx.fillStyle = "#FACC15";
    ctx.fillRect(x, y + (2 * fh) / 3, fw, fh / 3);
  } else {
    ctx.fillStyle = "#CE1126";
    ctx.fillRect(x, y, fw, fh / 3);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(x, y + fh / 3, fw, fh / 3);
    ctx.fillStyle = "#111827";
    ctx.fillRect(x, y + (2 * fh) / 3, fw, fh / 3);
    ctx.fillStyle = "#C09300";
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
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
  const H = 1560;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");

  ctx.direction = "ltr";
  ctx.save();
  drawFc25ShieldPath(ctx, W, H);
  ctx.clip();

  const [c0, c1, c2] = TIER_GRADIENTS[card.tier] || TIER_GRADIENTS.bronze;
  const grad = ctx.createLinearGradient(0, 0, W * 0.85, H);
  grad.addColorStop(0, c0);
  grad.addColorStop(0.45, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Diagonal EA FC 25 foil facets
  ctx.fillStyle = "rgba(255, 250, 215, 0.28)";
  ctx.beginPath();
  ctx.moveTo(W * 0.36, H * 0.25);
  ctx.lineTo(W * 0.97, H * 0.07);
  ctx.lineTo(W * 0.97, H * 0.22);
  ctx.lineTo(W * 0.45, H * 0.40);
  ctx.closePath();
  ctx.fill();

  const ink = card.tier === "silver" ? "#0F172A" : "#2A1805";
  const subInk = card.tier === "silver" ? "rgba(15,23,42,0.82)" : "rgba(58,34,6,0.86)";
  const divider = card.tier === "silver" ? "rgba(15,23,42,0.25)" : "rgba(58,34,6,0.25)";

  let photoIncluded = false;
  const basePhoto = card.photo_url.startsWith("http") ? card.photo_url : `${API_BASE}${card.photo_url}`;
  const photoSrc = `${basePhoto}${basePhoto.includes("?") ? "&" : "?"}cb=${photoVersion ?? Date.now()}`;

  try {
    const img = await loadCorsImage(photoSrc);
    const px = 280;
    const py = 125;
    const pw = 690;
    const ph = 755;
    const scale = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (pw - dw) / 2;
    const pCanvas = document.createElement("canvas");
    pCanvas.width = pw;
    pCanvas.height = ph;
    const pCtx = pCanvas.getContext("2d");
    if (pCtx) {
      pCtx.drawImage(img, dx, 0, dw, dh);
      pCtx.globalCompositeOperation = "destination-in";
      const maskGrad = pCtx.createLinearGradient(0, 0, 0, ph);
      maskGrad.addColorStop(0, "rgba(0,0,0,1)");
      maskGrad.addColorStop(0.78, "rgba(0,0,0,1)");
      maskGrad.addColorStop(1, "rgba(0,0,0,0)");
      pCtx.fillStyle = maskGrad;
      pCtx.fillRect(0, 0, pw, ph);
      ctx.drawImage(pCanvas, px, py);
      photoIncluded = true;
    }
  } catch {
    photoIncluded = false;
  }

  // Left rating / number & position stack
  const topVal =
    card.jersey_number !== null && card.jersey_number > 0
      ? String(card.jersey_number)
      : card.top_speed_kmh !== null
      ? String(Math.round(card.top_speed_kmh))
      : String(Math.round((card.quality?.calibrated_ratio ?? 0) * 100));
  const colX = 185;
  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  ctx.font = "900 132px Inter, Cairo, sans-serif";
  ctx.fillText(topVal, colX, 290);
  ctx.font = "900 44px Inter, Cairo, sans-serif";
  ctx.fillText(card.position_label.code, colX, 355);

  ctx.fillStyle = divider;
  ctx.fillRect(colX - 42, 385, 84, 3);

  const words = (card.team_name_en || card.team_name_ar || "FC").trim().split(/\s+/);
  const initials = words.length >= 2 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : words[0].slice(0, 2).toUpperCase();
  ctx.beginPath();
  ctx.arc(colX, 455, 40, 0, Math.PI * 2);
  ctx.fillStyle = card.kit_hex || "#10B981";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "900 26px Inter, sans-serif";
  ctx.fillText(initials, colX, 464);

  // Nameplate Divider & Player Name directly on foil
  const labelText = isAr ? card.display_label : card.display_label_en || card.display_label;
  ctx.fillStyle = divider;
  ctx.fillRect(110, 912, W - 220, 3);
  ctx.fillStyle = ink;
  ctx.font = "900 58px Cairo, Inter, sans-serif";
  ctx.fillText(labelText, W / 2, 986, W - 180);

  // 6-Column Horizontal Stat Strip directly on metallic foil (zero black box)
  const attrs = extractCardAttributes(card, isAr);
  const hasAnyPct = attrs.some((a) => a.pct !== null);
  const stripLeft = 95;
  const stripW = W - 190;
  const colW = stripW / 6;
  attrs.forEach((attr, idx) => {
    const cx = stripLeft + colW * (idx + 0.5);
    const numVal = hasAnyPct && attr.pct !== null ? String(attr.pct) : attr.shortNum;
    ctx.fillStyle = subInk;
    ctx.font = "800 28px Inter, sans-serif";
    ctx.fillText(attr.code, cx, 1080);

    ctx.fillStyle = ink;
    ctx.font = "900 48px Inter, Cairo, sans-serif";
    ctx.fillText(numVal, cx, 1142);
  });

  // Bottom Trio: Country Flag (when verified) + League + Club Shield
  if (card.nationality_code) {
    drawFlagOnCanvas(ctx, W / 2 - 110, 1290, card.nationality_code);
  }
  ctx.fillStyle = ink;
  ctx.font = "900 26px Inter, sans-serif";
  ctx.fillText(card.club_id === "bayer_leverkusen_alonso" ? "BL" : "EPL", W / 2, 1299);

  ctx.beginPath();
  ctx.arc(W / 2 + 110, 1290, 26, 0, Math.PI * 2);
  ctx.fillStyle = card.kit_hex || "#10B981";
  ctx.fill();
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "900 18px Inter, sans-serif";
  ctx.fillText(initials, W / 2 + 110, 1296);

  ctx.restore();

  ctx.save();
  drawFc25ShieldPath(ctx, W, H);
  ctx.lineWidth = 10;
  ctx.strokeStyle = card.tier === "silver" ? "#FFFFFF" : "#FFF5BE";
  ctx.stroke();
  ctx.restore();

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode PNG");

  const rawName = (labelText || `T${card.base_track_id}`).replace(/[^\w\u0600-\u06FF-]+/g, "_");
  triggerPngDownload(blob, `egy-scout-${rawName}-${card.track_id}.png`);
  return { exported: true, photoIncluded };
}

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
  const H = 604;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");

  ctx.save();
  drawFc25ShieldPath(ctx, W, H);
  ctx.clip();

  const [c0, c1, c2] = TIER_GRADIENTS[card.tier] || TIER_GRADIENTS.bronze;
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, c0);
  grad.addColorStop(0.5, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const ink = card.tier === "silver" ? "#0F172A" : "#2A1805";
  ctx.fillStyle = ink;
  ctx.font = "900 44px Inter, Cairo, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(card.jersey_number && card.jersey_number > 0 ? String(card.jersey_number) : "—", 46, 98);
  ctx.font = "900 22px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(card.position_label.code, W - 46, 94);

  let photoIncluded = false;
  try {
    const basePhoto = card.photo_url.startsWith("http") ? card.photo_url : `${API_BASE}${card.photo_url}`;
    const img = await loadCorsImage(`${basePhoto}${basePhoto.includes("?") ? "&" : "?"}cb=${photoVersion ?? Date.now()}`);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, 245, 118, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.max(236 / img.width, 236 / img.height);
    ctx.drawImage(img, W / 2 - (img.width * s) / 2, 127, img.width * s, img.height * s);
    ctx.restore();
    photoIncluded = true;
  } catch {
    photoIncluded = false;
  }

  const labelText = isAr ? card.display_label : card.display_label_en || card.display_label;
  ctx.fillStyle = ink;
  ctx.font = "900 32px Cairo, Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(labelText, W / 2, 430, W - 70);

  ctx.font = "800 22px Inter, sans-serif";
  const spd = card.top_speed_kmh !== null ? `${card.top_speed_kmh.toFixed(0)} km/h` : "—";
  const dst = card.distance_m !== null ? `${Math.round(card.distance_m)}m` : "—";
  ctx.fillText(`${spd}  •  ${dst}`, W / 2, 486);
  if (card.nationality_code) {
    drawFlagOnCanvas(ctx, W / 2, 540, card.nationality_code);
  }

  ctx.restore();
  ctx.save();
  drawFc25ShieldPath(ctx, W, H);
  ctx.lineWidth = 6;
  ctx.strokeStyle = card.tier === "silver" ? "#FFFFFF" : "#FFF5BE";
  ctx.stroke();
  ctx.restore();

  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode mini PNG");
  const rawName = (labelText || `T${card.base_track_id}`).replace(/[^\w\u0600-\u06FF-]+/g, "_");
  triggerPngDownload(blob, `egy-scout-mini-${rawName}-${card.track_id}.png`);
  return { exported: true, photoIncluded };
}
