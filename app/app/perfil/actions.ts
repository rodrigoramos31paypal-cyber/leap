"use server";

import { redirect } from "next/navigation";
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
