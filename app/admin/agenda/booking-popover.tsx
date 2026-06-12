"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, NotebookPen } from "lucide-react";
import { formatTime, BOOKING_STATUS } from "@/lib/utils";
import { NoteEditor } from "@/components/note-editor";
import { confirmAttendanceAction, markNoShowAction, cancelAdminAction } from "./actions";

export function BookingBlock({
  b,
  note,
  style,
}: {
  b: any;
  note?: { body: string } | null;
  style: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const tone =
    b.status === "confirmed"
      ? "bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100"
      : b.status === "no_show"
        ? "bg-red-50 border-red-300 text-red-900 hover:bg-red-100"
        : b.status === "cancelled"
          ? "bg-ink-900/5 border-ink-900/15 text-ink-500 line-through hover:bg-ink-900/10"
          : "bg-gold-50 border-gold-300 text-ink-900 hover:bg-gold-100";

  return (
    <div
      ref={ref}
      className={`absolute left-0.5 right-0.5 rounded border text-[10px] transition-colors ${tone} ${
        open ? "z-30 overflow-visible" : "overflow-hidden"
      }`}
      style={style}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="block w-full cursor-pointer p-1 text-left"
      >
        <div className="font-semibold tabular-nums">{formatTime(b.starts_at)}</div>
        <div className="truncate font-medium">{b.profiles?.full_name ?? "—"}</div>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-ink-900/10 bg-white p-3 text-xs text-ink-900 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold tabular-nums">
                {formatTime(b.starts_at)}
                {b.ends_at ? `–${formatTime(b.ends_at)}` : ""}
              </div>
              <div className="text-[11px] text-ink-500">
                {b.profiles?.full_name ?? "—"}
              </div>
            </div>
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
            <div className="mb-2 flex flex-wrap gap-1">
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
              <details className="relative">
                <summary className="cursor-pointer list-none rounded border border-ink-900/10 px-2 py-1 text-[10px] font-semibold text-ink-600 hover:bg-ink-900/5">
                  Cancelar
                </summary>
                <form action={cancelAdminAction} className="mt-2 space-y-1.5">
                  <input type="hidden" name="bookingId" value={b.id} />
                  <label className="block text-[10px] font-medium text-ink-600">
                    Motivo (opcional)
                  </label>
                  <textarea
                    name="reason"
                    rows={2}
                    maxLength={500}
                    placeholder="Ex: trainer indisponível"
                    className="w-full rounded border border-ink-900/10 px-2 py-1 text-[10px]"
                  />
                  <button className="w-full rounded bg-red-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-red-700">
                    Confirmar cancelamento
                  </button>
                </form>
              </details>
              <a
                href={`/api/bookings/${b.id}/ics`}
                className="inline-flex items-center gap-1 rounded border border-ink-900/10 px-2 py-1 text-[10px] font-semibold text-ink-600"
              >
                <CalendarPlus size={10} /> .ics
              </a>
            </div>
          )}

          <details className="border-t border-ink-900/10 pt-2">
            <summary className="inline-flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-ink-600 hover:text-ink-900">
              <NotebookPen size={10} /> Minhas notas{note ? " · ✓" : ""}
            </summary>
            <div className="mt-2">
              <NoteEditor bookingId={b.id} initialBody={note?.body} compact />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
