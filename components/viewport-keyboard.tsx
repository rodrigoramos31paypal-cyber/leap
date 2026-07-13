"use client";

import { useEffect } from "react";

// Deteta o teclado virtual e marca <html class="kb-open">. Em iOS
// (sobretudo PWA standalone) o teclado NÃO encolhe o layout viewport, por
// isso a barra inferior do shell ficava a "flutuar" a meio com um espaço
// branco por baixo. Em vez de mexer na altura do shell (o que expunha o
// fundo do body), escondemos a barra inferior enquanto o teclado está
// aberto — ver regra `html.kb-open #app-bottom-nav` no globals.css.
//
// Só consideramos "teclado aberto" quando a redução é significativa
// (>120px); resizes pequenos (barra de URL do Safari ao fazer scroll) são
// ignorados para não esconder a barra sem motivo.
export function ViewportKeyboard() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.classList.toggle("kb-open", kb > 120);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.classList.remove("kb-open");
    };
  }, []);

  return null;
}
