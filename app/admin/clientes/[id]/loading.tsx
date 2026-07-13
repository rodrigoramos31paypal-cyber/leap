import { PageHeaderSkeleton, CardSkeleton, ListSkeleton } from "@/components/skeleton";

export default function ClientDetailLoading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <CardSkeleton />
      <CardSkeleton />
      <ListSkeleton rows={6} />
    </div>
  );
}
