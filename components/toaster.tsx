"use client";

// ════════════════════════════════════════════════════════════════
// Toaster · mostra confirmações depois de server actions.
// Recebe a flash inicial (lida a partir do cookie no layout RSC)
// e auto-dismiss em ~4s.
// ════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import type { Flash } from "@/lib/flash-types";

export function Toaster({ initial }: { initial: Flash | null }) {
  const [items, setItems] = useState<Array<Flash & { id: string }>>([]);

  // empurra a flash inicial recebida do servidor (uma vez por mount).
  useEffect(() => {
    if (initial) push(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.title, initial?.kind, initial?.body]);

  // permite a outros componentes client emitirem toasts via window event.
  useEffect(() => {
    function onToast(e: Event) {
      const ce = e as CustomEvent<Flash>;
      if (ce.detail) push(ce.detail);
    }
    window.addEventListener("leap:toast", onToast as EventListener);
    return () => window.removeEventListener("leap:toast", onToast as EventListener);
  }, []);

  function push(t: Flash) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setItems((arr) => [...arr, { ...t, id }]);
    window.setTimeout(() => {
      setItems((arr) => arr.filter((x) => x.id !== id));
    }, 4000);
  }

  function dismiss(id: string) {
    setItems((arr) => arr.filter((x) => x.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${
            t.kind === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : t.kind === "info"
                ? "border-ink-900/10 bg-white text-ink-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <span className="mt-0.5">
            {t.kind === "error" ? (
              <AlertCircle size={16} />
            ) : t.kind === "info" ? (
              <Info size={16} />
            ) : (
              <CheckCircle2 size={16} />
            )}
          </span>
          <div className="flex-1">
            <div className="font-semibold">{t.title}</div>
            {t.body && <div className="mt-0.5 text-xs opacity-80">{t.body}</div>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="rounded p-1 opacity-60 hover:opacity-100"
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
