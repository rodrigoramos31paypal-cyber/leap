import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

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

  // PERF (audit #1): verificação de sessão local em vez de round-trip
  // ao GoTrue. `getClaims()` valida a ASSINATURA do JWT em processo
  // quando o projecto usa signing keys assimétricas (ES256/RS256/EdDSA):
  // zero latência de rede no caminho crítico de cada request/prefetch.
  //
  // IMPORTANTE — pré-condição: enquanto os tokens forem assinados com o
  // segredo HS256 legacy, a auth-js faz fallback transparente para
  // getUser() (mesmo comportamento de hoje, sem regressão). O ganho de
  // performance só se materializa após migrar para signing keys
  // assimétricas no dashboard Supabase (Auth → JWT Keys → migrar p/ ECC).
  //
  // SEGURANÇA: ao contrário de descodificar o JWT à mão, getClaims()
  // verifica a assinatura criptográfica — não é forjável, fecha o
  // loophole do header `next-router-prefetch`.
  //
  // SESSÃO: getClaims() → getSession() → __loadSession() continua a
  // refrescar tokens expirados (_callRefreshToken) e o cookie adapter
  // re-escreve os cookies via setAll — o refresh de sessão mantém-se.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;
  const path = request.nextUrl.pathname;

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
    // iCal subscription feeds: autenticados pelo token UUID na URL.
    // iOS Calendar / Google Calendar não enviam cookies de sessão, e
    // o redirect para /login do middleware faz a validação falhar.
    path.startsWith("/api/calendar/feed") ||
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
