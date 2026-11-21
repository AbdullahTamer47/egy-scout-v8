import React from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { store } from '@/lib/store';
import { ReportClient } from '@/components/reports/report-client';

interface ReportsPageProps {
  searchParams: {
    playerId?: string;
  };
}

export default function ReportsPage({ searchParams }: ReportsPageProps) {
  const players = store.getPlayers();

  return (
    <AppLayout>
      <ReportClient players={players} selectedPlayerId={searchParams.playerId} />
    </AppLayout>
  );
}
