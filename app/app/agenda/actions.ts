"use server";

import { getAvailableSlots } from "@/lib/availability";
import { createBooking, createRecurringBooking, type RecurringBookingResult } from "@/lib/credits";
import { dispatchBookingCreated } from "@/lib/email-dispatch";
import { pushBookingToCalendars } from "@/lib/calendar-sync";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
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
  } catch (err: any) {
    setFlash("Não foi possível marcar", "error", err?.message);
    return { error: err?.message ?? "Erro ao marcar." };
  }
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
  } catch (err: any) {
    setFlash("Não foi possível marcar a série", "error", err?.message);
    return { error: err?.message ?? "Erro ao marcar série." };
  }
}
