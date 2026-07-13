"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function recoverAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const supabase = await createClient();
  // O link de recuperação tem de passar PRIMEIRO por /auth/callback para
  // trocar o `code` por uma sessão (fluxo PKCE do @supabase/ssr). Só
  // depois é que /auth/reset tem sessão para o updateUser({password}).
  // Ir direto a /auth/reset deixava a página sem sessão → o reset falhava.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/auth/callback?next=/auth/reset`,
  });
  // Nunca confirma se o email existe (anti-enumeração).
  redirect("/recuperar?success=1");
}
