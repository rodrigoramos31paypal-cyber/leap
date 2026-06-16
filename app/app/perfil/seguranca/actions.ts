"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

// ════════════════════════════════════════════════════════════════
// 2FA · server actions de enrollment/desactivação.
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
    qrCode: data.totp.qr_code,
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
    redirect(safeReturn(formData) ?? "/app/perfil?tab=perfil");
  }

  const supabase = createClient();
  const { error } = await (supabase.auth.mfa as any).challengeAndVerify({
    factorId,
    code,
  });
  if (error) {
    logError("confirmEnrollAction", error);
    await supabase.auth.mfa.unenroll({ factorId }).catch(() => {});
    setFlash("Código inválido. Tenta de novo.", "error");
    redirect(safeReturn(formData) ?? "/app/perfil?tab=perfil");
  }

  setFlash("2FA activada com sucesso");
  revalidatePath("/app/perfil");
  revalidatePath("/admin/seguranca");
  redirect(safeReturn(formData) ?? "/app/perfil?tab=perfil");
}

export async function unenrollAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const factorId = String(formData.get("factorId") ?? "");
  if (!factorId) {
    setFlash("Factor não encontrado.", "error");
    redirect(safeReturn(formData) ?? "/app/perfil?tab=perfil");
  }

  const supabase = createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    logError("unenrollAction", error);
    setFlash("Não foi possível desactivar 2FA.", "error");
  } else {
    setFlash("2FA desactivada");
  }
  revalidatePath("/app/perfil");
  revalidatePath("/admin/seguranca");
  redirect(safeReturn(formData) ?? "/app/perfil?tab=perfil");
}

// Whitelist do caminho de retorno após acção 2FA. Permite à UI embutida
// em /app/perfil voltar à tab "Perfil" e ao admin (/admin/seguranca)
// voltar ao seu próprio ecrã, sem expor um open-redirect.
function safeReturn(formData: FormData): string | null {
  const r = String(formData.get("returnTo") ?? "").trim();
  if (
    r === "/app/perfil" ||
    r === "/app/perfil?tab=perfil" ||
    r === "/admin/seguranca"
  ) {
    return r;
  }
  return null;
}
