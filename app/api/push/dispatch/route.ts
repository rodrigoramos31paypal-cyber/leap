import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPush, pushConfigured } from "@/lib/push";

// ════════════════════════════════════════════════════════════════
// Web Push dispatch · alvo de um Supabase Database Webhook em
// INSERT na tabela `notifications`. Para cada notificação criada
// (por triggers, RPCs ou crons), envia push a todas as subscrições
// do utilizador. Subscrições expiradas (404/410) são apagadas.
//
// Segurança: header `Authorization: Bearer ${CRON_SECRET}` (configurado
// no próprio webhook). Sem isto, 401.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!pushConfigured()) {
    return NextResponse.json({ ok: true, skipped: "push_not_configured" });
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: true, skipped: "no_body" });
  }

  // Supabase webhook envia { type, table, record, old_record, schema }.
  const record = payload?.record ?? payload;
  const userId = record?.user_id;
  if (!userId) return NextResponse.json({ ok: true, skipped: "no_user" });

  const supabase = createAdminClient();
  const { data: subs } = await (supabase as any)
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const notif = {
    title: record.title || "LEAP-FITNESS",
    body: record.body || "",
    url: record.link || "/",
  };

  let sent = 0;
  for (const s of subs as any[]) {
    const r = await sendPush(s, notif);
    if (r.ok) sent++;
    else if (r.gone) {
      await (supabase as any).from("push_subscriptions").delete().eq("id", s.id);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
