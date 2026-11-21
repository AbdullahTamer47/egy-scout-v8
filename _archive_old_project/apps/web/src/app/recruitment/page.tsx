import React from 'react';
import { AppLayout } from '@/components/layout/app-layout';
import { store } from '@/lib/store';
import { RecruitmentClient } from '@/components/recruitment/recruitment-client';

export default function RecruitmentPage() {
  const needs = store.getRecruitmentNeeds();
  const allPlayers = store.getPlayers();

  return (
    <AppLayout>
      <RecruitmentClient initialNeeds={needs} allPlayers={allPlayers} />
    </AppLayout>
  );
}
