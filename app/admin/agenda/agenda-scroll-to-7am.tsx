"use client";

import { useEffect } from "react";

// ════════════════════════════════════════════════════════════════
// AgendaScrollTo7am · ao montar (e a cada navegação de semana),
// posiciona o scroll interno da grelha nas 07:00 — o "primário"
// para o trainer. As horas anteriores existem para casos especiais
// (cliente das 06:30) mas começam fora do ecrã.
//
// HOUR_HEIGHT e PRIME_START_HOUR têm de ser ESPELHADOS dos valores
// usados em page.tsx para o cálculo bater certo.
// ════════════════════════════════════════════════════════════════
const HOUR_HEIGHT = 88;
const PRIME_START_HOUR = 7;

export function AgendaScrollTo7am() {
  useEffect(() => {
    const el = document.getElementById("agenda-week-scroll");
    if (!el) return;
    el.scrollTop = PRIME_START_HOUR * HOUR_HEIGHT;
  }, []);
  return null;
}
