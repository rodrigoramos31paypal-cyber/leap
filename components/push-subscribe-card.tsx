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

// Soft prompt: aparece só quando o push é suportado, a permissão ainda
// não foi pedida, e o utilizador não dispensou recentemente.
export function PushSubscribeCard() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return;
    if (Notification.permission !== "default") return; // já concedeu/bloqueou
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
      const reg = await navigator.serviceWorker.ready;
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) {
        setShow(false);
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON();
      await savePushSubscription({
        endpoint: json.endpoint ?? "",
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
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
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-400/15 text-gold-600 dark:text-gold-400">
        <Bell size={18} />
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold">Ativar notificações</div>
        <div className="text-xs text-ink-500">Recebe lembretes e avisos mesmo com a app fechada.</div>
      </div>
      <button onClick={enable} disabled={busy} className="btn-gold shrink-0 text-xs">
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
