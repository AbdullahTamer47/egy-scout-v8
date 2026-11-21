import React, { Suspense } from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { store } from '@/lib/store';
import { StudioClient } from '@/components/studio/studio-client';

export default function StudioPage() {
  const matches = store.getMatches();
  const events = store.getReviewQueue();
  const players = store.getPlayers();

  return (
    <AppLayout>
      <Suspense fallback={<div className="p-12 text-center text-slate-400 font-bold">جارٍ تحميل استوديو الفيديو التكتيكي...</div>}>
        <StudioClient 
          initialMatches={matches}
          initialEvents={events}
          players={players}
        />
      </Suspense>
    </AppLayout>
  );
}
