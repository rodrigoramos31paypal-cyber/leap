"use server";

import { revalidateTeamViews } from "@/lib/revalidate";
import { createAdminClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
// Guard central único (lib/authz). Antes existia uma cópia local de
// requireOwner aqui — comportamento idêntico, mas duas fontes que
// divergiriam se a central mudasse. Convergido para uma só.
import { requireOwner } from "@/lib/authz";

export async function addTrainerAction(formData: FormData): Promise<{ error?: string; ok?: true }> {
  try {
    await requireOwner();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    // SECURITY (C1): remove <,> do nome (aparece no JSON-LD da pagina publica).
    const fullName = String(formData.get("full_name") ?? "").trim().replace(/[<>]/g, "");
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
    await setFlash("Trainer criado");
    return { ok: true };
  } catch (e) {
    logError("addTrainerAction", e);
    await setFlash("Não foi possível criar trainer", "error");
    return { error: "Não foi possível criar o trainer." };
  }
}

/**
 * Concede acesso de ADMIN a uma conta JÁ REGISTADA, pelo email.
 *
 * A conta passa a OWNER (gestão total + todas as notificações) e
 * PARTILHA o calendário do estúdio — NÃO cria um trainer separado, por
 * isso os clientes NÃO passam a ter de "escolher trainer". Para um
 * calendário próprio (estúdio com vários trainers) usa antes
 * "Adicionar trainer".
 */
export async function grantAdminByEmailAction(
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  try {
    await requireOwner();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!email) {
      await setFlash("Indica um email.", "error");
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
      await setFlash("Não foi possível procurar a conta.", "error");
      return { error: "Não foi possível procurar a conta." };
    }
    if (!prof) {
      await setFlash("Não existe nenhuma conta registada com esse email.", "error");
      return { error: "Conta não registada." };
    }
    const target = prof as { id: string; full_name: string | null; role: string };

    if (target.role === "owner") {
      await setFlash(`${target.full_name || email} já é admin.`);
      return { ok: true };
    }

    // Promove a OWNER. SEM criar trainer — partilha o calendário do
    // estúdio (não introduz a escolha de trainer para os clientes).
    const { error: roleErr } = await admin
      .from("profiles")
      .update({ role: "owner" })
      .eq("id", target.id);
    if (roleErr) {
      logError("grantAdminByEmailAction:promote", roleErr);
      await setFlash("Não foi possível promover a conta.", "error");
      return { error: "Não foi possível promover a conta." };
    }

    revalidateTeamViews();
    await setFlash(`${target.full_name || email} é agora admin.`);
    return { ok: true };
  } catch (e) {
    logError("grantAdminByEmailAction", e);
    await setFlash("Não foi possível conceder admin.", "error");
    return { error: "Não foi possível conceder admin." };
  }
}

/**
 * "Tornar só admin": remove o registo de trainer de uma conta mas mantém
 * o acesso de owner. Deixa de ser trainer marcável e passa a partilhar
 * o calendário do estúdio. Usado para consolidar vários admins num único
 * calendário (deixa de haver escolha de trainer para os clientes).
 *
 * Não remove o ÚLTIMO trainer, nem um trainer com histórico
 * (marcações/compras/séries) — nesse caso há que transferir primeiro.
 */
export async function makeOwnerOnlyAction(formData: FormData) {
  try {
    await requireOwner();
    const id = String(formData.get("id") ?? "");
    if (!id) { await setFlash("Trainer inválido.", "error"); return; }

    const admin = createAdminClient();

    const { count: total } = await admin
      .from("trainers")
      .select("id", { count: "exact", head: true });
    if ((total ?? 0) <= 1) {
      await setFlash("É o único trainer do estúdio — não pode ficar sem calendário.", "error");
      return;
    }

    const { data: tr } = await admin
      .from("trainers")
      .select("id, profile_id, profiles:profile_id(full_name)")
      .eq("id", id)
      .maybeSingle();
    const t = tr as { id: string; profile_id: string; profiles: { full_name: string | null } | null } | null;
    if (!t) { await setFlash("Trainer não encontrado.", "error"); return; }

    const [{ count: bk }, { count: pu }, { count: se }] = await Promise.all([
      admin.from("bookings").select("id", { count: "exact", head: true }).eq("trainer_id", id),
      admin.from("purchases").select("id", { count: "exact", head: true }).eq("trainer_id", id),
      admin.from("booking_series").select("id", { count: "exact", head: true }).eq("trainer_id", id),
    ]);
    if ((bk ?? 0) > 0 || (pu ?? 0) > 0 || (se ?? 0) > 0) {
      await setFlash("Este trainer tem histórico. Transfere o calendário para outra conta primeiro.", "error");
      return;
    }

    await admin.from("profiles").update({ role: "owner" }).eq("id", t.profile_id);
    const { error: delErr } = await admin.from("trainers").delete().eq("id", id);
    if (delErr) {
      logError("makeOwnerOnlyAction:del", delErr);
      await setFlash("Não foi possível remover o calendário.", "error");
      return;
    }

    revalidateTeamViews();
    await setFlash(`${t.profiles?.full_name || "Conta"} é agora só admin (partilha o calendário do estúdio).`);
  } catch (e) {
    logError("makeOwnerOnlyAction", e);
    await setFlash("Não foi possível tornar só admin.", "error");
  }
}

