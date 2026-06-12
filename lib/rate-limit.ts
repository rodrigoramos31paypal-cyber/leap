// ════════════════════════════════════════════════════════════════
// Rate limiting · H1 do audit de segurança
//
// Backend: Upstash Redis via REST (funciona em Edge runtime, partilha
// contadores entre regiões Vercel). Se as env vars não estiverem
// definidas, o limiter degrada para no-op — útil em dev local sem
// conta Upstash.
//
// Buckets diferenciados por kind:
//   • auth      — 5 req/min (login)
//   • register  — 3 req/min (signup, password reset)
//   • webhook   — 60 req/min (IfthenPay callbacks; relaxado porque
//                 retries legítimos podem aparecer em rajada)
//   • generic   — 30 req/min (fallback)
//
// Uso (no middleware ou route handler):
//   const r = await rateLimit("auth", `login:${ip}`);
//   if (!r.success) return new Response("Too many requests", {
//     status: 429,
//     headers: { "Retry-After": String(r.retryAfterSeconds) }
//   });
// ════════════════════════════════════════════════════════════════
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitKind = "auth" | "register" | "webhook" | "generic";

type LimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Segundos até o bucket reabrir. */
  retryAfterSeconds: number;
};

// ────────────────────────────────────────────────────────────────
// Lazy init dos limiters — só na primeira chamada, e cached.
// Sem env vars → null → no-op em todas as chamadas.
// ────────────────────────────────────────────────────────────────
type LimiterMap = Record<RateLimitKind, Ratelimit>;
let cached: LimiterMap | null | undefined;

function getLimiters(): LimiterMap | null {
  if (cached !== undefined) return cached;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    // Log uma vez na cold start para o developer perceber que está
    // a correr sem proteção. Em produção, Vercel logs apanham isto
    // e o on-call vê imediatamente.
    if (process.env.NODE_ENV === "production") {
      console.warn("[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN não definidos — rate limiting DESACTIVADO.");
    }
    cached = null;
    return null;
  }

  const redis = new Redis({ url, token });
  cached = {
    auth: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      analytics: true,
      prefix: "rl:auth",
    }),
    register: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "1 m"),
      analytics: true,
      prefix: "rl:register",
    }),
    webhook: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      analytics: true,
      prefix: "rl:webhook",
    }),
    generic: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "1 m"),
      analytics: true,
      prefix: "rl:generic",
    }),
  };
  return cached;
}

/**
 * Verifica se o pedido com a chave indicada está dentro do limite
 * configurado para o `kind`. A `key` é normalmente IP+endpoint
 * (ex. `login:1.2.3.4`); usar IP-apenas é mais agressivo (afecta
 * todos os endpoints partilhados).
 *
 * Se Upstash não estiver configurado, devolve sempre success=true
 * (no-op) — não vamos partir a app porque ainda não criámos a conta.
 */
export async function rateLimit(kind: RateLimitKind, key: string): Promise<LimitResult> {
  const limiters = getLimiters();
  if (!limiters) {
    return { success: true, limit: Infinity, remaining: Infinity, retryAfterSeconds: 0 };
  }

  const limiter = limiters[kind];
  const { success, limit, remaining, reset } = await limiter.limit(key);
  // reset = epoch ms quando o bucket abre
  const retryAfterSeconds = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
  return { success, limit, remaining, retryAfterSeconds };
}

/**
 * Devolve o IP do request a partir de headers que o Vercel define.
 * Fallback "anon" para dev local. Note que `x-forwarded-for` pode
 * ter múltiplos IPs (cliente, proxy1, proxy2…) — o primeiro é o
 * cliente real na convenção do Vercel.
 */
export function getRequestIp(headers: Headers): string {
  return (
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "anon"
  );
}
