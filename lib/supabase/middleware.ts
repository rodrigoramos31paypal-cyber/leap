import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

export async function updateSession(request: NextRequest) {
  // expose pathname para server components que precisem dele (e.g. layouts).
  // BUG-FIX: tem de ser setado como REQUEST header para `headers()` em server
  // components o ver. Setar em `response.headers` só aparece no browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

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
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  // Public paths
  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/registar") ||
    path.startsWith("/recuperar") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/webhooks") ||
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