/** Revoga admin de uma conta SEM trainer próprio (secção Admins): volta a cliente. */
export async function revokeAdminByProfileAction(formData: FormData) {
  try {
    const { id: ownerId } = await requireOwner();
    const profileId = String(formData.get("profileId") ?? "");
    if (!profileId) { await setFlash("Conta inválida.", "error"); return; }
    if (profileId === ownerId) {
      await setFlash("Não podes revogar a tua própria conta.", "error");
      return;
    }
    const admin = createAdminClient();
    const { error } = await admin.from("profiles").update({ role: "client" }).eq("id", profileId);
    if (error) {
      logError("revokeAdminByProfileAction", error);
      await setFlash("Não foi possível revogar.", "error");
      return;
    }
    revalidateTeamViews();
    await setFlash("Admin revogado — a conta passou a cliente.");
  } catch (e) {
    logError("revokeAdminByProfileAction", e);
    await setFlash("Não foi possível revogar.", "error");
  }
}

/**
 * "Tornar trainer": move o calendário do estúdio (o único trainer)
 * para esta conta. Passa a ser o trainer marcável; quem o era antes
 * fica como admin (owner) sem calendário. Mantém marcações/histórico —
 * só muda quem controla o registo de trainer. Move "full powers".
 *
 * Só com EXACTAMENTE um trainer (modelo de estúdio único).
 */
export async function makeStudioTrainerAction(formData: FormData) {
  try {
    await requireOwner();
    const profileId = String(formData.get("profileId") ?? "");
    if (!profileId) { await setFlash("Conta inválida.", "error"); return; }

    const admin = createAdminClient();

    const { data: trainers } = await admin.from("trainers").select("id, profile_id");
    const list = (trainers ?? []) as { id: string; profile_id: string }[];
    if (list.length !== 1) {
      await setFlash("Só é possível com um único trainer no estúdio.", "error");
      return;
    }
    if (list[0].profile_id === profileId) {
      await setFlash("Esta conta já é o trainer.", "error");
      return;
    }

    await admin.from("profiles").update({ role: "owner" }).eq("id", profileId);
    const { error: movErr } = await admin
      .from("trainers")
      .update({ profile_id: profileId })
      .eq("id", list[0].id);
    if (movErr) {
      logError("makeStudioTrainerAction:move", movErr);
      await setFlash("Não foi possível transferir o calendário.", "error");
      return;
    }

    revalidateTeamViews();
    await setFlash("Calendário transferido — esta conta é agora o trainer.");
  } catch (e) {
    logError("makeStudioTrainerAction", e);
    await setFlash("Não foi possível transferir.", "error");
  }
}

export async function toggleTrainerActiveAction(formData: FormData) {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const admin = createAdminClient();
  const { error } = await admin.from("trainers").update({ active }).eq("id", id);
  if (error) { logError("toggleTrainerActiveAction", error); await setFlash("Não foi possível alterar o estado", "error"); }
  else await setFlash(active ? "Trainer activado" : "Trainer desactivado");
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
    const { id: ownerId } = await requireOwner();
    const id = String(formData.get("id") ?? "");
    if (!id) { await setFlash("Trainer inválido.", "error"); return; }

    const admin = createAdminClient();

    // Carrega o trainer + perfil associado.
    const { data: tr, error: trErr } = await admin
      .from("trainers")
      .select("id, profile_id, profiles:profile_id(full_name, role)")
      .eq("id", id)
      .maybeSingle();
    if (trErr || !tr) {
      logError("demoteTrainerAction:load", trErr);
      await setFlash("Trainer não encontrado.", "error");
      return;
    }
    const t = tr as { id: string; profile_id: string; profiles: { full_name: string | null; role: string } | null };
    const profileId = t.profile_id;
    const role = t.profiles?.role ?? "trainer";
    const name = t.profiles?.full_name ?? null;
    const isOwner = role === "owner";

    // Nunca despromover a própria conta.
    if (profileId === ownerId) {
      await setFlash("Não podes remover a tua própria conta.", "error");
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
      await setFlash(
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
      await setFlash("Não foi possível remover.", "error");
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
    await setFlash(
      isOwner
        ? `Admin revogado — ${name ?? "a conta"} passou a cliente.`
        : `Trainer removido — ${name ?? "a conta"} passou a cliente.`,
    );
  } catch (e) {
    logError("demoteTrainerAction", e);
    await setFlash("Não foi possível remover.", "error");
  }
}
