import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatTime, BOOKING_STATUS } from "@/lib/utils";
import { confirmAttendanceAction, markNoShowAction, cancelAdminAction, addBlockQuickAction, deleteBlockAction } from "./actions";
import { Ban, NotebookPen } from "lucide-react";
import { NoteEditor } from "@/components/note-editor";
import { getMyNotesMapForBookings } from "@/lib/notes";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { BlockPresets } from "@/components/block-presets";
import { BookingBlock } from "./booking-popover";
import { BookingDialog } from "./booking-dialog";
import { RescheduleDialog } from "./reschedule-dialog";
import { SlotClickLayer } from "./slot-click-layer";
import { CardSkeleton } from "@/components/skeleton";
import { AgendaScrollTo7am } from "./agenda-scroll-to-7am";
import { WeekSwipeNav } from "./week-swipe-nav";

type View = "day" | "week" | "month";

// ════════════════════════════════════════════════════════════════
// PERF: shell (header + view switcher + nav buttons + BlockTimeForm)
// renderiza imediatamente. O calendario - que faz 3 queries pesadas
// (bookings, blocks, reserved) + getMyNotesMapForBookings - e
// streamed dentro de Suspense para que o utilizador veja a estrutura
// da pagina de imediato ao mudar para Agenda.
// ════════════════════════════════════════════════════════════════
export default async function AdminAgendaPage({
  searchParams,
}: {
  searchParams: { d?: string; view?: string };
}) {
  const view: View = (["day", "week", "month"].includes(searchParams.view ?? "") ? searchParams.view : "week") as View;
  const dayParam = searchParams.d;
  const day = dayParam ? new Date(dayParam + "T00:00:00") : new Date();
  day.setHours(0, 0, 0, 0);

  // trainerId precisa de ser conhecido para a BlockTimeForm / BookingDialog —
  // bloqueia apenas para isto (cached via React.cache, rapido).
  const trainerId = (await getCurrentTrainerId()) ?? "";

  // Durações permitidas + default + packs activos para o BookingDialog.
  let durations: number[] = [45, 60, 90];
  let defaultDuration = 45;
  let packs: { id: string; name: string; sessions: number; price_cents: number }[] = [];
  if (trainerId) {
    const sb = createClient();
    const [{ data: st }, { data: pk }] = await Promise.all([
      sb
        .from("trainer_settings")
        .select("slot_durations_min, default_slot_duration_min")
        .eq("trainer_id", trainerId)
        .maybeSingle(),
      sb
        .from("packs")
        .select("id, name, sessions, price_cents")
        .eq("trainer_id", trainerId)
        .eq("active", true)
        .order("sort_order"),
    ]);
    if (st) {
      durations = ((st as any).slot_durations_min as number[] | null) ?? durations;
      defaultDuration = ((st as any).default_slot_duration_min as number | null) ?? defaultDuration;
    }
    packs = (pk ?? []) as typeof packs;
  }
  const canBook = !!trainerId;

  let rangeStart: Date;
  let rangeEnd: Date;
  if (view === "day") {
    rangeStart = new Date(day);
    rangeEnd = addDays(day, 1);
  } else if (view === "week") {
    rangeStart = startOfWeek(day);
    rangeEnd = addDays(rangeStart, 7);
  } else {
    rangeStart = startOfMonthGrid(day);
    rangeEnd = addDays(rangeStart, 42);
  }

  return (
    <div className="space-y-3">
      {/* O calendário é o único conteúdo. Controlos foram movidos:
          • Nova marcação → clique num slot vazio da grelha (dispara
            agenda:newbooking → BookingDialog em modo headless).
          • Navegação entre semanas → swipe esquerda/direita.
          • Vista (Dia/Semana/Mês) → long-press no item "Agenda" do
            bottom-nav (popover com 3 opções).
          Default = vista de semana (cf. lógica acima). */}
      <Suspense
        key={`${view}-${isoDate(day)}`}
        fallback={<CardSkeleton className="h-96" />}
      >
        <CalendarView view={view} day={day} rangeStart={rangeStart} rangeEnd={rangeEnd} canBook={canBook} />
      </Suspense>

      {/* BookingDialog "headless": invisível até o utilizador clicar num
          slot da grelha. Mantém-se montado para apanhar o evento. */}
      {canBook && (
        <BookingDialog
          trainerId={trainerId}
          durations={durations}
          defaultDuration={defaultDuration}
          viewedDate={isoDate(day)}
          packs={packs}
          hideTrigger
        />
      )}

      {canBook && <RescheduleDialog />}
    </div>
  );
}

