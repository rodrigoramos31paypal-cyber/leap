"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { eur } from "@/lib/utils";
import { grantPackAction } from "./actions";

export type GrantPackPack = {
  id: string;
  name: string;
  price_cents: number;
};

type Mode = "pack" | "custom" | "remove";

const TAB = "rounded-md px-2.5 py-1 font-medium transition";
const TAB_ON = "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900";
const TAB_OFF = "text-ink-600 hover:bg-ink-900/5";

// Toast imediato no Toaster montado no layout admin. Necessário porque a
// server action set-flash via cookie só ficaria visível na próxima
// navegação completa (a server action não força re-render do layout).
function clientToast(title: string, kind: "success" | "error" | "info" = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("leap:toast", { detail: { title, kind } }),
  );
}

export function GrantPackForm({
  clientId,
  packs,
  hasPartner = false,
}: {
  clientId: string;
  packs: GrantPackPack[];
  /** Cliente tem par duo activo. Quando true, os selectores de Tipo
   *  ("Sessões avulso" e "Remover sessões") arrancam em "PT Dupla" —
   *  caso típico de uso, já que o saldo dupla é partilhado pelo par. */
  hasPartner?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(packs.length > 0 ? "pack" : "custom");
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    // Garante que os hidden fields acompanham o estado actual do tab.
    formData.set("clientId", clientId);
    formData.set("mode", mode);

    // Validação rápida no cliente para evitar round-trips inúteis e dar
    // feedback imediato. O servidor revalida (defesa em profundidade).
    if (mode === "custom") {
      const n = Number(formData.get("custom_sessions") ?? 0);
      if (!Number.isFinite(n) || n <= 0) {
        clientToast("Indica um número de sessões válido", "error");
        return;
      }
    }
    if (mode === "remove") {
      const n = Number(formData.get("remove_sessions") ?? 0);
      if (!Number.isFinite(n) || n <= 0) {
        clientToast("Indica um número de sessões válido", "error");
        return;
      }
    }

    startTransition(async () => {
      try {
        await grantPackAction(formData);
        const successMsg =
          mode === "remove"
            ? "Sessões removidas do cliente"
            : mode === "custom"
              ? "Sessões atribuídas ao cliente"
              : "Pack atribuído e confirmado";
        clientToast(successMsg);
        router.refresh();
      } catch (err) {
        clientToast(
          mode === "remove"
            ? "Não foi possível remover as sessões"
            : "Não foi possível atribuir as sessões",
          "error",
        );
      }
    });
  }

  return (
    <form action={onSubmit} className="mt-4 space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="mode" value={mode} />

      <div className="inline-flex items-center gap-1 rounded-lg border border-ink-900/10 bg-white p-1 text-xs dark:bg-ink-800">
        <button
          type="button"
          onClick={() => setMode("pack")}
          className={cn(TAB, mode === "pack" ? TAB_ON : TAB_OFF)}
        >
          Packs
        </button>
        <button
          type="button"
          onClick={() => setMode("custom")}
          className={cn(TAB, mode === "custom" ? TAB_ON : TAB_OFF)}
        >
          Sessões avulso
        </button>
        <button
          type="button"
          onClick={() => setMode("remove")}
          className={cn(TAB, mode === "remove" ? TAB_ON : TAB_OFF)}
        >
          Remover sessões
        </button>
      </div>

      {mode === "pack" &&
        (packs.length === 0 ? (
          <p className="text-sm text-ink-500">
            Não há packs activos. Cria um em <strong>/admin/packs</strong> ou usa
            "Sessões avulso".
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
        ))}

      {mode === "custom" && (
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
            <label className="label">Tipo</label>
            <select
              name="custom_session_type"
              defaultValue={hasPartner ? "dupla" : "individual"}
              className="input"
            >
              <option value="individual">PT Individual</option>
              <option value="dupla">PT Dupla (partilhado com o par)</option>
            </select>
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

      {mode === "remove" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Nº de sessões a remover</label>
            <input
              name="remove_sessions"
              type="number"
              min={1}
              required
              defaultValue={1}
              className="input"
            />
          </div>
          <div>
            <label className="label">Tipo</label>
            <select
              name="remove_session_type"
              defaultValue={hasPartner ? "dupla" : "any"}
              className="input"
            >
              <option value="any">Qualquer (mais antigas primeiro)</option>
              <option value="individual">Só PT Individual</option>
              <option value="dupla">Só PT Dupla (partilhado com o par)</option>
            </select>
          </div>
          <p className="text-xs text-ink-500 sm:col-span-2">
            Remove sessões do saldo do cliente (dentro do tipo escolhido,
            consome primeiro as que expiram mais cedo). Não afecta a receita.
          </p>
        </div>
      )}

      {mode !== "remove" && (
        <div className="sm:max-w-xs">
          <label className="label">Método de pagamento</label>
          <select name="method" className="input" defaultValue="manual_cash">
            <option value="manual_cash">Dinheiro</option>
            <option value="manual_mbway">MBWay</option>
            <option value="manual_revolut">Revolut</option>
            <option value="complimentary">Cortesia / Oferta (grátis)</option>
          </select>
          <p className="mt-1 text-xs text-ink-500">
            Dinheiro, MBWay e Revolut entram na receita. Cortesia/Oferta atribui
            as sessões sem registar receita.
          </p>
        </div>
      )}

      <button className="btn-primary w-full sm:w-auto" disabled={pending}>
        {pending
          ? "A processar…"
          : mode === "remove"
            ? "Remover do cliente"
            : "Atribuir ao cliente"}
      </button>
    </form>
  );
}
