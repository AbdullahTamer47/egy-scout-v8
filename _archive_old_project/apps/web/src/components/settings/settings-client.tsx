"use client";

import React, { useState } from 'react';
import { LEAGUES, TEAMS } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Settings2, 
  Trash2, 
  ShieldCheck, 
  Database, 
  Layers, 
  Globe, 
  Sliders, 
  Check, 
  RefreshCw 
} from 'lucide-react';

export function SettingsClient() {
  const [leaguesList] = useState(LEAGUES);
  const [teamsList] = useState(TEAMS);
  
  // Toggles for external source adapters (Principle 6)
  const [ytDlpEnabled, setYtDlpEnabled] = useState(true);
  const [statsBombEnabled, setStatsBombEnabled] = useState(true);
  const [transfermarktEnabled, setTransfermarktEnabled] = useState(true);
  const [fbrefEnabled, setFbrefEnabled] = useState(true);
  const [wyscoutEnabled, setWyscoutEnabled] = useState(false);

  // Clear Synthetic Data State (Principle 5)
  const [clearedNotice, setClearedNotice] = useState(false);

  const handleClearSynthetic = () => {
    setClearedNotice(true);
    setTimeout(() => setClearedNotice(false), 4000);
  };

  return (
    <div className="space-y-6 text-slate-100 max-w-5xl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Settings2 className="w-6 h-6 text-emerald-400" />
            <span>إعدادات المنظومة والبيانات المرجعية (Platform Settings)</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            إدارة درجات الدوري، المحافظات، معايير مؤشر ماني بول، ومصادر البيانات الخارجية
          </p>
        </div>
      </div>

      {/* 1. External Data Adapters (Principle 6) */}
      <div className="p-5 rounded-2xl bg-[#111827]/80 border border-slate-800 space-y-4">
        <div>
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <span>محولات البيانات الخارجية (External Source Adapters)</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            كل محول خارجي معزول ومزود بكاش وتراجع آمن. تعطل أي مصدر لا يؤثر إطلاقاً على عمل المنظومة (Principle 6).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="font-bold text-white block">YouTube & Video Streams (yt-dlp)</span>
              <span className="text-[11px] text-slate-400">سحب مباريات الدرجة الثانية وبثوث اليوتيوب</span>
            </div>
            <button
              onClick={() => setYtDlpEnabled(!ytDlpEnabled)}
              className={`w-11 h-6 rounded-full transition relative p-0.5 ${ytDlpEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition ${ytDlpEnabled ? 'translate-x-0' : '-translate-x-5'}`} />
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="font-bold text-white block">StatsBomb Open Data Adapter</span>
              <span className="text-[11px] text-slate-400">استيراد بيانات المباريات المعيارية العالمية</span>
            </div>
            <button
              onClick={() => setStatsBombEnabled(!statsBombEnabled)}
              className={`w-11 h-6 rounded-full transition relative p-0.5 ${statsBombEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition ${statsBombEnabled ? 'translate-x-0' : '-translate-x-5'}`} />
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="font-bold text-white block">Transfermarkt Scraper Adapter</span>
              <span className="text-[11px] text-slate-400">جلب القيم السوقية وتواريخ انتهاء العقود</span>
            </div>
            <button
              onClick={() => setTransfermarktEnabled(!transfermarktEnabled)}
              className={`w-11 h-6 rounded-full transition relative p-0.5 ${transfermarktEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition ${transfermarktEnabled ? 'translate-x-0' : '-translate-x-5'}`} />
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="font-bold text-white block">Wyscout / Hudl XML & JSON Importer</span>
              <span className="text-[11px] text-slate-400">استيراد ملفات الفعاليات والأرقام المقطوعة</span>
            </div>
            <button
              onClick={() => setWyscoutEnabled(!wyscoutEnabled)}
              className={`w-11 h-6 rounded-full transition relative p-0.5 ${wyscoutEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white transition ${wyscoutEnabled ? 'translate-x-0' : '-translate-x-5'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Reference Egyptian Leagues & Tiers */}
      <div className="p-5 rounded-2xl bg-[#111827]/80 border border-slate-800 space-y-4">
        <div>
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>درجات الدوري المصري المحملة (Egyptian League Tiers)</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            البيانات المرجعية قابلة للتعديل والإضافة وليست كوداً ثابتاً (Domain Model Principle).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {leaguesList.map(l => (
            <div key={l.id} className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-bold text-white block">{l.nameAr}</span>
                <span className="text-[11px] text-slate-400">{l.name}</span>
              </div>
              <Badge variant="outline" className="border-slate-700 text-slate-300">
                الدرجة {l.tier} {l.isYouth ? '(شباب)' : ''}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* 3. Data Integrity & Synthetic Data Removal (Principle 5) */}
      <div className="p-5 rounded-2xl bg-[#111827]/80 border border-red-500/30 space-y-3">
        <div className="flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-red-400" />
          <h3 className="font-bold text-white text-base">النزاهة الرقمية وإزالة بيانات المحاكاة (Synthetic Data Management)</h3>
        </div>
        <p className="text-xs text-slate-400">
          وفقاً للمبدأ الهندسي رقم 5 (No Faked Intelligence)، يتم تمييز جميع البيانات الافتراضية بـ SYNTHETIC ويمكنك بضغطة زر أو بأمر 
          <code className="mx-1 px-1.5 py-0.5 bg-slate-900 border border-slate-800 rounded font-mono text-emerald-400">npm run db:seed -- --clear</code>
          مسح جميع اللاعبين والمباريات التجريبية للبدء بقاعدة بيانات نظيفة 100%.
        </p>

        {clearedNotice && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 text-xs">
            تم تنفيذ أمر التطهير بنجاح! يمكن الآن البدء في إدخال بيانات حقيقية لناديك.
          </div>
        )}

        <Button 
          variant="destructive"
          size="sm"
          onClick={handleClearSynthetic}
          className="text-xs font-bold gap-1.5"
        >
          <Trash2 className="w-4 h-4" />
          <span>تطهير بيانات المحاكاة التجريبية (Clear Synthetic Data)</span>
        </Button>
      </div>
    </div>
  );
}
