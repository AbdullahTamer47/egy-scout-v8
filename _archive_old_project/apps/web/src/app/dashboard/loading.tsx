import { Skeleton } from '@/components/ui/skeleton';
import { BentoGrid, BentoCard } from '@/components/layout/bento-grid';

export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-10 w-48 mb-6" />
      <BentoGrid>
        <BentoCard title="Loading..." colSpan={2}>
          <Skeleton className="h-16 w-full" />
        </BentoCard>
        <BentoCard title="Loading...">
          <Skeleton className="h-16 w-full" />
        </BentoCard>
        <BentoCard title="Loading..." colSpan={2} rowSpan={2}>
          <Skeleton className="h-full min-h-[200px] w-full" />
        </BentoCard>
        <BentoCard title="Loading...">
          <Skeleton className="h-16 w-full" />
        </BentoCard>
        <BentoCard title="Loading...">
          <Skeleton className="h-16 w-full" />
        </BentoCard>
      </BentoGrid>
    </div>
  );
}
