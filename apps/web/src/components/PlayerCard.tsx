"use client";

import React, { useId } from "react";
import { API_BASE, PlayerCardPayload, PlayerCardSummary } from "@/lib/api";

interface Props {
  card: PlayerCardSummary | PlayerCardPayload;
  lang: "ar" | "en";
  compact?: boolean;
  size?: "full" | "compact" | "mini";
  forcePortraitMode?: "auto" | "photo" | "jersey";
  photoVersion?: number;
  compareTo?: PlayerCardSummary | PlayerCardPayload | null;
  onClick?: () => void;
}

const TIER_STYLES = {
  gold: {
    bg: "linear-gradient(155deg, #F6DE8A 0%, #DFB54C 44%, #A8761E 100%)",
    border: "#FEF08A",
    ink: "text-slate-950",
    subInk: "text-slate-900/85",
    divider: "bg-slate-950/25",
    badgeAr: "ذهبي",
    badgeEn: "Gold",
  },
  silver: {
    bg: "linear-gradient(155deg, #F8FAFC 0%, #CBD5E1 48%, #7B8797 100%)",
    border: "#FFFFFF",
    ink: "text-slate-950",
    subInk: "text-slate-900/85",
    divider: "bg-slate-950/25",
    badgeAr: "فضي",
    badgeEn: "Silver",
  },
  bronze: {
    bg: "linear-gradient(155deg, #E7AD77 0%, #B8763C 48%, #78481D 100%)",
    border: "#FDBA74",
    ink: "text-[#FFFBEB]",
    subInk: "text-amber-100/90",
    divider: "bg-amber-100/30",
    badgeAr: "برونزي",
    badgeEn: "Bronze",
  },
} as const;

function getTeamInitials(name: string): string {
  const words = (name || "FC").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }
  return (words[0] || "FC").slice(0, 2).toUpperCase();
}

export interface CardAttributeRow {
  key: keyof PlayerCardSummary["percentiles"];
  code: string;
  ar: string;
  en: string;
  pct: number | null;
  rawVal: number | null;
  rawText: string;
}

export function extractCardAttributes(card: PlayerCardSummary, isAr: boolean): CardAttributeRow[] {
  return [
    {
      key: "spd",
      code: "SPD",
      ar: "سرعة",
      en: "Top Speed",
      pct: card.percentiles?.spd ?? null,
      rawVal: card.top_speed_kmh,
      rawText: card.top_speed_kmh !== null ? `${card.top_speed_kmh.toFixed(1)} km/h` : "—",
    },
    {
      key: "dst",
      code: "DST",
      ar: "مسافة",
      en: "Distance",
      pct: card.percentiles?.dst ?? null,
      rawVal: card.distance_m,
      rawText: card.distance_m !== null ? `${Math.round(card.distance_m)} m` : "—",
    },
    {
      key: "wrk",
      code: "WRK",
      ar: "جهد",
      en: "Work Rate",
      pct: card.percentiles?.wrk ?? null,
      rawVal: card.work_rate_m_per_min,
      rawText:
        card.work_rate_m_per_min !== null
          ? `${Math.round(card.work_rate_m_per_min)} m/m`
          : card.distance_m !== null
          ? isAr
            ? "عينة <5د"
            : "<5m clip"
          : "—",
    },
    {
      key: "spr",
      code: "SPR",
      ar: "انطلاقات",
      en: "Sprints",
      pct: card.percentiles?.spr ?? null,
      rawVal: card.sprints,
      rawText: card.sprints !== null ? `${card.sprints}` : "—",
    },
    {
      key: "avg",
      code: "AVG",
      ar: "متوسط",
      en: "Avg Speed",
      pct: card.percentiles?.avg ?? null,
      rawVal: card.avg_speed_kmh,
      rawText: card.avg_speed_kmh !== null ? `${card.avg_speed_kmh.toFixed(1)} km/h` : "—",
    },
    {
      key: "min",
      code: "MIN",
      ar: "دقائق",
      en: "Observed",
      pct: card.percentiles?.min ?? null,
      rawVal: card.observed_s,
      rawText:
        card.observed_s >= 60
          ? `${card.observed_min.toFixed(1)} ${isAr ? "د" : "m"}`
          : `${card.observed_s.toFixed(1)} ${isAr ? "ث" : "s"}`,
    },
  ];
}

