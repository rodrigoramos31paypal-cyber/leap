"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { revalidateAvailabilityViews } from "@/lib/revalidate";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { getCurrentTrainerId } from "@/lib/trainer";
import { requireStaff } from "@/lib/authz";

// ════════════════════════════════════════════════════════════════
// Mudança de palavra-passe do trainer/admin autenticado.
// A sessão prova a identidade — Supabase Auth não exige a password
// actual no `updateUser`. Pedimos confirmação só por UX.
// ════════════════════════════════════════════════════════════════
export async function changeStaffPasswordAction(formData: FormData) {
  await requireStaff();
  const supabase = await createClient();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    await setFlash("A palavra-passe tem de ter pelo menos 8 caracteres.", "error");
    redirect("/admin/definicoes?tab=perfil");
  }
  if (password !== confirm) {
    await setFlash("As palavras-passe não coincidem.", "error");
    redirect("/admin/definicoes?tab=perfil");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logError("changeStaffPasswordAction", error);
    await setFlash("Não foi possível actualizar a palavra-passe.", "error");
    redirect("/admin/definicoes?tab=perfil");
  }
  await setFlash("Palavra-passe actualizada");
  redirect("/admin/definicoes?tab=perfil");
}

export async function saveTrainerBioAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = await createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // H1: nunca confiar no trainerId do form. Owner edita qualquer trainer;
  // um trainer só a si próprio.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    await setFlash("Sem permissão.", "error");
    return;
  }
  // SECURITY (C1): defesa em profundidade — remove <,> a entrada para que
  // o conteudo do trainer nunca contenha markup. O output JSON-LD em
  // /t/[slug] ja e escapado; isto e a 2a camada.
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 500).replace(/[<>]/g, "");
  const fullNameRaw = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const fullName = fullNameRaw.replace(/[<>]/g, "");
  if (!trainerId) return;

  // 1) Bio fica no `trainers` (já existia).
  const { error: bioErr } = await supabase
    .from("trainers")
    .update({ bio })
    .eq("id", trainerId);
  if (bioErr) {
    logError("saveTrainerBioAction:bio", bioErr);
    await setFlash("Não foi possível guardar a biografia", "error");
    return;
  }

  // 2) Nome fica em `profiles.full_name` (do dono do trainer). Self-edits
  // passam pela policy "profiles: self update"; cross-account requer
  // owner. Vamos buscar o profile_id do trainer alvo para suportar
  // ambos os caminhos.
  if (fullName) {
    const { data: tr } = await supabase
      .from("trainers")
      .select("profile_id")
      .eq("id", trainerId)
      .maybeSingle();
    const targetProfileId = (tr as any)?.profile_id as string | undefined;
    if (targetProfileId) {
      const { error: nameErr } = await supabase
        .from("profiles")
        .update({ full_name: fullName })
        .eq("id", targetProfileId);
      if (nameErr) {
        logError("saveTrainerBioAction:name", nameErr);
        await setFlash("Biografia guardada, mas o nome não foi actualizado", "error");
        revalidatePath("/admin/definicoes");
        return;
      }
    }
  }

  await setFlash("Perfil guardado");
  revalidatePath("/admin/definicoes");
}

export async function saveSettingsAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = await createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // H1: ownership — owner edita qualquer trainer; trainer só a si próprio.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    await setFlash("Sem permissão.", "error");
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
      min_booking_notice_hours: Number(formData.get("min_booking_notice") ?? 12),
      low_credits_threshold: Number(formData.get("low_threshold") ?? 2),
      default_pack_validity_days: validity ? Number(validity) : null,
      buffer_between_sessions_min: Number(formData.get("buffer") ?? 0),
      charge_late_cancel: formData.get("charge_late_cancel") === "on",
      charge_no_show: formData.get("charge_no_show") === "on",
      auto_confirm_bookings: formData.get("auto_confirm_bookings") === "on",
      show_cancelled_in_calendar: formData.get("show_cancelled_in_calendar") === "on",
    });
  if (error) { logError("saveSettingsAction", error); await setFlash("Não foi possível guardar definições", "error"); }
  else await setFlash("Definições guardadas");
  revalidatePath("/admin/definicoes");
}

// Resultado serializável devolvido às chamadas do editor de horários. O
// editor (client) usa-o para fazer updates otimistas e mostrar toasts —
// já não dependemos do flash/cookie (que só aparecia na próxima navegação
// e dava a sensação de "não atualizou").
export type AvailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

// Deteta sobreposição entre [aStart,aEnd) e [bStart,bEnd) (strings "HH:MM").
function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && aEnd > bStart;
}

