"use client";

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { Player, store } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  Printer, 
  Download, 
  Sparkles, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle,
  Flame,
  ArrowRight,
  QrCode,
  Video,
  Play,
  Banknote,
  Building,
  MapPin,
  Shirt
} from 'lucide-react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer
} from 'recharts';

interface ReportClientProps {
  players: Player[];
  selectedPlayerId?: string;
}

export function ReportClient({ players, selectedPlayerId: initialId }: ReportClientProps) {
  const [selectedId, setSelectedId] = useState<string>(
    initialId && players.some(p => p.id === initialId) ? initialId : players[0]?.id || ''
  );

  const [activeClipIndex, setActiveClipIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const player = players.find(p => p.id === selectedId) || players[0];
  const activeClip = player.clips[activeClipIndex] || player.clips[0];

  // Radar data
  const radarData = player.topArchetype.radarData.map(d => ({
    attribute: d.labelAr,
    player: d.player,
    benchmark: d.benchmark
  }));

  const handlePrint = () => {
    window.print();
  };

  const handleSelectClip = (idx: number) => {
    setActiveClipIndex(idx);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  };

  return (
    <div className="space-y-6 text-slate-100 print:text-black">
      {/* Action Strip (hidden when printing) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4 print:hidden">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-emerald-400" />
            <span>التقرير الكشفي الفني الشامل (Scouting Dossier & Live Highlights)</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            ملف فني تنفيذي متكامل جاهز للمعاينة الحية والطباعة والتصدير كـ PDF لمجلس إدارة النادي والجهاز الفني
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Select Player Dropdown */}
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white max-w-xs"
          >
            {players.slice(0, 35).map(p => (
              <option key={p.id} value={p.id}>
                #{p.jerseyNumber} {p.nameAr} ({p.positionPrimary} - {p.teamNameAr} - {p.ageCategory})
              </option>
            ))}
          </select>

          {/* Print / Save PDF Button */}
          <Button 
            onClick={handlePrint}
            className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs gap-1.5 shadow-lg shadow-emerald-500/20"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة / تصدير PDF</span>
          </Button>
        </div>
      </div>

      {/* Printable Report Dossier Card */}
      <div className="p-8 rounded-3xl bg-[#111827] border border-slate-800 space-y-6 shadow-2xl print:bg-white print:border-none print:p-0 print:shadow-none print:text-black">
        {/* Dossier Header */}
        <div className="flex items-center justify-between border-b-2 border-emerald-500 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-black tracking-widest text-emerald-400 uppercase">
                ScoutZero • Technical Scouting Dossier
              </span>
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400 print:text-black">
                {player.ageCategory}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-mono font-black text-emerald-400 print:text-black bg-emerald-500/10 print:bg-transparent px-2.5 py-0.5 rounded border border-emerald-500/30 print:border-none">
                #{player.jerseyNumber}
              </span>
              <div>
                <h2 className="text-3xl font-black text-white print:text-black">{player.nameAr}</h2>
                <p className="text-sm text-slate-400 print:text-gray-600 font-mono mt-0.5">
                  {player.nameEn} • {player.teamNameAr} (دوري الدرجة {player.leagueTier})
                </p>
              </div>
            </div>
          </div>

          {/* Moneyball Badge */}
          <div className="text-center px-5 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/40 print:border-black">
            <span className="text-[10px] text-slate-400 block font-bold">مؤشر ماني بول</span>
            <span className="text-4xl font-black text-emerald-400 print:text-black font-mono">
              {player.mui.score}
            </span>
            <span className="text-[10px] text-emerald-300 block font-semibold">MUI SCORE</span>
          </div>
        </div>

        {/* Granular Bio & Real Financials */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-2xl bg-slate-900/80 print:bg-gray-100 border border-slate-800 print:border-gray-300 text-xs">
          <div>
            <span className="text-slate-500 block">المركز والسن</span>
            <span className="font-bold text-white print:text-black text-sm">
              {player.positionPrimary} • {player.age} سنة ({player.dateOfBirth})
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">الراتب الشهري الفعلي</span>
            <span className="font-bold text-emerald-400 print:text-black text-sm font-mono">
              {player.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م / شهر
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">تكلفة الانتقال / الشرط الجزائي</span>
            <span className="font-bold text-cyan-400 print:text-black text-sm font-mono">
              {(player.contractClauseEgp / 1000).toLocaleString('ar-EG')} ألف ج.م
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">أكاديمية المنشأ والمركز</span>
            <span className="font-bold text-white print:text-black text-sm truncate block">
              {player.academyOrigin} ({player.cityDistrict})
            </span>
          </div>
        </div>

        {/* Video Highlights in Dossier (Playable in Web, QR in Print) */}
        <div className="p-5 rounded-2xl bg-slate-900/60 print:bg-gray-50 border border-slate-800 print:border-gray-300 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-white print:text-black text-sm flex items-center gap-2">
              <Video className="w-4 h-4 text-emerald-400 print:text-black" />
              <span>فيديوهات ولقطات فنيات اللاعب المقطوعة</span>
            </h4>
            <span className="text-xs text-slate-400 print:text-gray-600">
              {player.clips.length} لقطات متوفرة وموثقة
            </span>
          </div>

          {/* HTML5 Video Player inside Report */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 relative aspect-video rounded-xl bg-slate-950 overflow-hidden border border-slate-800">
              <video
                ref={videoRef}
                src={activeClip.videoUrl}
                controls
                playsInline
                className="w-full h-full object-cover"
              />
              {activeClip.hasSpotlight && (
                <div 
                  className="absolute pointer-events-none flex flex-col items-center"
                  style={{
                    left: `${activeClip.spotlightCoords.x}%`,
                    top: `${activeClip.spotlightCoords.y}%`,
                    transform: 'translate(-50%, -50%)'
                  }}
                >
                  <div className="w-20 h-10 rounded-[100%] border-2 border-emerald-400 bg-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.8)] animate-pulse" />
                  <span className="text-[9px] bg-emerald-500 text-slate-950 font-black px-1.5 py-0.2 rounded mt-0.5">
                    #{player.jerseyNumber} {player.nameAr}
                  </span>
                </div>
              )}
            </div>

            {/* Clips Playlist in Report */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300 print:text-black block">قائمة اللقطات:</span>
              {player.clips.map((clip, idx) => (
                <button
                  key={clip.id}
                  onClick={() => handleSelectClip(idx)}
                  className={`w-full p-2.5 rounded-xl border text-right transition block ${
                    activeClipIndex === idx 
                      ? 'bg-slate-800 border-emerald-500 text-white' 
                      : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span>{clip.typeAr}</span>
                    <Play className="w-3 h-3 text-emerald-400 fill-current" />
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-0.5">الدقيقة {clip.minute}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tactical DNA Radar & Analysis */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-5 rounded-2xl bg-slate-900/60 print:bg-white border border-slate-800 print:border-gray-300 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-white print:text-black text-sm">
                الرادار التكتيكي ومطابقة الجينات (Tactical DNA)
              </h4>
              <Badge variant="outline" className="border-cyan-500/40 text-cyan-400 print:text-black text-[10px]">
                مرجع تشبيهي للأسلوب فقط
              </Badge>
            </div>

            <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-[11px] text-cyan-200 print:text-gray-700">
              💡 <strong>تنبيه للمدير الفني:</strong> مطابقة الجينات التكتيكية تُستخدم كمرجع تشبيهي لأسلوب التحركات ونمط اللعب فقط (على سبيل المثال: {player.topArchetype.benchmarkPlayer})، ولا تعني المقارنة في القيمة أو المستوى العالمي.
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="attribute" tick={{ fill: '#64748b', fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#475569" />
                  <Radar 
                    name="اللاعب" 
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
            <div className="text-center text-xs text-slate-400 print:text-gray-600">
              تشابه نسبي في طريقة اللعب والتحرك بنسبة <strong className="text-cyan-400 print:text-black">{player.topArchetype.similarityPercentage}%</strong> مع النمط: {player.topArchetype.archetypeNameAr} (على سبيل المثال: {player.topArchetype.benchmarkPlayer})
            </div>
          </div>

          {/* Strengths & Weaknesses Analysis */}
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-900/60 print:bg-gray-50 border border-slate-800 print:border-gray-300 space-y-2">
              <span className="font-bold text-emerald-400 print:text-green-700 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>أبرز المميزات التكتيكية (Verified Strengths):</span>
              </span>
              <ul className="text-xs text-slate-300 print:text-gray-700 space-y-1 list-disc list-inside">
                <li>سرعة التحول الهجومي والتدرج بالكرة تحت الضغط العالي.</li>
                <li>دقة تمرير عمودي متميزة تكسر خطوط المنافس بنسبة نجاح مرتفعة.</li>
                <li>انضباط تكتيكي وشخصية قيادية داخل الملعب في ناديه الأصلي.</li>
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 print:bg-gray-50 border border-slate-800 print:border-gray-300 space-y-2">
              <span className="font-bold text-amber-400 print:text-orange-700 text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>مجالات التطوير المطلوبة (Development Gaps):</span>
              </span>
              <ul className="text-xs text-slate-300 print:text-gray-700 space-y-1 list-disc list-inside">
                <li>تطوير القوة البدنية والكتلة العضلية لتحمل الاحتكاك القوي في الممتاز.</li>
                <li>رفع معدل استخلاص الكرات الهوائية.</li>
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/60 print:bg-gray-50 border border-slate-800 print:border-gray-300 text-xs space-y-1">
              <span className="text-slate-500 block">عينة الدقائق المعتمدة والنزاهة الإحصائية:</span>
              <p className="text-slate-300 print:text-gray-700">
                تم رصد <strong className="text-white print:text-black">{player.minutesPlayed} دقيقة لعب فعلية</strong>. درجة الثقة: <strong className="text-emerald-400 print:text-green-700">{player.mui.confidence}</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Scout Recommendation & Final Verdict */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/40 to-slate-900 print:bg-gray-100 border border-emerald-500/40 print:border-gray-400 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-right">
            <span className="text-[11px] text-emerald-400 print:text-green-800 font-bold uppercase tracking-wider block">
              التوصية الفنية المعتمدة للمدير الفني والإدارة:
            </span>
            <p className="text-base font-black text-white print:text-black">
              التوصية: {player.ratingsOverall >= 8 ? 'التعاقد الفوري (Sign Priority 1)' : 'متابعة ميدانية مكثفة (Priority Monitor)'}
            </p>
            <p className="text-xs text-slate-400 print:text-gray-600">
              الراتب الحالي ({player.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م) والتكلفة في المتناول تماماً ويوفران فرصة استثمارية وفنية ممتازة للنادي.
            </p>
          </div>

          <div className="flex items-center gap-4 border-t md:border-t-0 md:border-r border-slate-800 pt-3 md:pt-0 md:pr-5">
            <div className="text-center">
              <div className="w-14 h-14 bg-white p-1 rounded-lg shadow mx-auto flex items-center justify-center text-slate-900">
                <QrCode className="w-12 h-12" />
              </div>
              <span className="text-[9px] text-slate-400 block mt-1">مسح لمشاهدة اللقطات</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
