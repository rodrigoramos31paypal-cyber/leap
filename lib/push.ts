// ════════════════════════════════════════════════════════════════
// Web Push · envio server-side via web-push (VAPID).
// Configurado por env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// Se faltarem, pushConfigured() devolve false e o envio é no-op.
// ════════════════════════════════════════════════════════════════
import webpush from "web-push";

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

// web-push exige um subject `mailto:` ou `https://`. Um email "simples"
// (ex.: geral@dominio.pt) faz setVapidDetails() rebentar. Normalizamos
// para nunca crashar por causa disto.
function normalizeSubject(raw?: string): string {
  const v = (raw || "").trim();
  if (!v) return "mailto:no-reply@leap-fitness.pt";
  if (v.startsWith("mailto:") || v.startsWith("http://") || v.startsWith("https://")) return v;
  return "mailto:" + v;
}

let configured = false;
function ensureVapid() {
  if (configured) return;
  webpush.setVapidDetails(
    normalizeSubject(process.env.VAPID_SUBJECT),
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
  payload: { title: string; body: string; url?: string; id?: string },
): Promise<{ ok: boolean; gone?: boolean }> {
  if (!pushConfigured()) return { ok: false };
  try {
    // ensureVapid() DENTRO do try: subject/keys inválidos devolvem ok:false
    // em vez de propagar e dar 500 na rota (era o bug — log mostrava 500).
    ensureVapid();
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
