import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safePathOr } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // SEC (C3): mesmo que `${origin}${next}` aterre quase sempre no
  // próprio host, tratar `next` como path puro elimina ambiguidade
  // (`//evil.com`, `\\evil.com`, schemes). safePathOr garante um
  // fallback seguro se o input for malicioso ou vazio.
  const next = safePathOr(searchParams.get("next"), "/app/dashboard");

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, origin));
}
