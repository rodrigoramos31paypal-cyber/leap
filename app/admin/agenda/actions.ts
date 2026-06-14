"use server";

import { revalidatePath } from "next/cache";
import { revalidateBookingViews, revalidateAvailabilityViews, revalidateCreditsViews } from "@/lib/revalidate";
import {
  confirmAttendance,
  markNoShow,
  cancelBooking,
  createBookingAdmin,
  createPurchase,
  createCustomPurchase,
  confirmPurchase,
} from "@/lib/credits";
import { dispatchBookingConfirmed, dispatchBookingCancelled, dispatchBookingCreated } from "@/lib/email-dispatch";
import { removeBookingFromCalendars, pushBookingToCalendars } from "@/lib/calendar-sync";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import type { SessionType, PaymentMethod } from "@/types/database";
import { randomUUID } from "crypto";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";

export async function confirmAttendanceAction(formData: FormData) {
  const id = String(formData.get("bookingId") ?? "");
  if (!id) return;
  try {
    await confirmAttendance(id);
    await dispatchBookingConfirmed(id).catch(() => {});
    setFlash("Presença confirmada");
  } catch (e) {
    logError("confirmAttendanceAction", e);
    setFlash("Não foi possível confirmar", "error");
  }
  revalidateBookingViews();
}

export async function markNoShowAction(formData: FormData) {
  const id = String(formData.get("bookingId") ?? "");
  if (!id) return;
  try {
    await markNoShow(id);
    setFlash("Marcado como falta");
  } catch (e) {
    logError("markNoShowAction", e);
    setFlash("Não foi possível marcar como falta", "error");
  }
  revalidateBookingViews();
}

export async function cancelAdminAction(formData: FormData) {
  const id = String(formData.get("bookingId") ?? "");
  if (!id) return;
  // Motivo opcional escolhido pelo admin (limitado por segurança).
  // Usamos SEMPRE o formato com "—": cancel_booking faz split por "—" e,
  // quando não há motivo, a parte à direita fica vazia → sem "Motivo:" na
  // notificação. Com motivo → mostra só o motivo escrito pelo trainer.
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const reason = `Cancelado pelo trainer — ${reasonRaw}`;
  try {
    await cancelBooking(id, reason);
    await logAudit("booking_cancel_admin", {
      targetTable: "bookings",
      targetId: id,
      payload: { reason },
    });
    await dispatchBookingCancelled(id, true).catch(() => {});
    await removeBookingFromCalendars(id).catch(() => {});
    setFlash("Sessão cancelada");
  } catch (e) {
    logError("cancelAdminAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "cancelBooking", targetId: id });
    setFlash("Não foi possível cancelar", "error");
  }
  revalidateBookingViews();
}

export async function deleteBlockAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createClient();

  // SEC (C4): trainer_blocked_times não passa por RPC com scope check
  // — a RLS de admin write deixa qualquer trainer/owner apagar
  // qualquer bloqueio. Verificamos aqui que o bloqueio pertence a um
  // trainer dentro do scope do caller. Sem este check, trainer A
  // podia apagar bloqueios de trainer B só com o id.
  const { data: blk } = await supabase
    .from("trainer_blocked_times")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!blk) {
    setFlash("Bloqueio não encontrado", "error");
    return;
  }
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes((blk as any).trainer_id)) {
    setFlash("Sem permissão para remover este bloqueio", "error");
    return;
  }

  await supabase.from("trainer_blocked_times").delete().eq("id", id);
  setFlash("Bloqueio removido");
  revalidateAvailabilityViews();
}

// ════════════════════════════════════════════════════════════════
// createAgendaBookingAction · o trainer clica num horário da Agenda e
// marca uma sessão, escolhendo um cliente JÁ existente ou criando um
// NOVO cliente no momento (sem login: conta "silenciosa" criada por
// service role). Pode descontar 1 sessão do saldo do cliente ou marcar
// como sessão grátis (p_deduct = false).
//
// Devolve { ok, pending } ou { error } para a UI mostrar inline.
// ════════════════════════════════════════════════════════════════
const NOEMAIL_DOMAIN = "sem-email.leap.local";

