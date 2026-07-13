"use client";

import { useState } from "react";
import { eur } from "@/lib/utils";
import { PacksViewToggle, type PacksView } from "@/components/packs-view-toggle";
import { updatePackAction, togglePackAction, deletePackAction } from "./actions";
import { cn } from "@/lib/utils";

export type PackRow = {
  id: string;
  name: string;
  session_type: "individual" | "dupla";
  sessions: number;
  price_cents: number;
  validity_days: number | null;
  active: boolean;
  is_single_session?: boolean | null;
};

export function PacksDisplay({ packs }: { packs: PackRow[] }) {
  const [view, setView] = useState<PacksView>("grid");
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-500">
          {packs.length} {packs.length === 1 ? "pack" : "packs"}
        </p>
        <PacksViewToggle onChange={setView} />
      </div>

      {packs.length === 0 ? (
        <div className="card p-5 text-center text-sm text-ink-500">Sem packs criados.</div>
      ) : view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((p) => (
            <PackCard
              key={p.id}
              p={p}
              compact
              editing={editing === p.id}
              onToggleEdit={() => setEditing(editing === p.id ? null : p.id)}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {packs.map((p) => (
            <li key={p.id}>
              <PackCard
                p={p}
                compact={false}
                editing={editing === p.id}
                onToggleEdit={() => setEditing(editing === p.id ? null : p.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PackCard({
  p,
  compact,
  editing,
  onToggleEdit,
}: {
  p: PackRow;
  compact: boolean;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  return (
    <div
      className={cn(
        "card transition",
        compact ? "p-4" : "p-5",
        !p.active && "opacity-60",
      )}
    >
      <div className={cn("flex", compact ? "flex-col gap-1" : "flex-wrap items-center justify-between gap-3")}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold">{p.name}</div>
            {p.is_single_session && (
              <span className="rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-700">
                Avulsa
              </span>
            )}
          </div>
          {p.validity_days && (
            <div className="text-xs text-ink-500">{p.validity_days} dias de validade</div>
          )}
          {!p.active && <div className="text-xs text-ink-500">Inativo</div>}
        </div>
        <div className={cn("font-display font-bold", compact ? "mt-1 text-2xl" : "text-lg")}>
          {eur(p.price_cents)}
        </div>
      </div>

      {editing && (
        <form action={updatePackAction} className="mt-3 grid gap-2">
          <input type="hidden" name="id" value={p.id} />
          <div>
            <label className="label">Nome</label>
            <input name="name" required defaultValue={p.name} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Nº sessões</label>
              <input
                name="sessions"
                type="number"
                min={1}
                required
                defaultValue={p.sessions}
                className="input"
              />
            </div>
            <div>
              <label className="label">Preço (€)</label>
              <input
                name="price_euros"
                type="number"
                min={0}
                step="0.01"
                required
                defaultValue={(p.price_cents / 100).toFixed(2)}
                className="input"
              />
            </div>
          </div>
          <div>
            <label className="label">Validade (dias, opcional)</label>
            <input
              name="validity_days"
              type="number"
              min={1}
              defaultValue={p.validity_days ?? ""}
              className="input"
              placeholder="Vazio = sem validade"
            />
          </div>
          <label className="flex items-start gap-2 rounded-md border border-ink-900/10 bg-bone-50 px-3 py-2 text-xs">
            <input
              type="checkbox"
              name="is_single_session"
              defaultChecked={!!p.is_single_session}
              className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
            />
            <span>
              <span className="block font-semibold">Sessão avulsa</span>
              <span className="text-ink-500">
                Aparece em destaque no topo de /comprar. Só 1 pack activo por trainer pode estar marcado.
              </span>
            </span>
          </label>
          <button className="btn-primary">Guardar alterações</button>
        </form>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggleEdit}
          className="btn-outline text-xs"
        >
          {editing ? "Fechar" : "Editar"}
        </button>
        <form action={togglePackAction}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="active" value={String(!p.active)} />
          <button className={cn("text-xs", p.active ? "btn-outline" : "btn-primary")}>
            {p.active ? "Desativar" : "Ativar"}
          </button>
        </form>
        <form action={deletePackAction}>
          <input type="hidden" name="id" value={p.id} />
          <button className="btn-outline border-red-200 text-xs text-red-700 hover:bg-red-50">
            Eliminar
          </button>
        </form>
      </div>
    </div>
  );
}
