"use client";
import React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Search, Bell, Globe, Trophy, Film, Radio } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter } from 'next/navigation';

export function Header() {
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [searchTerm, setSearchTerm] = React.useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      router.push(`/players?q=${encodeURIComponent(searchTerm.trim())}`);
    }
  };
  
  const toggleLanguage = () => {
    const newLocale = document.documentElement.lang === 'en' ? 'ar' : 'en';
    document.cookie = `locale=${newLocale}; path=/; max-age=31536000`;
    router.refresh();
  };

  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-10 gap-4">
      <form onSubmit={handleSearch} className="flex-1 max-w-xl flex items-center">
        <div className="relative w-full">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ابحث عن لاعب، نادي، مركز شباب، أو موهبة ناشئة..." 
            className="pr-9 bg-card-hover/50 border-slate-800 text-xs text-right focus-visible:ring-1 focus-visible:ring-emerald-500 text-white placeholder:text-slate-500" 
          />
        </div>
      </form>

      <div className="flex items-center gap-2.5">
        <Link href="/matches">
          <Button variant="outline" size="sm" className="hidden sm:flex items-center gap-1.5 h-8 text-xs border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 font-bold">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
            <Radio className="w-3.5 h-3.5" />
            <span>بث الدوري المصري</span>
          </Button>
        </Link>

        <Link href="/studio">
          <Button variant="outline" size="sm" className="hidden md:flex items-center gap-1.5 h-8 text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 font-bold">
            <Film className="w-3.5 h-3.5" />
            <span>استوديو التحليل</span>
          </Button>
        </Link>

        <Button variant="ghost" size="icon" onClick={toggleLanguage} title="Toggle Language" className="h-8 w-8 text-slate-300">
          <Globe className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-300">
          <Bell className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
