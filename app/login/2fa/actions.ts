"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, getAuthUser, getCurrentProfile } from "@/lib/supabase/server";
import { listVerifiedFactors, trustThisDevice } from "@/lib/mfa";
import { isSafePath } from "@/lib/utils";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

// Verifica o código TOTP do user logado. Sucesso → eleva AAL,
// opcionalmente confia no device, e redireciona para `next` ou
// para o dashboard apropriado.
export async function verifyChallengeAction(formData: FormData) {
  // M10 (audit jul/2026): fluxo sensível (eleva AAL) → valida o JWT contra o
  // auth server em vez de confiar só no cookie (getSessionUser).
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const code = String(formData.get("code") ?? "").trim();
  const trust = formData.get("trust") === "on";
  const next = formData.get("next");

  if (!/^\d{6}$/.test(code)) {
    await setFlash("Código inválido (6 dígitos).", "error");
    redirect("/login/2fa" + (typeof next === "string" ? `?next=${encodeURIComponent(next)}` : ""));
  }

  const factors = await listVerifiedFactors();
  if (factors.length === 0) {
    // Sem factor → segue para a app sem desafio.
    redirect("/app/dashboard");
  }
  const factorId = factors[0].id;

  const supabase = await createClient();
  const { error } = await (supabase.auth.mfa as any).challengeAndVerify({
    factorId,
    code,
  });
  if (error) {
    logError("verifyChallengeAction", error);
    await setFlash("Código inválido. Tenta de novo.", "error");
    redirect("/login/2fa" + (typeof next === "string" ? `?next=${encodeURIComponent(next)}` : ""));
  }

  // "Confiar neste dispositivo 30 dias"
  if (trust) {
    const h = await headers();
    await trustThisDevice(
      user.id,
      h.get("user-agent") ?? undefined,
      h.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined,
    );
  }

  // Destino seguro
  const profile = await getCurrentProfile();
  const fallback = profile?.role === "client" ? "/app/dashboard" : "/admin/dashboard";
  const target = typeof next === "string" && isSafePath(next) ? next : fallback;
  redirect(target);
}
