"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, formatTime } from "@/lib/utils";
import { Clock, NotebookPen } from "lucide-react";
import { bookAction, rescheduleAction } from "./actions";
import type { SessionType } from "@/types/database";

const NOTE_MAX_LEN = 5000;

type CreditSummary = { individual: number; dupla: number; total: number };

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
  // Nota opcional para o treinador, escrita no momento da marcação.
  // Persistida como `session_notes` ligada à marcação (booking_id) com o
  // cliente como autor; o treinador é notificado em separado.
  const [note, setNote] = useState<string>("");
  const [noteOpen, setNoteOpen] = useState<boolean>(false);
  // PERF (CB-3 audit jun/2026): cache em memória dos slots já lidos
  // neste mount, por chave `trainer|YYYY-MM-DD|duration`. Re-tocar
  // num dia já visto → 0 round-trips. TTL implícito: vida do
  // componente. Trade-off aceitável: se outro cliente acabou de
  // marcar nesse slot, o create_booking valida atomicamente no
  // servidor.
  const slotsCache = useRef(new Map<string, { startsAt: string; endsAt: string }[]>());
  const [pending, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${trainerId}|${ymd(date)}|${duration}`;
    // CB-3 cache hit → 0 round-trips. Set síncrono, render imediato.
    const cached = slotsCache.current.get(cacheKey);
    if (cached) {
      setSlots(cached);
      setPicked(null);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      // Envia o dia-calendário LOCAL ("YYYY-MM-DD"), não toISOString():
      // meia-noite local convertida para UTC saltava para o dia anterior
      // (ex.: Segunda 00:00 Lisboa → Domingo 23:00 UTC), e o servidor
      // calculava o dia-da-semana errado.
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
          slotsCache.current.set(cacheKey, next);
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
    const trimmedNote = note.trim().slice(0, NOTE_MAX_LEN);
    start(async () => {
      if (rescheduleBookingId) {
        const res = await rescheduleAction({
          oldBookingId: rescheduleBookingId,
          startsAtIso: picked,
          durationMin: duration,
          note: trimmedNote || undefined,
        });
        if (res.error) {
          setError(res.error);
          return;
        }
        router.push(`/app/historico?ok=${res.pending ? "pending" : "reschedule"}`);
        return;
      }
      const res = await bookAction({
        trainerId,
        startsAtIso: picked,
        durationMin: duration,
        sessionType,
        note: trimmedNote || undefined,
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

      {/* Nota opcional para o treinador — só faz sentido depois de
          escolhido o horário. O treinador recebe a nota junto da sessão
          e uma notificação separada a sinalizá-la. */}
      {picked && (
        <div className="card p-4">
          {!noteOpen && !note ? (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-gold-600 hover:text-gold-700"
            >
              <NotebookPen size={14} /> Adicionar nota para o treinador (opcional)
            </button>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                <NotebookPen size={12} /> Nota para o treinador (opcional)
              </label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ex: tive uma lesão no joelho, vamos com calma."
                maxLength={NOTE_MAX_LEN}
                className="input"
              />
              <div className="flex items-center justify-between text-[10px] text-ink-500">
                <span>O treinador vê esta nota e é notificado.</span>
                <span className="tabular-nums">{note.length}/{NOTE_MAX_LEN}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

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

          <button onClick={confirm} disabled={pending} className="btn-gold mt-3 w-full">
            {pending
              ? "A marcar…"
              : rescheduleBookingId
                ? "Confirmar reagendamento"
                : "Confirmar marcação"}
          </button>
        </div>
      )}
    </div>
  );
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
