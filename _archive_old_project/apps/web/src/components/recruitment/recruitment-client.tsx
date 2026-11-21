"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { RecruitmentNeed, store, Player } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Target, 
  Plus, 
  ChevronRight, 
  ChevronLeft, 
  Sparkles, 
  ArrowUpRight, 
  CheckCircle2, 
  XCircle,
  Clock,
  DollarSign,
  UserCheck
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface RecruitmentClientProps {
  initialNeeds: RecruitmentNeed[];
  allPlayers: Player[];
}

const STAGES: Array<{ key: RecruitmentNeed['candidates'][0]['stage']; labelAr: string; color: string }> = [
  { key: 'spotted', labelAr: 'مرصود (Spotted)', color: '#94a3b8' },
  { key: 'monitoring', labelAr: 'تحت المتابعة (Monitoring)', color: '#06b6d4' },
  { key: 'contacted', labelAr: 'تم التواصل (Contacted)', color: '#f59e0b' },
  { key: 'trial', labelAr: 'فترة معايشة (Trial)', color: '#a855f7' },
  { key: 'negotiating', labelAr: 'جلسات تفاوض (Negotiating)', color: '#10b981' },
  { key: 'signed', labelAr: 'تم التعاقد (Signed)', color: '#22c55e' }
];

export function RecruitmentClient({ initialNeeds, allPlayers }: RecruitmentClientProps) {
  const [needs, setNeeds] = useState<RecruitmentNeed[]>(initialNeeds);
  const [selectedNeedId, setSelectedNeedId] = useState<string>(initialNeeds[0]?.id || '');
  
  // Dialog state for new need
  const [isAddNeedOpen, setIsAddNeedOpen] = useState(false);
  const [newTitleAr, setNewTitleAr] = useState('');
  const [newPosGroup, setNewPosGroup] = useState('CB');
  const [newFoot, setNewFoot] = useState<'left'|'right'|'both'>('left');
  const [newMaxAge, setNewMaxAge] = useState(21);
  const [newBudget, setNewBudget] = useState(1500000);

  const currentNeed = needs.find(n => n.id === selectedNeedId) || needs[0];

  // Move candidate between Kanban stages
  const handleMoveCandidate = (playerId: string, direction: 'forward' | 'backward') => {
    if (!currentNeed) return;
    
    const cand = currentNeed.candidates.find(c => c.playerId === playerId);
    if (!cand) return;

    const currentStageIdx = STAGES.findIndex(s => s.key === cand.stage);
    let nextStageIdx = currentStageIdx;

    if (direction === 'forward' && currentStageIdx < STAGES.length - 1) {
      nextStageIdx = currentStageIdx + 1;
    } else if (direction === 'backward' && currentStageIdx > 0) {
      nextStageIdx = currentStageIdx - 1;
    }

    if (nextStageIdx !== currentStageIdx) {
      const nextStage = STAGES[nextStageIdx].key;
      store.updateCandidateStage(currentNeed.id, playerId, nextStage);
      
      // Update local state
      setNeeds(needs.map(n => {
        if (n.id !== currentNeed.id) return n;
        return {
          ...n,
          candidates: n.candidates.map(c => c.playerId === playerId ? { ...c, stage: nextStage } : c)
        };
      }));
    }
  };

  // Add new recruitment need
  const handleCreateNeed = (e: React.FormEvent) => {
    e.preventDefault();
    const created = store.addRecruitmentNeed({
      title: newTitleAr || 'New Target Need',
      titleAr: newTitleAr || 'احتياج فني جديد',
      positionGroup: newPosGroup,
      targetFoot: newFoot,
      maxAge: Number(newMaxAge),
      minTier: 1,
      maxTier: 3,
      maxMonthlySalaryEgp: Number(newBudget) || 20000,
      maxTransferFeeEgp: (Number(newBudget) || 20000) * 24
    });

    setNeeds([...needs, created]);
    setSelectedNeedId(created.id);
    setIsAddNeedOpen(false);
    setNewTitleAr('');
  };

  return (
    <div className="space-y-6 text-slate-100">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Target className="w-6 h-6 text-emerald-400" />
            <span>لوحة التعاقدات واحتياجات الفريق (Recruitment Board)</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            تحديد احتياجات النادي، ترتيب المرشحين آلياً حسب نسبة الملاءمة، وإدارة مسار التفاوض (Kanban)
          </p>
        </div>

        {/* Add Need Dialog */}
        <Dialog open={isAddNeedOpen} onOpenChange={setIsAddNeedOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs gap-1.5">
              <Plus className="w-4 h-4" />
              <span>تحديد احتياج جديد للفريق</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#111827] border-slate-800 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-emerald-400 text-right">
                تحديد احتياج فني جديد للموسم
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateNeed} className="space-y-4 pt-2 text-right">
              <div>
                <label className="block text-xs text-slate-400 mb-1">وصف الاحتياج</label>
                <Input
                  value={newTitleAr}
                  onChange={e => setNewTitleAr(e.target.value)}
                  placeholder="مثال: قلب دفاع أعسر تحت 21 سنة بسعر منخفض"
                  required
                  className="bg-slate-900 border-slate-700 text-right text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">المركز المطلوب</label>
                  <select
                    value={newPosGroup}
                    onChange={e => setNewPosGroup(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white"
                  >
                    <option value="CB">قلب دفاع (CB)</option>
                    <option value="FB">ظهير (FB)</option>
                    <option value="DM_CM">وسط ارتكاز (DM/CM)</option>
                    <option value="AM_W">جناح وصانع ألعاب (AM/W)</option>
                    <option value="ST">مهاجم صريح (ST)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">القدم المطلوبة</label>
                  <select
                    value={newFoot}
                    onChange={e => setNewFoot(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white"
                  >
                    <option value="left">يسرى فقط</option>
                    <option value="right">يمنى فقط</option>
                    <option value="both">كلتاهما</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">أقصى سن (سنة)</label>
                  <Input
                    type="number"
                    min="16"
                    max="30"
                    value={newMaxAge}
                    onChange={e => setNewMaxAge(Number(e.target.value))}
                    className="bg-slate-900 border-slate-700 text-center text-sm"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">سقف الميزانية (ج.م)</label>
                  <Input
                    type="number"
                    step="100000"
                    value={newBudget}
                    onChange={e => setNewBudget(Number(e.target.value))}
                    className="bg-slate-900 border-slate-700 text-left text-sm"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => setIsAddNeedOpen(false)}
                  className="text-xs text-slate-400"
                >
                  إلغاء
                </Button>
                <Button 
                  type="submit" 
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs"
                >
                  حفظ الاحتياج
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Needs Selector Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {needs.map(need => (
          <button
            key={need.id}
            onClick={() => setSelectedNeedId(need.id)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition border ${
              need.id === currentNeed?.id 
                ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-lg shadow-emerald-500/10' 
                : 'bg-[#111827]/80 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {need.titleAr} ({need.candidates.length} مرشحين)
          </button>
        ))}
      </div>

      {/* Selected Need Details Strip */}
      {currentNeed && (
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-slate-500 block text-[10px]">المركز والقدم</span>
              <span className="font-bold text-white">
                {currentNeed.positionGroup} • {currentNeed.targetFoot === 'left' ? 'قدم يسرى' : 'قدم يمنى'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">الحد الأقصى للسن</span>
              <span className="font-bold text-cyan-400">تحت {currentNeed.maxAge} سنة</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">سقف الراتب الشهري</span>
              <span className="font-bold text-emerald-400">{(currentNeed.maxMonthlySalaryEgp).toLocaleString('ar-EG')} ج.م/ش</span>
            </div>
          </div>

          <div className="text-[11px] text-slate-400">
            يتم احتساب درجة التوافق (Fit Score) بناءً على مؤشر MUI ومطابقة الجينات التكتيكية والتكلفة
          </div>
        </div>
      )}

      {/* Kanban Board Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto min-h-[500px]">
        {STAGES.map((stage) => {
          const stageCandidates = currentNeed?.candidates.filter(c => c.stage === stage.key) || [];

          return (
            <div 
              key={stage.key}
              className="bg-[#111827]/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col space-y-3"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-bold text-slate-200" style={{ color: stage.color }}>
                  {stage.labelAr.split(' ')[0]}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400">
                  {stageCandidates.length}
                </span>
              </div>

              {/* Candidate Cards in this Stage */}
              <div className="space-y-2.5 flex-1">
                {stageCandidates.map((candidate) => {
                  const player = allPlayers.find(p => p.id === candidate.playerId);
                  if (!player) return null;

                  return (
                    <div 
                      key={candidate.playerId}
                      className="p-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-2 shadow"
                    >
                      <div className="flex items-center justify-between">
                        <Link 
                          href={`/players/${player.id}`}
                          className="font-bold text-white text-xs hover:text-emerald-400 transition"
                        >
                          {player.nameAr}
                        </Link>
                        <span className="text-[10px] font-mono font-black text-emerald-400 bg-emerald-500/10 px-1 rounded">
                          {candidate.fitScore}%
                        </span>
                      </div>

                      <div className="text-[10px] text-slate-400 flex justify-between">
                        <span>{player.teamNameAr}</span>
                        <span>{player.age} سنة</span>
                      </div>

                      <p className="text-[10px] text-slate-300 leading-tight bg-slate-950 p-2 rounded border border-slate-850">
                        {candidate.fitReason}
                      </p>

                      {/* Move Stage Controls */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-xs">
                        <button
                          onClick={() => handleMoveCandidate(candidate.playerId, 'backward')}
                          title="العودة للمرحلة السابقة"
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>

                        <span className="text-[9px] text-emerald-400 font-semibold font-mono">
                          {player.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م/ش
                        </span>

                        <button
                          onClick={() => handleMoveCandidate(candidate.playerId, 'forward')}
                          title="التقدم للمرحلة التالية"
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {stageCandidates.length === 0 && (
                  <div className="h-28 border border-dashed border-slate-800 rounded-xl flex items-center justify-center text-[11px] text-slate-600 text-center p-2">
                    لا يوجد مرشحون حالياً
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
