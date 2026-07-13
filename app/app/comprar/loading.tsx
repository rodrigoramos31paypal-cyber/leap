import { PageHeaderSkeleton, KpiGridSkeleton } from "@/components/skeleton";

export default function ComprarLoading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <KpiGridSkeleton count={4} />
    </div>
  );
}
