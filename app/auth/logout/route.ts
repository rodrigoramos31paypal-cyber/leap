import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicBaseUrl } from "@/lib/utils";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Base = domínio público de confiança (NEXT_PUBLIC_APP_URL), com fallback
  // para o origin do request. NÃO usar só `request.url`: atrás do proxy
  // resolve para `http://localhost:3000` e o browser tentava redirect para
  // um host inexistente, ficando parado no dashboard com cookies já
  // invalidados (utilizador parece continuar logado). Ver publicBaseUrl.
  //
  // SEC: status 303 (em vez do default 307) força o browser a fazer GET ao
  // seguir o redirect. 307 preservaria o método POST, e a landing page não
  // trata POSTs.
  return NextResponse.redirect(new URL("/", publicBaseUrl(request)), {
    status: 303,
  });
}
