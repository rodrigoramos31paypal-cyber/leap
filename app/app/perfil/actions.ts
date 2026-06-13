"use server";

import { redirect } from "next/navigation";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

export async function updateProfileAction(formData: FormData) {
  const supabase = createClient();
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
    setFlash("Não foi possível guardar o perfil", "error");
  } else {
    setFlash("Perfil actualizado");
  }
  redirect("/app/perfil?ok=1");
}

// RGPD · apagar conta. NÃO faz hard-delete (a BD tem `on delete restrict`
// em bookings/purchases e há obrigação legal de retenção contabilística).
// Em vez disso: apaga dados pessoais sem retenção, anonimiza o perfil
// (mantém marcações/compras anonimizadas), e bloqueia o login.
export async function deleteAccountAction(formData: FormData) {
  const confirm = String(formData.get("confirm") ?? "").trim();
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const uid = user.id;

  if (confirm !== "APAGAR") {
    setFlash("Confirmação inválida — escreve APAGAR.", "error");
    redirect("/app/perfil");
  }

  const admin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    // 1) Apagar dados pessoais sem obrigação de retenção.
    await admin.from("session_notes").delete().eq("author_id", uid);
    await admin.from("notifications").delete().eq("user_id", uid);
    await admin.from("calendar_integrations").delete().eq("user_id", uid);
    await admin.from("push_subscriptions").delete().eq("user_id", uid);
    await admin.from("notification_preferences").delete().eq("user_id", uid);
    await admin.from("engagement_alerts").delete().eq("user_id", uid);
    await admin.from("booking_reminders").delete().eq("recipient_id", uid);

    // 2) Anonimizar o perfil (marcações/compras passam a referir "Cliente removido").
    await admin
      .from("profiles")
      .update({
        full_name: "Cliente removido",
        email: `apagado+${uid}@removido.invalid`,
        phone: null,
        calendar_feed_token: null,
      })
      .eq("id", uid);

    // 3) Bloquear login + remover PII do registo de auth.
    await admin.auth.admin.updateUserById(uid, {
      email: `apagado+${uid}@removido.invalid`,
      ban_duration: "876000h",
      user_metadata: {},
    });
  } catch (e) {
    logError("deleteAccountAction", e);
    setFlash("Não foi possível apagar a conta. Tenta novamente ou contacta-nos.", "error");
    redirect("/app/perfil");
  }

  // 4) Terminar sessão e sair.
  await supabase.auth.signOut().catch(() => {});
  redirect("/login?deleted=1");
}
