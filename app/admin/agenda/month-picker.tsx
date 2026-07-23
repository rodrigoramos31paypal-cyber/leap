"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

// Nome do mês + ano em pt-PT (ex.: "julho de 2026").
const MONTH_FMT = new Intl.DateTimeFormat("pt-PT", {
  month: "long",
  year: "numeric",
});

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Barra do mês/ano no topo da agenda, agora clicável: abre um dropdown de
// meses e salta directamente para o 1º dia (1ª semana) do mês escolhido —
// evita andar a fazer swipe semana a semana entre meses distantes.
export function MonthPicker({
  label,
  anchorIso,
  view = "week",
  prevHref,
  nextHref,
}: {
  label: string;
  anchorIso: string; // dia de referência da vista actual (YYYY-MM-DD)
  view?: string;
  // Setas ‹ › ao lado do mês (recuar/avançar período), quando fornecidas.
  prevHref?: string;
  nextHref?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const anchor = new Date(anchorIso + "T00:00:00");
  const anchorMonth = anchor.getFullYear() * 12 + anchor.getMonth();

  // Janela de meses: 3 atrás → 14 à frente (rolável). Cobre saltos de vários
  // meses para a frente e permite recuar alguns.
  const months: Date[] = [];
  for (let i = -3; i <= 14; i++) {
    months.push(new Date(anchor.getFullYear(), anchor.getMonth() + i, 1));
  }

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!wrapRef.current) return;
      if (e.target instanceof Node && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  function pick(first: Date) {
    setOpen(false);
    router.push(`/admin/agenda?view=${view}&d=${isoDate(first)}`);
  }

  return (
    <div ref={wrapRef} className="relative border-b border-ink-900/10">
      <div className="flex items-center">
        {prevHref && (
          <Link
            href={prevHref}
            aria-label="Período anterior"
            className="shrink-0 px-2 py-1 text-ink-500 hover:bg-ink-900/5 hover:text-ink-900 dark:hover:bg-white/5 dark:hover:text-bone-50"
          >
            <ChevronLeft size={16} />
          </Link>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex flex-1 items-center justify-center gap-1 px-2 py-1 font-display text-sm font-semibold capitalize text-ink-700 hover:bg-ink-900/5"
        >
          {label}
          <ChevronDown
            size={14}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {nextHref && (
          <Link
            href={nextHref}
            aria-label="Período seguinte"
            className="shrink-0 px-2 py-1 text-ink-500 hover:bg-ink-900/5 hover:text-ink-900 dark:hover:bg-white/5 dark:hover:text-bone-50"
          >
            <ChevronRight size={16} />
          </Link>
        )}
      </div>

      {open && (
        <div
          role="listbox"
          className="absolute left-1/2 top-full z-40 mt-1 max-h-72 w-52 -translate-x-1/2 overflow-y-auto rounded-lg border border-ink-900/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-ink-800"
        >
          {months.map((m) => {
            const key = m.getFullYear() * 12 + m.getMonth();
            const isCurrent = key === anchorMonth;
            return (
              <button
                key={key}
                type="button"
                onClick={() => pick(m)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  isCurrent
                    ? "bg-gold-100 font-semibold text-gold-800 dark:bg-gold-400/15 dark:text-gold-300"
                    : "hover:bg-ink-900/5 dark:hover:bg-white/5"
                }`}
              >
                {cap(MONTH_FMT.format(m))}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
