// Loading genérico para /app/* (cliente). Renderiza imediatamente
// quando o utilizador navega entre dashboard/agenda/perfil/etc.
import { PageHeaderSkeleton, CardSkeleton, ListSkeleton } from "@/components/skeleton";

export default function AppLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <CardSkeleton />
        <ListSkeleton rows={4} />
      </div>
    </div>
  );
}
