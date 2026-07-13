"use server";

import { redirect } from "next/navigation";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { revalidateProfileViews } from "@/lib/revalidate";

// Mudar palavra-passe do utilizador autenticado.
//
// M-3 (audit jul/2026): re-autenticação obrigatória. O Supabase permite
// `updateUser({ password })` só com base na sessão — o que significa que
// uma sessão sequestrada (cookie roubado, device partilhado deixado aberto)
// consegue mudar a password SEM conhecer a atual, consumando o takeover.
// Passamos a exigir a palavra-passe atual e a verificá-la server-side num
// cliente descartável (não toca na sessão vigente). O fluxo de RESET por
// email fica como está — aí a prova de identidade é o link do email.
export async function changePasswordAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const currentPassword = String(formData.get("current_password") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) {
    await setFlash("A palavra-passe tem de ter pelo menos 8 caracteres.", "error");
    redirect("/app/perfil?tab=perfil");
  }
  if (password !== confirm) {
    await setFlash("As palavras-passe não coincidem.", "error");
    redirect("/app/perfil?tab=perfil");
  }

  // Verifica a palavra-passe ATUAL antes de permitir a mudança. Usamos um
  // cliente anónimo descartável (chave anon pública, NUNCA a service_role)
  // com persistSession:false para não interferir com os cookies da sessão
  // real. Se as credenciais não baterem, aborta.
  if (!user.email) {
    await setFlash("Não foi possível verificar a identidade da conta.", "error");
    redirect("/app/perfil?tab=perfil");
  }
  const verifier = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: reauthError } = await verifier.auth.signInWithPassword({
    email: user.email!,
    password: currentPassword,
  });
  if (reauthError) {
    await setFlash("A palavra-passe atual está incorreta.", "error");
    redirect("/app/perfil?tab=perfil");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logError("changePasswordAction", error);
    await setFlash("Não foi possível atualizar a palavra-passe.", "error");
    redirect("/app/perfil?tab=perfil");
  }
  // Auditoria: mudança de palavra-passe pelo próprio utilizador (actor +
  // IP). Antes do redirect — o redirect() lança internamente no Next.
  await logAudit("password_change_self", {
    targetTable: "profiles",
    targetId: user.id,
  });
  await setFlash("Palavra-passe atualizada");
  redirect("/app/perfil?tab=perfil");
}

export async function updateProfileAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const full_name = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  const { error } = await supabase
    .from("profiles")
    .update({ full_name, phone: phone || null })
    .eq("id", user.id);

  if (error) {
    logError("updateProfileAction", error);
    await setFlash("Não foi possível guardar o perfil", "error");
  } else {
    // Auditoria: o cliente alterou o próprio nome/telefone (actor + IP).
    // Antes do redirect, que lança internamente no Next.
    await logAudit("profile_update_self", {
      targetTable: "profiles",
      targetId: user.id,
      payload: { fields: ["full_name", "phone"] },
    });
    await setFlash("Perfil actualizado");
  }
  revalidateProfileViews(user.id);
  redirect("/app/perfil?ok=1");
}

// RGPD · apagar conta. NÃO faz hard-delete (a BD tem `on delete restrict`
// em bookings/purchases e há obrigação legal de retenção contabilística).
// Em vez disso: apaga dados pessoais sem retenção, anonimiza o perfil
// (mantém marcações/compras anonimizadas), e bloqueia o login.
export async function deleteAccountAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "APAGAR") {
    return { ok: false, error: "Escreve APAGAR para confirmar." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada. Volta a entrar." };
  const uid = user.id;

  const { error: rpcErr } = await (supabase as any).rpc("anonymize_my_account");
  if (rpcErr) {
    logError("deleteAccountAction:anonymize", rpcErr);
    return { ok: false, error: "Não foi possível apagar a conta. Tenta de novo ou contacta-nos." };
  }

  // Auditoria: apagar/anonimizar a própria conta. Registamos AGORA, ainda
  // com sessão válida (auth.uid() = uid) — antes do ban/signOut abaixo, que
  // invalidariam o caller e fariam a RPC de auditoria falhar.
  await logAudit("account_delete_self", {
    targetTable: "profiles",
    targetId: uid,
  });

  try {
    const admin = createSupabaseAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: banErr } = await admin.auth.admin.updateUserById(uid, {
      email: `apagado+${uid}@removido.invalid`,
      ban_duration: "876000h",
      user_metadata: {},
    });
    if (banErr) logError("deleteAccountAction:ban", banErr);
    // 0120: lockout total — qualquer outra sessão aberta (outro device)
    // cai no próximo request pelo gate dos layouts.
    const { error: blockErr } = await (admin as any)
      .from("profiles")
      .update({ access_blocked: true })
      .eq("id", uid);
    if (blockErr) logError("deleteAccountAction:block", blockErr);
  } catch (e) {
    logError("deleteAccountAction:ban", e);
  }

  await supabase.auth.signOut().catch(() => {});
  await setFlash("Conta apagada");
  revalidateProfileViews(uid);
  return { ok: true };
}
