"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";

async function requireOwner() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "owner") throw new Error("Acesso restrito ao owner.");
  return user.id;
}

export async function addTrainerAction(formData: FormData): Promise<{ error?: string; ok?: true }> {
  try {
    await requireOwner();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const fullName = String(formData.get("full_name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const password = String(formData.get("password") ?? "");
    if (!email || !fullName || !slug || password.length < 8) {
      return { error: "Campos obrigatórios: email, nome, slug, password (8+ caracteres)." };
    }

    const admin = createAdminClient();

    // 1. cria user em auth
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (authErr || !created.user) {
      return { error: authErr?.message ?? "Erro ao criar conta." };
    }
    const userId = created.user.id;

    // 2. promove a trainer (bypass do trigger protect_profile_role usando service role)
    // o trigger usa is_admin() — só bloqueia user normal. Service role passa.
    const { error: profErr } = await admin
      .from("profiles")
      .update({ role: "trainer", full_name: fullName })
      .eq("id", userId);
    if (profErr) return { error: profErr.message };

    // 3. cria trainer record + settings + horários default
    const { data: tRow, error: tErr } = await admin
      .from("trainers")
      .insert({ profile_id: userId, slug, bio: "Personal Trainer" })
      .select("id")
      .single();
    if (tErr || !tRow) return { error: tErr?.message ?? "Erro ao criar trainer." };

    await admin.from("trainer_settings").insert({ trainer_id: tRow.id });
    await admin.from("trainer_availability").insert([
      { trainer_id: tRow.id, day_of_week: 1, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 2, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 3, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 4, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 5, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 6, start_time: "08:00", end_time: "13:00" },
    ]);

    revalidatePath("/admin/equipa");
    setFlash("Trainer criado");
    return { ok: true };
  } catch (e: any) {
    setFlash("Não foi possível criar trainer", "error", e?.message);
    return { error: e?.message ?? "Erro." };
  }
}

export async function toggleTrainerActiveAction(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const admin = createAdminClient();
  const { error } = await admin.from("trainers").update({ active }).eq("id", id);
  if (error) setFlash("Não foi possível alterar o estado", "error", error.message);
  else setFlash(active ? "Trainer activado" : "Trainer desactivado");
  revalidatePath("/admin/equipa");
}

export async function deleteTrainerAction(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const admin = createAdminClient();
  // não apagamos auth.users para preservar histórico; só remove trainer
  const { error } = await admin.from("trainers").delete().eq("id", id);
  if (error) setFlash("Não foi possível remover trainer", "error", error.message);
  else setFlash("Trainer removido");
  revalidatePath("/admin/equipa");
}
