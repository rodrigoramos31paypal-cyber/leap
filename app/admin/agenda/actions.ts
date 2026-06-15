"use server";

import { revalidatePath } from "next/cache";
import { revalidateBookingViews, revalidateAvailabilityViews, revalidateCreditsViews } from "@/lib/revalidate";
import {
  confirmAttendance,
  markNoShow,
  cancelBooking,
  createBookingAdmin,
  rescheduleBookingAdmin,
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

// ────────────────────────────────────────────────────────────────
// lisbonWallClockToUTC · interpreta um par (date, time) submetido
// por um formulário do trainer como hora-de-parede em Europe/Lisbon
// e devolve o instante UTC equivalente.
//
// Porquê: estas server actions correm em Vercel (UTC). Construir
// `new Date("2026-06-15T10:15:00")` no servidor interpreta a string
// como hora LOCAL do runtime (UTC) → o slot "10:15" submetido pelo
// trainer ficaria gravado como 10:15 UTC = 11:15 PT em horário de
// Verão. Esta função alinha sempre a interpretação a Europe/Lisbon,
// independentemente do TZ do runtime. Trata DST automaticamente.
// ────────────────────────────────────────────────────────────────
function lisbonWallClockToUTC(dateIso: string, timeHHMM: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  if (!/^\d{2}:\d{2}$/.test(timeHHMM)) return null;
  // 1. Primeiro palpite: trata a string como se fosse UTC.
  const naive = new Date(`${dateIso}T${timeHHMM}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  // 2. Lê o que esse instante mostra no relógio de Lisboa.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(naive);
  const lh = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const lm = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
  const [wantH, wantM] = timeHHMM.split(":").map((n) => parseInt(n, 10));
  // 3. Corrige pela diferença (em Verão é +60 min, no Inverno 0).
  const diffMin = (lh * 60 + lm) - (wantH * 60 + wantM);
  return new Date(naive.getTime() - diffMin * 60_000);
}

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

  const startsAt = lisbonWallClockToUTC(date, time);
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
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

// ════════════════════════════════════════════════════════════════
// rescheduleBookingAdminAction · drag-and-drop na Agenda. Move uma
// marcação para novo dia/hora (mesma semana visível). O calendário do
// trainer é sempre actualizado; o cliente só é notificado (in-app/push
// via RPC + email aqui) se `notify` estiver ligado.
// ════════════════════════════════════════════════════════════════
export async function rescheduleBookingAdminAction(args: {
  bookingId: string;
  startsAtIso: string;
  durationMin: number;
  notify: boolean;
}): Promise<{ ok?: true; error?: string }> {
  const { bookingId, startsAtIso, durationMin, notify } = args;
  if (!bookingId || !startsAtIso || !durationMin) {
    return { error: "Dados em falta para reagendar." };
  }
  const startsAt = new Date(startsAtIso);
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "Data ou hora inválida." };
  }

  try {
    const newId = await rescheduleBookingAdmin({
      oldBookingId: bookingId,
      startsAt,
      durationMin,
      notifyClient: notify,
    });

    // Calendário do trainer: sempre actualizado (sai a antiga, entra a nova).
    // Email ao cliente: só se notify. (In-app/push já tratados pela RPC.)
    await Promise.allSettled([
      notify ? dispatchBookingCreated(newId) : Promise.resolve(),
      pushBookingToCalendars(newId),
      removeBookingFromCalendars(bookingId),
    ]);

    await logAudit("booking_reschedule_admin", {
      targetTable: "bookings",
      targetId: newId,
      payload: { from: bookingId, notify },
    });
    setFlash("Sessão reagendada");
    revalidateBookingViews();
    return { ok: true };
  } catch (e: any) {
    logError("rescheduleBookingAdminAction", e);
    if (isAccessDenied(e)) {
      await captureAlert("admin_access_denied", { action: "rescheduleBooking", targetId: bookingId });
      return { error: "Sem permissão para reagendar." };
    }
    const msg = String(e?.message ?? "");
    if (/já existe uma marca|bloquead|reservad|não disponível|futuro|duração|decorreu|sem sess/i.test(msg)) {
      return { error: msg };
    }
    return { error: "Não foi possível reagendar." };
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

  if (!trainerId) return;

  // Resolve start/end: o caso comum é (date + from + to) — interpretado
  // como wall-clock Europe/Lisbon. O fallback (starts_at + ends_at) já
  // vem como ISO completa do cliente.
  let start: Date | null = null;
  let end: Date | null = null;
  if (date && from && to) {
    start = lisbonWallClockToUTC(date, from);
    end = lisbonWallClockToUTC(date, to);
  } else if (startsAt && endsAt) {
    start = new Date(startsAt);
    end = new Date(endsAt);
  }
  if (!start || !end) return;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  if (end <= start) return;

  // SEC: defense-in-depth — confirmar que o trainerId pertence ao scope
  // do utilizador autenticado. RLS já bloqueia clientes, mas isto evita
  // que um trainer crie blocks para outro trainer.
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes(trainerId)) return;

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

// ════════════════════════════════════════════════════════════════
// createBusyAction · novo separador "Ocupado" no diálogo da Agenda.
// Marca um intervalo de horas como indisponível para marcações de
// clientes (o trainer pode sempre sobrepor uma sessão por cima).
//
//   • mode = "single"    → bloqueio pontual só naquele dia
//                          (trainer_blocked_times). Se replaceRecurring
//                          estiver ligado, cria também um "skip" para
//                          limpar a recorrência nesse dia (permite
//                          ajustar a recorrência num dia específico).
//   • mode = "recurring" → regra semanal indefinida para os dias-da-
//                          semana escolhidos (trainer_recurring_blocks).
// ════════════════════════════════════════════════════════════════
export async function createBusyAction(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const trainerId = String(formData.get("trainerId") ?? "");
  const mode = String(formData.get("mode") ?? "single"); // "single" | "recurring"
  const date = String(formData.get("date") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const reason = reasonRaw.length > 0 ? reasonRaw : null;

  if (!trainerId) return { error: "Treinador em falta." };
  if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    return { error: "Indica as horas de início e fim." };
  }
  if (to <= from) return { error: "A hora de fim tem de ser depois do início." };

  // SEC: o trainerId tem de estar no scope do utilizador autenticado.
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes(trainerId)) {
    return { error: "Sem permissão para este treinador." };
  }

  const supabase = createClient();

  if (mode === "recurring") {
    // Dias-da-semana (0=domingo … 6=sábado). Default: o dia clicado.
    let weekdays = String(formData.get("weekdays") ?? "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (weekdays.length === 0 && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      weekdays = [new Date(date + "T00:00:00Z").getUTCDay()];
    }
    if (weekdays.length === 0) return { error: "Escolhe pelo menos um dia da semana." };

    const rows = Array.from(new Set(weekdays)).map((dow) => ({
      trainer_id: trainerId,
      day_of_week: dow,
      start_time: from,
      end_time: to,
      reason,
    }));
    const { error } = await (supabase as any).from("trainer_recurring_blocks").insert(rows);
    if (error) {
      logError("createBusyAction:recurring", error);
      return { error: "Não foi possível criar o horário ocupado." };
    }
    setFlash("Horário ocupado (recorrente) criado");
    revalidateAvailabilityViews();
    return { ok: true };
  }

  // single
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Indica o dia." };
  const start = lisbonWallClockToUTC(date, from);
  const end = lisbonWallClockToUTC(date, to);
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { error: "Data ou horas inválidas." };
  }

  const { error: insErr } = await supabase.from("trainer_blocked_times").insert({
    trainer_id: trainerId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reason,
  });
  if (insErr) {
    logError("createBusyAction:single", insErr);
    return { error: "Não foi possível criar o horário ocupado." };
  }

  // Substituir a recorrência neste dia → cria um "skip" para a data.
  const replaceRecurring = formData.get("replaceRecurring") === "true";
  if (replaceRecurring) {
    await (supabase as any)
      .from("trainer_recurring_block_skips")
      .upsert({ trainer_id: trainerId, skip_date: date }, { onConflict: "trainer_id,skip_date" });
  }

  setFlash("Horário ocupado criado");
  revalidateAvailabilityViews();
  return { ok: true };
}

// Remove uma regra recorrente inteira (todas as semanas).
export async function deleteRecurringBlockAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createClient();
  const { data: rb } = await (supabase as any)
    .from("trainer_recurring_blocks")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!rb) {
    setFlash("Recorrência não encontrada", "error");
    return;
  }
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes((rb as any).trainer_id)) {
    setFlash("Sem permissão para remover esta recorrência", "error");
    return;
  }
  await (supabase as any).from("trainer_recurring_blocks").delete().eq("id", id);
  setFlash("Recorrência removida");
  revalidateAvailabilityViews();
}

// Atualiza as horas de um bloqueio pontual (um dia).
export async function updateBlockAction(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const id = String(formData.get("id") ?? "");
  const date = String(formData.get("date") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const reason = reasonRaw.length > 0 ? reasonRaw : null;
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    return { error: "Dados inválidos." };
  }
  if (to <= from) return { error: "A hora de fim tem de ser depois do início." };
  const supabase = createClient();
  const { data: blk } = await supabase
    .from("trainer_blocked_times")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!blk) return { error: "Bloqueio não encontrado." };
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes((blk as any).trainer_id)) return { error: "Sem permissão." };
  const start = lisbonWallClockToUTC(date, from);
  const end = lisbonWallClockToUTC(date, to);
  if (!start || !end || end <= start) return { error: "Horas inválidas." };
  const { error } = await supabase
    .from("trainer_blocked_times")
    .update({ starts_at: start.toISOString(), ends_at: end.toISOString(), reason })
    .eq("id", id);
  if (error) {
    logError("updateBlockAction", error);
    return { error: "Não foi possível atualizar." };
  }
  setFlash("Horário ocupado atualizado");
  revalidateAvailabilityViews();
  return { ok: true };
}

// Atualiza as horas de uma regra recorrente (todas as semanas).
export async function updateRecurringBlockAction(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const id = String(formData.get("id") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const reason = reasonRaw.length > 0 ? reasonRaw : null;
  if (!id || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    return { error: "Dados inválidos." };
  }
  if (to <= from) return { error: "A hora de fim tem de ser depois do início." };
  const supabase = createClient();
  const { data: rb } = await (supabase as any)
    .from("trainer_recurring_blocks")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!rb) return { error: "Recorrência não encontrada." };
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes((rb as any).trainer_id)) return { error: "Sem permissão." };
  const { error } = await (supabase as any)
    .from("trainer_recurring_blocks")
    .update({ start_time: from, end_time: to, reason })
    .eq("id", id);
  if (error) {
    logError("updateRecurringBlockAction", error);
    return { error: "Não foi possível atualizar." };
  }
  setFlash("Recorrência atualizada");
  revalidateAvailabilityViews();
  return { ok: true };
}

// Limpa a recorrência só num dia concreto (cria um "skip" para a data).
export async function skipRecurringDateAction(formData: FormData) {
  const trainerId = String(formData.get("trainerId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!trainerId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes(trainerId)) {
    setFlash("Sem permissão", "error");
    return;
  }
  const supabase = createClient();
  await (supabase as any)
    .from("trainer_recurring_block_skips")
    .upsert({ trainer_id: trainerId, skip_date: date }, { onConflict: "trainer_id,skip_date" });
  setFlash("Recorrência limpa neste dia");
  revalidateAvailabilityViews();
}
