import React from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { store } from '@/lib/store';
import { PlayersClient } from '@/components/players/players-client';

export default function PlayersPage() {
  const allPlayers = store.getPlayers();

  return (
    <AppLayout>
      <PlayersClient initialPlayers={allPlayers} />
    </AppLayout>
  );
}
