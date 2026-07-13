import { PageHeaderSkeleton, CardSkeleton, ListSkeleton } from "@/components/skeleton";

export default function ClientDashboardLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <CardSkeleton className="h-32" />
        <ListSkeleton rows={3} />
      </div>
    </div>
  );
}
