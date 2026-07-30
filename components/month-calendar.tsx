"use client";

// ════════════════════════════════════════════════════════════════
// Calendário mensal (selector de dia). Semana começa à 2.ª feira.
// Dias no passado / fora da janela ficam desactivados.
//
// Marcações visuais (todas opcionais, desligadas por defeito):
//   • markToday      → o dia de HOJE fica a preto cheio (dinâmico, mesmo
//                      que outro dia esteja selecionado). Quando desligado,
//                      o preto marca o dia SELECIONADO (comportamento antigo).
//   • bookedDays     → lista de dias (YYYY-MM-DD) em que o cliente já tem
//                      sessão → pintados a azul-claro, para se orientar.
//   • availableDays  → quando fornecido, só estes dias (YYYY-MM-DD) ficam
//                      seleccionáveis; os restantes ficam cinzentos. (A
//                      grelha mostra o mês inteiro, ao contrário da lista.)
// ════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function MonthCalendar({
  selected,
  onSelect,
  minDate,
  maxDate,
  markToday = false,
  bookedDays,
  availableDays,
}: {
  selected: Date;
  onSelect: (d: Date) => void;
  minDate: Date;
  maxDate: Date;
  /** Marca o dia de HOJE a preto (dinâmico). Quando false, o preto marca o
   *  dia selecionado (comportamento original). */
  markToday?: boolean;
  /** Dias (YYYY-MM-DD) em que o cliente já tem sessão → azul-claro. */
  bookedDays?: string[];
  /** Se fornecido, só estes dias (YYYY-MM-DD) ficam seleccionáveis. */
  availableDays?: Set<string> | null;
}) {
  const [cursor, setCursor] = useState<Date>(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );

  // Segue o mês do dia selecionado quando este muda por fora (ex.: o fluxo
  // salta para o 1.º dia disponível ao carregar). Navegar manualmente pelos
  // chevrons NÃO altera `selected`, por isso não é revertido pelo utilizador.
  useEffect(() => {
    setCursor((prev) =>
      prev.getFullYear() === selected.getFullYear() &&
      prev.getMonth() === selected.getMonth()
        ? prev
        : new Date(selected.getFullYear(), selected.getMonth(), 1),
    );
  }, [selected]);

  const bookedSet = useMemo(() => new Set(bookedDays ?? []), [bookedDays]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const offset = (firstOfMonth.getDay() + 6) % 7; // 2.ª feira = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const today = startOfDay(new Date());
  const minMs = startOfDay(minDate).getTime();
  const maxMs = startOfDay(maxDate).getTime();
  const minMonthMs = new Date(minDate.getFullYear(), minDate.getMonth(), 1).getTime();
  const maxMonthMs = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1).getTime();
  const cursorMs = new Date(year, month, 1).getTime();
  const canPrev = cursorMs > minMonthMs;
  const canNext = cursorMs < maxMonthMs;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-display text-base font-bold">
          {MONTHS[month]} {year}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Mês anterior"
            disabled={!canPrev}
            onClick={() => setCursor(new Date(year, month - 1, 1))}
            className="grid h-8 w-8 place-items-center rounded-full border border-ink-900/10 text-ink-600 transition hover:bg-ink-900/5 disabled:opacity-30 dark:border-white/15 dark:text-bone-100"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="Mês seguinte"
            disabled={!canNext}
            onClick={() => setCursor(new Date(year, month + 1, 1))}
            className="grid h-8 w-8 place-items-center rounded-full border border-ink-900/10 text-ink-600 transition hover:bg-ink-900/5 disabled:opacity-30 dark:border-white/15 dark:text-bone-100"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink-500">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const ms = startOfDay(d).getTime();
          const outOfRange = ms < minMs || ms > maxMs;
          const notAvailable = availableDays ? !availableDays.has(ymd(d)) : false;
          const disabled = outOfRange || notAvailable;
          const active = sameDay(d, selected);
          const isToday = markToday && sameDay(d, today);
          const isBooked = bookedSet.has(ymd(d));

          // Prioridade de cor:
          //   hoje (preto, + anel azul se também tiver sessão)
          //   > selecionado (anel dourado no modo markToday; preto no modo antigo)
          //   > com sessão (azul) > indisponível (cinza) > normal.
          let cls: string;
          if (isToday) {
            cls = cn(
              "bg-ink-900 font-bold text-bone-50 dark:bg-bone-50 dark:text-ink-900",
              isBooked && "ring-2 ring-[#5DA0E0] ring-offset-1 ring-offset-white dark:ring-offset-ink-800",
            );
          } else if (active && markToday) {
            cls = "border-2 border-gold-400 bg-gold-50 font-semibold text-ink-900 dark:bg-gold-400/10 dark:text-gold-100";
          } else if (active && !markToday) {
            cls = "bg-ink-900 font-bold text-bone-50 dark:bg-bone-50 dark:text-ink-900";
          } else if (isBooked) {
            cls = "border border-[#85B7EB] bg-[#E6F1FB] font-semibold text-[#0C447C] dark:border-[#2f628f] dark:bg-[#12314e] dark:text-[#cbe0fb]";
          } else if (disabled) {
            cls = "cursor-default text-ink-300 dark:text-bone-100/25";
          } else {
            cls = "border border-ink-900/10 text-ink-800 hover:border-gold-400 hover:bg-gold-50 dark:border-white/15 dark:text-bone-100";
          }

          return (
            <button
              key={d.toISOString()}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(d)}
              className={cn(
                "mx-auto grid h-9 w-9 place-items-center rounded-full text-sm tabular-nums transition",
                cls,
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
