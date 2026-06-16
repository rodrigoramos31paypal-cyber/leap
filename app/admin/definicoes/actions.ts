"use server";

import { revalidatePath } from "next/cache";
import { revalidateAvailabilityViews } from "@/lib/revalidate";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { getCurrentTrainerId } from "@/lib/trainer";
import { requireStaff } from "@/lib/authz";

export async function saveTrainerBioAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // H1: nunca confiar no trainerId do form. Owner edita qualquer trainer;
  // um trainer só a si próprio.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  // SECURITY (C1): defesa em profundidade — remove <,> a entrada para que
  // o conteudo do trainer nunca contenha markup. O output JSON-LD em
  // /t/[slug] ja e escapado; isto e a 2a camada.
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 500).replace(/[<>]/g, "");
  if (!trainerId) return;
  const { error } = await supabase.from("trainers").update({ bio }).eq("id", trainerId);
  if (error) { logError("saveTrainerBioAction", error); setFlash("Não foi possível guardar a biografia", "error"); }
  else setFlash("Biografia guardada");
  revalidatePath("/admin/definicoes");
}

export async function saveSettingsAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // H1: ownership — owner edita qualquer trainer; trainer só a si próprio.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
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
  const profile = await requireStaff();
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // H-4 (audit jun/2026): defesa em profundidade. RLS já filtra por
  // _trainer_is_accessible(trainer_id), mas espelhamos o cheque ao
  // nível da app para não dependermos de a policy continuar perfeita.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
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
  revalidateAvailabilityViews();
}

export async function updateAvailabilityAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
  const startTime = String(formData.get("start_time") ?? "07:00");
  const endTime = String(formData.get("end_time") ?? "21:00");
  if (!id) return;
  // H-4: variante por `id` — vai buscar o trainer_id da linha e valida.
  const { data: row } = await supabase
    .from("trainer_availability")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) { setFlash("Horário não encontrado", "error"); return; }
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  if (startTime >= endTime) {
    setFlash("A hora de início tem de ser anterior à hora de fim", "error");
    revalidatePath("/admin/definicoes");
    return;
  }
  const { error } = await supabase
    .from("trainer_availability")
    .update({ start_time: startTime, end_time: endTime })
    .eq("id", id);
  if (error) { logError("updateAvailabilityAction", error); setFlash("Não foi possível guardar o horário", "error"); }
  else setFlash("Horário actualizado");
  revalidateAvailabilityViews();
}

export async function deleteAvailabilityAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // H-4: variante por `id`.
  const { data: row } = await supabase
    .from("trainer_availability")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) { setFlash("Horário não encontrado", "error"); return; }
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  const { error } = await supabase.from("trainer_availability").delete().eq("id", id);
  if (error) { logError("deleteAvailabilityAction", error); setFlash("Não foi possível remover", "error"); }
  else setFlash("Disponibilidade removida");
  revalidateAvailabilityViews();
}

export async function deleteBlockAction(formData: FormData) {
  const profile = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createClient();
  // H-4: variante por `id`.
  const { data: row } = await supabase
    .from("trainer_blocked_times")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) { setFlash("Bloqueio não encontrado", "error"); return; }
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  const { error } = await supabase.from("trainer_blocked_times").delete().eq("id", id);
  if (error) { logError("deleteBlockAction", error); setFlash("Não foi possível remover bloqueio", "error"); }
  else setFlash("Bloqueio removido");
  revalidateAvailabilityViews();
}

export async function addBlockAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // H-4: ownership check explícito ao nível da app.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  const { error } = await supabase.from("trainer_blocked_times").insert({
    trainer_id: trainerId,
    starts_at: new Date(String(formData.get("starts_at"))).toISOString(),
    ends_at: new Date(String(formData.get("ends_at"))).toISOString(),
    reason: String(formData.get("reason") ?? "") || null,
  });
  if (error) { logError("addBlockAction", error); setFlash("Não foi possível criar bloqueio", "error"); }
  else setFlash("Bloqueio criado");
  revalidateAvailabilityViews();
}


