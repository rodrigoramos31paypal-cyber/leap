import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearTrustedDevice } from "@/lib/mfa";
import { publicBaseUrl } from "@/lib/utils";

export async function POST(request: NextRequest) {
  // M13: recusa POSTs cross-site (form auto-submit noutro site → logout CSRF).
  // O botão de logout da app envia sec-fetch-site=same-origin. Header ausente
  // (cliente antigo) → deixamos passar (fail-open; impacto é baixo).
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  // M2: o "confiar neste dispositivo" não deve sobreviver ao logout num
  // computador partilhado — limpamos cookie + registo na BD.
  await clearTrustedDevice().catch(() => {});

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
