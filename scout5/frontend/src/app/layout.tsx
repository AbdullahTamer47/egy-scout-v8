import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EGY-SCOUT V6 | استوديو البث 3D التكتيكي ومنظومة كشافة الدوري المصري",
  description:
    "منصة التحليل التكتيكي ثلاثي الأبعاد المعايَر بـ PnLCalib وبروفايلات اللاعبين ومصفوفة الخطط ومنظومة Moneyball لأندية الدوري المصري",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className="dark">
      <body className="min-h-screen bg-[#050911] text-slate-100 antialiased selection:bg-emerald-500/30">
        {children}
      </body>
    </html>
  );
}
