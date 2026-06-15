"use client";

// ════════════════════════════════════════════════════════════════
// RescheduleDialog · confirmação do drag-and-drop. Ouve o evento
// `agenda:reschedule` (disparado pelo BookingBlock ao largar) e pergunta
// se o cliente deve ser notificado antes de aplicar o reagendamento.
// ════════════════════════════════════════════════════════════════
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, X } from "lucide-react";
import { rescheduleBookingAdminAction } from "./actions";

type Detail = {
  bookingId: string;
  clientName: string;
  durationMin: number;
  fromLabel: string;
  newDateIso: string;
  newTime: string;
};

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function prettyDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function RescheduleDialog() {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlapConfirm, setOverlapConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onReschedule(e: Event) {
      const d = (e as CustomEvent).detail as Detail;
      setDetail(d);
      setNotify(true);
      setError(null);
      setOverlapConfirm(false);
    }
    window.addEventListener("agenda:reschedule", onReschedule as EventListener);
    return () => window.removeEventListener("agenda:reschedule", onReschedule as EventListener);
  }, []);

  useEffect(() => {
    if (!detail) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setDetail(null);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [detail]);

  if (!detail) return null;

  function doReschedule(force: boolean) {
    if (!detail) return;
    setError(null);
    startTransition(async () => {
      // O wall-clock que o trainer escolheu (ex: "10:15") é hora local
      // do browser (PT). Convertemos AQUI para ISO UTC antes de enviar —
      // se mandássemos a string naive, o server action a correr em UTC
      // gravaria 10:15 UTC = 11:15 PT (offset de +1h em horário de Verão).
      const startsAtIso = new Date(
        `${detail.newDateIso}T${detail.newTime}:00`,
      ).toISOString();
      const res = await rescheduleBookingAdminAction({
        bookingId: detail.bookingId,
        startsAtIso,
        durationMin: detail.durationMin,
        notify,
        force,
      });
      if (res?.conflict) {
        // Vai sobrepor outra sessão → pede confirmação (não fecha).
        setOverlapConfirm(true);
        return;
      }
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOverlapConfirm(false);
      setDetail(null);
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setDetail(null);
      }}
    >
      <div className="w-full rounded-t-2xl bg-white p-5 shadow-xl dark:bg-ink-800 sm:max-w-sm sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 font-display text-lg font-bold">
            <CalendarClock size={18} /> Reagendar sessão
          </h2>
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="rounded p-1 text-ink-500 hover:bg-ink-900/5"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 rounded-lg border border-ink-900/10 bg-bone-50 p-3 text-sm dark:border-white/10 dark:bg-ink-900">
          {detail.clientName && (
            <div className="font-semibold">{detail.clientName}</div>
          )}
          <div className="mt-0.5 text-ink-600">
            Mover para <span className="font-semibold text-ink-900 dark:text-bone-50">{prettyDate(detail.newDateIso)}</span>{" "}
            às <span className="font-semibold tabular-nums text-ink-900 dark:text-bone-50">{detail.newTime}</span>
          </div>
        </div>

        <label className="mb-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
          />
          <span>
            <span className="font-medium">Notificar o cliente</span>
            <span className="block text-[11px] text-ink-500">
              Envia notificação na app, push e email com o novo horário. Desligado = mudança silenciosa.
            </span>
          </span>
        </label>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {overlapConfirm ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p>
              Este horário <span className="font-semibold">vai sobrepor outra sessão</span>.
              Reagendar à mesma?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOverlapConfirm(false)}
                disabled={pending}
                className="btn-outline"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => doReschedule(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <CalendarClock size={16} />
                {pending ? "A reagendar…" : "Sim, reagendar à mesma"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDetail(null)} disabled={pending} className="btn-outline">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => doReschedule(false)}
              disabled={pending}
              className="btn-primary inline-flex items-center gap-1.5"
            >
              <CalendarClock size={16} />
              {pending ? "A reagendar…" : "Reagendar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
