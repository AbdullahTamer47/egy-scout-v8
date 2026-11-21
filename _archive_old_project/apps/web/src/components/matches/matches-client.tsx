"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { MatchVideo, LiveMatch, LeagueStanding, store } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Trophy, 
  Film, 
  Calendar, 
  Play, 
  Video, 
  Clock, 
  Eye, 
  Radio, 
  Activity, 
  Target,
  Flame,
  CheckCircle2,
  Table,
  BarChart2,
  ChevronLeft
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MatchesClientProps {
  initialMatches: MatchVideo[];
}

export function MatchesClient({ initialMatches }: MatchesClientProps) {
  const [matches] = useState<MatchVideo[]>(initialMatches);
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([]);
  const [premierStandings, setPremierStandings] = useState<LeagueStanding[]>([]);
  const [proStandings, setProStandings] = useState<LeagueStanding[]>([]);
  const [secondBStandings, setSecondBStandings] = useState<LeagueStanding[]>([]);
  const [thirdDivStandings, setThirdDivStandings] = useState<LeagueStanding[]>([]);
  
  const [activeTab, setActiveTab] = useState<'live' | 'results' | 'standings' | 'videos'>('live');
  const [standingsLeague, setStandingsLeague] = useState<'premier' | 'pro' | 'second_b' | 'third_div'>('premier');
  const [tierFilter, setTierFilter] = useState<'all' | 'l1' | 'l2' | 'l3' | 'l5'>('all');
  const [previewMatch, setPreviewMatch] = useState<MatchVideo | null>(null);
  const [selectedLiveMatch, setSelectedLiveMatch] = useState<LiveMatch | null>(null);

  useEffect(() => {
    setLiveMatches(store.getLiveMatches());
    setPremierStandings(store.getPremierStandings());
    setProStandings(store.getProStandings());
    setSecondBStandings(store.getSecondBStandings());
    setThirdDivStandings(store.getThirdDivStandings());
  }, []);

  // Realistic live match simulation with stats, goals, and match transitions
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveMatches(prev => 
        prev.map(m => {
          if (m.status !== 'live') return m;
          
          // End match at 90+ with added time
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

          // Dynamically update stats
          if (Math.random() < 0.25) {
            updatedStats.shotsHome += Math.random() < 0.5 ? 1 : 0;
            updatedStats.shotsAway += Math.random() < 0.5 ? 1 : 0;
          }
          const shift = Math.floor(Math.random() * 3) - 1;
          updatedStats.possessionHome = Math.max(35, Math.min(65, updatedStats.possessionHome + shift));
          updatedStats.possessionAway = 100 - updatedStats.possessionHome;

          // Occasional goal
          if (Math.random() < 0.1) {
            const isHome = Math.random() > 0.45;
            if (isHome) { newHomeScore++; updatedStats.shotsOnTargetHome++; }
            else { newAwayScore++; updatedStats.shotsOnTargetAway++; }
            updatedEvents.push({
              id: `ev_mc_${Date.now()}`,
              minute: nextMinute,
              type: 'goal',
              team: isHome ? 'home' : 'away',
              playerAr: 'مهاجم الفريق',
              detailAr: 'هدف مباشر'
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
        })
      );
    }, 10000);

    return () => clearInterval(timer);
  }, []);

  const currentlyLive = liveMatches.filter(m => m.status === 'live');
  const finishedMatches = liveMatches.filter(m => m.status === 'finished');

  return (
    <div className="space-y-6 text-slate-100">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            </span>
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">
              Egyptian Football Live Match Center | مركز المباريات المباشرة والنتائج
            </span>
          </div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-emerald-400" />
            <span>المباريات، النتائج الحية، وجدول ترتيب الدوري المصري</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            تغطية حية للدوري المصري الممتاز (دوري نايل) ودوري المحترفين (القسم الثاني أ) مع لقطات الفيديو والتحليل التكتيكي
          </p>
        </div>

        <Link href="/studio">
          <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs gap-1.5 shadow-lg shadow-emerald-500/20">
            <Film className="w-4 h-4" />
            <span>استوديو التحليل التكتيكي المباشر</span>
          </Button>
        </Link>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('live')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'live' 
              ? 'bg-red-500/15 text-red-400 border border-red-500/40 shadow-lg shadow-red-500/10' 
              : 'text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
          <span>مباريات جارية الآن ({currentlyLive.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('results')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'results' 
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 shadow-lg shadow-emerald-500/10' 
              : 'text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>أحدث نتائج الجولة</span>
        </button>

        <button
          onClick={() => setActiveTab('standings')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'standings' 
              ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/40 shadow-lg shadow-cyan-500/10' 
              : 'text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
          }`}
        >
          <Table className="w-4 h-4" />
          <span>جدول ترتيب الدوري المصري 2026/2027</span>
        </button>

        <button
          onClick={() => setActiveTab('videos')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'videos' 
              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/40 shadow-lg shadow-purple-500/10' 
              : 'text-slate-400 hover:text-white hover:bg-slate-900 border border-transparent'
          }`}
        >
          <Video className="w-4 h-4" />
          <span>مكتبة الفيديوهات التكتيكية ({matches.length})</span>
        </button>
      </div>

      {/* TAB 1: LIVE NOW MATCHES */}
      {activeTab === 'live' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-300">مباريات الكرة المصرية الجارية الآن:</span>
              <span className="text-xs text-red-400 font-mono flex items-center gap-1 font-bold">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>بث مباشر لحظي (Real-Time)</span>
              </span>
            </div>

            {/* Tier Filters for Live Matches */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-[11px]">
              {[
                { id: 'all', label: 'جميع الدرجات' },
                { id: 'l1', label: 'الدوري الممتاز' },
                { id: 'l2', label: 'دوري المحترفين' },
                { id: 'l3', label: 'القسم الثاني (ب)' },
                { id: 'l5', label: 'القسم الثالث' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTierFilter(t.id as any)}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition whitespace-nowrap ${
                    tierFilter === t.id
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {currentlyLive
              .filter(m => tierFilter === 'all' || m.leagueId === tierFilter)
              .map((m) => (
              <div 
                key={m.id}
                className="p-5 rounded-2xl bg-gradient-to-b from-slate-900/90 to-[#111827] border border-slate-800 hover:border-emerald-500/50 transition duration-200 space-y-4 shadow-xl relative overflow-hidden"
              >
                {/* Header & Minute */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold border border-red-500/40 text-[11px] flex items-center gap-1 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
                      <span>{m.minute}&apos; مباشر</span>
                    </span>
                    <span className="text-slate-400">{m.stadiumAr}</span>
                  </div>
                  <Badge variant="outline" className="border-slate-700 text-slate-300 text-[10px]">
                    {m.leagueNameAr}
                  </Badge>
                </div>

                {/* Scoreboard */}
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                  <div className="text-right flex-1">
                    <span className="font-black text-white text-base block">{m.homeTeamNameAr}</span>
                    <span className="text-[10px] text-slate-400">صاحب الأرض</span>
                  </div>

                  <div className="px-4 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 font-mono font-black text-2xl mx-3 shadow-lg shadow-emerald-500/10">
                    {m.homeScore} : {m.awayScore}
                  </div>

                  <div className="text-left flex-1">
                    <span className="font-black text-white text-base block">{m.awayTeamNameAr}</span>
                    <span className="text-[10px] text-slate-400">الضيف</span>
                  </div>
                </div>

                {/* Possession bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-emerald-400 font-bold">{m.liveStats.possessionHome}%</span>
                    <span className="text-slate-500 text-[10px] font-sans">الاستحواذ</span>
                    <span className="text-cyan-400 font-bold">{m.liveStats.possessionAway}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
                    <div className="bg-emerald-500 h-full" style={{ width: `${m.liveStats.possessionHome}%` }} />
                    <div className="bg-cyan-500 h-full" style={{ width: `${m.liveStats.possessionAway}%` }} />
                  </div>
                </div>

                {/* Goal Scorers list */}
                {m.events.filter(e => e.type === 'goal').length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 text-xs space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">الأهداف المسجلة:</span>
                    {m.events.filter(e => e.type === 'goal').map(g => (
                      <div key={g.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-200">⚽ {g.playerAr} ({g.detailAr || 'هدف'})</span>
                        <span className="text-emerald-400 font-mono text-[10px]">{g.minute}&apos;</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="pt-2 border-t border-slate-800/80 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedLiveMatch(m)}
                    className="flex-1 bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300 text-xs gap-1.5 font-semibold"
                  >
                    <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>تفاصيل وإحصائيات اللقاء</span>
                  </Button>

                  <Link 
                    href={`/studio?matchId=${m.id.startsWith('live_4') ? 'm1' : m.id.startsWith('live_2') ? 'm2' : 'm3'}`}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/10"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>تحليل الفيديو بالاستوديو</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: RECENT ROUND RESULTS */}
      {activeTab === 'results' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">أحدث نتائج الجولة الأخيرة من الدوري المصري الممتاز ودوري المحترفين:</span>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs">الجولة 6 - أكتوبر 2026</Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...finishedMatches, ...currentlyLive].map((m) => (
              <div 
                key={m.id}
                className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition space-y-3"
              >
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-mono text-[11px]">{m.matchDate}</span>
                  <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-300">
                    {m.leagueNameAr}
                  </Badge>
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="font-bold text-white text-sm flex-1">{m.homeTeamNameAr}</span>
                  <span className="font-mono font-black text-sm px-2.5 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700 mx-2">
                    {m.homeScore} - {m.awayScore}
                  </span>
                  <span className="font-bold text-white text-sm flex-1 text-left">{m.awayTeamNameAr}</span>
                </div>

                <div className="text-[11px] text-slate-400 flex items-center justify-between pt-2 border-t border-slate-800/80">
                  <span>{m.stadiumAr}</span>
                  <Link 
                    href={`/studio?matchId=${m.id.startsWith('live') ? 'm1' : 'm2'}`}
                    className="text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1"
                  >
                    <span>فيديو اللقاء</span>
                    <ChevronLeft className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: LEAGUE STANDINGS TABLE */}
      {activeTab === 'standings' && (
        <div className="p-5 rounded-2xl bg-[#111827]/90 border border-slate-800 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Table className="w-5 h-5 text-emerald-400" />
                <span>جدول الترتيب الرسمي للكرة المصرية (الموسم الحالي 2026/2027)</span>
              </h3>
              <p className="text-xs text-slate-400">
                محدث لحظياً وفقاً لنتائج المباريات الحية والمسجلة
              </p>
            </div>

            {/* League Switcher for All 4 Tiers */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={standingsLeague === 'premier' ? 'default' : 'outline'}
                onClick={() => setStandingsLeague('premier')}
                className={`text-xs h-8 font-bold ${
                  standingsLeague === 'premier' ? 'bg-emerald-500 text-slate-950 shadow' : 'border-slate-700 text-slate-300'
                }`}
              >
                الدوري الممتاز (دوري نايل)
              </Button>

              <Button
                size="sm"
                variant={standingsLeague === 'pro' ? 'default' : 'outline'}
                onClick={() => setStandingsLeague('pro')}
                className={`text-xs h-8 font-bold ${
                  standingsLeague === 'pro' ? 'bg-cyan-500 text-slate-950 shadow' : 'border-slate-700 text-slate-300'
                }`}
              >
                دوري المحترفين (القسم الثاني أ)
              </Button>

              <Button
                size="sm"
                variant={standingsLeague === 'second_b' ? 'default' : 'outline'}
                onClick={() => setStandingsLeague('second_b')}
                className={`text-xs h-8 font-bold ${
                  standingsLeague === 'second_b' ? 'bg-amber-500 text-slate-950 shadow' : 'border-slate-700 text-slate-300'
                }`}
              >
                القسم الثاني (ب) بحري والصعيد
              </Button>

              <Button
                size="sm"
                variant={standingsLeague === 'third_div' ? 'default' : 'outline'}
                onClick={() => setStandingsLeague('third_div')}
                className={`text-xs h-8 font-bold ${
                  standingsLeague === 'third_div' ? 'bg-purple-500 text-white shadow' : 'border-slate-700 text-slate-300'
                }`}
              >
                القسم الثالث ومراكز الشباب
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3 text-center">المركز</th>
                  <th className="py-3 px-4">النادي</th>
                  <th className="py-3 px-3 text-center">لعب</th>
                  <th className="py-3 px-3 text-center">فاز</th>
                  <th className="py-3 px-3 text-center">تعادل</th>
                  <th className="py-3 px-3 text-center">خسر</th>
                  <th className="py-3 px-3 text-center hidden md:table-cell">له</th>
                  <th className="py-3 px-3 text-center hidden md:table-cell">عليه</th>
                  <th className="py-3 px-3 text-center">الفارق</th>
                  <th className="py-3 px-4 text-center font-bold text-emerald-400">النقاط</th>
                  <th className="py-3 px-4 text-center hidden lg:table-cell">آخر 5 مباريات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                {(
                  standingsLeague === 'premier' ? premierStandings :
                  standingsLeague === 'pro' ? proStandings :
                  standingsLeague === 'second_b' ? secondBStandings :
                  thirdDivStandings
                ).map((team) => (
                  <tr 
                    key={team.rank}
                    className="hover:bg-slate-800/40 transition"
                  >
                    <td className="py-2.5 px-3 text-center">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-bold font-mono text-[11px] ${
                        team.rank <= 3 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
                        team.rank >= 15 ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {team.rank}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-bold text-white text-sm">
                      {team.teamNameAr}
                    </td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-300">{team.played}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-300">{team.won}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-300">{team.drawn}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-300">{team.lost}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-400 hidden md:table-cell">{team.goalsFor}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-400 hidden md:table-cell">{team.goalsAgainst}</td>
                    <td className="py-2.5 px-3 text-center font-mono text-slate-300">
                      {team.goalDifference > 0 ? `+${team.goalDifference}` : team.goalDifference}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono font-black text-emerald-400 text-sm bg-emerald-500/5">
                      {team.points}
                    </td>
                    <td className="py-2.5 px-4 text-center hidden lg:table-cell">
                      <div className="flex items-center justify-center gap-1">
                        {team.form.map((res, i) => (
                          <span 
                            key={i} 
                            className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center ${
                              res === 'W' ? 'bg-emerald-500 text-black' :
                              res === 'D' ? 'bg-slate-600 text-white' :
                              'bg-red-500 text-white'
                            }`}
                          >
                            {res}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: VIDEO ASSETS VAULT */}
      {activeTab === 'videos' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {matches.map((m) => (
            <div 
              key={m.id}
              className="p-5 rounded-2xl bg-[#111827]/80 border border-slate-800 hover:border-emerald-500/50 transition duration-200 space-y-4 shadow-xl flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                    {m.date}
                  </span>
                  <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-300">
                    {m.leagueName}
                  </Badge>
                </div>

                {/* Score Banner */}
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <div className="text-right flex-1">
                    <span className="font-bold text-white text-sm block">{m.homeTeamNameAr}</span>
                    <span className="text-[10px] text-slate-400">صاحب الأرض</span>
                  </div>

                  <div className="px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono font-black text-lg mx-3">
                    {m.homeScore} - {m.awayScore}
                  </div>

                  <div className="text-left flex-1">
                    <span className="font-bold text-white text-sm block">{m.awayTeamNameAr}</span>
                    <span className="text-[10px] text-slate-400">الضيف</span>
                  </div>
                </div>

                {/* Video Specs Banner */}
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <Video className="w-3.5 h-3.5" />
                    <span className="font-semibold text-[11px]">فيديو HD متاح</span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400 font-mono text-[11px]">
                    <Clock className="w-3 h-3 text-cyan-400" />
                    <span>{m.durationSeconds} ثانية</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span className="text-emerald-400 font-medium">{m.clipsCount} لقطة مقطوعة ومعتمدة</span>
                  <span className="text-cyan-400 font-mono text-[11px] bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                    {m.cameraType === 'broadcast' ? 'بث تلفزيوني' : 'زاوية واسعة'}
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewMatch(m)}
                  className="flex-1 bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300 text-xs gap-1.5 font-semibold"
                >
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  <span>معاينة الفيديو</span>
                </Button>

                <Link 
                  href={`/studio?matchId=${m.id}`}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition shadow-lg shadow-emerald-500/10"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>فتح بالاستوديو</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video Modal Preview */}
      <Dialog open={!!previewMatch} onOpenChange={(open) => !open && setPreviewMatch(null)}>
        <DialogContent className="max-w-3xl bg-slate-950 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center justify-between">
              <span>
                معاينة فيديو المباراة: {previewMatch?.homeTeamNameAr} ضد {previewMatch?.awayTeamNameAr}
              </span>
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs font-mono mr-4">
                {previewMatch?.leagueName}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          {previewMatch && (
            <div className="space-y-4 pt-2">
              <div className="relative aspect-video rounded-xl bg-black border border-slate-800 overflow-hidden shadow-2xl">
                <video
                  src={previewMatch.videoUrl}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>تاريخ اللقاء: {previewMatch.date} • الدقة: 1080p HD</span>
                <Link
                  href={`/studio?matchId=${previewMatch.id}`}
                  className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-3 py-1.5 rounded-lg text-xs transition"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>فتح كامل في الاستوديو للتحليل التكتيكي</span>
                </Link>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
