import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicBaseUrl, safePathOr } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // SEC (C3): mesmo que `${base}${next}` aterre quase sempre no
  // próprio host, tratar `next` como path puro elimina ambiguidade
  // (`//evil.com`, `\\evil.com`, schemes). safePathOr garante um
  // fallback seguro se o input for malicioso ou vazio.
  const next = safePathOr(searchParams.get("next"), "/app/dashboard");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
    // 0138: acabou de verificar o email → se a conta está pendente, avisa a
    // equipa (uma vez). Best-effort: nunca parte o fluxo de confirmação.
    await (supabase as any).rpc("notify_pending_approval").catch(() => {});
  }

  // Base = domínio público de confiança (NEXT_PUBLIC_APP_URL). NÃO usar o
  // origin do request.url: atrás do proxy resolve para localhost:3000 e o
  // utilizador era empurrado para um host inexistente. Ver publicBaseUrl.
  return NextResponse.redirect(new URL(next, publicBaseUrl(request)));
}
