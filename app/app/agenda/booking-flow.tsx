"use client";
// recurring booking: count selector + graceful credit handling
// + nota opcional do cliente para o trainer ao marcar.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, formatTime, formatDateTime } from "@/lib/utils";
import { Clock, Repeat, NotebookPen } from "lucide-react";
import { bookAction, bookRecurringAction, rescheduleAction } from "./actions";
import type { SessionType } from "@/types/database";

const NOTE_MAX_LEN = 5000;

// Tempo de vida do cache de slots em memória. Curto o suficiente para que
// uma mudança do lado do admin (reagendamento, bloqueio, cancelamento) seja
// reflectida quase de imediato, mas longo o suficiente para amortecer o
// "clicar de um dia para o outro e voltar" sem refetch a cada toque.
const SLOTS_TTL_MS = 15_000;

type CreditSummary = { individual: number; dupla: number; total: number };

type Conflict = {
  week: number;
  starts_at: string;
  reason: "booking" | "blocked" | "reserved" | "no_credit" | string;
};
type PartialResult = { booked_count: number; requested_count: number; conflicts: Conflict[] };

export function BookingFlow({
  trainerId,
  slotDurations,
  defaultDuration,
  credits,
  rescheduleBookingId,
  hasPartner = false,
  partnerName,
}: {
  trainerId: string;
  slotDurations: number[];
  defaultDuration: number;
  credits: CreditSummary;
  /** Quando presente, estamos a reagendar esta marcacao: confirmar
   *  cancela a antiga e cria a nova atomicamente (sem perder a sessao). */
  rescheduleBookingId?: string;
  /** Cliente tem uma conta ligada (par duo)? Ajusta a copia da sessao dupla. */
  hasPartner?: boolean;
  partnerName?: string | null;
}) {
  const router = useRouter();
  // Tipo de sessao = que creditos usar.
  //  • so individuais  → individual (sem escolha)
  //  • so duplos       → dupla (sem escolha; mostra aviso)
  //  • ambos           → o cliente escolhe; por defeito individual
  // Ao reagendar, o tipo e herdado da sessao antiga no servidor, por isso
  // escondemos a escolha nesse modo.
  const onlyDupla = credits.individual === 0 && credits.dupla > 0;
  const canChooseType =
    credits.individual > 0 && credits.dupla > 0 && !rescheduleBookingId;
  const [sessionType, setSessionType] = useState<SessionType>(
    onlyDupla ? "dupla" : "individual",
  );
  // Marcação PT Dupla exige contas ligadas. O saldo é PARTILHADO pelo par
  // (já vem somado em credits.dupla), por isso basta haver par ligado e
  // saldo > 0. O servidor recusa de qualquer forma; aqui avisamos e
  // bloqueamos o botão para não enviar um pedido que vai falhar.
  const duoNotLinked = !hasPartner;
  const duoNoCredits = hasPartner && credits.dupla === 0;
  const duoBlocked =
    sessionType === "dupla" && (duoNotLinked || duoNoCredits);
  const [duration, setDuration] = useState<number>(defaultDuration);
  const [date, setDate] = useState<Date>(() => startOfDay(new Date()));
  // Mês seleccionado no filtro (chave "ano-mês"). Por defeito, o mês de hoje.
  const [monthKey, setMonthKey] = useState<string>(() => monthKeyOf(startOfDay(new Date())));
  const [slots, setSlots] = useState<{ startsAt: string; endsAt: string }[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<PartialResult | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [recurring, setRecurring] = useState(false);
  // Nota opcional para o trainer, escrita no momento da marcacao.
  // Persistida como `session_notes` ligada a marcacao (booking_id) com o
  // cliente como autor; o trainer e notificado em separado.
  const [note, setNote] = useState<string>("");
  const [noteOpen, setNoteOpen] = useState<boolean>(false);
  // PERF (CB-3 audit jun/2026): cache em memoria dos slots ja lidos.
  // CORRECÇÃO (jun/2026): cache com TTL curto. Antes era permanente (sem
  // expiração) — um cliente com o fluxo de marcação aberto nunca via as
  // mudanças feitas pelo admin (ex.: reagendamento por drag) sem recarregar
  // a página. Agora cada entrada expira em SLOTS_TTL_MS, forçando um
  // refetch que reflecte o estado actual do servidor.
  const slotsCache = useRef(
    new Map<string, { data: { startsAt: string; endsAt: string }[]; ts: number }>(),
  );
  // Quantas semanas marcar de uma vez. Default conservador: 4 (ou menos,
  // se o cliente tiver menos creditos). O cliente ajusta com o stepper.
  const [recurringCount, setRecurringCount] = useState<number>(() =>
    Math.min(4, Math.max(2, credits.individual)),
  );
  const [pending, start] = useTransition();

  // Auto-scroll suave: âncoras para os horários e para o cartão de
  // confirmação, para o cliente não ter de scrollar manualmente.
  const slotsRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  // Ao escolher a hora (picked passa a ter valor), traz o cartão de
  // confirmação à vista. Quando picked volta a null (ex.: trocou de dia),
  // não faz nada.
  useEffect(() => {
    if (!picked) return;
    smoothScrollTo(confirmRef.current, "center");
  }, [picked]);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${trainerId}|${ymd(date)}|${duration}`;
    const cached = slotsCache.current.get(cacheKey);
    if (cached && Date.now() - cached.ts < SLOTS_TTL_MS) {
      setSlots(cached.data);
      setPicked(null);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
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
          slotsCache.current.set(cacheKey, { data: next, ts: Date.now() });
        }
      } catch {
        // rede falhou - mostra "sem horarios" em vez de crashar.
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
    // 90 dias de horizonte de marcação (cliente). Como são muitos dias para
    // percorrer, a faixa é filtrada por mês (ver `months`/`visibleDays`); cada
    // mês mantém o layout com scroll/swipe horizontal (overflow-x-auto).
    return Array.from({ length: 90 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);

  const currentYear = new Date().getFullYear();

  // Meses abrangidos pela janela de 90 dias (para o filtro de mês). Guarda o
  // 1.º dia disponível de cada mês para saltar lá ao clicar.
  const months = useMemo(() => {
    const seen = new Map<string, Date>();
    for (const d of days) {
      const k = monthKeyOf(d);
      if (!seen.has(k)) seen.set(k, d);
    }
    return Array.from(seen.entries()).map(([key, first]) => ({
      key,
      label: MONTHS_PT[first.getMonth()],
      year: first.getFullYear(),
    }));
  }, [days]);

  // Só os dias do mês seleccionado (dentro da janela de 90 dias).
  const visibleDays = useMemo(
    () => days.filter((d) => monthKeyOf(d) === monthKey),
    [days, monthKey],
  );

  // Trocar de mês: selecciona o 1.º dia disponível desse mês (hoje, se for o
  // mês corrente) e carrega os respectivos horários.
  function pickMonth(key: string) {
    setMonthKey(key);
    const first = days.find((d) => monthKeyOf(d) === key);
    if (first) setDate(first);
  }

  const availableCredits = sessionType === "individual" ? credits.individual : credits.dupla;

  function confirm() {
    if (!picked) return;
    // Guarda: marcação dupla exige contas ligadas + ambos com saldo.
    if (duoBlocked) {
      setError(
        duoNotLinked
          ? "Para marcar PT Dupla, a tua conta tem de estar ligada à do teu par. Fala com o teu treinador."
          : "O par não tem sessões PT Dupla disponíveis. Comprem um pack PT Dupla para marcar a dois.",
      );
      return;
    }
    setError(null);
    setPartial(null);
    setResolved(new Set());
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
      if (recurring && availableCredits > 1) {
        const count = Math.max(2, Math.min(availableCredits, recurringCount));
        const res = await bookRecurringAction({
          trainerId,
          startsAtIso: picked,
          durationMin: duration,
          sessionType,
          sessionsCount: count,
          note: trimmedNote || undefined,
        });
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
      {!rescheduleBookingId && (canChooseType || onlyDupla) && (
        <div>
          <div className="label">Tipo de sessão</div>
          {canChooseType && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSessionType("individual")}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-sm font-medium",
                  sessionType === "individual"
                    ? "border-gold-400 bg-gold-50 text-ink-900"
                    : "border-ink-900/10 hover:bg-ink-900/5",
                )}
              >
                Individual{" "}
                <span className="text-xs text-ink-500">({credits.individual})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSessionType("dupla");
                  setRecurring(false);
                }}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-sm font-medium",
                  sessionType === "dupla"
                    ? "border-gold-400 bg-gold-50 text-ink-900"
                    : "border-ink-900/10 hover:bg-ink-900/5",
                )}
              >
                Dupla <span className="text-xs text-ink-500">({credits.dupla})</span>
              </button>
            </div>
          )}
          {sessionType === "dupla" && duoNotLinked ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              Para marcar sessões PT Dupla, a tua conta tem de estar ligada à do teu par.
              Fala com o teu treinador para ligar as duas contas.
            </p>
          ) : sessionType === "dupla" && duoNoCredits ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              O par não tem sessões PT Dupla disponíveis. Comprem um pack PT Dupla
              {partnerName ? ` (tu ou ${partnerName.split(" ")[0]})` : ""} para marcar a dois.
            </p>
          ) : (
            sessionType === "dupla" && (
              <p className="mt-2 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs text-ink-700 dark:border-gold-400/30 dark:bg-gold-400/10">
                {hasPartner
                  ? `Sessão dupla — conta para ti${
                      partnerName ? ` e ${partnerName.split(" ")[0]}` : " e a tua conta ligada"
                    }. Saldo PT Dupla partilhado: gasta 1 sessão (${credits.dupla} disponíveis).`
                  : "Sessão dupla (treino a dois). Gasta 1 sessão dupla do teu saldo."}
              </p>
            )
          )}
        </div>
      )}

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

      <div>
        <div className="label">Mês</div>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {months.map((m) => {
            const active = m.key === monthKey;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => pickMonth(m.key)}
                className={cn(
                  "shrink-0 rounded-lg border px-3 py-1.5 text-sm capitalize",
                  active ? "border-ink-900 bg-ink-900 text-bone-50" : "border-ink-900/10",
                )}
              >
                {m.label}
                {m.year !== currentYear ? ` ${m.year}` : ""}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="label">Dia</div>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {visibleDays.map((d) => {
            const active = isSameDay(d, date);
            return (
              <button
                key={d.toISOString()}
                type="button"
                onClick={() => {
                  setDate(d);
                  // Desce suavemente para a secção de horários. A secção já
                  // está renderizada (mostra "A carregar…" enquanto busca),
                  // por isso o rAF garante o scroll após o re-render.
                  requestAnimationFrame(() => smoothScrollTo(slotsRef.current, "start"));
                }}
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

      <div ref={slotsRef} className="scroll-mt-3">
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

      {picked && !partial && (
        <div className="card p-4">
          {!noteOpen && !note ? (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-900/20 py-2.5 text-sm font-medium text-gold-600 hover:bg-gold-50 dark:border-white/15 dark:hover:bg-white/5"
            >
              <NotebookPen size={14} /> Adicionar nota para o trainer (opcional)
            </button>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                <NotebookPen size={12} /> Nota para o trainer (opcional)
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
                <span>O trainer vê esta nota e é notificado.</span>
                <span className="tabular-nums">{note.length}/{NOTE_MAX_LEN}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {partial && (() => {
        const remaining = partial.conflicts.filter((c) => !resolved.has(c.starts_at));
        const booked = partial.booked_count + resolved.size;
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
            <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 shadow-xl sm:max-w-md sm:rounded-2xl">
            <div className="font-semibold">
              {booked > 0
                ? `Marcadas ${booked} de ${partial.requested_count} sessões.`
                : "Não foi possível marcar nenhuma semana."}
            </div>
            {remaining.length > 0 ? (
              <>
                <p className="mt-1 text-xs">
                  Estas semanas ficaram por marcar. Para as ocupadas, escolhe outro horário
                  (ou marca-as mais tarde, quando quiseres):
                </p>
                <ul className="mt-2 space-y-3">
                  {remaining.map((c) => (
                    <li key={c.starts_at}>
                      <div className="text-xs font-medium">
                        Semana {c.week} · {formatDateTime(c.starts_at)} — {reasonLabel(c.reason)}
                      </div>
                      {c.reason === "no_credit" ? (
                        <p className="mt-1 text-xs text-amber-800">
                          Não tens sessões suficientes para esta semana. Compra mais um pack
                          para a marcares.
                        </p>
                      ) : (
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
                      )}
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
          </div>
        );
      })()}

      {picked && !partial && (
        <div ref={confirmRef} className="card scroll-mt-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <div>
              <div className="font-semibold">Sessão {sessionType} · {duration} min</div>
              <div className="text-ink-500">
                {fullDate(date)} · {formatTime(picked)}
              </div>
            </div>
            <div className="text-xs text-ink-500">{availableCredits} restantes</div>
          </div>

          {sessionType === "individual" && availableCredits > 1 && !rescheduleBookingId && (
            <div className="mt-3 rounded-md border border-ink-900/10 bg-bone-50 px-3 py-2 text-xs">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => {
                    setRecurring(e.target.checked);
                    if (e.target.checked) {
                      setRecurringCount(Math.min(4, availableCredits));
                    }
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-ink-900/30"
                />
                <span>
                  <span className="flex items-center gap-1 font-semibold">
                    <Repeat size={12} /> Marcar recorrente
                  </span>
                  <span className="text-ink-500">
                    Marca já várias semanas no mesmo dia e hora. Escolhe quantas — não
                    precisas de usar todas as sessões de uma vez.
                  </span>
                </span>
              </label>

              {recurring && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-bone-100 px-2 py-2">
                  <span className="text-ink-700">Quantas semanas?</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Menos semanas"
                      onClick={() => setRecurringCount((c) => Math.max(2, c - 1))}
                      disabled={recurringCount <= 2}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-900/20 text-base font-semibold leading-none disabled:opacity-40"
                    >
                      -
                    </button>
                    <span className="w-6 text-center font-semibold tabular-nums">
                      {recurringCount}
                    </span>
                    <button
                      type="button"
                      aria-label="Mais semanas"
                      onClick={() =>
                        setRecurringCount((c) => Math.min(availableCredits, c + 1))
                      }
                      disabled={recurringCount >= availableCredits}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-900/20 text-base font-semibold leading-none disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
              {recurring && (
                <p className="mt-1 text-ink-500">
                  Usa {recurringCount} de {availableCredits} sessões. Ficam {availableCredits -
                    recurringCount}{" "}
                  por usar.
                </p>
              )}
            </div>
          )}

          <button
            onClick={confirm}
            disabled={pending || duoBlocked}
            className="btn-gold mt-3 w-full disabled:opacity-50"
          >
            {pending
              ? "A marcar…"
              : duoBlocked
                ? duoNotLinked
                  ? "Conta não ligada a um par"
                  : "Par sem sessões PT Dupla"
                : rescheduleBookingId
                  ? "Confirmar reagendamento"
                  : recurring && availableCredits > 1
                    ? `Confirmar ${Math.min(availableCredits, recurringCount)} marcações`
                    : "Confirmar marcação"}
          </button>
        </div>
      )}
    </div>
  );
}

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

      const same = await fetchSlots(trainerId, conflictDay, durationMin);
      let list = same.map((s) => ({ startsAt: s.startsAt, sameDay: true }));

      if (list.length === 0) {
        const monday = mondayOf(conflictDay);
        const days: Date[] = [];
        for (let k = 0; k < 7; k++) {
          const d = new Date(monday);
          d.setDate(d.getDate() + k);
          if (!isSameDay(d, conflictDay)) days.push(d);
        }
        const results = await Promise.all(
          days.map((d) => fetchSlots(trainerId, d, durationMin)),
        );
        for (const ss of results) {
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
            className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium tabular-nums text-ink-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-300/40 dark:text-bone-50 dark:hover:bg-ink-700"
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

// Scroll suave até um elemento, respeitando quem prefere menos movimento
// (prefers-reduced-motion → salta sem animação). O scroll é feito no
// contentor scrollável mais próximo (o <main> do shell), por isso
// funciona dentro do layout de altura fixa.
function smoothScrollTo(el: HTMLElement | null, block: ScrollLogicalPosition) {
  if (!el || typeof window === "undefined") return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
}

function minutesOfDay(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

function mondayOf(d: Date) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
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
    case "no_credit":
      return "sem sessões disponíveis para esta semana";
    default:
      return reason;
  }
}

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
const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
function monthKeyOf(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}
const WEEKDAYS_PT_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
function weekday(d: Date) {
  return WEEKDAYS_PT_SHORT[d.getDay()];
}
function fullDate(d: Date) {
  return new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "2-digit", month: "long" }).format(d);
}
