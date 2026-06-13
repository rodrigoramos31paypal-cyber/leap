// ════════════════════════════════════════════════════════════════
// Web Push · envio server-side via web-push (VAPID).
// Configurado por env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Se faltarem, pushConfigured() devolve false e o envio é no-op.
// ════════════════════════════════════════════════════════════════
import webpush from "web-push";

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function ensureVapid() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:no-reply@leap-fitness.pt",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

export type StoredSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendPush(
  sub: StoredSubscription,
  payload: { title: string; body: string; url?: string },
): Promise<{ ok: boolean; gone?: boolean }> {
  if (!pushConfigured()) return { ok: false };
  ensureVapid();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (e: any) {
    const code = e?.statusCode;
    // 404/410 → subscrição expirada/cancelada: o caller deve apagá-la.
    if (code === 404 || code === 410) return { ok: false, gone: true };
    return { ok: false };
  }
}
