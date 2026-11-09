"use client";

import { useEffect } from "react";

// A altura do viewport visível mantém o chat acima do teclado, mesmo
// quando o Safari desloca o viewport para focar o campo de escrita.
export function ViewportKeyboard() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    const update = () => {
      const open = vv.scale === 1 && window.innerHeight - vv.height > 120;
      root.style.setProperty("--keyboard-viewport-height", `${vv.height}px`);
      root.style.setProperty("--keyboard-viewport-top", `${Math.max(0, vv.offsetTop)}px`);
      root.classList.toggle("kb-open", open);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.classList.remove("kb-open");
      root.style.removeProperty("--keyboard-viewport-height");
      root.style.removeProperty("--keyboard-viewport-top");
    };
  }, []);

  return null;
}
