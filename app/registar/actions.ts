"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const full_name = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();

  if (password.length < 8) {
    redirect("/registar?error=" + encodeURIComponent("Password tem de ter pelo menos 8 caracteres."));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name, phone },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/callback`,
    },
  });

  if (error) {
    logError("registerAction", error);
    const msg = error.message.includes("registered")
      ? "Este email já está registado."
      : "Não foi possível criar a conta.";
    redirect("/registar?error=" + encodeURIComponent(msg));
  }

  redirect("/registar?success=1");
}
