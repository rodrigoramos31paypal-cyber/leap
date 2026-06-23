"use client";

import { useEffect } from "react";

// Ajusta a altura do shell ao teclado virtual. Em iOS (sobretudo PWA
// standalone) o teclado NÃO encolhe o layout viewport — por isso a barra
// inferior do shell ficava "a flutuar" com um espaço branco por baixo,
// dependendo da altura do conteúdo da página.
//
// Medimos a altura do teclado via visualViewport e expomos em --kb. O
// shell passa a usar height: calc(100dvh - var(--kb)). Só encolhe quando
// o teclado abre de facto (>120px); resizes pequenos (barra de URL do
// Safari ao fazer scroll) são ignorados para não causar saltos.
export function ViewportKeyboard() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb", kb > 120 ? `${Math.round(kb)}px` : "0px");
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.setProperty("--kb", "0px");
    };
  }, []);

  return null;
}
