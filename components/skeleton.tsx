// ════════════════════════════════════════════════════════════════
// Skeletons reutilizáveis para loading.tsx e <Suspense fallback>.
// Pulsam suavemente (animate-pulse) usando a paleta bone/ink já
// existente para casar com cards reais sem mudança visual abrupta.
// ════════════════════════════════════════════════════════════════

import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-ink-900/10 dark:bg-white/10",
        className,
      )}
    />
  );
}

/** Cabeçalho de página (título + subtítulo). */
export function PageHeaderSkeleton() {
  return (
    <div className="mb-4 space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-32" />
    </div>
  );
}

/** Card genérico com altura configurável. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("card p-4", className)}>
      <Skeleton className="mb-3 h-4 w-1/3" />
      <Skeleton className="mb-2 h-6 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/** Grelha de KPIs (dashboard). */
export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Lista de linhas (clientes, bookings, etc). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="card divide-y divide-ink-900/5 dark:divide-white/5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between p-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}
