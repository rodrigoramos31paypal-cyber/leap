import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // SEC: usa `request.url` como base em vez de NEXT_PUBLIC_APP_URL.
  // Razões:
  //   1. Funciona em qualquer host (Vercel preview URLs, domínio
  //      custom, dev local) sem depender de env var bem definida.
  //   2. Bug anterior: se a env var não estivesse definida em
  //      produção, o fallback era `http://localhost:3000` → o
  //      browser tentava redirect para localhost (inexistente) e
  //      ficava parado no dashboard com cookies já invalidados.
  //      Visualmente o utilizador acha que continua logado.
  //
  // SEC: status 303 (em vez do default 307) força o browser a fazer
  // GET ao seguir o redirect. 307 preservaria o método POST, e a
  // landing page não trata POSTs.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
