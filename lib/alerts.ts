// ════════════════════════════════════════════════════════════════
// Alerting · #8 do hardening estrutural
//
// Seam único para sinais de segurança/integridade que merecem alerta
// activo (não só uma linha perdida nos logs). Hoje funciona sem
// dependências externas; é "plug-and-play" para Sentry/PostHog.
//
// Como ligar um provider:
//   • Sentry  → instala @sentry/nextjs e chama Sentry.captureMessage(
//               event, { level, extra: context }) dentro de captureAlert.
//   • PostHog → posthog.capture({ event, properties: context }).
//   • Genérico/Slack → define ALERT_WEBHOOK_URL (Slack/Discord/webhook
//               Sentry) e o POST abaixo trata do envio.
//
// Por omissão emite sempre um log estruturado com prefixo "[ALERT]",
// fácil de casar num log-drain (Vercel, Better Stack, Sentry Logs).
//
// Garantia: NUNCA lança. Um alerta que falha não pode partir o fluxo
// que o disparou — todas as chamadas são best-effort.
// ════════════════════════════════════════════════════════════════
import { logError } from "@/lib/errors";

export type AlertLevel = "warning" | "error" | "fatal";

export type AlertContext = Record<string, unknown> & { level?: AlertLevel };

/**
 * Regista/dispara um alerta. `event` é um identificador estável
 * (ex. "admin_access_denied") para agrupar no provider.
 */
export async function captureAlert(event: string, context: AlertContext = {}): Promise<void> {
  const { level = "error", ...rest } = context;
  const record = {
    event,
    level,
    at: new Date().toISOString(),
    ...rest,
  };

  // 1) Log estruturado — sempre. Greppable por "[ALERT]".
  console.error(`[ALERT] ${event}`, JSON.stringify(record));

  // 2) Webhook opcional (Slack/Discord/Sentry tunnel). Fire-and-forget.
  const url = process.env.ALERT_WEBHOOK_URL;
  if (url) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `🚨 [${level}] ${event}`, ...record }),
        cache: "no-store",
      });
    } catch (e) {
      // Não propagar: o alerta é best-effort.
      logError(`captureAlert:${event}`, e);
    }
  }
}

/**
 * Heurística para detectar o erro "access denied" (errcode 42501)
 * devolvido pelos guards SQL `_is_service_or_admin()` / scope checks.
 * Usada para alertar quando uma acção de admin é recusada — sinal de
 * tentativa indevida ou de bug de permissões. (#8b)
 */
export function isAccessDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "42501") return true;
  return typeof e.message === "string" && /access denied/i.test(e.message);
}
