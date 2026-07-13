"use client";

import { useEffect } from "react";

// iOS standalone PWA: no arranque a frio (após force-close), `100dvh` /
// `window.innerHeight` são calculados ANTES de o viewport assentar, ficando
// MENORES que o ecrã real. O shell (`h-[100dvh]`) fica curto e a barra
// inferior, ancorada ao fundo do shell, "flutua" a meio com um espaço por
// baixo. Só corrige após um resize/interação — daí parecer levitar logo a
// seguir a abrir a app.
//
// Solução: medir a altura real em JS e escrevê-la numa CSS var
// (`--app-height`), que o shell usa com `100dvh` como fallback. Voltamos a
// medir depois de o arranque assentar (rAF + timeouts) e em cada evento de
// viewport, sem precisar de interação do utilizador.
//
// Usamos `window.innerHeight` (altura do layout viewport) e NÃO
// `visualViewport.height`: em iOS o teclado virtual não encolhe o layout
// viewport, por isso o shell mantém-se com altura cheia enquanto se escreve
// (o teclado é tratado à parte pelo ViewportKeyboard, que esconde a barra).
export function AppHeight() {
  useEffect(() => {
    const root = document.documentElement;

    const set = () => {
      const h = window.innerHeight;
      if (h > 0) root.style.setProperty("--app-height", `${h}px`);
    };

    set();
    // Re-medições para apanhar o viewport a assentar no arranque a frio.
    const raf = requestAnimationFrame(set);
    const timers = [
      setTimeout(set, 100),
      setTimeout(set, 300),
      setTimeout(set, 600),
    ];

    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    // `pageshow` dispara quando a app volta do bfcache (retomar standalone).
    window.addEventListener("pageshow", set);
    window.visualViewport?.addEventListener("resize", set);

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
      window.removeEventListener("pageshow", set);
      window.visualViewport?.removeEventListener("resize", set);
    };
  }, []);

  return null;
}
