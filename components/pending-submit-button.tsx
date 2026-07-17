"use client";

// ════════════════════════════════════════════════════════════════
// Botão de submit que se DESACTIVA (fica cinzento) e mostra "a carregar"
// enquanto o server action do <form> pai está em curso (useFormStatus).
//
// Objectivo: impedir reenviar o form em duplo/triplo-clique — a causa dos
// emails de cancelamento em duplicado. NOTA: isto é só a camada de UX; o
// gate real (idempotência) está no servidor — cancel_booking devolve
// false em cliques repetidos (migration 0139) e as actions só enviam
// email/auditoria no 1º pedido. Aqui damos feedback imediato e evitamos
// que o 2º/3º pedido chegue sequer ao servidor.
//
// Genérico: envolve QUALQUER conteúdo de botão e preserva o className.
// ════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function PendingSubmitButton({
  children,
  pendingLabel,
  className = "",
  confirmMessage,
  showSpinner = true,
}: {
  children: ReactNode;
  /** Conteúdo mostrado enquanto o pedido está em curso (default: children). */
  pendingLabel?: ReactNode;
  className?: string;
  /** Se definido, pede confirmação (window.confirm) antes de submeter. */
  confirmMessage?: string;
  showSpinner?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      className={className + " disabled:cursor-not-allowed disabled:opacity-60"}
    >
      {pending ? (
        <span className="inline-flex items-center justify-center gap-1.5">
          {showSpinner ? <Loader2 size={13} className="animate-spin" /> : null}
          {pendingLabel ?? children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
