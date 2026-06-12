// ════════════════════════════════════════════════════════════════
// Sistema de sessões · wrappers TS para RPCs Postgres
// (nota: nome do ficheiro/coluna `credits` mantido para minimizar risco
// de refactor — apenas terminologia user-facing usa "sessão")
// ════════════════════════════════════════════════════════════════
import { cache } from "react";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { PaymentMethod, SessionType } from "@/types/database";

export type CreditSummary = {
  individual: number;
  dupla: number;
  total: number;
};

export type CreditsByTrainer = Array<{
  trainerId: string;
  trainerName: string;
  slug: string;
  individual: number;
  dupla: number;
}>;

const fetchActiveCredits = cache(async (clientId: string) => {
  const supabase = createClient();
  const { data } = await supabase
    .from("purchases")
    .select(
      "session_type, sessions_remaining, expires_at, trainer_id, trainers:trainer_id(slug, profiles:profile_id(full_name))",
    )
    .eq("client_id", clientId)
    .eq("status", "confirmed")
    .gt("sessions_remaining", 0);
  const now = Date.now();
  return (data ?? []).filter(
    (p: any) => !p.expires_at || new Date(p.expires_at).getTime() >= now,
  );
});

export async function getClientCredits(
  clientId: string,
  trainerId?: string,
): Promise<CreditSummary> {
  const rows = await fetchActiveCredits(clientId);
  let individual = 0,
    dupla = 0;
  for (const p of rows as any[]) {
    if (trainerId && p.trainer_id !== trainerId) continue;
    if (p.session_type === "individual") individual += p.sessions_remaining;
    else dupla += p.sessions_remaining;
  }
  return { individual, dupla, total: individual + dupla };
}

export async function getClientCreditsByTrainer(clientId: string): Promise<CreditsByTrainer> {
  const rows = await fetchActiveCredits(clientId);
  const byTrainer = new Map<string, CreditsByTrainer[number]>();
  for (const p of rows as any[]) {
    const t = p.trainers;
    const key = p.trainer_id;
    if (!byTrainer.has(key)) {
      byTrainer.set(key, {
        trainerId: key,
        trainerName: t?.profiles?.full_name ?? "—",
        slug: t?.slug ?? "",
        individual: 0,
        dupla: 0,
      });
    }
    const entry = byTrainer.get(key)!;
    if (p.session_type === "individual") entry.individual += p.sessions_remaining;
    else entry.dupla += p.sessions_remaining;
  }
  return Array.from(byTrainer.values());
}

export async function createPurchase(
  packId: string,
  paymentMethod: PaymentMethod,
  clientId?: string,
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_purchase", {
    p_pack_id: packId,
    p_payment_method: paymentMethod,
    p_client_id: clientId,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function confirmPurchase(purchaseId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("confirm_purchase", { p_purchase_id: purchaseId });
  if (error) throw error;
}

/** Atribui N sessões personalizadas a um cliente (sem referência a pack). Admin only. */
export async function createCustomPurchase(args: {
  clientId: string;
  trainerId: string;
  sessions: number;
  priceCents: number;
  sessionType: SessionType;
  paymentMethod: PaymentMethod;
  name?: string;
  validityDays?: number | null;
}): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_custom_purchase", {
    p_client_id: args.clientId,
    p_trainer_id: args.trainerId,
    p_sessions: args.sessions,
    p_price_cents: args.priceCents,
    p_session_type: args.sessionType,
    p_payment_method: args.paymentMethod,
    p_name: args.name ?? null,
    p_validity_days: args.validityDays ?? null,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function rejectPurchase(purchaseId: string, reason?: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("reject_purchase", {
    p_purchase_id: purchaseId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function createBooking(args: {
  trainerId: string;
  startsAt: Date;
  durationMin: number;
  sessionType?: SessionType;
  clientId?: string;
}): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_booking", {
    p_trainer_id: args.trainerId,
    p_starts_at: args.startsAt.toISOString(),
    p_duration_min: args.durationMin,
    p_session_type: args.sessionType ?? "individual",
    p_client_id: args.clientId,
  });
  if (error) throw error;
  return data as unknown as string;
}

export type RecurringBookingResult = {
  ok: boolean;
  series_id: string | null;
  booking_ids: string[];
  conflicts: Array<{ week: number; starts_at: string; reason: "booking" | "blocked" | "reserved" }>;
};

/** Marca várias semanas consecutivas de uma só vez. Atómico: ou cria tudo, ou nada. */
export async function createRecurringBooking(args: {
  trainerId: string;
  startsAt: Date;
  durationMin: number;
  sessionsCount: number;
  sessionType?: SessionType;
  clientId?: string;
}): Promise<RecurringBookingResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_recurring_booking", {
    p_trainer_id: args.trainerId,
    p_starts_at: args.startsAt.toISOString(),
    p_duration_min: args.durationMin,
    p_sessions_count: args.sessionsCount,
    p_session_type: args.sessionType ?? "individual",
    p_client_id: args.clientId,
  });
  if (error) throw error;
  return data as unknown as RecurringBookingResult;
}

export async function confirmAttendance(bookingId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("confirm_booking_attendance", { p_booking_id: bookingId });
  if (error) throw error;
}

export async function cancelBooking(bookingId: string, reason?: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function markNoShow(bookingId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_no_show", { p_booking_id: bookingId });
  if (error) throw error;
}

export async function adjustCredits(purchaseId: string, delta: number, reason: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("adjust_credits", {
    p_purchase_id: purchaseId,
    p_delta: delta,
    p_reason: reason,
  });
  if (error) throw error;
}

/** Confirma compra usando service role (para webhooks/callbacks). */
export async function confirmPurchaseAsService(purchaseId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("confirm_purchase", { p_purchase_id: purchaseId });
  if (error) throw error;
}
