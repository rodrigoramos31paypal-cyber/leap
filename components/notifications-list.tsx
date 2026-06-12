"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Trash2, RefreshCcw } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { deleteNotificationAction } from "@/app/app/notificacoes/actions";

type Notif = {
  id: string;
  type: string | null;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
};

// Realça a palavra "Motivo:" a bold para o utilizador localizar
// rapidamente a razão dada pelo trainer.
function NotificationBody({ body }: { body: string }) {
  const idx = body.indexOf("Motivo:");
  if (idx < 0) return <>{body}</>;
  const before = body.slice(0, idx);
  const after = body.slice(idx + "Motivo:".length);
  return (
    <>
      {before}
      <strong className="font-semibold text-ink-900 dark:text-bone-50">Motivo:</strong>
      {after}
    </>
  );
}

/**
 * Lista de notificações gerida no cliente. O server passa as 10 mais
 * recentes; ao apagar uma, REMOVEMOS apenas dessa lista local em vez
 * de re-fetchar — assim o utilizador vê "10 → 9" e não uma antiga
 * a tomar o lugar da apagada.
 */
export function NotificationsList({
  initial,
  scope,
}: {
  initial: Notif[];
  scope: "app" | "admin";
}) {
  const [items, setItems] = useState<Notif[]>(initial);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function handleDelete(id: string) {
    // Optimistic UI — remove já localmente. Se a server action falhar,
    // o setFlash mostra erro mas o utilizador pode dar refresh manual.
    setBusyId(id);
    setItems((arr) => arr.filter((n) => n.id !== id));
    const fd = new FormData();
    fd.set("notifId", id);
    fd.set("scope", scope);
    startTransition(async () => {
      try {
        await deleteNotificationAction(fd);
      } finally {
        setBusyId(null);
      }
    });
  }

  if (items.length === 0) {
    return (
      <div className="card p-5 text-center text-sm text-ink-500">Sem notificações.</div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((n) => {
        // Só sessões canceladas pelo trainer geram CTA — as outras
        // notificações são meramente informativas.
        const isCancelled = scope === "app" && n.type === "booking_cancelled";
        return (
          <li key={n.id} className={`card p-4 ${busyId === n.id ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{n.title}</div>
                {n.body && (
                  <div className="mt-0.5 text-xs text-ink-500">
                    <NotificationBody body={n.body} />
                  </div>
                )}
                <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-500/70">
                  {formatDateTime(n.created_at)}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {isCancelled && (
                  <Link
                    href="/app/agenda?rebook=1"
                    className="inline-flex items-center gap-1 text-xs font-medium text-gold-600 hover:text-gold-700"
                  >
                    <RefreshCcw size={11} /> Reagendar
                  </Link>
                )}
                {scope === "admin" && n.link && (
                  <Link
                    href={n.link}
                    className="text-xs font-medium text-gold-600 hover:text-gold-700"
                  >
                    Abrir →
                  </Link>
                )}
                <button
                  type="button"
                  disabled={pending && busyId === n.id}
                  onClick={() => handleDelete(n.id)}
                  className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-red-600 disabled:opacity-50"
                  aria-label="Eliminar notificação"
                >
                  <Trash2 size={11} /> Eliminar
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
