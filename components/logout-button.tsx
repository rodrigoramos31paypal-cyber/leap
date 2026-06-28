"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

// Logout fiável em PWA standalone (iOS). Antes era um <form method="post">
// nativo para /auth/logout; em iOS instalado no ecrã principal a submissão
// de form full-page muitas vezes "não fazia nada" (quirk do WebKit em
// standalone) e o CSP `form-action 'self'` pode bloquear silenciosamente a
// navegação POST→redirect no Safari. Submeter via fetch contorna ambos:
// fetch é governado por `connect-src 'self'` (permitido) e nós controlamos
// a navegação a seguir. O endpoint do servidor (/auth/logout) mantém-se —
// faz signOut() e limpa os cookies de sessão; aqui só o chamamos e saímos.
export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    if (busy) return;
    setBusy(true);
    try {
      // `redirect: "manual"` → não seguimos o 303 para "/"; só precisamos
      // que o POST corra (signOut + Set-Cookie a limpar a sessão). Os
      // cookies são aplicados pelo browser mesmo numa resposta opaca.
      await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        redirect: "manual",
      });
    } catch {
      // Mesmo que a rede falhe, forçamos a saída para o ecrã público
      // abaixo — não deixamos o utilizador preso na sessão.
    }
    // Navegação dura (não router.push): garante um arranque limpo sem
    // estado de sessão em memória/cache RSC do lado do cliente.
    window.location.href = "/";
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={busy}
      aria-label="Sair"
      className="rounded-md p-2 text-ink-500 hover:bg-ink-900/5 disabled:opacity-50 dark:text-bone-100 dark:hover:bg-white/10"
    >
      <LogOut size={18} />
    </button>
  );
}
