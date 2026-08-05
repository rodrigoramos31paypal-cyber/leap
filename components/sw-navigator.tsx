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

    let cancelled = false;

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

    // Le e CONSOME (apaga) a navegacao pendente da Cache numa unica
    // tentativa. Devolve true se navegou. Consumir evita que um foreground
    // posterior re-navegue para um destino ja tratado.
    async function readAndConsume(): Promise<boolean> {
      try {
        if (typeof caches === "undefined") return false;
        const c = await caches.open(NAV_CACHE);
        const res = await c.match(PENDING_NAV_KEY);
        if (!res) return false;
        await c.delete(PENDING_NAV_KEY);
        const url = (await res.text()).trim();
        if (url) go(url);
        return true;
      } catch {
        return false;
      }
    }

    // iOS PWA (o bug): ao trazer a app CONGELADA (em segundo plano) para a
    // frente via clique na notificacao, o evento de visibilidade da janela
    // pode disparar ANTES de o service worker acabar de escrever o destino
    // na cache (race). Uma leitura unica falhava e a app ficava na ultima
    // pagina. Por isso re-verificamos a cache varias vezes durante ~2.4s
    // ate o destino aparecer. Em arranque a frio acerta a primeira.
    let polling = false;
    async function consumeWithRetry() {
      if (polling) return;
      polling = true;
      try {
        for (let i = 0; i < 12 && !cancelled; i++) {
          if (await readAndConsume()) return;
          await new Promise((r) => setTimeout(r, 200));
        }
      } finally {
        polling = false;
      }
    }

    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.type === "navigate" && typeof d.url === "string") {
        go(d.url);
        // Limpa a cache para nao re-navegar mais tarde no visibilitychange.
        void readAndConsume();
      }
    };

    // Qualquer sinal de "a app voltou a estar visivel" dispara a re-leitura
    // com retry. visibilitychange cobre o caso normal; focus e pageshow
    // cobrem casos do iOS em que o primeiro nao dispara de forma fiavel.
    const onResume = () => {
      if (document.visibilityState === "visible") void consumeWithRetry();
    };

    navigator.serviceWorker.addEventListener("message", onMsg);
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    window.addEventListener("pageshow", onResume);

    // Cold start: le a cache imediatamente (com retry, inofensivo).
    void consumeWithRetry();

    // Fallback para SW antigo (v19/v20) que ainda controle a pagina logo
    // apos o deploy: pede a nav pendente por mensagem.
    navigator.serviceWorker.ready
      .then((reg) => {
        const sw = reg.active || navigator.serviceWorker.controller;
        if (sw) sw.postMessage({ type: "get-pending-nav" });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onMsg);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      window.removeEventListener("pageshow", onResume);
    };
  }, [router]);

  return null;
}
