import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic, Silkscreen, Space_Grotesk } from "next/font/google";
import React from "react";
import "./globals.css";

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
  title: "EGY-SCOUT Coach Pro — bedigital",
  description: "منصة المدرب والمدير الفني وإداري الكرة المعتمدة ببيانات 2026/2027 الحية والذكاء الاصطناعي.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Coach Pro",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F2F6F8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${kufiAr.variable} ${ibmAr.variable} ${spaceGrotesk.variable} ${silkscreen.variable}`}>
      <body className="min-h-screen antialiased bg-[#F2F6F8] text-[#0B1F3A] overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
