"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

// ════════════════════════════════════════════════════════════════
// 2FA · server actions de enrollment/desactivação.
//
// Fluxo de enrollment:
//   1. UI chama `startEnrollAction` → enroll() devolve QR + factorId.
//      Mostramos o QR e o secret ao utilizador.
//   2. UI submete o código de 6 dígitos → `confirmEnrollAction` chama
//      challengeAndVerify(). Se ok, o factor passa a 'verified' e está
//      activo. Senão, fica em 'unverified' e tem de ser removido.
// ════════════════════════════════════════════════════════════════

export async function startEnrollAction() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "LEAP-FITNESS",
  });
  if (error || !data) {
    logError("startEnrollAction", error);
    return { error: "Não foi possível iniciar a configuração 2FA. Tenta novamente." };
  }
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code, // svg dataurl
    secret: data.totp.secret,
  };
}

export async function confirmEnrollAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!factorId || !/^\d{6}$/.test(code)) {
    setFlash("Código inválido.", "error");
    redirect("/app/perfil/seguranca");
  }

  const supabase = createClient();
  const { error } = await (supabase.auth.mfa as any).challengeAndVerify({
    factorId,
    code,
  });
  if (error) {
    logError("confirmEnrollAction", error);
    // Apaga o factor unverified para não ficar lixo
    await supabase.auth.mfa.unenroll({ factorId }).catch(() => {});
    setFlash("Código inválido. Tenta de novo.", "error");
    redirect("/app/perfil/seguranca");
  }

  setFlash("2FA activada com sucesso");
  revalidatePath("/app/perfil/seguranca");
  redirect("/app/perfil/seguranca");
}

export async function unenrollAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const factorId = String(formData.get("factorId") ?? "");
  if (!factorId) {
    setFlash("Factor não encontrado.", "error");
    redirect("/app/perfil/seguranca");
  }

  const supabase = createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    logError("unenrollAction", error);
    setFlash("Não foi possível desactivar 2FA.", "error");
  } else {
    setFlash("2FA desactivada");
  }
  revalidatePath("/app/perfil/seguranca");
  redirect("/app/perfil/seguranca");
}
