"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import {
  updateAvailabilityAction,
  deleteAvailabilityAction,
} from "@/app/admin/definicoes/actions";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const TIME_OPTIONS = Array.from({ length: 72 }, (_, k) => {
  const total = 6 * 60 + k * 15;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

export function AvailabilityRow({
  id,
  dayOfWeek,
  startTime,
  endTime,
}: {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}) {
  const [editing, setEditing] = useState(false);
  const start = startTime.slice(0, 5);
  const end = endTime.slice(0, 5);

  return (
    <li className="border-b border-ink-900/5 pb-2 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-medium">{DAYS[dayOfWeek]}</span>{" "}
          <span className="tabular-nums text-ink-500">{start} – {end}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs font-medium">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center gap-1 text-gold-600 hover:underline"
          >
            <Pencil size={12} /> Editar
          </button>
          <form action={deleteAvailabilityAction}>
            <input type="hidden" name="id" value={id} />
            <button className="text-red-700 hover:underline">Eliminar</button>
          </form>
        </div>
      </div>

      {editing && (
        <form action={updateAvailabilityAction} className="mt-2 grid gap-2 sm:grid-cols-3">
          <input type="hidden" name="id" value={id} />
          <select name="start_time" defaultValue={start} className="input tabular-nums">
            {TIME_OPTIONS.slice(0, -1).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select name="end_time" defaultValue={end} className="input tabular-nums">
            {TIME_OPTIONS.slice(1).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button className="btn-primary">Guardar</button>
        </form>
      )}
    </li>
  );
}
