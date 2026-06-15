"use client";

import { useEffect, useRef, useState } from "react";
import { NotebookPen } from "lucide-react";
import { formatTime, BOOKING_STATUS } from "@/lib/utils";
import { NoteEditor } from "@/components/note-editor";
import { confirmAttendanceAction, markNoShowAction, cancelAdminAction } from "./actions";

// ── helpers de drag ────────────────────────────────────────────────
function isoDateOf(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function hhmm(totalMin: number) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
// Primeiro nome do cliente, truncado a 7 chars para caber dentro do
// bloco da sessão em qualquer largura de coluna (mobile ~47 px).
function shortName(full?: string | null) {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 7);
}

type Preview = {
  dateIso: string;
  time: string;
  colLeft: number;
  colWidth: number;
  top: number;
  height: number;
  axisLeft: number;
};

export function BookingBlock({
  b,
  note,
  style,
  draggable = false,
  hourStart = 7,
  hourEnd = 22,
  hourHeight = 56,
  snapMin = 15,
}: {
  b: any;
  note?: { body: string } | null;
  style: React.CSSProperties;
  draggable?: boolean;
  hourStart?: number;
  hourEnd?: number;
  hourHeight?: number;
  snapMin?: number;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // refs de drag (não provocam re-render)
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  // refs do edge-scroll: posição do cursor (para re-compute do preview
  // durante scroll automático), velocidade actual e handle do rAF.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const scrollVelRef = useRef(0);
  const scrollAnimRef = useRef<number | null>(null);

  const startDate = new Date(b.starts_at);
  const durationMin = b.ends_at
    ? Math.max(15, Math.round((new Date(b.ends_at).getTime() - startDate.getTime()) / 60000))
    : 60;
  const originIso = isoDateOf(startDate);
  const originTime = hhmm(startDate.getHours() * 60 + startDate.getMinutes());

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

  function computePreview(clientX: number, clientY: number): Preview | null {
    const cols = Array.from(
      document.querySelectorAll<HTMLElement>("[data-daycol]"),
    );
    if (cols.length === 0) return null;
    // coluna sob o cursor (ou a mais próxima horizontalmente)
    let col = cols.find((c) => {
      const r = c.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right;
    });
    if (!col) {
      let best = cols[0];
      let bestDist = Infinity;
      for (const c of cols) {
        const r = c.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const d = Math.abs(cx - clientX);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      col = best;
    }
    const r = col.getBoundingClientRect();
    const totalMin = (hourEnd - hourStart) * 60;
    const rawMin = ((clientY - r.top) / hourHeight) * 60;
    let snapped = Math.round(rawMin / snapMin) * snapMin;
    snapped = Math.max(0, Math.min(Math.max(0, totalMin - durationMin), snapped));
    const time = hhmm(hourStart * 60 + snapped);
    const axis = document.querySelector<HTMLElement>("[data-timeaxis]");
    const axisLeft = axis ? axis.getBoundingClientRect().left : r.left - 44;
    return {
      dateIso: col.dataset.daycol ?? originIso,
      time,
      colLeft: r.left,
      colWidth: r.width,
      top: r.top + (snapped / 60) * hourHeight,
      height: Math.max(20, (durationMin / 60) * hourHeight - 2),
      axisLeft,
    };
  }

  // ── Edge-scroll: quando o cursor se aproxima do topo/fundo do
  // container interno scrollable (#agenda-week-scroll), faz scroll
  // automático para revelar horas adjacentes (ex: arrastar uma sessão
  // do 07:30 para o 06:00, ou para depois das 21:00). Recalcula o
  // preview a cada frame para a hora mostrada acompanhar o scroll.
  function maybeStartEdgeScroll(clientY: number) {
    if (typeof window === "undefined") return;
    const container = document.getElementById("agenda-week-scroll");
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const EDGE = 70; // px da margem que activa scroll
    const MAX_VEL = 12; // px por frame (~720 px/s a 60 fps)
    // BUG-FIX: clampar as bordas efectivas à VIEWPORT. O container
    // (max-h 75 vh) muitas vezes estende-se para fora da janela
    // visível — `rect.bottom` pode ser > window.innerHeight, e como
    // o `clientY` está limitado à viewport, a zona-bottom nunca era
    // alcançada. Ao limitar `effectiveBottom` à viewport, garantimos
    // que arrastar para o fundo do ecrã activa scroll-down.
    const viewportBottom =
      typeof window !== "undefined" ? window.innerHeight : rect.bottom;
    const effectiveTop = Math.max(rect.top, 0);
    const effectiveBottom = Math.min(rect.bottom, viewportBottom);
    // 50 px extra no topo cobrem o sticky day-header — se o cursor
    // entrar nessa zona já queremos scrollar para cima.
    const topZone = effectiveTop + 50 + EDGE;
    const bottomZone = effectiveBottom - EDGE;
    let vel = 0;
    if (clientY < topZone) {
      const dist = topZone - clientY;
      vel = -Math.min(MAX_VEL, (dist / EDGE) * MAX_VEL);
    } else if (clientY > bottomZone) {
      const dist = clientY - bottomZone;
      vel = Math.min(MAX_VEL, (dist / EDGE) * MAX_VEL);
    }
    scrollVelRef.current = vel;
    if (vel !== 0 && scrollAnimRef.current === null) {
      const tick = () => {
        const v = scrollVelRef.current;
        if (v === 0) {
          scrollAnimRef.current = null;
          return;
        }
        const prev = container.scrollTop;
        container.scrollTop = prev + v;
        const advanced = container.scrollTop !== prev;
        // re-compute preview com a última posição do cursor — o slot
        // sob o dedo muda à medida que o container scrolla, queremos
        // que o badge HH:MM acompanhe a hora real.
        if (lastPointerRef.current) {
          setPreview(
            computePreview(
              lastPointerRef.current.x,
              lastPointerRef.current.y,
            ),
          );
        }
        if (!advanced) {
          // chegou ao limite scrollable (já não dá para scrollar mais)
          scrollAnimRef.current = null;
          return;
        }
        scrollAnimRef.current = requestAnimationFrame(tick);
      };
      scrollAnimRef.current = requestAnimationFrame(tick);
    }
  }

  function stopEdgeScroll() {
    scrollVelRef.current = 0;
    if (scrollAnimRef.current !== null) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
    lastPointerRef.current = null;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!draggable) return;
    // só botão principal
    if (e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggable || !startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (!draggingRef.current && Math.hypot(dx, dy) < 5) return; // threshold
    draggingRef.current = true;
    document.body.style.userSelect = "none";
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    setPreview(computePreview(e.clientX, e.clientY));
    maybeStartEdgeScroll(e.clientY);
  }

  function onPointerCancel() {
    if (!draggable) return;
    stopEdgeScroll();
    startRef.current = null;
    draggingRef.current = false;
    document.body.style.userSelect = "";
    setPreview(null);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!draggable) return;
    stopEdgeScroll();
    const wasDragging = draggingRef.current;
    startRef.current = null;
    draggingRef.current = false;
    document.body.style.userSelect = "";
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}

    if (!wasDragging) {
      // clique simples → abre/fecha popover
      setOpen((o) => !o);
      return;
    }

    const p = computePreview(e.clientX, e.clientY) ?? preview;
    setPreview(null);
    if (!p) return;
    // mudou mesmo de slot?
    if (p.dateIso === originIso && p.time === originTime) return;
    window.dispatchEvent(
      new CustomEvent("agenda:reschedule", {
        detail: {
          bookingId: b.id,
          clientName: b.profiles?.full_name ?? "",
          durationMin,
          fromLabel: `${formatTime(b.starts_at)}`,
          newDateIso: p.dateIso,
          newTime: p.time,
        },
      }),
    );
  }

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
      data-event-block
      className={`absolute left-0.5 right-0.5 rounded border text-[10px] transition-colors ${tone} ${
        open ? "z-30 overflow-visible" : "overflow-hidden"
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ ...style, touchAction: draggable ? "none" : undefined }}
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={() => {
          // o clique "real" é tratado em onPointerUp; mantemos isto como
          // fallback para teclado/acessibilidade quando não há drag.
          if (!draggable) setOpen((o) => !o);
        }}
        className="block w-full [cursor:inherit] p-1 text-left"
      >
        <div className="font-semibold tabular-nums">{formatTime(b.starts_at)}</div>
        <div className="truncate font-medium">{shortName(b.profiles?.full_name) || "—"}</div>
      </button>

      {/* Pré-visualização durante o arrasto */}
      {preview && (
        <>
          {/* etiqueta de hora na coluna de tempo (esquerda) */}
          <div
            className="pointer-events-none fixed z-50 -translate-y-1/2 rounded bg-ink-900 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-bone-50 shadow"
            style={{ top: preview.top, left: preview.axisLeft }}
          >
            {preview.time}
          </div>
          {/* fantasma no slot de destino */}
          <div
            className="pointer-events-none fixed z-40 rounded border-2 border-dashed border-ink-900/60 bg-gold-100/70 p-1 text-[10px] text-ink-900 shadow-lg"
            style={{
              top: preview.top,
              left: preview.colLeft + 2,
              width: preview.colWidth - 4,
              height: preview.height,
            }}
          >
            <div className="font-semibold tabular-nums">{preview.time}</div>
            <div className="truncate font-medium">{shortName(b.profiles?.full_name) || "—"}</div>
          </div>
        </>
      )}

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

          {draggable && (
            <p className="mb-2 rounded bg-bone-100 px-2 py-1 text-[10px] text-ink-500">
              Arrasta o bloco para reagendar.
            </p>
          )}

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
