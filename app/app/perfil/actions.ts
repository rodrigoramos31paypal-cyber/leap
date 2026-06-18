"use server";

import { redirect } from "next/navigation";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { revalidateProfileViews } from "@/lib/revalidate";

// Mudar palavra-passe do utilizador autenticado. Supabase permite a
// actualização sem a password actual (a sessão prova a identidade), mas
// pedimos confirmação para evitar erros e exigimos um mínimo de 8 chars
// — igual ao fluxo de reset.
export async function changePasswordAction(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logError("changePasswordAction", error);
    await setFlash("Não foi possível atualizar a palavra-passe.", "error");
    redirect("/app/perfil?tab=perfil");
  }
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
  } catch (e) {
    logError("deleteAccountAction:ban", e);
  }

  await supabase.auth.signOut().catch(() => {});
  await setFlash("Conta apagada");
  revalidateProfileViews(uid);
  return { ok: true };
}
