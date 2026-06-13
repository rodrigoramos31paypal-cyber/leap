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
// Devolve um resultado (NÃO faz redirect) — a navegação é feita no
// cliente. Mais fiável que <form action> + redirect e mostra erros.
export async function deleteAccountAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "APAGAR") {
    return { ok: false, error: "Escreve APAGAR para confirmar." };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada. Volta a entrar." };
  const uid = user.id;

  // 1) Anonimizar dados pessoais via RPC SECURITY DEFINER (limitada a
  //    auth.uid()). Fiável e independente da service-role key no runtime.
  const { error: rpcErr } = await (supabase as any).rpc("anonymize_my_account");
  if (rpcErr) {
    logError("deleteAccountAction:anonymize", rpcErr);
    return { ok: false, error: "Não foi possível apagar a conta. Contacta-nos." };
  }

  // 2) Bloquear o login (remover PII do auth + ban). Só esta parte precisa
  //    da service role; se falhar, os dados pessoais JÁ foram anonimizados.
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

  // 3) Terminar sessão server-side. A navegação para "/" é feita no cliente.
  await supabase.auth.signOut().catch(() => {});
  return { ok: true };
}
