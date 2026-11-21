import React from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { store } from '@/lib/store';
import { MatchesClient } from '@/components/matches/matches-client';

export default function MatchesPage() {
  const matches = store.getMatches();

  return (
    <AppLayout>
      <MatchesClient initialMatches={matches} />
    </AppLayout>
  );
}
