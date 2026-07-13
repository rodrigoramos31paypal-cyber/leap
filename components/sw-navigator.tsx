"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Recebe ordens de navegacao do service worker (clique numa notificacao
// push) e navega pelo router interno do Next. Isto torna o deep-link
// fiavel no iOS PWA, onde WindowClient.navigate()/openWindow() nao levam
// a app a pagina certa (fica no start_url, /app/dashboard).
//
// Fonte de verdade = a Cache "leap-nav" (escrita pelo SW no clique). Isto
// sobrevive a reinicios do SW E a mensagens postMessage perdidas (comum no
// iOS ao trazer uma PWA congelada para a frente). Lemos/consumimos essa
// cache em VARIOS momentos: ao montar (cold start), e sempre que a app
// volta a estar visivel/focada (warm start / app em segundo plano).
const NAV_CACHE = "leap-nav";
const PENDING_NAV_KEY = "/__leap_pending_nav__";

export function SwNavigator() {
  const router = useRouter();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const go = (url: string) => {
      try {
        const u = new URL(url, window.location.origin);
        // Evita recarregar se ja la estamos.
        if (u.pathname + u.search !== window.location.pathname + window.location.search) {
          router.push(u.pathname + u.search);
        }
      } catch {
        router.push(url);
      }
    };

    // Le e CONSOME (apaga) a navegacao pendente da Cache. Consumir evita
    // que um foreground posterior re-navegue para um destino ja tratado.
    async function consumePendingNav() {
      try {
        if (typeof caches === "undefined") return;
        const c = await caches.open(NAV_CACHE);
        const res = await c.match(PENDING_NAV_KEY);
        if (!res) return;
        await c.delete(PENDING_NAV_KEY);
        const url = (await res.text()).trim();
        if (url) go(url);
      } catch {}
    }

    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.type === "navigate" && typeof d.url === "string") {
        go(d.url);
        // Limpa a cache para nao re-navegar mais tarde no visibilitychange.
        void consumePendingNav();
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void consumePendingNav();
    };

    navigator.serviceWorker.addEventListener("message", onMsg);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    // Cold start: le a cache imediatamente.
    void consumePendingNav();

    // Fallback para SW antigo (v19/v20) que ainda controle a pagina logo
    // apos o deploy: pede a nav pendente por mensagem.
    navigator.serviceWorker.ready
      .then((reg) => {
        const sw = reg.active || navigator.serviceWorker.controller;
        if (sw) sw.postMessage({ type: "get-pending-nav" });
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMsg);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  return null;
}