// Wider-lower FUT shield in normalized 0..100 x 0..142 viewBox so bottom metadata never clips
const SHIELD_SVG_PATH =
  "M 14 6 Q 50 1 86 6 Q 97 9 97 20 L 97 118 Q 97 133 50 140.5 Q 3 133 3 118 L 3 20 Q 3 9 14 6 Z";
const SHIELD_CLIP_PATH =
  "M 0.14 0.042 Q 0.50 0.007 0.86 0.042 Q 0.97 0.063 0.97 0.141 L 0.97 0.831 Q 0.97 0.937 0.50 0.989 Q 0.03 0.937 0.03 0.831 L 0.03 0.141 Q 0.03 0.063 0.14 0.042 Z";

function KitJerseyGraphic({
  kitHex,
  jerseyNumber,
  posCode,
  mini = false,
}: {
  kitHex: string;
  jerseyNumber: number | null;
  posCode: string;
  mini?: boolean;
}) {
  return (
    <div className="relative flex items-center justify-center w-full h-full">
      <svg
        viewBox="0 0 120 124"
        className={`${mini ? "w-11 h-11" : "w-28 h-28"} drop-shadow-[0_8px_18px_rgba(0,0,0,0.45)]`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`kit-${kitHex.replace("#", "")}-${posCode}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={kitHex} />
            <stop offset="100%" stopColor="#0F172A" stopOpacity="0.88" />
          </linearGradient>
        </defs>
        <path
          d="M 38 14 L 18 26 L 8 48 L 24 55 L 31 40 L 31 110 Q 60 116 89 110 L 89 40 L 96 55 L 112 48 L 102 26 L 82 14 Q 60 26 38 14 Z"
          fill={`url(#kit-${kitHex.replace("#", "")}-${posCode})`}
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        <path
          d="M 43 16 Q 60 28 77 16"
          fill="none"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <text
          x="60"
          y="74"
          textAnchor="middle"
          fill="#FFFFFF"
          fontWeight="900"
          fontSize={jerseyNumber ? "36" : "24"}
          fontFamily="Inter, Cairo, sans-serif"
        >
          {jerseyNumber && jerseyNumber > 0 ? jerseyNumber : posCode}
        </text>
      </svg>
    </div>
  );
}

function PlayerCardInner({
  card,
  lang,
  compact = false,
  size,
  forcePortraitMode = "auto",
  photoVersion,
  compareTo = null,
  onClick,
}: Props) {
  const isAr = lang === "ar";
  const resolvedSize: "full" | "compact" | "mini" = size ?? (compact ? "compact" : "full");
  const isCompact = resolvedSize === "compact";
  const isMini = resolvedSize === "mini";

  const uid = useId().replace(/:/g, "");
  const clipId = `fut-shield-${uid}`;
  const tier = TIER_STYLES[card.tier] || TIER_STYLES.bronze;
  const teamLabel = isAr ? card.team_name_ar : card.team_name_en;
  const displayName = isAr ? card.display_label : card.display_label_en || card.display_label;
  const initials = getTeamInitials(card.team_name_en || card.team_name_ar);
  const attrs = extractCardAttributes(card, isAr);
  const visibleAttrs = isCompact ? attrs.slice(0, 3) : attrs;
  const compareAttrs = compareTo ? extractCardAttributes(compareTo, isAr) : null;

  const basePhoto = card.photo_url.startsWith("http") ? card.photo_url : `${API_BASE}${card.photo_url}`;
  const photoSrc = photoVersion !== undefined ? `${basePhoto}&cb=${photoVersion}` : basePhoto;
  const calPct = Math.round((card.quality?.calibrated_ratio ?? 0) * 100);
  const heatmap = "heatmap" in card ? card.heatmap : null;
  const hasAnyPct = attrs.some((a) => a.pct !== null);

  const shouldUseJerseyHero =
    forcePortraitMode === "jersey" ||
    (forcePortraitMode === "auto" && Boolean(card.crop_is_low_res) && card.photo_source === "video");

  const WrapperTag = onClick ? "button" : "div";

  if (isMini) {
    const spdText = card.top_speed_kmh !== null ? `${card.top_speed_kmh.toFixed(0)}` : "—";
    const dstText = card.distance_m !== null ? `${Math.round(card.distance_m)}m` : "—";
    return (
      <WrapperTag
        type={onClick ? "button" : undefined}
        onClick={onClick}
        aria-label={`${displayName} — ${card.position_label.code}`}
        className={`relative block w-[96px] aspect-[0.72] text-start select-none ${
          onClick ? "cursor-pointer hover:scale-105 transition-transform" : ""
        }`}
      >
        <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              <path d={SHIELD_CLIP_PATH} />
            </clipPath>
          </defs>
        </svg>
        <div
          className={`relative w-full h-full overflow-hidden shadow-lg shadow-black/75 ${tier.ink}`}
          style={{ clipPath: `url(#${clipId})`, background: tier.bg }}
        >
          <div className="absolute top-0 inset-x-0 h-1.5" style={{ backgroundColor: card.kit_hex }} />
          <svg
            viewBox="0 0 100 142"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
            aria-hidden="true"
          >
            <path d={SHIELD_SVG_PATH} fill="none" stroke={tier.border} strokeOpacity="0.8" strokeWidth="2.2" />
          </svg>
          <div className="relative z-10 h-full flex flex-col items-center justify-between px-2 pt-2 pb-2.5">
            <div className="w-full flex items-center justify-between px-0.5 leading-none">
              <span dir="ltr" className="text-xs font-black tabular-nums">
                {card.jersey_number && card.jersey_number > 0 ? card.jersey_number : "—"}
              </span>
              <span className="text-[8.5px] font-black uppercase px-1 rounded bg-slate-950/75 text-white">
                {card.position_label.code}
              </span>
            </div>
            <div className="w-11 h-11 flex items-center justify-center overflow-hidden rounded-lg">
              {shouldUseJerseyHero ? (
                <KitJerseyGraphic kitHex={card.kit_hex} jerseyNumber={card.jersey_number} posCode={card.position_label.code} mini />
              ) : (
                <img
                  src={photoSrc}
                  alt={displayName}
                  crossOrigin="anonymous"
                  className="w-full h-full object-cover object-top"
                />
              )}
            </div>
            <div className="w-full text-center">
              <div className="text-[9px] font-black truncate leading-tight px-1">{displayName}</div>
              <div
                dir="ltr"
                className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950/85 text-emerald-300 text-[7.5px] font-bold tabular-nums"
              >
                <span>{spdText}km/h</span>
                <span>•</span>
                <span>{dstText}</span>
              </div>
            </div>
          </div>
        </div>
      </WrapperTag>
    );
  }

  return (
    <WrapperTag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={onClick ? `${displayName} — ${card.position_label.code}` : undefined}
      title={
        isAr
          ? `لون الكارت (${tier.badgeAr}) = درجة الثقة في البيانات`
          : `Card tier (${tier.badgeEn}) reflects data confidence`
      }
      className={`group relative block w-full text-start select-none ${
        isCompact ? "max-w-[235px]" : "max-w-[340px]"
      } mx-auto aspect-[0.70] transition-transform duration-200 ${
        onClick ? "cursor-pointer motion-safe:hover:-translate-y-1.5 focus-visible:outline-2 focus-visible:outline-emerald-400" : ""
      }`}
    >
      <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path d={SHIELD_CLIP_PATH} />
          </clipPath>
        </defs>
      </svg>

      <div
        className={`relative w-full h-full overflow-hidden shadow-2xl shadow-black/75 ${tier.ink}`}
        style={{
          clipPath: `url(#${clipId})`,
          background: tier.bg,
        }}
      >
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.22) 0px, rgba(255,255,255,0.22) 1px, transparent 1px, transparent 14px)",
          }}
        />
        <div className="absolute top-0 inset-x-0 h-2.5 opacity-95" style={{ backgroundColor: card.kit_hex }} />
        <div className="pointer-events-none absolute -inset-x-24 -inset-y-10 rotate-12 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <svg
          viewBox="0 0 100 142"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
        >
          <path d={SHIELD_SVG_PATH} fill="none" stroke={tier.border} strokeOpacity="0.72" strokeWidth="1.8" />
        </svg>

        <div className={`relative z-10 h-full flex flex-col ${isCompact ? "px-3.5 pt-3.5 pb-5" : "px-5 pt-3.5 pb-9"}`}>
          {/* Top Stage */}
          <div className={`relative flex items-stretch justify-between ${isCompact ? "h-[44%]" : "h-[38%]"}`}>
            <div className="z-10 flex flex-col items-center justify-start w-[31%] pt-1">
              <div
                dir="ltr"
                className={`font-black leading-none tracking-tight tabular-nums ${
                  isCompact ? "text-2xl" : "text-4xl"
                }`}
              >
                {card.jersey_number !== null && card.jersey_number > 0 ? card.jersey_number : "—"}
              </div>
              <div className={`font-extrabold tracking-wider uppercase mt-0.5 ${isCompact ? "text-[10px]" : "text-xs"}`}>
                {card.position_label.code}
              </div>
              <div className={`w-6 h-[1.5px] my-1 ${tier.divider}`} />
              <div
                className={`${
                  isCompact ? "w-6 h-6 text-[9px]" : "w-8 h-8 text-[11px]"
                } rounded-full border-2 border-white/80 flex items-center justify-center font-black text-white shadow-md`}
                style={{ backgroundColor: card.kit_hex }}
                title={teamLabel}
              >
                {initials}
              </div>
              {!isCompact && (
                <div className={`mt-1 text-[9.5px] font-bold text-center leading-tight line-clamp-1 ${tier.subInk}`}>
                  {teamLabel}
                </div>
              )}
            </div>

            <div className="relative w-[69%] h-full flex items-center justify-center overflow-hidden rounded-xl">
              {shouldUseJerseyHero ? (
                <>
                  <KitJerseyGraphic
                    kitHex={card.kit_hex}
                    jerseyNumber={card.jersey_number}
                    posCode={card.position_label.code}
                  />
                  <img
                    src={photoSrc}
                    alt=""
                    crossOrigin="anonymous"
                    loading="lazy"
                    className={`absolute bottom-1 ${
                      isCompact ? "w-8 h-8" : "w-11 h-11"
                    } end-1 rounded-full object-cover object-top border-2 border-white/80 shadow-lg bg-slate-900`}
                  />
                </>
              ) : (
                <img
                  src={photoSrc}
                  alt={displayName}
                  crossOrigin="anonymous"
                  loading="lazy"
                  className="w-full h-full object-cover object-top drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
                  style={{
                    maskImage: "linear-gradient(to bottom, black 74%, transparent 100%)",
                    WebkitMaskImage: "linear-gradient(to bottom, black 74%, transparent 100%)",
                  }}
                />
              )}
            </div>
          </div>

          {/* Name Strip */}
          <div className={`text-center ${isCompact ? "mt-1" : "mt-1.5"}`}>
            <div className={`h-[1.5px] w-full mb-1 ${tier.divider}`} />
            <div className={`font-extrabold truncate leading-tight ${isCompact ? "text-xs" : "text-base tracking-wide"}`}>
              {displayName}
            </div>
            <div className="mt-0.5 flex items-center justify-center gap-1">
              {card.identity_source === "ocr_verified" ? (
                <span className="px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 text-[8.5px] font-bold">
                  {isAr ? "رقم مقروء آلياً (OCR)" : "OCR Verified"}
                </span>
              ) : card.verified || card.identity_source === "qa_verified" ? (
                <span className="px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-300 text-[8.5px] font-bold">
                  {isAr ? "هوية موثقة" : "Verified"}
                </span>
              ) : card.identity_source === "gk_role_match" ? (
                <span className="px-1.5 py-0.2 rounded bg-slate-950/75 text-sky-300 text-[8.5px] font-bold">
                  {isAr ? "حارس المرمى الأساسي" : "Squad GK"}
                </span>
              ) : (
                <span className="px-1.5 py-0.2 rounded bg-black/35 text-amber-100 text-[8.5px] font-bold">
                  {isAr ? "تتبع ميداني (وثّق الاسم)" : "Tracked (Verify ID)"}
                </span>
              )}
            </div>
            <div className={`h-[1.5px] w-full mt-1 ${tier.divider}`} />
          </div>

          {/* Dark Obsidian Measured Attributes Grid (ultra-high contrast on any metal tier) */}
          <div
            className={`grid ${
              isCompact ? "grid-cols-3 gap-1 mt-1.5 p-1.5" : "grid-cols-2 gap-x-2.5 gap-y-1 mt-1.5 p-2"
            } rounded-xl border border-white/15 bg-slate-950/75 text-white shadow-inner`}
          >
            {visibleAttrs.map((attr, idx) => {
              const otherVal = compareAttrs?.[idx]?.rawVal ?? null;
              const isHigher =
                compareTo !== null &&
                attr.rawVal !== null &&
                otherVal !== null &&
                attr.rawVal > otherVal;

              return (
                <div
                  key={attr.key}
                  title={
                    attr.rawVal === null
                      ? isAr
                        ? "تعذر القياس لغياب معايرة الملعب أو قصر المقطع"
                        : "Uncalibrated metric or <30s clip"
                      : `${isAr ? attr.ar : attr.en}: ${attr.rawText}`
                  }
                  className={`flex items-center justify-between gap-1 ${
                    isCompact ? "flex-col text-center py-0.5" : "px-1.5 py-0.5"
                  }`}
                >
                  {hasAnyPct ? (
                    <>
                      <div className="flex items-baseline gap-1 min-w-0">
                        <span
                          dir="ltr"
                          className={`font-black tabular-nums leading-none text-amber-300 ${
                            isCompact ? "text-sm" : "text-lg"
                          }`}
                        >
                          {attr.pct !== null ? attr.pct : "—"}
                        </span>
                        <span className={`font-extrabold tracking-wider text-slate-200 ${isCompact ? "text-[8.5px]" : "text-[10px]"}`}>
                          {attr.code}
                        </span>
                        {isHigher && (
                          <span className="text-emerald-400 font-black text-[10px]" aria-label="higher">
                            ▲
                          </span>
                        )}
                      </div>
                      <div className={`tabular-nums truncate text-slate-300 ${isCompact ? "text-[8.5px]" : "text-[10px] text-end"}`}>
                        <span dir="ltr">{attr.rawText}</span>
                      </div>
                    </>
                  ) : isCompact ? (
                    <>
                      <span className="font-extrabold tracking-wider text-amber-300 text-[9px] leading-none">
                        {attr.code}
                      </span>
                      <div className="tabular-nums truncate text-white font-black text-[10.5px] flex items-center gap-0.5">
                        <span dir="ltr">{attr.rawText}</span>
                        {isHigher && (
                          <span className="text-emerald-400 font-black text-[9px]" aria-label="higher">
                            ▲
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-1 min-w-0">
                        <span className="font-extrabold tracking-wider text-amber-300 text-[10px] shrink-0">
                          {attr.code}
                        </span>
                        <span className="text-[9px] text-slate-300 truncate">{isAr ? attr.ar : attr.en}</span>
                      </div>
                      <div className="tabular-nums truncate text-white font-black text-[11px] flex items-center gap-0.5 shrink-0">
                        <span dir="ltr">{attr.rawText}</span>
                        {isHigher && (
                          <span className="text-emerald-400 font-black text-[10px]" aria-label="higher">
                            ▲
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Full Card Footer: Wide centered inset prevents bottom shield clipping completely */}
          {!isCompact && (
            <div className="mt-auto pt-1.5 flex items-center justify-center gap-2.5 px-6">
              {heatmap ? (
                <svg
                  viewBox="0 0 120 80"
                  className="w-12 h-8 rounded border border-white/30 bg-emerald-950/85 shrink-0"
                  aria-label={isAr ? "خريطة التمركز الحرارية" : "Player positional heatmap"}
                >
                  <rect x="1" y="1" width="118" height="78" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1" />
                  <line x1="60" y1="1" x2="60" y2="79" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
                  {heatmap.map((row, rIdx) =>
                    row.map((val, cIdx) =>
                      val > 0.005 ? (
                        <rect
                          key={`${rIdx}-${cIdx}`}
                          x={cIdx * 10}
                          y={rIdx * 10}
                          width={10}
                          height={10}
                          fill="#10B981"
                          fillOpacity={Math.min(0.95, 0.2 + val * 5.0)}
                        />
                      ) : null
                    )
                  )}
                </svg>
              ) : (
                <div className="w-12 h-8 rounded border border-white/20 bg-slate-950/60 text-slate-200 flex items-center justify-center text-[8px] shrink-0">
                  {isAr ? "بلا معايرة" : "Uncal."}
                </div>
              )}

              <div className={`text-[8.5px] leading-snug text-start ${tier.subInk} min-w-0`}>
                <div className="font-bold truncate">
                  {hasAnyPct
                    ? isAr
                      ? "ترتيب المباراة (0–99)"
                      : "Match percentile (0–99)"
                    : isAr
                    ? "قياسات فيديو حقيقية"
                    : "Measured video telemetry"}
                </div>
                <div dir="ltr" className="tabular-nums opacity-95 truncate">
                  {isAr
                    ? `${card.observed_s.toFixed(1)}ث • معايرة ${calPct}%`
                    : `${card.observed_s.toFixed(1)}s • ${calPct}% cal.`}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </WrapperTag>
  );
}

const PlayerCard = React.memo(PlayerCardInner);
export default PlayerCard;
