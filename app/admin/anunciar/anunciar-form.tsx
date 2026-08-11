"use client";

import { useActionState, useEffect, useState } from "react";
import { Megaphone, CalendarClock } from "lucide-react";
import { anunciarVagaAction, type AnunciarState } from "./actions";

// ════════════════════════════════════════════════════════════════
// Anunciar vaga — o horário é escolhido a partir da DISPONIBILIDADE REAL
// do trainer (mesma fonte que o cliente vê em /app/agenda):
//   • só dias de HOJE em diante que têm >=1 horário livre (/api/available-days);
//   • só slots realmente abertos nesse dia (/api/slots).
// Assim o admin não anuncia passado nem horários inexistentes, e o slot
// bate certo com o que o cliente vê ao abrir o deep-link da notificação.
// ════════════════════════════════════════════════════════════════

type Slot = { startsAt: string; endsAt: string };

const DIAS_RANGE = 30;

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Rótulo do dia a partir de "YYYY-MM-DD" (ex.: "Qua, 12 ago").
function dayLabel(dayIso: string): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const s = new Intl.DateTimeFormat("pt-PT", { weekday: "short", day: "2-digit", month: "short" })
    .format(dt)
    .replace(/\./g, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Hora-parede (Europe/Lisbon) de um slot ISO. `when` fica no formato do
// datetime-local ("YYYY-MM-DDTHH:mm") — é o que a action espera e o que o
// cliente casa por hora-parede ao pré-selecionar.
function lisbonParts(iso: string): { time: string; when: string } {
  const dt = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);
  return { time, when: `${date}T${time}` };
}

export function AnunciarForm({
  trainerId,
  defaultDuration = 45,
}: {
  trainerId?: string;
  defaultDuration?: number;
}) {
  const [state, action, pending] = useActionState<AnunciarState, FormData>(
    anunciarVagaAction,
    {},
  );

  const [days, setDays] = useState<string[] | null>(null); // null = a carregar
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedWhen, setSelectedWhen] = useState<string>("");

  // Dias com vagas (hoje → +30 dias).
  useEffect(() => {
    if (!trainerId) {
      setDays([]);
      return;
    }
    let cancel = false;
    (async () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + DIAS_RANGE);
      const params = new URLSearchParams({
        trainer: trainerId,
        from: ymd(from),
        to: ymd(to),
        duration: String(defaultDuration),
      });
      try {
        const res = await fetch(`/api/available-days?${params.toString()}`, {
          credentials: "same-origin",
        });
        if (cancel) return;
        const data = res.ok ? await res.json() : { days: [] };
        setDays((data.days ?? []) as string[]);
      } catch {
        if (!cancel) setDays([]);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [trainerId, defaultDuration]);

  // Slots do dia escolhido.
  useEffect(() => {
    setSelectedWhen("");
    setSlots(null);
    if (!trainerId || !selectedDay) return;
    let cancel = false;
    setSlotsLoading(true);
    (async () => {
      const params = new URLSearchParams({
        trainer: trainerId,
        date: selectedDay,
        duration: String(defaultDuration),
      });
      try {
        const res = await fetch(`/api/slots?${params.toString()}`, {
          credentials: "same-origin",
        });
        if (cancel) return;
        const data = res.ok ? await res.json() : { slots: [] };
        setSlots((data.slots ?? []) as Slot[]);
      } catch {
        if (!cancel) setSlots([]);
      } finally {
        if (!cancel) setSlotsLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [trainerId, selectedDay, defaultDuration]);

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-gold-400 dark:bg-white/10">
          <Megaphone size={19} />
        </span>
        <div>
          <div className="text-[13.5px] font-medium text-ink-900 dark:text-bone-50">Chega a todos os clientes</div>
          <div className="text-[11.5px] text-ink-500">No sininho da app e por push a quem o tem ativo</div>
        </div>
      </div>

      <form action={action} className="space-y-4">
        {/* O horário escolhido vai no formato datetime-local, igual ao antigo. */}
        <input type="hidden" name="when" value={selectedWhen} />

        <div>
          <label className="label">
            Dia da vaga <span className="font-normal text-ink-400">(opcional)</span>
          </label>
          <div className="relative">
            <CalendarClock size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            {days === null ? (
              <div className="input flex h-11 items-center pl-10 text-sm text-ink-500">A carregar dias com vagas…</div>
            ) : days.length === 0 ? (
              <div className="input flex h-11 items-center pl-10 text-sm text-ink-500">
                {trainerId ? `Sem dias com horários livres nos próximos ${DIAS_RANGE} dias.` : "Sem trainer ativo."}
              </div>
            ) : (
              <select
                value={selectedDay}
                onChange={(e) => setSelectedDay(e.target.value)}
                className="input h-11 pl-10"
              >
                <option value="">Escolhe um dia…</option>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-500">Só aparecem dias com horários livres. Se escolheres, entra na mensagem e no link.</p>
        </div>

        {selectedDay && (
          <div>
            <label className="label">Horário</label>
            {slotsLoading || slots === null ? (
              <div className="text-sm text-ink-500">A carregar horários…</div>
            ) : slots.length === 0 ? (
              <div className="text-sm text-ink-500">Sem horários livres neste dia.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => {
                  const { time, when } = lisbonParts(s.startsAt);
                  const active = when === selectedWhen;
                  return (
                    <button
                      key={s.startsAt}
                      type="button"
                      onClick={() => setSelectedWhen(active ? "" : when)}
                      className={
                        active
                          ? "rounded-lg border border-gold-400 bg-gold-50 px-3 py-2 text-sm font-semibold text-ink-900 dark:bg-gold-400/10 dark:text-bone-50"
                          : "rounded-lg border border-ink-900/10 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-900/5 dark:border-white/10 dark:text-bone-100 dark:hover:bg-white/5"
                      }
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label">
            Mensagem <span className="font-normal text-ink-400">(opcional)</span>
          </label>
          <textarea
            name="message"
            rows={3}
            maxLength={300}
            placeholder="Ex: Abriu uma vaga hoje às 18h. Quem quer treinar?"
            className="input"
          />
          <p className="mt-1 text-xs text-ink-500">Se vazia, é gerada a partir do horário acima.</p>
        </div>

        {state?.error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{state.error}</div>
        )}
        {state?.ok && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            {state.count === 0
              ? "Nenhum cliente elegível (todos desligaram este aviso)."
              : `Anúncio enviado a ${state.count} cliente(s). Aparece no sininho e por push.`}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-ink-900 px-4 py-3 text-sm font-semibold text-bone-50 transition hover:bg-ink-700 disabled:opacity-60 dark:bg-bone-50 dark:text-ink-900 dark:hover:bg-bone-100"
        >
          <Megaphone size={16} /> {pending ? "A enviar…" : "Anunciar a todos os clientes"}
        </button>
      </form>
    </div>
  );
}
