"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteAccountAction } from "@/app/app/perfil/actions";

// RGPD · apagar conta com type-to-confirm ("APAGAR"). A action anonimiza
// os dados pessoais e bloqueia o login (mantém registos financeiros
// anonimizados por obrigação de retenção contabilística).
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");

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
    <form action={deleteAccountAction} className="space-y-3">
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
          name="confirm"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoComplete="off"
          className="input"
          placeholder="APAGAR"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={val.trim() !== "APAGAR"}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          Apagar definitivamente
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setVal("");
          }}
          className="btn-outline"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
