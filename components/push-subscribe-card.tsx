"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { savePushSubscription } from "@/lib/notification-actions";

const DISMISS_KEY = "leap-push-dismissed-at";
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Garante uma subscrição activa e grava-a. Reutiliza a existente se houver
// (idempotente: re-grava sempre, o que "auto-cura" a linha no servidor caso
// tenha sido removida por um envio falhado). Assume permissão concedida.
async function subscribeAndSave(): Promise<boolean> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
  }
  const json = sub.toJSON();
  const r = await savePushSubscription({
    endpoint: json.endpoint ?? "",
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  });
  return !!r?.ok;
}

// Soft prompt + auto-heal:
//  • permissão 'granted' mas sem subscrição (ex.: re-instalou a PWA) →
//    re-subscreve em silêncio, sem mostrar nada.
//  • permissão 'default' e não dispensado → mostra o card "Ativar".
//  • 'denied' → nada (tem de reativar nas definições do browser/iOS).
export function PushSubscribeCard() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return;

    if (Notification.permission === "granted") {
      subscribeAndSave().catch(() => {});
      return;
    }
    if (Notification.permission !== "default") return; // denied
    const last = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (last && Date.now() - last < DISMISS_TTL_MS) return;
    setShow(true);
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        if (perm === "denied") localStorage.setItem(DISMISS_KEY, String(Date.now()));
        setShow(false);
        return;
      }
      await subscribeAndSave();
      setShow(false);
    } catch {
      setShow(false);
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
      <div className="atua-pulse grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-400/15 text-gold-600 dark:text-gold-400">
        <Bell size={18} className="atua-bell-ring" />
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold">Ativar notificações</div>
        <div className="text-xs text-ink-500">Recebe lembretes e avisos mesmo com a app fechada.</div>
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
