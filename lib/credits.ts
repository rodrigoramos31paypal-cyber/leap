// ════════════════════════════════════════════════════════════════
// Sistema de sessões · wrappers TS para RPCs Postgres
// (nota: nome do ficheiro/coluna `credits` mantido para minimizar risco
// de refactor — apenas terminologia user-facing usa "sessão")
// ════════════════════════════════════════════════════════════════
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { captureAlert } from "@/lib/alerts";
import { getActiveDuoPartnerId, getPartnerDuplaRows } from "@/lib/duo";
import type { PaymentMethod, SessionType } from "@/types/database";

export type CreditSummary = {
  individual: number;
  dupla: number;
  total: number;
  /** Soma de sessions_total de TODOS os packs activos (não-expirados, com
   *  saldo > 0). Usado em "O teu pack" como denominador agregado. */
  totalAttributed: number;
};

export type CreditsByTrainer = Array<{
  trainerId: string;
  trainerName: string;
  slug: string;
  avatarUrl: string | null;
  individual: number;
  dupla: number;
}>;

/** Relação `trainers` embebida na query de packs (nested select). */
type CreditTrainerRel = {
  slug: string | null;
  avatar_url: string | null;
  profiles: { full_name: string | null } | null;
} | null;

/** M15 (audit jul/2026): forma tipada de uma linha de pack activo. Antes os
 *  loops de SOMA de sessões iteravam sobre `any[]` — um rename de coluna
 *  (ex.: sessions_remaining) compilava e produzia saldos silenciosamente
 *  errados. Com este tipo, o compilador apanha essas mudanças. */
export type ActiveCreditRow = {
  session_type: SessionType;
  sessions_remaining: number;
  sessions_total: number | null;
  expires_at: string | null;
  trainer_id: string;
  trainers: CreditTrainerRel;
};

const fetchActiveCredits = cache(async (clientId: string): Promise<ActiveCreditRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchases")
    .select(
      "session_type, sessions_remaining, sessions_total, expires_at, trainer_id, trainers:trainer_id(slug, avatar_url, profiles:profile_id(full_name))",
    )
    .eq("client_id", clientId)
    .eq("status", "confirmed")
    .gt("sessions_remaining", 0);
  const now = Date.now();
  // Cast único no boundary da query (o tipo inferido do nested select do
  // supabase-js não é fiável); daqui para a frente o consumo é tipado.
  return ((data ?? []) as unknown as ActiveCreditRow[]).filter(
    (p) => !p.expires_at || new Date(p.expires_at).getTime() >= now,
  );
});

// DUO: o saldo PT Dupla é PARTILHADO pelo par. Buscamos os packs dupla do
// parceiro (se houver par activo) para os somar ao saldo do próprio, de
// modo a que AS DUAS contas mostrem o mesmo número de sessões. Cacheado
// por cliente para não repetir o lookup quando a página chama vários
// getClientCredits*.
const fetchPartnerDuplaRows = cache(async (clientId: string) => {
  const partnerId = await getActiveDuoPartnerId(clientId);
  if (!partnerId) return [];
  return getPartnerDuplaRows(partnerId);
});

export async function getClientCredits(
  clientId: string,
  trainerId?: string,
): Promise<CreditSummary> {
  const [rows, partnerRows] = await Promise.all([
    fetchActiveCredits(clientId),
    fetchPartnerDuplaRows(clientId),
  ]);
  let individual = 0,
    dupla = 0,
    totalAttributed = 0;
  for (const p of rows) {
    if (trainerId && p.trainer_id !== trainerId) continue;
    if (p.session_type === "individual") individual += p.sessions_remaining;
    else dupla += p.sessions_remaining;
    totalAttributed += p.sessions_total ?? 0;
  }
  // DUO: soma o saldo dupla do parceiro (saldo partilhado).
  for (const p of partnerRows) {
    if (trainerId && p.trainer_id !== trainerId) continue;
    dupla += p.sessions_remaining;
    totalAttributed += p.sessions_total;
  }
  return { individual, dupla, total: individual + dupla, totalAttributed };
}

