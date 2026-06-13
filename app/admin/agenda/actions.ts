"use server";

import { revalidatePath } from "next/cache";
import { confirmAttendance, markNoShow, cancelBooking } from "@/lib/credits";
import { dispatchBookingConfirmed, dispatchBookingCancelled } from "@/lib/email-dispatch";
import { removeBookingFromCalendars } from "@/lib/calendar-sync";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
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
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/dashboard");
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
  revalidatePath("/admin/agenda");
}

export async function cancelAdminAction(formData: FormData) {
  const id = String(formData.get("bookingId") ?? "");
  if (!id) return;
  // BUG-FIX: motivo opcional escolhido pelo admin (limitado por segurança).
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 500);
  const reason = reasonRaw.length > 0
    ? `Cancelado pelo trainer — ${reasonRaw}`
    : "Cancelado pelo trainer";
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
  revalidatePath("/admin/agenda");
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
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/definicoes");
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
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/definicoes");
}
