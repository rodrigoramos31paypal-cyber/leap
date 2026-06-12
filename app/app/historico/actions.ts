"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cancelBooking } from "@/lib/credits";
import { dispatchBookingCancelled } from "@/lib/email-dispatch";
import { removeBookingFromCalendars } from "@/lib/calendar-sync";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";

async function wasRefunded(bookingId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from("bookings")
    .select("credit_charged")
    .eq("id", bookingId)
    .single();
  // após cancel: credit_charged=false → reembolsado; true → não reembolsado (tardio)
  return data?.credit_charged === false;
}

export async function cancelBookingAction(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return;
  try {
    await cancelBooking(bookingId, "Cancelado pelo cliente");
    const refunded = await wasRefunded(bookingId);
    await dispatchBookingCancelled(bookingId, refunded).catch(() => {});
    await removeBookingFromCalendars(bookingId).catch(() => {});
    setFlash(
      refunded ? "Sessão cancelada e devolvida" : "Sessão cancelada (cancelamento tardio)",
    );
  } catch (e: any) {
    setFlash("Não foi possível cancelar", "error", e?.message);
  }
  revalidatePath("/app/historico");
  revalidatePath("/app/dashboard");
}

export async function rebookAction(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return;
  try {
    await cancelBooking(bookingId, "Reagendamento pelo cliente");
    const refunded = await wasRefunded(bookingId);
    await dispatchBookingCancelled(bookingId, refunded).catch(() => {});
    await removeBookingFromCalendars(bookingId).catch(() => {});
    setFlash("Sessão cancelada — escolhe novo horário", "info");
  } catch (e: any) {
    setFlash("Não foi possível reagendar", "error", e?.message);
    revalidatePath("/app/historico");
    return;
  }
  revalidatePath("/app/historico");
  revalidatePath("/app/dashboard");
  redirect("/app/agenda?rebook=1");
}
