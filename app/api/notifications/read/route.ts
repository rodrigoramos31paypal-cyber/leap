import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// ════════════════════════════════════════════════════════════════
// Marca UMA notificação in-app como lida. Alvo do service worker
// quando o utilizador toca numa notificação push (sw.js →
// notificationclick), para que push e in-app fiquem sincronizados:
// ler no telemóvel → some o badge do sino em todos os dispositivos
// (a UPDATE dispara o realtime que o NotificationBell já escuta).
//
// Auth: cookie de sessão Supabase (o fetch do SW usa credentials:
// 'include'). RLS já limita ao próprio; o filtro user_id é defensivo.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // SEC (S-03, audit jun/2026): Origin check defense-in-depth contra
  // CSRF. SameSite=Lax (default Supabase) ja mitiga a maior parte dos
  // vectores cross-site para POSTs com JSON, mas alinhamos com o
  // padrao usado em /api/integrations/[provider]/disconnect. O service
  // worker chama sempre com Origin == proprio host.
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("host");
  if (origin) {
    try {
      const o = new URL(origin);
      if (host && o.host !== host) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "bad_origin" }, { status: 400 });
    }
  }

  let id: string | undefined;
  try {
    const body = await request.json();
    id = body?.id;
  } catch {
    return NextResponse.json({ ok: true, skipped: "no_body" });
  }
  if (!id) return NextResponse.json({ ok: true, skipped: "no_id" });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);

  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
