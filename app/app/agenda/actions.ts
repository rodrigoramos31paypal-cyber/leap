"use server";

import { createBooking, createRecurringBooking, type RecurringBookingResult } from "@/lib/credits";
import { dispatchBookingCreated } from "@/lib/email-dispatch";
import { pushBookingToCalendars, removeBookingFromCalendars } from "@/lib/calendar-sync";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError, userFacingRpcError } from "@/lib/errors";
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
    const supabase = await createClient();
    const { data: b } = await supabase
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();

    await sideEffects;

    const pending = (b as any)?.status === "booked";
    await setFlash(pending ? "Marcação criada — a aguardar aprovação" : "Marcação confirmada");
    revalidateBookingViews();
    return { ok: true, pending };
  } catch (err) {
    logError("bookAction", err);
    const friendly = userFacingRpcError(err);
    await setFlash(friendly ?? "Não foi possível marcar", "error");
    return { error: friendly ?? "Não foi possível marcar. Tenta novamente." };
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
  const supabase = await createClient();
  // RPC atómica: devolve crédito da antiga, cancela-a e cria a nova.
  const { data: newId, error } = await (supabase as any).rpc("reschedule_booking", {
    p_old_booking_id: oldBookingId,
    p_starts_at: new Date(startsAtIso).toISOString(),
    p_duration_min: durationMin,
  });
  if (error) {
    logError("rescheduleAction", error);
    const friendly = userFacingRpcError(error);
    return {
      error: friendly ?? "Não foi possível reagendar. O horário pode já estar ocupado.",
    };
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

    // PARCIAL: a RPC marca as semanas livres e devolve as restantes em
    // `conflicts`. Disparamos side-effects (email/calendário) só para as
    // marcações criadas — em PARALELO (um único batch).
    if (result.booking_ids.length > 0) {
      await Promise.allSettled(
        result.booking_ids.flatMap((id) => [
          dispatchBookingCreated(id),
          pushBookingToCalendars(id),
        ]),
      );
      revalidateBookingViews();
    }

    // Nenhuma semana disponível → nada marcado (devolvemos os conflitos
    // na mesma para a UI poder sugerir alternativas).
    if (result.booked_count === 0) {
      await setFlash("Nenhuma semana disponível para a série", "error");
      return { error: "Nenhuma semana disponível.", result };
    }

    await setFlash(
      result.conflicts.length > 0
        ? `Marcadas ${result.booked_count} de ${result.requested_count} sessões`
        : `Criadas ${result.booked_count} marcações`,
    );
    return { ok: true, result };
  } catch (err) {
    logError("bookRecurringAction", err);
    const friendly = userFacingRpcError(err);
    await setFlash(friendly ?? "Não foi possível marcar a série", "error");
    return { error: friendly ?? "Não foi possível marcar a série. Tenta novamente." };
  }
}
