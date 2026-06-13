"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteAccountAction } from "@/app/app/perfil/actions";

// RGPD · apagar conta com type-to-confirm ("APAGAR"). Chama a action
// programaticamente (useTransition) e navega no cliente — mais fiável
// que <form action> + redirect, e mostra erros em vez de falhar em
// silêncio.
export function DeleteAccountSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    const fd = new FormData();
    fd.set("confirm", val);
    startTransition(async () => {
      const r = await deleteAccountAction(fd);
      if (r?.ok) {
        router.push("/");
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
        className="inline-flex items-center gap-1.5 text-sm font-medium text-red-700 hover:text-red-800"
      >
        <Trash2 size={14} /> Apagar a minha conta
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
        Esta ação é <strong>irreversível</strong>. Os teus dados pessoais (nome, email,
        telemóvel, notas) são apagados e perdes o acesso à conta. Os registos de
        pagamento são mantidos de forma anonimizada por obrigação legal de contabilidade.
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Escreve <strong>APAGAR</strong> para confirmar
        </label>
        <input
          id="confirm"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoComplete="off"
          className="input"
          placeholder="APAGAR"
        />
      </div>
      {err && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || val.trim() !== "APAGAR"}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
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
          className="btn-outline"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
