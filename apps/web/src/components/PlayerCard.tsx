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
    bg: "linear-gradient(150deg, #FBF0AD 0%, #ECCB5E 34%, #D4A437 72%, #9F6F19 100%)",
    border: "#FFF5BE",
    outerEdge: "#B98521",
    inkHex: "#2A1805",
    ink: "text-[#2A1805]",
    subInk: "text-[#472B08]/90",
    divider: "bg-[#3A2206]/25",
    shardFill: "#FFF7CC",
    badgeAr: "ذهبي نادر",
    badgeEn: "Gold Rare",
  },
  silver: {
    bg: "linear-gradient(150deg, #FFFFFF 0%, #E2E8F0 36%, #94A3B8 74%, #64748B 100%)",
    border: "#FFFFFF",
    outerEdge: "#64748B",
    inkHex: "#0F172A",
    ink: "text-slate-950",
    subInk: "text-slate-900/85",
    divider: "bg-slate-900/25",
    shardFill: "#F8FAFC",
    badgeAr: "فضي",
    badgeEn: "Silver",
  },
  bronze: {
    bg: "linear-gradient(150deg, #F3C499 0%, #D28B50 38%, #A2622D 76%, #6E3F18 100%)",
    border: "#FED7AA",
    outerEdge: "#7C451A",
    inkHex: "#241103",
    ink: "text-[#241103]",
    subInk: "text-[#381B06]/90",
    divider: "bg-[#2E1604]/25",
    shardFill: "#FFEDD5",
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
  shortNum: string;
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
      shortNum: card.top_speed_kmh !== null ? `${card.top_speed_kmh.toFixed(0)}` : "—",
      rawText: card.top_speed_kmh !== null ? `${card.top_speed_kmh.toFixed(1)} km/h` : "—",
    },
    {
      key: "dst",
      code: "DST",
      ar: "مسافة",
      en: "Distance",
      pct: card.percentiles?.dst ?? null,
      rawVal: card.distance_m,
      shortNum: card.distance_m !== null ? `${Math.round(card.distance_m)}` : "—",
      rawText: card.distance_m !== null ? `${Math.round(card.distance_m)}m` : "—",
    },
    {
      key: "wrk",
      code: "WRK",
      ar: "جهد",
      en: "Work Rate",
      pct: card.percentiles?.wrk ?? null,
      rawVal: card.work_rate_m_per_min,
      shortNum: card.work_rate_m_per_min !== null ? `${Math.round(card.work_rate_m_per_min)}` : "—",
      rawText:
        card.work_rate_m_per_min !== null
          ? `${Math.round(card.work_rate_m_per_min)} m/m`
          : card.distance_m !== null
          ? isAr
            ? "<5د"
            : "<5m"
          : "—",
    },
    {
      key: "spr",
      code: "SPR",
      ar: "انطلاقات",
      en: "Sprints",
      pct: card.percentiles?.spr ?? null,
      rawVal: card.sprints,
      shortNum: card.sprints !== null ? `${card.sprints}` : "—",
      rawText: card.sprints !== null ? `${card.sprints}` : "—",
    },
    {
      key: "avg",
      code: "AVG",
      ar: "متوسط",
      en: "Avg Speed",
      pct: card.percentiles?.avg ?? null,
      rawVal: card.avg_speed_kmh,
      shortNum: card.avg_speed_kmh !== null ? `${card.avg_speed_kmh.toFixed(1)}` : "—",
      rawText: card.avg_speed_kmh !== null ? `${card.avg_speed_kmh.toFixed(1)} km/h` : "—",
    },
    {
      key: "min",
      code: "MIN",
      ar: "وقت",
      en: "Observed",
      pct: card.percentiles?.min ?? null,
      rawVal: card.observed_s,
      shortNum: card.observed_s >= 60 ? `${card.observed_min.toFixed(0)}m` : `${card.observed_s.toFixed(0)}s`,
      rawText:
        card.observed_s >= 60
          ? `${card.observed_min.toFixed(1)} ${isAr ? "د" : "m"}`
          : `${card.observed_s.toFixed(0)} ${isAr ? "ث" : "s"}`,
    },
  ];
}