export async function addAvailabilityAction(formData: FormData): Promise<AvailResult> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // H-4 (audit jun/2026): defesa em profundidade. RLS já filtra por
  // _trainer_is_accessible(trainer_id), mas espelhamos o cheque ao
  // nível da app para não dependermos de a policy continuar perfeita.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    return { ok: false, error: "Sem permissão." };
  }
  const dayOfWeek = Number(formData.get("day_of_week") ?? 1);
  const startTime = String(formData.get("start_time") ?? "07:00");
  const endTime = String(formData.get("end_time") ?? "21:00");

  // Validação de intervalo: início < fim. Comparar como strings "HH:MM"
  // funciona porque o formato é fixo e lexicograficamente ordenável.
  if (startTime >= endTime) {
    return { ok: false, error: "A hora de início tem de ser anterior à hora de fim" };
  }

  // Vários intervalos por dia são permitidos (ex.: turno da manhã + da
  // tarde). Só rejeitamos SOBREPOSIÇÕES no mesmo dia — defesa em
  // profundidade para além da validação no cliente.
  const { data: sameDay } = await supabase
    .from("trainer_availability")
    .select("start_time, end_time")
    .eq("trainer_id", trainerId)
    .eq("day_of_week", dayOfWeek);
  for (const r of (sameDay ?? []) as any[]) {
    if (timesOverlap(startTime, endTime, String(r.start_time).slice(0, 5), String(r.end_time).slice(0, 5))) {
      return { ok: false, error: "Este intervalo sobrepõe-se a outro nesse dia." };
    }
  }

  const { data, error } = await supabase
    .from("trainer_availability")
    .insert({
      trainer_id: trainerId,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
    })
    .select("id")
    .single();
  if (error) {
    logError("addAvailabilityAction", error);
    return { ok: false, error: "Não foi possível adicionar disponibilidade" };
  }
  revalidateAvailabilityViews();
  return { ok: true, id: (data as any)?.id };
}

export async function updateAvailabilityAction(formData: FormData): Promise<AvailResult> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const startTime = String(formData.get("start_time") ?? "07:00");
  const endTime = String(formData.get("end_time") ?? "21:00");
  if (!id) return { ok: false, error: "Horário inválido" };
  // H-4: variante por `id` — vai buscar o trainer_id da linha e valida.
  const { data: row } = await supabase
    .from("trainer_availability")
    .select("trainer_id, day_of_week")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Horário não encontrado" };
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    return { ok: false, error: "Sem permissão." };
  }
  if (startTime >= endTime) {
    return { ok: false, error: "A hora de início tem de ser anterior à hora de fim" };
  }

  // Sobreposição com OUTROS intervalos do mesmo dia (exclui o próprio).
  const { data: sameDay } = await supabase
    .from("trainer_availability")
    .select("id, start_time, end_time")
    .eq("trainer_id", row.trainer_id)
    .eq("day_of_week", (row as any).day_of_week);
  for (const r of (sameDay ?? []) as any[]) {
    if (r.id === id) continue;
    if (timesOverlap(startTime, endTime, String(r.start_time).slice(0, 5), String(r.end_time).slice(0, 5))) {
      return { ok: false, error: "Este intervalo sobrepõe-se a outro nesse dia." };
    }
  }

  const { error } = await supabase
    .from("trainer_availability")
    .update({ start_time: startTime, end_time: endTime })
    .eq("id", id);
  if (error) {
    logError("updateAvailabilityAction", error);
    return { ok: false, error: "Não foi possível guardar o horário" };
  }
  revalidateAvailabilityViews();
  return { ok: true };
}

export async function deleteAvailabilityAction(formData: FormData): Promise<AvailResult> {
  const profile = await requireStaff();
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Horário inválido" };
  // H-4: variante por `id`.
  const { data: row } = await supabase
    .from("trainer_availability")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Horário não encontrado" };
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    return { ok: false, error: "Sem permissão." };
  }
  const { error } = await supabase.from("trainer_availability").delete().eq("id", id);
  if (error) {
    logError("deleteAvailabilityAction", error);
    return { ok: false, error: "Não foi possível remover" };
  }
  revalidateAvailabilityViews();
  return { ok: true };
}

export async function deleteBlockAction(formData: FormData) {
  const profile = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  // H-4: variante por `id`.
  const { data: row } = await supabase
    .from("trainer_blocked_times")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) { await setFlash("Bloqueio não encontrado", "error"); return; }
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    await setFlash("Sem permissão.", "error");
    return;
  }
  const { error } = await supabase.from("trainer_blocked_times").delete().eq("id", id);
  if (error) { logError("deleteBlockAction", error); await setFlash("Não foi possível remover bloqueio", "error"); }
  else await setFlash("Bloqueio removido");
  revalidateAvailabilityViews();
}

