import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail, emailTemplates, emailEnabled } from "@/lib/email";
import { emailAllowed } from "@/lib/notifications-config";
import { formatDateTime } from "@/lib/utils";
import { verifyBearer } from "@/lib/secrets";
import { logError } from "@/lib/errors";

// ════════════════════════════════════════════════════════════════
// Cron · lembretes de sessão 24h antes — EMAIL + IN-APP/PUSH.
//
// Disparado por um scheduler externo (cron-job.org) ou Vercel Cron,
// com header `Authorization: Bearer ${CRON_SECRET}`.
//
// IDEMPOTENTE por canal: cada envio "reclama" uma linha em
// booking_reminders (channel='email' ou 'in_app'). Corre a qualquer
// cadência sem duplicar. Os dois canais são INDEPENDENTES — o email
// pode estar desactivado e o in-app/push continua a sair.
//
// Push: o webhook de Supabase em notifications INSERT dispara o push
// web automaticamente (ver /api/push/dispatch). Por isso o canal
// 'in_app' aqui implica também 'push' sem código extra.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // QW-6: constant-time bearer check via helper partilhado.
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Email é opcional. Se estiver desactivado, continuamos com in-app/push.
  const emailOn = emailEnabled();

  const supabase = createAdminClient();
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, starts_at, session_type, client_id, trainer_id")
    .in("status", ["booked", "confirmed"])
    .gt("starts_at", now.toISOString())
    .lte("starts_at", in24h.toISOString());

  // B5 (audit jul/2026): não devolver a mensagem crua do Postgres (nomes de
  // colunas/constraints). Logamos server-side e devolvemos erro genérico.
  if (error) {
    logError("cron/reminders", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, emailSent: 0, inAppSent: 0 });
  }

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

  // Toda a equipa (owner + trainer) — para espalhar o EMAIL do lembrete
  // do dia a todos os admins, não só ao trainer da sessão. O in-app/push
  // já é espalhado pelo trigger fanout_staff_notifications (migration 0103).
  const { data: staffProfiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["owner", "trainer"]);

  // Gating por canal/categoria: o in-app é sempre enviado; o email é
  // filtrado por emailAllowed (cliente→'sessions', treinador→'reminders');
  // o push é filtrado no /api/push/dispatch.

  let emailSent = 0;
  let inAppSent = 0;

  async function claimAndSendEmail(
    bookingId: string,
    recipientId: string,
    to: string | undefined | null,
    category: string,
    tpl: { subject: string; html: string; text?: string },
  ) {
    if (!emailOn || !to) return;
    if (!(await emailAllowed(supabase as any, recipientId, category))) return;
    const { data: claimed, error: claimErr } = await (supabase as any)
      .from("booking_reminders")
      .insert({ booking_id: bookingId, recipient_id: recipientId, channel: "email" })
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) return;
    const res = await sendEmail({ to, ...tpl });
    if (res.ok) emailSent++;
  }

  async function claimAndPushInApp(
    bookingId: string,
    recipientId: string,
    title: string,
    body: string,
    link: string,
  ) {
    const { data: claimed, error: claimErr } = await (supabase as any)
      .from("booking_reminders")
      .insert({ booking_id: bookingId, recipient_id: recipientId, channel: "in_app" })
      .select("id")
      .maybeSingle();
    if (claimErr || !claimed) return;
    // notifications INSERT → webhook dispara push web automaticamente.
    await (supabase as any).from("notifications").insert({
      user_id: recipientId,
      type: "session_reminder",
      title,
      body,
      link,
    });
    inAppSent++;
  }

  for (const b of bookings as any[]) {
    const when = formatDateTime(b.starts_at);
    const client = clientMap.get(b.client_id);
    const trainerProfileId = trainerToProfile.get(b.trainer_id);
    const trainerProf = trainerProfileId ? trainerProfMap.get(trainerProfileId) : null;

    await claimAndSendEmail(
      b.id,
      b.client_id,
      client?.email,
      "sessions",
      emailTemplates.sessionReminder({ clientName: client?.full_name ?? "atleta", when }),
    );
    await claimAndPushInApp(
      b.id,
      b.client_id,
      "Leap Fitness Studio",
      `Tens uma sessão a ${when}.`,
      `/app/sessao/${b.id}`,
    );

    if (trainerProfileId) {
      await claimAndSendEmail(
        b.id,
        trainerProfileId,
        trainerProf?.email,
        "reminders",
        emailTemplates.sessionReminderTrainer({
          trainerName: trainerProf?.full_name ?? "trainer",
          clientName: client?.full_name ?? "cliente",
          when,
        }),
      );
      await claimAndPushInApp(
        b.id,
        trainerProfileId,
        "Leap Fitness Studio",
        `Sessão com ${client?.full_name ?? "cliente"} a ${when}.`,
        "/admin/agenda",
      );

      // EMAIL do lembrete à restante equipa (owner/admins sem trainer
      // próprio). O in-app/push deles já vem do trigger da migration
      // 0103 ao inserir a notificação do trainer acima — aqui só falta
      // o email. Idempotente: claimAndSendEmail reclama uma linha por
      // destinatário; o trainer (já tratado) é saltado pelo claim.
      for (const s of staffProfiles ?? []) {
        if ((s as any).id === trainerProfileId) continue;
        await claimAndSendEmail(
          b.id,
          (s as any).id,
          (s as any).email,
          "reminders",
          emailTemplates.sessionReminderTrainer({
            trainerName: (s as any).full_name?.split(" ")[0] ?? "equipa",
            clientName: client?.full_name ?? "cliente",
            when,
          }),
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    processed: bookings.length,
    emailSent,
    inAppSent,
  });
}
