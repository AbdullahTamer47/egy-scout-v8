"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Player } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Scale, 
  ArrowRight, 
  Plus, 
  X, 
  Flame, 
  Award, 
  TrendingUp,
  Activity
} from 'lucide-react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend
} from 'recharts';

interface CompareClientProps {
  allPlayers: Player[];
  initialPlayerIds?: string[];
}

export function CompareClient({ allPlayers, initialPlayerIds }: CompareClientProps) {
  // Up to 4 players compared
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialPlayerIds && initialPlayerIds.length > 0 
      ? initialPlayerIds 
      : [allPlayers[0]?.id || '', allPlayers[1]?.id || '']
  );

  const selectedPlayers = selectedIds
    .map(id => allPlayers.find(p => p.id === id))
    .filter((p): p is Player => p !== undefined);

  // Colors for up to 4 players
  const playerColors = ['#10B981', '#06B6D4', '#A855F7', '#F59E0B'];

  // Construct combined radar data
  const attributes = ['السرعة', 'التمرير', 'المراوغة', 'الافتكاك', 'التمركز', 'إنهاء الهجمات'];
  const radarData = attributes.map((attr, idx) => {
    const item: Record<string, any> = { attribute: attr };
    selectedPlayers.forEach((p, pIdx) => {
      // Mocked or normalized attribute score
      const base = p.ratingsOverall * 10;
      const variations = [idx * 3 % 15, (idx * 5) % 12, (idx * 2) % 18, (idx * 4) % 14];
      item[`player_${pIdx}`] = Math.min(100, Math.max(30, base + variations[pIdx % variations.length]));
    });
    return item;
  });

  const handleAddPlayer = (id: string) => {
    if (selectedIds.length < 4 && !selectedIds.includes(id)) {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleRemovePlayer = (id: string) => {
    if (selectedIds.length > 1) {
      setSelectedIds(selectedIds.filter(item => item !== id));
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <Link 
            href="/players" 
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500/50 text-slate-400 hover:text-white transition"
          >
            <ArrowRight className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-white flex items-center gap-2">
              <Scale className="w-6 h-6 text-emerald-400" />
              <span>مقارنة المواهب التكتيكية (Side-by-Side Comparison)</span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              مقارنة متعددة الأبعاد للرادار التكتيكي ومؤشر ماني بول والقيمة السوقية (حتى 4 لاعبين)
            </p>
          </div>
        </div>

        {/* Player Selector Dropdown */}
        {selectedIds.length < 4 && (
          <div className="flex items-center gap-2">
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleAddPlayer(e.target.value);
                  e.target.value = '';
                }
              }}
              defaultValue=""
              className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 max-w-xs"
            >
              <option value="" disabled>+ أضف لاعباً للمقارنة...</option>
              {allPlayers
                .filter(p => !selectedIds.includes(p.id))
                .slice(0, 30)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nameAr} ({p.positionPrimary} - {p.teamNameAr})
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Side-by-Side Comparison Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {selectedPlayers.map((player, idx) => (
          <div 
            key={player.id}
            className="p-4 rounded-2xl bg-[#111827]/80 border relative space-y-3"
            style={{ borderColor: `${playerColors[idx]}60` }}
          >
            {selectedPlayers.length > 1 && (
              <button 
                onClick={() => handleRemovePlayer(player.id)}
                className="absolute top-3 left-3 p-1 rounded-full bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            <div className="flex items-center gap-3">
              <div 
                className="w-12 h-12 rounded-xl border flex items-center justify-center font-black text-lg text-white"
                style={{ backgroundColor: `${playerColors[idx]}20`, borderColor: playerColors[idx] }}
              >
                {player.nameAr.slice(0, 1)}
              </div>
              <div className="text-right">
                <Link href={`/players/${player.id}`} className="font-bold text-white hover:underline text-sm block">
                  {player.nameAr}
                </Link>
                <span className="text-[11px] text-slate-400">{player.teamNameAr}</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="font-mono font-bold px-2 py-0.5 rounded text-white bg-slate-800">
                {player.positionPrimary}
              </span>
              <span className="text-slate-300">{player.age} سنة</span>
              <span className="text-slate-300 font-semibold">{player.preferredFoot === 'left' ? 'قدم يسرى' : 'قدم يمنى'}</span>
            </div>

            {/* Quick Stat Pill */}
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
              <div className="text-right">
                <span className="text-[10px] text-slate-500 block">مؤشر MUI</span>
                <span className="font-black text-emerald-400 font-mono text-base">{player.mui.score}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 block">الراتب الشهري</span>
                <span className="font-bold text-slate-200">{player.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Multi-Player Radar Overlay */}
      <div className="p-5 rounded-2xl bg-[#111827]/80 border border-slate-800 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>الرادار التكتيكي المشترك (Multi-Player Radar Overlay)</span>
        </h3>

        <div className="h-80 w-full bg-slate-900/60 rounded-xl p-2 border border-slate-800">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
              <PolarGrid stroke="#334155" />
              <PolarAngleAxis dataKey="attribute" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="#475569" />
              {selectedPlayers.map((player, idx) => (
                <Radar
                  key={player.id}
                  name={player.nameAr}
                  dataKey={`player_${idx}`}
                  stroke={playerColors[idx]}
                  fill={playerColors[idx]}
                  fillOpacity={0.25}
                />
              ))}
              <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Comparative Metrics Table */}
      <div className="rounded-2xl border border-slate-800 bg-[#111827]/80 overflow-hidden shadow-xl">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-900/90 text-slate-400 text-[10px] uppercase border-b border-slate-800">
            <tr>
              <th className="py-3 px-4">المعيار الفني والتفاوضي</th>
              {selectedPlayers.map((p, idx) => (
                <th key={p.id} className="py-3 px-4" style={{ color: playerColors[idx] }}>
                  {p.nameAr}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            <tr>
              <td className="py-3 px-4 text-slate-400 font-medium">السن والفئة</td>
              {selectedPlayers.map(p => (
                <td key={p.id} className="py-3 px-4 font-mono font-bold text-white">
                  {p.age} سنة ({p.age <= 17 ? 'U17' : p.age <= 19 ? 'U19' : p.age <= 21 ? 'U21' : 'U23'})
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 text-slate-400 font-medium">الدرجة الحالية للنادي</td>
              {selectedPlayers.map(p => (
                <td key={p.id} className="py-3 px-4">
                  {p.leagueTier === 1 ? 'الدوري الممتاز' : p.leagueTier === 2 ? 'دوري المحترفين' : 'الدرجة الثالثة'}
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 text-slate-400 font-medium">مؤشر ماني بول (MUI)</td>
              {selectedPlayers.map(p => (
                <td key={p.id} className="py-3 px-4 font-black font-mono text-emerald-400 text-sm">
                  {p.mui.score} / 100
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 text-slate-400 font-medium">معامل صغر السن (Age Factor)</td>
              {selectedPlayers.map(p => (
                <td key={p.id} className="py-3 px-4 font-mono font-semibold text-cyan-400">
                  x{p.mui.components.ageFactor}
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 text-slate-400 font-medium">التطابق مع النمط الأوروبي (DNA)</td>
              {selectedPlayers.map(p => (
                <td key={p.id} className="py-3 px-4">
                  <span className="font-bold text-white block">{p.topArchetype.similarityPercentage}%</span>
                  <span className="text-[10px] text-slate-500">{p.topArchetype.benchmarkPlayer}</span>
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 text-slate-400 font-medium">الراتب الشهري الفعلي</td>
              {selectedPlayers.map(p => (
                <td key={p.id} className="py-3 px-4 font-mono font-bold text-slate-200">
                  {p.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م
                </td>
              ))}
            </tr>

            <tr>
              <td className="py-3 px-4 text-slate-400 font-medium">التوصية الكشفية</td>
              {selectedPlayers.map(p => (
                <td key={p.id} className="py-3 px-4">
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">
                    {p.ratingsOverall >= 8 ? 'تعاقد فوري' : 'استمرار الرصد'}
                  </Badge>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
