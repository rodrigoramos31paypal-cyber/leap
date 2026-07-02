"use client";

// ════════════════════════════════════════════════════════════════
// LateCancelReview · linha + pop-up de decisão sobre um cancelamento
// TARDIO feito pelo cliente. Por baixo do chip "Cancelada" mostra o
// estado ("Por rever" / "Aprovado" / "Rejeitado"), sempre clicável.
//
// • autoOpen: abre o pop-up automaticamente quando o admin chega pela
//   notificação do sino (?review=<booking>). Ao montar, limpa o param
//   `review` do URL para não reabrir ao mudar de filtro.
// • Aprovar → devolve a sessão ao saldo (e avisa o cliente).
//   Rejeitar → mantém-na descontada (default). Reversível.
// ════════════════════════════════════════════════════════════════

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Check, X, AlertTriangle } from "lucide-react";
import { reviewLateCancelAction } from "./actions";

type ReviewStatus = "pending" | "approved" | "rejected";

export function LateCancelReview({
  bookingId,
  clientId,
  status,
  whenLabel,
  autoOpen = false,
}: {
  bookingId: string;
  clientId: string;
  status: ReviewStatus;
  whenLabel: string;
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<ReviewStatus>(status);
  const [open, setOpen] = useState(autoOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Chegou pela notificação: abre já e tira o ?review do URL para não
  // reabrir sempre que o admin mudar de filtro/página.
  useEffect(() => {
    if (!autoOpen) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("review")) {
      url.searchParams.delete("review");
      router.replace(url.pathname + url.search, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open]);

  function decide(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await reviewLateCancelAction({ bookingId, clientId, approve });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível registar a decisão.");
        return;
      }
      setCurrent(approve ? "approved" : "rejected");
      setOpen(false);
      router.refresh();
    });
  }

  const line =
    current === "approved"
      ? { label: "Cancelamento aprovado", cls: "text-emerald-700 dark:text-emerald-400", Icon: Check }
      : current === "rejected"
        ? { label: "Cancelamento rejeitado", cls: "text-red-700 dark:text-red-400", Icon: X }
        : { label: "Por rever", cls: "text-amber-700 dark:text-amber-400", Icon: AlertTriangle };

  const LineIcon = line.Icon;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold transition hover:bg-ink-900/5 dark:hover:bg-white/5 ${line.cls}`}
        title="Rever cancelamento tardio"
      >
        <LineIcon size={12} />
        {line.label}
        <span className="text-ink-400">· alterar</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl dark:bg-ink-800 sm:max-w-md sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="inline-flex items-center gap-2 font-display text-lg font-bold">
                <RotateCcw size={18} /> Cancelamento tardio
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-500 hover:bg-ink-900/5"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-ink-900/10 bg-bone-50 p-3 text-sm dark:border-white/10 dark:bg-ink-900">
              <p className="text-ink-700 dark:text-bone-100">
                O cliente cancelou a sessão de{" "}
                <span className="font-semibold text-ink-900 dark:text-bone-50">{whenLabel}</span> com
                menos de 12h de antecedência. Por regra a sessão é descontada.
              </p>
              <p className="mt-2 text-ink-600 dark:text-bone-200">
                Queres <span className="font-semibold">devolver</span> a sessão ao cliente?
              </p>
              <p className="mt-1 text-[11px] text-ink-500">
                Decisão atual: <span className="font-semibold">{line.label}</span>. Podes alterá-la a
                qualquer momento.
              </p>
            </div>

            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => decide(false)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-400/30 dark:text-red-400"
              >
                <X size={16} /> Não devolver
              </button>
              <button
                type="button"
                onClick={() => decide(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Check size={16} />
                {pending ? "A guardar…" : "Sim, devolver sessão"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
