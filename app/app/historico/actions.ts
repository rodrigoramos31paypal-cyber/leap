"use server";

import { redirect } from "next/navigation";
import { revalidateBookingViews } from "@/lib/revalidate";
import { cancelBooking } from "@/lib/credits";
import { dispatchBookingCancelled } from "@/lib/email-dispatch";
import { removeBookingFromCalendars } from "@/lib/calendar-sync";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

async function wasRefunded(bookingId: string): Promise<boolean> {
  const supabase = await createClient();
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
    // IDEMPOTÊNCIA: a RPC devolve `true` só quando ESTE pedido cancelou de
    // facto a sessão. Em duplo/triplo-clique (ou reenvio do form), só a 1ª
    // chamada devolve `true`; as seguintes devolvem `false` porque a sessão
    // já está cancelada. Gate no email/audit/calendário evita enviar N
    // cópias do email de cancelamento pela mesma sessão.
    const didCancel = await cancelBooking(bookingId, "Cancelado pelo cliente");
    if (didCancel) {
      // SEC: cancelBooking (RPC) já validou ownership acima. As chamadas
      // abaixo usam service role mas só correm com um bookingId que o
      // cliente comprovou ser seu — e não devolvem dados ao caller.
      const refunded = await wasRefunded(bookingId);
      // Auditoria: cancelamento feito pelo PRÓPRIO cliente. Regista actor
      // (=cliente, via auth.uid()) + IP, para distinguir de cancelamentos
      // de admin (booking_cancel_admin) e de eventuais acessos indevidos.
      await logAudit("booking_cancel_client", {
        targetTable: "bookings",
        targetId: bookingId,
        payload: { refunded },
      });
      await dispatchBookingCancelled(bookingId, refunded).catch(() => {});
      await removeBookingFromCalendars(bookingId).catch(() => {});
      await setFlash(
        refunded ? "Sessão cancelada e devolvida" : "Sessão cancelada (cancelamento tardio)",
      );
    } else {
      // Já estava cancelada (clique repetido) — sucesso silencioso, sem email.
      await setFlash("Esta sessão já tinha sido cancelada");
    }
  } catch (e) {
    logError("cancelBookingAction", e);
    await setFlash("Não foi possível cancelar", "error");
  }
  revalidateBookingViews();
}

export async function rebookAction(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return;
  // REVAMP: já NÃO cancela aqui. Leva o cliente ao agenda em modo
  // reagendamento — a sessão atual só é cancelada quando ele confirmar o
  // novo horário (rescheduleAction → RPC atómica). Se desistir, não perde
  // a sessão.
  redirect(`/app/agenda?reschedule=${bookingId}`);
}
