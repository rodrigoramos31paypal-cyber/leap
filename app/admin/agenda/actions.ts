"use server";

import { revalidatePath } from "next/cache";
import { revalidateBookingViews, revalidateAvailabilityViews, revalidateCreditsViews } from "@/lib/revalidate";
import {
  confirmAttendance,
  markNoShow,
  revertNoShow,
  cancelBooking,
  createBookingAdmin,
  rescheduleBookingAdmin,
  createPurchase,
  createCustomPurchase,
  confirmPurchase,
} from "@/lib/credits";
import { dispatchBookingCancelled, dispatchBookingCreated } from "@/lib/email-dispatch";
import { removeBookingFromCalendars, pushBookingToCalendars } from "@/lib/calendar-sync";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import type { SessionType, PaymentMethod } from "@/types/database";
import { randomUUID } from "crypto";
import { setFlash } from "@/lib/flash";
import { logError, userFacingRpcError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";
import { requireStaff } from "@/lib/authz";

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
  // S-10 (audit jun/2026): defesa em profundidade no boundary, igual ao
  // resto das actions admin. As RPCs SECURITY DEFINER (confirm_booking_
  // attendance / mark_no_show / cancel_booking / etc.) já validam staff,
  // mas confiar só nelas é frágil — uma RPC com guard mal escrito = bug
  // de escalada silenciosa. requireStaff() torna a fronteira explícita.
  await requireStaff();
  const id = String(formData.get("bookingId") ?? "");
  if (!id) return;
  try {
    await confirmAttendance(id);
    // Email de "presença confirmada" removido — a notificação in-app
    // ("Marcação aceite") é suficiente para avisar o cliente.
    await setFlash("Marcação aceite");
  } catch (e) {
    logError("confirmAttendanceAction", e);
    await setFlash("Não foi possível confirmar", "error");
  }
  revalidateBookingViews();
}

/**
 * Ajusta a DURAÇÃO de uma sessão (mantém a mesma marcação e hora de
 * início; só muda `ends_at`). Aceita qualquer valor 5–600 min. O bloco
 * na agenda redimensiona-se sozinho após o revalidate.
 */
export async function updateBookingDurationAction(
  formData: FormData,
): Promise<{ ok?: true; conflict?: true; count?: number; error?: string }> {
  // S-10: defense-in-depth no boundary.
  await requireStaff();
  const id = String(formData.get("bookingId") ?? "");
  const durationMin = Math.round(Number(formData.get("durationMin") ?? 0));
  const force = formData.get("force") === "true";
  if (!id) return { error: "Marcação não identificada." };
  if (!durationMin || Number.isNaN(durationMin) || durationMin < 5 || durationMin > 600) {
    return { error: "Duração inválida (5–600 min)." };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await (supabase as any).rpc("update_booking_duration", {
      p_booking_id: id,
      p_duration_min: durationMin,
      p_force: force,
    });
    if (error) throw error;
    const res = (data ?? {}) as { ok?: boolean; conflict?: boolean; count?: number };

    // Sobreposição com outra sessão e ainda não confirmado → devolve o
    // aviso (sem gravar). A UI pergunta se o trainer tem a certeza.
    if (res.ok === false && res.conflict) {
      return { conflict: true, count: res.count ?? 1 };
    }

    // Atualiza o evento no calendário sincronizado (best-effort): remove
    // o antigo e volta a criar com a nova hora de fim. (pushBooking…
    // sozinho INSERE sempre — duplicaria o evento.)
    await removeBookingFromCalendars(id).catch(() => {});
    await pushBookingToCalendars(id).catch(() => {});
    await setFlash(`Duração atualizada para ${durationMin} min.`);
    revalidateBookingViews();
    return { ok: true };
  } catch (e) {
    logError("updateBookingDurationAction", e);
    const friendly = userFacingRpcError(e);
    const msg = friendly ?? "Não foi possível alterar a duração.";
    await setFlash(msg, "error");
    return { error: msg };
  }
}

export async function markNoShowAction(formData: FormData) {
  await requireStaff(); // S-10
  const id = String(formData.get("bookingId") ?? "");
  if (!id) return;
  try {
    await markNoShow(id);
    await setFlash("Marcado como falta");
  } catch (e) {
    logError("markNoShowAction", e);
    await setFlash("Não foi possível marcar como falta", "error");
  }
  revalidateBookingViews();
}

