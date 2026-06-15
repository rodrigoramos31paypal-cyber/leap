"use server";

import { revalidateTeamViews } from "@/lib/revalidate";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

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
      logError("addTrainerAction:createUser", authErr);
      return { error: "Não foi possível criar a conta do trainer." };
    }
    const userId = created.user.id;

    // 2. promove a trainer (bypass do trigger protect_profile_role usando service role)
    // o trigger usa is_admin() — só bloqueia user normal. Service role passa.
    const { error: profErr } = await admin
      .from("profiles")
      .update({ role: "trainer", full_name: fullName })
      .eq("id", userId);
    if (profErr) {
      logError("addTrainerAction:promote", profErr);
      return { error: "Não foi possível configurar o perfil do trainer." };
    }

    // 3. cria trainer record + settings + horários default
    const { data: tRow, error: tErr } = await admin
      .from("trainers")
      .insert({ profile_id: userId, slug, bio: "Personal Trainer" })
      .select("id")
      .single();
    if (tErr || !tRow) {
      logError("addTrainerAction:createTrainer", tErr);
      return { error: "Não foi possível criar o registo de trainer." };
    }

    await admin.from("trainer_settings").insert({ trainer_id: tRow.id });
    await admin.from("trainer_availability").insert([
      { trainer_id: tRow.id, day_of_week: 1, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 2, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 3, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 4, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 5, start_time: "07:00", end_time: "21:00" },
      { trainer_id: tRow.id, day_of_week: 6, start_time: "08:00", end_time: "13:00" },
    ]);

    revalidateTeamViews();
    setFlash("Trainer criado");
    return { ok: true };
  } catch (e) {
    logError("addTrainerAction", e);
    setFlash("Não foi possível criar trainer", "error");
    return { error: "Não foi possível criar o trainer." };
  }
}

// Gera um slug único para o trainer a partir do nome/email (auto).
async function uniqueTrainerSlug(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  fullName?: string | null,
): Promise<string> {
  const base =
    (fullName || email.split("@")[0] || "trainer")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // remove acentos
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "trainer";
  let slug = base;
  let n = 1;
  // tenta base, base-2, base-3… até encontrar livre
  // (limite defensivo para nunca ciclar para sempre)
  while (n < 100) {
    const { data } = await admin
      .from("trainers")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!data) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Concede acesso de ADMIN a uma conta JÁ REGISTADA, pelo email.
 * A conta passa a ser um espelho do dono: role 'owner' (todas as
 * notificações + gestão total) + registo de trainer (agenda própria,
 * marcável pelos clientes, sem "Sem trainer configurado").
 * Equivalente in-app ao script supabase/scripts/grant_owner_trainer.sql.
 */
export async function grantAdminByEmailAction(
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  try {
    await requireOwner();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!email) {
      setFlash("Indica um email.", "error");
      return { error: "Indica um email." };
    }

    const admin = createAdminClient();

    // 1. A conta tem de estar registada (linha em profiles criada no signup).
    const { data: prof, error: findErr } = await admin
      .from("profiles")
      .select("id, full_name, role")
      .eq("email", email)
      .maybeSingle();
    if (findErr) {
      logError("grantAdminByEmailAction:find", findErr);
      setFlash("Não foi possível procurar a conta.", "error");
      return { error: "Não foi possível procurar a conta." };
    }
    if (!prof) {
      setFlash("Não existe nenhuma conta registada com esse email.", "error");
      return { error: "Conta não registada." };
    }
    const target = prof as { id: string; full_name: string | null; role: string };

    // 2. Promove a owner (se ainda não for).
    if (target.role !== "owner") {
      const { error: roleErr } = await admin
        .from("profiles")
        .update({ role: "owner" })
        .eq("id", target.id);
      if (roleErr) {
        logError("grantAdminByEmailAction:promote", roleErr);
        setFlash("Não foi possível promover a conta.", "error");
        return { error: "Não foi possível promover a conta." };
      }
    }

    // 3. Garante registo de trainer (espelho da agenda do dono).
    const { data: existingT } = await admin
      .from("trainers")
      .select("id")
      .eq("profile_id", target.id)
      .maybeSingle();
    if (!existingT) {
      const slug = await uniqueTrainerSlug(admin, email, target.full_name);
      const { data: tRow, error: tErr } = await admin
        .from("trainers")
        .insert({ profile_id: target.id, slug, bio: "Personal Trainer", active: true })
        .select("id")
        .single();
      if (tErr || !tRow) {
        logError("grantAdminByEmailAction:createTrainer", tErr);
        // role já foi promovido — a conta tem acesso admin, só falta a agenda.
        setFlash("Conta promovida a admin, mas falhou criar a agenda de trainer.", "error");
        return { error: "Falhou criar o registo de trainer." };
      }
      await admin.from("trainer_settings").insert({ trainer_id: tRow.id });
      await admin.from("trainer_availability").insert([
        { trainer_id: tRow.id, day_of_week: 1, start_time: "07:00", end_time: "21:00" },
        { trainer_id: tRow.id, day_of_week: 2, start_time: "07:00", end_time: "21:00" },
        { trainer_id: tRow.id, day_of_week: 3, start_time: "07:00", end_time: "21:00" },
        { trainer_id: tRow.id, day_of_week: 4, start_time: "07:00", end_time: "21:00" },
        { trainer_id: tRow.id, day_of_week: 5, start_time: "07:00", end_time: "21:00" },
        { trainer_id: tRow.id, day_of_week: 6, start_time: "08:00", end_time: "13:00" },
      ]);
    }

    revalidateTeamViews();
    setFlash(`${target.full_name || email} é agora admin.`);
    return { ok: true };
  } catch (e) {
    logError("grantAdminByEmailAction", e);
    setFlash("Não foi possível conceder admin.", "error");
    return { error: "Não foi possível conceder admin." };
  }
}

