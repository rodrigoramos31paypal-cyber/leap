"use client";

import { useState } from "react";
import { approveAccountAction, rejectAccountAction } from "./approval-actions";

// Botões Aprovar / Rejeitar de uma conta pendente. Rejeitar é destrutivo
// (apaga a conta), por isso pede confirmação num segundo passo.
export function PendingActions({ clientId }: { clientId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-red-700">Rejeitar apaga a conta. Confirmar?</span>
        <form action={rejectAccountAction}>
          <input type="hidden" name="clientId" value={clientId} />
          <button className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
            Sim, rejeitar
          </button>
        </form>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs text-ink-500 hover:underline"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <form action={approveAccountAction}>
        <input type="hidden" name="clientId" value={clientId} />
        <button className="btn-gold px-3 py-1.5 text-sm">Aprovar</button>
      </form>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-outline border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
      >
        Rejeitar
      </button>
    </div>
  );
}