// Reverte uma falta para "confirmada" ou "cancelada", com devolução
// opcional do crédito (escolha do trainer no popover).
export async function revertNoShowAction(formData: FormData) {
  await requireStaff(); // S-10
  const id = String(formData.get("bookingId") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "");
  const refundCredit = String(formData.get("refundCredit") ?? "") === "1";
  if (!id || (newStatus !== "confirmed" && newStatus !== "cancelled")) return;
  try {
    await revertNoShow(id, newStatus, refundCredit);
    await setFlash(
      newStatus === "confirmed"
        ? "Falta revertida para confirmada"
        : "Falta revertida e sessão cancelada",
    );
  } catch (e) {
    logError("revertNoShowAction", e);
    await setFlash("Não foi possível reverter a falta", "error");
  }
  revalidateBookingViews();
  revalidateCreditsViews();
}

export async function cancelAdminAction(formData: FormData) {
  await requireStaff(); // S-10
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
    await setFlash("Sessão cancelada");
  } catch (e) {
    logError("cancelAdminAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "cancelBooking", targetId: id });
    await setFlash("Não foi possível cancelar", "error");
  }
  revalidateBookingViews();
}

export async function deleteBlockAction(formData: FormData) {
  await requireStaff(); // S-10
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();

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
    await setFlash("Bloqueio não encontrado", "error");
    return;
  }
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes((blk as any).trainer_id)) {
    await setFlash("Sem permissão para remover este bloqueio", "error");
    return;
  }

  await supabase.from("trainer_blocked_times").delete().eq("id", id);
  await setFlash("Bloqueio removido");
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
  await requireStaff(); // S-10
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
    return { error: "Sem permissão para este trainer." };
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
    const supabase = await createClient();
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
    await setFlash(pending ? "Marcação criada — a aguardar aceitação" : "Marcação criada");
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
  force?: boolean;
}): Promise<{ ok?: true; error?: string; conflict?: true }> {
  await requireStaff(); // S-10
  const { bookingId, startsAtIso, durationMin, notify, force } = args;
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
      force,
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
    await setFlash("Sessão reagendada");
    revalidateBookingViews();
    return { ok: true };
  } catch (e: any) {
    logError("rescheduleBookingAdminAction", e);
    // Sinal de sobreposição (P0099): não é erro — a UI pergunta se quer
    // reagendar à mesma (depois chama outra vez com force=true).
    if (e?.code === "P0099") {
      return { conflict: true };
    }
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
  await requireStaff(); // S-10
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

  const supabase = await createClient();
  await supabase.from("trainer_blocked_times").insert({
    trainer_id: trainerId,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reason,
  });
  await setFlash("Bloqueio criado");
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
  await requireStaff(); // S-10
  const trainerId = String(formData.get("trainerId") ?? "");
  const mode = String(formData.get("mode") ?? "single"); // "single" | "recurring"
  const date = String(formData.get("date") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const reason = reasonRaw.length > 0 ? reasonRaw : null;

  if (!trainerId) return { error: "Trainer em falta." };
  if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    return { error: "Indica as horas de início e fim." };
  }
  if (to <= from) return { error: "A hora de fim tem de ser depois do início." };

  // SEC: o trainerId tem de estar no scope do utilizador autenticado.
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes(trainerId)) {
    return { error: "Sem permissão para este trainer." };
  }

  const supabase = await createClient();

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

    const uniqueWeekdays = Array.from(new Set(weekdays));
    const rows = uniqueWeekdays.map((dow) => ({
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

    // Limpa "skips" futuros que caiam nos dias-da-semana agora marcados.
    // Um skip é uma excepção "ignora a recorrência nesta data"; se sobrar
    // de um teste antigo (ex: "Só hoje"), esconderia esta nova recorrência
    // nessa data (era o motivo de hoje não aparecer). Removemos apenas os
    // que coincidem com os dias agora marcados, de hoje em diante.
    const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
    const { data: futureSkips } = await (supabase as any)
      .from("trainer_recurring_block_skips")
      .select("id, skip_date")
      .eq("trainer_id", trainerId)
      .gte("skip_date", todayIso);
    const skipIdsToClear = ((futureSkips ?? []) as any[])
      .filter((s) => uniqueWeekdays.includes(new Date(String(s.skip_date) + "T00:00:00Z").getUTCDay()))
      .map((s) => s.id);
    if (skipIdsToClear.length > 0) {
      await (supabase as any)
        .from("trainer_recurring_block_skips")
        .delete()
        .in("id", skipIdsToClear);
    }

    await setFlash("Horário ocupado (recorrente) criado");
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

  await setFlash("Horário ocupado criado");
  revalidateAvailabilityViews();
  return { ok: true };
}

// Remove uma regra recorrente. Com `oldFrom`/`oldTo` remove TODO o grupo
// (todos os dias-da-semana criados juntos com esse intervalo); sem eles,
// remove só a regra `id` (esse dia-da-semana).
export async function deleteRecurringBlockAction(formData: FormData) {
  await requireStaff(); // S-10
  const id = String(formData.get("id") ?? "");
  const oldFrom = String(formData.get("oldFrom") ?? "");
  const oldTo = String(formData.get("oldTo") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const { data: rb } = await (supabase as any)
    .from("trainer_recurring_blocks")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!rb) {
    await setFlash("Recorrência não encontrada", "error");
    return;
  }
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes((rb as any).trainer_id)) {
    await setFlash("Sem permissão para remover esta recorrência", "error");
    return;
  }
  const groupMode = /^\d{2}:\d{2}$/.test(oldFrom) && /^\d{2}:\d{2}$/.test(oldTo);
  let q = (supabase as any).from("trainer_recurring_blocks").delete();
  q = groupMode
    ? q
        .eq("trainer_id", (rb as any).trainer_id)
        .eq("start_time", oldFrom)
        .eq("end_time", oldTo)
    : q.eq("id", id);
  await q;
  await setFlash("Recorrência removida");
  revalidateAvailabilityViews();
}

// Atualiza as horas de um bloqueio pontual (um dia).
export async function updateBlockAction(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  await requireStaff(); // S-10
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
  const supabase = await createClient();
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
  await setFlash("Horário ocupado atualizado");
  revalidateAvailabilityViews();
  return { ok: true };
}

// Atualiza as horas de uma regra recorrente.
//
// Uma "ocupação recorrente" em vários dias da semana é guardada como
// uma regra por dia (ver createBusyAction). Quando o trainer escolhe
// "Todas as semanas", queremos alterar TODOS os dias criados juntos —
// por isso, se vierem `oldFrom`/`oldTo`, atualizamos todas as regras do
// mesmo trainer com esse mesmo intervalo (o "grupo"). Sem eles, altera
// só a regra `id` (esse dia-da-semana).
export async function updateRecurringBlockAction(
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  await requireStaff(); // S-10
  const id = String(formData.get("id") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const oldFrom = String(formData.get("oldFrom") ?? "");
  const oldTo = String(formData.get("oldTo") ?? "");
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const reason = reasonRaw.length > 0 ? reasonRaw : null;
  if (!id || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) {
    return { error: "Dados inválidos." };
  }
  if (to <= from) return { error: "A hora de fim tem de ser depois do início." };
  const supabase = await createClient();
  const { data: rb } = await (supabase as any)
    .from("trainer_recurring_blocks")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!rb) return { error: "Recorrência não encontrada." };
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes((rb as any).trainer_id)) return { error: "Sem permissão." };

  const groupMode = /^\d{2}:\d{2}$/.test(oldFrom) && /^\d{2}:\d{2}$/.test(oldTo);
  let q = (supabase as any)
    .from("trainer_recurring_blocks")
    .update({ start_time: from, end_time: to, reason });
  q = groupMode
    ? q
        .eq("trainer_id", (rb as any).trainer_id)
        .eq("start_time", oldFrom)
        .eq("end_time", oldTo)
    : q.eq("id", id);
  const { error } = await q;
  if (error) {
    logError("updateRecurringBlockAction", error);
    return { error: "Não foi possível atualizar." };
  }
  await setFlash("Recorrência atualizada");
  revalidateAvailabilityViews();
  return { ok: true };
}

// Limpa a recorrência só num dia concreto (cria um "skip" para a data).
export async function skipRecurringDateAction(formData: FormData) {
  await requireStaff(); // S-10
  const trainerId = String(formData.get("trainerId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!trainerId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const accessible = await getAccessibleTrainerIds();
  if (!accessible.includes(trainerId)) {
    await setFlash("Sem permissão", "error");
    return;
  }
  const supabase = await createClient();
  await (supabase as any)
    .from("trainer_recurring_block_skips")
    .upsert({ trainer_id: trainerId, skip_date: date }, { onConflict: "trainer_id,skip_date" });
  await setFlash("Recorrência limpa neste dia");
  revalidateAvailabilityViews();
}
