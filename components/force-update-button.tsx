"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { forceAppReloadAction } from "@/app/admin/definicoes/actions";

// Botão (staff) que dispara o kill-switch: bumpa app_config.force_reload_at
// e todas as apps abertas recarregam (ver AppUpdater). Pede confirmação
// porque o efeito é global. Mostra feedback inline (sem depender de flash,
// já que não há navegação).
export function ForceUpdateButton() {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setDone(false);
          setErr(false);
          const ok = window.confirm(
            "Forçar atualização em TODOS os dispositivos agora? As apps abertas (clientes e equipa) vão recarregar para a versão mais recente.",
          );
          if (!ok) return;
          start(async () => {
            const r = await forceAppReloadAction();
            if (r.ok) setDone(true);
            else setErr(true);
          });
        }}
        className="btn-outline inline-flex items-center gap-2 disabled:opacity-50"
      >
        <RefreshCw size={14} className={pending ? "animate-spin" : ""} />
        {pending ? "A enviar..." : "Forçar atualização agora"}
      </button>
      {done && (
        <p className="text-xs text-emerald-600">
          Pedido enviado. As apps abertas vão atualizar em segundos.
        </p>
      )}
      {err && (
        <p className="text-xs text-red-600">Não foi possível enviar o pedido. Tenta de novo.</p>
      )}
    </div>
  );
}
