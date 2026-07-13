"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  addAvailabilityAction,
  updateAvailabilityAction,
  deleteAvailabilityAction,
  type AvailResult,
} from "@/app/admin/definicoes/actions";

// Dispara um toast IMEDIATAMENTE (Toaster montado no layout admin/app).
function clientToast(title: string, kind: "success" | "error" | "info" = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("leap:toast", { detail: { title, kind } }));
}

// Ordem PT: Segunda → Domingo (day_of_week: 0 = Dom … 6 = Sáb).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS: Record<number, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};

// 06:00 → 23:45 em passos de 15 min.
const TIME_OPTIONS = Array.from({ length: 72 }, (_, k) => {
  const total = 6 * 60 + k * 15;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});
const START_OPTIONS = TIME_OPTIONS.slice(0, -1);
const END_OPTIONS = TIME_OPTIONS.slice(1);

type Interval = {
  key: string; // chave estável no cliente (sobrevive a ids temporários)
  id: string | null; // id no servidor (null enquanto está a ser criado)
  day: number;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  busy: boolean; // mutação em curso → desativa controlos
};

type InitialRow = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;
const hhmm = (t: string) => t.slice(0, 5);

export function WeeklyScheduleEditor({
  trainerId,
  initial,
}: {
  trainerId: string;
  initial: InitialRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [intervals, setIntervals] = useState<Interval[]>(() =>
    initial.map((r) => ({
      key: nextKey(),
      id: r.id,
      day: r.day_of_week,
      start: hhmm(r.start_time),
      end: hhmm(r.end_time),
      busy: false,
    })),
  );

  const patch = (key: string, fields: Partial<Interval>) =>
    setIntervals((prev) => prev.map((i) => (i.key === key ? { ...i, ...fields } : i)));

  function siblingsOverlap(day: number, start: string, end: string, exceptKey?: string) {
    return intervals.some(
      (i) => i.day === day && i.key !== exceptKey && start < i.end && end > i.start,
    );
  }

  // ── Editar início/fim de um intervalo existente ────────────────────
  function onChangeTime(iv: Interval, field: "start" | "end", value: string) {
    const start = field === "start" ? value : iv.start;
    const end = field === "end" ? value : iv.end;

    if (start >= end) {
      clientToast("A hora de início tem de ser anterior à hora de fim", "error");
      return;
    }
    if (siblingsOverlap(iv.day, start, end, iv.key)) {
      clientToast("Este intervalo sobrepõe-se a outro nesse dia.", "error");
      return;
    }

    const prevStart = iv.start;
    const prevEnd = iv.end;
    // Otimista: a UI muda já.
    patch(iv.key, { start, end, busy: true });

    if (!iv.id) {
      // Ainda a ser criado — o estado otimista chega; o save final usa estes valores.
      patch(iv.key, { busy: false });
      return;
    }

    const fd = new FormData();
    fd.set("id", iv.id);
    fd.set("start_time", start);
    fd.set("end_time", end);
    startTransition(async () => {
      const res: AvailResult = await updateAvailabilityAction(fd);
      if (!res.ok) {
        patch(iv.key, { start: prevStart, end: prevEnd, busy: false });
        clientToast(res.error, "error");
        return;
      }
      patch(iv.key, { busy: false });
      clientToast(`${DAY_LABELS[iv.day]} actualizado`);
      router.refresh();
    });
  }

  // ── Adicionar um intervalo a um dia ────────────────────────────────
  function onAdd(day: number) {
    // Default sensato: 07:00–21:00 se o dia estiver vazio; caso contrário,
    // o primeiro espaço livre de 1h depois do último intervalo.
    const dayIntervals = intervals
      .filter((i) => i.day === day)
      .sort((a, b) => a.start.localeCompare(b.start));

    let start = "07:00";
    let end = "21:00";
    if (dayIntervals.length > 0) {
      const last = dayIntervals[dayIntervals.length - 1];
      const idx = START_OPTIONS.indexOf(last.end);
      if (idx >= 0 && idx + 4 < START_OPTIONS.length) {
        start = START_OPTIONS[idx];
        end = START_OPTIONS[idx + 4] ?? "23:45"; // +1h
      } else {
        clientToast("Já não há espaço livre nesse dia.", "error");
        return;
      }
      if (siblingsOverlap(day, start, end)) {
        clientToast("Já não há espaço livre nesse dia.", "error");
        return;
      }
    }

    const key = nextKey();
    setIntervals((prev) => [...prev, { key, id: null, day, start, end, busy: true }]);

    const fd = new FormData();
    fd.set("trainerId", trainerId);
    fd.set("day_of_week", String(day));
    fd.set("start_time", start);
    fd.set("end_time", end);
    startTransition(async () => {
      const res: AvailResult = await addAvailabilityAction(fd);
      if (!res.ok || !res.id) {
        setIntervals((prev) => prev.filter((i) => i.key !== key));
        clientToast(res.ok ? "Não foi possível adicionar" : res.error, "error");
        return;
      }
      patch(key, { id: res.id, busy: false });
      clientToast(`Intervalo adicionado a ${DAY_LABELS[day]}`);
      router.refresh();
    });
  }

  // ── Remover um intervalo ───────────────────────────────────────────
  function onRemove(iv: Interval) {
    const snapshot = iv;
    setIntervals((prev) => prev.filter((i) => i.key !== iv.key));

    if (!iv.id) return; // nunca chegou ao servidor

    const fd = new FormData();
    fd.set("id", iv.id);
    startTransition(async () => {
      const res: AvailResult = await deleteAvailabilityAction(fd);
      if (!res.ok) {
        setIntervals((prev) => [...prev, snapshot]);
        clientToast(res.error, "error");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-3 divide-y divide-ink-900/5">
      {DAY_ORDER.map((day) => {
        const dayIntervals = intervals
          .filter((i) => i.day === day)
          .sort((a, b) => a.start.localeCompare(b.start));
        return (
          <div
            key={day}
            className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="w-24 shrink-0 pt-1.5 text-sm font-medium">{DAY_LABELS[day]}</div>

            <div className="flex flex-1 flex-col gap-2">
              {dayIntervals.length === 0 && (
                <span className="pt-1.5 text-sm text-ink-500">Fechado</span>
              )}

              {dayIntervals.map((iv) => (
                <div key={iv.key} className="flex items-center gap-2">
                  <select
                    value={iv.start}
                    disabled={iv.busy}
                    onChange={(e) => onChangeTime(iv, "start", e.target.value)}
                    className="input tabular-nums w-[5.5rem] disabled:opacity-50"
                    aria-label={`Início ${DAY_LABELS[iv.day]}`}
                  >
                    {START_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <span className="text-ink-500">–</span>
                  <select
                    value={iv.end}
                    disabled={iv.busy}
                    onChange={(e) => onChangeTime(iv, "end", e.target.value)}
                    className="input tabular-nums w-[5.5rem] disabled:opacity-50"
                    aria-label={`Fim ${DAY_LABELS[iv.day]}`}
                  >
                    {END_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemove(iv)}
                    disabled={iv.busy}
                    aria-label="Remover intervalo"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-red-700 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="shrink-0 pt-0.5">
              <button
                type="button"
                onClick={() => onAdd(day)}
                className="inline-flex items-center gap-1 text-xs font-medium text-gold-600 hover:underline"
              >
                <Plus size={12} /> Adicionar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