async function CalendarView({
  view, day, rangeStart, rangeEnd, canBook,
}: {
  view: View; day: Date; rangeStart: Date; rangeEnd: Date; canBook: boolean;
}) {
  const supabase = createClient();
  // PERF (Q5): trainerIds + myTrainerId são independentes (e cached) —
  // corremo-los em paralelo em vez de em série antes do calendário.
  const [trainerIds, myTrainerId] = await Promise.all([
    getAccessibleTrainerIds(),
    getCurrentTrainerId(),
  ]);
  const scope = trainerIds.length > 0 ? trainerIds : [""];

  // Preferência do viewer: mostrar canceladas na agenda? Default false →
  // esconde-as (evita o calendário cheio de eventos sobrepostos/riscados).
  let showCancelled = false;
  if (myTrainerId) {
    const { data: st } = await (supabase as any)
      .from("trainer_settings")
      .select("show_cancelled_in_calendar")
      .eq("trainer_id", myTrainerId)
      .maybeSingle();
    showCancelled = (st as any)?.show_cancelled_in_calendar ?? false;
  }

  // PERF: pedimos só as colunas usadas pela UI da agenda (antes era `*`).
  let bookingsQuery = supabase
    .from("bookings")
    .select("id, starts_at, ends_at, session_type, status, client_id, trainer_id, series_id, profiles:client_id(full_name)")
    .in("trainer_id", scope)
    .gte("starts_at", rangeStart.toISOString())
    .lt("starts_at", rangeEnd.toISOString());
  if (!showCancelled) bookingsQuery = bookingsQuery.neq("status", "cancelled");

  const [{ data: bookings }, { data: blocks }, { data: reserved }] = await Promise.all([
    bookingsQuery.order("starts_at"),
    supabase
      .from("trainer_blocked_times")
      .select("id, trainer_id, starts_at, ends_at, reason")
      .in("trainer_id", scope)
      .gte("starts_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString()),
    supabase
      .from("reserved_slots_active")
      .select("series_id, client_id, trainer_id, starts_at, ends_at, client_name")
      .in("trainer_id", scope)
      .gte("starts_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString()),
  ]);

  // PERF (#4): MonthView não consome notesMap — só Day/Week. Saltamos o
  // round-trip (e o payload das notas) por completo na vista de mês.
  const notesMap =
    view === "month"
      ? new Map<string, any>()
      : await getMyNotesMapForBookings((bookings ?? []).map((b: any) => b.id));

  return (
    <>
      {view === "day" && (
        <DayView day={day} bookings={bookings ?? []} blocks={blocks ?? []} reserved={reserved ?? []} notesMap={notesMap} />
      )}
      {view === "week" && (
        <WeekView
          start={rangeStart}
          bookings={bookings ?? []}
          blocks={blocks ?? []}
          reserved={reserved ?? []}
          notesMap={notesMap}
          canBook={canBook}
          prevHref={`/admin/agenda?view=week&d=${isoDate(stepBack("week", day))}`}
          nextHref={`/admin/agenda?view=week&d=${isoDate(stepForward("week", day))}`}
        />
      )}
      {view === "month" && (
        <MonthView gridStart={rangeStart} anchor={day} bookings={bookings ?? []} blocks={blocks ?? []} reserved={reserved ?? []} />
      )}
    </>
  );
}

function BookingItem({ b, note }: { b: any; note?: { body: string } | null }) {
  return (
    <li className="rounded-md bg-bone-100 p-2 text-xs">
      <div className="font-semibold tabular-nums">{formatTime(b.starts_at)}</div>
      <div className="mt-0.5">{b.profiles?.full_name ?? "—"}</div>
      <div className="mt-1">
        <span
          className={
            b.status === "confirmed"
              ? "chip-ok"
              : b.status === "no_show"
                ? "chip-danger"
                : b.status === "cancelled"
                  ? "chip-mute"
                  : "chip-gold"
          }
        >
          {(BOOKING_STATUS as any)[b.status] ?? b.status}
        </span>
      </div>
      {(b.status === "booked" || b.status === "confirmed") && (
        <div className="mt-2 flex flex-wrap gap-1">
          {b.status === "booked" && (
            <form action={confirmAttendanceAction}>
              <input type="hidden" name="bookingId" value={b.id} />
              <button className="rounded bg-ink-900 px-2 py-1 text-[10px] font-semibold text-bone-50 hover:bg-ink-700">
                ✓ Aceitar
              </button>
            </form>
          )}
          {b.status === "confirmed" && (
            <form action={confirmAttendanceAction}>
              <input type="hidden" name="bookingId" value={b.id} />
              <button className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                ✓ Presente
              </button>
            </form>
          )}
          <form action={markNoShowAction}>
            <input type="hidden" name="bookingId" value={b.id} />
            <button className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700">
              Falta
            </button>
          </form>
          <form action={cancelAdminAction}>
            <input type="hidden" name="bookingId" value={b.id} />
            <button className="rounded border border-ink-900/10 px-2 py-1 text-[10px] font-semibold text-ink-600">
              Cancelar
            </button>
          </form>
        </div>
      )}
      <details className="mt-2 border-t border-ink-900/10 pt-2">
        <summary className="cursor-pointer inline-flex items-center gap-1 text-[10px] font-semibold text-ink-600 hover:text-ink-900">
          <NotebookPen size={10} /> Minhas notas{note ? " · ✓" : ""}
        </summary>
        <div className="mt-2">
          <NoteEditor bookingId={b.id} initialBody={note?.body} compact />
        </div>
      </details>
    </li>
  );
}

function DayView({
  day,
  bookings,
  blocks,
  reserved,
  notesMap,
}: {
  day: Date;
  bookings: any[];
  blocks: any[];
  reserved: any[];
  notesMap: Map<string, any>;
}) {
  const dayBookings = bookings.filter((b) => sameDay(new Date(b.starts_at), day));
  const dayBlocks = blocks.filter((b) => sameDay(new Date(b.starts_at), day));
  const dayReserved = reserved.filter((r) => sameDay(new Date(r.starts_at), day));

  // merge cronológico
  const items: Array<
    | { kind: "booking"; at: Date; data: any }
    | { kind: "block"; at: Date; data: any }
    | { kind: "reserved"; at: Date; data: any }
  > = [
    ...dayBookings.map((b) => ({ kind: "booking" as const, at: new Date(b.starts_at), data: b })),
    ...dayBlocks.map((b) => ({ kind: "block" as const, at: new Date(b.starts_at), data: b })),
    ...dayReserved.map((r) => ({ kind: "reserved" as const, at: new Date(r.starts_at), data: r })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="card p-4">
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wide text-ink-500">{weekday(day)}</div>
        <div className="font-display text-xl font-bold">{fmt(day)}</div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-ink-500">Sem sessões nem bloqueios.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={`${it.kind}-${it.data.id}`} className="grid grid-cols-[60px_1fr] gap-3 border-b border-ink-900/5 pb-2 last:border-0">
              <div className="text-xs font-medium text-ink-500 tabular-nums">{formatTime(it.at)}</div>
              {it.kind === "booking" ? (
                <ul><BookingItem b={it.data} note={notesMap.get(it.data.id)} /></ul>
              ) : it.kind === "reserved" ? (
                <ReservedItem r={it.data} />
              ) : (
                <BlockItem b={it.data} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReservedItem({ r }: { r: any }) {
  return (
    <div className="rounded-md border border-ink-900/15 bg-bone-50 p-2 text-xs text-ink-600">
      <div className="font-semibold">
        Reservado · {formatTime(r.starts_at)}
        {r.ends_at ? `–${formatTime(r.ends_at)}` : ""}
      </div>
      <div className="text-ink-500">{r.client_name ?? "(cliente)"} · próxima semana da série</div>
    </div>
  );
}

function BlockItem({ b }: { b: any }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">Indisponível · {formatTime(b.starts_at)}–{formatTime(b.ends_at)}</div>
          {b.reason && <div className="text-red-700/80">{b.reason}</div>}
        </div>
        <form action={deleteBlockAction}>
          <input type="hidden" name="id" value={b.id} />
          <button
            type="submit"
            className="rounded p-1 text-red-700 hover:bg-red-100"
            aria-label="Remover bloqueio"
            title="Remover bloqueio"
          >
            ✕
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── WeekView: hour grid (Google-Calendar style) ────────────────────
// HOUR_START/END expandido para 00–24 (Jun 2026) para permitir mover
// sessões para horários fora das horas-tipo (ex: cliente excepcional
// das 06:30). A grelha é scrollável internamente — ao abrir a Agenda
// o `AgendaScrollTo7am` posiciona o scroll nas 07:00 por defeito.
// PRIME_START/END marcam o intervalo "normal" do trainer; as faixas
// fora deste intervalo ficam visualmente mais escuras como pista de
// que são horas off (ainda interactivas).
const HOUR_START = 0;
const HOUR_END = 24;
const TOTAL_HOURS = HOUR_END - HOUR_START; // 24
const PRIME_START = 7;
const PRIME_END = 21;
// HOUR_HEIGHT subido de 56→88 (Jun 2026) para que cada slot de 15 min
// passe a ter ~22 px em vez de 14 px — sessões a :15/:30/:45 ficam
// visualmente distintas dentro do rectângulo da hora. Combinado com
// as gridlines a cada 15 min mais abaixo, o utilizador consegue
// "ler" a posição vertical de uma sessão sem ambiguidade.
const HOUR_HEIGHT = 88; // px per hour

// Devolve hora/minuto de `d` no timezone Europe/Lisbon, independente
// do timezone do runtime. WeekView é Server Component — em Vercel o
// servidor corre em UTC, e `Date.prototype.getHours()` devolveria a
// hora UTC. Resultado: uma sessão às 10:30 PT (= 09:30 UTC em Junho,
// horário de Verão) seria posicionada na faixa das 09:30 enquanto
// `formatTime` (hidratado no cliente em PT) mostrava "10:30". Esta
// função alinha a matemática de posição com o que o cliente vê.
function localHM(d: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = parseInt(p.value, 10);
    else if (p.type === "minute") minute = parseInt(p.value, 10);
  }
  return { hour, minute };
}

function timeOffset(d: Date) {
  const { hour, minute } = localHM(d);
  const minutesFromStart = (hour - HOUR_START) * 60 + minute;
  return (minutesFromStart / 60) * HOUR_HEIGHT;
}

function clampPosition(start: Date, end: Date): { top: number; height: number } | null {
  const totalMin = TOTAL_HOURS * 60;
  const s = localHM(start);
  const e = localHM(end);
  const rawStart = (s.hour - HOUR_START) * 60 + s.minute;
  const rawEnd = (e.hour - HOUR_START) * 60 + e.minute;
  // BUG-FIX: ignorar slots totalmente fora da janela visível (antes
  // eram desenhados como uma barrinha encostada ao topo/fundo).
  if (rawEnd <= 0 || rawStart >= totalMin) return null;
  const startMin = Math.max(0, rawStart);
  const endMin = Math.min(totalMin, rawEnd);
  const top = (startMin / 60) * HOUR_HEIGHT;
  const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2);
  return { top, height };
}

function WeekView({
  start,
  bookings,
  blocks,
  reserved,
  notesMap,
  canBook,
  prevHref,
  nextHref,
}: {
  start: Date;
  bookings: any[];
  blocks: any[];
  reserved: any[];
  notesMap: Map<string, any>;
  canBook: boolean;
  prevHref: string;
  nextHref: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = bucketByDay(bookings, blocks, reserved); // PERF (#5): 1 passagem
  const today = new Date();
  // Mesma razão que `localHM`: o servidor pode estar em UTC, queremos
  // a hora actual em Europe/Lisbon para posicionar a linha do "agora".
  const todayHM = localHM(today);
  const nowMinutes = todayHM.hour * 60 + todayHM.minute;
  const nowInRange = nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;
  const nowTop = timeOffset(today);

  // TODOS os 7 dias cabem no ecrã (requisito do cliente): sem largura
  // mínima por coluna (minmax(0,1fr)) e sem min-width total, as 7 colunas
  // encolhem para preencher a viewport — mesmo em telemóvel (~375px →
  // ~47px/dia). Eixo de horas reduzido a 34px para dar mais espaço aos dias.
  const GRID_COLS = "34px repeat(7, minmax(0, 1fr))";

  // Off-hours overlay: faixas mais escuras antes de PRIME_START e
  // depois de PRIME_END, dentro de cada coluna (eixo + dias). Sinaliza
  // ao trainer que aquelas horas estão fora do horário-tipo, mas
  // continuam totalmente interactivas para reagendamentos pontuais.
  const offTopHeight = PRIME_START * HOUR_HEIGHT;
  const offBottomTop = PRIME_END * HOUR_HEIGHT;
  const offBottomHeight = (HOUR_END - PRIME_END) * HOUR_HEIGHT;

  return (
    <WeekSwipeNav prevHref={prevHref} nextHref={nextHref}>
    <div className="card overflow-hidden">
      <div className="overflow-x-hidden">
        {/* Container scrollável vertical: a grelha é alta (24×88 px =
            2112 px) então corta a 75 vh e os day-headers (sticky)
            ficam visíveis enquanto o trainer scrolla pelas horas. */}
        <div
          id="agenda-week-scroll"
          className="w-full overflow-y-auto"
          style={{ maxHeight: "75vh" }}
        >
          {/* Day headers — sticky no topo do scroll interno. */}
          <div
            className="sticky top-0 z-30 grid border-b border-ink-900/10 bg-bone-50"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <div className="border-r border-ink-900/10" />
            {days.map((d) => {
              const isToday = sameDay(d, today);
              return (
                <div
                  key={d.toISOString()}
                  className="border-r border-ink-900/10 px-0.5 py-2 text-center last:border-r-0"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                    {weekday(d)}
                  </div>
                  <div
                    className={`font-display text-xl font-bold ${isToday ? "text-gold-600" : ""}`}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div
            className="grid"
            style={{ gridTemplateColumns: GRID_COLS, height: TOTAL_HOURS * HOUR_HEIGHT }}
          >
          {/* Hour labels column */}
          <div data-timeaxis className="relative border-r border-ink-900/10 bg-bone-50">
            {/* Off-hours overlay (eixo). */}
            <div
              className="pointer-events-none absolute left-0 right-0 bg-ink-900/[0.05]"
              style={{ top: 0, height: offTopHeight }}
            />
            <div
              className="pointer-events-none absolute left-0 right-0 bg-ink-900/[0.05]"
              style={{ top: offBottomTop, height: offBottomHeight }}
            />
            {Array.from({ length: TOTAL_HOURS }, (_, i) => {
              const hourOfDay = HOUR_START + i;
              const isOff = hourOfDay < PRIME_START || hourOfDay >= PRIME_END;
              return (
                <div
                  key={i}
                  className={`absolute right-1 text-[9px] font-medium tabular-nums ${
                    isOff ? "text-ink-400/80" : "text-ink-500"
                  }`}
                  style={{ top: i * HOUR_HEIGHT + 4 }}
                >
                  {`${String(hourOfDay).padStart(2, "0")}:00`}
                </div>
              );
            })}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const { bookings: dayBookings, blocks: dayBlocks, reserved: dayReserved } =
              byDay.get(dayKey(d)) ?? EMPTY_DAY;
            const isToday = sameDay(d, today);

            return (
              <div
                key={d.toISOString()}
                data-daycol={isoDate(d)}
                className="relative border-r border-ink-900/10 last:border-r-0"
              >
                {/* Off-hours overlay (coluna dia) — pointer-events-none
                    para deixar o SlotClickLayer continuar a receber
                    cliques nas horas off (caso excepcional do trainer). */}
                <div
                  className="pointer-events-none absolute left-0 right-0 bg-ink-900/[0.05]"
                  style={{ top: 0, height: offTopHeight }}
                />
                <div
                  className="pointer-events-none absolute left-0 right-0 bg-ink-900/[0.05]"
                  style={{ top: offBottomTop, height: offBottomHeight }}
                />
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-ink-900/10"
                    style={{ top: i * HOUR_HEIGHT }}
                  />
                ))}
                {/* Half-hour lighter lines + quarter-hour ticks.
                    A linha pontilhada cheia continua a marcar a meia-
                    hora (mais forte) e duas linhas mais ténues marcam
                    :15 e :45 — o utilizador vê de relance em que
                    quarto da hora uma sessão começa. */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={`half-${i}`}
                    className="absolute left-0 right-0 border-t border-dashed border-ink-900/10"
                    style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                  />
                ))}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={`q1-${i}`}
                    className="absolute left-0 right-0 border-t border-dotted border-ink-900/5"
                    style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 4 }}
                  />
                ))}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={`q3-${i}`}
                    className="absolute left-0 right-0 border-t border-dotted border-ink-900/5"
                    style={{ top: i * HOUR_HEIGHT + (HOUR_HEIGHT * 3) / 4 }}
                  />
                ))}

                {/* Camada de clique para nova marcação (por baixo dos eventos) */}
                {canBook && (
                  <SlotClickLayer
                    dateIso={isoDate(d)}
                    hourStart={HOUR_START}
                    hourEnd={HOUR_END}
                    hourHeight={HOUR_HEIGHT}
                  />
                )}

                {/* Now indicator */}
                {isToday && nowInRange && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                    style={{ top: nowTop }}
                  >
                    <div className="-ml-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                    <div className="h-px flex-1 bg-red-500" />
                  </div>
                )}

                {/* Reserved slots (semana seguinte de uma série recorrente) */}
                {dayReserved.map((r) => {
                  const s = new Date(r.starts_at);
                  const e = new Date(r.ends_at);
                  const pos = clampPosition(s, e);
                  if (!pos) return null;
                  return (
                    <div
                      key={`r-${r.series_id}`}
                      className="absolute left-0.5 right-0.5 overflow-hidden rounded border border-dashed border-ink-900/30 bg-bone-100/80 p-1 text-[10px] text-ink-700"
                      style={{ top: pos.top, height: pos.height }}
                      title={`Reservado para ${r.client_name ?? "cliente"}`}
                    >
                      <div className="truncate font-semibold uppercase tracking-wide">Reservado</div>
                      <div className="truncate">{r.client_name ?? "(cliente)"}</div>
                    </div>
                  );
                })}

                {/* Blocks (indisponível) */}
                {dayBlocks.map((blk) => {
                  const s = new Date(blk.starts_at);
                  const e = new Date(blk.ends_at);
                  const pos = clampPosition(s, e);
                  if (!pos) return null;
                  return (
                    <div
                      key={`x-${blk.id}`}
                      className="absolute left-0.5 right-0.5 overflow-hidden rounded border border-red-200 bg-red-50 p-1 text-[10px] text-red-800"
                      style={{ top: pos.top, height: pos.height }}
                      title={blk.reason ?? "Indisponível"}
                    >
                      <div className="truncate font-semibold">Indisponível</div>
                      {blk.reason && (
                        <div className="truncate text-red-700/80">{blk.reason}</div>
                      )}
                    </div>
                  );
                })}

                {/* Bookings */}
                {dayBookings.map((b) => {
                  const s = new Date(b.starts_at);
                  const e = b.ends_at
                    ? new Date(b.ends_at)
                    : new Date(s.getTime() + 60 * 60 * 1000);
                  const pos = clampPosition(s, e);
                  if (!pos) return null;
                  const canDrag =
                    canBook &&
                    (b.status === "booked" || b.status === "confirmed") &&
                    s.getTime() > Date.now();
                  return (
                    <BookingBlock
                      key={`b-${b.id}`}
                      b={b}
                      note={notesMap.get(b.id)}
                      style={{ top: pos.top, height: pos.height }}
                      draggable={canDrag}
                      hourStart={HOUR_START}
                      hourEnd={HOUR_END}
                      hourHeight={HOUR_HEIGHT}
                      snapMin={15}
                    />
                  );
                })}
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
    {/* Posiciona o scroll interno em 07:00 ao montar a vista. */}
    <AgendaScrollTo7am />
    </WeekSwipeNav>
  );
}


