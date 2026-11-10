"use client";

import Link from "next/link";
import { TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { claimReactivationPopup, snoozeReactivation } from "@/app/admin/reativacao/actions";
import type { ReactivationAlert } from "@/lib/reactivation";
import { eur, formatDateTime } from "@/lib/utils";

export type ReactivationRow = ReactivationAlert & { name: string; sent: boolean };
const colors: Record<string,string> = {
  level3: "bg-red-100 text-red-900", level2: "bg-orange-100 text-orange-900",
  level1: "bg-yellow-100 text-yellow-900", empty: "bg-orange-100 text-orange-900",
  low: "bg-yellow-100 text-yellow-900", misses: "bg-yellow-100 text-yellow-900",
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
      <dialog ref={dialog} aria-labelledby="reactivation-title" className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl bg-white p-4 text-ink-900 shadow-xl backdrop:bg-black/60 dark:bg-ink-800 dark:text-bone-50 sm:p-6">
        <header className="flex items-start justify-between gap-2">
          <h2 id="reactivation-title" className="font-display text-xl font-bold">Resumo da semana: {current.length} {current.length === 1 ? "cliente precisa" : "clientes precisam"} de atenção</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="p-2" aria-label="Fechar"><X size={18} /></button>
        </header>
        <dl className="my-4 grid grid-cols-3 gap-2 rounded-xl bg-bone-100 p-3 text-xs dark:bg-white/5">
          <div><dt>Mensagens este mês</dt><dd className="text-base font-bold">{summary.sent}</dd></div>
          <div><dt>Clientes recuperados</dt><dd className="text-base font-bold">{summary.recovered}</dd></div>
          <div><dt>Receita recuperada</dt><dd className="text-base font-bold">{eur(summary.revenue)}</dd></div>
        </dl>
        {error && <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
        {current.length === 0 && <p className="text-sm text-ink-500">Sem alertas para esta semana.</p>}
        <ul className="space-y-3">
          {current.map(row => (
            <li key={row.id} className="card p-3">
              <div className="flex gap-3">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-gold-100 font-bold text-black">{row.name.slice(0,1).toUpperCase()}</span>
                <div className="min-w-0 space-y-1">
                  <Link href={`/admin/clientes/${row.client_id}`} className="font-bold hover:underline">{row.name}</Link>
                  <div className="flex flex-wrap gap-1">{row.reasons.map(reason => <span key={reason} className={`rounded-full px-2 py-0.5 text-xs ${colors[reason]}`}>{reasonLabel(reason,row)}</span>)}</div>
                  <p className="text-xs text-ink-500">Último treino: {row.last_session ? formatDateTime(row.last_session) : "sem registo"} · Saldo: {row.remaining} {row.remaining === 1 ? "sessão" : "sessões"}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {row.sent ? <span className="text-xs font-semibold">Mensagem enviada nos últimos 7 dias</span> :
                  <Link href={`/admin/mensagens?cliente=${row.client_id}&reativacao=${row.id}`} className="btn-primary text-xs">Enviar mensagem</Link>}
                <button type="button" disabled={pending} onClick={() => snooze(row.id,"week")} className="btn-outline text-xs">Lembrar na próxima semana</button>
                <button type="button" disabled={pending} onClick={() => snooze(row.id,"month")} className="btn-outline text-xs">Ignorar 30 dias</button>
              </div>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}
