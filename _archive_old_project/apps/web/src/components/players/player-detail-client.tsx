"use client";

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Player, Evaluation, store } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  ArrowRight, 
  Sparkles, 
  ShieldCheck, 
  Phone, 
  User, 
  MapPin, 
  Activity, 
  DollarSign, 
  FileText, 
  Video, 
  CheckCircle2, 
  AlertTriangle,
  Play,
  Pause,
  Printer,
  PlusCircle,
  Clock,
  Shirt,
  Banknote,
  Building,
  Target,
  ExternalLink
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer
} from 'recharts';

interface PlayerDetailClientProps {
  player: Player;
  evaluations: Evaluation[];
}

export function PlayerDetailClient({ player, evaluations: initialEvals }: PlayerDetailClientProps) {
  const [evaluations, setEvaluations] = useState<Evaluation[]>(initialEvals);
  const [isAddEvalOpen, setIsAddEvalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dna' | 'evals' | 'clips'>('dna');
  
  // Real Video Player State for Player Profile
  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [spotlightCoords, setSpotlightCoords] = useState<{ x: number; y: number } | null>(null);
  const [showSpotlight, setShowSpotlight] = useState(true);

  // New Stand Evaluation Form State
  const [evalRatingPace, setEvalRatingPace] = useState(8);
  const [evalRatingPassing, setEvalRatingPassing] = useState(8);
  const [evalRatingTackling, setEvalRatingTackling] = useState(7);
  const [evalRatingPositioning, setEvalRatingPositioning] = useState(8);
  const [evalPotential, setEvalPotential] = useState(9);
  const [evalReadiness, setEvalReadiness] = useState<'ready_now'|'one_year'|'two_plus_years'>('ready_now');
  const [evalRecommendation, setEvalRecommendation] = useState<'sign'|'monitor'|'pass'>('sign');
  const [evalNotes, setEvalNotes] = useState('');

  const activeClip = player.clips[activeClipIndex] || player.clips[0];

  useEffect(() => {
    if (activeClip && activeClip.spotlightCoords) {
      setSpotlightCoords(activeClip.spotlightCoords);
      setShowSpotlight(true);
    }
  }, [activeClipIndex, activeClip]);

  const handleTogglePlay = () => {
    if (!videoRef.current) return;
    if (isVideoPlaying) {
      videoRef.current.pause();
      setIsVideoPlaying(false);
    } else {
      videoRef.current.play().then(() => setIsVideoPlaying(true)).catch(() => {});
    }
  };

  const handleSelectClip = (idx: number) => {
    setActiveClipIndex(idx);
    setIsVideoPlaying(true);
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.load();
        videoRef.current.play().catch(() => {});
      }
    }, 50);
  };

  // Radar Data from player's top archetype
  const radarData = player.topArchetype.radarData.map(d => ({
    attribute: d.labelAr,
    player: d.player,
    benchmark: d.benchmark
  }));

  // Handle Add Evaluation
  const handleAddEvaluation = (e: React.FormEvent) => {
    e.preventDefault();
    const overall = Number(((evalRatingPace + evalRatingPassing + evalRatingTackling + evalRatingPositioning) / 4).toFixed(1));
    
    const newEval = store.addEvaluation({
      playerId: player.id,
      scoutId: 'scout_current',
      scoutName: 'كابتن حسام البدري (المدير الفني)',
      evaluationDate: new Date().toISOString().split('T')[0],
      positionGroup: (player.positionPrimary === 'ST' ? 'ST' : player.positionPrimary === 'CB' ? 'CB' : 'AM_W') as any,
      ratings: {
        pace: evalRatingPace,
        passing: evalRatingPassing,
        tackling: evalRatingTackling,
        positioning: evalRatingPositioning
      },
      ratingsOverall: overall,
      potential: evalPotential,
      currentAbility: Math.round(overall),
      readiness: evalReadiness,
      recommendation: evalRecommendation,
      strengths: 'ملاحظة مباشرة من المدرجات: استجابة تكتيكية ممتازة ورؤية عالية للمساحات.',
      weaknesses: 'يحتاج لعمل بدني إضافي لتحمل الاحتكاكات القوية.',
      personalityNotes: 'تركيز عالي وانضباط تكتيكي.',
      report: evalNotes || 'تقييم فني مباشر من مدرجات الملعب.',
      isSynthetic: false
    });

    setEvaluations([newEval, ...evaluations]);
    setIsAddEvalOpen(false);
  };

  return (
    <div className="space-y-6 text-slate-100">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <Link 
            href="/players" 
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500/50 text-slate-400 hover:text-white transition"
          >
            <ArrowRight className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-emerald-400 font-black text-lg bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                #{player.jerseyNumber}
              </span>
              <h1 className="text-2xl font-black text-white">{player.nameAr}</h1>
              <span className="text-xs text-slate-400 font-mono">({player.nameEn})</span>
              <Badge variant="outline" className="border-cyan-500/40 text-cyan-400 bg-cyan-500/10 text-xs">
                {player.ageCategory}
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              النادي الحالي: <strong className="text-slate-200">{player.teamNameAr}</strong> (الدرجة {player.leagueTier}) • مركز {player.positionPrimary} • {player.age} سنة • محافظة {player.governorate} ({player.cityDistrict})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Print/Export Dossier */}
          <Link 
            href={`/reports?playerId=${player.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
          >
            <Printer className="w-3.5 h-3.5 text-emerald-400" />
            <span>طباعة التقرير الفني (Dossier)</span>
          </Link>

          {/* Quick Stand Evaluation */}
          <Dialog open={isAddEvalOpen} onOpenChange={setIsAddEvalOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs gap-1.5">
                <PlusCircle className="w-4 h-4" />
                <span>تقييم من المدرجات (Live Stand Eval)</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#111827] border-slate-800 text-white max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-emerald-400 text-right">
                  استمارة تقييم الكشاف الميداني (من المدرجات)
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddEvaluation} className="space-y-4 pt-2 text-right">
                <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
                  تقييم ميداني مباشر للاعب <strong className="text-white">{player.nameAr}</strong> (#{player.jerseyNumber}).
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">السرعة والرشاقة (1-10)</label>
                    <Input 
                      type="number" min="1" max="10" 
                      value={evalRatingPace} 
                      onChange={e => setEvalRatingPace(Number(e.target.value))}
                      className="bg-slate-900 border-slate-700 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">دقة التمرير وصناعة اللعب (1-10)</label>
                    <Input 
                      type="number" min="1" max="10" 
                      value={evalRatingPassing} 
                      onChange={e => setEvalRatingPassing(Number(e.target.value))}
                      className="bg-slate-900 border-slate-700 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">الافتكاك والضغط (1-10)</label>
                    <Input 
                      type="number" min="1" max="10" 
                      value={evalRatingTackling} 
                      onChange={e => setEvalRatingTackling(Number(e.target.value))}
                      className="bg-slate-900 border-slate-700 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">التمركز والوعي التكتيكي (1-10)</label>
                    <Input 
                      type="number" min="1" max="10" 
                      value={evalRatingPositioning} 
                      onChange={e => setEvalRatingPositioning(Number(e.target.value))}
                      className="bg-slate-900 border-slate-700 text-center"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">سقف الإمكانات (Potential)</label>
                    <Input 
                      type="number" min="1" max="10" 
                      value={evalPotential} 
                      onChange={e => setEvalPotential(Number(e.target.value))}
                      className="bg-slate-900 border-slate-700 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">الجاهزية</label>
                    <select
                      value={evalReadiness}
                      onChange={e => setEvalReadiness(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-2 text-white"
                    >
                      <option value="ready_now">جاهز فوراً</option>
                      <option value="one_year">خلال موسم</option>
                      <option value="two_plus_years">خلال سنتين+</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">التوصية</label>
                    <select
                      value={evalRecommendation}
                      onChange={e => setEvalRecommendation(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-2 text-white"
                    >
                      <option value="sign">التعاقد فوراً</option>
                      <option value="monitor">استمرار المتابعة</option>
                      <option value="pass">صرف النظر</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">تقرير ومشاهدات الكشاف الميداني</label>
                  <textarea
                    rows={3}
                    value={evalNotes}
                    onChange={e => setEvalNotes(e.target.value)}
                    placeholder="ملاحظات فنية، حركة اللاعب بدون كرة، التعامل مع ضغط المنافس..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-md p-2.5 text-xs text-white"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={() => setIsAddEvalOpen(false)}
                    className="text-xs text-slate-400"
                  >
                    إلغاء
                  </Button>
                  <Button 
                    type="submit" 
                    className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs"
                  >
                    حفظ التقييم
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Main Grid: Player Bio & Metrics Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Col: Granular Bio & Contract Details */}
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-[#111827]/80 border border-slate-800 space-y-4 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-emerald-950 to-slate-800 border-2 border-emerald-500/50 flex flex-col items-center justify-center shadow-xl">
                <span className="text-2xl font-black text-emerald-400">#{player.jerseyNumber}</span>
                <span className="text-[9px] text-slate-400 font-mono">{player.positionPrimary}</span>
              </div>
              <div>
                <h2 className="text-lg font-black text-white">{player.nameAr}</h2>
                <p className="text-xs text-slate-400">{player.teamNameAr}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="outline" className={`text-[10px] font-bold ${
                    player.leagueTier === 1 ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' :
                    player.leagueTier === 2 ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' :
                    player.leagueTier === 3 ? 'border-cyan-500/40 text-cyan-300 bg-cyan-500/10' :
                    'border-purple-500/40 text-purple-300 bg-purple-500/10'
                  }`}>
                    {player.leagueTier === 1 ? 'الدوري الممتاز (نايل)' :
                     player.leagueTier === 2 ? 'دوري المحترفين' :
                     player.leagueTier === 3 ? 'القسم الثاني ب' : 'القسم الثالث'}
                  </Badge>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[10px]">
                    {player.ageCategory}
                  </Badge>
                  <span className="text-[10px] text-slate-400">{player.preferredFoot === 'left' ? 'قدم يسرى' : 'قدم يمنى'}</span>
                </div>
              </div>
            </div>

            {/* Granular Real Financials and Origin */}
            <div className="divide-y divide-slate-800 text-xs pt-1">
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                  <span>الراتب الشهري الفعلي:</span>
                </span>
                <span className="font-bold text-emerald-400 text-sm font-mono">
                  {player.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م / شهرياً
                </span>
              </div>

              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
                  <span>تكلفة الشراء / الشرط الجزائي:</span>
                </span>
                <span className="font-bold text-slate-200 font-mono">
                  {(player.contractClauseEgp / 1000).toLocaleString('ar-EG')} ألف ج.م
                </span>
              </div>

              <div className="py-2 flex justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-slate-400" />
                  <span>أكاديمية / نادي النشأة:</span>
                </span>
                <span className="text-slate-300 font-medium text-right max-w-[170px] truncate">{player.academyOrigin}</span>
              </div>

              <div className="py-2 flex justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span>المحافظة والمركز:</span>
                </span>
                <span className="text-white">{player.governorate} ({player.cityDistrict})</span>
              </div>

              <div className="py-2 flex justify-between">
                <span className="text-slate-400">تاريخ الميلاد والسن:</span>
                <span className="font-mono text-white">{player.dateOfBirth} ({player.age} سنة)</span>
              </div>

              <div className="py-2 flex justify-between">
                <span className="text-slate-400">الطول والوزن:</span>
                <span className="text-white">{player.height} سم • {player.weight} كجم</span>
              </div>

              <div className="py-2 flex justify-between">
                <span className="text-slate-400">حالة العقد:</span>
                <span className="text-amber-400 font-semibold">{player.contractStatus === 'expiring' ? 'ينتهي بنهاية الموسم' : 'عقد سارٍ'}</span>
              </div>
            </div>

            {/* Performance Match Numbers */}
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-[11px] font-bold text-slate-300 block">أرقام الموسم الحالي ({player.minutesPlayed} دقيقة):</span>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-1.5 bg-slate-950 rounded">
                  <span className="text-[10px] text-slate-500 block">أهداف</span>
                  <span className="font-bold text-emerald-400">{player.detailedStats.goals}</span>
                </div>
                <div className="p-1.5 bg-slate-950 rounded">
                  <span className="text-[10px] text-slate-500 block">صناعة</span>
                  <span className="font-bold text-cyan-400">{player.detailedStats.assists}</span>
                </div>
                <div className="p-1.5 bg-slate-950 rounded">
                  <span className="text-[10px] text-slate-500 block">مراوغات</span>
                  <span className="font-bold text-purple-400">{player.detailedStats.dribbleSuccessPct}%</span>
                </div>
                <div className="p-1.5 bg-slate-950 rounded">
                  <span className="text-[10px] text-slate-500 block">هوائي</span>
                  <span className="font-bold text-amber-400">{player.detailedStats.aerialDuelsWonPct}%</span>
                </div>
              </div>
            </div>

            {/* Sensitive Minors' Data Banner */}
            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-400">
                <ShieldCheck className="w-4 h-4" />
                <span>بيانات التواصل والوكيل (سرية)</span>
              </div>
              <div className="text-[11px] text-slate-300 space-y-1">
                {player.guardianName && (
                  <p className="flex justify-between">
                    <span className="text-slate-400">ولي الأمر:</span>
                    <span>{player.guardianName} ({player.guardianPhone})</span>
                  </p>
                )}
                <p className="flex justify-between">
                  <span className="text-slate-400">الوكيل المعتمد:</span>
                  <span>{player.agentName || 'كابتن نبيل أبوزيد'} ({player.agentPhone || '+20 122 888 0200'})</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right 2 Cols: Tabs & Live Video Clips */}
        <div className="lg:col-span-2 space-y-4">
          {/* F8 Moneyball Undervalued Index Card */}
          <div className="p-5 rounded-2xl bg-gradient-to-br from-[#111827] to-[#0d1522] border border-emerald-500/40 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold">
                    Moneyball Undervalued Index (MUI)
                  </span>
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300 text-[10px]">
                    {player.mui.confidence} CONFIDENCE
                  </Badge>
                </div>
                <h3 className="text-lg font-black text-white mt-0.5">
                  مؤشر القيمة الفنية مقابل تكلفة الراتب والانتقال
                </h3>
              </div>

              <div className="text-center px-4 py-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/40">
                <span className="text-[10px] text-slate-400 block font-bold">نقاط MUI</span>
                <span className="text-3xl font-black text-emerald-400 font-mono">
                  {player.mui.score}
                </span>
                <span className="text-[10px] text-emerald-400 block font-semibold">من 100</span>
              </div>
            </div>

            {/* Components Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <span className="text-slate-500 block text-[11px]">الأداء المقاس</span>
                <span className="font-bold text-white text-base">{player.mui.components.performanceScore}</span>
                <span className="text-[10px] text-slate-400 block">انكماش بايزي للدقائق</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <span className="text-slate-500 block text-[11px]">معامل صغر السن</span>
                <span className="font-bold text-cyan-400 text-base">x{player.mui.components.ageFactor}</span>
                <span className="text-[10px] text-slate-400 block">ميزة الأعمار الواعدة</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <span className="text-slate-500 block text-[11px]">معامل الضغط</span>
                <span className="font-bold text-purple-400 text-base">x{player.mui.components.pressureFactor}</span>
                <span className="text-[10px] text-slate-400 block">الفاعلية تحت الضغط</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                <span className="text-slate-500 block text-[11px]">مستوى التكلفة</span>
                <span className="font-bold text-amber-400 text-base">شريحة {player.mui.components.costBand}</span>
                <span className="text-[10px] text-slate-400 block">راتب {player.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-800 gap-4 text-xs font-bold">
            <button
              onClick={() => setActiveTab('dna')}
              className={`pb-2.5 transition flex items-center gap-1.5 ${
                activeTab === 'dna' ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>الجينات التكتيكية المقارنة (Tactical DNA)</span>
            </button>

            <button
              onClick={() => setActiveTab('clips')}
              className={`pb-2.5 transition flex items-center gap-1.5 ${
                activeTab === 'clips' ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Video className="w-4 h-4" />
              <span>فيديوهات ولقطات اللاعب الحية ({player.clips.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('evals')}
              className={`pb-2.5 transition flex items-center gap-1.5 ${
                activeTab === 'evals' ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>تقارير الكشافين المعتمدة ({evaluations.length})</span>
            </button>
          </div>

          {/* Tab 1: Tactical DNA (F9 with Explicit Reference Disclaimer) */}
          {activeTab === 'dna' && (
            <div className="p-5 rounded-2xl bg-[#111827]/80 border border-slate-800 space-y-4">
              <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-xs text-cyan-300">
                <strong>تنبيه فني للمدير الفني والكشافين:</strong> مطابقة الجينات التكتيكية هنا تُستخدم كـ <em>"مرجع تشبيهي لحركة اللاعب وأسلوب لعبه على سبيل المثال التوضيحي"</em> لتقريب طريقة تحركه في المساحات وصناعته للفرص وليس مطابقة حرفية في القيمة السوقية المطلقة.
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-base font-bold text-white">
                    النمط التكتيكي الأقرب لأسلوب اللاعب
                  </h4>
                  <p className="text-xs text-slate-400">
                    يشبه في أسلوب لعبه وطريقة تحركه: <strong className="text-cyan-400">{player.topArchetype.archetypeNameAr}</strong> (على سبيل المثال: {player.topArchetype.benchmarkPlayer})
                  </p>
                </div>
                <div className="px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/40 text-cyan-400 text-center">
                  <span className="text-[10px] block font-bold">نسبة تشابه الأسلوب</span>
                  <span className="text-xl font-black font-mono">{player.topArchetype.similarityPercentage}%</span>
                </div>
              </div>

              {/* Radar Chart */}
              <div className="h-64 w-full bg-slate-900/60 rounded-xl p-2 border border-slate-800">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                    <PolarGrid stroke="#334155" />
                    <PolarAngleAxis dataKey="attribute" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#475569" />
                    <Radar 
                      name="اللاعب المحلي" 
                      dataKey="player" 
                      stroke="#10B981" 
                      fill="#10B981" 
                      fillOpacity={0.45} 
                    />
                    <Radar 
                      name="المرجع التكتيكي المقارن" 
                      dataKey="benchmark" 
                      stroke="#06B6D4" 
                      fill="#06B6D4" 
                      fillOpacity={0.2} 
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Tab 2: REAL LIVE VIDEO HIGHLIGHTS FOR PLAYER (Working Video & Spotlight) */}
          {activeTab === 'clips' && (
            <div className="p-5 rounded-2xl bg-[#111827]/80 border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-base font-bold text-white flex items-center gap-2">
                    <Video className="w-5 h-5 text-emerald-400" />
                    <span>مشغل لقطات وفنيات اللاعب المقطوعة (HD Video Clips)</span>
                  </h4>
                  <p className="text-xs text-slate-400">
                    لقطة الدقيقة {activeClip.minute}: <strong className="text-emerald-400">{activeClip.title}</strong>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-xs">
                    بث مباشر عالي الدقة 1080p
                  </Badge>
                  <Badge variant="outline" className="border-cyan-500/40 text-cyan-400 text-xs font-mono">
                    {player.clips.length} لقطات متوفرة
                  </Badge>
                </div>
              </div>

              {/* Working HTML5 Video Player with Interactive Spotlight */}
              <div 
                className="relative aspect-video rounded-xl bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shadow-2xl cursor-crosshair group"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(5, Math.min(95, ((e.clientX - rect.left) / rect.width) * 100));
                  const y = Math.max(5, Math.min(95, ((e.clientY - rect.top) / rect.height) * 100));
                  setSpotlightCoords({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) });
                  setShowSpotlight(true);
                }}
              >
                <video
                  key={activeClip.id}
                  ref={videoRef}
                  src={activeClip.videoUrl}
                  controls
                  playsInline
                  autoPlay
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onError={() => {
                    if (videoRef.current) {
                      videoRef.current.src = '/videos/match-broadcast.mp4';
                      videoRef.current.load();
                      videoRef.current.play().catch(() => {});
                    }
                  }}
                  className="w-full h-full object-cover"
                />

                {/* Real Dynamic Spotlight Overlay on Target Player */}
                {showSpotlight && spotlightCoords && (
                  <div 
                    className="absolute pointer-events-none flex flex-col items-center z-10 transition-all duration-150"
                    style={{
                      left: `${spotlightCoords.x}%`,
                      top: `${spotlightCoords.y}%`,
                      transform: 'translate(-50%, -50%)'
                    }}
                  >
                    <div className="w-24 h-12 rounded-[100%] border-2 border-emerald-400 bg-emerald-500/25 shadow-[0_0_30px_rgba(16,185,129,0.9)] animate-pulse" />
                    <span className="text-[10px] bg-emerald-500 text-slate-950 font-black px-2 py-0.5 rounded shadow mt-1 whitespace-nowrap">
                      {player.nameAr} (#{player.jerseyNumber})
                    </span>
                  </div>
                )}

                {/* Clickable Hint Overlay */}
                <div className="absolute top-3 left-3 pointer-events-none z-10 bg-slate-950/75 backdrop-blur-sm border border-slate-800 px-2.5 py-1 rounded-md text-[11px] text-slate-300">
                  💡 انقر داخل الفيديو لنقل الدائرة الضوئية
                </div>
              </div>

              {/* Tactical Speed Controls & Playback Assistant */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/70 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">التحليل البطيء:</span>
                  {[0.5, 0.75, 1.0, 1.25].map(rate => (
                    <button
                      key={rate}
                      onClick={() => {
                        if (videoRef.current) videoRef.current.playbackRate = rate;
                      }}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-emerald-500 hover:text-black text-slate-300 font-mono text-[11px] transition"
                    >
                      {rate}x
                    </button>
                  ))}
                  
                  {/* Spotlight Toggle */}
                  <button
                    onClick={() => setShowSpotlight(!showSpotlight)}
                    className={`px-2.5 py-1 rounded text-xs font-semibold border transition ml-2 ${
                      showSpotlight 
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                  >
                    {showSpotlight ? 'إخفاء الدائرة 👁️' : 'إظهار الدائرة 🎯'}
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <Link
                    href={`/studio?matchId=${activeClip.videoUrl.includes('dribble') ? 'm3' : activeClip.videoUrl.includes('action') ? 'm2' : 'm1'}&playerId=${player.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold transition shadow"
                  >
                    <Target className="w-3.5 h-3.5" />
                    <span>تحليل اللقطة في الاستوديو</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>

                  <button
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = 0;
                        videoRef.current.play().catch(() => {});
                      }
                    }}
                    className="text-emerald-400 hover:text-emerald-300 font-semibold text-xs flex items-center gap-1 transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>إعادة التشغيل</span>
                  </button>
                </div>
              </div>

              {/* Clickable Playlist to Switch Clips */}
              <div className="space-y-2 pt-1">
                <span className="text-xs font-bold text-slate-300 block">اختر اللقطة للمشاهدة الفورية:</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {player.clips.map((clip, idx) => (
                    <button
                      key={clip.id}
                      onClick={() => handleSelectClip(idx)}
                      className={`p-3 rounded-xl border text-right transition cursor-pointer ${
                        activeClipIndex === idx 
                          ? 'bg-slate-800 border-emerald-500 text-white shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500' 
                          : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs truncate block">{clip.typeAr}</span>
                        <Play className={`w-3.5 h-3.5 ${activeClipIndex === idx ? 'text-emerald-400 fill-current' : 'text-slate-500'}`} />
                      </div>
                      <p className="text-[10px] text-slate-400 leading-tight">{clip.description}</p>
                      <span className="text-[10px] text-emerald-400 font-mono block mt-1">الدقيقة {clip.minute} ({clip.durationSeconds} ثانية)</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Scouting Evaluations */}
          {activeTab === 'evals' && (
            <div className="space-y-4">
              {evaluations.map((evalItem) => (
                <div key={evalItem.id} className="p-5 rounded-2xl bg-[#111827]/80 border border-slate-800 space-y-3 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white text-sm">{evalItem.scoutName}</h4>
                      <span className="text-[11px] text-slate-400">{evalItem.evaluationDate}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs font-mono">
                        تقييم {evalItem.ratingsOverall} / 10
                      </Badge>
                      <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/40 text-xs font-mono">
                        سقف الإمكانات: {evalItem.potential} / 10
                      </Badge>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                    {evalItem.report}
                  </p>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500 block mb-0.5">أبرز المميزات:</span>
                      <span className="text-emerald-400 font-medium">{evalItem.strengths}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-0.5">نقاط التطوير:</span>
                      <span className="text-amber-400 font-medium">{evalItem.weaknesses}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
