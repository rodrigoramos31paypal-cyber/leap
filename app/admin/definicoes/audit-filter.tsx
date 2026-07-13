"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { AUDIT_FILTER_GROUPS } from "./audit-log-labels";
import { searchClientsAction, type ClientHit } from "@/app/admin/clientes/search-action";

/**
 * Controlos do Registo de atividade:
 *   • dropdown "Filtrar" — ações agrupadas por Admin / Cliente;
 *   • pesquisa de cliente com TYPEAHEAD — enquanto escreves (debounced),
 *     mostra até 5 clientes (nome/email/telefone, mesmo backend seguro do
 *     ecrã Clientes). Escolher um filtra o registo EXATAMENTE por essa
 *     conta (?client=<id>). Enter sem escolher faz pesquisa por texto
 *     (?q=<texto>). "Limpar" remove o filtro de cliente.
 *
 * A fonte da verdade é o URL — a paginação partilha o mesmo filtro.
 */
export function AuditControls({
  action,
  search,
  clientId,
  clientName,
}: {
  action: string;
  search: string;
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  // Valor visível na caixa: nome do cliente escolhido, ou o texto pesquisado.
  const [q, setQ] = useState(clientName || search);
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  const go = (opts: { action?: string; clientId?: string; q?: string }) => {
    const params = new URLSearchParams();
    params.set("tab", "registo");
    const a = opts.action ?? action;
    if (a) params.set("action", a);
    if (opts.clientId) params.set("client", opts.clientId);
    else if (opts.q && opts.q.trim()) params.set("q", opts.q.trim());
    // page volta a 1 (omitida = 1)
    router.push(`/admin/definicoes?${params.toString()}`);
  };

  // Typeahead: procura clientes enquanto escreve (debounced 200 ms).
  useEffect(() => {
    const term = q.trim();
    // Não repetir a procura quando a caixa mostra exatamente o cliente já escolhido.
    if (term.length === 0 || term === clientName) {
      setHits([]);
      setOpen(false);
      return;
    }
    const id = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const r = await searchClientsAction(term);
          setHits(r);
          setOpen(true);
          setHighlighted(-1);
        } catch {
          setHits([]);
        }
      });
    }, 200);
    return () => window.clearTimeout(id);
  }, [q, clientName]);

  // Clique fora fecha o dropdown.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!wrapRef.current) return;
      if (e.target instanceof Node && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const pick = (hit: ClientHit) => {
    setOpen(false);
    setQ(hit.full_name || "");
    go({ clientId: hit.id });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && highlighted >= 0 && hits[highlighted]) {
        pick(hits[highlighted]);
      } else {
        // Sem escolha do dropdown → pesquisa por texto livre.
        setOpen(false);
        go({ q });
      }
      return;
    }
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? hits.length - 1 : h - 1));
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-ink-500">Filtrar:</span>
        <select
          className="input h-9 py-1"
          value={action}
          onChange={(e) =>
            go({
              action: e.target.value,
              clientId: clientId || undefined,
              q: clientId ? undefined : search,
            })
          }
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

      <div ref={wrapRef} className="relative">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-500"
            />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => hits.length > 0 && setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="nome/e-mail/telefone"
              autoComplete="off"
              className="input h-9 w-full py-1 pl-7 sm:w-72"
            />
          </div>
          {clientId || search ? (
            <button
              type="button"
              className="text-xs text-ink-500 hover:underline"
              onClick={() => {
                setQ("");
                setOpen(false);
                go({});
              }}
            >
              Limpar
            </button>
          ) : null}
        </div>

        {open && hits.length > 0 && (
          <div
            role="listbox"
            className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-ink-900/10 bg-white shadow-lg dark:border-white/10 dark:bg-ink-800"
          >
            <ul>
              {hits.map((h, i) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => pick(h)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={
                      "block w-full border-b border-ink-900/5 px-3 py-2 text-left text-sm last:border-0 dark:border-white/5 " +
                      (highlighted === i
                        ? "bg-ink-900/5 dark:bg-white/10"
                        : "hover:bg-ink-900/5 dark:hover:bg-white/5")
                    }
                  >
                    <div className="font-semibold">{h.full_name || "(sem nome)"}</div>
                    {h.email && <div className="text-xs text-ink-500">{h.email}</div>}
                    {h.phone && <div className="text-xs text-ink-500">{h.phone}</div>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-ink-900/5 bg-bone-50 px-3 py-1.5 text-[10px] uppercase tracking-wide text-ink-500 dark:border-white/5 dark:bg-ink-900">
              ↑↓ navegar · Enter para pesquisa livre
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
