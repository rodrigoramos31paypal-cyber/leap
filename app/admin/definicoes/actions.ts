"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

export async function saveTrainerBioAction(formData: FormData) {
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 500);
  if (!trainerId) return;
  const { error } = await supabase.from("trainers").update({ bio }).eq("id", trainerId);
  if (error) { logError("saveTrainerBioAction", error); setFlash("Não foi possível guardar a biografia", "error"); }
  else setFlash("Biografia guardada");
  revalidatePath("/admin/definicoes");
}

export async function saveSettingsAction(formData: FormData) {
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  const durations = String(formData.get("slot_durations") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean);
  const validity = formData.get("validity_days");

  // `as any`: show_cancelled_in_calendar ainda não está nos tipos gerados.
  const { error } = await (supabase as any)
    .from("trainer_settings")
    .upsert({
      trainer_id: trainerId,
      slot_durations_min: durations,
      default_slot_duration_min: Number(formData.get("default_duration") ?? 45),
      cancellation_window_hours: Number(formData.get("cancellation_window") ?? 12),
      low_credits_threshold: Number(formData.get("low_threshold") ?? 2),
      default_pack_validity_days: validity ? Number(validity) : null,
      buffer_between_sessions_min: Number(formData.get("buffer") ?? 0),
      charge_late_cancel: formData.get("charge_late_cancel") === "on",
      charge_no_show: formData.get("charge_no_show") === "on",
      auto_confirm_bookings: formData.get("auto_confirm_bookings") === "on",
      show_cancelled_in_calendar: formData.get("show_cancelled_in_calendar") === "on",
    });
  if (error) { logError("saveSettingsAction", error); setFlash("Não foi possível guardar definições", "error"); }
  else setFlash("Definições guardadas");
  revalidatePath("/admin/definicoes");
}

export async function addAvailabilityAction(formData: FormData) {
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  const dayOfWeek = Number(formData.get("day_of_week") ?? 1);
  const startTime = String(formData.get("start_time") ?? "07:00");
  const endTime = String(formData.get("end_time") ?? "21:00");

  // Validação de intervalo: início < fim. Comparar como strings "HH:MM"
  // funciona porque o formato é fixo e lexicograficamente ordenável.
  if (startTime >= endTime) {
    setFlash("A hora de início tem de ser anterior à hora de fim", "error");
    revalidatePath("/admin/definicoes");
    return;
  }

  // Regra: 1 horário por dia da semana. Defesa em profundidade — a UI
  // já filtra o dropdown, mas o action também rejeita duplicados para
  // que um submit direto (curl, JS modificado) não consiga inserir.
  const { data: existing } = await supabase
    .from("trainer_availability")
    .select("id")
    .eq("trainer_id", trainerId)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  if (existing) {
    const DAYS_PT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    setFlash(
      `Já existe um horário para ${DAYS_PT[dayOfWeek] ?? "este dia"}. Elimina o atual antes de adicionar outro.`,
      "error",
    );
    revalidatePath("/admin/definicoes");
    return;
  }

  const { error } = await supabase.from("trainer_availability").insert({
    trainer_id: trainerId,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
  });
  if (error) { logError("addAvailabilityAction", error); setFlash("Não foi possível adicionar disponibilidade", "error"); }
  else setFlash("Disponibilidade adicionada");
  revalidatePath("/admin/definicoes");
}

export async function deleteAvailabilityAction(formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase.from("trainer_availability").delete().eq("id", String(formData.get("id") ?? ""));
  if (error) { logError("deleteAvailabilityAction", error); setFlash("Não foi possível remover", "error"); }
  else setFlash("Disponibilidade removida");
  revalidatePath("/admin/definicoes");
}

export async function deleteBlockAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createClient();
  const { error } = await supabase.from("trainer_blocked_times").delete().eq("id", id);
  if (error) { logError("deleteBlockAction", error); setFlash("Não foi possível remover bloqueio", "error"); }
  else setFlash("Bloqueio removido");
  revalidatePath("/admin/definicoes");
  revalidatePath("/admin/agenda");
}

export async function addBlockAction(formData: FormData) {
  const supabase = createClient();
  const { error } = await supabase.from("trainer_blocked_times").insert({
    trainer_id: String(formData.get("trainerId") ?? ""),
    starts_at: new Date(String(formData.get("starts_at"))).toISOString(),
    ends_at: new Date(String(formData.get("ends_at"))).toISOString(),
    reason: String(formData.get("reason") ?? "") || null,
  });
  if (error) { logError("addBlockAction", error); setFlash("Não foi possível criar bloqueio", "error"); }
  else setFlash("Bloqueio criado");
  revalidatePath("/admin/definicoes");
}
