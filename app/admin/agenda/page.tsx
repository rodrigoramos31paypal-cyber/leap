import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatTime, BOOKING_STATUS } from "@/lib/utils";
import { confirmAttendanceAction, markNoShowAction, cancelAdminAction, addBlockQuickAction, deleteBlockAction, skipRecurringDateAction, deleteRecurringBlockAction } from "./actions";
import { Ban, NotebookPen } from "lucide-react";
import { NoteEditor } from "@/components/note-editor";
import { getMyNotesMapForBookings, getClientNotesByBookings, getTeamNotesByBookings } from "@/lib/notes";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { BlockPresets } from "@/components/block-presets";
import { BookingBlock } from "./booking-popover";
import { BusyBlock } from "./busy-block";
import { SlotClickLayer } from "./slot-click-layer";
import { CardSkeleton } from "@/components/skeleton";
import { AgendaScrollTo7am } from "./agenda-scroll-to-7am";
import { MonthPicker } from "./month-picker";
import { WeekSwipeNav } from "./week-swipe-nav";
// PERF (QW-11): lazy/no-SSR dos diálogos. Next 16 não deixa usar
// `next/dynamic({ ssr: false })` em Server Components — vive num
// Client Component dedicado (`agenda-dialogs.tsx`) que faz o mesmo
// truque. Mesmo cap de ~25 KB minified retido.
import { AgendaDialogs } from "./agenda-dialogs";

type View = "day" | "week" | "month";

// ════════════════════════════════════════════════════════════════
// PERF: shell (header + view switcher + nav buttons + BlockTimeForm)
// renderiza imediatamente. O calendario - que faz 3 queries pesadas
// (bookings, blocks, reserved) + getMyNotesMapForBookings - e
// streamed dentro de Suspense para que o utilizador veja a estrutura
// da pagina de imediato ao mudar para Agenda.
// ════════════════════════════════════════════════════════════════
export default async function AdminAgendaPage(props: {
  searchParams: Promise<{ d?: string; view?: string; booking?: string }>;
}) {
  const searchParams = await props.searchParams;
  const view: View = (["day", "week", "month"].includes(searchParams.view ?? "") ? searchParams.view : "week") as View;
  const dayParam = searchParams.d;
  const day = dayParam ? new Date(dayParam + "T00:00:00") : new Date();
  day.setHours(0, 0, 0, 0);
  // Deep-link de notificação: abrir o popover da sessão alvo. Validado
  // como UUID antes de descer aos BookingBlocks para evitar attribute
  // injection no DOM.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const focusBookingId =
    searchParams.booking && UUID_RE.test(searchParams.booking)
      ? searchParams.booking
      : undefined;

  // trainerId precisa de ser conhecido para a BlockTimeForm / BookingDialog —
  // bloqueia apenas para isto (cached via React.cache, rapido).
  const trainerId = (await getCurrentTrainerId()) ?? "";

  // Durações permitidas + default + packs activos para o BookingDialog.
  let durations: number[] = [45, 60, 90];
  let defaultDuration = 45;
  let packs: { id: string; name: string; sessions: number; price_cents: number }[] = [];
  if (trainerId) {
    const sb = await createClient();
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
  // O dropdown do ADMIN inclui sempre 30 min — o admin/staff pode marcar
  // sessões de 30 min em nome do cliente, mesmo que `slot_durations_min`
  // (que controla o que os clientes veem) só permita 45. Não altera as
  // durações disponíveis para os clientes no fluxo /app.
  const adminDurations = Array.from(new Set([30, ...durations])).sort((a, b) => a - b);
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
        key={`${view}-${isoDate(day)}-${focusBookingId ?? ""}`}
        fallback={<CardSkeleton className="h-96" />}
      >
        <CalendarView
          view={view}
          day={day}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          canBook={canBook}
          focusBookingId={focusBookingId}
        />
      </Suspense>

      {/* BookingDialog "headless" + RescheduleDialog: invisíveis até o
          utilizador interagir. Montados num Client Component wrapper
          (Next 16 — ver agenda-dialogs.tsx). */}
      {canBook && (
        <AgendaDialogs
          trainerId={trainerId}
          durations={adminDurations}
          defaultDuration={defaultDuration}
          viewedDate={isoDate(day)}
          packs={packs}
        />
      )}
    </div>
  );
}

