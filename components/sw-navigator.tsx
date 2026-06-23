"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Recebe ordens de navegacao do service worker (clique numa notificacao
// push) e navega pelo router interno do Next. Isto torna o deep-link
// fiavel no iOS PWA, onde WindowClient.navigate()/openWindow() nao levam
// a app a pagina certa (fica no start_url, /app/dashboard).
//
// Dois caminhos:
//  - App ja aberta -> o SW faz postMessage e nos navegamos aqui.
//  - App fechada (cold start via push) -> ao montar lemos a navegacao
//    pendente que o SW PERSISTIU na Cache (sobrevive a reinicios do SW,
//    ver sw.js v20). Se nao houver (ex.: SW v19 antigo ainda a controlar),
//    caimos no fallback antigo: pedir ao SW via "get-pending-nav".
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

    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.type === "navigate" && typeof d.url === "string") go(d.url);
    };

    navigator.serviceWorker.addEventListener("message", onMsg);

    // Cold start: le a navegacao pendente persistida na Cache pelo SW.
    async function consumePendingNav() {
      try {
        if (typeof caches !== "undefined") {
          const c = await caches.open(NAV_CACHE);
          const res = await c.match(PENDING_NAV_KEY);
          if (res) {
            await c.delete(PENDING_NAV_KEY);
            const url = (await res.text()).trim();
            if (url) {
              go(url);
              return;
            }
          }
        }
      } catch {}
      try {
        const reg = await navigator.serviceWorker.ready;
        const sw = reg.active || navigator.serviceWorker.controller;
        if (sw) sw.postMessage({ type: "get-pending-nav" });
      } catch {}
    }
    void consumePendingNav();

    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [router]);

  return null;
}
