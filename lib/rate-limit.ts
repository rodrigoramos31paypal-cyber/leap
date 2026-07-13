// ════════════════════════════════════════════════════════════════
// Rate limiting · H1 do audit de segurança (+ H2 hardening)
//
// Backend preferido: Upstash Redis via REST (Edge-compatible, partilha
// contadores entre regiões Vercel).
//
// H2: SEM Upstash configurado já NÃO é no-op. Caímos para um limiter
// IN-MEMORY por instância (sliding window). Protecção degradada (não
// partilhada entre instâncias serverless), mas eleva muito a fasquia
// vs. "sem limite" — e nunca bloqueia logins por misconfiguração
// (zero lockout). Configurar UPSTASH_* repõe o limiter distribuído.
//
// Buckets (req / minuto):
//   • auth     5    (login)
//   • register 3    (signup, password reset)
//   • webhook  60   (callbacks de webhooks; retries em rajada)
//   • export   30   (exportações CSV/XLSX — caras em CPU/memória)
//   • generic  30   (fallback)
// ════════════════════════════════════════════════════════════════
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitKind = "auth" | "register" | "webhook" | "export" | "generic";

type LimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Segundos até o bucket reabrir. */
  retryAfterSeconds: number;
};

// Limites centralizados — usados tanto pelo Upstash como pelo fallback.
const LIMITS: Record<RateLimitKind, { tokens: number; windowMs: number }> = {
  auth: { tokens: 5, windowMs: 60_000 },
  register: { tokens: 3, windowMs: 60_000 },
  webhook: { tokens: 60, windowMs: 60_000 },
  export: { tokens: 30, windowMs: 60_000 },
  generic: { tokens: 30, windowMs: 60_000 },
};

// ────────────────────────────────────────────────────────────────
// Upstash (distribuído) — lazy init, cached. null se env em falta.
// ────────────────────────────────────────────────────────────────
type LimiterMap = Record<RateLimitKind, Ratelimit>;
let cached: LimiterMap | null | undefined;
let warned = false;

function getLimiters(): LimiterMap | null {
  if (cached !== undefined) return cached;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production" && !warned) {
      warned = true;
      // ERRO (não warn): em produção sem Upstash usamos o fallback
      // in-memory por instância — protecção degradada. O on-call deve
      // configurar UPSTASH_* para repor o limiter distribuído.
      console.error(
        "[rate-limit] UPSTASH_* em falta — a usar fallback IN-MEMORY por instância (protecção degradada, não partilhada). Configura Upstash em produção.",
      );
    }
    cached = null;
    return null;
  }

  const redis = new Redis({ url, token });
  const mk = (kind: RateLimitKind, prefix: string) =>
    new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(LIMITS[kind].tokens, "1 m"),
      analytics: true,
      prefix,
    });
  cached = {
    auth: mk("auth", "rl:auth"),
    register: mk("register", "rl:register"),
    webhook: mk("webhook", "rl:webhook"),
    export: mk("export", "rl:export"),
    generic: mk("generic", "rl:generic"),
  };
  return cached;
}

// ────────────────────────────────────────────────────────────────
// Fallback IN-MEMORY (por instância) — usado só sem Upstash.
// Sliding window por chave. Não partilhado entre instâncias, mas
// determinístico, sem dependências e sem risco de lockout.
// ────────────────────────────────────────────────────────────────
const memStore = new Map<string, number[]>();

function inMemoryLimit(kind: RateLimitKind, key: string): LimitResult {
  const { tokens, windowMs } = LIMITS[kind];
  const now = Date.now();
  const bucketKey = `${kind}:${key}`;
  const fresh = (memStore.get(bucketKey) ?? []).filter((t) => now - t < windowMs);

  if (fresh.length >= tokens) {
    memStore.set(bucketKey, fresh);
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - fresh[0])) / 1000));
    return { success: false, limit: tokens, remaining: 0, retryAfterSeconds };
  }

  fresh.push(now);
  memStore.set(bucketKey, fresh);

  // Poda oportunista — limita memória em instâncias de vida longa.
  if (memStore.size > 5000) {
    for (const [k, v] of memStore) {
      const f = v.filter((t) => now - t < windowMs);
      if (f.length === 0) memStore.delete(k);
      else memStore.set(k, f);
    }
  }

  return { success: true, limit: tokens, remaining: tokens - fresh.length, retryAfterSeconds: 0 };
}