function MonthView({ gridStart, anchor, bookings, blocks, reserved }: { gridStart: Date; anchor: Date; bookings: any[]; blocks: any[]; reserved: any[] }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const byDay = bucketByDay(bookings, blocks, reserved); // PERF (#5): 1 passagem
  const currentMonth = anchor.getMonth();
  return (
    <div className="card overflow-hidden p-2">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-500">
        {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const isCurrent = d.getMonth() === currentMonth;
          const { bookings: dayBookings, blocks: dayBlocks, reserved: dayReserved } =
            isCurrent ? (byDay.get(dayKey(d)) ?? EMPTY_DAY) : EMPTY_DAY;
          const isToday = sameDay(d, new Date());

          // Out-of-month days: heavily muted, non-interactive, no events.
          if (!isCurrent) {
            return (
              <div
                key={d.toISOString()}
                aria-hidden
                className="min-h-[78px] rounded-md border border-transparent bg-bone-50/40 p-1.5 text-left text-xs opacity-40 dark:bg-white/[0.02]"
              >
                <div className="text-[10px] font-semibold text-ink-400">{d.getDate()}</div>
              </div>
            );
          }

          return (
            <Link
              key={d.toISOString()}
              href={`/admin/agenda?view=day&d=${isoDate(d)}`}
              className={`min-h-[78px] overflow-hidden rounded-md border bg-white border-ink-900/10 p-1.5 text-left text-xs hover:bg-ink-900/5 ${
                isToday ? "ring-2 ring-gold-400" : ""
              }`}
            >
              <div className="text-[10px] font-semibold">{d.getDate()}</div>
              <div className="mt-1 space-y-0.5">
                {dayBookings.slice(0, 3).map((b) => (
                  <div
                    key={b.id}
                    className="truncate whitespace-nowrap rounded bg-gold-50 px-0.5 py-0.5 text-[9px] leading-tight text-ink-900 tabular-nums sm:px-1 sm:text-[10px]"
                  >
                    <span>{formatTime(b.starts_at)}</span>
                    <span className="hidden sm:inline">
                      {" "}
                      {shortName(b.profiles?.full_name)}
                    </span>
                  </div>
                ))}
                {dayBookings.length > 3 && (
                  <div className="text-[9px] leading-tight text-ink-500 sm:text-[10px]">+{dayBookings.length - 3}</div>
                )}
                {dayBlocks.length > 0 && (
                  <div className="truncate whitespace-nowrap rounded bg-red-50 px-0.5 py-0.5 text-[9px] leading-tight text-red-700 sm:px-1 sm:text-[10px]">
                    <span className="sm:hidden">{dayBlocks.length}× ind.</span>
                    <span className="hidden sm:inline">
                      {dayBlocks.length} bloqueio{dayBlocks.length > 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                {dayReserved.length > 0 && (
                  <div className="truncate whitespace-nowrap rounded border border-dashed border-ink-900/20 bg-bone-100 px-0.5 py-0.5 text-[9px] leading-tight text-ink-600 sm:px-1 sm:text-[10px]">
                    <span className="sm:hidden">{dayReserved.length}× res.</span>
                    <span className="hidden sm:inline">
                      {dayReserved.length} reservado{dayReserved.length > 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── BlockTimeForm: nova UX para bloquear horário ──────────────────
function BlockTimeForm({
  trainerId,
  defaultDate,
}: {
  trainerId: string;
  defaultDate: string;
}) {
  // 07:00 → 22:00 em incrementos de 30 min
  const timeOptions = Array.from({ length: 31 }, (_, i) => {
    const h = 7 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });

  return (
    <details className="card overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 transition hover:bg-bone-50">
        <div className="inline-flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-red-50 text-red-600">
            <Ban size={14} />
          </span>
          <span>Marcar-me indisponível</span>
        </div>
        <span className="text-xs text-ink-500">Bloquear um horário</span>
      </summary>

      <form
        action={addBlockQuickAction}
        className="space-y-4 border-t border-ink-900/10 p-4"
      >
        <input type="hidden" name="trainerId" value={trainerId} />

        {/* Quick presets */}
        <div>
          <div className="label">Atalhos</div>
          <BlockPresets fromId="blockFrom" toId="blockTo" />
        </div>

        {/* Date + From + To */}
        {/* min-w-0 on each grid item: prevents native iOS date input's
            intrinsic content width (label + calendar icon) from pushing
            the column wider than the viewport. */}
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div className="min-w-0">
            <label className="label" htmlFor="blockDate">Dia</label>
            <input
              id="blockDate"
              name="date"
              type="date"
              defaultValue={defaultDate}
              required
              className="input block min-w-0 max-w-full appearance-none"
            />
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="blockFrom">Início</label>
            <select id="blockFrom" name="from" required defaultValue="08:00" className="input min-w-0 max-w-full">
              {timeOptions.slice(0, -1).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor="blockTo">Fim</label>
            <select id="blockTo" name="to" required defaultValue="12:00" className="input min-w-0 max-w-full">
              {timeOptions.slice(1).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Reason */}
        <div>
          <label className="label" htmlFor="blockReason">Motivo (opcional)</label>
          <input
            id="blockReason"
            name="reason"
            placeholder="Ex: férias, consulta médica, formação…"
            className="input"
          />
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-900/5 pt-3">
          <p className="text-[11px] text-ink-500">
            O slot ficará bloqueado para novas marcações.
          </p>
          <button type="submit" className="btn-primary inline-flex items-center gap-1.5">
            <Ban size={14} /> Bloquear
          </button>
        </div>
      </form>
    </details>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────

// PERF (#5): agrupa eventos por dia numa única passagem O(n). Week/Month
// faziam antes 3× Array.filter() por cada dia da grelha (7 ou 42 dias) —
// O(dias × eventos); agora cada célula faz lookup O(1) neste Map.
type DayBucket = { bookings: any[]; blocks: any[]; reserved: any[] };
const EMPTY_DAY: DayBucket = { bookings: [], blocks: [], reserved: [] };
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function bucketByDay(bookings: any[], blocks: any[], reserved: any[]): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  const cell = (k: string) => {
    let e = map.get(k);
    if (!e) { e = { bookings: [], blocks: [], reserved: [] }; map.set(k, e); }
    return e;
  };
  for (const b of bookings) cell(dayKey(new Date(b.starts_at))).bookings.push(b);
  for (const b of blocks) cell(dayKey(new Date(b.starts_at))).blocks.push(b);
  for (const r of reserved) cell(dayKey(new Date(r.starts_at))).reserved.push(r);
  return map;
}

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonthGrid(d: Date) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function weekNumber(d: Date) {
  // Devolve a chave aaaa-Www (ISO 8601-ish, suficiente para keys).
  const tmp = new Date(d);
  tmp.setHours(0, 0, 0, 0);
  // Quinta-feira da mesma semana ISO.
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const week1 = new Date(tmp.getFullYear(), 0, 4);
  const weekNo =
    1 +
    Math.round(
      ((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7,
    );
  return `${tmp.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function stepBack(view: "day" | "week" | "month", day: Date) {
  if (view === "day") return addDays(day, -1);
  if (view === "week") return addDays(day, -7);
  return new Date(day.getFullYear(), day.getMonth() - 1, 1);
}

function stepForward(view: "day" | "week" | "month", day: Date) {
  if (view === "day") return addDays(day, 1);
  if (view === "week") return addDays(day, 7);
  return new Date(day.getFullYear(), day.getMonth() + 1, 1);
}

function rangeLabel(view: "day" | "week" | "month", day: Date, rangeStart: Date, rangeEnd: Date) {
  const MONTHS_PT = [
    "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
  ];
  const fmtDay = (d: Date) => `${d.getDate()} ${MONTHS_PT[d.getMonth()]}`;
  if (view === "day") return fmtDay(day);
  if (view === "month") return `${MONTHS_PT[day.getMonth()]} ${day.getFullYear()}`;
  // week
  const endInclusive = addDays(rangeEnd, -1);
  if (rangeStart.getMonth() === endInclusive.getMonth()) {
    return `${rangeStart.getDate()} – ${endInclusive.getDate()} ${MONTHS_PT[rangeStart.getMonth()]} ${rangeStart.getFullYear()}`;
  }
  return `${fmtDay(rangeStart)} – ${fmtDay(endInclusive)} ${rangeStart.getFullYear()}`;
}

// Helpers de formatação consumidos por DayView/WeekView.
const WEEKDAYS_PT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
function weekday(d: Date) {
  return WEEKDAYS_PT[d.getDay()];
}
function fmt(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Primeiro nome do cliente, truncado a 7 chars para caber dentro do
// bloco da sessão (especialmente na vista de mês, com células muito
// estreitas).
function shortName(full?: string | null) {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 7);
}

