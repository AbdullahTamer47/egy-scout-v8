import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "EGY-SCOUT Coach Pro — غرفة القيادة الفنية والتدريب والإدارة",
  description:
    "البرنامج المتكامل للمدرب والمدير الفني والإداري — قاعدة الدوري المصري الكاملة، 3 حالات تكتيكية، وحدات التدريب والأحمال، وكشف المباراة الرسمي.",
};

export default function CoachProLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
