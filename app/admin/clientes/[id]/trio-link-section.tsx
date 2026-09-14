"use client";

// ════════════════════════════════════════════════════════════════
// TrioLinkSection · liga ESTE cliente a DOIS parceiros (grupo de 3).
// Espelho de DuoLinkSection, mas escolhe-se 2 contas antes de ligar
// (link_trio precisa dos 3 ids de uma vez). Um cliente só pode estar
// num grupo (duo OU trio) — a RPC recusa se já houver ligação.
// ════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Link2Off, Users, Search, X } from "lucide-react";
import { linkTrioAction, unlinkTrioAction } from "./trio-actions";
import {
  searchClientsAction,
  type ClientHit,
} from "@/app/admin/clientes/search-action";

export type TrioPartner = { id: string; full_name: string; email: string };

export function TrioLinkSection({
  clientId,
  partners,
}: {
  clientId: string;
  partners: TrioPartner[];
}) {
  const router = useRouter();
  const linked = partners.length >= 2;

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  // Até 2 parceiros escolhidos antes de ligar.
  const [selected, setSelected] = useState<ClientHit[]>([]);
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  const selectedIds = new Set(selected.map((s) => s.id));

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
          setHits(r.filter((c) => c.id !== clientId && !selectedIds.has(c.id)));
          setOpen(true);
          setHighlighted(-1);
        } catch {
          setHits([]);
        }
      });
    }, 200);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, clientId]);

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

  function addPartner(hit: ClientHit) {
    setOpen(false);
    setQ("");
    setHits([]);
    setSelected((s) => (s.length >= 2 || s.some((x) => x.id === hit.id) ? s : [...s, hit]));
  }

  function removePartner(id: string) {
    setSelected((s) => s.filter((x) => x.id !== id));
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
      addPartner(hits[highlighted]);
    }
  }

  function onLink() {
    if (selected.length !== 2) return;
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("partnerId1", selected[0].id);
    fd.set("partnerId2", selected[1].id);
    startTransition(async () => {
      await linkTrioAction(fd);
      setSelected([]);
      setQ("");
      setHits([]);
      router.refresh();
    });
  }

  function onUnlink() {
    const fd = new FormData();
    fd.set("clientId", clientId);
    startTransition(async () => {
      await unlinkTrioAction(fd);
      router.refresh();
    });
  }

  return (
    <details className="card p-5">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
        <Users size={16} /> Trio (3 contas)
      </summary>

      <p className="mt-3 text-xs text-ink-500">
        Liga esta conta a outras duas. Basta uma das três contas ter comprado um pack
        PT Trio — depois de ligadas, partilham o mesmo saldo. Sempre que um dos três
        marcar uma sessão PT Trio, desconta 1 sessão do saldo partilhado e aparece no
        calendário dos três. Um cliente só pode estar num grupo de cada vez (Duo ou Trio).
      </p>

      {linked ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-200 bg-gold-50 p-3 dark:border-gold-400/30 dark:bg-gold-400/10">
          <div className="flex items-center gap-2 text-sm">
            <Link2 size={16} className="text-gold-700" />
            <div>
              <div className="font-semibold">Trio ligado</div>
              <div className="text-xs text-ink-500">
                Com {partners.map((p) => p.full_name).join(" e ")}
              </div>
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
        <div className="mt-4 space-y-3 sm:max-w-md">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gold-200 bg-gold-50 px-2.5 py-1 text-xs dark:border-gold-400/30 dark:bg-gold-400/10"
                >
                  {s.full_name || "(sem nome)"}
                  <button
                    type="button"
                    onClick={() => removePartner(s.id)}
                    disabled={pending}
                    aria-label="Remover"
                    className="text-ink-400 hover:text-red-600"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {selected.length < 2 ? (
            <div ref={wrapRef} className="relative">
              <label className="label">
                Procurar a {selected.length === 0 ? "1.ª" : "2.ª"} conta a ligar
              </label>
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
                          onClick={() => addPartner(h)}
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
                    ↑↓ navegar · clica ou Enter para escolher
                  </div>
                </div>
              )}

              {open && !pending && q.trim().length > 0 && hits.length === 0 && (
                <p className="mt-2 text-xs text-ink-500">Nenhum cliente encontrado.</p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onLink}
              disabled={pending}
              className="btn-primary inline-flex items-center gap-1.5 text-sm"
            >
              <Link2 size={14} /> {pending ? "A ligar…" : "Ligar Trio"}
            </button>
          )}
        </div>
      )}
    </details>
  );
}
