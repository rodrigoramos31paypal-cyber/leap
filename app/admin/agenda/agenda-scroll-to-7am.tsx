"use client";

import { useEffect } from "react";

// ════════════════════════════════════════════════════════════════
// AgendaScrollTo7am · ao montar (e a cada navegação de semana),
// posiciona o scroll interno da grelha nas 07:00 — o "primário"
// para o trainer. As horas anteriores existem para casos especiais
// (cliente das 06:30) mas começam fora do ecrã.
//
// `top` é o offset (px) das 07:00 na grelha de altura variável,
// calculado em page.tsx (layout.tops[7]) e passado como prop.
// ════════════════════════════════════════════════════════════════
export function AgendaScrollTo7am({ top = 0 }: { top?: number }) {
  useEffect(() => {
    const el = document.getElementById("agenda-week-scroll");
    if (!el) return;
    el.scrollTop = top;
  }, [top]);
  return null;
}
