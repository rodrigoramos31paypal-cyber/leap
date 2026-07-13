// ════════════════════════════════════════════════════════════════
// Comparações constant-time de segredos.
//
// QW-6 (audit jun/2026): centraliza o helper que estava só no callback
// OAuth (app/api/integrations/[provider]/callback/route.ts) para os
// handlers de cron e push o reutilizarem em vez de `header === bearer`.
//
// Não muda o threat model significativamente — o atacante teria de
// medir µs de diferença num endpoint internet-exposto, e a função sai
// cedo por length-mismatch — mas é trivial usar a primitiva certa e
// evita um false negative em auditoria automática.
// ════════════════════════════════════════════════════════════════
import { timingSafeEqual } from "crypto";

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Verifica um header `Authorization: Bearer <secret>` contra a env
 *  esperada. Devolve true só se houver match exacto. */
export function verifyBearer(authHeader: string | null, expectedSecret: string | undefined): boolean {
  if (!authHeader || !expectedSecret) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  return safeEqual(authHeader.slice(prefix.length), expectedSecret);
}
