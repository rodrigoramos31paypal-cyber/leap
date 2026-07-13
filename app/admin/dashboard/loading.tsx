import { PageHeaderSkeleton, KpiGridSkeleton, CardSkeleton } from "@/components/skeleton";

export default function DashboardLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <KpiGridSkeleton count={4} />
        <div className="grid gap-4 md:grid-cols-2">
          <CardSkeleton className="h-48" />
          <CardSkeleton className="h-48" />
        </div>
      </div>
    </div>
  );
}
