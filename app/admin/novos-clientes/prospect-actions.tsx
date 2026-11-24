"use client";

import { useState, useTransition } from "react";
import { setProspectPreference } from "./actions";

export function ProspectActions({ clientId, archived }: { clientId: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  function change(disposition: "active" | "snoozed" | "declined") {
    setError("");
    startTransition(async () => {
      try {
        const result = await setProspectPreference(clientId, disposition);
        if (result.error) setError(result.error);
      } catch { setError("Não foi possível guardar. Tenta novamente."); }
    });
  }
  return <div className="space-y-1">
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {archived ? <button type="button" disabled={pending} onClick={() => change("active")} className="min-h-11 text-xs font-semibold text-gold-700 disabled:opacity-50 dark:text-gold-300">Voltar a acompanhar</button> : <>
        <button type="button" disabled={pending} onClick={() => change("snoozed")} className="min-h-11 text-xs font-medium text-ink-500 disabled:opacity-50">Lembrar daqui a 7 dias</button>
        <button type="button" disabled={pending} onClick={() => change("declined")} className="min-h-11 text-xs font-medium text-ink-500 disabled:opacity-50">Sem interesse</button>
      </>}
    </div>
    {error && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{error}</p>}
  </div>;
}
