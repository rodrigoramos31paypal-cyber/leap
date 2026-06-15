"use client";

// ════════════════════════════════════════════════════════════════
// WeekGrid · vista de semana com layout em "bandas" por hora.
//
// Cada hora é uma faixa cuja altura depende do nº MÁXIMO de sessões
// que começam nessa hora em qualquer um dos 7 dias da semana. Horas
// sem sessões encolhem para uma faixa minimalista (só com o label).
//
// Drag-twist: durante um arrasto a grelha muda temporariamente para
// modo "proporcional" (cada hora = 56 px) para permitir snap por
// minuto (precisão de 15 min). Quando o arrasto termina, volta às
// bandas. A troca é animada via CSS transition.
// ════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { BookingBlock } from "./booking-popover";
import { SlotClickLayer } from "./slot-click-layer";

const HOUR_START = 7;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START; // 15

// Modo proporcional (durante drag): cada hora tem 56 px → 15 × 56 = 840.
const HOUR_HEIGHT = 56;

// Modo bandas (idle):
//   • Cada sessão ocupa BAND_ITEM_HEIGHT (28 px) na sua banda de hora.
//   • Hora vazia colapsa para BAND_EMPTY_HEIGHT (18 px) — só mostra o label.
//   • BAND_PAD acrescenta um pouco de respiração na vertical entre faixas.
const BAND_ITEM_HEIGHT = 28;
const BAND_EMPTY_HEIGHT = 18;
const BAND_PAD = 4;

type Mode = "band" | "proportional";

const WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function isoDateOf(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

type DayBucket = { bookings: any[]; blocks: any[]; reserved: any[] };
const EMPTY_DAY: DayBucket = { bookings: [], blocks: [], reserved: [] };

export function WeekGrid({
  daysIso,
  bookings,
  blocks,
  reserved,
  notesEntries,
  canBook,
}: {
  daysIso: string[];
  bookings: any[];
  blocks: any[];
  reserved: any[];
  notesEntries: Array<[string, { body: string }]>;
  canBook: boolean;
}) {
  const [mode, setMode] = useState<Mode>("band");

  // Ouve eventos globais emitidos pelo BookingBlock quando o utilizador
  // começa/termina um arrasto. Não usamos refs nem context — só o window.
  useEffect(() => {
    function onStart() {
      setMode("proportional");
    }
    function onEnd() {
      setMode("band");
    }
    window.addEventListener("agenda:dragstart", onStart as EventListener);
    window.addEventListener("agenda:dragend", onEnd as EventListener);
    return () => {
      window.removeEventListener("agenda:dragstart", onStart as EventListener);
      window.removeEventListener("agenda:dragend", onEnd as EventListener);
    };
  }, []);

  const days = useMemo(
    () => daysIso.map((s) => new Date(s + "T00:00:00")),
    [daysIso],
  );
  const notesMap = useMemo(() => new Map(notesEntries), [notesEntries]);

  // ── Bucket de eventos por dia (1 passagem O(n)). ─────────────────
  const byDay = useMemo(() => {
    const m = new Map<string, DayBucket>();
    const cell = (k: string) => {
      let e = m.get(k);
      if (!e) {
        e = { bookings: [], blocks: [], reserved: [] };
        m.set(k, e);
      }
      return e;
    };
    for (const b of bookings) cell(dayKey(new Date(b.starts_at))).bookings.push(b);
    for (const b of blocks) cell(dayKey(new Date(b.starts_at))).blocks.push(b);
    for (const r of reserved) cell(dayKey(new Date(r.starts_at))).reserved.push(r);
    return m;
  }, [bookings, blocks, reserved]);

  // ── Layout das bandas: contagem máxima de starts por hora ────────
  // counts[h] = max(d ∈ dias) de #sessões com starts_at.hour === HOUR_START+h
  const bandLayout = useMemo(() => {
    const counts = new Array(TOTAL_HOURS).fill(0);
    const perDayHour = new Map<string, number[]>();
    for (const b of bookings) {
      const d = new Date(b.starts_at);
      const h = d.getHours() - HOUR_START;
      if (h < 0 || h >= TOTAL_HOURS) continue;
      const k = dayKey(d);
      let arr = perDayHour.get(k);
      if (!arr) {
        arr = new Array(TOTAL_HOURS).fill(0);
        perDayHour.set(k, arr);
      }
      arr[h]++;
    }
    for (const arr of perDayHour.values()) {
      for (let h = 0; h < TOTAL_HOURS; h++) {
        if (arr[h] > counts[h]) counts[h] = arr[h];
      }
    }
    const heights = counts.map((c) =>
      c > 0 ? c * BAND_ITEM_HEIGHT + BAND_PAD : BAND_EMPTY_HEIGHT,
    );
    const tops = new Array(TOTAL_HOURS).fill(0);
    for (let i = 1; i < TOTAL_HOURS; i++) tops[i] = tops[i - 1] + heights[i - 1];
    const total = tops[TOTAL_HOURS - 1] + heights[TOTAL_HOURS - 1];
    return { counts, heights, tops, total };
  }, [bookings]);

  const totalHeight =
    mode === "band" ? bandLayout.total : TOTAL_HOURS * HOUR_HEIGHT;

  // ── Cálculo de posição de uma sessão ─────────────────────────────
  function getBookingPos(b: any, dayBookings: any[]) {
    const s = new Date(b.starts_at);
    const e = b.ends_at
      ? new Date(b.ends_at)
      : new Date(s.getTime() + 60 * 60 * 1000);

    if (mode === "proportional") {
      const totalMin = TOTAL_HOURS * 60;
      const rawStart = (s.getHours() - HOUR_START) * 60 + s.getMinutes();
      const rawEnd = (e.getHours() - HOUR_START) * 60 + e.getMinutes();
      if (rawEnd <= 0 || rawStart >= totalMin) return null;
      const startMin = Math.max(0, rawStart);
      const endMin = Math.min(totalMin, rawEnd);
      const top = (startMin / 60) * HOUR_HEIGHT;
      const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2);
      return { top, height };
    }

    // band mode
    const h = s.getHours() - HOUR_START;
    if (h < 0 || h >= TOTAL_HOURS) return null;
    // index dentro da hora (cronológico) — sessões da mesma hora empilham.
    const sameHour = dayBookings
      .filter((x) => {
        const xs = new Date(x.starts_at);
        return xs.getHours() === s.getHours();
      })
      .sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
    const idx = Math.max(
      0,
      sameHour.findIndex((x) => x.id === b.id),
    );
    const top = bandLayout.tops[h] + 2 + idx * BAND_ITEM_HEIGHT;
    return { top, height: BAND_ITEM_HEIGHT - 4 };
  }

  // ── Cálculo de posição para blocos/reservados (intervalos) ───────
  function getRangePos(start: Date, end: Date) {
    if (mode === "proportional") {
      const totalMin = TOTAL_HOURS * 60;
      const rawStart = (start.getHours() - HOUR_START) * 60 + start.getMinutes();
      const rawEnd = (end.getHours() - HOUR_START) * 60 + end.getMinutes();
      if (rawEnd <= 0 || rawStart >= totalMin) return null;
      const startMin = Math.max(0, rawStart);
      const endMin = Math.min(totalMin, rawEnd);
      const top = (startMin / 60) * HOUR_HEIGHT;
      const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2);
      return { top, height };
    }
    // band mode: ocupa da banda da hora de início até à banda da hora de fim
    let startH = start.getHours() - HOUR_START;
    // se acabar exactamente em :00, ainda pertence à hora anterior
    const endHourRaw =
      end.getMinutes() === 0 ? end.getHours() - 1 : end.getHours();
    let endH = endHourRaw - HOUR_START;
    if (endH < 0) return null;
    if (startH >= TOTAL_HOURS) return null;
    startH = Math.max(0, Math.min(TOTAL_HOURS - 1, startH));
    endH = Math.max(0, Math.min(TOTAL_HOURS - 1, endH));
    if (endH < startH) return null;
    const top = bandLayout.tops[startH];
    const height =
      bandLayout.tops[endH] + bandLayout.heights[endH] - top - 2;
    return { top, height: Math.max(BAND_EMPTY_HEIGHT - 2, height) };
  }

  // ── Now indicator ────────────────────────────────────────────────
  const today = new Date();
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nowInRange =
    nowMinutes >= HOUR_START * 60 && nowMinutes <= HOUR_END * 60;
  const nowTop = (() => {
    if (mode === "proportional") {
      return ((nowMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT;
    }
    const h = Math.min(
      TOTAL_HOURS - 1,
      Math.max(0, today.getHours() - HOUR_START),
    );
    const frac = today.getMinutes() / 60;
    return bandLayout.tops[h] + bandLayout.heights[h] * frac;
  })();

  const GRID_COLS = "34px repeat(7, minmax(0, 1fr))";

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-hidden">
        <div className="w-full">
          {/* Day headers */}
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
                    {WEEKDAYS_PT[d.getDay()]}
                  </div>
                  <div
                    className={`font-display text-xl font-bold ${
                      isToday ? "text-gold-600" : ""
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div
            className="grid transition-[height] duration-200 ease-out"
            style={{
              gridTemplateColumns: GRID_COLS,
              height: totalHeight,
            }}
          >
            {/* Hour labels column */}
            <div
              data-timeaxis
              className="relative border-r border-ink-900/10 bg-bone-50"
            >
              {Array.from({ length: TOTAL_HOURS }, (_, i) => {
                const top =
                  mode === "band"
                    ? bandLayout.tops[i] + 2
                    : i * HOUR_HEIGHT + 4;
                return (
                  <div
                    key={i}
                    className="absolute right-1 text-[9px] font-medium text-ink-500 tabular-nums transition-[top] duration-200 ease-out"
                    style={{ top }}
                  >
                    {`${String(HOUR_START + i).padStart(2, "0")}:00`}
                  </div>
                );
              })}
            </div>

            {/* Day columns */}
            {days.map((d) => {
              const dayIso = isoDateOf(d);
              const {
                bookings: dayBookings,
                blocks: dayBlocks,
                reserved: dayReserved,
              } = byDay.get(dayKey(d)) ?? EMPTY_DAY;
              const isToday = sameDay(d, today);

              return (
                <div
                  key={d.toISOString()}
                  data-daycol={dayIso}
                  className="relative border-r border-ink-900/10 last:border-r-0"
                >
                  {/* Hour grid lines */}
                  {Array.from({ length: TOTAL_HOURS }, (_, i) => {
                    const top =
                      mode === "band"
                        ? bandLayout.tops[i]
                        : i * HOUR_HEIGHT;
                    return (
                      <div
                        key={i}
                        className="absolute left-0 right-0 border-t border-ink-900/10 transition-[top] duration-200 ease-out"
                        style={{ top }}
                      />
                    );
                  })}
                  {/* Half-hour lighter lines — só em modo proporcional */}
                  {mode === "proportional" &&
                    Array.from({ length: TOTAL_HOURS }, (_, i) => (
                      <div
                        key={`half-${i}`}
                        className="absolute left-0 right-0 border-t border-dashed border-ink-900/5"
                        style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                      />
                    ))}

                  {/* Camada de clique para nova marcação */}
                  {canBook && (
                    <SlotClickLayer
                      dateIso={dayIso}
                      hourStart={HOUR_START}
                      hourEnd={HOUR_END}
                      hourHeight={HOUR_HEIGHT}
                      mode={mode}
                      bandTops={bandLayout.tops}
                      bandHeights={bandLayout.heights}
                    />
                  )}

                  {/* Now indicator */}
                  {isToday && nowInRange && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-20 flex items-center transition-[top] duration-200 ease-out"
                      style={{ top: nowTop }}
                    >
                      <div className="-ml-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                      <div className="h-px flex-1 bg-red-500" />
                    </div>
                  )}

                  {/* Reserved slots */}
                  {dayReserved.map((r: any) => {
                    const s = new Date(r.starts_at);
                    const e = r.ends_at
                      ? new Date(r.ends_at)
                      : new Date(s.getTime() + 60 * 60 * 1000);
                    const pos = getRangePos(s, e);
                    if (!pos) return null;
                    return (
                      <div
                        key={`r-${r.series_id}`}
                        className="absolute left-0.5 right-0.5 overflow-hidden rounded border border-dashed border-ink-900/30 bg-bone-100/80 p-1 text-[10px] text-ink-700 transition-[top,height] duration-200 ease-out"
                        style={{ top: pos.top, height: pos.height }}
                        title={`Reservado para ${r.client_name ?? "cliente"}`}
                      >
                        <div className="truncate font-semibold uppercase tracking-wide">
                          Reservado
                        </div>
                        <div className="truncate">
                          {shortClientName(r.client_name)}
                        </div>
                      </div>
                    );
                  })}

                  {/* Blocks (indisponível) */}
                  {dayBlocks.map((blk: any) => {
                    const s = new Date(blk.starts_at);
                    const e = new Date(blk.ends_at);
                    const pos = getRangePos(s, e);
                    if (!pos) return null;
                    return (
                      <div
                        key={`x-${blk.id}`}
                        className="absolute left-0.5 right-0.5 overflow-hidden rounded border border-red-200 bg-red-50 p-1 text-[10px] text-red-800 transition-[top,height] duration-200 ease-out"
                        style={{ top: pos.top, height: pos.height }}
                        title={blk.reason ?? "Indisponível"}
                      >
                        <div className="truncate font-semibold">
                          Indisponível
                        </div>
                        {blk.reason && (
                          <div className="truncate text-red-700/80">
                            {blk.reason}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Bookings */}
                  {dayBookings.map((b: any) => {
                    const pos = getBookingPos(b, dayBookings);
                    if (!pos) return null;
                    const s = new Date(b.starts_at);
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
                        animate
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
  );
}

// Helper local — duplicado em booking-popover para evitar import cíclico.
function shortClientName(full?: string | null) {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 7);
}