export async function toggleTrainerActiveAction(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const admin = createAdminClient();
  const { error } = await admin.from("trainers").update({ active }).eq("id", id);
  if (error) { logError("toggleTrainerActiveAction", error); setFlash("Não foi possível alterar o estado", "error"); }
  else setFlash(active ? "Trainer activado" : "Trainer desactivado");
  revalidateTeamViews();
}

/**
 * Remover trainer / Revogar admin.
 *
 * Regra (pedido do dono):
 *   • NEGA se o trainer ainda tem sessões AGENDADAS (futuras e activas)
 *     — primeiro cancela/conclui essas sessões.
 *   • Caso contrário, despromove a conta a CLIENTE: perde acesso de
 *     admin/trainer e passa a ver a app como um cliente normal. O
 *     registo de trainer é apagado se estiver limpo, ou desactivado se
 *     tiver histórico (marcações passadas / compras / séries — FK
 *     restrict impede o delete), preservando o histórico.
 *
 * Usada tanto pelo botão "Remover" (trainers) como "Revogar admin"
 * (contas owner).
 */
export async function demoteTrainerAction(formData: FormData) {
  try {
    const ownerId = await requireOwner();
    const id = String(formData.get("id") ?? "");
    if (!id) { setFlash("Trainer inválido.", "error"); return; }

    const admin = createAdminClient();

    // Carrega o trainer + perfil associado.
    const { data: tr, error: trErr } = await admin
      .from("trainers")
      .select("id, profile_id, profiles:profile_id(full_name, role)")
      .eq("id", id)
      .maybeSingle();
    if (trErr || !tr) {
      logError("demoteTrainerAction:load", trErr);
      setFlash("Trainer não encontrado.", "error");
      return;
    }
    const t = tr as { id: string; profile_id: string; profiles: { full_name: string | null; role: string } | null };
    const profileId = t.profile_id;
    const role = t.profiles?.role ?? "trainer";
    const name = t.profiles?.full_name ?? null;
    const isOwner = role === "owner";

    // Nunca despromover a própria conta.
    if (profileId === ownerId) {
      setFlash("Não podes remover a tua própria conta.", "error");
      return;
    }

    // 1) Sessões AGENDADAS (futuras + activas) → bloqueia.
    const nowIso = new Date().toISOString();
    const { count: scheduled } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("trainer_id", id)
      .in("status", ["booked", "confirmed"])
      .gte("starts_at", nowIso);
    if ((scheduled ?? 0) > 0) {
      setFlash(
        `Tem ${scheduled} sessão(ões) agendada(s). Cancela-as ou conclui antes de ${isOwner ? "revogar" : "remover"}.`,
        "error",
      );
      return;
    }

    // 2) Despromove a conta a cliente.
    const { error: roleErr } = await admin
      .from("profiles")
      .update({ role: "client" })
      .eq("id", profileId);
    if (roleErr) {
      logError("demoteTrainerAction:demote", roleErr);
      setFlash("Não foi possível remover.", "error");
      return;
    }

    // 3) Histórico? (bookings/purchases/séries têm FK restrict → não dá delete)
    const [{ count: bk }, { count: pu }, { count: se }] = await Promise.all([
      admin.from("bookings").select("id", { count: "exact", head: true }).eq("trainer_id", id),
      admin.from("purchases").select("id", { count: "exact", head: true }).eq("trainer_id", id),
      admin.from("booking_series").select("id", { count: "exact", head: true }).eq("trainer_id", id),
    ]);
    const hasHistory = (bk ?? 0) > 0 || (pu ?? 0) > 0 || (se ?? 0) > 0;

    if (hasHistory) {
      // Preserva histórico: desactiva o registo de trainer.
      await admin.from("trainers").update({ active: false }).eq("id", id);
    } else {
      // Limpo: remove o registo (cascata trata settings/horários/blocos).
      await admin.from("trainers").delete().eq("id", id);
    }

    revalidateTeamViews();
    setFlash(
      isOwner
        ? `Admin revogado — ${name ?? "a conta"} passou a cliente.`
        : `Trainer removido — ${name ?? "a conta"} passou a cliente.`,
    );
  } catch (e) {
    logError("demoteTrainerAction", e);
    setFlash("Não foi possível remover.", "error");
  }
}