async function CalendarView({
  view, day, rangeStart, rangeEnd, canBook, focusBookingId,
}: {
  view: View; day: Date; rangeStart: Date; rangeEnd: Date; canBook: boolean;
  /** Quando definido, o BookingBlock com este id auto-abre o popover. */
  focusBookingId?: string;
}) {
  const supabase = await createClient();
  // PERF (Q5): trainerIds + myTrainerId são independentes (e cached) —
  // corremo-los em paralelo em vez de em série antes do calendário.
  const [trainerIds, myTrainerId] = await Promise.all([
    getAccessibleTrainerIds(),
    getCurrentTrainerId(),
  ]);
  const scope = trainerIds.length > 0 ? trainerIds : [""];

  // PERF (audit #2): UMA vaga paralela para TUDO o que não depende do
  // payload de `bookings`. Antes a preferência show_cancelled, os
  // bloqueios recorrentes (+skips) e a disponibilidade semanal eram
  // 'waterfalled' em série (≈4-5 round-trips desnecessários). As
  // canceladas passam a ser filtradas em JS depois de sabermos a
  // preferência — em vez de condicionar a query e serializar.
  const [
    settingRes,
    bookingsRes,
    blocksRes,
    reservedRes,
    recurringBlocksRes,
    blockSkipsRes,
    availRes,
  ] = await Promise.all([
    myTrainerId
      ? (supabase as any)
          .from("trainer_settings")
          .select("show_cancelled_in_calendar")
          .eq("trainer_id", myTrainerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // PERF: só as colunas usadas pela UI (antes era `*`). purchases:
    // purchase_id(...) → progresso do pack no popover.
    supabase
      .from("bookings")
      .select(
        "id, starts_at, ends_at, session_type, status, client_id, trainer_id, series_id, purchase_id, partner_client_id, profiles:client_id(full_name, email), partner_profiles:partner_client_id(full_name), purchases:purchase_id(sessions_total, sessions_remaining, pack_snapshot)",
      )
      .in("trainer_id", scope)
      .gte("starts_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString())
      .order("starts_at"),
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
    (supabase as any)
      .from("trainer_recurring_blocks")
      .select("id, trainer_id, day_of_week, start_time, end_time, reason, active")
      .in("trainer_id", scope)
      .eq("active", true),
    (supabase as any)
      .from("trainer_recurring_block_skips")
      .select("trainer_id, skip_date")
      .in("trainer_id", scope)
      .gte("skip_date", isoDate(rangeStart))
      .lt("skip_date", isoDate(rangeEnd)),
    view === "week"
      ? (supabase as any)
          .from("trainer_availability")
          .select("day_of_week, start_time, end_time, active")
          .in("trainer_id", scope)
          .eq("active", true)
      : Promise.resolve({ data: [] }),
  ]);

  // Preferência do viewer: mostrar canceladas? Default false → esconde-as
  // (evita o calendário cheio de eventos sobrepostos/riscados).
  const showCancelled = (settingRes.data as any)?.show_cancelled_in_calendar ?? false;
  let bookings = (bookingsRes.data ?? []) as any[];
  if (!showCancelled) bookings = bookings.filter((b: any) => b.status !== "cancelled");
  const blocks = blocksRes.data;
  const reserved = reservedRes.data;
  const recurringBlocks = recurringBlocksRes.data;
  const blockSkips = blockSkipsRes.data;
  const availRows = availRes.data;

  // PERF (audit #2): 2ª (e última) vaga — só os reads que dependem mesmo
  // de `bookings`, corridos em paralelo entre si.
  //   • notesMap: notas do trainer por marcação (só Day/Week; o Month
  //     não consome notas → saltamos o round-trip e o payload).
  //   • creditRows: saldo de sessões por cliente (purchases confirmadas).
  const clientIds = Array.from(
    new Set(bookings.map((b: any) => b.client_id).filter(Boolean)),
  );
  // DUO: parceiros das marcações duplas. O saldo PT Dupla é PARTILHADO e o
  // pack pode viver só numa das contas — precisamos das compras do parceiro
  // para não sinalizar "último crédito" a quem tem 0 packs próprios mas cujo
  // par tem o pack (saldo partilhado > 0).
  const partnerIds = Array.from(
    new Set(bookings.map((b: any) => b.partner_client_id).filter(Boolean)),
  );
  const balanceIds = Array.from(new Set([...clientIds, ...partnerIds]));
  // Notas do CLIENTE por booking — visíveis ao trainer (RLS 0078).
  // Carregadas em Day/Week para o popover sinalizar e mostrar a nota
  // que o cliente deixou ao marcar (ou mais tarde). No Month não é
  // consumida → saltamos o round-trip.
  const [notesMap, clientNotesMap, teamNotesMap, creditRows] = await Promise.all([
    view === "month"
      ? Promise.resolve(new Map<string, any>())
      : getMyNotesMapForBookings(bookings.map((b: any) => b.id)),
    view === "month"
      ? Promise.resolve(new Map<string, any>())
      : getClientNotesByBookings(
          bookings
            .filter((b: any) => b.client_id)
            .map((b: any) => ({ id: b.id, clientId: b.client_id as string })),
        ),
    view === "month"
      ? Promise.resolve(new Map<string, { authorName: string; body: string }[]>())
      : getTeamNotesByBookings(
          bookings
            .filter((b: any) => b.client_id)
            .map((b: any) => ({ id: b.id, clientId: b.client_id as string })),
        ),
    // PERF (CB-7 audit jun/2026): scope filter por trainer — antes
    // trazia TODAS as compras confirmadas de cada cliente em qualquer
    // trainer do sistema (irrelevante para o admin a olhar para a sua
    // agenda). Para um cliente que treine com 2 trainers, era 2× o
    // payload necessário; para owner com 5 trainers, 5×.
    clientIds.length > 0
      ? (supabase
          .from("purchases")
          .select("client_id, session_type, sessions_remaining, expires_at, status")
          .in("client_id", balanceIds)
          .in("trainer_id", scope)
          .eq("status", "confirmed")
          .then((r: any) => (r.data ?? []) as any[]))
      : Promise.resolve([] as any[]),
  ]);

  // Sessões restantes por cliente — soma de `sessions_remaining` em
  // purchases CONFIRMED e não expiradas.
  const sessionsLeftMap = new Map<string, number>();
  // DUO: saldo só dos packs `dupla`, por cliente. Usado para somar o saldo
  // PARTILHADO do par (own total + dupla do parceiro).
  const duplaLeftMap = new Map<string, number>();
  // "Último crédito": IDs das marcações a sinalizar a vermelho. Um cliente
  // cujo saldo de packs chegou a 0 (gastou o último crédito) tem a sua
  // ÚLTIMA marcação ativa marcada aqui, para alertar o trainer.
  const lastCreditIds = new Set<string>();
  // DUO: parceiro de cada cliente, inferido das marcações duplas visíveis.
  const partnerOf = new Map<string, string>();
  for (const b of bookings as any[]) {
    if (b.partner_client_id && b.client_id) {
      partnerOf.set(b.client_id, b.partner_client_id);
      partnerOf.set(b.partner_client_id, b.client_id);
    }
  }
  if (clientIds.length > 0) {
    const now = Date.now();
    for (const row of creditRows as any[]) {
      if (row.expires_at && new Date(row.expires_at).getTime() < now) continue;
      const rem = Number(row.sessions_remaining ?? 0);
      sessionsLeftMap.set(row.client_id, (sessionsLeftMap.get(row.client_id) ?? 0) + rem);
      if (row.session_type === "dupla") {
        duplaLeftMap.set(row.client_id, (duplaLeftMap.get(row.client_id) ?? 0) + rem);
      }
    }

    // Clientes com saldo de packs == 0 (último crédito gasto). Têm de ter
    // um registo de saldo (>= 1 pack confirmado) — um cliente sem packs
    // (ex.: cortesia) não entra no mapa e não é sinalizado. DUO: soma o
    // saldo dupla PARTILHADO do parceiro (o pack pode estar só na conta do
    // par) — sem isto, o booker com 0 packs próprios era falsamente
    // sinalizado apesar de o par ter sessões.
    const zeroClients = clientIds.filter((id: string) => {
      if (!sessionsLeftMap.has(id)) return false;
      const partner = partnerOf.get(id);
      const shared =
        (sessionsLeftMap.get(id) ?? 0) +
        (partner ? (duplaLeftMap.get(partner) ?? 0) : 0);
      return shared === 0;
    });
    if (zeroClients.length > 0) {
      // A ÚLTIMA marcação ativa (mais tardia) de cada cliente sem saldo é
      // a "sessão do último crédito". Sem limite de data para apanhar a
      // última real, mesmo fora da janela visível. (Depende de creditRows,
      // por isso fica serial dentro desta vaga — só corre quando há mesmo
      // clientes a zero.)
      // PERF (CB-7 audit jun/2026): a query original era sem limit()
      // e ordenada por starts_at desc — para um cliente que treine há
      // 2 anos, trazia centenas de rows para identificar 1 booking.
      // Agora limitamos a (zeroClients × 5) — chega de sobra para a
      // iteração JS escolher a mais tardia de cada cliente, e o
      // payload é proporcional ao nº de clientes em vez do histórico.
      const { data: lastRows } = await supabase
        .from("bookings")
        .select("id, client_id, starts_at")
        .in("client_id", zeroClients)
        .in("trainer_id", scope)
        .in("status", ["booked", "confirmed"])
        .order("starts_at", { ascending: false })
        .limit(zeroClients.length * 5);
      const seen = new Set<string>();
      for (const row of (lastRows ?? []) as any[]) {
        if (seen.has(row.client_id)) continue; // só a mais tardia por cliente
        seen.add(row.client_id);
        lastCreditIds.add(row.id);
      }
    }
  }

  // ── Bloqueios RECORRENTES (semanais) ────────────────────────────
  // Expandidos em instâncias concretas para o intervalo visível, para
  // renderizarem como "indisponível" e contarem no collapse das linhas.
  // Um "skip" para uma data limpa a recorrência só nesse dia.
  // (recurringBlocks + blockSkips já vieram na 1ª vaga acima.)
  const skipSet = new Set<string>();
  for (const s of (blockSkips ?? []) as any[]) skipSet.add(`${s.trainer_id}:${s.skip_date}`);

  const recurringInstances: any[] = [];
  if (((recurringBlocks ?? []) as any[]).length > 0) {
    const totalDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000);
    for (let i = 0; i < totalDays; i++) {
      const dt = addDays(rangeStart, i);
      const iso = isoDate(dt);
      const dow = dt.getDay();
      for (const rb of (recurringBlocks ?? []) as any[]) {
        if (Number(rb.day_of_week) !== dow) continue;
        if (skipSet.has(`${rb.trainer_id}:${iso}`)) continue;
        const [sh, sm] = String(rb.start_time).split(":").map(Number);
        const [eh, em] = String(rb.end_time).split(":").map(Number);
        const [yy, mm, dd] = iso.split("-").map(Number);
        recurringInstances.push({
          id: `rb:${rb.id}:${iso}`,
          recurring_id: rb.id,
          is_recurring: true,
          trainer_id: rb.trainer_id,
          starts_at: lisbonWallToUtc(yy, mm - 1, dd, sh, sm).toISOString(),
          ends_at: lisbonWallToUtc(yy, mm - 1, dd, eh, em).toISOString(),
          reason: rb.reason,
        });
      }
    }
  }
  const allBlocks: any[] = [...((blocks ?? []) as any[]), ...recurringInstances];

  // Horário de trabalho do(s) trainer(s) — determina que horas podem
  // encolher na vista de semana. Só carregado nessa vista.
  const availMap: AvailMap = new Map();
  if (view === "week") {
    for (const row of (availRows ?? []) as any[]) {
      const dow = Number(row.day_of_week);
      const arr = availMap.get(dow) ?? [];
      arr.push([parseHM(String(row.start_time)), parseHM(String(row.end_time))]);
      availMap.set(dow, arr);
    }
  }

  return (
    <>
      {view === "day" && (
        <DayView
          day={day}
          bookings={bookings ?? []}
          blocks={allBlocks}
          reserved={reserved ?? []}
          notesMap={notesMap}
          clientNotesMap={clientNotesMap}
          teamNotesMap={teamNotesMap}
          sessionsLeftMap={sessionsLeftMap}
          lastCreditIds={lastCreditIds}
          canBook={canBook}
          avail={availMap}
          focusBookingId={focusBookingId}
          prevHref={`/admin/agenda?view=day&d=${isoDate(stepBack("day", day))}`}
          nextHref={`/admin/agenda?view=day&d=${isoDate(stepForward("day", day))}`}
        />
      )}
      {view === "week" && (
        <WeekView
          start={rangeStart}
          bookings={bookings ?? []}
          blocks={allBlocks}
          reserved={reserved ?? []}
          notesMap={notesMap}
          clientNotesMap={clientNotesMap}
          teamNotesMap={teamNotesMap}
          sessionsLeftMap={sessionsLeftMap}
          lastCreditIds={lastCreditIds}
          canBook={canBook}
          avail={availMap}
          focusBookingId={focusBookingId}
          prevHref={`/admin/agenda?view=week&d=${isoDate(stepBack("week", day))}`}
          nextHref={`/admin/agenda?view=week&d=${isoDate(stepForward("week", day))}`}
        />
      )}
      {view === "month" && (
        <MonthView gridStart={rangeStart} anchor={day} bookings={bookings ?? []} blocks={allBlocks} reserved={reserved ?? []} lastCreditIds={lastCreditIds} />
      )}
    </>
  );
}

function BookingItem({ b, note, isLastCredit = false }: { b: any; note?: { body: string } | null; isLastCredit?: boolean }) {
  return (
    <li className={`rounded-md bg-bone-100 p-2 text-xs ${isLastCredit ? "ring-2 ring-inset ring-red-500" : ""}`}>
      <div className="font-semibold tabular-nums">{formatTime(b.starts_at)}</div>
      <div className="mt-0.5">
        {b.profiles?.full_name ?? "—"}
        {b.partner_profiles?.full_name ? ` & ${b.partner_profiles.full_name}` : ""}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
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
        {isLastCredit && (
          <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Último crédito
          </span>
        )}
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

// ─── DayView ────────────────────────────────────────────────────────
// Reaproveita a MESMA grelha-tempo da WeekView mas com uma única coluna.
// Sessões: BookingBlock (popover + drag-and-drop para reagendar).
// Bloqueios: BusyBlock (clicável para editar/remover). Slot vazio:
// SlotClickLayer (abre o BookingDialog para nova marcação). Tudo igual
// ao que a vista semanal já oferece — pedido explícito do cliente.
function DayView({
  day,
  bookings,
  blocks,
  reserved,
  notesMap,
  clientNotesMap,
  teamNotesMap,
  sessionsLeftMap,
  lastCreditIds,
  canBook,
  avail,
  focusBookingId,
  prevHref,
  nextHref,
}: {
  day: Date;
  bookings: any[];
  blocks: any[];
  reserved: any[];
  notesMap: Map<string, any>;
  clientNotesMap: Map<string, any>;
  teamNotesMap: Map<string, { authorName: string; body: string }[]>;
  sessionsLeftMap: Map<string, number>;
  lastCreditIds: Set<string>;
  canBook: boolean;
  avail: AvailMap;
  focusBookingId?: string;
  prevHref: string;
  nextHref: string;
}) {
  const days = [day];
  const byDay = bucketByDay(bookings, blocks, reserved);
  const { bookings: dayBookings, blocks: dayBlocks, reserved: dayReserved } =
    byDay.get(dayKey(day)) ?? EMPTY_DAY;
  const today = new Date();
  const isToday = sameDay(day, today);

  // Mesmo layout de horas com altura variável usado na semana — horas
  // não-marcáveis encolhem, dia de trabalho cabe sem scroll.
  const layout = buildRowLayout(days, byDay, avail);
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i);

  const todayHM = localHM(today);
  const nowMinutes = todayHM.hour * 60 + todayHM.minute;
  const nowInRange = nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;
  const nowTop = yForMinutes(layout, nowMinutes);

  // Coluna única — eixo de horas + 1fr.
  const GRID_COLS = "32px minmax(0, 1fr)";

  return (
    <WeekSwipeNav prevHref={prevHref} nextHref={nextHref}>
      <div className="card overflow-hidden">
        <div className="overflow-x-hidden">
          <div
            id="agenda-week-scroll"
            className="w-full overflow-y-auto"
            style={{ maxHeight: "75vh" }}
          >
            {/* Day header — sticky, igual ao da semana, com faixa do mês/ano. */}
            <div className="sticky top-0 z-30 bg-bone-50">
              <MonthPicker
                label={monthRangeLabel(day, day)}
                anchorIso={isoDate(day)}
                view="day"
              />
              <div
                className="grid border-b border-ink-900/10 bg-bone-50"
                style={{ gridTemplateColumns: GRID_COLS }}
              >
                <div className="border-r border-ink-900/10" />
                <div className="border-r border-ink-900/10 px-2 py-2 text-center">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                    {weekday(day)}
                  </div>
                  <div className={`font-display text-xl font-bold ${isToday ? "text-gold-600" : ""}`}>
                    {fmt(day)}
                  </div>
                </div>
              </div>
            </div>

            {/* Time grid */}
            <div
              className="grid"
              style={{ gridTemplateColumns: GRID_COLS, height: layout.total }}
            >
              {/* Eixo de horas. */}
              <div data-timeaxis className="relative border-r border-ink-900/10 bg-bone-50">
                {hours.map((h) => {
                  const isCollapsed = layout.collapsed[h];
                  return (
                    <div
                      key={h}
                      className={`absolute right-1 text-[9px] font-medium tabular-nums ${
                        isCollapsed ? "text-ink-400/70" : "text-ink-500"
                      }`}
                      style={{ top: layout.tops[h] + (isCollapsed ? 1 : 4) }}
                    >
                      {String(h).padStart(2, "0")}
                    </div>
                  );
                })}
              </div>

              {/* Day column — exactly the same internals as WeekView's column. */}
              <div
                data-daycol={isoDate(day)}
                className="relative border-r border-ink-900/10"
              >
                {hours.map((h) => {
                  const isCollapsed = layout.collapsed[h];
                  const top = layout.tops[h];
                  const ht = layout.heights[h];
                  return (
                    <div key={`row-${h}`}>
                      {isCollapsed && (
                        <div
                          className="pointer-events-none absolute left-0 right-0 bg-ink-900/[0.03]"
                          style={{ top, height: ht }}
                        >
                          <div
                            className="absolute left-0 right-0 border-t border-dashed border-ink-900/15"
                            style={{ top: ht / 2 }}
                          />
                        </div>
                      )}
                      <div
                        className="pointer-events-none absolute left-0 right-0 border-t border-ink-900/10"
                        style={{ top }}
                      />
                      {!isCollapsed && (
                        <>
                          <div
                            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-ink-900/10"
                            style={{ top: top + ht / 2 }}
                          />
                          <div
                            className="pointer-events-none absolute left-0 right-0 border-t border-dotted border-ink-900/5"
                            style={{ top: top + ht / 4 }}
                          />
                          <div
                            className="pointer-events-none absolute left-0 right-0 border-t border-dotted border-ink-900/5"
                            style={{ top: top + (ht * 3) / 4 }}
                          />
                        </>
                      )}
                    </div>
                  );
                })}

                {canBook && (
                  <SlotClickLayer
                    dateIso={isoDate(day)}
                    rowTops={layout.tops}
                    rowHeights={layout.heights}
                    rowStopsMin={layout.stopsMin}
                    rowStopsY={layout.stopsY}
                  />
                )}

                {isToday && nowInRange && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                    style={{ top: nowTop }}
                  >
                    <div className="-ml-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                    <div className="h-px flex-1 bg-red-500" />
                  </div>
                )}

                {dayReserved.map((r: any) => {
                  const s = new Date(r.starts_at);
                  const e = new Date(r.ends_at);
                  const pos = clampPosition(layout, s, e);
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

                {dayBlocks.map((blk: any) => {
                  const pos = clampPosition(layout, new Date(blk.starts_at), new Date(blk.ends_at));
                  if (!pos) return null;
                  return (
                    <BusyBlock
                      key={`x-${blk.id}`}
                      b={blk}
                      canEdit={canBook}
                      style={{ top: pos.top, height: pos.height }}
                    />
                  );
                })}

                {(() => {
                  // Mesmo algoritmo de side-by-side / sobreposição da
                  // WeekView (greedy + reuso) — extraído tal e qual para
                  // que sessões empilhadas dividam a largura da coluna do
                  // dia, igual à vista semanal.
                  const act = dayBookings
                    .filter((x: any) => x.status === "booked" || x.status === "confirmed" || x.status === "no_show")
                    .map((x: any) => ({
                      id: x.id,
                      s: new Date(x.starts_at).getTime(),
                      e: x.ends_at
                        ? new Date(x.ends_at).getTime()
                        : new Date(x.starts_at).getTime() + 3_600_000,
                    }))
                    .sort((a: { s: number }, b: { s: number }) => a.s - b.s);
                  // Sessões que começam EXACTAMENTE à mesma hora que outra
                  // (mesmo start ms) — precisam de colunas lado-a-lado mesmo
                  // em mobile, senão a de trás fica 100% tapada.
                  const startCounts = new Map<number, number>();
                  for (const it of act)
                    startCounts.set(it.s, (startCounts.get(it.s) ?? 0) + 1);
                  const colOf = new Map<string, number>();
                  const groupOf = new Map<string, number>();
                  const groupCols = new Map<number, number>();
                  let nextGroup = 0;
                  let curGroup = -1;
                  const live: { id: string; e: number; col: number }[] = [];
                  for (const it of act) {
                    for (let i = live.length - 1; i >= 0; i--) {
                      if (live[i].e <= it.s) live.splice(i, 1);
                    }
                    if (live.length === 0) curGroup = nextGroup++;
                    const used = new Set(live.map((l) => l.col));
                    let col = 0;
                    while (used.has(col)) col++;
                    colOf.set(it.id, col);
                    groupOf.set(it.id, curGroup);
                    groupCols.set(
                      curGroup,
                      Math.max(groupCols.get(curGroup) ?? 1, col + 1),
                    );
                    live.push({ id: it.id, e: it.e, col });
                  }
                  const { endMsById, startRank, clipEndMs } = overlapShrink(act);

                  return dayBookings.map((b: any) => {
                    const s = new Date(b.starts_at);
                    const e = b.ends_at
                      ? new Date(b.ends_at)
                      : new Date(s.getTime() + 60 * 60 * 1000);
                    const pos = clampPosition(layout, s, e);
                    if (!pos) return null;
                    // Drag liberado para passado/presente/futuro (pedido
                    // do trainer): basta a sessão estar activa. O servidor
                    // (reschedule_booking_admin) também aceita slot/origem
                    // no passado para o caminho admin.
                    const canDrag =
                      canBook && (b.status === "booked" || b.status === "confirmed");
                    const g = groupOf.get(b.id);
                    const cols = g !== undefined ? groupCols.get(g) ?? 1 : 1;
                    const col = colOf.get(b.id) ?? 0;
                    const isOverlap = cols > 1;
                    const sameStart =
                      (startCounts.get(new Date(b.starts_at).getTime()) ?? 0) > 1;
                    // Mobile: altura encolhida até ao início da sessão
                    // seguinte. Desktop repõe pos.height via --h-full (CSS).
                    const mobileH = isOverlap
                      ? shrunkHeight(layout, s, pos.height, clipEndMs.get(b.id), endMsById.get(b.id))
                      : pos.height;
                    const overlapStyle: React.CSSProperties = isOverlap
                      ? ({
                          "--ov-col": col,
                          "--ov-cols": cols,
                          "--h-full": `${pos.height}px`,
                          zIndex: (b.status === "no_show" ? 10 : 20) + (startRank.get(b.id) ?? 0),
                        } as any)
                      : {};
                    return (
                      <BookingBlock
                        key={`b-${b.id}`}
                        b={b}
                        note={notesMap.get(b.id)}
                        clientNote={clientNotesMap.get(b.id)}
                        teamNotes={teamNotesMap.get(b.id)}
                        style={{ top: pos.top, height: mobileH, ...overlapStyle }}
                        draggable={canDrag}
                        rowTops={layout.tops}
                        rowHeights={layout.heights}
                        rowStopsMin={layout.stopsMin}
                        rowStopsY={layout.stopsY}
                        snapMin={15}
                        sessionsLeft={sessionsLeftMap.get(b.client_id)}
                        isLastCredit={lastCreditIds.has(b.id)}
                        overlap={isOverlap}
                        overlapCol={col}
                        sameStart={sameStart}
                        autoOpen={focusBookingId === b.id}
                      />
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
      <AgendaScrollTo7am top={layout.tops[7]} />
    </WeekSwipeNav>
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
          <div className="font-semibold">
            Ocupado · {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
            {b.is_recurring && (
              <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-red-700">
                recorrente
              </span>
            )}
          </div>
          {b.reason && <div className="text-red-700/80">{b.reason}</div>}
        </div>
        {b.is_recurring ? (
          <div className="flex shrink-0 items-center gap-1">
            <form action={skipRecurringDateAction}>
              <input type="hidden" name="trainerId" value={b.trainer_id} />
              <input type="hidden" name="date" value={isoDate(new Date(b.starts_at))} />
              <button
                type="submit"
                className="rounded px-1.5 py-1 text-[10px] font-medium text-red-700 hover:bg-red-100"
                title="Limpar a recorrência só neste dia"
              >
                Só hoje
              </button>
            </form>
            <form action={deleteRecurringBlockAction}>
              <input type="hidden" name="id" value={b.recurring_id} />
              <button
                type="submit"
                className="rounded p-1 text-red-700 hover:bg-red-100"
                aria-label="Remover recorrência"
                title="Remover a recorrência (todas as semanas)"
              >
                ✕
              </button>
            </form>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}

// ─── WeekView: hour grid (Google-Calendar style) ────────────────────
// A grelha cobre 00–24h. As linhas-hora têm ALTURA VARIÁVEL (Jun 2026):
//  • Horas "úteis" (dentro do horário de trabalho do trainer e/ou com
//    sessões) ficam à altura cheia (FULL_HOUR_HEIGHT) — legíveis ao
//    minuto.
//  • Horas onde NADA pode ser marcado (fora do horário de trabalho OU
//    totalmente bloqueadas) e SEM sessões encolhem para uma faixa fina
//    (COLLAPSED_HOUR_HEIGHT). Assim cabem muito mais horas no ecrã sem
//    scroll, mantendo as horas de trabalho confortáveis.
//  • Em vista de semana uma hora só encolhe se for "encolhível" nos 7
//    dias visíveis (as colunas partilham a mesma grelha de horas). Se o
//    trainer puser uma sessão por cima de uma hora bloqueada (override),
//    essa hora volta a ficar cheia automaticamente.
const HOUR_START = 0;
const HOUR_END = 24;
const TOTAL_HOURS = HOUR_END - HOUR_START; // 24
const FULL_HOUR_HEIGHT = 80; // px — hora útil (slot de 15 min ≈ 20 px)
const COLLAPSED_HOUR_HEIGHT = 22; // px — hora não-marcável encolhida
// Quando duas sessões arrancam com poucos minutos de intervalo dentro da
// mesma hora, a da frente (mobile) fica cortada até ao arranque da seguinte
// e não cabe o nome. Em vez de esticar a hora TODA (que inflava também as
// sessões seguintes e os blocos "Ocupado"), esticamos APENAS esse pequeno
// intervalo, via um mapa tempo→px por troços (stops). Assim o bloco cortado
// ganha STACK_MIN_PX de altura e tudo o que começa depois fica intacto.
const STACK_MIN_PX = 44; // altura-alvo do intervalo apertado entre 2 arranques

type RowLayout = {
  heights: number[]; // length 24
  tops: number[]; // length 24, topo cumulativo de cada hora
  total: number; // altura total da grelha
  collapsed: boolean[]; // length 24
  // Mapa tempo→px por troços (breakpoints monótonos crescentes). Permite
  // esticar só sub-intervalos de uma hora sem inflar o resto. Mesmo
  // comprimento; minutos-desde-meia-noite ↔ y em px.
  stopsMin: number[];
  stopsY: number[];
};

// Interpolação linear por troços sobre breakpoints monótonos crescentes.
// Forward (min→px): _interp(stopsMin, stopsY, min).
// Inverso (px→min): _interp(stopsY, stopsMin, y).
function _interp(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (i < n - 1 && xs[i + 1] < x) i++;
  const x0 = xs[i];
  const x1 = xs[i + 1];
  if (x1 === x0) return ys[i];
  return ys[i] + ((x - x0) / (x1 - x0)) * (ys[i + 1] - ys[i]);
}

// Devolve hora/minuto de `d` no timezone Europe/Lisbon, independente
// do timezone do runtime. WeekView é Server Component — em Vercel o
// servidor corre em UTC, e `Date.prototype.getHours()` devolveria a
// hora UTC. Resultado: uma sessão às 10:30 PT (= 09:30 UTC em Junho,
// horário de Verão) seria posicionada na faixa das 09:30 enquanto
// `formatTime` (hidratado no cliente em PT) mostrava "10:30". Esta
// função alinha a matemática de posição com o que o cliente vê.
//
// PERF (CB-4 audit jun/2026): singleton do DateTimeFormat (era
// instanciado por chamada — ~80-100 µs cada) + cache iso→minutos
// indexado pela string original. `buildRowLayout` chamava localMinutes
// 24×7×N vezes por render → ~10 000 chamadas, ~1 s de CPU server-side
// em semanas cheias. Com cache, cada iso é convertido uma única vez.
const _lisbonFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Lisbon",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const _lisbonMinCache = new Map<string, number>();

function _minsFromIso(iso: string): number {
  const cached = _lisbonMinCache.get(iso);
  if (cached !== undefined) return cached;
  const parts = _lisbonFmt.formatToParts(new Date(iso));
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = parseInt(p.value, 10);
    else if (p.type === "minute") minute = parseInt(p.value, 10);
  }
  const m = hour * 60 + minute;
  // Cap defensivo: este cache vive na vida do processo Lambda. Em SSR
  // intensivo pode crescer; podamos para não criar leak.
  if (_lisbonMinCache.size > 10_000) _lisbonMinCache.clear();
  _lisbonMinCache.set(iso, m);
  return m;
}

function localHM(d: Date): { hour: number; minute: number } {
  const m = _minsFromIso(d.toISOString());
  return { hour: Math.floor(m / 60), minute: m % 60 };
}

function localMinutes(d: Date): number {
  return _minsFromIso(d.toISOString());
}

// Posição vertical (px) de um instante (em minutos-desde-meia-noite)
// dentro da grelha de altura variável.
function yForMinutes(layout: RowLayout, totalMin: number): number {
  return _interp(layout.stopsMin, layout.stopsY, totalMin);
}

function clampPosition(
  layout: RowLayout,
  start: Date,
  end: Date,
): { top: number; height: number } | null {
  // CB-4: usa toISOString() → cache hit a partir da 2ª chamada na
  // mesma vista (mesmo objecto booking aparece em clampPosition +
  // overlapsHour + cálculo de colunas).
  const totalMin = TOTAL_HOURS * 60;
  const startMin = _minsFromIso(start.toISOString());
  let endMin = _minsFromIso(end.toISOString());
  if (endMin <= startMin) endMin = startMin + 60; // safety (cruza meia-noite)
  if (endMin <= 0 || startMin >= totalMin) return null;
  const top = yForMinutes(layout, Math.max(0, startMin));
  const bottom = yForMinutes(layout, Math.min(totalMin, endMin));
  const height = Math.max(18, bottom - top - 2);
  return { top, height };
}

// ─── Encolher sobreposições (cascata mobile) ────────────────────────
// Quando uma sessão tem outra a COMEÇAR dentro do seu intervalo, cortamos
// a 1.ª para terminar no início da 2.ª. Assim os blocos sobrepostos ficam
// em cascata (sem se taparem) e a hora+nome de TODOS fica visível, em vez
// de o bloco da frente cobrir o de trás. Aplica-se só em mobile — em
// ≥640px a regra `.booking-overlap-block` repõe a altura cheia (--h-full)
// e usa colunas lado-a-lado. `startRank` = ordem por início (mais tarde =
// z-index mais alto), para que qualquer sobra de um bloco fique POR BAIXO
// do seguinte e nunca tape o seu cabeçalho.
function overlapShrink(act: { id: string; s: number; e: number }[]) {
  const endMsById = new Map(act.map((a): [string, number] => [a.id, a.e]));
  const startRank = new Map<string, number>();
  act.forEach((a, i) => startRank.set(a.id, i));
  const clipEndMs = new Map<string, number>();
  for (const a of act) {
    let next = Infinity;
    for (const o of act) {
      if (o.s > a.s && o.s < a.e && o.s < next) next = o.s;
    }
    clipEndMs.set(a.id, next === Infinity ? a.e : next);
  }
  return { endMsById, startRank, clipEndMs };
}

function shrunkHeight(
  layout: RowLayout,
  s: Date,
  naturalHeight: number,
  clipEndMs: number | undefined,
  naturalEndMs: number | undefined,
): number {
  if (clipEndMs === undefined || naturalEndMs === undefined || clipEndMs >= naturalEndMs) {
    return naturalHeight;
  }
  const cp = clampPosition(layout, s, new Date(clipEndMs));
  return cp ? Math.min(naturalHeight, cp.height) : naturalHeight;
}

// ─── Layout das linhas-hora (altura variável) ───────────────────────
type AvailMap = Map<number, Array<[number, number]>>; // dow → [startMin,endMin][]

function parseHM(t: string): number {
  const [h, m] = t.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

function overlapsHour(startsIso: string, endsIso: string | null, hs: number, he: number): boolean {
  // CB-4: passa a iso directa (zero alocação de Date) — usa o cache.
  const s = _minsFromIso(startsIso);
  let e = endsIso ? _minsFromIso(endsIso) : s + 60;
  if (e <= s) e = s + 60;
  return s < he && e > hs;
}

function hourFullyBlocked(blocks: any[], hs: number, he: number): boolean {
  for (const blk of blocks) {
    const s = _minsFromIso(blk.starts_at);
    let e = _minsFromIso(blk.ends_at);
    if (e <= s) e = TOTAL_HOURS * 60;
    if (s <= hs && e >= he) return true;
  }
  return false;
}

// Uma hora está "cheia" (não encolhe) num dado dia se tiver uma sessão
// (booking/reserved) OU se for marcável (dentro do horário de trabalho e
// não totalmente bloqueada).
function hourIsFullOnDay(h: number, dow: number, bucket: DayBucket, avail: AvailMap): boolean {
  const hs = h * 60;
  const he = hs + 60;
  for (const b of bucket.bookings) if (overlapsHour(b.starts_at, b.ends_at, hs, he)) return true;
  for (const r of bucket.reserved) if (overlapsHour(r.starts_at, r.ends_at, hs, he)) return true;
  const windows = avail.get(dow) ?? [];
  const withinWorking = windows.some(([s, e]) => s < he && e > hs);
  if (!withinWorking) return false; // fora do horário → encolhível
  return !hourFullyBlocked(bucket.blocks, hs, he); // bloqueada toda → encolhível
}

function buildRowLayout(days: Date[], byDay: Map<string, DayBucket>, avail: AvailMap): RowLayout {
  const collapsed: boolean[] = [];
  for (let h = 0; h < 24; h++) {
    let anyFull = false;
    for (const d of days) {
      const bucket = byDay.get(dayKey(d)) ?? EMPTY_DAY;
      if (hourIsFullOnDay(h, d.getDay(), bucket, avail)) {
        anyFull = true;
        break;
      }
    }
    collapsed[h] = !anyFull;
  }
  // Para cada hora, o intervalo MAIS APERTADO entre dois arranques distintos
  // de sessões (em qualquer dia — as linhas são partilhadas pelas colunas).
  // Guardamos onde começa (winStart, min dentro da hora) e o tamanho
  // (winLen). Arranques à mesma hora exacta (gap 0) vão lado-a-lado → ignorados.
  const winStart: number[] = new Array(24).fill(0);
  const winLen: number[] = new Array(24).fill(0);
  for (let h = 0; h < 24; h++) {
    const hs = h * 60;
    const he = hs + 60;
    let bestGap = Infinity;
    let bestStart = 0;
    for (const d of days) {
      const bucket = byDay.get(dayKey(d)) ?? EMPTY_DAY;
      const starts = Array.from(
        new Set(
          bucket.bookings
            .map((b: any) => _minsFromIso(b.starts_at))
            .filter((m: number) => m >= hs && m < he),
        ),
      ).sort((a, b) => a - b);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i] - starts[i - 1];
        if (gap > 0 && gap < bestGap) {
          bestGap = gap;
          bestStart = starts[i - 1] - hs;
        }
      }
    }
    if (bestGap !== Infinity) {
      winStart[h] = bestStart;
      winLen[h] = bestGap;
    }
  }

  // Alturas por hora + mapa tempo→px por troços (stops). Só o intervalo
  // apertado é esticado para STACK_MIN_PX (se o natural já for maior, fica);
  // tudo o que arranca depois mantém o ritmo normal.
  const heights: number[] = [];
  const tops: number[] = [];
  const stopsMin: number[] = [0];
  const stopsY: number[] = [0];
  let acc = 0;
  for (let h = 0; h < 24; h++) {
    const base = collapsed[h] ? COLLAPSED_HOUR_HEIGHT : FULL_HOUR_HEIGHT;
    const hs = h * 60;
    tops[h] = acc;
    const wl = collapsed[h] ? 0 : winLen[h];
    if (wl > 0) {
      const ws = winStart[h];
      const we = ws + wl;
      const naturalWin = (wl / 60) * base;
      const winPx = Math.max(STACK_MIN_PX, naturalWin);
      const yWs = acc + (ws / 60) * base;
      if (ws > 0) {
        stopsMin.push(hs + ws);
        stopsY.push(yWs);
      }
      const yWe = yWs + winPx;
      stopsMin.push(hs + we);
      stopsY.push(yWe);
      const ht = (ws / 60) * base + winPx + ((60 - we) / 60) * base;
      heights[h] = ht;
      acc += ht;
    } else {
      heights[h] = base;
      acc += base;
    }
    stopsMin.push((h + 1) * 60);
    stopsY.push(acc);
  }
  return { heights, tops, total: acc, collapsed, stopsMin, stopsY };
}

function WeekView({
  start,
  bookings,
  blocks,
  reserved,
  notesMap,
  clientNotesMap,
  teamNotesMap,
  sessionsLeftMap,
  lastCreditIds,
  canBook,
  avail,
  focusBookingId,
  prevHref,
  nextHref,
}: {
  start: Date;
  bookings: any[];
  blocks: any[];
  reserved: any[];
  notesMap: Map<string, any>;
  clientNotesMap: Map<string, any>;
  teamNotesMap: Map<string, { authorName: string; body: string }[]>;
  sessionsLeftMap: Map<string, number>;
  lastCreditIds: Set<string>;
  canBook: boolean;
  avail: AvailMap;
  focusBookingId?: string;
  prevHref: string;
  nextHref: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = bucketByDay(bookings, blocks, reserved); // PERF (#5): 1 passagem
  const today = new Date();

  // Rótulo do mês/ano da semana visível. Se a semana atravessa dois meses
  // (ou dois anos) mostra ambos — assim o trainer nunca perde a referência.
  const monthLabel = monthRangeLabel(days[0], days[6]);

  // Layout das linhas-hora (altura variável). Horas não-marcáveis e sem
  // sessões encolhem para uma faixa fina → cabem mais horas no ecrã.
  const layout = buildRowLayout(days, byDay, avail);
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i);

  // Mesma razão que `localHM`: o servidor pode estar em UTC, queremos
  // a hora actual em Europe/Lisbon para posicionar a linha do "agora".
  const todayHM = localHM(today);
  const nowMinutes = todayHM.hour * 60 + todayHM.minute;
  const nowInRange = nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;
  const nowTop = yForMinutes(layout, nowMinutes);

  // TODOS os 7 dias cabem no ecrã (requisito do cliente): sem largura
  // mínima por coluna (minmax(0,1fr)) e sem min-width total, as 7 colunas
  // encolhem para preencher a viewport — mesmo em telemóvel (~375px →
  // ~47px/dia). Eixo de horas reduzido a 22px para dar mais espaço aos dias.
  //
  // Larguras DINÂMICAS: dias SEM sessões encolhem para ~metade (0.5fr),
  // devolvendo esse espaço aos dias COM sessões — que ficam mais largos e
  // dão folga aos nomes dos clientes (ex.: duas sessões à mesma hora). É
  // recalculado a cada render a partir de `byDay`, por isso assim que um
  // sábado/domingo (ou qualquer dia) recebe uma sessão volta logo a 1fr.
  const dayHasSessions = days.map(
    (d) => (byDay.get(dayKey(d))?.bookings.length ?? 0) > 0,
  );
  const GRID_COLS =
    "22px " +
    dayHasSessions
      .map((has) => (has ? "minmax(0, 1fr)" : "minmax(0, 0.5fr)"))
      .join(" ");

  return (
    <WeekSwipeNav prevHref={prevHref} nextHref={nextHref}>
    <div className="card overflow-hidden">
      <div className="overflow-x-hidden">
        {/* Container scrollável vertical: corta a 75 vh e os day-headers
            (sticky) ficam visíveis enquanto o trainer scrolla. Com as
            horas mortas encolhidas, um dia de trabalho cabe sem scroll. */}
        <div
          id="agenda-week-scroll"
          className="w-full overflow-y-auto"
          style={{ maxHeight: "75vh" }}
        >
          {/* Cabeçalho fixo: faixa do mês/ano + day-headers. Ambos colados
              ao topo do scroll interno para o trainer não perder a
              referência do mês ao deslocar a agenda. */}
          <div className="sticky top-0 z-30 bg-bone-50">
            <MonthPicker
              label={monthLabel}
              anchorIso={isoDate(days[3])}
              view="week"
            />
            <div
              className="grid border-b border-ink-900/10 bg-bone-50"
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
          </div>

          {/* Time grid */}
          <div
            className="grid"
            style={{ gridTemplateColumns: GRID_COLS, height: layout.total }}
          >
          {/* Hour labels column */}
          <div data-timeaxis className="relative border-r border-ink-900/10 bg-bone-50">
            {hours.map((h) => {
              const isCollapsed = layout.collapsed[h];
              return (
                <div
                  key={h}
                  className={`absolute right-1 text-[9px] font-medium tabular-nums ${
                    isCollapsed ? "text-ink-400/70" : "text-ink-500"
                  }`}
                  style={{ top: layout.tops[h] + (isCollapsed ? 1 : 4) }}
                >
                  {String(h).padStart(2, "0")}
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
                {/* Sombreado das linhas encolhidas (horas não-marcáveis) +
                    gridlines por hora. As linhas a 1/4, 1/2 e 3/4 só nas
                    horas cheias (nas encolhidas não há espaço). */}
                {hours.map((h) => {
                  const isCollapsed = layout.collapsed[h];
                  const top = layout.tops[h];
                  const ht = layout.heights[h];
                  return (
                    <div key={`row-${h}`}>
                      {isCollapsed && (
                        // Linha "comprimida" (hora sem marcações possíveis):
                        // faixa fina com uma linha tracejada ao centro, para
                        // se ler como tempo encolhido — e não como um traço
                        // cinzento solto.
                        <div
                          className="pointer-events-none absolute left-0 right-0 bg-ink-900/[0.03]"
                          style={{ top, height: ht }}
                        >
                          <div
                            className="absolute left-0 right-0 border-t border-dashed border-ink-900/15"
                            style={{ top: ht / 2 }}
                          />
                        </div>
                      )}
                      <div
                        className="pointer-events-none absolute left-0 right-0 border-t border-ink-900/10"
                        style={{ top }}
                      />
                      {!isCollapsed && (
                        <>
                          <div
                            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-ink-900/10"
                            style={{ top: top + ht / 2 }}
                          />
                          <div
                            className="pointer-events-none absolute left-0 right-0 border-t border-dotted border-ink-900/5"
                            style={{ top: top + ht / 4 }}
                          />
                          <div
                            className="pointer-events-none absolute left-0 right-0 border-t border-dotted border-ink-900/5"
                            style={{ top: top + (ht * 3) / 4 }}
                          />
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Camada de clique para nova marcação (por baixo dos eventos) */}
                {canBook && (
                  <SlotClickLayer
                    dateIso={isoDate(d)}
                    rowTops={layout.tops}
                    rowHeights={layout.heights}
                    rowStopsMin={layout.stopsMin}
                    rowStopsY={layout.stopsY}
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
                  const pos = clampPosition(layout, s, e);
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

                {/* Blocks (ocupado) — clicáveis para editar/remover. */}
                {dayBlocks.map((blk) => {
                  const pos = clampPosition(layout, new Date(blk.starts_at), new Date(blk.ends_at));
                  if (!pos) return null;
                  return (
                    <BusyBlock
                      key={`x-${blk.id}`}
                      b={blk}
                      canEdit={canBook}
                      style={{ top: pos.top, height: pos.height }}
                    />
                  );
                })}

                {/* Bookings (com destaque de sobreposição) */}
                {(() => {
                  // Sessões sobrepostas dividem a largura da coluna do dia
                  // em "colunas verticais" lado-a-lado (estilo Google
                  // Calendar) — assim ambos os nomes ficam legíveis. Para
                  // cada grupo de sobreposição transitiva, atribuímos a
                  // coluna mais baixa livre (greedy + reuso quando uma
                  // sessão termina antes de a próxima começar).
                  const act = dayBookings
                    // Inclui no_show: uma falta tambem ocupa o slot, por isso
                    // tem de entrar no calculo de sobreposicao (colunas/z-index)
                    // — senao uma sessao nova largada por cima tapava a falta em
                    // vez de a mostrar lado-a-lado/atras.
                    .filter((x: any) => x.status === "booked" || x.status === "confirmed" || x.status === "no_show")
                    .map((x: any) => ({
                      id: x.id,
                      s: new Date(x.starts_at).getTime(),
                      e: x.ends_at
                        ? new Date(x.ends_at).getTime()
                        : new Date(x.starts_at).getTime() + 3_600_000,
                    }))
                    .sort((a: { s: number }, b: { s: number }) => a.s - b.s);
                  // Sessões que começam EXACTAMENTE à mesma hora que outra
                  // (mesmo start ms) — precisam de colunas lado-a-lado mesmo
                  // em mobile, senão a de trás fica 100% tapada.
                  const startCounts = new Map<number, number>();
                  for (const it of act)
                    startCounts.set(it.s, (startCounts.get(it.s) ?? 0) + 1);
                  const colOf = new Map<string, number>();
                  const groupOf = new Map<string, number>();
                  const groupCols = new Map<number, number>();
                  let nextGroup = 0;
                  let curGroup = -1;
                  const live: { id: string; e: number; col: number }[] = [];
                  for (const it of act) {
                    for (let i = live.length - 1; i >= 0; i--) {
                      if (live[i].e <= it.s) live.splice(i, 1);
                    }
                    if (live.length === 0) curGroup = nextGroup++;
                    const used = new Set(live.map((l) => l.col));
                    let col = 0;
                    while (used.has(col)) col++;
                    colOf.set(it.id, col);
                    groupOf.set(it.id, curGroup);
                    groupCols.set(
                      curGroup,
                      Math.max(groupCols.get(curGroup) ?? 1, col + 1),
                    );
                    live.push({ id: it.id, e: it.e, col });
                  }
                  const { endMsById, startRank, clipEndMs } = overlapShrink(act);

                  return dayBookings.map((b) => {
                    const s = new Date(b.starts_at);
                    const e = b.ends_at
                      ? new Date(b.ends_at)
                      : new Date(s.getTime() + 60 * 60 * 1000);
                    const pos = clampPosition(layout, s, e);
                    if (!pos) return null;
                    // Drag liberado para passado/presente/futuro (pedido
                    // do trainer): basta a sessão estar activa.
                    const canDrag =
                      canBook && (b.status === "booked" || b.status === "confirmed");
                    const g = groupOf.get(b.id);
                    const cols = g !== undefined ? groupCols.get(g) ?? 1 : 1;
                    const col = colOf.get(b.id) ?? 0;
                    const isOverlap = cols > 1;
                    const sameStart =
                      (startCounts.get(new Date(b.starts_at).getTime()) ?? 0) > 1;
                    // Mobile: cascata por encolhimento (altura até ao início
                    // da sessão seguinte). Desktop (≥640px): colunas lado-a-
                    // lado + altura cheia, repostas por CSS via --h-full.
                    const mobileH = isOverlap
                      ? shrunkHeight(layout, s, pos.height, clipEndMs.get(b.id), endMsById.get(b.id))
                      : pos.height;
                    const overlapStyle: React.CSSProperties = isOverlap
                      ? ({
                          "--ov-col": col,
                          "--ov-cols": cols,
                          "--h-full": `${pos.height}px`,
                          // Faltas (no_show) ficam atrás das sessões activas
                          // (base 10 vs 20). startRank (ordem por início, mais
                          // tarde = mais alto) garante que a sobra encolhida
                          // de um bloco fica por baixo do seguinte.
                          zIndex: (b.status === "no_show" ? 10 : 20) + (startRank.get(b.id) ?? 0),
                        } as any)
                      : {};
                    return (
                      <BookingBlock
                        key={`b-${b.id}`}
                        b={b}
                        note={notesMap.get(b.id)}
                        clientNote={clientNotesMap.get(b.id)}
                        teamNotes={teamNotesMap.get(b.id)}
                        style={{ top: pos.top, height: mobileH, ...overlapStyle }}
                        draggable={canDrag}
                        rowTops={layout.tops}
                        rowHeights={layout.heights}
                        rowStopsMin={layout.stopsMin}
                        rowStopsY={layout.stopsY}
                        snapMin={15}
                        sessionsLeft={sessionsLeftMap.get(b.client_id)}
                        isLastCredit={lastCreditIds.has(b.id)}
                        overlap={isOverlap}
                        overlapCol={col}
                        sameStart={sameStart}
                        autoOpen={focusBookingId === b.id}
                      />
                    );
                  });
                })()}
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
    {/* Posiciona o scroll interno na 1ª hora útil ao montar a vista. */}
    <AgendaScrollTo7am top={layout.tops[7]} />
    </WeekSwipeNav>
  );
}


function MonthView({ gridStart, anchor, bookings, blocks, reserved, lastCreditIds }: { gridStart: Date; anchor: Date; bookings: any[]; blocks: any[]; reserved: any[]; lastCreditIds: Set<string> }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const byDay = bucketByDay(bookings, blocks, reserved); // PERF (#5): 1 passagem
  const currentMonth = anchor.getMonth();
  return (
    <div className="card overflow-hidden p-2">
      <div className="mb-2 text-center font-display text-sm font-semibold capitalize text-ink-700">
        {monthRangeLabel(anchor, anchor)}
      </div>
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
                    className={`truncate whitespace-nowrap rounded bg-gold-50 px-0.5 py-0.5 text-[9px] leading-tight text-ink-900 tabular-nums sm:px-1 sm:text-[10px] ${
                      lastCreditIds.has(b.id) ? "ring-1 ring-inset ring-red-500" : ""
                    }`}
                  >
                    {lastCreditIds.has(b.id) && (
                      <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />
                    )}
                    <span>{formatTime(b.starts_at)}</span>
                    <span className="hidden sm:inline">
                      {" "}
                      {b.partner_profiles?.full_name ? (
                        <>
                          <strong>Duo</strong>
                          {" "}
                          {shortName(b.profiles?.full_name)}
                          {" "}
                          {shortName(b.partner_profiles.full_name)}
                        </>
                      ) : (
                        shortName(b.profiles?.full_name)
                      )}
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

// ─── helpers ──────────────────────────────────────────────────────────

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

// PERF (QW-10, audit jun/2026): singleton — antes era instanciado por
// chamada, e este helper é chamado dentro do loop que expande blocos
// recorrentes (até 42 dias × M blocos por render na vista mensal).
const _lisbonOffsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Lisbon",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
function tzOffsetMinutesLisbon(date: Date): number {
  const p: Record<string, string> = {};
  for (const part of _lisbonOffsetFmt.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}
function lisbonWallToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = Date.UTC(y, mo, d, h, mi, 0);
  const off = tzOffsetMinutesLisbon(new Date(guess));
  return new Date(guess - off * 60000);
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

// Helpers de formatação consumidos por DayView/WeekView.
const WEEKDAYS_PT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
function weekday(d: Date) {
  return WEEKDAYS_PT[d.getDay()];
}
function fmt(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Rótulo "mês ano" (ou "mês – mês ano" quando o intervalo atravessa dois
// meses, p.ex. uma semana entre Junho e Julho). Em pt-PT.
const MONTH_FMT = new Intl.DateTimeFormat("pt-PT", { month: "long" });
function monthRangeLabel(from: Date, to: Date) {
  const m1 = MONTH_FMT.format(from);
  const y1 = from.getFullYear();
  const m2 = MONTH_FMT.format(to);
  const y2 = to.getFullYear();
  if (m1 === m2 && y1 === y2) return `${m1} ${y1}`;
  if (y1 === y2) return `${m1} – ${m2} ${y2}`;
  return `${m1} ${y1} – ${m2} ${y2}`;
}
// Primeiro nome do cliente, truncado a 7 chars para caber dentro do
// bloco da sessão (especialmente na vista de mês, com células muito
// estreitas).
function shortName(full?: string | null) {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 7);
}
