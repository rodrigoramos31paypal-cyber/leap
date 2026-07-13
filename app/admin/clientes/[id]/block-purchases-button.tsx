"use client";

// ════════════════════════════════════════════════════════════════
// Botão de bloqueio de compras — mostra o ESTADO atual, não a ação:
//   • cliente OK      → "Bloquear compras" (contorno vermelho); clicar
//                        bloqueia.
//   • cliente bloqueado → "Bloqueado" (vermelho cheio + cadeado); clicar
//                        desbloqueia e volta a "Bloquear compras".
//
// Extras:
//   • diálogo de confirmação antes de submeter (ação destrutiva);
//   • estado "a carregar" via useFormStatus — feedback imediato no clique.
//
// Vive DENTRO do <form action={setClientBannedAction}>. O banner vermelho
// persistente e o toast são tratados no servidor (flash + revalidate).
// ════════════════════════════════════════════════════════════════
import { useFormStatus } from "react-dom";
import { Ban, Lock, Loader2 } from "lucide-react";

export function BlockPurchasesButton({ banned }: { banned: boolean }) {
  const { pending } = useFormStatus();

  const confirmMsg = banned
    ? "Desbloquear compras deste cliente? Volta a poder comprar packs."
    : "Bloquear compras deste cliente? Não vai conseguir comprar packs até desbloqueares.";

  return (
    <button
      type="submit"
      disabled={pending}
      title={banned ? "Cliente bloqueado — carregar para desbloquear" : "Carregar para bloquear compras"}
      aria-label={banned ? "Cliente bloqueado — desbloquear compras" : "Bloquear compras"}
      onClick={(e) => {
        // Cancelar no diálogo impede o submit do server action.
        if (!window.confirm(confirmMsg)) e.preventDefault();
      }}
      className={
        "inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 " +
        (banned
          ? // ESTADO bloqueado: vermelho cheio, inequívoco.
            "border border-red-600 bg-red-600 text-white hover:bg-red-700"
          : // ESTADO ok: contorno vermelho discreto.
            "btn-outline border-red-200 text-red-700 hover:bg-red-50")
      }
    >
      {pending ? (
        <>
          <Loader2 size={13} className="animate-spin" />
          {banned ? "A desbloquear…" : "A bloquear…"}
        </>
      ) : banned ? (
        <>
          <Lock size={13} />
          Bloqueado
        </>
      ) : (
        <>
          <Ban size={13} />
          Bloquear compras
        </>
      )}
    </button>
  );
}
