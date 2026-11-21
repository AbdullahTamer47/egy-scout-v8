"use client";

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Shield, Sparkles, UserCheck, Eye, Activity } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@scoutzero.local');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false
      });

      if (res?.error) {
        setError('بيانات الدخول غير صحيحة، يرجى التأكد من البريد وكلمة المرور');
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError('حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (roleEmail: string) => {
    setEmail(roleEmail);
    setPassword('admin123');
    // Automatically trigger sign-in
    setLoading(true);
    signIn('credentials', {
      email: roleEmail,
      password: 'admin123',
      redirect: false
    }).then((res) => {
      setLoading(false);
      if (res?.error) {
        setError('تعذر تسجيل الدخول');
      } else {
        router.push('/dashboard');
        router.refresh();
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[#0B0F17] p-4 text-slate-100 font-sans">
      {/* Background Tactical Grid lines */}
      <div 
        className="absolute inset-0 opacity-15 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, #10B981 1px, transparent 1px),
            linear-gradient(to bottom, #10B981 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px'
        }}
      />

      {/* Emerald subtle radial glow */}
      <div className="absolute w-[600px] h-[600px] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />

      <Card className="w-full max-w-md relative z-10 bg-[#111827]/90 border border-emerald-500/30 backdrop-blur-xl shadow-2xl rounded-2xl p-6">
        <CardHeader className="text-center pb-6">
          <div className="inline-flex items-center justify-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="text-right">
              <span className="text-xs uppercase tracking-widest text-emerald-400 font-bold block">Internal Engine</span>
              <span className="text-xl font-black text-white">ScoutZero | سكاوت زيرو</span>
            </div>
          </div>
          <CardTitle className="text-lg font-bold text-slate-200">
            منظومة الاستكشاف والذكاء التكتيكي
          </CardTitle>
          <p className="text-xs text-slate-400 mt-1">
            نظام استكشاف المواهب المغمورة وماني بول الدوري المصري
          </p>
        </CardHeader>

        <CardContent className="space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1 text-right">
                البريد الإلكتروني
              </label>
              <Input
                type="email"
                placeholder="name@scoutzero.local"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="bg-[#0B0F17]/80 border-slate-700 focus:border-emerald-500 text-white text-right"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1 text-right">
                كلمة المرور
              </label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="bg-[#0B0F17]/80 border-slate-700 focus:border-emerald-500 text-white text-right"
              />
            </div>

            {error && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs text-right">
                {error}
              </div>
            )}

            <Button 
              type="submit" 
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-2.5 rounded-xl transition duration-200 shadow-lg shadow-emerald-500/20"
            >
              {loading ? 'جارٍ تسجيل الدخول...' : 'دخول المنصة'}
            </Button>
          </form>

          {/* Quick Login Role Shortcuts */}
          <div className="pt-4 border-t border-slate-800">
            <span className="block text-[11px] text-slate-400 font-semibold mb-2 text-right">
              دخول سريع حسب الصلاحيات (تجريبي):
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleQuickLogin('admin@scoutzero.local')}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/60 hover:bg-emerald-950/50 hover:border-emerald-500/40 border border-slate-700 text-slate-200 transition text-right"
              >
                <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="truncate">المدير الفني (Head Coach)</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('scout1@scoutzero.local')}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/60 hover:bg-emerald-950/50 hover:border-emerald-500/40 border border-slate-700 text-slate-200 transition text-right"
              >
                <UserCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="truncate">كشاف (Scout)</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('analyst1@scoutzero.local')}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/60 hover:bg-emerald-950/50 hover:border-emerald-500/40 border border-slate-700 text-slate-200 transition text-right"
              >
                <Activity className="w-4 h-4 text-purple-400 shrink-0" />
                <span className="truncate">محلل بيانات (Analyst)</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickLogin('viewer1@scoutzero.local')}
                className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/60 hover:bg-emerald-950/50 hover:border-emerald-500/40 border border-slate-700 text-slate-200 transition text-right"
              >
                <Eye className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate">متابع (Viewer)</span>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
