"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const full_name = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  // Vindo da página pública /t/<slug>: associa o cliente ao trainer
  // logo no insert do profile (handle_new_user lê isto). Inválido → ignorado.
  const trainer_id = String(formData.get("trainer_id") ?? "").trim() || null;

  if (password.length < 8) {
    redirect("/registar?error=" + encodeURIComponent("Password tem de ter pelo menos 8 caracteres."));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: trainer_id ? { full_name, phone, trainer_id } : { full_name, phone },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/callback`,
    },
  });

  if (error) {
    logError("registerAction", error);
    // SEC (H-B, audit jun/2026): anti-enumeração. NÃO distinguir
    // "email já registado" de outros erros — caso contrário um atacante
    // itera emails e descobre quem tem conta (input valioso para
    // credential stuffing). Por simetria com /recuperar, redireccionamos
    // sempre para a página de sucesso: ou a conta foi criada, ou já
    // existia (Supabase manda um email idempotente nesse caso) — em
    // qualquer cenário não há acção útil para o atacante. Quem realmente
    // já tinha conta usa o fluxo "esqueci-me da password".
    redirect("/registar?success=1");
  }

  redirect("/registar?success=1");
}
