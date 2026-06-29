"use client";

// ════════════════════════════════════════════════════════════════
// Botão "Bloquear compras" / "Reativar conta" com feedback visível:
//   • diálogo de confirmação antes de submeter (ação destrutiva);
//   • estado "a carregar" via useFormStatus — feedback imediato no
//     clique (resolve o "carrego e não acontece nada").
//
// Vive DENTRO do <form action={setClientBannedAction}> do perfil do
// cliente. A confirmação persistente (banner vermelho) e o toast de
// sucesso/erro são tratados no lado servidor (flash + revalidate).
// ════════════════════════════════════════════════════════════════
import { useFormStatus } from "react-dom";
import { Ban, RotateCcw, Loader2 } from "lucide-react";

export function BlockPurchasesButton({ banned }: { banned: boolean }) {
  const { pending } = useFormStatus();

  const confirmMsg = banned
    ? "Reativar esta conta? O cliente volta a poder comprar packs."
    : "Bloquear compras deste cliente? Não vai conseguir comprar packs até reativares.";

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        // Cancelar no diálogo impede o submit do server action.
        if (!window.confirm(confirmMsg)) e.preventDefault();
      }}
      className={
        "inline-flex w-full items-center justify-center gap-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60 " +
        (banned
          ? "btn-primary"
          : "btn-outline border-red-200 text-red-700 hover:bg-red-50")
      }
    >
      {pending ? (
        <>
          <Loader2 size={13} className="animate-spin" />
          {banned ? "A reativar…" : "A bloquear…"}
        </>
      ) : (
        <>
          {banned ? <RotateCcw size={13} /> : <Ban size={13} />}
          {banned ? "Reativar conta" : "Bloquear compras"}
        </>
      )}
    </button>
  );
}
