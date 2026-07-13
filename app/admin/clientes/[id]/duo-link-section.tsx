"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Link2Off, Users, Search } from "lucide-react";
import { linkDuoAction, unlinkDuoAction } from "./actions";
import {
  searchClientsAction,
  type ClientHit,
} from "@/app/admin/clientes/search-action";

export type DuoPartner = { id: string; full_name: string; email: string };

export function DuoLinkSection({
  clientId,
  partner,
}: {
  clientId: string;
  partner: DuoPartner | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Typeahead: procura por nome, email ou telefone (mesma server action da
  // pesquisa de clientes). Debounce 200 ms. Exclui o próprio cliente.
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
          setHits(r.filter((c) => c.id !== clientId));
          setOpen(true);
          setHighlighted(-1);
        } catch {
          setHits([]);
        }
      });
    }, 200);
    return () => window.clearTimeout(id);
  }, [q, clientId]);

  // Clique fora fecha o dropdown.
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

  // Clicar num resultado liga logo as contas (partnerId directo).
  function linkTo(hit: ClientHit) {
    setOpen(false);
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("partnerId", hit.id);
    startTransition(async () => {
      await linkDuoAction(fd);
      setQ("");
      setHits([]);
      router.refresh();
    });
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
      linkTo(hits[highlighted]);
    }
  }

  function onUnlink() {
    const fd = new FormData();
    fd.set("clientId", clientId);
    startTransition(async () => {
      await unlinkDuoAction(fd);
      router.refresh();
    });
  }

  return (
    <details className="card p-5">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
        <Users size={16} /> Par Duo
      </summary>

      <p className="mt-3 text-xs text-ink-500">
        Liga esta conta a outra. Basta uma das contas ter comprado um pack PT Dupla
        — depois de ligadas, partilham o mesmo saldo. Sempre que um dos dois marcar
        uma sessão PT Dupla, desconta 1 sessão do saldo partilhado e aparece no
        calendário de ambos.
      </p>

      {partner ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-200 bg-gold-50 p-3 dark:border-gold-400/30 dark:bg-gold-400/10">
          <div className="flex items-center gap-2 text-sm">
            <Link2 size={16} className="text-gold-700" />
            <div>
              <div className="font-semibold">Ligada a {partner.full_name}</div>
              <div className="text-xs text-ink-500">{partner.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onUnlink}
            disabled={pending}
            className="btn-outline inline-flex items-center gap-1.5 border-red-200 text-xs text-red-700 hover:bg-red-50"
          >
            <Link2Off size={12} /> {pending ? "A desligar…" : "Desligar"}
          </button>
        </div>
      ) : (
        <div ref={wrapRef} className="relative mt-4 sm:max-w-md">
          <label className="label">Procurar a conta a ligar</label>
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => hits.length > 0 && setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Nome, email ou telefone…"
              autoComplete="off"
              disabled={pending}
              className="input pl-9"
            />
          </div>

          {pending && (
            <p className="mt-2 text-xs text-ink-500">A ligar as contas…</p>
          )}

          {open && !pending && hits.length > 0 && (
            <div
              role="listbox"
              className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-ink-900/10 bg-white shadow-lg dark:border-white/10 dark:bg-ink-800"
            >
              <ul>
                {hits.map((h, i) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => linkTo(h)}
                      onMouseEnter={() => setHighlighted(i)}
                      className={`block w-full border-b border-ink-900/5 px-3 py-2 text-left text-sm last:border-0 dark:border-white/5 ${
                        highlighted === i
                          ? "bg-ink-900/5 dark:bg-white/10"
                          : "hover:bg-ink-900/5 dark:hover:bg-white/5"
                      }`}
                    >
                      <div className="font-semibold">{h.full_name || "(sem nome)"}</div>
                      {h.email && <div className="text-xs text-ink-500">{h.email}</div>}
                      {h.phone && <div className="text-xs text-ink-500">{h.phone}</div>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-ink-900/5 bg-bone-50 px-3 py-1.5 text-[10px] uppercase tracking-wide text-ink-500 dark:border-white/5 dark:bg-ink-900">
                ↑↓ navegar · clica ou Enter para ligar
              </div>
            </div>
          )}

          {open && !pending && q.trim().length > 0 && hits.length === 0 && (
            <p className="mt-2 text-xs text-ink-500">Nenhum cliente encontrado.</p>
          )}
        </div>
      )}
    </details>
  );
}
