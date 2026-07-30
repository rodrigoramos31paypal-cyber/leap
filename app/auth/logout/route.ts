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

  // ACH-1 (audit jul/2026): num dispositivo PARTILHADO (ex.: tablet da
  // recepção) a subscrição de push sobrevivia ao logout — o push_dispatch
  // continuava a entregar notificações do utilizador que saiu ao endpoint
  // do browser, expondo nome/hora de sessão no ecrã de bloqueio ao próximo
  // utilizador. Apagamos as subscrições ANTES do signOut (a RLS
  // `push_subs_delete` exige user_id = auth.uid(), por isso tem de correr
  // com a sessão ainda válida). O unsubscribe no browser é feito no cliente
  // (components/logout-button.tsx). Best-effort: nunca bloqueia o logout.
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await (supabase as any)
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .then(() => {}, () => {});
  }

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
