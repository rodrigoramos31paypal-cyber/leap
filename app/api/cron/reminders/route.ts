import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail, emailTemplates, emailEnabled } from "@/lib/email";
import { formatDateTime } from "@/lib/utils";

// ════════════════════════════════════════════════════════════════
// Cron · lembretes de sessão por EMAIL (24h antes).
//
// Disparado por um scheduler externo (cron-job.org) ou Vercel Cron,
// com header `Authorization: Bearer ${CRON_SECRET}`.
//
// IDEMPOTENTE: a janela é (now, now+24h] e cada envio "reclama" uma
// linha em booking_reminders antes de enviar. Por isso corre bem a
// qualquer cadência (de hora a hora ou 1×/dia): nunca envia duas vezes.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!emailEnabled()) {
    return NextResponse.json({ ok: true, skipped: "email_disabled" });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, starts_at, session_type, client_id, trainer_id")
    .in("status", ["booked", "confirmed"])
    .gt("starts_at", now.toISOString())
    .lte("starts_at", in24h.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, sent: 0 });
  }

  // Perfis (cliente) + trainers→perfil, em queries agregadas.
  const clientIds = Array.from(new Set(bookings.map((b: any) => b.client_id)));
  const trainerIds = Array.from(new Set(bookings.map((b: any) => b.trainer_id)));
  const SENTINEL = "00000000-0000-0000-0000-000000000000";

  const [{ data: clientProfiles }, { data: trainers }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", clientIds.length ? clientIds : [SENTINEL]),
    supabase.from("trainers").select("id, profile_id").in("id", trainerIds.length ? trainerIds : [SENTINEL]),
  ]);

  const trainerProfileIds = Array.from(
    new Set((trainers ?? []).map((t: any) => t.profile_id).filter(Boolean)),
  );
  const { data: trainerProfiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", trainerProfileIds.length ? trainerProfileIds : [SENTINEL]);

  const clientMap = new Map((clientProfiles ?? []).map((p: any) => [p.id, p]));
  const trainerProfMap = new Map((trainerProfiles ?? []).map((p: any) => [p.id, p]));
  const trainerToProfile = new Map((trainers ?? []).map((t: any) => [t.id, t.profile_id]));

  // Opt-outs.
  const allRecipientIds = Array.from(new Set([...clientIds, ...trainerProfileIds]));
  const { data: prefs } = await (supabase as any)
    .from("notification_preferences")
    .select("user_id, enabled")
    .eq("kind", "session_reminder")
    .in("user_id", allRecipientIds.length ? allRecipientIds : [SENTINEL]);
  const disabled = new Set(
    (prefs ?? []).filter((p: any) => p.enabled === false).map((p: any) => p.user_id),
  );

  let sent = 0;

  async function claimAndSend(
    bookingId: string,
    recipientId: string,
    to: string | undefined | null,
    tpl: { subject: string; html: string; text?: string },
  ) {
    if (!to || disabled.has(recipientId)) return;
    // Reclama a linha de dedup; só envia se a inserção vingou (sem conflito).
    const { data: claimed, error: claimErr } = await (supabase as any)
      .from("booking_reminders")
      .insert({ booking_id: bookingId, recipient_id: recipientId, channel: "email" })
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) return; // já enviado (conflito) ou erro
    const res = await sendEmail({ to, ...tpl });
    if (res.ok) sent++;
  }

  for (const b of bookings as any[]) {
    const when = formatDateTime(b.starts_at);
    const client = clientMap.get(b.client_id);
    const trainerProfileId = trainerToProfile.get(b.trainer_id);
    const trainerProf = trainerProfileId ? trainerProfMap.get(trainerProfileId) : null;

    await claimAndSend(
      b.id,
      b.client_id,
      client?.email,
      emailTemplates.sessionReminder({ clientName: client?.full_name ?? "atleta", when }),
    );

    if (trainerProfileId) {
      await claimAndSend(
        b.id,
        trainerProfileId,
        trainerProf?.email,
        emailTemplates.sessionReminderTrainer({
          trainerName: trainerProf?.full_name ?? "treinador",
          clientName: client?.full_name ?? "cliente",
          when,
        }),
      );
    }
  }

  return NextResponse.json({ ok: true, processed: bookings.length, sent });
}
