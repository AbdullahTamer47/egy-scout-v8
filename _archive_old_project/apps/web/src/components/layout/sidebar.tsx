"use client";
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutDashboard, Users, Trophy, Film, Target, FileText, Settings2, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { signOut } from 'next-auth/react';

const navItems = [
  { href: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard },
  { href: '/players', labelKey: 'players', icon: Users },
  { href: '/matches', labelKey: 'matches', icon: Trophy },
  { href: '/studio', labelKey: 'studio', icon: Film },
  { href: '/recruitment', labelKey: 'recruitment', icon: Target },
  { href: '/reports', labelKey: 'reports', icon: FileText },
  { href: '/settings', labelKey: 'settings', icon: Settings2 },
];

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <aside className="w-64 h-screen border-e border-border bg-card/50 backdrop-blur-sm flex flex-col transition-all">
      <div className="p-5 border-b border-border/50">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-slate-950 font-black text-sm flex items-center justify-center shadow-lg shadow-emerald-500/20">
            SZ
          </div>
          <div>
            <h2 className="text-base font-black text-white tracking-wide leading-none">ScoutZero | مُدَرِّب</h2>
            <p className="text-[10px] text-emerald-400 font-semibold mt-1">منظومة الاستكشاف للكرة المصرية</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-4 py-3 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <span className={cn(
                "flex items-center justify-between px-3 py-2 rounded-xl transition-all text-xs font-semibold",
                isActive ? "bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.15)]" : "text-slate-400 hover:bg-card-hover hover:text-white"
              )}>
                <div className="flex items-center gap-3">
                  <Icon size={18} />
                  <span>{t(item.labelKey)}</span>
                </div>
                {item.href === '/matches' && (
                  <span className="flex items-center gap-1 text-[10px] bg-red-500/20 text-red-400 border border-red-500/40 px-1.5 py-0.5 rounded-full font-mono font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                    مباشر
                  </span>
                )}
                {item.href === '/studio' && (
                  <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-bold">
                    HD
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border mt-auto">
        <div className="flex items-center gap-3 mb-3 px-2 py-1.5 rounded-xl bg-slate-900/60 border border-slate-800">
          <Avatar className="h-8 w-8 border border-emerald-500/40">
            <AvatarFallback className="bg-emerald-950 text-emerald-400 font-bold text-xs">حسام</AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold text-white truncate">كابتن / أحمد حسام</span>
            <span className="text-[10px] text-emerald-400 truncate">رئيس قطاع الكشافين الفني</span>
          </div>
        </div>
        <Button variant="ghost" className="w-full justify-start gap-2 text-slate-400 hover:text-red-400 text-xs hover:bg-red-500/10" onClick={() => signOut()}>
          <LogOut size={16} />
          {t('logout')}
        </Button>
      </div>
    </aside>
  );
}
