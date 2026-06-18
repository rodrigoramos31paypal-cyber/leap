"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import {
  updateAvailabilityAction,
  deleteAvailabilityAction,
} from "@/app/admin/definicoes/actions";

// Dispara um toast IMEDIATAMENTE no Toaster montado nos layouts admin/app.
// Necessário porque ao usar uma server action sem `redirect`, o layout não
// é re-avaliado e o flash gravado no cookie só apareceria na próxima
// navegação completa.
function clientToast(title: string, kind: "success" | "error" | "info" = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("leap:toast", { detail: { title, kind } }),
  );
}

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
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const start = startTime.slice(0, 5);
  const end = endTime.slice(0, 5);

  function onSave(formData: FormData) {
    const s = String(formData.get("start_time") ?? "");
    const e = String(formData.get("end_time") ?? "");
    if (!s || !e || s >= e) {
      clientToast("A hora de início tem de ser anterior à hora de fim", "error");
      return;
    }
    formData.set("id", id);
    startTransition(async () => {
      await updateAvailabilityAction(formData);
      clientToast(`${DAYS[dayOfWeek]} actualizado para ${s} – ${e}`);
      setEditing(false);
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirm(`Eliminar horário de ${DAYS[dayOfWeek]}?`)) return;
    const fd = new FormData();
    fd.set("id", id);
    startDelete(async () => {
      await deleteAvailabilityAction(fd);
      clientToast(`Horário de ${DAYS[dayOfWeek]} eliminado`);
      router.refresh();
    });
  }

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
          <button
            type="button"
            onClick={onDelete}
            disabled={deletePending}
            className="text-red-700 hover:underline disabled:opacity-50"
          >
            {deletePending ? "A eliminar…" : "Eliminar"}
          </button>
        </div>
      </div>

      {editing && (
        <form action={onSave} className="mt-2 grid gap-2 sm:grid-cols-3">
          <input type="hidden" name="id" value={id} />
          <select
            name="start_time"
            defaultValue={start}
            className="input tabular-nums"
            disabled={pending}
          >
            {TIME_OPTIONS.slice(0, -1).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            name="end_time"
            defaultValue={end}
            className="input tabular-nums"
            disabled={pending}
          >
            {TIME_OPTIONS.slice(1).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={pending}>
            {pending ? "A guardar…" : "Guardar"}
          </button>
        </form>
      )}
    </li>
  );
}
