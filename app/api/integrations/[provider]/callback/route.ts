import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "crypto";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { exchangeCode } from "@/lib/calendar-sync";

const STATE_COOKIE = "oauth_state";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const provider = params.provider as "google" | "microsoft";
  if (provider !== "google" && provider !== "microsoft") {
    return new NextResponse("Bad provider", { status: 400 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/admin/definicoes?integration_error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code || !state) return new NextResponse("Missing code/state", { status: 400 });

  // SEC: valida nonce contra o cookie set no /connect (CSRF).
  const cookieJar = cookies();
  const stored = cookieJar.get(STATE_COOKIE)?.value;
  if (!stored) {
    return NextResponse.redirect(new URL("/admin/definicoes?integration_error=state_missing", req.url));
  }
  // consome o cookie de imediato — single-use
  cookieJar.delete(STATE_COOKIE);

  const [storedUserId, storedProvider, storedNonce] = stored.split(":");
  if (!storedUserId || !storedProvider || !storedNonce) {
    return new NextResponse("Bad state", { status: 400 });
  }
  if (storedProvider !== provider) {
    return new NextResponse("Provider mismatch", { status: 400 });
  }
  if (!safeEqual(storedNonce, state)) {
    return new NextResponse("State mismatch", { status: 400 });
  }

  // valida que o user logado é o mesmo que iniciou o fluxo
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== storedUserId) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const userId = storedUserId;

  try {
    const tokens = await exchangeCode(provider, code);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

    const admin = createAdminClient();
    await admin
      .from("calendar_integrations")
      .upsert(
        {
          user_id: userId,
          provider,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken ?? null,
          token_expires_at: expiresAt,
          calendar_id: "primary",
        },
        { onConflict: "user_id,provider" },
      );

    return NextResponse.redirect(new URL("/admin/definicoes?integration_ok=1", req.url));
  } catch (err: any) {
    return NextResponse.redirect(
      new URL(`/admin/definicoes?integration_error=${encodeURIComponent(err?.message ?? "")}`, req.url),
    );
  }
}
