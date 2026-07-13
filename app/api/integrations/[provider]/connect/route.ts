import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { buildAuthUrl, googleEnabled, microsoftEnabled } from "@/lib/calendar-sync";

const STATE_COOKIE = "oauth_state";

export async function GET(_req: Request, props: { params: Promise<{ provider: string }> }) {
  const params = await props.params;
  const provider = params.provider as "google" | "microsoft";
  if (provider !== "google" && provider !== "microsoft") {
    return new NextResponse("Bad provider", { status: 400 });
  }
  if (provider === "google" && !googleEnabled()) {
    return new NextResponse("Google OAuth não configurado (ver GOOGLE_OAUTH_CLIENT_ID).", { status: 503 });
  }
  if (provider === "microsoft" && !microsoftEnabled()) {
    return new NextResponse("Microsoft OAuth não configurado (ver MICROSOFT_OAUTH_CLIENT_ID).", { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", _req.url));

  // M-6 (audit jun/2026): least privilege — só staff (trainer/owner) liga
  // calendários. A sync de calendário só faz sentido para staff; sem este
  // gate, qualquer cliente autenticado podia guardar tokens OAuth de
  // Google/Microsoft contra a sua própria conta.
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (prof?.role !== "trainer" && prof?.role !== "owner") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // SEC: state = nonce aleatório (256 bits). Guardamos `userId:provider:nonce`
  // num cookie HTTP-only de curta duração, e enviamos só o nonce ao OAuth.
  // No callback validamos que o cookie existe, o nonce bate certo e o
  // user logado é o mesmo. Isto bloqueia CSRF — antes o "state" era só
  // o userId em base64, completamente forjável por terceiros.
  const nonce = randomBytes(32).toString("base64url");
  (await cookies()).set(STATE_COOKIE, `${user.id}:${provider}:${nonce}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutos
    path: "/",
  });

  return NextResponse.redirect(buildAuthUrl(provider, nonce));
}
