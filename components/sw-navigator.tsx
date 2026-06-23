"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Recebe ordens de navegação do service worker (clique numa notificação
// push) e navega pelo router interno do Next. Isto torna o deep-link
// fiável no iOS PWA, onde WindowClient.navigate()/openWindow() não levam
// a app à página certa (fica no start_url, /app/dashboard).
//
// Dois caminhos:
//  • App já aberta → o SW faz postMessage e nós navegamos aqui.
//  • App fechada (cold start via push) → ao montar pedimos ao SW a
//    navegação pendente ("get-pending-nav"); ele responde com o destino.
export function SwNavigator() {
  const router = useRouter();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const go = (url: string) => {
      try {
        const u = new URL(url, window.location.origin);
        // Evita recarregar se já lá estamos.
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

    // Cold start: pergunta ao SW se há navegação pendente.
    navigator.serviceWorker.ready
      .then((reg) => {
        const sw = reg.active || navigator.serviceWorker.controller;
        if (sw) sw.postMessage({ type: "get-pending-nav" });
      })
      .catch(() => {});

    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [router]);

  return null;
}