export async function createAgendaBookingAction(
  formData: FormData,
): Promise<{ ok?: true; error?: string; pending?: boolean }> {
  const trainerId = String(formData.get("trainerId") ?? "");
  const mode = String(formData.get("mode") ?? "existing"); // "existing" | "new"
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const durationMin = Number(formData.get("durationMin") ?? 0);
  const sessionType = (String(formData.get("sessionType") ?? "individual") === "dupla"
    ? "dupla"
    : "individual") as SessionType;
  const deduct = formData.get("deduct") === "on" || formData.get("deduct") === "true";

  // Adicionar sessões/pack ao cliente no mesmo passo (opcional).
  const grant = formData.get("grant") === "on" || formData.get("grant") === "true";
  const grantMode = String(formData.get("grant_mode") ?? "pack"); // "pack" | "custom"
  const grantPackId = String(formData.get("grant_pack_id") ?? "");
  const grantSessions = Number(formData.get("grant_sessions") ?? 0);
  const grantPriceEuros = Number(formData.get("grant_price_euros") ?? 0);
  const ALLOWED_METHODS: PaymentMethod[] = [
    "manual_mbway",
    "manual_revolut",
    "manual_cash",
    "complimentary",
  ];
  const grantMethodRaw = String(formData.get("grant_method") ?? "manual_mbway") as PaymentMethod;
  const grantMethod = ALLOWED_METHODS.includes(grantMethodRaw) ? grantMethodRaw : "manual_mbway";

  if (!trainerId || !date || !time || !durationMin) {
    return { error: "Preenche o dia, a hora e a duração." };
  }

  // SEC: o trainer só pode marcar para um trainer dentro do seu scope.
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes(trainerId)) {
    return { error: "Sem permissão para este treinador." };
  }

  const startsAt = new Date(`${date}T${time}:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Data ou hora inválida." };
  }

  // ── Resolve o cliente (existente ou novo) ───────────────────────
  let clientId = "";
  let isNew = false;
  if (mode === "new") {
    const name = String(formData.get("new_name") ?? "").trim().slice(0, 120);
    const emailRaw = String(formData.get("new_email") ?? "").trim().toLowerCase();
    const phone = String(formData.get("new_phone") ?? "").trim().slice(0, 40) || undefined;
    if (!name) return { error: "Indica o nome do novo cliente." };
    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return { error: "Email inválido." };
    }

    try {
      const admin = createAdminClient();
      // Sem email → gera um placeholder único (a conta tem de ter email).
      const email = emailRaw || `cliente.${randomUUID()}@${NOEMAIL_DOMAIN}`;
      const { data: created, error: authErr } = await admin.auth.admin.createUser({
        email,
        password: randomUUID() + randomUUID(), // aleatória — o cliente nunca faz login
        email_confirm: true, // sem email de confirmação
        user_metadata: { full_name: name, phone, trainer_id: trainerId },
      });
      if (authErr || !created?.user) {
        const m = String(authErr?.message ?? "");
        if (/already|registered|exists/i.test(m)) {
          return { error: "Já existe um cliente com esse email." };
        }
        logError("createAgendaBookingAction:createUser", authErr);
        return { error: "Não foi possível criar o cliente." };
      }
      clientId = created.user.id;
      isNew = true;
      await logAudit("client_create_admin", {
        targetTable: "profiles",
        targetId: clientId,
        payload: { name, hasEmail: !!emailRaw, source: "agenda" },
      });
    } catch (e) {
      logError("createAgendaBookingAction:newClient", e);
      return { error: "Não foi possível criar o cliente." };
    }
  } else {
    clientId = String(formData.get("clientId") ?? "");
    if (!clientId) return { error: "Escolhe um cliente." };
  }

  // ── Adicionar sessões/pack ao cliente (opcional) ────────────────
  // Feito ANTES da marcação e confirmado já, para que (a) o saldo do
  // cliente reflicta as novas sessões e (b) a marcação possa descontar
  // dessas sessões se o trainer assim escolher. Confirmar a compra fá-la
  // contar como pagamento no dashboard/relatórios.
  if (grant) {
    try {
      let purchaseId: string;
      if (grantMode === "custom") {
        if (!Number.isFinite(grantSessions) || grantSessions <= 0) {
          return { error: "Indica um número de sessões válido para adicionar." };
        }
        purchaseId = await createCustomPurchase({
          clientId,
          trainerId,
          sessions: Math.floor(grantSessions),
          priceCents: Math.max(0, Math.round((grantPriceEuros || 0) * 100)),
          sessionType, // mesmo tipo da marcação → o desconto puxa daqui
          paymentMethod: grantMethod,
        });
      } else {
        if (!grantPackId) {
          return { error: "Escolhe um pack para adicionar." };
        }
        purchaseId = await createPurchase(grantPackId, grantMethod, clientId);
      }
      await confirmPurchase(purchaseId);
      await logAudit("pack_grant", {
        targetTable: "purchases",
        targetId: purchaseId,
        payload: { clientId, trainerId, grantMode, method: grantMethod, source: "agenda" },
      });
    } catch (e) {
      logError("createAgendaBookingAction:grant", e);
      return { error: "Não foi possível adicionar as sessões ao cliente." };
    }
  }

  // ── Cria a marcação ─────────────────────────────────────────────
  try {
    const bookingId = await createBookingAdmin({
      trainerId,
      startsAt,
      durationMin,
      sessionType,
      clientId,
      deduct,
    });

    // Best-effort: email só faz sentido se o cliente tiver email real.
    const supabase = createClient();
    const { data: b } = await supabase
      .from("bookings")
      .select("status, profiles:client_id(email)")
      .eq("id", bookingId)
      .single();

    const clientEmail = (b as any)?.profiles?.email as string | null;
    const realEmail = !!clientEmail && !clientEmail.endsWith(`@${NOEMAIL_DOMAIN}`);
    const sideEffects = Promise.allSettled([
      realEmail ? dispatchBookingCreated(bookingId) : Promise.resolve(),
      pushBookingToCalendars(bookingId),
    ]);
    await sideEffects;

    await logAudit("booking_create_admin", {
      targetTable: "bookings",
      targetId: bookingId,
      payload: { clientId, trainerId, sessionType, durationMin, deduct, newClient: isNew },
    });

    const pending = (b as any)?.status === "booked";
    setFlash(pending ? "Marcação criada — a aguardar aceitação" : "Marcação criada");
    revalidateBookingViews(clientId);
    if (grant) revalidateCreditsViews(clientId);
    return { ok: true, pending };
  } catch (e: any) {
    logError("createAgendaBookingAction:book", e);
    if (isAccessDenied(e)) {
      await captureAlert("admin_access_denied", { action: "createAgendaBooking", clientId });
      return { error: "Sem permissão para marcar." };
    }
    const msg = String(e?.message ?? "");
    if (/sem sess(õ|o)es/i.test(msg)) {
      return { error: "Sem sessões para descontar. Desmarca “Descontar sessão” ou atribui um pack." };
    }
    if (/já existe uma marca|bloquead|reservad|não disponível|futuro|duração/i.test(msg)) {
      return { error: msg };
    }
    return { error: "Não foi possível criar a marcação." };
  }
}

export async function addBlockQuickAction(formData: FormData) {
  const trainerId = String(formData.get("trainerId") ?? "");
  let startsAt = String(formData.get("starts_at") ?? "");
  let endsAt = String(formData.get("ends_at") ?? "");
  const date = String(formData.get("date") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  // SEC: limitar tamanho do "motivo" para evitar payloads gigantes.
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const reason = reasonRaw.length > 0 ? reasonRaw : null;

  // Suporta dois formatos: (starts_at + ends_at) ou (date + from + to).
  // BUG-FIX: garantir que tem segundos (`:00`) para máxima fiabilidade na parse.
  if (!startsAt && date && from) startsAt = `${date}T${from}:00`;
  if (!endsAt && date && to) endsAt = `${date}T${to}:00`;

  if (!trainerId || !startsAt || !endsAt) return;

  // SEC: defense-in-depth — confirmar que o trainerId pertence ao scope
  // do utilizador autenticado. RLS já bloqueia clientes, mas isto evita
  // que um trainer crie blocks para outro trainer.
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes(trainerId)) return;

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (end <= start) return;

  const supabase = createClient();
  await supabase.from("trainer_blocked_times").insert({
    trainer_id: trainerId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reason,
  });
  setFlash("Bloqueio criado");
  revalidateAvailabilityViews();
}
