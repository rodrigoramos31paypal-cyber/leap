// ════════════════════════════════════════════════════════════════
// Email dispatch helpers · combinam queries Supabase com sendEmail
// para serem chamados a partir de server actions.
// ════════════════════════════════════════════════════════════════
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail, emailTemplates, emailEnabled } from "@/lib/email";
import { eur, formatDateTime } from "@/lib/utils";

async function getUserEmail(userId: string): Promise<{ email: string; full_name: string } | null> {
  if (!emailEnabled()) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .single();
  return data ?? null;
}

async function getTrainerEmail(trainerId: string): Promise<{ email: string; full_name: string } | null> {
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

  if (client) {
    const tpl = emailTemplates.bookingCreated({ clientName: client.full_name, when, type: b.session_type });
    await sendEmail({ to: client.email, ...tpl });
  }
  if (admin) {
    const tpl = emailTemplates.adminBookingCreated({ clientName: client?.full_name ?? "Cliente", when, type: b.session_type });
    await sendEmail({ to: admin.email, ...tpl });
  }
}

export async function dispatchBookingCancelled(bookingId: string, refunded: boolean) {
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
  const tpl = emailTemplates.bookingCancelled({
    clientName: client.full_name,
    when: formatDateTime(b.starts_at),
    refunded,
  });
  await sendEmail({ to: client.email, ...tpl });
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
    .select("client_id, trainer_id, amount_cents, pack_snapshot")
    .eq("id", purchaseId)
    .single();
  if (!p) return;
  const [admin, client] = await Promise.all([
    getTrainerEmail(p.trainer_id),
    getUserEmail(p.client_id),
  ]);
  if (!admin) return;
  const tpl = emailTemplates.adminPurchasePending({
    clientName: client?.full_name ?? "Cliente",
    packName: (p.pack_snapshot as any)?.name ?? "pack",
    amountEur: eur(p.amount_cents),
  });
  await sendEmail({ to: admin.email, ...tpl });
}