export async function getClientCreditsByTrainer(clientId: string): Promise<CreditsByTrainer> {
  const [rows, partnerRows] = await Promise.all([
    fetchActiveCredits(clientId),
    fetchPartnerDuplaRows(clientId),
  ]);
  const byTrainer = new Map<string, CreditsByTrainer[number]>();
  for (const p of rows) {
    const t = p.trainers;
    const key = p.trainer_id;
    if (!byTrainer.has(key)) {
      byTrainer.set(key, {
        trainerId: key,
        trainerName: t?.profiles?.full_name ?? "—",
        slug: t?.slug ?? "",
        avatarUrl: t?.avatar_url ?? null,
        individual: 0,
        dupla: 0,
      });
    }
    const entry = byTrainer.get(key)!;
    if (p.session_type === "individual") entry.individual += p.sessions_remaining;
    else entry.dupla += p.sessions_remaining;
  }
  // DUO: soma o saldo dupla partilhado do parceiro, criando a entrada do
  // treinador caso o próprio não tenha packs com ele (parceiro pagou tudo).
  for (const p of partnerRows) {
    const key = p.trainer_id;
    if (!byTrainer.has(key)) {
      byTrainer.set(key, {
        trainerId: key,
        trainerName: p.trainerName ?? "—",
        slug: p.slug ?? "",
        avatarUrl: p.avatarUrl,
        individual: 0,
        dupla: 0,
      });
    }
    byTrainer.get(key)!.dupla += p.sessions_remaining;
  }
  return Array.from(byTrainer.values());
}

export async function createPurchase(
  packId: string,
  paymentMethod: PaymentMethod,
  clientId?: string,
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase", {
    p_pack_id: packId,
    p_payment_method: paymentMethod,
    p_client_id: clientId,
  });
  if (error) throw error;
  return data as unknown as string;
}

export async function confirmPurchase(purchaseId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_purchase", { p_purchase_id: purchaseId });
  if (error) throw error;
}

/** Remove N sessões do saldo de um cliente (admin). Devolve quantas
 *  foram efectivamente removidas (<= pedido se nao havia saldo).
 *  `sessionType` (opcional): se passado, só consome packs desse tipo
 *  (individual ou dupla); sem ele, qualquer pack. */
export async function removeClientSessions(
  clientId: string,
  trainerId: string,
  count: number,
  sessionType?: SessionType,
): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("remove_client_sessions", {
    p_client_id: clientId,
    p_trainer_id: trainerId,
    p_count: count,
    p_session_type: sessionType ?? null,
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
  const supabase = await createClient();
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
  const supabase = await createClient();
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
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("cancel_confirmed_purchase", {
    p_purchase_id: purchaseId,
    p_reason: reason,
  });
  if (error) throw error;
}

/**
 * Elimina (hard delete) uma compra/pagamento. Admin/staff. Remove o
 * registo de vez — não fica em "Confirmados"/"Rejeitados"/"Pendentes".
 * A RPC recusa se houver sessões marcadas associadas (FK restrict);
 * nesse caso usar cancelConfirmedPurchase.
 */
export async function deletePurchase(purchaseId: string) {
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("delete_purchase", {
    p_purchase_id: purchaseId,
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
  const supabase = await createClient();
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
  const supabase = await createClient();
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
  const supabase = await createClient();
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
  const supabase = await createClient();
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
  const supabase = await createClient();
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
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_booking_attendance", { p_booking_id: bookingId });
  if (error) throw error;
}

export async function cancelBooking(bookingId: string, reason?: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: bookingId,
    p_reason: reason,
  });
  if (error) throw error;
  // A RPC devolve `true` só quando ESTE cancelamento transitou a sessão de
  // activa → cancelada. Chamadas repetidas (duplo-clique) sobre uma sessão
  // já cancelada devolvem `false` — o caller não deve reenviar email/audit.
  return (data as unknown as boolean) ?? false;
}

/**
 * Decisão do admin sobre um cancelamento tardio do cliente.
 * approve=true devolve a sessão ao saldo (e avisa o cliente); approve=false
 * mantém-na descontada (revertendo uma aprovação anterior, se existir).
 */
export async function reviewLateCancel(bookingId: string, approve: boolean) {
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("review_late_cancel", {
    p_booking_id: bookingId,
    p_approve: approve,
  });
  if (error) throw error;
}

export async function markNoShow(bookingId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_no_show", { p_booking_id: bookingId });
  if (error) throw error;
}

export async function revertNoShow(
  bookingId: string,
  newStatus: "confirmed" | "cancelled",
  refundCredit: boolean,
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_no_show", {
    p_booking_id: bookingId,
    p_new_status: newStatus,
    p_refund_credit: refundCredit,
  });
  if (error) throw error;
}

export async function adjustCredits(purchaseId: string, delta: number, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_credits", {
    p_purchase_id: purchaseId,
    p_delta: delta,
    p_reason: reason,
  });
  if (error) throw error;
}

