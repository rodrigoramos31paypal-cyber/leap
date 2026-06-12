import { PageHeaderSkeleton, ListSkeleton } from "@/components/skeleton";

export default function AgendaLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <ListSkeleton rows={8} />
    </div>
  );
}
