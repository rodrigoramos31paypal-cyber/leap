import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { rateLimit, getRequestIp, type RateLimitKind } from "@/lib/rate-limit";
import { generateNonce, applyCsp } from "@/lib/security-headers";

// ────────────────────────────────────────────────────────────────
// Rate limit map (H1) — path prefix + método → bucket kind.
// Ordem importa: o primeiro match ganha.
//
// IMPORTANTE: os endpoints de auth são limitados APENAS em POST.
// GET serve só para renderizar o formulário e o browser faz isso
// (incluindo prefetches RSC) sem qualquer acção do utilizador. Se
// contássemos GETs, qualquer navegação esgotava o bucket e a
// página de login deixava de carregar.
//
// Webhooks (se existirem) são limitados em qualquer método — alguns
// providers chamam tanto em GET como em POST com payload idêntico.
// ────────────────────────────────────────────────────────────────
type RateRule = {
  test: (path: string, method: string) => boolean;
  kind: RateLimitKind;
};

const isPostOnly = (path: string) =>
  (p: string, m: string) => m === "POST" && (p === path || p.startsWith(`${path}?`) || p.startsWith(`${path}/`));

const RATE_LIMITED: RateRule[] = [
  // Webhooks — qualquer método
  { test: (p) => p.startsWith("/api/webhooks/"), kind: "webhook" },
  // Auth attempts — só POST
  { test: isPostOnly("/login"), kind: "auth" },
  { test: isPostOnly("/registar"), kind: "register" },
  { test: isPostOnly("/recuperar"), kind: "register" },
  { test: isPostOnly("/auth/reset"), kind: "register" },
  // H-3 (audit jun/2026): coverage gaps. Endpoints autenticados que
  // permitem enumeração / DoS por chamadas em rajada. Bucket `generic`
  // (30 req/min) é generoso para uso normal e suficiente para travar
  // scraping/abuso. Chave inclui o path para que diferentes endpoints
  // não dividam o mesmo bucket.
  { test: (p) => p === "/api/slots" || p.startsWith("/api/slots?"), kind: "generic" },
  { test: (p) => p.startsWith("/api/bookings/") && p.endsWith("/ics"), kind: "generic" },
  { test: (p, m) => m === "POST" && p === "/api/notifications/read", kind: "generic" },
];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── Rate limit (H1) ───────────────────────────────────────────
  // Aplicado SEMPRE, antes do updateSession. Não queremos que um
  // atacante use o header `next-router-prefetch` para escapar.
  const bucket = RATE_LIMITED.find(({ test }) => test(path, request.method));
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

  // H2: gera nonce CSP por request. O nonce viaja:
  //   • via request header `x-nonce` → server components (layout)
  //     leem-no com `headers()` e aplicam ao `<script>` inline.
  //   • via response header CSP `script-src 'nonce-X' 'strict-dynamic'`
  //     → browser executa só scripts com o nonce certo (e os que eles
  //     carregam, via strict-dynamic).
  const nonce = generateNonce();

  // H3 (audit): ANTERIORMENTE saltávamos `updateSession` se o header
  // `next-router-prefetch: 1` estivesse presente, por motivos de PERF.
  // PROBLEMA: o header é trivialmente forjável — um atacante com
  // `curl -H "next-router-prefetch: 1"` escapava completamente à
  // validação de sessão no middleware. Rotas sem layout (server
  // actions, API routes) ficavam dependentes só do auth check
  // interno; RSC streams pré-renderizados podiam ser servidos sem
  // a sessão ser revalidada.
  //
  // Decisão: corremos sempre o `updateSession`. O custo é uma chamada
  // ao Supabase auth server por request, com React `cache()` a
  // deduplicar dentro do mesmo request. Para o volume do LEAP, é
  // negligível comparado com o ganho de segurança.
  const response = await updateSession(request, { "x-nonce": nonce });
  return applyCsp(response, nonce);
}

export const config = {
  matcher: [
    // Excluimos: _next/static, _next/image, _next/data, favicon, robots,
    // manifest, sw.js, icons/, e binarios em /public
    "/((?!_next/static|_next/image|_next/data|favicon.ico|robots.txt|manifest.json|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$).*)",
  ],
};
