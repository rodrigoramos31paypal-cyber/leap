"use client";

import { useState } from "react";
import { eur } from "@/lib/utils";
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
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500/70 dark:text-bone-100/45">
        {packs.length} {packs.length === 1 ? "pack" : "packs"}
      </p>

      {packs.length === 0 ? (
        <div className="card p-5 text-center text-sm text-ink-500">Sem packs criados.</div>
      ) : (
        <ul className="space-y-3">
          {packs.map((p) => (
            <li key={p.id}>
              <PackCard
                p={p}
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
  editing,
  onToggleEdit,
}: {
  p: PackRow;
  editing: boolean;
  onToggleEdit: () => void;
}) {
  const editForm = editing ? (
    <form action={updatePackAction} className="mt-3 grid gap-2">
      <input type="hidden" name="id" value={p.id} />
      <div>
        <label className="label">Nome</label>
        <input name="name" required defaultValue={p.name} className="input" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Nº sessões</label>
          <input name="sessions" type="number" min={1} required defaultValue={p.sessions} className="input" />
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
  ) : null;

  // ── DESIGN PREMIUM ──────────────────────────────────────────────
  // Preço em destaque (Sora) + nº de sessões, €/sessão, validade e badge
  // Avulsa. Ações em pílulas; "Eliminar" com contorno vermelho.
  const perSession = p.sessions > 0 ? Math.round(p.price_cents / p.sessions) : 0;
  return (
    <div className={cn("card p-4", !p.active && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink-900 dark:text-bone-50">
              {p.name}
            </span>
            {p.is_single_session && (
              <span className="shrink-0 rounded-full bg-gold-400/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-gold-700 dark:text-gold-300">
                Avulsa
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-[#9a9a92] dark:text-bone-100/45">
            {p.sessions} {p.sessions === 1 ? "sessão" : "sessões"}
            {p.validity_days ? ` · ${p.validity_days} dias de validade` : " · sem validade"}
            {!p.active && " · inativo"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-[22px] font-bold leading-none tracking-tight text-ink-900 dark:text-bone-50">
            {eur(p.price_cents)}
          </div>
          <div className="mt-1 text-[11px] text-[#a3a39a] dark:text-bone-100/40">{eur(perSession)} / sessão</div>
        </div>
      </div>

      {editForm}

      <div className="mt-3 h-px bg-ink-900/[0.06] dark:bg-white/[0.07]" />
      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleEdit}
          className="rounded-[10px] border border-ink-900/15 px-3.5 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-50 dark:hover:bg-white/10"
        >
          {editing ? "Fechar" : "Editar"}
        </button>
        <form action={togglePackAction}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="active" value={String(!p.active)} />
          <button className="rounded-[10px] border border-ink-900/15 px-3.5 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-100 dark:hover:bg-white/10">
            {p.active ? "Desativar" : "Ativar"}
          </button>
        </form>
        <form action={deletePackAction} className="ml-auto">
          <input type="hidden" name="id" value={p.id} />
          <button className="rounded-[10px] border border-red-300 px-3.5 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 dark:border-red-400/30 dark:text-red-300">
            Eliminar
          </button>
        </form>
      </div>
    </div>
  );
}
