"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function resetAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    redirect("/auth/reset?error=" + encodeURIComponent("Mínimo 8 caracteres."));
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/auth/reset?error=" + encodeURIComponent("Não foi possível atualizar."));
  }

  // M5 (audit jul/2026): uma redefinição de password deve EXPULSAR quaisquer
  // sessões abertas noutros dispositivos (potencialmente do atacante). scope
  // "others" revoga todas as outras sessões e mantém a atual (a que acabou de
  // redefinir), para o utilizador seguir para o dashboard sem novo login.
  await supabase.auth.signOut({ scope: "others" }).catch(() => {});

  redirect("/app/dashboard");
}
