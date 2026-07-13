"use client";

import { useRouter } from "next/navigation";
import { AUDIT_FILTER_OPTIONS } from "./audit-log-labels";

/**
 * Dropdown de filtro por ação do Registo de atividade. Ao mudar, navega
 * para a mesma aba com `?action=` (e volta à página 1). Sem estado local —
 * a fonte da verdade é o URL, para a paginação partilhar o mesmo filtro.
 */
export function AuditFilter({ current }: { current: string }) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-500">Filtrar por ação:</span>
      <select
        className="input h-9 py-1"
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          const params = new URLSearchParams();
          params.set("tab", "registo");
          if (v) params.set("action", v);
          // page volta a 1 (omitida = 1)
          router.push(`/admin/definicoes?${params.toString()}`);
        }}
      >
        <option value="">Todas as ações</option>
        {AUDIT_FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
