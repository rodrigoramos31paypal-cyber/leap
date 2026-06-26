"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deletePurchaseAction } from "./actions";

// Ícone de caixote do lixo em cada pagamento. Ao clicar, pede
// confirmação inline (eliminar é irreversível) e chama a server action.
// Usa useTransition + router.refresh para mostrar erros da RPC (ex.:
// "tem sessões associadas") em vez de falhar em silêncio.
export function DeletePurchaseButton({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setErr(null);
    const fd = new FormData();
    fd.set("purchaseId", purchaseId);
    startTransition(async () => {
      const r = await deletePurchaseAction(fd);
      if (r?.ok) {
        router.refresh();
      } else {
        setErr(r?.error ?? "Não foi possível eliminar o pagamento.");
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Eliminar pagamento"
        title="Eliminar pagamento"
        className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-700"
      >
        <Trash2 size={15} />
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-red-700">Eliminar?</span>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "A eliminar…" : "Sim, eliminar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setErr(null);
          }}
          disabled={pending}
          className="rounded-md px-2 py-1 text-xs text-ink-500 hover:text-ink-900"
        >
          Não
        </button>
      </div>
      {err && (
        <div className="max-w-xs rounded-md bg-red-100 px-2 py-1 text-right text-[11px] text-red-800">
          {err}
        </div>
      )}
    </div>
  );
}
