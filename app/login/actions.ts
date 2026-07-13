"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSafePath } from "@/lib/utils";
import { listVerifiedFactors, isDeviceTrusted } from "@/lib/mfa";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = formData.get("next");

  const supabase = await createClient();
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent("Email ou password inválidos.")}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, access_blocked")
    .eq("id", data.user!.id)
    .single();

  // 0120: conta bloqueada (ban / apagada). O ban no GoTrue já faz o
  // signInWithPassword falhar na maioria dos casos; este check é defesa
  // em profundidade e dá uma mensagem clara. Termina a sessão recém-criada.
  if ((profile as any)?.access_blocked) {
    await supabase.auth.signOut().catch(() => {});
    redirect(
      `/login?error=${encodeURIComponent("A tua conta foi bloqueada. Contacta o estúdio.")}`,
    );
  }

  // SEC (C3): isSafePath rejeita `//evil.com`, etc.
  const fallback = profile?.role === "client" ? "/app/dashboard" : "/admin/dashboard";
  const target = isSafePath(next) ? next : fallback;

  // 2FA gate: se tem factor verificado e o device NÃO está confiado,
  // manda para o desafio (preserva `next` para depois). signInWithPassword
  // deixa a sessão em AAL1; só o challengeAndVerify a eleva para AAL2.
  const factors = await listVerifiedFactors();
  if (factors.length > 0) {
    const trusted = await isDeviceTrusted(data.user!.id);
    if (!trusted) {
      const url = `/login/2fa?next=${encodeURIComponent(target)}`;
      redirect(url);
    }
  }

  redirect(target);
}
