import { PageHeaderSkeleton, CardSkeleton, KpiGridSkeleton } from "@/components/skeleton";

export default function RelatoriosLoading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <CardSkeleton />
      <KpiGridSkeleton count={6} />
    </div>
  );
}
