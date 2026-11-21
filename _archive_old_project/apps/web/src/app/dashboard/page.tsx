import React from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { BentoGrid, BentoCard } from '@/components/layout/bento-grid';
import { store } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { 
  TrendingUp, 
  Sparkles, 
  Video, 
  MapPin, 
  Users, 
  ShieldCheck, 
  ArrowUpRight, 
  Flame,
  Award,
  DollarSign,
  Radio,
  Trophy,
  Tv,
  Play
} from 'lucide-react';

const formatTierName = (tier: number) => {
  if (tier === 1) return 'الدوري الممتاز (دوري نايل)';
  if (tier === 2) return 'دوري المحترفين (القسم 2 أ)';
  if (tier === 3) return 'دوري القسم الثاني (ب)';
  return 'دوري القسم الثالث ومراكز الشباب';
};

export default function DashboardPage() {
  const stats = store.getDashboardStats();
  const topProspect = stats.topUndervalued[0];
  const recruitmentNeeds = store.getRecruitmentNeeds();
  const liveMatches = store.getLiveMatches().filter(m => m.status === 'live');

  // Calculate total recruitment candidates by stage
  const stageCounts = {
    spotted: 0,
    monitoring: 0,
    contacted: 0,
    trial: 0,
    negotiating: 0,
    signed: 0
  };

  recruitmentNeeds.forEach(need => {
    need.candidates.forEach(c => {
      if (c.stage in stageCounts) {
        stageCounts[c.stage as keyof typeof stageCounts]++;
      }
    });
  });

  return (
    <AppLayout>
      <div className="space-y-6 text-slate-100">
        {/* Top Header & Context */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">
                ScoutZero Intelligence Hub | مركز الاستكشاف التكتيكي للهرم الكروي المصري
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-white">
              لوحة القيادة التكتيكية والماني بول (Executive Hub)
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <Link 
              href="/matches" 
              className="inline-flex items-center gap-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 font-bold px-3 py-1.5 rounded-xl text-xs transition"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              <span>{liveMatches.length} مباريات جارية الآن</span>
            </Link>

            <Link 
              href="/studio" 
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 py-2 rounded-xl text-sm transition shadow-lg shadow-emerald-500/20"
            >
              <Video className="w-4 h-4" />
              <span>استوديو التحليل ({stats.pendingReviews} لقطة معلقة)</span>
            </Link>
          </div>
        </div>

        {/* 4-Tier Egyptian Football Pyramid KPI Counters */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div className="bg-[#111827]/70 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-slate-400 font-medium">إجمالي اللاعبين</p>
              <p className="text-2xl font-black text-white mt-0.5">{stats.totalPlayers}</p>
              <span className="text-[10px] text-emerald-400 font-semibold">كل المحافظات (27)</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Users className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-[#111827]/70 border border-amber-500/20 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-amber-300/80 font-medium">الدوري الممتاز (نايل)</p>
              <p className="text-2xl font-black text-amber-400 mt-0.5">{stats.tier1Count || 64}</p>
              <span className="text-[10px] text-amber-400/80 font-semibold">القسم الأول</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Trophy className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-[#111827]/70 border border-emerald-500/20 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-emerald-300/80 font-medium">دوري المحترفين</p>
              <p className="text-2xl font-black text-emerald-400 mt-0.5">{stats.tier2Count || 98}</p>
              <span className="text-[10px] text-emerald-400/80 font-semibold">القسم الثاني (أ)</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-[#111827]/70 border border-cyan-500/20 rounded-xl p-3.5 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-cyan-300/80 font-medium">القسم الثاني (ب)</p>
              <p className="text-2xl font-black text-cyan-400 mt-0.5">{stats.tier3Count || 82}</p>
              <span className="text-[10px] text-cyan-400/80 font-semibold">بحري، القناة، الصعيد</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <MapPin className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-[#111827]/70 border border-purple-500/20 rounded-xl p-3.5 flex items-center justify-between col-span-2 md:col-span-1">
            <div>
              <p className="text-[11px] text-purple-300/80 font-medium">القسم الثالث والأقاليم</p>
              <p className="text-2xl font-black text-purple-400 mt-0.5">{stats.tier4Count || 78}</p>
              <span className="text-[10px] text-purple-400/80 font-semibold">مراكز الشباب والمواهب</span>
            </div>
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Live Egyptian Matches Center Mini-Widget */}
        <div className="bg-[#111827]/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
              <h2 className="text-sm font-black text-white flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-red-400 animate-pulse" />
                <span>مباريات جارية الآن في الهرم الكروي المصري (Live Scores)</span>
              </h2>
            </div>
            <Link 
              href="/matches" 
              className="text-xs text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
            >
              <span>مركز المباريات وجدول الترتيب</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {liveMatches.slice(0, 3).map((match) => (
              <div 
                key={match.id}
                className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 transition group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-2 pb-1.5 border-b border-slate-800/80">
                    <span className="text-slate-400 font-medium truncate max-w-[150px]">
                      {match.leagueNameAr}
                    </span>
                    <span className="text-red-400 font-mono font-bold bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                      {match.minute}&apos; مباشر
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <span className="font-bold text-sm text-white truncate max-w-[100px]">
                      {match.homeTeamNameAr}
                    </span>
                    <span className="font-mono font-black text-base px-2.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      {match.homeScore} - {match.awayScore}
                    </span>
                    <span className="font-bold text-sm text-white truncate max-w-[100px] text-left">
                      {match.awayTeamNameAr}
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-500 mt-1 truncate">
                    📍 {match.stadiumAr}
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
                  <Link 
                    href="/matches"
                    className="text-[11px] text-slate-400 hover:text-emerald-400 font-medium transition"
                  >
                    تفاصيل وأحداث المباراة
                  </Link>
                  <Link 
                    href="/studio"
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-bold bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 rounded-md transition"
                  >
                    <Tv className="w-3 h-3" />
                    <span>تحليل تكتيكي</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bento Grid Executive Section */}
        <BentoGrid>
          {/* 1. Top Prospect of the Week (Col span 2) */}
          <BentoCard 
            title="موهبة الأسبوع المغمورة (Prospect of the Week)" 
            colSpan={2}
            className="border-emerald-500/40 relative overflow-hidden"
          >
            {topProspect ? (
              <div className="flex flex-col md:flex-row gap-6 items-center">
                <div className="relative">
                  <div className="w-28 h-28 rounded-2xl bg-gradient-to-tr from-emerald-950 to-slate-800 border-2 border-emerald-500/60 flex items-center justify-center text-3xl font-black text-emerald-400 shadow-xl">
                    {topProspect.nameAr.slice(0, 1)}
                  </div>
                  <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 shadow">
                    <Flame className="w-3 h-3" />
                    MUI {topProspect.mui.score}
                  </div>
                </div>

                <div className="flex-1 space-y-2 text-right">
                  <div className="flex items-center justify-between">
                    <Link 
                      href={`/players/${topProspect.id}`}
                      className="text-xl font-bold text-white hover:text-emerald-400 transition flex items-center gap-2"
                    >
                      <span>{topProspect.nameAr}</span>
                      <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                    </Link>
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                      {topProspect.positionPrimary} | {topProspect.age} سنة
                    </Badge>
                  </div>

                  <p className="text-sm text-slate-400 font-medium">
                    النادي الحالي: <strong className="text-slate-200">{topProspect.teamNameAr}</strong> ({formatTierName(topProspect.leagueTier)}) - محافظة {topProspect.governorate}
                  </p>

                  <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <span className="block text-slate-500">التطابق التكتيكي</span>
                      <span className="font-bold text-cyan-400">{topProspect.topArchetype.similarityPercentage}% ({topProspect.topArchetype.benchmarkPlayer.split('/')[0]})</span>
                    </div>
                    <div>
                      <span className="block text-slate-500">الراتب الشهري</span>
                      <span className="font-bold text-emerald-400">{topProspect.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م</span>
                    </div>
                    <div>
                      <span className="block text-slate-500">القدم المفضلة</span>
                      <span className="font-bold text-white">{topProspect.preferredFoot === 'left' ? 'يسرى' : topProspect.preferredFoot === 'right' ? 'يمنى' : 'كلتاهما'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1 text-xs">
                    <span className="text-slate-400">توصية الخوارزمية:</span>
                    <span className="text-emerald-400 font-semibold">موهبة ممتازة بنسبة مخاطرة تكلفة منخفضة للغاية</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-center py-6">لا توجد بيانات حالياً</p>
            )}
          </BentoCard>

          {/* 2. Recruitment Pipeline Kanban Summary (Col span 1) */}
          <BentoCard title="لوحة التعاقدات (Recruitment Stages)" colSpan={1}>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400">تحت الرصد والمتابعة (Monitoring)</span>
                <span className="font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-500/10">{stageCounts.monitoring + stageCounts.spotted}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400">تم التواصل (Contacted)</span>
                <span className="font-bold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10">{stageCounts.contacted}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400">فترة المعايشة (Trial)</span>
                <span className="font-bold text-purple-400 px-2 py-0.5 rounded bg-purple-500/10">{stageCounts.trial}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400">جلسات التفاوض (Negotiating)</span>
                <span className="font-bold text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10">{stageCounts.negotiating}</span>
              </div>
              <Link 
                href="/recruitment"
                className="mt-3 block text-center py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition font-semibold"
              >
                عرض لوحة كانبان للتعاقدات
              </Link>
            </div>
          </BentoCard>

          {/* 3. Top 5 Undervalued Talents Leaderboard (Col span 2, Row span 2) */}
          <BentoCard 
            title="أبرز 5 مواهب غير مكتشفة (Moneyball Undervalued Index)" 
            colSpan={2}
            className="border-slate-800"
          >
            <div className="space-y-3">
              {stats.topUndervalued.map((p, index) => (
                <div 
                  key={p.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-emerald-500/50 hover:bg-slate-900 transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center font-bold text-xs">
                      #{index + 1}
                    </span>
                    <div>
                      <Link href={`/players/${p.id}`} className="font-bold text-white hover:text-emerald-400 transition">
                        {p.nameAr}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                        <span className="text-emerald-400 font-semibold">{p.positionPrimary}</span>
                        <span>•</span>
                        <span>{p.teamNameAr} ({formatTierName(p.leagueTier)})</span>
                        <span>•</span>
                        <span>{p.age} سنة</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-left">
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500 block">الراتب الشهري</span>
                      <span className="text-xs font-semibold text-slate-300">
                        {p.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م
                      </span>
                    </div>

                    <div className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-center">
                      <span className="text-[10px] block font-bold">MUI</span>
                      <span className="text-base font-black">{p.mui.score}</span>
                    </div>
                  </div>
                </div>
              ))}

              <div className="pt-2 text-center">
                <Link 
                  href="/players" 
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold inline-flex items-center gap-1"
                >
                  <span>استكشاف قاعدة البيانات بالكامل (300 لاعب وفلاتر متقدمة)</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </BentoCard>

          {/* 4. Governorate Geographic Coverage (Col span 1) */}
          <BentoCard title="توزيع التغطية الجغرافية بمحافظات مصر" colSpan={1}>
            <div className="space-y-2 text-xs">
              {Object.entries(stats.govCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([gov, count]) => (
                  <div key={gov} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                    <span className="text-slate-300 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                      {gov === 'Cairo' ? 'القاهرة' :
                       gov === 'Giza' ? 'الجيزة' :
                       gov === 'Alexandria' ? 'الإسكندرية' :
                       gov === 'Gharbia' ? 'الغربية (المحلة وطنطا)' :
                       gov === 'Dakahlia' ? 'الدقهلية (المنصورة)' :
                       gov === 'Suez' ? 'السويس' :
                       gov === 'Aswan' ? 'أسوان' :
                       gov === 'Kafr El Sheikh' ? 'كفر الشيخ' : gov}
                    </span>
                    <span className="font-bold text-white bg-slate-800 px-2 py-0.5 rounded">{count} لاعب</span>
                  </div>
                ))}
              <div className="text-[11px] text-slate-500 text-center pt-1">
                تغطية نشطة لأقاليم الدلتا، القناة، والصعيد
              </div>
            </div>
          </BentoCard>

          {/* 5. Recent Matches & Ingestion (Col span 1) */}
          <BentoCard title="المباريات المسحوبة ومقاطع الفيديو" colSpan={1}>
            <div className="space-y-2.5 text-xs">
              {stats.recentMatches.map(m => (
                <div key={m.id} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="flex items-center justify-between text-slate-300 font-semibold mb-1">
                    <span>{m.homeTeamNameAr} ضد {m.awayTeamNameAr}</span>
                    <span className="text-emerald-400 font-mono">{m.homeScore} - {m.awayScore}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{m.date}</span>
                    <span className="text-slate-400">{m.clipsCount} لقطة مقصوصة</span>
                  </div>
                </div>
              ))}
              <Link 
                href="/matches" 
                className="mt-2 block text-center py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition font-semibold"
              >
                قائمة المباريات الكاملة
              </Link>
            </div>
          </BentoCard>
        </BentoGrid>
      </div>
    </AppLayout>
  );
}
