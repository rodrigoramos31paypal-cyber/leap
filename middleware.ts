import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
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
