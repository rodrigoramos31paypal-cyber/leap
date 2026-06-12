"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

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

  const target =
    next && next.startsWith("/") ? next : profile?.role === "client" ? "/app/dashboard" : "/admin/dashboard";

  redirect(target);
}
