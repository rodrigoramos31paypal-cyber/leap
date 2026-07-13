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
  redirect("/app/dashboard");
}
