import React from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { store } from '@/lib/store';
import { CompareClient } from '@/components/players/compare-client';

interface ComparePageProps {
  searchParams: {
    p1?: string;
    p2?: string;
  };
}

export default function ComparePage({ searchParams }: ComparePageProps) {
  const allPlayers = store.getPlayers();
  const initialIds = [searchParams.p1, searchParams.p2].filter(Boolean) as string[];

  return (
    <AppLayout>
      <CompareClient allPlayers={allPlayers} initialPlayerIds={initialIds} />
    </AppLayout>
  );
}