// Authentic EA Sports FC 25 Scalloped-Crown Shield (0..100 x 0..144)
export const FC25_SHIELD_SVG_PATH =
  "M 11 10 L 18 10 Q 32 10 42 5 Q 50 1 58 5 Q 68 10 82 10 L 89 10 Q 97 10 97 22 L 97 122 Q 97 132 50 142 Q 3 132 3 122 L 3 22 Q 3 10 11 10 Z";
export const FC25_SHIELD_CLIP_PATH =
  "M 0.11 0.069 L 0.18 0.069 Q 0.32 0.069 0.42 0.035 Q 0.50 0.007 0.58 0.035 Q 0.68 0.069 0.82 0.069 L 0.89 0.069 Q 0.97 0.069 0.97 0.153 L 0.97 0.847 Q 0.97 0.917 0.50 0.986 Q 0.03 0.917 0.03 0.847 L 0.03 0.153 Q 0.03 0.069 0.11 0.069 Z";

export function CountryFlagIcon({ code = "EG", className = "w-5 h-3.5" }: { code?: string; className?: string }) {
  const cc = (code || "EG").toUpperCase();
  if (cc === "MA") {
    return (
      <svg viewBox="0 0 24 16" className={`${className} rounded-[2px] shadow-sm`} aria-label="MA">
        <rect width="24" height="16" fill="#C1272D" />
        <polygon points="12,3.5 13.5,8 17.5,8 14.2,10.5 15.5,14 12,11.6 8.5,14 9.8,10.5 6.5,8 10.5,8" fill="none" stroke="#006233" strokeWidth="1.2" />
      </svg>
    );
  }
  if (cc === "DE") {
    return (
      <svg viewBox="0 0 24 16" className={`${className} rounded-[2px] shadow-sm`} aria-label="DE">
        <rect width="24" height="5.3" y="0" fill="#111827" />
        <rect width="24" height="5.4" y="5.3" fill="#DC2626" />
        <rect width="24" height="5.3" y="10.7" fill="#FACC15" />
      </svg>
    );
  }
  if (cc === "ES") {
    return (
      <svg viewBox="0 0 24 16" className={`${className} rounded-[2px] shadow-sm`} aria-label="ES">
        <rect width="24" height="4" y="0" fill="#AA151B" />
        <rect width="24" height="8" y="4" fill="#F1BF00" />
        <rect width="24" height="4" y="12" fill="#AA151B" />
      </svg>
    );
  }
  if (cc === "CH") {
    return (
      <svg viewBox="0 0 24 16" className={`${className} rounded-[2px] shadow-sm`} aria-label="CH">
        <rect width="24" height="16" fill="#D52B1E" />
        <rect x="10.5" y="3" width="3" height="10" fill="#FFFFFF" />
        <rect x="7" y="6.5" width="10" height="3" fill="#FFFFFF" />
      </svg>
    );
  }
  if (cc === "TN" || cc === "DZ" || cc === "NG" || cc === "AR" || cc === "NL") {
    const mapColors: Record<string, [string, string, string]> = {
      TN: ["#E70013", "#E70013", "#E70013"],
      DZ: ["#006233", "#FFFFFF", "#006233"],
      NG: ["#008751", "#FFFFFF", "#008751"],
      AR: ["#74ACDF", "#FFFFFF", "#74ACDF"],
      NL: ["#AE1C28", "#FFFFFF", "#21468B"],
    };
    const [c1, c2, c3] = mapColors[cc] || ["#CE1126", "#FFFFFF", "#111827"];
    const vertical = cc === "DZ" || cc === "NG";
    return (
      <svg viewBox="0 0 24 16" className={`${className} rounded-[2px] shadow-sm`} aria-label={cc}>
        {vertical ? (
          <>
            <rect width="8" height="16" x="0" fill={c1} />
            <rect width="8" height="16" x="8" fill={c2} />
            <rect width="8" height="16" x="16" fill={c3} />
          </>
        ) : (
          <>
            <rect width="24" height="5.3" y="0" fill={c1} />
            <rect width="24" height="5.4" y="5.3" fill={c2} />
            <rect width="24" height="5.3" y="10.7" fill={c3} />
          </>
        )}
      </svg>
    );
  }
  // Default: Egypt Flag (Red / White / Black with Gold Eagle emblem)
  return (
    <svg viewBox="0 0 24 16" className={`${className} rounded-[2px] shadow-sm border border-black/15`} aria-label="EG">
      <rect width="24" height="5.3" y="0" fill="#CE1126" />
      <rect width="24" height="5.4" y="5.3" fill="#FFFFFF" />
      <rect width="24" height="5.3" y="10.7" fill="#111827" />
      <circle cx="12" cy="8" r="1.4" fill="#C09300" />
    </svg>
  );
}

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
        className={`${mini ? "w-11 h-11" : "w-24 h-24"} drop-shadow-[0_8px_18px_rgba(0,0,0,0.45)]`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`kit-${kitHex.replace("#", "")}-${posCode}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={kitHex} />
            <stop offset="100%" stopColor="#0F172A" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <path
          d="M 38 14 L 18 26 L 8 48 L 24 55 L 31 40 L 31 110 Q 60 116 89 110 L 89 40 L 96 55 L 112 48 L 102 26 L 82 14 Q 60 26 38 14 Z"
          fill={`url(#kit-${kitHex.replace("#", "")}-${posCode})`}
          stroke="rgba(255,255,255,0.88)"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        <text
          x="60"
          y="74"
          textAnchor="middle"
          fill="#FFFFFF"
          fontWeight="900"
          fontSize={jerseyNumber ? "34" : "22"}
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
  const clipId = `fc25-shield-${uid}`;
  const tier = TIER_STYLES[card.tier] || TIER_STYLES.bronze;
  const teamLabel = isAr ? card.team_name_ar : card.team_name_en;
  const displayName = isAr ? card.display_label : card.display_label_en || card.display_label;
  const initials = getTeamInitials(card.team_name_en || card.team_name_ar);
  const attrs = extractCardAttributes(card, isAr);
  const compareAttrs = compareTo ? extractCardAttributes(compareTo, isAr) : null;

  const basePhoto = card.photo_url.startsWith("http") ? card.photo_url : `${API_BASE}${card.photo_url}`;
  const photoSrc = photoVersion !== undefined ? `${basePhoto}&cb=${photoVersion}` : basePhoto;
  const calPct = Math.round((card.quality?.calibrated_ratio ?? 0) * 100);
  const hasAnyPct = attrs.some((a) => a.pct !== null);

  const shouldUseJerseyHero =
    forcePortraitMode === "jersey" ||
    (forcePortraitMode === "auto" &&
      card.photo_source === "video" &&
      Boolean(card.crop_is_low_res) &&
      card.identity_source === "unverified");

  const topRatingDisplay =
    card.jersey_number !== null && card.jersey_number > 0
      ? String(card.jersey_number)
      : card.top_speed_kmh !== null
      ? String(Math.round(card.top_speed_kmh))
      : String(calPct);

  const WrapperTag = onClick ? "button" : "div";

  if (isMini) {
    const spdText = card.top_speed_kmh !== null ? `${card.top_speed_kmh.toFixed(0)}` : "—";
    const dstText = card.distance_m !== null ? `${Math.round(card.distance_m)}m` : "—";
    return (
      <WrapperTag
        type={onClick ? "button" : undefined}
        onClick={onClick}
        aria-label={`${displayName} — ${card.position_label.code}`}
        className={`relative block w-[98px] aspect-[0.70] text-start select-none ${
          onClick ? "cursor-pointer hover:scale-105 transition-transform" : ""
        }`}
      >
        <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              <path d={FC25_SHIELD_CLIP_PATH} />
            </clipPath>
          </defs>
        </svg>
        <div
          className={`relative w-full h-full overflow-hidden shadow-xl shadow-black/75 ${tier.ink}`}
          style={{ clipPath: `url(#${clipId})`, background: tier.bg }}
        >
          <svg
            viewBox="0 0 100 144"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none"
            aria-hidden="true"
          >
            <polygon points="34,36 97,10 97,52 34,78" fill={tier.shardFill} fillOpacity="0.28" />
            <path d={FC25_SHIELD_SVG_PATH} fill="none" stroke={tier.border} strokeWidth="2.5" />
          </svg>
          <div className="relative z-10 h-full flex flex-col items-center justify-between px-2 pt-2.5 pb-2.5">
            <div className="w-full flex items-center justify-between px-1 leading-none">
              <span dir="ltr" className="text-sm font-black tabular-nums">
                {topRatingDisplay}
              </span>
              <span className="text-[9px] font-black uppercase tracking-tight">{card.position_label.code}</span>
            </div>
            <div className="w-12 h-12 flex items-center justify-center overflow-hidden rounded-full border border-black/15">
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
              <div className="text-[9.5px] font-black truncate leading-tight px-1">{displayName}</div>
              <div dir="ltr" className={`mt-0.5 text-[7.5px] font-extrabold tabular-nums ${tier.subInk}`}>
                {spdText}km/h • {dstText}
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
          ? `لون الكارت (${tier.badgeAr}) = درجة ثقة البيانات`
          : `Card tier (${tier.badgeEn}) = data confidence`
      }
      className={`group relative block w-full text-start select-none ${
        isCompact ? "max-w-[238px]" : "max-w-[336px]"
      } mx-auto aspect-[0.69] transition-transform duration-200 ${
        onClick ? "cursor-pointer motion-safe:hover:-translate-y-1.5 focus-visible:outline-2 focus-visible:outline-amber-300" : ""
      }`}
    >
      <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path d={FC25_SHIELD_CLIP_PATH} />
          </clipPath>
        </defs>
      </svg>

      {/* PlayStyle+ Signature Diamond Tab on outer left edge */}
      {(card.top_speed_kmh ?? 0) >= 20 && (
        <div
          className={`absolute z-20 ${isCompact ? "w-5 h-5 -left-1.5" : "w-7 h-7 -left-2"} top-[46%] rotate-45 rounded-[3px] border border-amber-100 shadow-md flex items-center justify-center`}
          style={{ background: "linear-gradient(135deg, #F6DE8A, #B7841E)" }}
          aria-hidden="true"
        >
          <span className={`-rotate-45 font-black text-[#2A1805] ${isCompact ? "text-[7px]" : "text-[9px]"}`}>+</span>
        </div>
      )}

      <div
        className={`relative w-full h-full overflow-hidden shadow-[0_20px_45px_rgba(0,0,0,0.75)] ${tier.ink}`}
        style={{
          clipPath: `url(#${clipId})`,
          background: tier.bg,
        }}
      >
        {/* EA FC 25 Diagonal Brushed Foil Facets & Shards */}
        <svg
          viewBox="0 0 100 144"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
        >
          <polygon points="36,36 97,10 97,32 45,58" fill={tier.shardFill} fillOpacity="0.34" />
          <polygon points="48,56 97,34 97,56 54,78" fill={tier.shardFill} fillOpacity="0.22" />
          <polygon points="10,48 64,74 10,82" fill={tier.outerEdge} fillOpacity="0.16" />
          <line x1="8" y1="86" x2="92" y2="86" stroke={tier.inkHex} strokeOpacity="0.22" strokeWidth="0.6" />
          <path d={FC25_SHIELD_SVG_PATH} fill="none" stroke={tier.border} strokeWidth="2.2" />
          <path d={FC25_SHIELD_SVG_PATH} fill="none" stroke={tier.outerEdge} strokeOpacity="0.45" strokeWidth="0.9" />
        </svg>

        {/* Subtle sheen on hover */}
        <div className="pointer-events-none absolute -inset-x-24 -inset-y-10 rotate-12 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className={`relative z-10 h-full flex flex-col ${isCompact ? "px-3 pt-4 pb-3" : "px-5 pt-5 pb-4"}`}>
          {/* TOP HERO STAGE: OVR/Number + Position Left | Big Chest-up Portrait Right */}
          <div className={`relative flex items-stretch ${isCompact ? "h-[53%]" : "h-[55%]"}`}>
            <div dir="ltr" className="z-10 flex flex-col items-center justify-start w-[28%] pt-1">
              <div
                className={`font-black leading-none tracking-tighter tabular-nums ${
                  isCompact ? "text-[26px]" : "text-[42px]"
                }`}
              >
                {topRatingDisplay}
              </div>
              <div className={`font-black tracking-tight uppercase mt-0.5 ${isCompact ? "text-[11px]" : "text-[15px]"}`}>
                {card.position_label.code}
              </div>
              <div className={`w-6 h-[1.5px] my-1.5 ${tier.divider}`} />
              <div
                className={`${
                  isCompact ? "w-5 h-5 text-[8px]" : "w-7 h-7 text-[10px]"
                } rounded-full border border-black/25 flex items-center justify-center font-black text-white shadow-sm`}
                style={{ backgroundColor: card.kit_hex }}
                title={teamLabel}
              >
                {initials}
              </div>
            </div>

            <div className="relative w-[72%] h-full flex items-end justify-center overflow-hidden">
              {shouldUseJerseyHero ? (
                <div className="relative w-full h-full flex items-center justify-center">
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
                    className={`absolute bottom-1 end-1 rounded-full object-cover object-top border-2 border-white/85 shadow-md bg-slate-900 ${
                      isCompact ? "w-8 h-8" : "w-12 h-12"
                    }`}
                  />
                </div>
              ) : (
                <img
                  src={photoSrc}
                  alt={displayName}
                  crossOrigin="anonymous"
                  loading="lazy"
                  className="w-full h-full object-cover object-top drop-shadow-[0_8px_14px_rgba(0,0,0,0.32)]"
                  style={{
                    maskImage: "linear-gradient(to bottom, black 78%, transparent 100%)",
                    WebkitMaskImage: "linear-gradient(to bottom, black 78%, transparent 100%)",
                  }}
                />
              )}
            </div>
          </div>

          {/* PLAYER NAMEPLATE DIRECTLY ON FOIL (Zero Black Box!) */}
          <div className="text-center mt-0.5">
            <div className={`h-[1px] w-[88%] mx-auto mb-1 ${tier.divider}`} />
            <div
              className={`font-black truncate leading-tight px-2 ${
                isCompact ? "text-[13px]" : "text-[20px] tracking-tight"
              }`}
            >
              {displayName}
            </div>
            {!isCompact && card.identity_source === "unverified" && (
              <div className="mt-0.5 inline-block px-2 py-0.5 rounded-full bg-black/15 text-[9.5px] font-bold">
                {isAr ? "هوية غير مؤكدة — حدد اللاعب" : "Unverified — Assign Player"}
              </div>
            )}
          </div>

          {/* 6-COLUMN EA FC 25 HORIZONTAL STAT STRIP DIRECTLY ON FOIL */}
          <div
            dir="ltr"
            className={`grid grid-cols-6 gap-0.5 text-center items-center ${isCompact ? "mt-1.5 px-0.5" : "mt-2 px-1"}`}
          >
            {attrs.map((attr, idx) => {
              const otherVal = compareAttrs?.[idx]?.rawVal ?? null;
              const isHigher =
                compareTo !== null && attr.rawVal !== null && otherVal !== null && attr.rawVal > otherVal;
              const bigVal = hasAnyPct && attr.pct !== null ? String(attr.pct) : attr.shortNum;
              return (
                <div
                  key={attr.key}
                  title={`${isAr ? attr.ar : attr.en}: ${attr.rawText}`}
                  className="flex flex-col items-center leading-none"
                >
                  <span
                    className={`font-extrabold tracking-tight uppercase ${tier.subInk} ${
                      isCompact ? "text-[7px]" : "text-[9px]"
                    }`}
                  >
                    {attr.code}
                  </span>
                  <span
                    className={`font-black tabular-nums mt-0.5 flex items-center justify-center ${
                      isCompact ? "text-[11px]" : "text-[15px]"
                    }`}
                  >
                    {bigVal}
                    {isHigher && (
                      <span className="text-emerald-800 text-[8px] ms-0.5" aria-label="higher">
                        ▲
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* BOTTOM BADGE TRIO: Nationality Flag (verified only) + League + Club Shield */}
          <div className="mt-auto pt-1.5 flex items-center justify-center gap-2.5">
            {card.nationality_code && (
              <CountryFlagIcon
                code={card.nationality_code}
                className={isCompact ? "w-4 h-2.5" : "w-6 h-4"}
              />
            )}
            <span
              className={`inline-flex items-center justify-center rounded-full border border-black/25 bg-black/10 font-black tracking-tight ${
                isCompact ? "px-1 py-0 text-[7px]" : "px-1.5 py-0.5 text-[8.5px]"
              }`}
            >
              {card.club_id === "bayer_leverkusen_alonso" ? "BL" : "EPL"}
            </span>
            <span
              className={`inline-flex items-center justify-center rounded-full border border-white/80 font-black text-white shadow-sm ${
                isCompact ? "w-4 h-4 text-[6.5px]" : "w-5 h-5 text-[8px]"
              }`}
              style={{ backgroundColor: card.kit_hex }}
              title={teamLabel}
            >
              {initials}
            </span>
          </div>
        </div>
      </div>
    </WrapperTag>
  );
}

const PlayerCard = React.memo(PlayerCardInner);
export default PlayerCard;
