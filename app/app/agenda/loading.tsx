import { PageHeaderSkeleton, ListSkeleton } from "@/components/skeleton";

export default function ClientAgendaLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <ListSkeleton rows={6} />
    </div>
  );
}
