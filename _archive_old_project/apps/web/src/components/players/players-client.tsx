"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Player, store } from '@/lib/store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Search, 
  Filter, 
  Plus, 
  Download, 
  Upload, 
  ExternalLink, 
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Scale,
  Shirt,
  Banknote,
  MapPin
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface PlayersClientProps {
  initialPlayers: Player[];
}

export function PlayersClient({ initialPlayers }: PlayersClientProps) {
  const [playersList, setPlayersList] = useState<Player[]>(initialPlayers);
  const [search, setSearch] = useState('');
  const [selectedPosition, setSelectedPosition] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [selectedFoot, setSelectedFoot] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedPipeline, setSelectedPipeline] = useState<string>('all');
  const [minMui, setMinMui] = useState<number>(0);
  const [maxSalary, setMaxSalary] = useState<number>(100000);
  const [selectedGovernorate, setSelectedGovernorate] = useState<string>('all');

  // New Player Dialog State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newPlayerNameAr, setNewPlayerNameAr] = useState('');
  const [newPlayerNameEn, setNewPlayerNameEn] = useState('');
  const [newPlayerJersey, setNewPlayerJersey] = useState(10);
  const [newPlayerPos, setNewPlayerPos] = useState('CM');
  const [newPlayerAge, setNewPlayerAge] = useState(17);
  const [newPlayerFoot, setNewPlayerFoot] = useState<'left'|'right'|'both'>('right');
  const [newPlayerSalary, setNewPlayerSalary] = useState(12000);
  const [newPlayerGov, setNewPlayerGov] = useState('الغربية');
  const [newPlayerDistrict, setNewPlayerDistrict] = useState('المحلة الكبرى');
  const [newPlayerOrigin, setNewPlayerOrigin] = useState('مركز شباب محلي');
  const [newPlayerTier, setNewPlayerTier] = useState<number>(3);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('q');
      if (q) setSearch(q);
    }
  }, []);

  // Filter logic
  const filteredPlayers = useMemo(() => {
    return playersList.filter(p => {
      // Search
      if (search) {
        const q = search.toLowerCase();
        const matches = p.nameAr.includes(q) || 
                        p.nameEn.toLowerCase().includes(q) || 
                        p.teamNameAr.includes(q) || 
                        p.academyOrigin.includes(q) ||
                        p.cityDistrict.includes(q);
        if (!matches) return false;
      }

      // Position
      if (selectedPosition !== 'all' && p.positionPrimary !== selectedPosition) {
        return false;
      }

      // Tier
      if (selectedTier !== 'all' && p.leagueTier !== Number(selectedTier)) {
        return false;
      }

      // Foot
      if (selectedFoot !== 'all' && p.preferredFoot !== selectedFoot && p.preferredFoot !== 'both') {
        return false;
      }

      // Age Category (Ashbal U15, Nashien U17, Shabab U19, Olympy U21)
      if (selectedCategory !== 'all' && p.ageCategory !== selectedCategory) {
        return false;
      }

      // Pipeline
      if (selectedPipeline !== 'all' && p.pipelineStatus !== selectedPipeline) {
        return false;
      }

      // Min MUI
      if (minMui > 0 && p.mui.score < minMui) {
        return false;
      }

      // Max Monthly Salary
      if (maxSalary < 100000 && p.monthlySalaryEgp > maxSalary) {
        return false;
      }

      // Governorate
      if (selectedGovernorate !== 'all' && p.governorate !== selectedGovernorate) {
        return false;
      }

      return true;
    });
  }, [
    playersList, search, selectedPosition, selectedTier, 
    selectedFoot, selectedCategory, selectedPipeline, 
    minMui, maxSalary, selectedGovernorate
  ]);

  // Handle Add Player
  const handleCreatePlayer = (e: React.FormEvent) => {
    e.preventDefault();
    const created = store.addPlayer({
      nameAr: newPlayerNameAr || 'لاعب جديد',
      nameEn: newPlayerNameEn || 'New Talent',
      jerseyNumber: Number(newPlayerJersey),
      positionPrimary: newPlayerPos,
      age: Number(newPlayerAge),
      dateOfBirth: `${2026 - Number(newPlayerAge)}-01-01`,
      preferredFoot: newPlayerFoot,
      monthlySalaryEgp: Number(newPlayerSalary),
      governorate: newPlayerGov,
      cityDistrict: newPlayerDistrict,
      academyOrigin: newPlayerOrigin,
      leagueTier: newPlayerTier,
      ratingsOverall: 7.5,
      minutesPlayed: 600
    });

    setPlayersList([created, ...playersList]);
    setIsAddOpen(false);
    // Reset form
    setNewPlayerNameAr('');
    setNewPlayerNameEn('');
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = ['ID', 'Jersey', 'NameAr', 'Age', 'Category', 'Position', 'Foot', 'Team', 'Tier', 'Governorate', 'District', 'Origin', 'MonthlySalaryEGP', 'MUI_Score'];
    const rows = filteredPlayers.map(p => [
      p.id,
      p.jerseyNumber,
      `"${p.nameAr}"`,
      p.age,
      `"${p.ageCategory}"`,
      p.positionPrimary,
      p.preferredFoot,
      `"${p.teamNameAr}"`,
      p.leagueTier,
      `"${p.governorate}"`,
      `"${p.cityDistrict}"`,
      `"${p.academyOrigin}"`,
      p.monthlySalaryEgp,
      p.mui.score
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `scoutzero_egypt_players_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <span>قاعدة بيانات المواهب والأشبال (Player Scouting Database)</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
              {filteredPlayers.length} لاعباً متوفراً
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            استكشاف شامل يبدأ من سن 15 عاماً (الأشبال) وحتى الدرجة الأولى والمحترفين ودوري الأقاليم مع الرواتب الفعلية بالجنيه
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Download CSV */}
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportCSV}
            className="border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-xs text-slate-300 gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span>تصدير CSV</span>
          </Button>

          {/* Add Player Manual */}
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold gap-1.5 text-xs">
                <UserPlus className="w-4 h-4" />
                <span>إضافة لاعب جديد (يدوياً)</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#111827] border-slate-800 text-white max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-emerald-400 text-right">
                  إضافة لاعب أو موهبة ناشئة للمنظومة
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreatePlayer} className="space-y-3 pt-2 text-right">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">الاسم بالعربية</label>
                    <Input 
                      value={newPlayerNameAr} 
                      onChange={e => setNewPlayerNameAr(e.target.value)} 
                      placeholder="مثال: يوسف عمرو الدالي"
                      required
                      className="bg-slate-900 border-slate-700 text-right text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">رقم القميص (#)</label>
                    <Input 
                      type="number"
                      value={newPlayerJersey} 
                      onChange={e => setNewPlayerJersey(Number(e.target.value))} 
                      className="bg-slate-900 border-slate-700 text-center text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">المركز</label>
                    <select 
                      value={newPlayerPos}
                      onChange={e => setNewPlayerPos(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white"
                    >
                      <option value="GK">حارس مرمى (GK)</option>
                      <option value="CB">قلب دفاع (CB)</option>
                      <option value="LB">ظهير أيسر (LB)</option>
                      <option value="RB">ظهير أيمن (RB)</option>
                      <option value="CDM">وسط دفاعي (CDM)</option>
                      <option value="CM">وسط ارتكاز (CM)</option>
                      <option value="CAM">صانع ألعاب (CAM)</option>
                      <option value="LW">جناح أيسر (LW)</option>
                      <option value="RW">جناح أيمن (RW)</option>
                      <option value="ST">رأس حربة (ST)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">السن (يبدأ من 15)</label>
                    <Input 
                      type="number" 
                      min="14" 
                      max="35" 
                      value={newPlayerAge} 
                      onChange={e => setNewPlayerAge(Number(e.target.value))}
                      className="bg-slate-900 border-slate-700 text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">القدم</label>
                    <select 
                      value={newPlayerFoot}
                      onChange={e => setNewPlayerFoot(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white"
                    >
                      <option value="right">اليمنى</option>
                      <option value="left">اليسرى</option>
                      <option value="both">كلتاهما</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">الدرجة في الدوري</label>
                    <select
                      value={newPlayerTier}
                      onChange={e => setNewPlayerTier(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white"
                    >
                      <option value={1}>الدوري الممتاز (Tier 1)</option>
                      <option value={2}>دوري المحترفين (Tier 2)</option>
                      <option value={3}>القسم الثاني ب (Tier 3)</option>
                      <option value={4}>القسم الثالث ومراكز الشباب (Tier 4)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">الراتب الشهري الفعلي (ج.م)</label>
                    <Input 
                      type="number" 
                      step="1000"
                      value={newPlayerSalary} 
                      onChange={e => setNewPlayerSalary(Number(e.target.value))}
                      className="bg-slate-900 border-slate-700 text-left"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">أكاديمية المنشأ / مركز الشباب</label>
                    <Input 
                      value={newPlayerOrigin} 
                      onChange={e => setNewPlayerOrigin(e.target.value)} 
                      placeholder="مثال: مركز شباب بيلا"
                      className="bg-slate-900 border-slate-700 text-right"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-400 mb-1">المحافظة</label>
                    <select 
                      value={newPlayerGov}
                      onChange={e => setNewPlayerGov(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md p-2 text-white"
                    >
                      <option value="الغربية">الغربية</option>
                      <option value="الدقهلية">الدقهلية</option>
                      <option value="كفر الشيخ">كفر الشيخ</option>
                      <option value="البحيرة">البحيرة</option>
                      <option value="القاهرة">القاهرة</option>
                      <option value="الجيزة">الجيزة</option>
                      <option value="الإسكندرية">الإسكندرية</option>
                      <option value="السويس">السويس</option>
                      <option value="بني سويف">بني سويف</option>
                      <option value="الفيوم">الفيوم</option>
                      <option value="المنيا">المنيا</option>
                      <option value="أسوان">أسوان</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">المركز / القرية</label>
                    <Input 
                      value={newPlayerDistrict} 
                      onChange={e => setNewPlayerDistrict(e.target.value)}
                      placeholder="مثال: دسوق / دكرنس"
                      className="bg-slate-900 border-slate-700 text-right"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={() => setIsAddOpen(false)}
                    className="text-xs text-slate-400"
                  >
                    إلغاء
                  </Button>
                  <Button 
                    type="submit" 
                    className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs"
                  >
                    حفظ اللاعب
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Advanced Filter Strip */}
      <div className="p-4 rounded-xl bg-[#111827]/80 border border-slate-800 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ابحث بالاسم، النادي، مركز الشباب..."
              className="pr-9 bg-slate-900 border-slate-700 text-xs text-right text-white"
            />
          </div>

          {/* Category Filter (includes Ashbal U15) */}
          <div>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-xs text-slate-200"
            >
              <option value="all">كل الفئات السنية (جميع الأعمار)</option>
              <option value="أشبال (U15)">الأشبال والبراعم (تحت 15 سنة - U15)</option>
              <option value="ناشئين (U17)">الناشئين (تحت 17 سنة - U17)</option>
              <option value="شباب (U19)">الشباب (تحت 19 سنة - U19)</option>
              <option value="أولمبي (U21)">المنتخب الأولمبي (تحت 21 سنة - U21)</option>
              <option value="فريق أول">الفريق الأول (Senior)</option>
            </select>
          </div>

          {/* Position Filter */}
          <div>
            <select
              value={selectedPosition}
              onChange={e => setSelectedPosition(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-xs text-slate-200"
            >
              <option value="all">كل المراكز</option>
              <option value="GK">حراسة المرمى (GK)</option>
              <option value="CB">قلب دفاع (CB)</option>
              <option value="LB">ظهير أيسر (LB)</option>
              <option value="RB">ظهير أيمن (RB)</option>
              <option value="CDM">وسط مدافع (CDM)</option>
              <option value="CM">وسط ارتكاز (CM)</option>
              <option value="CAM">صانع لعب (CAM)</option>
              <option value="LW">جناح أيسر (LW)</option>
              <option value="RW">جناح أيمن (RW)</option>
              <option value="ST">مهاجم صريح (ST)</option>
            </select>
          </div>

          {/* Division / Tier Filter */}
          <div>
            <select
              value={selectedTier}
              onChange={e => setSelectedTier(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-xs text-slate-200"
            >
              <option value="all">جميع درجات الدوري المصري (الهرم كاملاً)</option>
              <option value="1">الدوري المصري الممتاز (دوري نايل - القسم 1)</option>
              <option value="2">دوري المحترفين (دوري القسم الثاني أ)</option>
              <option value="3">دوري القسم الثاني (ب) - بحري والقناة والصعيد</option>
              <option value="4">دوري القسم الثالث (مراكز الشباب والأندية الإقليمية)</option>
            </select>
          </div>
        </div>

        {/* Second Row of Filters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t border-slate-800/60 text-xs">
          {/* Foot */}
          <div>
            <select
              value={selectedFoot}
              onChange={e => setSelectedFoot(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-slate-200"
            >
              <option value="all">القدم: الكل</option>
              <option value="left">القدم اليسرى فقط</option>
              <option value="right">القدم اليمنى فقط</option>
              <option value="both">كلتا القدمين</option>
            </select>
          </div>

          {/* Pipeline Status */}
          <div>
            <select
              value={selectedPipeline}
              onChange={e => setSelectedPipeline(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-slate-200"
            >
              <option value="all">حالة الرصد: الكل</option>
              <option value="spotted">مرصود (Spotted)</option>
              <option value="monitoring">تحت المتابعة (Monitoring)</option>
              <option value="contacted">تم التواصل (Contacted)</option>
              <option value="trial">فترة معايشة (Trial)</option>
              <option value="negotiating">تفاوض (Negotiating)</option>
              <option value="signed">تم التعاقد (Signed)</option>
            </select>
          </div>

          {/* Governorate */}
          <div>
            <select
              value={selectedGovernorate}
              onChange={e => setSelectedGovernorate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-slate-200"
            >
              <option value="all">كل محافظات مصر</option>
              <option value="الغربية">الغربية (المحلة وطنطا وزفتى)</option>
              <option value="الدقهلية">الدقهلية (المنصورة ودكرنس وبلقاس)</option>
              <option value="كفر الشيخ">كفر الشيخ (دسوق وبيلا)</option>
              <option value="البحيرة">البحيرة (دمنهور وكفر الدوار)</option>
              <option value="القاهرة">القاهرة</option>
              <option value="الجيزة">الجيزة</option>
              <option value="الإسكندرية">الإسكندرية</option>
              <option value="السويس">السويس</option>
              <option value="بني سويف">بني سويف (الواسطى والفشن)</option>
              <option value="الفيوم">الفيوم (إطسا)</option>
              <option value="المنيا">المنيا (ملوي ومغاغة)</option>
              <option value="أسوان">أسوان (كوم أمبو)</option>
            </select>
          </div>

          {/* Min MUI Filter */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-md px-3 py-1">
            <span className="text-[11px] text-slate-400 whitespace-nowrap">الحد الأدنى لـ MUI:</span>
            <input 
              type="range" 
              min="0" 
              max="90" 
              step="5"
              value={minMui} 
              onChange={e => setMinMui(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <span className="text-xs font-mono font-bold text-emerald-400">{minMui}</span>
          </div>
        </div>
      </div>

      {/* Players Data Table */}
      <div className="rounded-xl border border-slate-800 bg-[#111827]/70 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4"># الرقم والاسم</th>
                <th className="py-3 px-4">الفئة والسن</th>
                <th className="py-3 px-4">المركز</th>
                <th className="py-3 px-4">النادي والنشأة</th>
                <th className="py-3 px-4">القدم</th>
                <th className="py-3 px-4">المحافظة والمركز</th>
                <th className="py-3 px-4">الراتب الشهري</th>
                <th className="py-3 px-4 text-center">مؤشر MUI</th>
                <th className="py-3 px-4">النمط التكتيكي</th>
                <th className="py-3 px-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredPlayers.slice(0, 50).map((player) => (
                <tr 
                  key={player.id} 
                  className="hover:bg-slate-800/40 transition duration-150 group"
                >
                  {/* Jersey & Name */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-black text-xs px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                        #{player.jerseyNumber}
                      </span>
                      <div>
                        <Link 
                          href={`/players/${player.id}`} 
                          className="font-bold text-white group-hover:text-emerald-400 transition block text-sm"
                        >
                          {player.nameAr}
                        </Link>
                        <span className="text-[10px] text-slate-500 font-mono">{player.nameEn}</span>
                      </div>
                    </div>
                  </td>

                  {/* Age & Category */}
                  <td className="py-3.5 px-4">
                    <span className="text-white font-bold block">{player.age} سنة</span>
                    <span className="text-[10px] text-cyan-400 font-semibold">{player.ageCategory}</span>
                  </td>

                  {/* Position */}
                  <td className="py-3.5 px-4">
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {player.positionPrimary}
                    </span>
                  </td>

                  {/* Team & Academy Origin */}
                  <td className="py-3.5 px-4">
                    <span className="text-slate-200 font-medium block">{player.teamNameAr}</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                        player.leagueTier === 1 ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                        player.leagueTier === 2 ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
                        player.leagueTier === 3 ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30' :
                        'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                      }`}>
                        {player.leagueTier === 1 ? 'الممتاز' :
                         player.leagueTier === 2 ? 'المحترفين' :
                         player.leagueTier === 3 ? 'القسم 2 ب' : 'القسم 3'}
                      </span>
                      <span className="text-[10px] text-slate-400 truncate max-w-[120px] block">
                        نشأة: {player.academyOrigin}
                      </span>
                    </div>
                  </td>

                  {/* Foot */}
                  <td className="py-3.5 px-4 text-slate-300">
                    {player.preferredFoot === 'left' ? 'يسرى' : player.preferredFoot === 'right' ? 'يمنى' : 'كلتاهما'}
                  </td>

                  {/* Governorate & Village */}
                  <td className="py-3.5 px-4 text-slate-400">
                    <span className="text-slate-200 block">{player.governorate}</span>
                    <span className="text-[10px] text-slate-500">{player.cityDistrict}</span>
                  </td>

                  {/* Real Monthly Salary in EGP */}
                  <td className="py-3.5 px-4 font-mono font-bold text-emerald-400">
                    {player.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م
                  </td>

                  {/* MUI Score */}
                  <td className="py-3.5 px-4 text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="font-mono font-black text-sm text-emerald-400">
                        {player.mui.score}
                      </span>
                      <span className="text-[9px] px-1 rounded text-emerald-300 bg-emerald-950/60">
                        {player.mui.confidence}
                      </span>
                    </div>
                  </td>

                  {/* Tactical Archetype Match */}
                  <td className="py-3.5 px-4">
                    <span className="text-cyan-400 font-semibold block text-xs">
                      {player.topArchetype.similarityPercentage}%
                    </span>
                    <span className="text-[10px] text-slate-400 truncate max-w-[130px] block">
                      {player.topArchetype.archetypeNameAr.split(' ')[0]} (كمرجع)
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Link 
                        href={`/players/${player.id}`}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600 hover:text-slate-950 text-slate-300 transition"
                        title="الملف الفني والفيديوهات"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>

                      <Link
                        href={`/players/compare?p1=${player.id}`}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-cyan-600 hover:text-slate-950 text-slate-300 transition"
                        title="مقارنة مع لاعب آخر"
                      >
                        <Scale className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredPlayers.length > 50 && (
          <div className="py-3 px-4 bg-slate-900/80 text-center text-xs text-slate-400 border-t border-slate-800">
            يتم عرض أول 50 لاعباً من أصل {filteredPlayers.length}
          </div>
        )}
      </div>
    </div>
  );
}
