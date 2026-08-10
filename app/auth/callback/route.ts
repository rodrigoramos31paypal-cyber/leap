import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicBaseUrl, safePathOr } from "@/lib/utils";
import { logError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // SEC (C3): tratar `next` como path puro elimina ambiguidade
  // (`//evil.com`, `\\evil.com`, schemes). safePathOr garante fallback seguro.
  const next = safePathOr(searchParams.get("next"), "/app/dashboard");

  // Base = domínio público de confiança (NEXT_PUBLIC_APP_URL). NÃO usar o
  // origin do request.url: atrás do proxy resolve para localhost:3000.
  const base = publicBaseUrl(request);

  // Sem código não há nada a trocar — segue o fluxo normal.
  if (!code) {
    return NextResponse.redirect(new URL(next, base));
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    // O link de confirmação já VERIFICA o email no lado do Supabase (é isso
    // que dispara o aviso à equipa). Se aqui não conseguirmos criar a sessão
    // — link já usado, expirado, ou aberto noutro dispositivo/browser sem o
    // cookie PKCE — NÃO rebentamos com 500. Mandamos para o login com uma
    // mensagem simpática a confirmar que o email ficou verificado.
    if (error) {
      logError("auth/callback:exchange", error);
      return NextResponse.redirect(new URL("/login?verificado=1", base));
    }

    // Rede de segurança (idempotente com o trigger de verificação 0145).
    await (supabase as any).rpc("notify_pending_approval").catch(() => {});

    // Contas por aprovar → ecrã de espera amigável, direto (evita passar
    // pelo dashboard só para o layout reencaminhar). Aprovadas → `next`.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("role, approval_status")
        .eq("id", user.id)
        .maybeSingle();
      if (
        (prof as any)?.role === "client" &&
        (prof as any)?.approval_status === "pending"
      ) {
        return NextResponse.redirect(new URL("/aprovacao-pendente", base));
      }
    }

    return NextResponse.redirect(new URL(next, base));
  } catch (e) {
    // Qualquer falha inesperada → nunca 500 na cara do cliente.
    logError("auth/callback", e);
    return NextResponse.redirect(new URL("/login?verificado=1", base));
  }
}
