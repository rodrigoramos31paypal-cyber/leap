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
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, X } from "lucide-react";
import {
  updateBlockAction,
  updateRecurringBlockAction,
  updateRecurringWeekdaysAction,
  recurringBlockWeekdaysAction,
  deleteBlockAction,
  deleteRecurringBlockAction,
  skipRecurringDateAction,
  createBusyAction,
  splitBlockAction,
  splitRecurringBlockAction,
} from "./actions";

// 0=Dom … 6=Sáb (convenção day_of_week / Postgres dow).
const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

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
  // Pausa livre dentro do bloqueio ("split-on-save"): grava o bloqueio
  // como dois segmentos com um buraco no meio.
  const [hasFree, setHasFree] = useState(false);
  const [freeFrom, setFreeFrom] = useState("12:30");
  const [freeTo, setFreeTo] = useState("14:00");
  const [reason, setReason] = useState<string>(b.reason ?? "");
  // Para recorrentes: só este dia · dias-da-semana específicos · todos os dias.
  const [scope, setScope] = useState<"single" | "all" | "weekdays">("all");
  // Dias-da-semana escolhidos no scope "weekdays" (0=Dom … 6=Sáb).
  const [weekdaySel, setWeekdaySel] = useState<Set<number>>(new Set());

  // Ao abrir um bloqueio recorrente, pré-marca os dias que o grupo já cobre.
  useEffect(() => {
    if (!open || !isRecurring) return;
    let cancelled = false;
    const fallback = new Date(date + "T00:00:00").getDay();
    (async () => {
      try {
        const wd = await recurringBlockWeekdaysAction(b.trainer_id, origFrom, origTo);
        if (cancelled) return;
        setWeekdaySel(new Set(wd.length > 0 ? wd : [fallback]));
      } catch {
        if (!cancelled) setWeekdaySel(new Set([fallback]));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isRecurring]);

  function toggleWeekday(dow: number) {
    setWeekdaySel((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow);
      else next.add(dow);
      return next;
    });
  }

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
    if (hasFree) {
      if (freeTo <= freeFrom) {
        setError("A pausa livre: o fim tem de ser depois do início.");
        return;
      }
      if (freeFrom < from || freeTo > to) {
        setError("A pausa livre tem de estar dentro do intervalo ocupado.");
        return;
      }
      if (freeFrom === from && freeTo === to) {
        setError("A pausa livre não pode cobrir todo o intervalo.");
        return;
      }
    }
    if (scope === "weekdays" && weekdaySel.size === 0) {
      setError("Escolhe pelo menos um dia da semana.");
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
        if (hasFree) {
          // bloqueio pontual com pausa → substitui por dois segmentos.
          fd.set("trainerId", b.trainer_id);
          fd.set("freeFrom", freeFrom);
          fd.set("freeTo", freeTo);
          res = await splitBlockAction(fd);
        } else {
          res = await updateBlockAction(fd);
        }
      } else if (scope === "all") {
        const fd = new FormData();
        fd.set("id", b.recurring_id);
        fd.set("from", from);
        fd.set("to", to);
        fd.set("reason", reason.trim());
        // grupo: todos os dias-da-semana criados com este mesmo intervalo
        fd.set("oldFrom", origFrom);
        fd.set("oldTo", origTo);
        if (hasFree) {
          // recorrência com pausa → divide o grupo em dois intervalos.
          fd.set("freeFrom", freeFrom);
          fd.set("freeTo", freeTo);
          res = await splitRecurringBlockAction(fd);
        } else {
          res = await updateRecurringBlockAction(fd);
        }
      } else if (scope === "weekdays") {
        // aplica só aos dias-da-semana escolhidos (os outros ficam iguais).
        const fd = new FormData();
        fd.set("trainerId", b.trainer_id);
        fd.set("oldFrom", origFrom);
        fd.set("oldTo", origTo);
        fd.set("from", from);
        fd.set("to", to);
        if (hasFree) {
          fd.set("freeFrom", freeFrom);
          fd.set("freeTo", freeTo);
        }
        fd.set("reason", reason.trim());
        fd.set("weekdays", Array.from(weekdaySel).join(","));
        res = await updateRecurringWeekdaysAction(fd);
      } else {
        // só este dia: limpa a recorrência nesta data e cria um bloqueio
        // pontual com as novas horas (createBusyAction já trata a pausa).
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
        if (hasFree) {
          fd.set("freeFrom", freeFrom);
          fd.set("freeTo", freeTo);
        }
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
      } else if (scope === "weekdays") {
        // remove o bloqueio só nos dias-da-semana escolhidos.
        const fd = new FormData();
        fd.set("id", b.recurring_id);
        fd.set("oldFrom", origFrom);
        fd.set("oldTo", origTo);
        fd.set("weekdays", Array.from(weekdaySel).join(","));
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
        {b.reason && <div className="mt-0.5 truncate text-[9px] font-medium leading-none text-red-700/80">{b.reason}</div>}
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
              <div className="mb-3 inline-flex w-full items-center gap-1 rounded-lg border border-ink-900/10 bg-bone-50 p-1 text-xs dark:border-white/10 dark:bg-ink-900">
                <button
                  type="button"
                  onClick={() => setScope("single")}
                  className={`flex-1 rounded-md px-2 py-1.5 font-medium transition ${
                    scope === "single" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                  }`}
                >
                  Só este dia
                </button>
                <button
                  type="button"
                  onClick={() => setScope("weekdays")}
                  className={`flex-1 rounded-md px-2 py-1.5 font-medium transition ${
                    scope === "weekdays" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                  }`}
                >
                  Dias específicos
                </button>
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={`flex-1 rounded-md px-2 py-1.5 font-medium transition ${
                    scope === "all" ? "bg-ink-900 text-white dark:bg-bone-50 dark:text-ink-900" : "text-ink-600"
                  }`}
                >
                  Todos os dias
                </button>
              </div>
            )}

            {isRecurring && scope === "weekdays" && (
              <div className="mb-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="label mb-0">Aplicar a</div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setWeekdaySel(new Set([0, 1, 2, 3, 4, 5, 6]))}
                      className="rounded-md border border-ink-900/15 px-2 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-900/5"
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekdaySel(new Set())}
                      className="rounded-md border border-ink-900/15 px-2 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-900/5"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                    const on = weekdaySel.has(dow);
                    return (
                      <button
                        key={dow}
                        type="button"
                        onClick={() => toggleWeekday(dow)}
                        aria-pressed={on}
                        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                          on
                            ? "border-ink-900 bg-ink-900 text-white dark:border-bone-50 dark:bg-bone-50 dark:text-ink-900"
                            : "border-ink-900/15 text-ink-600 hover:bg-ink-900/5"
                        }`}
                      >
                        {WEEKDAY_LABELS[dow]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-ink-500">
                  A alteração aplica-se só a estes dias; os restantes ficam iguais.
                </p>
              </div>
            )}

            {scope !== "weekdays" && (
              <p className="mb-3 text-[12px] text-ink-500">
                Dia: <span className="font-medium text-ink-700">{date}</span>
              </p>
            )}

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

            <div className="mb-3 rounded-lg border border-ink-900/10 bg-bone-50 p-3 dark:border-white/10 dark:bg-ink-900">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hasFree}
                  onChange={(e) => setHasFree(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
                />
                <span>
                  <span className="font-medium">Deixar um intervalo livre (pausa)</span>
                  <span className="block text-[11px] text-ink-500">
                    Abre um período livre dentro do bloqueio. Ex: ocupado 11:00–17:00 mas livre 12:30–14:00.
                  </span>
                </span>
              </label>

              {hasFree && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-ink-900/10 pt-3">
                  <div className="min-w-0">
                    <label className="label" htmlFor="busy_free_from">Livre das</label>
                    <select
                      id="busy_free_from"
                      value={freeFrom}
                      onChange={(e) => setFreeFrom(e.target.value)}
                      className="input"
                    >
                      {!TIMES.includes(freeFrom) && <option value={freeFrom}>{freeFrom}</option>}
                      {TIMES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="min-w-0">
                    <label className="label" htmlFor="busy_free_to">Até</label>
                    <select
                      id="busy_free_to"
                      value={freeTo}
                      onChange={(e) => setFreeTo(e.target.value)}
                      className="input"
                    >
                      {!TIMES.includes(freeTo) && <option value={freeTo}>{freeTo}</option>}
                      {TIMES.slice(1).map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
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
                {isRecurring && scope === "all"
                  ? "Remover recorrência"
                  : isRecurring && scope === "weekdays"
                    ? "Remover nestes dias"
                    : "Remover"}
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
