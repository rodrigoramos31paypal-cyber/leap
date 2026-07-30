import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearTrustedDevice } from "@/lib/mfa";
import { publicBaseUrl } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Force-logout · destino dos layouts quando a conta está bloqueada
// (access_blocked = true → ban ou conta apagada). 0120.
//
// Porquê uma ROTA e não signOut no layout: um Server Component não
// consegue escrever cookies (o cookie adapter do supabase server client
// é no-op em SC — ver lib/supabase/server.ts). Um Route Handler PODE
// limpar os cookies de sessão. Os layouts fazem redirect("/auth/
// force-logout"); aqui terminamos a sessão e mandamos para /login.
//
// GET (não POST) porque o redirect de um layout é uma navegação GET.
// O path está sob /auth → isPublic no middleware, logo é alcançável
// mesmo com (ou sem) sessão.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // M13: esta rota altera estado (termina a sessão). É GET porque os
  // redirects dos layouts/middleware são navegações GET same-origin. Um
  // `<img src=".../auth/force-logout">` externo tem sec-fetch-site=cross-site
  // — recusamos esse vetor de logout-CSRF sem quebrar os redirects internos.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.redirect(new URL("/", publicBaseUrl(request)), {
      status: 303,
    });
  }

  const supabase = await createClient();
  // signOut local: invalida o refresh token desta sessão e limpa os
  // cookies sb-*. (O ban no GoTrue já impede troca de refresh tokens
  // noutros dispositivos; o gate por-request trata-os na próxima ação.)
  await supabase.auth.signOut().catch(() => {});
  // M2: limpa também o trusted-device (cookie + registo na BD).
  await clearTrustedDevice().catch(() => {});

  // Base = domínio público de confiança (NEXT_PUBLIC_APP_URL). NÃO usar o
  // origin do request.url: atrás do proxy resolve para localhost:3000 e o
  // redirect aterra num host inexistente. Ver publicBaseUrl.
  const url = new URL("/login", publicBaseUrl(request));
  url.searchParams.set("error", "A tua conta foi bloqueada. Contacta o estúdio.");
  // 303 → o browser faz GET ao seguir o redirect.
  return NextResponse.redirect(url, { status: 303 });
}
