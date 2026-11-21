import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EGY-SCOUT PRO V3.0 | منصة التحليل التكتيكي واكتشاف المواهب المصرية",
  description: "محرك الرؤية الحاسوبية والإسقاط الهندسي ثلاثي الأبعاد وتحليل الكرة المصرية وكشاف Moneyball",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className="dark">
      <body className="min-h-screen bg-[#070b12] text-slate-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}
