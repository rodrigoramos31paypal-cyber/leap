import { NextRequest, NextResponse } from "next/server";
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
  let id: string | undefined;
  try {
    const body = await request.json();
    id = body?.id;
  } catch {
    return NextResponse.json({ ok: true, skipped: "no_body" });
  }
  if (!id) return NextResponse.json({ ok: true, skipped: "no_id" });

  const supabase = createClient();
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
