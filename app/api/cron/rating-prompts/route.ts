import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail, emailTemplates, emailEnabled } from "@/lib/email";
import { formatDateTime } from "@/lib/utils";
import { verifyBearer } from "@/lib/secrets";

// ════════════════════════════════════════════════════════════════
// Cron · pedido de avaliação pós-sessão (1-5⭐).
//
// Cadência recomendada: de hora a hora. Header obrigatório:
// `Authorization: Bearer ${CRON_SECRET}`.
//
// Janela: bookings com status='confirmed' que terminaram entre
//   ends_at ∈ [now - 24h, now - 1h]
// e que ainda não tenham (a) avaliação nem (b) prompt enviado.
// Dedup forte via rating_prompts (PK = booking_id).
//
// Canais: in-app (sempre — push automático via webhook) + email
// (se configurado). Respeita opt-out via notification_preferences
// kind='rating_prompt'.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // QW-6: constant-time bearer check via helper partilhado.
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const until = new Date(now.getTime() - 60 * 60 * 1000);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://leap-fitness.pt";

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, client_id")
    .eq("status", "confirmed")
    .gte("ends_at", since.toISOString())
    .lte("ends_at", until.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0 });
  }

  const bookingIds = bookings.map((b: any) => b.id);
  const clientIds = Array.from(new Set(bookings.map((b: any) => b.client_id)));

  // Exclui bookings já avaliados ou já prompted.
  const [{ data: ratedRows }, { data: promptedRows }] = await Promise.all([
    (supabase as any).from("session_ratings").select("booking_id").in("booking_id", bookingIds),
    (supabase as any).from("rating_prompts").select("booking_id").in("booking_id", bookingIds),
  ]);
  const rated = new Set(((ratedRows as any[]) ?? []).map((r) => r.booking_id));
  const prompted = new Set(((promptedRows as any[]) ?? []).map((r) => r.booking_id));

  // Perfis + opt-outs.
  const [{ data: profiles }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", clientIds),
    (supabase as any)
      .from("notification_preferences")
      .select("user_id, enabled")
      .eq("kind", "rating_prompt")
      .in("user_id", clientIds),
  ]);
  const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const disabled = new Set(
    ((prefs ?? []) as any[]).filter((p) => p.enabled === false).map((p) => p.user_id),
  );

  let sent = 0;
  for (const b of bookings as any[]) {
    if (rated.has(b.id) || prompted.has(b.id)) continue;
    if (disabled.has(b.client_id)) continue;
    const prof = profileMap.get(b.client_id);
    if (!prof) continue;

    // Reclama a linha de dedup; se conflito, outro worker já enviou.
    const { data: claimed, error: claimErr } = await (supabase as any)
      .from("rating_prompts")
      .insert({ booking_id: b.id })
      .select("booking_id")
      .maybeSingle();
    if (claimErr || !claimed) continue;

    const when = formatDateTime(b.starts_at);

    // In-app → push automático via webhook.
    await (supabase as any).from("notifications").insert({
      user_id: b.client_id,
      type: "rating_prompt",
      title: "Como correu a tua sessão?",
      body: `Avalia em 10 segundos a tua sessão de ${when}.`,
      link: `/app/sessao/${b.id}/avaliar`,
    });

    // Email (best-effort).
    if (emailEnabled() && prof.email) {
      const tpl = emailTemplates.ratingPrompt({
        clientName: prof.full_name ?? "atleta",
        when,
        bookingId: b.id,
        appUrl,
      });
      const res = await sendEmail({ to: prof.email, ...tpl });
      if (res.ok) sent++;
    } else {
      sent++;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: bookings.length,
    sent,
  });
}
