"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, formatTime, formatDateTime } from "@/lib/utils";
import { Clock, Repeat } from "lucide-react";
import { getSlotsAction, bookAction, bookRecurringAction } from "./actions";
import type { SessionType } from "@/types/database";

type CreditSummary = { individual: number; dupla: number; total: number };

export function BookingFlow({
  trainerId,
  slotDurations,
  defaultDuration,
  credits,
}: {
  trainerId: string;
  slotDurations: number[];
  defaultDuration: number;
  credits: CreditSummary;
}) {
  const router = useRouter();
  // Dupla está desactivada na UI — todas as marcações são individuais por agora.
  const [sessionType] = useState<SessionType>("individual");
  const [duration, setDuration] = useState<number>(defaultDuration);
  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  const [slots, setSlots] = useState<{ startsAt: string; endsAt: string }[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<
    Array<{ week: number; starts_at: string; reason: string }>
  >([]);
  const [recurring, setRecurring] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Envia o dia-calendário LOCAL ("YYYY-MM-DD"), não toISOString():
      // meia-noite local convertida para UTC saltava para o dia anterior
      // (ex.: Segunda 00:00 Lisboa → Domingo 23:00 UTC), e o servidor
      // calculava o dia-da-semana errado.
      const res = await getSlotsAction({ trainerId, dateIso: ymd(date), durationMin: duration });
      if (cancelled) return;
      setSlots(res.slots);
      setPicked(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [trainerId, date, duration]);

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);

  const availableCredits = sessionType === "individual" ? credits.individual : credits.dupla;

  function confirm() {
    if (!picked) return;
    setError(null);
    setConflicts([]);
    start(async () => {
      if (recurring && availableCredits > 1) {
        const res = await bookRecurringAction({
          trainerId,
          startsAtIso: picked,
          durationMin: duration,
          sessionType,
          sessionsCount: availableCredits,
        });
        if (res.result?.conflicts?.length) {
          setConflicts(res.result.conflicts);
          return;
        }
        if (res.error) {
          setError(res.error);
          return;
        }
        router.push("/app/historico?ok=recurring");
        return;
      }
      const res = await bookAction({
        trainerId,
        startsAtIso: picked,
        durationMin: duration,
        sessionType,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(`/app/historico?ok=${res.pending ? "pending" : "1"}`);
    });
  }

  return (
    <div className="space-y-5">
      {/* Tipo de sessão (Dupla escondida — todas as marcações são individuais por agora) */}

      {/* Duração */}
      <div>
        <div className="label">Duração</div>
        <div className="flex flex-wrap gap-2">
          {slotDurations.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm",
                duration === d ? "border-gold-400 bg-gold-50 font-semibold" : "border-ink-900/10",
              )}
            >
              <Clock size={14} className="mr-1 inline" /> {d} min
            </button>
          ))}
        </div>
      </div>

      {/* Dia */}
      <div>
        <div className="label">Dia</div>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {days.map((d) => {
            const active = isSameDay(d, date);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => setDate(d)}
                className={cn(
                  "flex flex-col items-center rounded-lg border px-3 py-2 text-xs shrink-0 w-14",
                  active ? "border-ink-900 bg-ink-900 text-bone-50" : "border-ink-900/10",
                )}
              >
                <span className="uppercase opacity-70">{weekday(d)}</span>
                <span className="mt-0.5 font-display text-lg font-bold leading-none">
                  {d.getDate()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slots */}
      <div>
        <div className="label">Horários disponíveis</div>
        {loading ? (
          <div className="card p-5 text-center text-sm text-ink-500">A carregar…</div>
        ) : slots.length === 0 ? (
          <div className="card p-5 text-center text-sm text-ink-500">
            Sem horários disponíveis neste dia.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {slots.map((s) => (
              <button
                key={s.startsAt}
                type="button"
                onClick={() => setPicked(s.startsAt)}
                className={cn(
                  "rounded-lg border py-2 text-sm font-medium tabular-nums",
                  picked === s.startsAt
                    ? "border-gold-400 bg-gold-50 text-ink-900"
                    : "border-ink-900/10 hover:bg-ink-900/5",
                )}
              >
                {formatTime(s.startsAt)}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {conflicts.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <div className="font-semibold">Não foi possível marcar todas as semanas:</div>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((c) => (
              <li key={c.starts_at}>
                Semana {c.week} ({formatDateTime(c.starts_at)}) — {reasonLabel(c.reason)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            Escolhe outro horário/dia para a série, ou desactiva "recorrente" e marca as
            semanas individualmente.
          </p>
        </div>
      )}

      {picked && (
        <div className="card sticky bottom-24 z-20 p-4 md:bottom-4">
          <div className="flex items-center justify-between text-sm">
            <div>
              <div className="font-semibold">Sessão {sessionType} · {duration} min</div>
              <div className="text-ink-500">
                {fullDate(date)} · {formatTime(picked)}
              </div>
            </div>
            <div className="text-xs text-ink-500">{availableCredits} restantes</div>
          </div>

          {availableCredits > 1 && (
            <label className="mt-3 flex items-start gap-2 rounded-md border border-ink-900/10 bg-bone-50 px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
              />
              <span>
                <span className="flex items-center gap-1 font-semibold">
                  <Repeat size={12} /> Marcar recorrente
                </span>
                <span className="text-ink-500">
                  Marca as próximas {availableCredits} semanas neste mesmo horário. Vais usar todas
                  as sessões já. O horário fica reservado para ti na semana seguinte.
                </span>
              </span>
            </label>
          )}

          <button onClick={confirm} disabled={pending} className="btn-gold mt-3 w-full">
            {pending
              ? "A marcar…"
              : recurring && availableCredits > 1
                ? `Confirmar ${availableCredits} marcações`
                : "Confirmar marcação"}
          </button>
        </div>
      )}
    </div>
  );
}

function reasonLabel(reason: string) {
  switch (reason) {
    case "booking":
      return "já há uma marcação";
    case "blocked":
      return "horário bloqueado pelo trainer";
    case "reserved":
      return "horário reservado para outro cliente";
    default:
      return reason;
  }
}

// Dia-calendário local como "YYYY-MM-DD" (sem conversão de fuso).
function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function weekday(d: Date) {
  return new Intl.DateTimeFormat("pt-PT", { weekday: "short" }).format(d).replace(".", "");
}
function fullDate(d: Date) {
  return new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "2-digit", month: "long" }).format(d);
}
