import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const provider = params.provider as "google" | "microsoft";
  if (provider !== "google" && provider !== "microsoft") {
    return new NextResponse("Bad provider", { status: 400 });
  }

  // SEC: bloqueia CSRF — só aceita POSTs cuja Origin coincide com o
  // próprio host. Antes, um site malicioso podia desligar a integração
  // de calendário de um trainer logado.
  const h = headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin) return new NextResponse("Missing origin", { status: 403 });
  try {
    const o = new URL(origin);
    if (host && o.host !== host) {
      return new NextResponse("Origin mismatch", { status: 403 });
    }
  } catch {
    return new NextResponse("Bad origin", { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  await supabase
    .from("calendar_integrations")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  return NextResponse.redirect(new URL("/admin/definicoes?integration_removed=1", req.url));
}
