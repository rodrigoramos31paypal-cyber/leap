import { PageHeaderSkeleton, ListSkeleton } from "@/components/skeleton";

export default function EquipaLoading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <ListSkeleton rows={5} />
    </div>
  );
}
