// Loading genérico para todas as páginas /admin/*. Mostra-se
// instantaneamente assim que o utilizador clica num link, enquanto
// o RSC corre no servidor. Páginas com loading.tsx próprio (e.g.
// /admin/dashboard) sobrepõem este.
import { PageHeaderSkeleton, KpiGridSkeleton, ListSkeleton } from "@/components/skeleton";

export default function AdminLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <KpiGridSkeleton />
        <ListSkeleton rows={5} />
      </div>
    </div>
  );
}
