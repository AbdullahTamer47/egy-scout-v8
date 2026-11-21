import React from 'react';
import { notFound } from 'next/navigation';
import { AppLayout } from '@/components/layout/app-layout';
import { store } from '@/lib/store';
import { PlayerDetailClient } from '@/components/players/player-detail-client';

interface PlayerPageProps {
  params: {
    id: string;
  };
}

export default function PlayerPage({ params }: PlayerPageProps) {
  const player = store.getPlayerById(params.id);

  if (!player) {
    notFound();
  }

  const evaluations = store.getEvaluationsForPlayer(player.id);

  return (
    <AppLayout>
      <PlayerDetailClient player={player} evaluations={evaluations} />
    </AppLayout>
  );
}
