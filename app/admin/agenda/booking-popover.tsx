"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { NotebookPen, ExternalLink, Coins, Clock } from "lucide-react";
import { formatTime, BOOKING_STATUS } from "@/lib/utils";
import { NoteEditor } from "@/components/note-editor";
import {
  confirmAttendanceAction,
  markNoShowAction,
  cancelAdminAction,
  updateBookingDurationAction,
} from "./actions";

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
// Primeiro nome do cliente, truncado a 7 chars (usado em sítios onde
// só cabe uma linha curta, como o preview de drag).
function shortName(full?: string | null) {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 7);
}
// Primeiro nome com cap generoso (14 chars) — usado no bloco da sessão
// onde permitimos wrap a 2 linhas via line-clamp e font ~8 px em mobile;
// o cap evita que um nome muito longo destrua o layout em colunas
// estreitas, mas é grande o suficiente para "Alexandre" / "Constança".
function firstNameLong(full?: string | null) {
  const first = (full ?? "").trim().split(/\s+/)[0] ?? "";
  return first.slice(0, 14);
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
  rowTops,
  rowHeights,
  snapMin = 15,
  sessionsLeft,
  isLastCredit = false,
  overlap = false,
  overlapCol = 0,
}: {
  b: any;
  note?: { body: string } | null;
  style: React.CSSProperties;
  draggable?: boolean;
  // Layout de altura variável (24 horas), partilhado com a grelha em
  // page.tsx — necessário para o arrasto mapear px↔hora correctamente
  // mesmo com linhas encolhidas.
  rowTops: number[];
  rowHeights: number[];
  snapMin?: number;
  // Saldo de sessões do cliente (soma de purchases confirmed/não-expiradas).
  // `undefined` quando não foi pré-carregado; `0` significa zero a sério.
  sessionsLeft?: number;
  // `true` quando esta é a "sessão do último crédito" do cliente (saldo
  // de packs == 0). Sinalizada a vermelho na agenda para alertar o
  // treinador de que o cliente fica sem sessões.
  isLastCredit?: boolean;
  // `true` quando esta sessão se sobrepõe a outra — destaca o bordo
  // (cor depende de `overlapCol` para distinguir sessões empilhadas).
  overlap?: boolean;
  // Índice da coluna dentro do grupo de sobreposição (0, 1, 2…).
  // Mapeia para uma cor de bordo diferente, ajudando a distinguir
  // visualmente sessões empilhadas em mobile.
  overlapCol?: number;
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

  // Valor do controlo de duração no popover (presets + input livre).
  const [durInput, setDurInput] = useState<number>(durationMin);
  const [savingDur, startDurTransition] = useTransition();
  // Nº de sessões que a nova duração vai sobrepor (null = sem aviso pendente).
  const [overlapWarn, setOverlapWarn] = useState<number | null>(null);

  function saveDuration(force: boolean) {
    const fd = new FormData();
    fd.set("bookingId", b.id);
    fd.set("durationMin", String(durInput));
    if (force) fd.set("force", "true");
    startDurTransition(async () => {
      const res = await updateBookingDurationAction(fd);
      if (res?.conflict) {
        // Vai sobrepor outra sessão → pede confirmação (não fecha).
        setOverlapWarn(res.count ?? 1);
        return;
      }
      setOverlapWarn(null);
      if (res?.ok) setOpen(false); // gravou → fecha o popover
      // erro → mantém aberto (o toast mostra a mensagem)
    });
  }

  // ── Mapeamento px↔minutos com linhas de altura variável ──────────
  function minutesToY(totalMin: number): number {
    const clamped = Math.max(0, Math.min(24 * 60, totalMin));
    const h = Math.min(23, Math.floor(clamped / 60));
    const frac = (clamped - h * 60) / 60;
    return rowTops[h] + frac * rowHeights[h];
  }
  function yToMinutes(y: number): number {
    let h = 23;
    for (let i = 0; i < 24; i++) {
      if (y < rowTops[i] + rowHeights[i]) {
        h = i;
        break;
      }
    }
    const frac = Math.min(1, Math.max(0, (y - rowTops[h]) / rowHeights[h]));
    return h * 60 + frac * 60;
  }

  // Fecho com Esc. O clique-fora é tratado pelo backdrop full-screen do
  // modal (onClick), NÃO por um listener global de pointerdown — esse
  // fechava o popover no pointerdown e o clique seguinte caía na grelha,
  // abrindo o diálogo de nova marcação por engano.
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
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
    const totalMin = 24 * 60;
    const rawMin = yToMinutes(clientY - r.top);
    let snapped = Math.round(rawMin / snapMin) * snapMin;
    snapped = Math.max(0, Math.min(Math.max(0, totalMin - durationMin), snapped));
    const time = hhmm(snapped);
    const axis = document.querySelector<HTMLElement>("[data-timeaxis]");
    const axisLeft = axis ? axis.getBoundingClientRect().left : r.left - 44;
    const top = r.top + minutesToY(snapped);
    const bottom = r.top + minutesToY(snapped + durationMin);
    return {
      dateIso: col.dataset.daycol ?? originIso,
      time,
      colLeft: r.left,
      colWidth: r.width,
      top,
      height: Math.max(20, bottom - top - 2),
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

  // Marcador "último crédito": anel vermelho por cima da cor do estado
  // (mantém verde/dourado mas avisa que o cliente fica sem sessões).
  // Distinto da falta (no_show), que é preenchida a vermelho (estado).
  const lastCreditRing =
    isLastCredit && b.status !== "cancelled"
      ? "ring-2 ring-inset ring-red-500"
      : "";

  return (
    <div
      ref={ref}
      data-event-block
      className={`absolute left-0.5 right-0.5 overflow-hidden rounded border text-[10px] transition-colors ${tone} ${lastCreditRing} ${
        overlap
          ? `booking-overlap-block ${
              // Sem !border-2: a borda fica na mesma espessura (1px) que
              // sessões sem sobreposição. A cor distinta é que sinaliza
              // o stack, não a espessura.
              [
                "!border-amber-500",
                "!border-violet-500",
                "!border-sky-500",
                "!border-rose-500",
              ][overlapCol % 4]
            }`
          : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{
        ...style,
        // Quando o popover está aberto, sobe o z-index do bloco acima
        // de qualquer outro BookingBlock (que pode estar com zIndex 20+col
        // por causa da side-by-side cascade). Sem isto, sessões vizinhas
        // ficavam visualmente em cima do modal por causa do stacking
        // context criado pelo z-index do próprio bloco.
        ...(open ? { zIndex: 60 } : {}),
        touchAction: draggable ? "none" : undefined,
      }}
    >
      {isLastCredit && b.status !== "cancelled" && (
        <span
          title="Último crédito — cliente sem sessões"
          className="pointer-events-none absolute right-0.5 top-0.5 z-10 h-2 w-2 rounded-full bg-red-500 ring-1 ring-white"
        />
      )}
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
        // h-full: a área de clique/arrasto cobre TODO o bloco (antes só
        // cobria o texto, e clicar na parte vazia não abria o popover).
        className="flex h-full w-full flex-col [cursor:inherit] px-0.5 py-0.5 text-left"
      >
        <div className="font-semibold tabular-nums leading-none text-[9px]">{formatTime(b.starts_at)}</div>
        <div
          className={`${overlap ? "mt-px" : "mt-0.5"} break-words font-medium leading-[1.05] [overflow-wrap:anywhere]`}
          style={{
            // Font responsivo: 7 px mínimo (mobile estreito) → 10 px
            // máximo (tablet+). Em 380 px mobile, 2.2vw ≈ 8.4 px →
            // permite ~7-8 chars na primeira linha; nomes maiores
            // partem para a 2ª via line-clamp. Em sobreposição
            // limitamos a 1 linha para reduzir altura e não tocar na
            // borda do bloco da frente que vem por baixo.
            fontSize: "clamp(7px, 2.2vw, 10px)",
            display: "-webkit-box",
            WebkitLineClamp: overlap ? 1 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {firstNameLong(b.profiles?.full_name) || "—"}
        </div>
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
        // Modal centrado no ecrã (mobile e desktop). Antes era um
        // bottom-sheet (items-end) em mobile; o cliente preferia o
        // painel a aparecer ao centro. Resolve também o overflow
        // horizontal que acontecia quando o popover absoluto era
        // ancorado a um dia da direita e estendia para fora do ecrã.
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4"
          onClick={(e) => {
            // Fecha no CLIQUE no backdrop (não no pointerdown). Como o
            // backdrop é full-screen e está por cima, o clique é
            // consumido aqui e nunca chega à grelha por baixo.
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 text-sm text-ink-900 shadow-xl dark:bg-ink-800"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="font-display text-base font-bold tabular-nums">
                {formatTime(b.starts_at)}
                {b.ends_at ? `–${formatTime(b.ends_at)}` : ""}
              </div>
              <div className="text-xs text-ink-500">
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
            <p className="mb-3 rounded bg-bone-100 px-2.5 py-1.5 text-[11px] text-ink-500">
              Arrasta o bloco para reagendar.
            </p>
          )}

          {isLastCredit && b.status !== "cancelled" && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
              <span>
                <span className="font-semibold">Último crédito.</span> O cliente
                fica sem sessões após esta — avisa-o durante o treino.
              </span>
            </div>
          )}

          {/* Saldo de sessões + link para o perfil. O saldo é o que
              o cliente ainda tem disponível em packs (não inclui esta
              sessão se ela já foi descontada). */}
          <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-ink-900/10 bg-bone-50 px-3 py-2 text-xs">
            <div className="inline-flex items-center gap-1.5">
              <Coins size={14} className="text-gold-600" />
              {sessionsLeft === undefined ? (
                <span className="text-ink-500">Sessões: —</span>
              ) : sessionsLeft === 0 ? (
                <span className="font-semibold text-red-700">
                  Sem sessões
                </span>
              ) : (
                <span className="text-ink-700">
                  <span className="font-semibold tabular-nums">
                    {sessionsLeft}
                  </span>{" "}
                  {sessionsLeft === 1 ? "sessão" : "sessões"}
                </span>
              )}
            </div>
            {b.client_id && (
              <Link
                href={`/admin/clientes/${b.client_id}`}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-600 hover:text-ink-900"
              >
                Ver perfil <ExternalLink size={11} />
              </Link>
            )}
          </div>

          {(b.status === "booked" || b.status === "confirmed") && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {b.status === "booked" && (
                <form action={confirmAttendanceAction}>
                  <input type="hidden" name="bookingId" value={b.id} />
                  <button className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-bone-50 hover:bg-ink-700">
                    ✓ Aceitar
                  </button>
                </form>
              )}
              {b.status === "confirmed" && (
                <form action={confirmAttendanceAction}>
                  <input type="hidden" name="bookingId" value={b.id} />
                  <button className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                    ✓ Presente
                  </button>
                </form>
              )}
              <form action={markNoShowAction}>
                <input type="hidden" name="bookingId" value={b.id} />
                <button className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                  Falta
                </button>
              </form>
              <details className="relative w-full">
                <summary className="cursor-pointer list-none rounded-md border border-ink-900/10 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-50 dark:hover:bg-white/5 sm:inline-block sm:w-auto">
                  Cancelar
                </summary>
                <form action={cancelAdminAction} className="mt-2 space-y-2">
                  <input type="hidden" name="bookingId" value={b.id} />
                  <label className="block text-xs font-medium text-ink-600">
                    Motivo (opcional)
                  </label>
                  <textarea
                    name="reason"
                    rows={2}
                    maxLength={500}
                    placeholder="Ex: trainer indisponível"
                    className="w-full rounded-md border border-ink-900/10 px-2 py-1.5 text-xs"
                  />
                  <button className="w-full rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                    Confirmar cancelamento
                  </button>
                </form>
              </details>
            </div>
          )}

          {(b.status === "booked" || b.status === "confirmed") && (
            <details className="mb-3 border-t border-ink-900/10 pt-3">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-600 hover:text-ink-900">
                <Clock size={12} /> Duração · {durationMin} min
              </summary>
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[30, 45, 60, 90].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDurInput(m)}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                        durInput === m
                          ? "border-gold-400 bg-gold-50 text-ink-900"
                          : "border-ink-900/15 hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-50 dark:hover:bg-white/5"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                  <div className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      min={5}
                      max={600}
                      step={5}
                      value={durInput}
                      onChange={(e) => setDurInput(Number(e.target.value))}
                      className="w-16 appearance-none rounded-md border border-ink-900/15 bg-white px-2 py-1 text-xs tabular-nums text-ink-900 [color-scheme:light] dark:border-white/15 dark:bg-ink-800 dark:text-bone-50 dark:[color-scheme:dark]"
                    />
                    <span className="text-xs text-ink-500 dark:text-bone-50/60">min</span>
                  </div>
                </div>
                {overlapWarn === null ? (
                  <button
                    type="button"
                    disabled={savingDur}
                    onClick={() => saveDuration(false)}
                    className="w-full rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-bone-50 hover:bg-ink-700 disabled:opacity-50 dark:bg-ink-700 dark:hover:bg-ink-600"
                  >
                    {savingDur ? "A guardar…" : "Guardar duração"}
                  </button>
                ) : (
                  <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p>
                      Esta duração vai <span className="font-semibold">sobrepor-se a {overlapWarn}{" "}
                      {overlapWarn === 1 ? "sessão" : "sessões"}</span>. Queres guardar à mesma?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={savingDur}
                        onClick={() => saveDuration(true)}
                        className="flex-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {savingDur ? "A guardar…" : "Sim, guardar à mesma"}
                      </button>
                      <button
                        type="button"
                        disabled={savingDur}
                        onClick={() => setOverlapWarn(null)}
                        className="rounded-md border border-ink-900/15 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-900/5"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}

          <details className="border-t border-ink-900/10 pt-3">
            <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-600 hover:text-ink-900">
              <NotebookPen size={12} /> Minhas notas{note ? " · ✓" : ""}
            </summary>
            <div className="mt-2">
              <NoteEditor bookingId={b.id} initialBody={note?.body} compact />
            </div>
          </details>
          </div>
        </div>
      )}
    </div>
  );
}
