"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { healPushSubscription } from "@/lib/push-client";

const DISMISS_KEY = "leap-push-dismissed-at";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// Soft prompt + auto-heal:
//  • permissão 'granted' mas sem subscrição (ex.: re-instalou a PWA) →
//    re-subscreve em silêncio, sem mostrar nada.
//  • permissão 'default' e não dispensado → mostra o card "Ativar".
//  • 'denied' → nada (tem de reativar nas definições do browser/iOS).
export function PushSubscribeCard() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return;

    if (Notification.permission === "granted") {
      healPushSubscription().then(ok => { if (!ok) setShow(true); }).catch(() => setShow(true));
      return;
    }
    if (Notification.permission !== "default") return; // denied
    const last = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (last && Date.now() - last < DISMISS_TTL_MS) return;
    setShow(true);
  }, []);

  async function enable() {
    setBusy(true);
    setError(false);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        if (perm === "denied") localStorage.setItem(DISMISS_KEY, String(Date.now()));
        setShow(false);
        return;
      }
      if (await healPushSubscription()) setShow(false);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="card flex items-center gap-3 p-4">
      {/* Sininho a "tocar" + pulsar para chamar a atenção — os clientes não
          reparavam no cartão. Respeita quem tem "reduzir movimento" ligado. */}
      <style>{`
        @keyframes bellRing {
          0%  { transform: rotate(0); }
          6%  { transform: rotate(28deg); }
          13% { transform: rotate(-26deg); }
          20% { transform: rotate(22deg); }
          27% { transform: rotate(-18deg); }
          34% { transform: rotate(14deg); }
          41% { transform: rotate(-10deg); }
          48% { transform: rotate(6deg); }
          55% { transform: rotate(0); }
          100%{ transform: rotate(0); }
        }
        @keyframes bellPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(202,161,74,0.0); transform: scale(1); }
          50%      { box-shadow: 0 0 0 7px rgba(202,161,74,0.18); transform: scale(1.08); }
        }
        .atua-bell-ring { animation: bellRing 1.6s ease-in-out infinite; transform-origin: 50% 3px; }
        .atua-pulse     { animation: bellPulse 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .atua-bell-ring, .atua-pulse { animation: none; }
        }
      `}</style>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-400/15 text-gold-600 dark:text-gold-400">
        <Bell size={18} className="atua-bell-ring" />
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold">Ativar notificações</div>
        <div className="text-xs text-ink-500">Recebe lembretes e avisos mesmo com a app fechada.</div>
        {error && <p role="status" className="mt-1 text-xs text-red-600 dark:text-red-300">Não foi possível ativar. Tenta novamente.</p>}
      </div>
      <button onClick={enable} disabled={busy} className="atua-pulse btn-gold shrink-0 text-xs">
        {busy ? "A ativar…" : "Ativar"}
      </button>
      <button
        onClick={dismiss}
        aria-label="Dispensar"
        className="shrink-0 rounded-md p-1.5 text-ink-500 hover:bg-ink-900/5"
      >
        <X size={14} />
      </button>
    </div>
  );
}
