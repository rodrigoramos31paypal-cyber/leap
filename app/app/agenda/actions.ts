"use server";

import { createBooking, createRecurringBooking, type RecurringBookingResult } from "@/lib/credits";
import { dispatchBookingCreated } from "@/lib/email-dispatch";
import { pushBookingToCalendars, removeBookingFromCalendars } from "@/lib/calendar-sync";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { revalidateBookingViews } from "@/lib/revalidate";
import type { SessionType } from "@/types/database";

// NOTA (C3): a leitura de slots passou a Route Handler GET /api/slots
// (cacheável + paralelizável). A antiga `getSlotsAction` foi removida.

export async function bookAction({
  trainerId,
  startsAtIso,
  durationMin,
  sessionType,
}: {
  trainerId: string;
  startsAtIso: string;
  durationMin: number;
  sessionType: SessionType;
}): Promise<{ ok?: true; error?: string; pending?: boolean }> {
  try {
    const bookingId = await createBooking({
      trainerId,
      startsAt: new Date(startsAtIso),
      durationMin,
      sessionType,
    });
    // SEC: createBooking (RPC) já validou ownership/regras acima. As
    // chamadas abaixo usam service role mas só sobre um bookingId
    // server-generated — não devolvem dados ao caller.
    //
    // PERF (C2): email + calendário são best-effort e NÃO afectam o registo
    // da marcação (a RPC já fez commit). Disparamo-los em PARALELO — e em
    // paralelo com a leitura do status — em vez de sequencialmente, por isso
    // o utilizador espera max(email, calendário, status) em vez da soma.
    // (Em serverless não podemos "fire-and-forget" de forma fiável sem os
    // perder, por isso aguardamos o batch antes de devolver.)
    const sideEffects = Promise.allSettled([
      dispatchBookingCreated(bookingId),
      pushBookingToCalendars(bookingId),
    ]);

    // Verifica o status final para a UI mostrar mensagem correcta
    const supabase = createClient();
    const { data: b } = await supabase
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();

    await sideEffects;

    const pending = (b as any)?.status === "booked";
    setFlash(pending ? "Marcação criada — a aguardar aprovação" : "Marcação confirmada");
    revalidateBookingViews();
    return { ok: true, pending };
  } catch (err) {
    logError("bookAction", err);
    setFlash("Não foi possível marcar", "error");
    return { error: "Não foi possível marcar. Tenta novamente." };
  }
}

export async function rescheduleAction({
  oldBookingId,
  startsAtIso,
  durationMin,
}: {
  oldBookingId: string;
  startsAtIso: string;
  durationMin: number;
}): Promise<{ ok?: true; error?: string; pending?: boolean }> {
  const supabase = createClient();
  // RPC atómica: devolve crédito da antiga, cancela-a e cria a nova.
  const { data: newId, error } = await (supabase as any).rpc("reschedule_booking", {
    p_old_booking_id: oldBookingId,
    p_starts_at: new Date(startsAtIso).toISOString(),
    p_duration_min: durationMin,
  });
  if (error) {
    logError("rescheduleAction", error);
    return { error: "Não foi possível reagendar. O horário pode já estar ocupado." };
  }

  // Best effort: emails + calendários (a antiga sai, a nova entra).
  // PERF (C2): em PARALELO — antes eram 3 awaits sequenciais.
  const sideEffects = Promise.allSettled([
    dispatchBookingCreated(newId as string),
    pushBookingToCalendars(newId as string),
    removeBookingFromCalendars(oldBookingId),
  ]);

  const { data: b } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", newId as string)
    .single();

  await sideEffects;

  revalidateBookingViews();
  return { ok: true, pending: (b as any)?.status === "booked" };
}

export async function bookRecurringAction({
  trainerId,
  startsAtIso,
  durationMin,
  sessionType,
  sessionsCount,
}: {
  trainerId: string;
  startsAtIso: string;
  durationMin: number;
  sessionType: SessionType;
  sessionsCount: number;
}): Promise<{ ok?: true; error?: string; result?: RecurringBookingResult }> {
  try {
    const result = await createRecurringBooking({
      trainerId,
      startsAt: new Date(startsAtIso),
      durationMin,
      sessionsCount,
      sessionType,
    });
    if (!result.ok) {
      setFlash("Conflitos detectados na série", "error");
      return { error: "Conflitos detectados.", result };
    }
    // PERF (C2): dispara TODAS as notificações/calendários da série em
    // PARALELO. Antes era um loop sequencial: para N sessões, N×2 chamadas
    // externas em série (uma série de 8 semanas = 16 round-trips antes de
    // responder ao utilizador). Agora é um único batch paralelo.
    await Promise.allSettled(
      result.booking_ids.flatMap((id) => [
        dispatchBookingCreated(id),
        pushBookingToCalendars(id),
      ]),
    );
    setFlash(`Criadas ${result.booking_ids.length} marcações`);
    revalidateBookingViews();
    return { ok: true, result };
  } catch (err) {
    logError("bookRecurringAction", err);
    setFlash("Não foi possível marcar a série", "error");
    return { error: "Não foi possível marcar a série. Tenta novamente." };
  }
}
