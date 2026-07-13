import { PageHeaderSkeleton, ListSkeleton } from "@/components/skeleton";

export default function PagamentosLoading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <ListSkeleton rows={8} />
    </div>
  );
}
