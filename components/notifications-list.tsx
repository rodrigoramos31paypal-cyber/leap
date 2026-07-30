"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  Trash2,
  RefreshCcw,
  CalendarPlus,
  CalendarX,
  Coins,
  UserPlus,
  Star,
  Bell,
  AlertTriangle,
} from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { deleteNotificationAction, deleteAllNotificationsAction } from "@/app/app/notificacoes/actions";

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
// Estilo por tipo de notificação (ícone + cores) para o design premium.
function notifStyle(type: string | null) {
  const t = type ?? "";
  if (t.includes("cancel")) return { Icon: CalendarX, box: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" };
  if (t.includes("payment") || t.includes("pending")) return { Icon: Coins, box: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  if (t.includes("booking") || t.includes("reschedul") || t.includes("reminder")) return { Icon: CalendarPlus, box: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
  if (t.includes("signup") || t.includes("client") || t.includes("account")) return { Icon: UserPlus, box: "bg-[#EEEDFE] text-[#534AB7] dark:bg-[#534AB7]/25 dark:text-[#AFA9EC]" };
  if (t.includes("rating") || t.includes("review")) return { Icon: Star, box: "bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300" };
  if (t.includes("credit")) return { Icon: AlertTriangle, box: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  return { Icon: Bell, box: "bg-ink-900/[0.06] text-ink-500 dark:bg-white/10 dark:text-bone-100/70" };
}

function nfDayKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function nfDayLabel(iso: string) {
  const now = new Date();
  const today = nfDayKey(now.toISOString());
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = nfDayKey(y.toISOString());
  const k = nfDayKey(iso);
  if (k === today) return "Hoje";
  if (k === yesterday) return "Ontem";
  const p = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", weekday: "short", day: "2-digit", month: "short" }).format(new Date(iso)).replace(/\./g, "");
  return p.charAt(0).toUpperCase() + p.slice(1);
}
function nfTime(iso: string) {
  return new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function NotificationsList({
  initial,
  scope,
  premium = false,
}: {
  initial: Notif[];
  scope: "app" | "admin";
  premium?: boolean;
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

  function handleClearAll() {
    // Optimista: limpa já localmente; a server action apaga na BD.
    setItems([]);
    const fd = new FormData();
    fd.set("scope", scope);
    startTransition(async () => {
      await deleteAllNotificationsAction(fd);
    });
  }

  if (premium) {
    if (items.length === 0) {
      return <div className="card p-6 text-center text-sm text-ink-500">Sem notificações.</div>;
    }
    const groups: { key: string; label: string; items: Notif[] }[] = [];
    for (const n of items) {
      const key = nfDayKey(n.created_at);
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: nfDayLabel(n.created_at), items: [] };
        groups.push(g);
      }
      g.items.push(n);
    }
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleClearAll}
            disabled={pending}
            className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-500 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 size={12} /> Limpar tudo
          </button>
        </div>
        {groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">{g.label}</div>
            <div className="card overflow-hidden p-0">
              <ul className="divide-y divide-ink-900/[0.06] dark:divide-white/[0.07]">
                {g.items.map((n) => {
                  const { Icon, box } = notifStyle(n.type);
                  const href = n.link || null;
                  const inner = (
                    <>
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${box}`}>
                        <Icon size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink-900 dark:text-bone-50">{n.title}</span>
                        {n.body && (
                          <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink-500">
                            <NotificationBody body={n.body} />
                          </span>
                        )}
                      </span>
                    </>
                  );
                  return (
                    <li key={n.id} className={`flex items-center gap-2.5 px-3 py-3 ${busyId === n.id ? "opacity-50" : ""}`}>
                      {href ? (
                        <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5 transition hover:opacity-80">
                          {inner}
                        </Link>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">{inner}</div>
                      )}
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-[10px] tabular-nums text-ink-400">{nfTime(n.created_at)}</span>
                        <button
                          type="button"
                          disabled={pending && busyId === n.id}
                          onClick={() => handleDelete(n.id)}
                          aria-label="Eliminar notificação"
                          className="text-ink-300 transition hover:text-red-600 disabled:opacity-50 dark:text-white/25"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card p-5 text-center text-sm text-ink-500">Sem notificações.</div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleClearAll}
          disabled={pending}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-red-600 disabled:opacity-50"
        >
          <Trash2 size={12} /> Limpar tudo
        </button>
      </div>
      <ul className="space-y-2">
      {items.map((n) => {
        // Só sessões canceladas pelo trainer geram CTA extra (reagendar) —
        // as outras notificações apenas abrem o seu assunto ao clicar.
        const isCancelled = scope === "app" && n.type === "booking_cancelled";
        // Destino do clique: o `link` guardado na notificação (sessão,
        // pagamento, etc.). Toda a notificação com link fica clicável.
        const href = n.link || null;

        // Conteúdo (título + corpo + data). Quando há `href`, embrulhamos
        // só este bloco num <Link> — os botões (eliminar / reagendar) ficam
        // como IRMÃOS, nunca aninhados dentro do link (âncora dentro de
        // âncora é HTML inválido).
        const content = (
          <>
            <div className="text-sm font-semibold">{n.title}</div>
            {n.body && (
              <div className="mt-0.5 text-xs text-ink-500">
                <NotificationBody body={n.body} />
              </div>
            )}
            <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-500/70">
              {formatDateTime(n.created_at)}
            </div>
          </>
        );

        return (
          <li key={n.id} className={`card p-4 ${busyId === n.id ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              {href ? (
                <Link
                  href={href}
                  className="group min-w-0 flex-1 -m-1 rounded-md p-1 transition hover:bg-ink-900/5 dark:hover:bg-white/5"
                >
                  {content}
                </Link>
              ) : (
                <div className="min-w-0 flex-1">{content}</div>
              )}
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {isCancelled && (
                  <Link
                    href="/app/agenda?rebook=1"
                    className="inline-flex items-center gap-1 text-xs font-medium text-gold-600 hover:text-gold-700"
                  >
                    <RefreshCcw size={11} /> Reagendar
                  </Link>
                )}
                {href && (
                  <Link
                    href={href}
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
    </div>
  );
}
