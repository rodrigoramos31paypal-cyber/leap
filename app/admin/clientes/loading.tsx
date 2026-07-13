import { PageHeaderSkeleton, ListSkeleton, Skeleton } from "@/components/skeleton";

export default function ClientesLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-3 flex gap-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-24" />
      </div>
      <ListSkeleton rows={10} />
    </div>
  );
}
