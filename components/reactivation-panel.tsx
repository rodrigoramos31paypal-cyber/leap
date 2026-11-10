"use client";

import Link from "next/link";
import { CalendarClock, MessageCircle, MoreHorizontal, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { claimReactivationPopup, snoozeReactivation } from "@/app/admin/reativacao/actions";
import type { ReactivationAlert } from "@/lib/reactivation";
import { eur, formatDateTime } from "@/lib/utils";

export type ReactivationRow = ReactivationAlert & { name: string; sent: boolean };
const colors: Record<string,string> = {
  level3: "bg-red-100 text-red-900 dark:bg-red-400/10 dark:text-red-300", level2: "bg-orange-100 text-orange-900 dark:bg-orange-400/10 dark:text-orange-300",
  level1: "bg-yellow-100 text-yellow-900 dark:bg-yellow-400/10 dark:text-yellow-200", empty: "bg-orange-100 text-orange-900 dark:bg-orange-400/10 dark:text-orange-300",
  low: "bg-yellow-100 text-yellow-900 dark:bg-yellow-400/10 dark:text-yellow-200", misses: "bg-yellow-100 text-yellow-900 dark:bg-yellow-400/10 dark:text-yellow-200",
};

function reasonLabel(reason: string, row: ReactivationRow) {
  if (reason.startsWith("level")) return `Sem treinar há ${row.days} dias`;
  if (reason === "low") return row.remaining === 1 ? "Resta 1 sessão" : "Restam 2 sessões";
  if (reason === "empty") return "Pack esgotado";
  return "2 ou mais faltas ou cancelamentos tardios";
}

export function ReactivationPanel({ week, rows, summary }: {
  week?: string; rows: ReactivationRow[]; summary: { sent: number; recovered: number; revenue: number };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const current = rows.filter(row => !removed.includes(row.id));
  const [expanded, setExpanded] = useState<string>();
  const hasAlerts = rows.length > 0;

  useEffect(() => {
    if (!week || !hasAlerts) return;
    let active = true;
    // Strict Mode can repeat effects while the first claim is still in flight.
    const timer = window.setTimeout(() => {
      void claimReactivationPopup(week).then(show => {
        if (active && show && !dialog.current?.open) dialog.current?.showModal();
      }).catch(() => {});
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [week, hasAlerts]);

  function snooze(id: string, duration: "week" | "month") {
    setError("");
    startTransition(async () => {
      try {
        if (await snoozeReactivation(id,duration)) {
          setRemoved(previous => [...previous,id]);
          return;
        }
      } catch {}
      setError("Não foi possível adiar o alerta. Tenta novamente.");
    });
  }

  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className="card flex h-full flex-col p-3 text-left sm:p-4">
        <span className="flex min-h-[28px] w-full items-start justify-between gap-2 text-ink-500 sm:min-h-[34px]">
          <span className="text-[10px] uppercase tracking-wide sm:text-xs">Reativação</span>
          <span className="relative"><TriangleAlert size={16} aria-hidden="true" />
            {current.some(row => !row.sent) && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-orange-500"><span className="sr-only">Alertas por tratar</span></span>}
          </span>
        </span>
        <strong className="mt-auto pt-1.5 font-display text-xl sm:text-2xl">{current.length}</strong>
        <span className="text-xs text-ink-500">{summary.recovered} recuperados este mês</span>
      </button>
      <dialog ref={dialog} aria-labelledby="reactivation-title" className="m-auto w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-2xl border border-ink-900/10 bg-white p-0 text-ink-900 shadow-2xl backdrop:bg-black/70 dark:border-white/10 dark:bg-ink-800 dark:text-bone-50">
        <div className="flex max-h-[82dvh] flex-col">
          <header className="shrink-0 border-b border-ink-900/10 px-4 pb-3 pt-4 dark:border-white/10 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gold-700 dark:text-gold-300">Reativação · Resumo da semana</p>
                <h2 id="reactivation-title" className="mt-1 font-display text-lg font-bold leading-tight sm:text-xl">{current.length} {current.length === 1 ? "cliente precisa" : "clientes precisam"} de atenção</h2>
              </div>
              <button type="button" onClick={() => dialog.current?.close()} className="grid size-11 shrink-0 place-items-center rounded-full text-ink-500 hover:bg-ink-900/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 dark:hover:bg-white/10" aria-label="Fechar"><X size={18} /></button>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-1.5">
              {[
                ["Mensagens este mês", summary.sent],
                ["Clientes recuperados", summary.recovered],
                ["Receita recuperada", eur(summary.revenue)],
              ].map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col gap-1 rounded-lg bg-bone-100 px-2 py-2 dark:bg-white/5 sm:px-3">
                  <dt className="text-[10px] leading-tight text-ink-500 sm:text-xs">{label}</dt>
                  <dd className="order-first font-display text-base font-bold tabular-nums sm:text-lg">{value}</dd>
                </div>
              ))}
            </dl>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6">
            {error && <p role="alert" className="py-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
            {current.length === 0 && <p className="py-4 text-sm text-ink-500">Sem alertas para esta semana.</p>}
            <ul className="divide-y divide-ink-900/10 dark:divide-white/10">
              {current.map(row => (
                <li key={row.id} className="py-3">
                  <div className="flex items-start gap-2.5">
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-gold-100 text-xs font-bold text-gold-700 dark:bg-gold-400/10 dark:text-gold-300">{row.name.slice(0,1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Link href={`/admin/clientes/${row.client_id}`} className="break-words text-sm font-bold hover:underline">{row.name}</Link>
                      <div className="flex flex-wrap gap-1">{row.reasons.map(reason => <span key={reason} className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${colors[reason]}`}>{reasonLabel(reason,row)}</span>)}</div>
                      <p className="text-[11px] text-ink-500">Último treino: {row.last_session ? formatDateTime(row.last_session) : "sem registo"} · Saldo: {row.remaining} {row.remaining === 1 ? "sessão" : "sessões"}</p>
                    </div>
                    <button type="button" aria-label={`Mais opções para ${row.name}`} aria-expanded={expanded === row.id} aria-controls={`reactivation-options-${row.id}`} onClick={() => setExpanded(expanded === row.id ? undefined : row.id)} className="grid size-11 shrink-0 place-items-center rounded-lg text-ink-500 hover:bg-ink-900/5 dark:hover:bg-white/10">
                      <MoreHorizontal size={19} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="ml-[2.625rem]">
                    {row.sent ? <p className="mt-2 text-xs font-medium text-ink-500">Mensagem enviada nos últimos 7 dias</p> :
                      <Link href={`/admin/mensagens?cliente=${row.client_id}&reativacao=${row.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-xs font-semibold text-gold-700 hover:underline dark:text-gold-300">
                        <MessageCircle size={15} aria-hidden="true" /> Enviar mensagem
                      </Link>}
                    <div id={`reactivation-options-${row.id}`} hidden={expanded !== row.id} className="rounded-lg bg-bone-100 px-2 dark:bg-white/5">
                      <button type="button" disabled={pending} onClick={() => snooze(row.id,"week")} className="flex min-h-11 w-full items-center gap-2 text-left text-xs font-medium hover:underline disabled:opacity-50">
                        <CalendarClock size={15} aria-hidden="true" /> Lembrar na próxima semana
                      </button>
                      <button type="button" disabled={pending} onClick={() => snooze(row.id,"month")} className="min-h-11 w-full border-t border-ink-900/10 text-left text-xs font-medium hover:underline disabled:opacity-50 dark:border-white/10">Ignorar 30 dias</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </dialog>
    </>
  );
}
