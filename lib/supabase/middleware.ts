import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

// ────────────────────────────────────────────────────────────────
// PERF (CB-2 audit jun/2026): cache do resultado de getClaims() por
// fingerprint do cookie de auth durante 30 s. Sem isto, cada prefetch
// RSC (5+ por página com nav) dispara um getClaims() — e mesmo sendo
// "local" para tokens assimétricos, em HS256 (default) faz round-trip
// ao auth server.
//
// Segurança: o cookie é o input — se mudar (logout, refresh do token
// pelo cookie adapter), a chave de cache muda automaticamente. O TTL
// curto (30 s) é mais um cap defensivo do que necessário.
//
// Estado por instância edge (V8 isolate). Sem partilha entre instâncias
// — está OK porque é só um cache de hot path com TTL minúsculo.
// ────────────────────────────────────────────────────────────────
type ClaimsCacheEntry = { claims: any; expiresAt: number };
const claimsCache = new Map<string, ClaimsCacheEntry>();
const CLAIMS_TTL_MS = 30_000;

function claimsKey(request: NextRequest): string | null {
  const parts: string[] = [];
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith("sb-") && c.name.includes("auth-token")) {
      parts.push(`${c.name}=${c.value}`);
    }
  }
  if (parts.length === 0) return null;
  return parts.sort().join("|");
}

function pruneClaimsCache(now: number) {
  if (claimsCache.size <= 500) return;
  for (const [k, v] of claimsCache) if (v.expiresAt <= now) claimsCache.delete(k);
}

export async function updateSession(
  request: NextRequest,
  extraRequestHeaders?: Record<string, string>,
) {
  // expose pathname para server components que precisem dele (e.g. layouts).
  // BUG-FIX: tem de ser setado como REQUEST header para `headers()` em server
  // components o ver. Setar em `response.headers` só aparece no browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  // H2: o nonce CSP é propagado via header para o layout poder lê-lo
  // através de `headers()` e aplicar ao `<script>` inline do SW.
  if (extraRequestHeaders) {
    for (const [k, v] of Object.entries(extraRequestHeaders)) {
      requestHeaders.set(k, v);
    }
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-pathname", request.nextUrl.pathname);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.headers.set("x-pathname", request.nextUrl.pathname);
          // H2: re-aplica nonce também aqui — `NextResponse.next` reseta
          // os response headers, portanto temos de re-setar tudo.
          if (extraRequestHeaders?.["x-nonce"]) {
            response.headers.set("x-nonce", extraRequestHeaders["x-nonce"]);
          }
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const path = request.nextUrl.pathname;

  // PERF (C1): rotas públicas autenticadas por segredo/token NO PRÓPRIO
  // handler (CRON_SECRET, assinatura de webhook, token UUID do feed iCal)
  // nunca trazem sessão de utilizador. Saltamos getClaims() por completo —
  // em HS256 cada invocação de cron/webhook/push custava um round-trip ao
  // GoTrue sem qualquer benefício. (Estas rotas já estavam em `isPublic`,
  // por isso o comportamento de auth não muda; só deixamos de pagar a call.)
  if (
    path.startsWith("/api/cron") ||
    path.startsWith("/api/push") ||
    path.startsWith("/api/webhooks") ||
    path.startsWith("/api/calendar/feed")
  ) {
    return response;
  }

  // PERF (audit #1 + CB-2 jun/2026): verificação de sessão local +
  // memoização por cookie. `getClaims()` valida o JWT em processo (ou
  // faz fallback para getUser em HS256 legacy). O cache por
  // fingerprint do cookie evita N round-trips quando há N prefetches
  // RSC com o mesmo cookie.
  //
  // SEGURANÇA: o cookie é a chave; se for revogado/refrescado, a chave
  // muda automaticamente. TTL de 30 s é um cap defensivo extra.
  //
  // SESSÃO: getClaims() → getSession() → __loadSession() continua a
  // refrescar tokens expirados; o cache não previne o refresh, só
  // evita re-validar a mesma chave dentro do TTL.
  const now = Date.now();
  const key = claimsKey(request);
  let user: any = null;
  if (key) {
    const cached = claimsCache.get(key);
    if (cached && cached.expiresAt > now) {
      user = cached.claims;
    } else {
      const { data: claimsData } = await supabase.auth.getClaims();
      user = claimsData?.claims ?? null;
      if (user) {
        claimsCache.set(key, { claims: user, expiresAt: now + CLAIMS_TTL_MS });
        pruneClaimsCache(now);
      }
    }
  } else {
    const { data: claimsData } = await supabase.auth.getClaims();
    user = claimsData?.claims ?? null;
  }

  // Public paths
  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/registar") ||
    path.startsWith("/recuperar") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/webhooks") ||
    // Cron de lembretes: protegido por CRON_SECRET no próprio route, não
    // por sessão. Sem isto o middleware redirecionava-o para /login.
    path.startsWith("/api/cron") ||
    // Push dispatch (Supabase webhook) — protegido por CRON_SECRET no route.
    path.startsWith("/api/push") ||
    // iCal subscription feeds: autenticados pelo token UUID na URL.
    // iOS Calendar / Google Calendar não enviam cookies de sessão, e
    // o redirect para /login do middleware faz a validação falhar.
    path.startsWith("/api/calendar/feed") ||
    // .ics de UMA marcação ("Adicionar ao calendário"): o iOS busca o
    // ficheiro sem cookies → sem isto era redirecionado para /login. A
    // rota valida um token HMAC na URL (ver lib/calendar-token).
    (path.startsWith("/api/bookings/") && path.endsWith("/ics")) ||
    // Página pública do trainer (/t/<slug>) — indexável e partilhável.
    // Sem isto, utilizadores anónimos eram redirecionados para /login.
    path.startsWith("/t/") ||
    path.startsWith("/manifest.json") ||
    path.startsWith("/sw.js") ||
    path.startsWith("/icons");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // PERF: role-based protection é enforced nos proprios layouts
  // (app/admin/layout.tsx e app/app/layout.tsx). Manter aqui era uma
  // query extra ao Supabase em cada navegacao e cada prefetch RSC.
  // Layouts redirecionam de qualquer forma; aqui so validamos o cookie.

  return response;
}