/**
 * Verifica se o pedido com a chave indicada está dentro do limite do
 * `kind`. A `key` é normalmente IP+endpoint ou userId+endpoint.
 *
 * H2: sem Upstash, usa o fallback in-memory (NÃO é mais no-op).
 */
export async function rateLimit(kind: RateLimitKind, key: string): Promise<LimitResult> {
  const limiters = getLimiters();
  if (!limiters) return inMemoryLimit(kind, key);

  const limiter = limiters[kind];
  const { success, limit, remaining, reset } = await limiter.limit(key);
  const retryAfterSeconds = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
  return { success, limit, remaining, retryAfterSeconds };
}

/**
 * Nº de reverse-proxies DE CONFIANÇA à frente da app.
 *
 * No self-host (Coolify/Traefik) há exatamente 1 proxy (o Traefik) à frente,
 * por isso o IP REAL do cliente é o ÚLTIMO valor que o Traefik acrescentou a
 * `x-forwarded-for`. Se puseres uma CDN/WAF à frente do Traefik (ex.:
 * Cloudflare), aumenta este valor para o nº total de proxies de confiança
 * (2, 3, …) definindo `TRUSTED_PROXY_HOPS` no ambiente.
 */
const TRUSTED_PROXY_HOPS = (() => {
  const n = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
})();

/**
 * Devolve o IP do cliente para chave de rate-limit, de forma resistente a
 * spoofing atrás de um reverse-proxy.
 *
 * H-1 (audit jul/2026): a versão anterior só confiava em
 * `x-vercel-forwarded-for` e devolvia a constante `"no-trusted-ip"` em
 * qualquer produção não-Vercel. No deploy real (Coolify/Traefik) esse header
 * NUNCA existe → todos os pedidos partilhavam o MESMO bucket global e o
 * anti-brute-force ficava efetivamente desligado (além de risco de auto-DoS).
 *
 * Modelo de confiança (porque é resistente a spoofing):
 *   • `x-forwarded-for` é uma lista `cliente, proxy1, proxy2, …`. Cada proxy
 *     de confiança ACRESCENTA à DIREITA o IP de quem lhe abriu a ligação. Um
 *     atacante só controla o que envia no SEU pedido, ou seja valores à
 *     ESQUERDA. Logo, o valor a `TRUSTED_PROXY_HOPS` posições a contar da
 *     DIREITA é o IP fidedigno observado pelo proxy mais externo de confiança.
 *     Isto NÃO depende de o Traefik reescrever o header (só de o acrescentar,
 *     que é o comportamento por omissão).
 *
 * Ordem de preferência:
 *   1. `x-vercel-forwarded-for` (não forjável; mantido caso se migre p/ Vercel).
 *   2. `x-forwarded-for` → valor à direita segundo `TRUSTED_PROXY_HOPS`.
 *   3. `x-real-ip` (Traefik/nginx podem defini-lo com o IP da ligação TCP).
 *   4. Fail-closed: `"no-trusted-ip"` (bucket global apertado; nunca ABRE
 *      o brute-force, apenas o restringe).
 *
 * ATENÇÃO à config do proxy: garante no Traefik que os `forwardedHeaders`
 * NÃO são de confiança para clientes arbitrários (não exponhas a app
 * diretamente, sem o Traefik à frente). Com o Traefik como edge, o append
 * do IP real é automático e o modelo acima é seguro.
 */
export function getRequestIp(headers: Headers): string {
  // 1) Vercel edge — não forjável.
  const vercel = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;

  // 2) Self-host atrás de Traefik/Coolify: contar da DIREITA.
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - TRUSTED_PROXY_HOPS);
      const ip = parts[idx];
      if (ip) return ip;
    }
  }

  // 3) IP da ligação TCP escrito pelo proxy.
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;

  // 4) Sem fonte de confiança → fail-closed (bucket global apertado;
  //    nunca ABRE o brute-force, apenas o restringe a um contador único).
  return "no-trusted-ip";
}
