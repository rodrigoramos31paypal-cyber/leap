// ════════════════════════════════════════════════════════════════
// Sistema de sessões · wrappers TS para RPCs Postgres
// (nota: nome do ficheiro/coluna `credits` mantido para minimizar risco
// de refactor — apenas terminologia user-facing usa "sessão")
// ════════════════════════════════════════════════════════════════
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { captureAlert } from "@/lib/alerts";
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
  avatarUrl: string | null;
  individual: number;
  dupla: number;
}>;

const fetchActiveCredits = cache(async (clientId: string) => {
  const supabase = createClient();
  const { data } = await supabase
    .from("purchases")
    .select(
      "session_type, sessions_remaining, expires_at, trainer_id, trainers:trainer_id(slug, avatar_url, profiles:profile_id(full_name))",
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
        avatarUrl: (t as any)?.avatar_url ?? null,
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

/** Remove N sessões do saldo de um cliente (admin). Devolve quantas
 *  foram efectivamente removidas (<= pedido se nao havia saldo). */
export async function removeClientSessions(
  clientId: string,
  trainerId: string,
  count: number,
): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("remove_client_sessions", {
    p_client_id: clientId,
    p_trainer_id: trainerId,
    p_count: count,
  });
  if (error) throw error;
  return (data as unknown as number) ?? 0;
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
    // H4: a RPC tipa estes parâmetros como `string | undefined` /
    // `number | undefined` (não `| null`). Passar `null` falha o tipo.
    p_name: args.name ?? undefined,
    p_validity_days: args.validityDays ?? undefined,
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

/**
 * Cancela uma compra JÁ confirmada (caso típico: admin aceitou-a por
 * engano). Coloca a compra em 'cancelled', leva sessions_remaining a 0
 * e marca o pagamento como reembolsado. Vai parar ao separador
 * "Rejeitados" da página de pagamentos.
 */
export async function cancelConfirmedPurchase(purchaseId: string, reason?: string) {
  const supabase = createClient();
  const { error } = await (supabase as any).rpc("cancel_confirmed_purchase", {
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
  if (error) {
    // #8c: a RPC recusou por `pick_purchase_for_booking` devolver null.
    // Se o saldo confirmado AINDA mostra créditos disponíveis, há um
    // desacordo entre a função de selecção e o saldo → bug de
    // contabilidade que esconde sessões pagas do cliente. Alerta.
    if (/sem sess(õ|o)es/i.test(error.message ?? "")) {
      await alertIfCreditsMismatch(args).catch(() => {});
    }
    throw error;
  }
  return data as unknown as string;
}

/** #8c · helper de detecção do desacordo pick_purchase ↔ saldo. */
async function alertIfCreditsMismatch(args: {
  trainerId: string;
  sessionType?: SessionType;
  clientId?: string;
}): Promise<void> {
  const supabase = createClient();
  let clientId = args.clientId;
  if (!clientId) {
    const { data: { user } } = await supabase.auth.getUser();
    clientId = user?.id;
  }
  if (!clientId) return;

  const credits = await getClientCredits(clientId, args.trainerId);
  const type = args.sessionType ?? "individual";
  const available = type === "individual" ? credits.individual : credits.dupla;
  if (available > 0) {
    await captureAlert("booking_credit_mismatch", {
      level: "error",
      clientId,
      trainerId: args.trainerId,
      sessionType: type,
      availableInBucket: available,
      detail:
        "create_booking recusou por falta de sessões, mas o saldo confirmado mostra créditos disponíveis (pick_purchase_for_booking devolveu null).",
    });
  }
}

/**
 * Marca uma sessão EM NOME de um cliente (admin/trainer), a partir da
 * Agenda. `deduct` decide se desconta 1 sessão do saldo do cliente
 * (true) ou se é uma sessão grátis sem mexer no pack (false). Sessões
 * grátis funcionam mesmo para clientes sem qualquer pack.
 */
export async function createBookingAdmin(args: {
  trainerId: string;
  startsAt: Date;
  durationMin: number;
  clientId: string;
  sessionType?: SessionType;
  deduct: boolean;
}): Promise<string> {
  const supabase = createClient();
  const { data, error } = await (supabase as any).rpc("create_booking_admin", {
    p_trainer_id: args.trainerId,
    p_starts_at: args.startsAt.toISOString(),
    p_duration_min: args.durationMin,
    p_session_type: args.sessionType ?? "individual",
    p_client_id: args.clientId,
    p_deduct: args.deduct,
  });
  if (error) throw error;
  return data as unknown as string;
}

export type RecurringBookingResult = {
  // ok=false quando nada foi marcado (só conflitos / sem crédito).
  ok: boolean;
  series_id: string | null;
  booking_ids: string[];
  conflicts: Array<{
    week: number;
    starts_at: string;
    reason: "booking" | "blocked" | "reserved" | "no_credit";
  }>;
  /** Nº de semanas efectivamente marcadas (pode ser < requested_count). */
  booked_count: number;
  /** Nº de semanas pedidas originalmente. */
  requested_count: number;
};

/**
 * Marca várias semanas consecutivas. PARCIAL: marca as semanas livres e
 * devolve em `conflicts` as que ficaram por marcar (já havia marcação,
 * bloqueio, etc.). `booked_count`/`requested_count` para a mensagem da UI.
 */
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

/**
 * Reagenda uma marcação (admin/trainer) — usado pelo drag-and-drop na
 * Agenda. Atómico e neutro em créditos. Preserva o estado da sessão.
 * `notifyClient` controla a notificação in-app/push do cliente.
 * Devolve o id da NOVA marcação.
 */
export async function rescheduleBookingAdmin(args: {
  oldBookingId: string;
  startsAt: Date;
  durationMin: number;
  notifyClient: boolean;
  force?: boolean;
}): Promise<string> {
  const supabase = createClient();
  const { data, error } = await (supabase as any).rpc("reschedule_booking_admin", {
    p_old_booking_id: args.oldBookingId,
    p_starts_at: args.startsAt.toISOString(),
    p_duration_min: args.durationMin,
    p_notify_client: args.notifyClient,
    p_force: args.force ?? false,
  });
  if (error) throw error;
  return data as unknown as string;
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

export async function revertNoShow(
  bookingId: string,
  newStatus: "confirmed" | "cancelled",
  refundCredit: boolean,
) {
  const supabase = createClient();
  const { error } = await supabase.rpc("revert_no_show", {
    p_booking_id: bookingId,
    p_new_status: newStatus,
    p_refund_credit: refundCredit,
  });
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

