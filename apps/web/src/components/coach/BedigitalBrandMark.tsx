"use client";

import React from "react";

interface Props {
  showWordmark?: boolean;
  compact?: boolean;
  subtitle?: string;
}

/**
 * Official bedigital Brand Identity (Monitor Ba + single Nuqta Gold diamond + Signal Teal pixel dissolve).
 */
export default function BedigitalBrandMark({ showWordmark = true, compact = false, subtitle }: Props) {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      {/* Monitor Ba icon */}
      <svg
        width={compact ? 32 : 38}
        height={compact ? 32 : 38}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="bedigital mark"
        className="shrink-0"
      >
        {/* Hard offset pixel shadow */}
        <rect x="4" y="6" width="29" height="21" rx="2" fill="#0FB5AE" fillOpacity="0.22" />
        {/* Monitor frame */}
        <rect x="2" y="3" width="29" height="21" rx="2" fill="#FFFFFF" stroke="#0B1F3A" strokeWidth="2.4" />
        {/* Inner dark midnight navy screen */}
        <rect x="4.5" y="5.5" width="24" height="16" fill="#0B1F3A" />
        {/* Teal pixel top bar accent */}
        <rect x="6" y="7" width="4" height="2" fill="#0FB5AE" />
        {/* Arabic letter Ba shape in Paper White */}
        <path
          d="M9.5 11.5V15.5H23.5V11.5"
          stroke="#FFFFFF"
          strokeWidth="2.3"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        {/* Single Signature Nuqta Gold diamond */}
        <polygon points="16.5,17 18.7,19.2 16.5,21.4 14.3,19.2" fill="#E0A526" />
        {/* Monitor stand */}
        <rect x="13.5" y="24" width="6" height="4" fill="#0B1F3A" />
        <rect x="10" y="28" width="13" height="2.6" fill="#0B1F3A" />
      </svg>

      {showWordmark && (
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1" dir="ltr">
            <span className="text-sm font-extrabold tracking-tight text-[#0B1F3A]">
              be<span className="text-[#0D717A]">digital</span>
            </span>
            {/* Pixel dissolve tail */}
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
              <rect x="0" y="7" width="3" height="3" fill="#0FB5AE" />
              <rect x="4" y="4" width="3" height="3" fill="#0FB5AE" />
              <rect x="4" y="8" width="3" height="3" fill="#3FC4BE" />
              <rect x="8" y="2" width="3" height="3" fill="#7BD6D3" />
              <rect x="8" y="6" width="3" height="3" fill="#B7E9E7" />
              <rect x="12" y="0" width="2.5" height="2.5" fill="#E0A526" />
            </svg>
          </div>
          {subtitle && <div className="text-[10px] font-bold text-[#0D717A] truncate">{subtitle}</div>}
        </div>
      )}
    </div>
  );
}
