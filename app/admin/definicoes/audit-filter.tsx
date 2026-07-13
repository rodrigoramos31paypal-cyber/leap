"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { AUDIT_FILTER_GROUPS } from "./audit-log-labels";

/**
 * Controlos do Registo de atividade: dropdown "Filtrar" (ações agrupadas
 * por Admin / Cliente) + barra de pesquisa por cliente (nome, email ou
 * telefone). A fonte da verdade é o URL — assim a paginação partilha o
 * mesmo filtro/pesquisa. Mudar qualquer um volta à página 1.
 */
export function AuditControls({ action, search }: { action: string; search: string }) {
  const router = useRouter();
  const [q, setQ] = useState(search);

  const navigate = (nextAction: string, nextSearch: string) => {
    const params = new URLSearchParams();
    params.set("tab", "registo");
    if (nextAction) params.set("action", nextAction);
    if (nextSearch.trim()) params.set("q", nextSearch.trim());
    // page volta a 1 (omitida = 1)
    router.push(`/admin/definicoes?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-ink-500">Filtrar:</span>
        <select
          className="input h-9 py-1"
          value={action}
          onChange={(e) => navigate(e.target.value, q)}
        >
          <option value="">Todas as ações</option>
          {AUDIT_FILTER_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(action, q);
        }}
      >
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar cliente (nome, email, telefone)"
            className="input h-9 w-full py-1 pl-7 sm:w-72"
          />
        </div>
        <button type="submit" className="btn-outline h-9">
          Procurar
        </button>
        {search ? (
          <button
            type="button"
            className="text-xs text-ink-500 hover:underline"
            onClick={() => {
              setQ("");
              navigate(action, "");
            }}
          >
            Limpar
          </button>
        ) : null}
      </form>
    </div>
  );
}
