"use server";

import { getAvailableSlots } from "@/lib/availability";
import { createBooking, createRecurringBooking, type RecurringBookingResult } from "@/lib/credits";
import { dispatchBookingCreated } from "@/lib/email-dispatch";
import { pushBookingToCalendars, removeBookingFromCalendars } from "@/lib/calendar-sync";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import type { SessionType } from "@/types/database";

export async function getSlotsAction({
  trainerId,
  dateIso,
  durationMin,
}: {
  trainerId: string;
  dateIso: string;
  durationMin: number;
}) {
  const slots = await getAvailableSlots({
    trainerId,
    date: new Date(dateIso),
    durationMin,
  });
  return {
    slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
  };
}

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
    await dispatchBookingCreated(bookingId).catch(() => {});
    await pushBookingToCalendars(bookingId).catch(() => {});
    // Verifica o status final para a UI mostrar mensagem correcta
    const supabase = createClient();
    const { data: b } = await supabase
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();
    const pending = (b as any)?.status === "booked";
    setFlash(pending ? "Marcação criada — a aguardar aprovação" : "Marcação confirmada");
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
  await dispatchBookingCreated(newId as string).catch(() => {});
  await pushBookingToCalendars(newId as string).catch(() => {});
  await removeBookingFromCalendars(oldBookingId).catch(() => {});

  const { data: b } = await supabase
    .from("bookings")
    .select("status")
    .eq("id", newId as string)
    .single();
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
    for (const id of result.booking_ids) {
      await dispatchBookingCreated(id).catch(() => {});
      await pushBookingToCalendars(id).catch(() => {});
    }
    setFlash(`Criadas ${result.booking_ids.length} marcações`);
    return { ok: true, result };
  } catch (err) {
    logError("bookRecurringAction", err);
    setFlash("Não foi possível marcar a série", "error");
    return { error: "Não foi possível marcar a série. Tenta novamente." };
  }
}
