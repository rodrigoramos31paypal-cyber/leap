"use client";

import Link from "next/link";
import { useState } from "react";
import { approveAccountAction, declineEnrollmentAction } from "./approval-actions";

// A decisão mantém o histórico. A confirmação evita recusas acidentais.
export function PendingActions({ clientId }: { clientId: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs text-red-700">Não aprovar este pedido? O histórico será mantido.</span>
        <form action={declineEnrollmentAction}>
          <input type="hidden" name="clientId" value={clientId} />
          <button className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
            Sim, não aprovar
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
    <div className="flex flex-wrap items-center gap-2">
      <form action={approveAccountAction}>
        <input type="hidden" name="clientId" value={clientId} />
        <button className="btn-gold px-3 py-1.5 text-sm">Aprovar</button>
      </form>
      <Link href={`/admin/mensagens?cliente=${clientId}&inscricao=1`} className="btn-outline px-3 py-1.5 text-sm">Enviar mensagem</Link>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="btn-outline border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
      >
        Não aprovar
      </button>
    </div>
  );
}
