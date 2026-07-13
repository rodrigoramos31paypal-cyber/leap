"use client";

// ════════════════════════════════════════════════════════════════
// ClientSearch · barra de pesquisa com typeahead.
//
// - Enquanto o trainer escreve (≥1 char, debounced 200 ms) faz
//   uma server-action que devolve até 5 hits.
// - Cada hit é navegável directamente para a "página" do cliente
//   (rota construída em `resultHref`).
// - Se o cliente certo não estiver nos 5, Enter envia o form para
//   `submitHref?param=...` onde a página mostra a lista completa.
// - Setas ↑/↓ navegam o dropdown; Esc fecha; clique fora também.
// ════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchClientsAction, type ClientHit } from "@/app/admin/clientes/search-action";

export function ClientSearch({
  initialQ = "",
  placeholder = "Procurar cliente por nome, email ou telefone…",
  submitAction,
  paramName = "q",
  resultHrefTemplate,
}: {
  initialQ?: string;
  placeholder?: string;
  /** URL para onde o form aponta quando o utilizador carrega Enter
   *  sem escolher do dropdown (ex: "/admin/clientes"). */
  submitAction: string;
  /** Nome do query param na submissão por Enter. */
  paramName?: string;
  /** Template URL com `{id}` como placeholder. Funções não podem
   *  atravessar a fronteira server→client, por isso usamos uma
   *  string. Exemplos:
   *    "/admin/clientes/{id}"
   *    "/admin/pagamentos?client={id}" */
  resultHrefTemplate: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number>(-1);
  const [, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Debounce + fetch
  useEffect(() => {
    const term = q.trim();
    if (term.length === 0) {
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
  }, [q]);

  // Clique fora fecha
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!wrapRef.current) return;
      if (e.target instanceof Node && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function pick(hit: ClientHit) {
    setOpen(false);
    router.push(resultHrefTemplate.replace("{id}", hit.id));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || hits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? hits.length - 1 : h - 1));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      pick(hits[highlighted]);
    }
    // Enter sem highlight → deixa o form submeter normalmente
  }

  return (
    <div ref={wrapRef} className="relative">
      <form method="get" action={submitAction}>
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
        <input
          name={paramName}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className="input pl-9"
        />
      </form>

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
                  className={`block w-full border-b border-ink-900/5 px-3 py-2 text-left text-sm last:border-0 dark:border-white/5 ${
                    highlighted === i
                      ? "bg-ink-900/5 dark:bg-white/10"
                      : "hover:bg-ink-900/5 dark:hover:bg-white/5"
                  }`}
                >
                  <div className="font-semibold">
                    {h.full_name || "(sem nome)"}
                  </div>
                  {h.email && (
                    <div className="text-xs text-ink-500">{h.email}</div>
                  )}
                  {h.phone && (
                    <div className="text-xs text-ink-500">{h.phone}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-900/5 bg-bone-50 px-3 py-1.5 text-[10px] uppercase tracking-wide text-ink-500 dark:border-white/5 dark:bg-ink-900">
            ↑↓ navegar · Enter para ver lista completa
          </div>
        </div>
      )}
    </div>
  );
}
