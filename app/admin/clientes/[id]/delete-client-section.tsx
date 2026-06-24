"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { adminDeleteClientAction } from "./actions";

// Admin · apagar conta do cliente com type-to-confirm ("APAGAR"). Usa
// useTransition + navegação no cliente para mostrar erros em vez de
// falhar em silêncio. Idêntico ao DeleteAccountSection do cliente, mas
// para um clientId arbitrário.
export function DeleteClientSection({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("confirm", val);
    startTransition(async () => {
      const r = await adminDeleteClientAction(fd);
      if (r?.ok) {
        router.push("/admin/clientes");
        router.refresh();
      } else {
        setErr(r?.error ?? "Não foi possível apagar a conta.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-outline inline-flex w-full items-center justify-center gap-1.5 text-xs text-red-700 hover:bg-red-50 border-red-200"
      >
        <Trash2 size={12} /> Apagar conta
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
      <div className="text-xs text-red-800">
        Esta acção é <strong>irreversível</strong>. Os dados pessoais do cliente
        (nome, email, telemóvel, notas) são apagados, o login é bloqueado e a
        conta deixa de aparecer em "Todos clientes". Compras e marcações
        anteriores ficam registadas de forma anonimizada por obrigação legal de
        contabilidade.
      </div>
      <div>
        <label className="label" htmlFor={`confirm-${clientId}`}>
          Escreve <strong>APAGAR</strong> para confirmar
        </label>
        <input
          id={`confirm-${clientId}`}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoComplete="off"
          className="input"
          placeholder="APAGAR"
        />
      </div>
      {err && (
        <div className="rounded-md bg-red-100 px-3 py-2 text-xs text-red-800">{err}</div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || val.trim() !== "APAGAR"}
          className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "A apagar…" : "Apagar definitivamente"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setVal("");
            setErr(null);
          }}
          className="btn-outline text-xs"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
