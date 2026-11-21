"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { LiveMatch, store } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { 
  Radio, 
  ChevronRight, 
  ChevronLeft, 
  Tv, 
  Flame, 
  Clock, 
  Activity, 
  Play, 
  X,
  Target
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function LiveTicker() {
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<LiveMatch | null>(null);
  const [tickerFilter, setTickerFilter] = useState<'all' | 'l1' | 'l2' | 'l3' | 'l5'>('all');
  const [liveGoalToast, setLiveGoalToast] = useState<string | null>(null);

  useEffect(() => {
    setLiveMatches(store.getLiveMatches());
  }, []);

  // Real-time live match simulation engine: updates minutes and triggers occasional live goals
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveMatches(prev => {
        let alertMessage: string | null = null;
        const updated = prev.map(m => {
          if (m.status !== 'live') return m;
          
          // End match at 90+ minutes (with added time up to 95)
          if (m.minute >= 90) {
            const addedTime = 90 + Math.floor(Math.random() * 5);
            if (m.minute >= addedTime) {
              return { ...m, status: 'finished' as const, minute: 90 };
            }
          }

          const nextMinute = m.minute + 1;
          let newHomeScore = m.homeScore;
          let newAwayScore = m.awayScore;
          const updatedEvents = [...m.events];
          const updatedStats = { ...m.liveStats };

          // Dynamic stats updates each tick
          if (Math.random() < 0.3) {
            updatedStats.shotsHome += Math.random() < 0.5 ? 1 : 0;
            updatedStats.shotsAway += Math.random() < 0.5 ? 1 : 0;
          }
          if (Math.random() < 0.15) {
            updatedStats.cornersHome += Math.random() < 0.5 ? 1 : 0;
            updatedStats.cornersAway += Math.random() < 0.5 ? 1 : 0;
          }
          if (Math.random() < 0.08) {
            updatedStats.foulsHome += 1;
          }
          if (Math.random() < 0.08) {
            updatedStats.foulsAway += 1;
          }
          // Slight possession shifts
          const shift = Math.floor(Math.random() * 3) - 1;
          updatedStats.possessionHome = Math.max(35, Math.min(65, updatedStats.possessionHome + shift));
          updatedStats.possessionAway = 100 - updatedStats.possessionHome;

          // Occasional live goal simulation (approx once every 50-60s)
          if (Math.random() < 0.12 && !alertMessage) {
            const isHome = Math.random() > 0.45;
            if (isHome) {
              newHomeScore++;
              updatedStats.shotsHome++;
              updatedStats.shotsOnTargetHome++;
            } else {
              newAwayScore++;
              updatedStats.shotsAway++;
              updatedStats.shotsOnTargetAway++;
            }

            const scorer = isHome
              ? (m.homeTeamNameAr === 'الأهلي' ? 'وسام أبو علي' : m.homeTeamNameAr === 'الزمالك' ? 'أحمد سيد زيزو' : m.homeTeamNameAr === 'كفر الشيخ' ? 'محمد مجدي السعيد' : m.homeTeamNameAr === 'مركز شباب بيلا' ? 'حسام رمضان' : 'مهاجم الفريق')
              : (m.awayTeamNameAr === 'بيراميدز' ? 'مصطفى فتحي' : m.awayTeamNameAr === 'المصري البورسعيدي' ? 'فخر الدين بن يوسف' : m.awayTeamNameAr === 'نادي دسوق' ? 'أحمد الصاوي' : 'صانع الألعاب');

            alertMessage = `⚽ هدف مباشر! ${scorer} يسجل لـ ${isHome ? m.homeTeamNameAr : m.awayTeamNameAr} في الدقيقة ${nextMinute}'! (${newHomeScore} - ${newAwayScore})`;

            updatedEvents.push({
              id: `ev_live_${Date.now()}`,
              minute: nextMinute,
              type: 'goal',
              team: isHome ? 'home' : 'away',
              playerAr: scorer,
              detailAr: 'هدف مباشر ملعوب'
            });
          }

          // Occasional yellow card
          if (Math.random() < 0.04 && !alertMessage) {
            const isHome = Math.random() > 0.5;
            if (isHome) updatedStats.yellowCardsHome++;
            else updatedStats.yellowCardsAway++;
            updatedEvents.push({
              id: `ev_yc_${Date.now()}`,
              minute: nextMinute,
              type: 'yellow_card',
              team: isHome ? 'home' : 'away',
              playerAr: 'لاعب الفريق',
              detailAr: 'مخالفة قوية'
            });
          }

          return {
            ...m,
            minute: nextMinute,
            homeScore: newHomeScore,
            awayScore: newAwayScore,
            events: updatedEvents,
            liveStats: updatedStats
          };
        });

        if (alertMessage) {
          setLiveGoalToast(alertMessage);
          setTimeout(() => setLiveGoalToast(null), 4500);
        }

        return updated;
      });
    }, 10000); // Ticks every 10s for active real-time feel

    return () => clearInterval(timer);
  }, []);

  if (liveMatches.length === 0) return null;

  const filteredMatches = tickerFilter === 'all'
    ? liveMatches
    : liveMatches.filter(m => m.leagueId === tickerFilter);

  return (
    <>
      {/* Live Goal Alert Toast Banner */}
      {liveGoalToast && (
        <div className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 text-slate-950 font-black px-4 py-1.5 text-xs text-center flex items-center justify-center gap-2 shadow-2xl animate-pulse sticky top-16 z-50">
          <Flame className="w-4 h-4 text-amber-200 animate-bounce" />
          <span>{liveGoalToast}</span>
        </div>
      )}

      <div className="w-full bg-[#0b0f19] border-b border-slate-800/80 px-3 py-1.5 text-xs flex items-center gap-2.5 overflow-hidden select-none">
        {/* Live Pulse Label */}
        <div className="flex items-center gap-1.5 pr-2 border-l border-slate-800 whitespace-nowrap">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
          </span>
          <span className="font-black text-red-400 text-[11px] tracking-wide flex items-center gap-1">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>مباشر</span>
          </span>
        </div>

        {/* League Tier Pills */}
        <div className="flex items-center gap-1 border-l border-slate-800 pl-2">
          {[
            { id: 'all', label: 'الكل' },
            { id: 'l1', label: 'الممتاز' },
            { id: 'l2', label: 'المحترفين' },
            { id: 'l3', label: 'القسم 2 ب' },
            { id: 'l5', label: 'القسم 3' }
          ].map(tier => (
            <button
              key={tier.id}
              onClick={() => setTickerFilter(tier.id as any)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition whitespace-nowrap ${
                tickerFilter === tier.id 
                  ? 'bg-emerald-500 text-slate-950 shadow' 
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {tier.label}
            </button>
          ))}
        </div>

        {/* Ticker Items Horizontal Scroll */}
        <div className="flex-1 flex items-center gap-3 overflow-x-auto no-scrollbar scroll-smooth py-0.5">
          {filteredMatches.map((m) => (
            <div
              key={m.id}
              onClick={() => setSelectedMatch(m)}
              className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl border transition cursor-pointer shrink-0 ${
                m.status === 'live' 
                  ? 'bg-slate-900/90 border-slate-800 hover:border-emerald-500/60 hover:bg-slate-850 text-white shadow-sm'
                  : 'bg-slate-950/60 border-slate-900 hover:border-slate-800 text-slate-300'
              }`}
            >
              {/* League & Status */}
              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                {m.status === 'live' ? (
                  <span className="text-red-400 font-bold bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                    {m.minute}&apos;
                  </span>
                ) : (
                  <span className="text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                    انتهت
                  </span>
                )}
              </div>

              {/* Home Team */}
              <span className="font-bold text-xs text-slate-100 truncate max-w-[110px]">
                {m.homeTeamNameAr}
              </span>

              {/* Score */}
              <span className="font-mono font-black text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                {m.homeScore} - {m.awayScore}
              </span>

              {/* Away Team */}
              <span className="font-bold text-xs text-slate-100 truncate max-w-[110px]">
                {m.awayTeamNameAr}
              </span>

              {/* Video icon */}
              {m.hasVideoFeed && (
                <span className="text-[10px] text-cyan-400 flex items-center gap-0.5 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                  <Tv className="w-3 h-3" />
                  <span>فيديو</span>
                </span>
              )}
            </div>
          ))}
        </div>

        {/* View All Matches Link */}
        <Link 
          href="/matches" 
          className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold whitespace-nowrap pl-2 border-r border-slate-800 flex items-center gap-1"
        >
          <span>مركز المباريات</span>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Live Match Center Modal */}
      <Dialog open={!!selectedMatch} onOpenChange={(open) => !open && setSelectedMatch(null)}>
        <DialogContent className="max-w-2xl bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center justify-between text-right">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-red-500 animate-pulse" />
                <span>مركز المباراة المباشر: {selectedMatch?.homeTeamNameAr} ضد {selectedMatch?.awayTeamNameAr}</span>
              </div>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs font-mono">
                {selectedMatch?.leagueNameAr}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {selectedMatch && (
            <div className="space-y-4 pt-2">
              {/* Scoreboard Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-[#111827] to-slate-900 border border-slate-800 text-center relative overflow-hidden">
                <div className="text-xs text-slate-400 mb-2 font-mono flex items-center justify-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>الدقيقة {selectedMatch.minute}&apos; • {selectedMatch.stadiumAr}</span>
                </div>

                <div className="flex items-center justify-center gap-8">
                  <div className="flex-1 text-center">
                    <span className="text-xl font-black text-white block">{selectedMatch.homeTeamNameAr}</span>
                    <span className="text-[11px] text-slate-400">صاحب الأرض</span>
                  </div>

                  <div className="px-5 py-2 rounded-2xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-mono font-black text-3xl shadow-lg shadow-emerald-500/10">
                    {selectedMatch.homeScore} : {selectedMatch.awayScore}
                  </div>

                  <div className="flex-1 text-center">
                    <span className="text-xl font-black text-white block">{selectedMatch.awayTeamNameAr}</span>
                    <span className="text-[11px] text-slate-400">الضيف</span>
                  </div>
                </div>

                {/* Match Video Player Preview if Available */}
                {selectedMatch.hasVideoFeed && selectedMatch.videoUrl && (
                  <div className="mt-4 pt-4 border-t border-slate-800">
                    <div className="aspect-video rounded-xl overflow-hidden bg-black border border-slate-800 shadow-xl relative">
                      <video
                        src={selectedMatch.videoUrl}
                        controls
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Live Match Stats Comparison */}
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3 text-xs">
                <h4 className="font-bold text-white flex items-center gap-1.5 pb-1 border-b border-slate-800">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>الإحصائيات الحية للمباراة (Live Stats)</span>
                </h4>

                {/* Possession Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between font-mono font-bold text-[11px]">
                    <span className="text-emerald-400">{selectedMatch.liveStats.possessionHome}%</span>
                    <span className="text-slate-400 font-sans font-normal">الاستحواذ على الكرة</span>
                    <span className="text-cyan-400">{selectedMatch.liveStats.possessionAway}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex">
                    <div 
                      className="bg-emerald-500 h-full transition-all duration-500" 
                      style={{ width: `${selectedMatch.liveStats.possessionHome}%` }} 
                    />
                    <div 
                      className="bg-cyan-500 h-full transition-all duration-500" 
                      style={{ width: `${selectedMatch.liveStats.possessionAway}%` }} 
                    />
                  </div>
                </div>

                {/* Grid Comparison */}
                <div className="grid grid-cols-3 gap-2 pt-1 text-center text-xs">
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block">التسديدات (على المرمى)</span>
                    <span className="font-mono font-bold text-slate-200">
                      {selectedMatch.liveStats.shotsHome} ({selectedMatch.liveStats.shotsOnTargetHome}) - {selectedMatch.liveStats.shotsAway} ({selectedMatch.liveStats.shotsOnTargetAway})
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block">الركنيات</span>
                    <span className="font-mono font-bold text-slate-200">
                      {selectedMatch.liveStats.cornersHome} - {selectedMatch.liveStats.cornersAway}
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block">البطاقات الصفراء</span>
                    <span className="font-mono font-bold text-amber-400">
                      {selectedMatch.liveStats.yellowCardsHome} - {selectedMatch.liveStats.yellowCardsAway}
                    </span>
                  </div>
                </div>
              </div>

              {/* Match Events Timeline */}
              {selectedMatch.events.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs">
                  <h4 className="font-bold text-white flex items-center gap-1.5 pb-1 border-b border-slate-800">
                    <Flame className="w-4 h-4 text-amber-400" />
                    <span>أبرز أحداث وأهداف اللقاء</span>
                  </h4>

                  <div className="space-y-1.5 max-h-36 overflow-y-auto pt-1">
                    {selectedMatch.events.map((ev) => (
                      <div 
                        key={ev.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded text-[10px]">
                            {ev.minute}&apos;
                          </span>
                          <span className="font-bold text-white">{ev.playerAr}</span>
                          {ev.detailAr && <span className="text-[10px] text-slate-400">({ev.detailAr})</span>}
                        </div>
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] ${
                            ev.type === 'goal' 
                              ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' 
                              : 'border-amber-500/50 text-amber-400 bg-amber-500/10'
                          }`}
                        >
                          {ev.type === 'goal' ? '⚽ هدف' : '🟨 إنذار'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Direct Link to Studio */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <Link
                  href={`/studio?matchId=${selectedMatch.id.startsWith('live') ? 'm1' : 'm2'}`}
                  onClick={() => setSelectedMatch(null)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/20"
                >
                  <Target className="w-4 h-4" />
                  <span>فتح في استوديو التحليل التكتيكي للتقطيع الفوري</span>
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
