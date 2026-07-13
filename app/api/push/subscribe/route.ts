import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// ════════════════════════════════════════════════════════════════
// Guarda a subscrição de push (endpoint) enviada pelo service worker
// quando o browser/OS a roda (sw.js → `pushsubscriptionchange`). Sem
// isto, uma subscrição rotacionada nunca chegava à BD e o cliente
// deixava de receber push em silêncio.
//
// Auth: cookie de sessão Supabase (o fetch do SW usa credentials:
// 'include'). Origin check defensivo, igual a /api/notifications/read.
// A RLS de push_subscriptions já limita o insert a user_id = auth.uid().
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

  let endpoint = "";
  let p256dh = "";
  let auth = "";
  try {
    const body = await request.json();
    endpoint = String(body?.endpoint ?? "");
    p256dh = String(body?.p256dh ?? "");
    auth = String(body?.auth ?? "");
  } catch {
    return NextResponse.json({ ok: true, skipped: "no_body" });
  }
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ ok: true, skipped: "incomplete" });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await (supabase as any)
    .from("push_subscriptions")
    .upsert(
      { user_id: user.id, endpoint, p256dh, auth },
      { onConflict: "endpoint" },
    );

  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
