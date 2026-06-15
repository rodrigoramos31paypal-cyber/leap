"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

// ════════════════════════════════════════════════════════════════
// WeekSwipeNav · em ecrãs táctil, swipe esquerda → próxima semana,
// swipe direita → semana anterior.
//
// Threshold (estilo Google Calendar mobile): > 60 px horizontais,
// < 50 px verticais, < 700 ms. O limite vertical garante que um
// scroll vertical normal NÃO dispara navegação por engano.
//
// Toques que começam num evento (data-event-block) são ignorados
// para não conflitar com o drag-to-reschedule do BookingBlock.
// ════════════════════════════════════════════════════════════════
export function WeekSwipeNav({
  prevHref,
  nextHref,
  children,
}: {
  prevHref: string;
  nextHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const ignoredRef = useRef(false);

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) {
      startRef.current = null;
      ignoredRef.current = true;
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("[data-event-block]")) {
      // Deixa o BookingBlock tratar do drag — não queremos engatar swipe.
      ignoredRef.current = true;
      startRef.current = null;
      return;
    }
    ignoredRef.current = false;
    const t = e.touches[0];
    startRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = startRef.current;
    startRef.current = null;
    if (!start || ignoredRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50 && dt < 700) {
      router.push(dx < 0 ? nextHref : prevHref);
    }
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
    </div>
  );
}