export async function addBlockAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = await createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // H-4: ownership check explícito ao nível da app.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    await setFlash("Sem permissão.", "error");
    return;
  }
  const { error } = await supabase.from("trainer_blocked_times").insert({
    trainer_id: trainerId,
    starts_at: new Date(String(formData.get("starts_at"))).toISOString(),
    ends_at: new Date(String(formData.get("ends_at"))).toISOString(),
    reason: String(formData.get("reason") ?? "") || null,
  });
  if (error) { logError("addBlockAction", error); await setFlash("Não foi possível criar bloqueio", "error"); }
  else await setFlash("Bloqueio criado");
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
    await setFlash("Escolhe uma imagem primeiro", "error");
    return;
  }

  // Validação básica — duplicada server-side mesmo com bucket
  // file_size_limit/allowed_mime_types, para devolver uma mensagem
  // amigável em vez do erro cru do storage.
  const MAX = 2 * 1024 * 1024;
  if (file.size > MAX) {
    await setFlash("Imagem demasiado grande (máx. 2 MB)", "error");
    return;
  }
  const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  if (!ALLOWED.includes(file.type)) {
    await setFlash("Formato não suportado (usa JPG, PNG ou WEBP)", "error");
    return;
  }

  // Confirma que o caller é mesmo o dono do trainer (defesa em
  // profundidade — RLS já enforça o update, mas evitamos chamadas
  // ao Storage à conta de outro user).
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    await setFlash("Sessão expirada", "error");
    return;
  }
  const { data: ownedTrainer } = await userClient
    .from("trainers")
    .select("id, profile_id")
    .eq("id", trainerId)
    .maybeSingle();
  if (!ownedTrainer || ownedTrainer.profile_id !== user.id) {
    await setFlash("Sem permissão", "error");
    return;
  }

  // Extensão a partir do mime — evitamos confiar no filename original.
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${trainerId}/avatar.${ext}`;

  const admin = createAdminClient();
  const buf = Buffer.from(await file.arrayBuffer());

  // S-15 (audit jun/2026): valida a ASSINATURA do ficheiro (magic-bytes)
  // — não confiar só no Content-Type declarado pelo cliente. Aceita só
  // JPEG/PNG/WEBP reais; qualquer outro conteúdo (mesmo com type forjado
  // para image/png) é rejeitado. Imagens JPG/PNG/WEBP legítimas passam
  // sempre, por isso o fluxo normal não muda.
  const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng =
    buf.length > 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  const isWebp =
    buf.length > 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP";
  if (!isJpg && !isPng && !isWebp) {
    await setFlash("Ficheiro de imagem inválido.", "error");
    return;
  }

  const { error: upErr } = await admin.storage.from("avatars").upload(path, buf, {
    contentType: file.type,
    upsert: true,
    cacheControl: "3600",
  });
  if (upErr) {
    logError("saveTrainerAvatarAction:upload", upErr);
    await setFlash("Não foi possível guardar a foto", "error");
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
    await setFlash("Foto carregada mas não associada — tenta de novo", "error");
    return;
  }

  await setFlash("Foto de perfil actualizada");
  revalidatePath("/admin/definicoes");
  revalidatePath(`/t/[slug]`, "page");
}

export async function removeTrainerAvatarAction(formData: FormData) {
  await requireStaff();
  const trainerId = String(formData.get("trainerId") ?? "");
  if (!trainerId) return;

  const userClient = await createClient();
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

  await setFlash("Foto de perfil removida");
  revalidatePath("/admin/definicoes");
  revalidatePath(`/t/[slug]`, "page");
}

// ════════════════════════════════════════════════════════════════
// Kill-switch · forçar atualização da PWA em todos os dispositivos.
// Bumpa app_config.force_reload_at (0109). As apps abertas (clientes e
// staff) ouvem este valor via realtime/poll (componente AppUpdater) e
// recarregam para a versão mais recente — sem o utilizador ter de
// fechar/reabrir a app. requireStaff() é o boundary de autorização;
// a escrita usa service role porque app_config não tem policy de UPDATE.
// ════════════════════════════════════════════════════════════════
export async function forceAppReloadAction(): Promise<{ ok: boolean }> {
  const profile = await requireStaff();
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await (admin as any)
    .from("app_config")
    .update({ force_reload_at: nowIso, updated_at: nowIso, updated_by: profile.id })
    .eq("id", true);
  if (error) {
    logError("forceAppReloadAction", error);
    return { ok: false };
  }
  return { ok: true };
}
