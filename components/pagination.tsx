import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Paginação server-side. Constrói os links a partir de `baseHref` +
 * `extraParams`, anexando `?page=N`. Mostra "← N de M →" e a
 * lista de páginas só se houver mais de uma.
 */
export function Pagination({
  page,
  pageSize,
  total,
  baseHref,
  extraParams = {},
}: {
  page: number;
  pageSize: number;
  total: number;
  baseHref: string;
  extraParams?: Record<string, string>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const safePage = Math.min(Math.max(page, 1), totalPages);

  function makeHref(p: number) {
    const params = new URLSearchParams({ ...extraParams, page: String(p) });
    // remove `page=1` para URLs mais limpas
    if (p === 1) params.delete("page");
    const qs = params.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  }

  const prev = safePage > 1 ? makeHref(safePage - 1) : null;
  const next = safePage < totalPages ? makeHref(safePage + 1) : null;

  return (
    <nav
      aria-label="Paginação"
      className="flex items-center justify-between gap-2 pt-2 text-sm"
    >
      <div className="text-xs text-ink-500">
        Página <span className="font-semibold text-ink-900 dark:text-bone-50">{safePage}</span> de{" "}
        <span className="font-semibold text-ink-900 dark:text-bone-50">{totalPages}</span> · {total}{" "}
        {total === 1 ? "resultado" : "resultados"}
      </div>
      <div className="flex items-center gap-1">
        {prev ? (
          <Link
            href={prev}
            className="btn-outline inline-flex items-center gap-1 px-2 py-1 text-xs"
            aria-label="Página anterior"
          >
            <ChevronLeft size={14} /> Anterior
          </Link>
        ) : (
          <span className="btn-outline inline-flex cursor-not-allowed items-center gap-1 px-2 py-1 text-xs opacity-40">
            <ChevronLeft size={14} /> Anterior
          </span>
        )}
        {next ? (
          <Link
            href={next}
            className="btn-outline inline-flex items-center gap-1 px-2 py-1 text-xs"
            aria-label="Página seguinte"
          >
            Seguinte <ChevronRight size={14} />
          </Link>
        ) : (
          <span className="btn-outline inline-flex cursor-not-allowed items-center gap-1 px-2 py-1 text-xs opacity-40">
            Seguinte <ChevronRight size={14} />
          </span>
        )}
      </div>
    </nav>
  );
}
