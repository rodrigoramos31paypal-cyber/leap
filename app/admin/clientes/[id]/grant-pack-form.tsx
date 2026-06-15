"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { eur } from "@/lib/utils";
import { grantPackAction } from "./actions";

export type GrantPackPack = {
  id: string;
  name: string;
  price_cents: number;
};

export function GrantPackForm({
  clientId,
  packs,
}: {
  clientId: string;
  packs: GrantPackPack[];
}) {
  const [mode, setMode] = useState<"pack" | "custom">(packs.length > 0 ? "pack" : "custom");

  return (
    <form action={grantPackAction} className="mt-4 space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="mode" value={mode} />

      <div className="inline-flex items-center gap-1 rounded-lg border border-ink-900/10 bg-white p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode("pack")}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition",
            mode === "pack"
              ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900"
              : "text-ink-600 hover:bg-ink-900/5",
          )}
        >
          Pack existente
        </button>
        <button
          type="button"
          onClick={() => setMode("custom")}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition",
            mode === "custom"
              ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900"
              : "text-ink-600 hover:bg-ink-900/5",
          )}
        >
          Sessões avulso
        </button>
      </div>

      {mode === "pack" ? (
        packs.length === 0 ? (
          <p className="text-sm text-ink-500">
            Não há packs activos. Cria um em <strong>/admin/packs</strong> ou usa "Sessões avulso".
          </p>
        ) : (
          <div>
            <label className="label">Pack</label>
            <select name="packId" required className="input">
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {eur(p.price_cents)}
                </option>
              ))}
            </select>
          </div>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Nº sessões</label>
            <input
              name="custom_sessions"
              type="number"
              min={1}
              required
              defaultValue={1}
              className="input"
            />
          </div>
          <div>
            <label className="label">Preço total (€)</label>
            <input
              name="custom_price_euros"
              type="number"
              min={0}
              step="0.01"
              required
              defaultValue="0"
              className="input"
              placeholder="0 = oferta"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Descrição (opcional)</label>
            <input
              name="custom_name"
              className="input"
              placeholder="Ex: 2 sessões de Reposição"
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Método de pagamento</label>
          <select name="method" className="input" defaultValue="manual_cash">
            <option value="manual_cash">Dinheiro</option>
            <option value="manual_transfer">Transferência bancária</option>
            <option value="manual_mbway">MB Way (manual)</option>
            <option value="complimentary">Cortesia (oferta — sem pagamento)</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="confirmNow"
              defaultChecked
              className="h-4 w-4 rounded border-ink-900/30"
            />
            Confirmar pagamento já (somar sessões agora)
          </label>
        </div>
      </div>

      <button className="btn-primary w-full sm:w-auto">Atribuir ao cliente</button>
      <p className="text-xs text-ink-500">
        Se confirmares agora, as sessões ficam imediatamente disponíveis. Senão, fica como
        "a aguardar confirmação" e podes confirmar mais tarde em Pagamentos.
      </p>
    </form>
  );
}
