import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { rateLimit, getRequestIp, type RateLimitKind } from "@/lib/rate-limit";

// ────────────────────────────────────────────────────────────────
// Rate limit map (H1) — path prefix → bucket kind.
// Ordem importa: o primeiro match ganha.
// ────────────────────────────────────────────────────────────────
const RATE_LIMITED: Array<{ test: (p: string) => boolean; kind: RateLimitKind }> = [
  { test: (p) => p === "/login" || p.startsWith("/login?"), kind: "auth" },
  { test: (p) => p.startsWith("/api/webhooks/"), kind: "webhook" },
  { test: (p) => p === "/registar" || p.startsWith("/registar?"), kind: "register" },
  { test: (p) => p === "/recuperar" || p.startsWith("/recuperar?"), kind: "register" },
  { test: (p) => p.startsWith("/auth/reset"), kind: "register" },
];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── Rate limit (H1) ───────────────────────────────────────────
  // Aplicado SEMPRE, antes da skip-prefetch e antes do updateSession.
  // Não queremos que um atacante use o header `next-router-prefetch`
  // para escapar ao limite.
  const bucket = RATE_LIMITED.find(({ test }) => test(path));
  if (bucket) {
    const ip = getRequestIp(request.headers);
    const r = await rateLimit(bucket.kind, `${path}:${ip}`);
    if (!r.success) {
      return new NextResponse("Too many requests", {
        status: 429,
        headers: {
          "Retry-After": String(r.retryAfterSeconds),
          "X-RateLimit-Limit": String(r.limit),
          "X-RateLimit-Remaining": "0",
        },
      });
    }
  }

  // PERF: prefetch RSC requests (next/link na bottom-nav, fired quando os
  // links entram em viewport) tambem passam por middleware. Nao ha motivo
  // para revalidar a sessao num prefetch — a navegacao real valida-a.
  // Saltamos directos.
  if (request.headers.get("next-router-prefetch") === "1") {
    return NextResponse.next();
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Excluimos: _next/static, _next/image, _next/data, favicon, robots,
    // manifest, sw.js, icons/, e binarios em /public
    "/((?!_next/static|_next/image|_next/data|favicon.ico|robots.txt|manifest.json|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$).*)",
  ],
};
