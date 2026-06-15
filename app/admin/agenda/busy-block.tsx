"use client";

// ════════════════════════════════════════════════════════════════
// BusyBlock · rectângulo "Ocupado" na grelha da semana, agora
// clicável. Ao clicar em qualquer ponto do bloco abre um modal que
// permite ao trainer:
//   • alterar as horas ocupadas;
//   • (recorrente) aplicar a alteração só a este dia OU a todas as
//     semanas;
//   • remover o bloqueio (este dia / a recorrência inteira).
// ════════════════════════════════════════════════════════════════
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, X } from "lucide-react";
import {
  updateBlockAction,
  updateRecurringBlockAction,
  deleteBlockAction,
  deleteRecurringBlockAction,
  skipRecurringDateAction,
  createBusyAction,
} from "./actions";

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = (i % 2) * 30;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

function hhmmLocal(iso: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function isoLocal(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

export function BusyBlock({
  b,
  canEdit = false,
  style,
}: {
  b: any;
  canEdit?: boolean;
  style: React.CSSProperties;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isRecurring = !!b.is_recurring;
  const date = isoLocal(b.starts_at);
  // Horas ORIGINAIS do bloco — usadas para identificar o "grupo" de
  // regras recorrentes (mesmo intervalo, vários dias) ao aplicar
  // "Todas as semanas". Não mudam quando o utilizador edita os selects.
  const origFrom = hhmmLocal(b.starts_at);
  const origTo = hhmmLocal(b.ends_at);
  const [from, setFrom] = useState(origFrom);
  const [to, setTo] = useState(origTo);
  const [reason, setReason] = useState<string>(b.reason ?? "");
  // Para recorrentes: aplicar a alteração só a este dia ou a todas as semanas.
  const [scope, setScope] = useState<"single" | "all">("all");

  function close() {
    setOpen(false);
    setError(null);
  }

  function handleSave() {
    setError(null);
    if (to <= from) {
      setError("A hora de fim tem de ser depois do início.");
      return;
    }
    startTransition(async () => {
      let res: { ok?: true; error?: string } | void;
      if (!isRecurring) {
        const fd = new FormData();
        fd.set("id", b.id);
        fd.set("date", date);
        fd.set("from", from);
        fd.set("to", to);
        fd.set("reason", reason.trim());
        res = await updateBlockAction(fd);
      } else if (scope === "all") {
        const fd = new FormData();
        fd.set("id", b.recurring_id);
        fd.set("from", from);
        fd.set("to", to);
        fd.set("reason", reason.trim());
        // grupo: todos os dias-da-semana criados com este mesmo intervalo
        fd.set("oldFrom", origFrom);
        fd.set("oldTo", origTo);
        res = await updateRecurringBlockAction(fd);
      } else {
        // só este dia: limpa a recorrência nesta data e cria um bloqueio
        // pontual com as novas horas.
        const sk = new FormData();
        sk.set("trainerId", b.trainer_id);
        sk.set("date", date);
        await skipRecurringDateAction(sk);
        const fd = new FormData();
        fd.set("trainerId", b.trainer_id);
        fd.set("mode", "single");
        fd.set("date", date);
        fd.set("from", from);
        fd.set("to", to);
        fd.set("reason", reason.trim());
        res = await createBusyAction(fd);
      }
      if (res && res.error) {
        setError(res.error);
        return;
      }
      close();
      router.refresh();
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      if (!isRecurring) {
        const fd = new FormData();
        fd.set("id", b.id);
        await deleteBlockAction(fd);
      } else if (scope === "all") {
        const fd = new FormData();
        fd.set("id", b.recurring_id);
        fd.set("oldFrom", origFrom);
        fd.set("oldTo", origTo);
        await deleteRecurringBlockAction(fd);
      } else {
        const fd = new FormData();
        fd.set("trainerId", b.trainer_id);
        fd.set("date", date);
        await skipRecurringDateAction(fd);
      }
      close();
      router.refresh();
    });
  }

  return (
    <div
      className="absolute left-0.5 right-0.5 overflow-hidden rounded border border-red-200 bg-red-50 text-red-800"
      style={style}
    >
      <button
        type="button"
        onClick={() => canEdit && setOpen(true)}
        disabled={!canEdit}
        className={`flex h-full w-full flex-col px-0.5 py-0.5 text-left ${canEdit ? "cursor-pointer" : "cursor-default"}`}
        title={b.reason ?? "Ocupado"}
      >
        <div className="text-[8px] font-semibold leading-none">Ocupado</div>
        {isRecurring && (
          <div className="mt-0.5 text-[6px] font-medium uppercase leading-none tracking-tight text-red-700/70">
            recorrente
          </div>
        )}
        {b.reason && <div className="mt-0.5 truncate text-red-700/80">{b.reason}</div>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 text-sm text-ink-900 shadow-xl dark:bg-ink-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="inline-flex items-center gap-1.5 font-display text-base font-bold">
                <Ban size={15} className="text-red-600" /> Ocupado
                {isRecurring && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-red-700">
                    recorrente
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={close}
                className="rounded p-1 text-ink-500 hover:bg-ink-900/5"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            {isRecurring && (
              <div className="mb-3 inline-flex w-full items-center gap-1 rounded-lg border border-ink-900/10 bg-bone-50 p-1 text-sm dark:border-white/10 dark:bg-ink-900">
                <button
                  type="button"
                  onClick={() => setScope("single")}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                    scope === "single" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                  }`}
                >
                  Só este dia
                </button>
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                    scope === "all" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                  }`}
                >
                  Todas as semanas
                </button>
              </div>
            )}

            <p className="mb-3 text-[12px] text-ink-500">
              Dia: <span className="font-medium text-ink-700">{date}</span>
            </p>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="label" htmlFor="busy_edit_from">Das</label>
                <select
                  id="busy_edit_from"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="input"
                >
                  {!TIMES.includes(from) && <option value={from}>{from}</option>}
                  {TIMES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="label" htmlFor="busy_edit_to">Até</label>
                <select
                  id="busy_edit_to"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="input"
                >
                  {!TIMES.includes(to) && <option value={to}>{to}</option>}
                  {TIMES.slice(1).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-3">
              <label className="label" htmlFor="busy_edit_reason">Motivo (opcional)</label>
              <input
                id="busy_edit_reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex: outro emprego, almoço…"
                className="input"
              />
            </div>

            {error && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleRemove}
                disabled={pending}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                {isRecurring && scope === "all" ? "Remover recorrência" : "Remover"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={pending}
                className="btn-primary inline-flex items-center gap-1.5"
              >
                {pending ? "A guardar…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
