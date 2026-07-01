"use client";

import { savePushSubscription } from "@/lib/notification-actions";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Chamado quando o utilizador LIGA o push nas preferências. Ao contrário do
// auto-heal (que reutiliza a subscrição existente), aqui forçamos uma
// subscrição FRESCA: uma subscrição antiga pode ter morrido em silêncio
// (o browser/OS rotam ou expiram a subscrição — comum em iOS PWA passados
// uns dias) e o servidor tê-la-ia apagado no primeiro 410. Sem isto, voltar
// a ligar o push só mexia na flag de preferência e a entrega continuava
// morta — era exactamente o bug do "liguei outra vez e não recebo push".
export async function enablePushForToggle(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return false;
  }
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return false;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") return false;

    const reg = await navigator.serviceWorker.ready;
    // Descarta a subscrição antiga (possivelmente morta) e cria uma nova,
    // garantindo um endpoint válido no servidor.
    const old = await reg.pushManager.getSubscription();
    if (old) {
      try {
        await old.unsubscribe();
      } catch {
        /* ignora: seguimos para criar uma nova */
      }
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    const json = sub.toJSON();
    const r = await savePushSubscription({
      endpoint: json.endpoint ?? "",
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    });
    return !!r?.ok;
  } catch {
    return false;
  }
}

// Auto-heal (corre a cada abertura da app, via <PushAutoHeal/> no layout).
// Ao contrário do enablePushForToggle, NÃO força uma subscrição nova:
// reutiliza a existente se houver, ou cria uma se o browser/OS a largou
// (ex.: iOS passados uns dias sem abrir a app) e volta a gravá-la no
// servidor — repondo a linha em push_subscriptions que o dispatch possa
// ter apagado após um 410. É a rede de segurança para iOS, onde o evento
// pushsubscriptionchange pode nem sequer disparar.
export async function healPushSubscription(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return false;
  }
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return false;
  if (Notification.permission !== "granted") return false; // sem prompt aqui
  try {
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
  } catch {
    return false;
  }
}
