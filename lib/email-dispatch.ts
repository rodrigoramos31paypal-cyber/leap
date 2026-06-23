// ════════════════════════════════════════════════════════════════
// Email dispatch helpers · combinam queries Supabase com sendEmail
// para serem chamados a partir de server actions.
//
// SEC — uso de service role (createAdminClient):
//   Estas funções usam service role de propósito. Precisam de ler
//   dados que o cliente autenticado NÃO vê por RLS (email/nome de
//   outros perfis, dados de bookings/purchases para o template). O
//   resultado nunca é devolvido ao caller — só vai para dentro do
//   email enviado ao destinatário legítimo.
//
//   CONTRATO: o caller garante que a operação já passou por uma RPC
//   que valida ownership (ex. create_booking, cancel_booking,
//   create_purchase). Estas funções são sempre chamadas DEPOIS dessa
//   RPC ter tido sucesso, por isso o id recebido é de uma entidade a
//   que o caller tem direito.
//
// GATING DE EMAIL: cada envio respeita a preferência do destinatário
// (notification_preferences, por categoria). Fail-open: se a leitura
// falhar, o email é enviado na mesma.
// ════════════════════════════════════════════════════════════════
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail, emailTemplates, emailEnabled } from "@/lib/email";
import { emailAllowed } from "@/lib/notifications-config";
import { eur, formatDateTime } from "@/lib/utils";

async function getUserEmail(
  userId: string,
): Promise<{ id: string; email: string; full_name: string } | null> {
  if (!emailEnabled()) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", userId)
    .single();
  return (data as any) ?? null;
}

async function getTrainerEmail(
  trainerId: string,
): Promise<{ id: string; email: string; full_name: string } | null> {
  if (!emailEnabled()) return null;
  const supabase = createAdminClient();
  const { data: trainer } = await supabase
    .from("trainers")
    .select("profile_id")
    .eq("id", trainerId)
    .single();
  if (!trainer?.profile_id) return null;
  return getUserEmail(trainer.profile_id);
}

export async function dispatchBookingCreated(bookingId: string) {
  if (!emailEnabled()) return;
  const supabase = createAdminClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("starts_at, session_type, client_id, trainer_id")
    .eq("id", bookingId)
    .single();
  if (!b) return;

  const [client, admin] = await Promise.all([
    getUserEmail(b.client_id),
    getTrainerEmail(b.trainer_id),
  ]);
  const when = formatDateTime(b.starts_at);

  if (client && (await emailAllowed(supabase, client.id, "sessions"))) {
    const tpl = emailTemplates.bookingCreated({ clientName: client.full_name, when, type: b.session_type });
    await sendEmail({ to: client.email, ...tpl });
  }
  if (admin && (await emailAllowed(supabase, admin.id, "bookings"))) {
    const tpl = emailTemplates.adminBookingCreated({ clientName: client?.full_name ?? "Cliente", when, type: b.session_type });
    await sendEmail({ to: admin.email, ...tpl });
  }
}

export async function dispatchBookingCancelled(bookingId: string, refunded: boolean) {
  if (!emailEnabled()) return;
  const supabase = createAdminClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("starts_at, client_id, trainer_id")
    .eq("id", bookingId)
    .single();
  if (!b) return;
  const when = formatDateTime(b.starts_at);

  const [client, admin] = await Promise.all([
    getUserEmail(b.client_id),
    getTrainerEmail(b.trainer_id),
  ]);

  if (client && (await emailAllowed(supabase, client.id, "sessions"))) {
    const tpl = emailTemplates.bookingCancelled({
      clientName: client.full_name,
      when,
      refunded,
    });
    await sendEmail({ to: client.email, ...tpl });
  }
  // Email ao treinador quando um cliente cancela (categoria 'bookings').
  if (admin && (await emailAllowed(supabase, admin.id, "bookings"))) {
    const tpl = emailTemplates.adminBookingCancelled({
      clientName: client?.full_name ?? "Um cliente",
      when,
    });
    await sendEmail({ to: admin.email, ...tpl });
  }
}

export async function dispatchBookingConfirmed(bookingId: string) {
  if (!emailEnabled()) return;
  const supabase = createAdminClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("starts_at, client_id")
    .eq("id", bookingId)
    .single();
  if (!b) return;
  const client = await getUserEmail(b.client_id);
  if (!client) return;
  if (!(await emailAllowed(supabase, client.id, "sessions"))) return;
  const tpl = emailTemplates.bookingConfirmed({
    clientName: client.full_name,
    when: formatDateTime(b.starts_at),
  });
  await sendEmail({ to: client.email, ...tpl });
}

export async function dispatchPurchaseConfirmed(purchaseId: string) {
  if (!emailEnabled()) return;
  const supabase = createAdminClient();
  const { data: p } = await supabase
    .from("purchases")
    .select("client_id, sessions_total, pack_snapshot")
    .eq("id", purchaseId)
    .single();
  if (!p) return;
  const client = await getUserEmail(p.client_id);
  if (!client) return;
  if (!(await emailAllowed(supabase, client.id, "packs"))) return;
  const tpl = emailTemplates.purchaseConfirmed({
    clientName: client.full_name,
    packName: (p.pack_snapshot as any)?.name ?? "pack",
    sessions: p.sessions_total,
  });
  await sendEmail({ to: client.email, ...tpl });
}

export async function dispatchPurchasePending(purchaseId: string) {
  if (!emailEnabled()) return;
  const supabase = createAdminClient();
  const { data: p } = await supabase
    .from("purchases")
    .select("client_id, amount_cents, pack_snapshot")
    .eq("id", purchaseId)
    .single();
  if (!p) return;

  // Avisa toda a equipa (owner + trainers), não só o trainer dono da
  // purchase — um "Admin" (owner sem trainer próprio) também tem de
  // saber que há um pagamento a confirmar. Espelha o fan-out do
  // trigger notify_admin_on_purchase (migration 0102).
  const [{ data: staff }, client] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("role", ["owner", "trainer"]),
    getUserEmail(p.client_id),
  ]);
  if (!staff || staff.length === 0) return;

  const tpl = emailTemplates.adminPurchasePending({
    clientName: client?.full_name ?? "Cliente",
    packName: (p.pack_snapshot as any)?.name ?? "pack",
    amountEur: eur(p.amount_cents),
  });

  await Promise.all(
    (staff as { id: string; email: string | null }[]).map(async (s) => {
      if (!s.email) return;
      if (!(await emailAllowed(supabase, s.id, "payments"))) return;
      await sendEmail({ to: s.email, ...tpl }).catch(() => {});
    }),
  );
}
