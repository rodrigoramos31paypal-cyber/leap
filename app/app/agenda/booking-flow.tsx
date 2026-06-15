"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, formatTime, formatDateTime } from "@/lib/utils";
import { Clock, Repeat } from "lucide-react";
import { bookAction, bookRecurringAction, rescheduleAction } from "./actions";
import type { SessionType } from "@/types/database";

type CreditSummary = { individual: number; dupla: number; total: number };

type Conflict = { week: number; starts_at: string; reason: string };
type PartialResult = { booked_count: number; requested_count: number; conflicts: Conflict[] };

export function BookingFlow({
  trainerId,
  slotDurations,
  defaultDuration,
  credits,
  rescheduleBookingId,
}: {
  trainerId: string;
  slotDurations: number[];
  defaultDuration: number;
  credits: CreditSummary;
  /** Quando presente, estamos a reagendar esta marcação: confirmar
   *  cancela a antiga e cria a nova atomicamente (sem perder a sessão). */
  rescheduleBookingId?: string;
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
  const [partial, setPartial] = useState<PartialResult | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
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
      // PERF (C3): GET cacheável a /api/slots em vez da Server Action
      // serializada. Pedidos paralelos + cache no browser → seletor fluido.
      const params = new URLSearchParams({
        trainer: trainerId,
        date: ymd(date),
        duration: String(duration),
      });
      let next: { startsAt: string; endsAt: string }[] = [];
      try {
        const res = await fetch(`/api/slots?${params.toString()}`, {
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          next = data.slots ?? [];
        }
      } catch {
        // rede falhou — mostra "sem horários" em vez de crashar.
      }
      if (cancelled) return;
      setSlots(next);
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
    setPartial(null);
    setResolved(new Set());
    start(async () => {
      if (rescheduleBookingId) {
        const res = await rescheduleAction({
          oldBookingId: rescheduleBookingId,
          startsAtIso: picked,
          durationMin: duration,
        });
        if (res.error) {
          setError(res.error);
          return;
        }
        router.push(`/app/historico?ok=${res.pending ? "pending" : "reschedule"}`);
        return;
      }
      if (recurring && availableCredits > 1) {
        const res = await bookRecurringAction({
          trainerId,
          startsAtIso: picked,
          durationMin: duration,
          sessionType,
          sessionsCount: availableCredits,
        });
        // Parcial: marcou as semanas livres; mostra as que falharam com
        // sugestões de horário (mesmo que não tenha marcado nenhuma).
        if (res.result && res.result.conflicts.length > 0) {
          setPartial({
            booked_count: res.result.booked_count,
            requested_count: res.result.requested_count,
            conflicts: res.result.conflicts,
          });
          setResolved(new Set());
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

      {partial && (() => {
        const remaining = partial.conflicts.filter((c) => !resolved.has(c.starts_at));
        const booked = partial.booked_count + resolved.size;
        return (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <div className="font-semibold">
              {booked > 0
                ? `Marcadas ${booked} de ${partial.requested_count} sessões.`
                : "Não foi possível marcar nenhuma semana."}
            </div>
            {remaining.length > 0 ? (
              <>
                <p className="mt-1 text-xs">
                  Estas semanas já estavam ocupadas. Escolhe outro horário (ou marca-as
                  mais tarde, quando quiseres):
                </p>
                <ul className="mt-2 space-y-3">
                  {remaining.map((c) => (
                    <li key={c.starts_at}>
                      <div className="text-xs font-medium">
                        Semana {c.week} · {formatDateTime(c.starts_at)} — {reasonLabel(c.reason)}
                      </div>
                      <ConflictSuggestions
                        trainerId={trainerId}
                        durationMin={duration}
                        sessionType={sessionType}
                        conflictStartsAt={c.starts_at}
                        pickedIso={picked!}
                        onBooked={() =>
                          setResolved((prev) => {
                            const next = new Set(prev);
                            next.add(c.starts_at);
                            return next;
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-xs">Tudo marcado. 🎉</p>
            )}
            <button
              type="button"
              onClick={() => router.push("/app/historico?ok=recurring")}
              className="btn-outline mt-3 w-full text-xs"
            >
              Concluir
            </button>
          </div>
        );
      })()}

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

          {availableCredits > 1 && !rescheduleBookingId && (
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
              : rescheduleBookingId
                ? "Confirmar reagendamento"
                : recurring && availableCredits > 1
                  ? `Confirmar ${availableCredits} marcações`
                  : "Confirmar marcação"}
          </button>
        </div>
      )}
    </div>
  );
}

// Sugestões de horário para uma semana que ficou por marcar. Procura
// primeiro slots livres no MESMO dia da semana (mais perto da hora
// escolhida); se esse dia estiver cheio, alarga aos outros dias da
// mesma semana. Cada sugestão marca essa semana com um clique.
function ConflictSuggestions({
  trainerId,
  durationMin,
  sessionType,
  conflictStartsAt,
  pickedIso,
  onBooked,
}: {
  trainerId: string;
  durationMin: number;
  sessionType: SessionType;
  conflictStartsAt: string;
  pickedIso: string;
  onBooked: () => void;
}) {
  const [slots, setSlots] = useState<{ startsAt: string; sameDay: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const pickedMin = minutesOfDay(new Date(pickedIso));
      const conflictDay = new Date(conflictStartsAt);

      // 1) mesmo dia da semana
      const same = await fetchSlots(trainerId, conflictDay, durationMin);
      let list = same.map((s) => ({ startsAt: s.startsAt, sameDay: true }));

      // 2) fallback: outros dias da mesma semana
      if (list.length === 0) {
        const monday = mondayOf(conflictDay);
        for (let k = 0; k < 7; k++) {
          const d = new Date(monday);
          d.setDate(d.getDate() + k);
          if (isSameDay(d, conflictDay)) continue;
          const ss = await fetchSlots(trainerId, d, durationMin);
          for (const s of ss) list.push({ startsAt: s.startsAt, sameDay: false });
        }
      }

      const now = Date.now();
      list = list
        .filter((s) => new Date(s.startsAt).getTime() > now)
        .sort(
          (a, b) =>
            Math.abs(minutesOfDay(new Date(a.startsAt)) - pickedMin) -
            Math.abs(minutesOfDay(new Date(b.startsAt)) - pickedMin),
        )
        .slice(0, 4);

      if (!cancelled) {
        setSlots(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trainerId, durationMin, conflictStartsAt, pickedIso]);

  async function book(startsAt: string) {
    setBooking(startsAt);
    setErr(null);
    const res = await bookAction({ trainerId, startsAtIso: startsAt, durationMin, sessionType });
    setBooking(null);
    if (res.error) {
      setErr(res.error);
      return;
    }
    setDone(startsAt);
    onBooked();
  }

  if (done) {
    return (
      <div className="mt-1 text-xs font-semibold text-emerald-700">
        ✓ Marcada às {formatTime(done)}.
      </div>
    );
  }
  if (loading) return <div className="mt-1 text-xs text-amber-700/70">A procurar horários…</div>;
  if (slots.length === 0)
    return <div className="mt-1 text-xs text-amber-700/70">Sem horários livres nessa semana.</div>;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5">
        {slots.map((s) => (
          <button
            key={s.startsAt}
            type="button"
            disabled={booking !== null}
            onClick={() => book(s.startsAt)}
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium tabular-nums text-ink-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {booking === s.startsAt
              ? "A marcar…"
              : s.sameDay
                ? formatTime(s.startsAt)
                : `${WEEKDAYS_PT_SHORT[new Date(s.startsAt).getDay()]} ${formatTime(s.startsAt)}`}
          </button>
        ))}
      </div>
      {err && <div className="mt-1 text-xs text-red-700">{err}</div>}
    </div>
  );
}

async function fetchSlots(
  trainerId: string,
  day: Date,
  durationMin: number,
): Promise<{ startsAt: string; endsAt: string }[]> {
  const params = new URLSearchParams({
    trainer: trainerId,
    date: ymd(day),
    duration: String(durationMin),
  });
  try {
    const res = await fetch(`/api/slots?${params.toString()}`, { credentials: "same-origin" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.slots ?? [];
  } catch {
    return [];
  }
}

function minutesOfDay(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

function mondayOf(d: Date) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // 0 = segunda
  x.setDate(x.getDate() - dow);
  return x;
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
// Abreviações fixas (3 letras) para caberem nos chips do seletor de dia.
// O Intl "short" em pt-PT devolvia o nome completo (Domingo, Segunda…) em
// alguns runtimes, rebentando a largura do botão.
const WEEKDAYS_PT_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
function weekday(d: Date) {
  return WEEKDAYS_PT_SHORT[d.getDay()];
}
function fullDate(d: Date) {
  return new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "2-digit", month: "long" }).format(d);
}
