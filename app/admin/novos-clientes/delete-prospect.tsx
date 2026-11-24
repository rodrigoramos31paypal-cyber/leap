"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteProspectAccount } from "./actions";

export function DeleteProspect({ clientId, name }: { clientId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 text-xs text-red-700 dark:text-red-300"><Trash2 size={13} aria-hidden="true" />Eliminar conta</button>;
  return <div className="space-y-3 rounded-xl border border-red-400/30 bg-red-400/5 p-3">
    <p className="text-sm font-semibold">Eliminar a conta de {name}?</p>
    <p className="text-xs leading-relaxed text-ink-500">O acesso será bloqueado e a conta será anonimizada, como na ficha do cliente. Esta ação não pode ser desfeita. Depois da eliminação, será enviado um email a informar a pessoa. Se existir histórico de compras ou marcações, mantém-se anonimizado.</p>
    <label className="block text-xs font-medium">Escreve APAGAR para confirmar
      <input autoComplete="off" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={pending} className="input mt-1" placeholder="APAGAR" />
    </label>
    {error && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={pending || confirm.trim() !== "APAGAR"} className="min-h-11 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white disabled:opacity-50" onClick={() => {
        setError("");
        startTransition(async () => {
          try {
            const result = await deleteProspectAccount(clientId, confirm);
            if (result.error) { setError(result.error); return; }
            window.dispatchEvent(new CustomEvent("leap:toast", { detail: { kind: result.emailStatus === "sent" ? "success" : "info", title: result.emailStatus === "sent" ? "Conta eliminada · email enviado" : "Conta eliminada · email em fila para envio" } }));
            router.refresh();
          } catch { setError("Não foi possível concluir. Atualiza a lista antes de tentares novamente."); }
        });
      }}>{pending ? "A eliminar…" : "Eliminar e avisar por email"}</button>
      <button type="button" disabled={pending} onClick={() => { setOpen(false); setConfirm(""); setError(""); }} className="btn-outline min-h-11 text-xs">Cancelar</button>
    </div>
  </div>;
}