// ════════════════════════════════════════════════════════════════
// Avatar do trainer · upload para Supabase Storage bucket "avatars"
// (criado em 0053_trainer_avatar.sql). Usamos service role para o
// upload — o bucket é público para leitura, mas restringimos writes
// a este caminho server-side. O FormData traz `file` (File) +
// `trainerId`.
// ════════════════════════════════════════════════════════════════
export async function saveTrainerAvatarAction(formData: FormData) {
  await requireStaff();
  const trainerId = String(formData.get("trainerId") ?? "");
  const file = formData.get("file") as File | null;
  if (!trainerId || !file || file.size === 0) {
    setFlash("Escolhe uma imagem primeiro", "error");
    return;
  }

  // Validação básica — duplicada server-side mesmo com bucket
  // file_size_limit/allowed_mime_types, para devolver uma mensagem
  // amigável em vez do erro cru do storage.
  const MAX = 2 * 1024 * 1024;
  if (file.size > MAX) {
    setFlash("Imagem demasiado grande (máx. 2 MB)", "error");
    return;
  }
  const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  if (!ALLOWED.includes(file.type)) {
    setFlash("Formato não suportado (usa JPG, PNG ou WEBP)", "error");
    return;
  }

  // Confirma que o caller é mesmo o dono do trainer (defesa em
  // profundidade — RLS já enforça o update, mas evitamos chamadas
  // ao Storage à conta de outro user).
  const userClient = createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    setFlash("Sessão expirada", "error");
    return;
  }
  const { data: ownedTrainer } = await userClient
    .from("trainers")
    .select("id, profile_id")
    .eq("id", trainerId)
    .maybeSingle();
  if (!ownedTrainer || ownedTrainer.profile_id !== user.id) {
    setFlash("Sem permissão", "error");
    return;
  }

  // Extensão a partir do mime — evitamos confiar no filename original.
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${trainerId}/avatar.${ext}`;

  const admin = createAdminClient();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from("avatars").upload(path, buf, {
    contentType: file.type,
    upsert: true,
    cacheControl: "3600",
  });
  if (upErr) {
    logError("saveTrainerAvatarAction:upload", upErr);
    setFlash("Não foi possível guardar a foto", "error");
    return;
  }

  // Cache-busting: timestamp para o browser pegar logo na nova versão.
  const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
  const publicUrl = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: updErr } = await admin
    .from("trainers")
    .update({ avatar_url: publicUrl })
    .eq("id", trainerId);
  if (updErr) {
    logError("saveTrainerAvatarAction:update", updErr);
    setFlash("Foto carregada mas não associada — tenta de novo", "error");
    return;
  }

  setFlash("Foto de perfil actualizada");
  revalidatePath("/admin/definicoes");
  revalidatePath(`/t/[slug]`, "page");
}

export async function removeTrainerAvatarAction(formData: FormData) {
  await requireStaff();
  const trainerId = String(formData.get("trainerId") ?? "");
  if (!trainerId) return;

  const userClient = createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return;
  const { data: ownedTrainer } = await userClient
    .from("trainers")
    .select("id, profile_id")
    .eq("id", trainerId)
    .maybeSingle();
  if (!ownedTrainer || ownedTrainer.profile_id !== user.id) return;

  const admin = createAdminClient();
  // Tenta apagar todas as extensões possíveis — barato, evita ficheiros órfãos.
  await admin.storage.from("avatars").remove([
    `${trainerId}/avatar.jpg`,
    `${trainerId}/avatar.png`,
    `${trainerId}/avatar.webp`,
  ]);
  await admin.from("trainers").update({ avatar_url: null }).eq("id", trainerId);

  setFlash("Foto de perfil removida");
  revalidatePath("/admin/definicoes");
  revalidatePath(`/t/[slug]`, "page");
}
