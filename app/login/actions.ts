"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSafePath } from "@/lib/utils";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = formData.get("next");

  const supabase = createClient();
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent("Email ou password inválidos.")}`);
  }

  // descobre role para redirect
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user!.id)
    .single();

  // SEC (C3): isSafePath rejeita `//evil.com`, `\\evil.com`, URLs com
  // scheme e caracteres de controlo. `startsWith("/")` sozinho deixava
  // passar protocol-relative URLs → open redirect.
  const fallback = profile?.role === "client" ? "/app/dashboard" : "/admin/dashboard";
  const target = isSafePath(next) ? next : fallback;

  redirect(target);
}
