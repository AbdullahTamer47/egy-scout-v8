import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic, Silkscreen, Space_Grotesk } from "next/font/google";
import React from "react";

const kufiAr = Noto_Kufi_Arabic({
  subsets: ["arabic"],
  weight: ["600", "700"],
  variable: "--font-kufi",
});

const ibmAr = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-ibm-ar",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-space",
});

const silkscreen = Silkscreen({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-silk",
});

export const metadata: Metadata = {
  title: "EGY-SCOUT Coach Pro — bedigital | غرفة القيادة الفنية والتدريب والإدارة",
  description:
    "منصة المدرب والمدير الفني وإداري الكرة المعتمدة ببيانات الدوري المصري 2026/2027 الحية والذكاء الاصطناعي من bedigital.",
};

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${kufiAr.variable} ${ibmAr.variable} ${spaceGrotesk.variable} ${silkscreen.variable} min-h-screen`}>
      {children}
    </div>
  );
}
