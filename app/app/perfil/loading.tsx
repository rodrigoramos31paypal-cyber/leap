import { PageHeaderSkeleton, CardSkeleton } from "@/components/skeleton";

export default function PerfilLoading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
