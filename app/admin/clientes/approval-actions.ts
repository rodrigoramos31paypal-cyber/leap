"use server";

// ════════════════════════════════════════════════════════════════
// Aprovar / rejeitar contas pendentes (auto-registo).
//
//  • approveAccountAction → RPC approve_account (staff, só contas pending).
//  • rejectAccountAction  → anonimiza + bloqueia a conta (mesmo efeito de
//    "apagar conta"), marca approval_status='rejected' e regista quem/quando.
//    Limitado a contas PENDENTES — não serve para apagar clientes ativos.
//
// Sem emails (onboarding privado). Ambas requerem staff; a rejeição é
// restrita a contas pendentes, por isso é segura para trainers.
// ════════════════════════════════════════════════════════════════

import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/authz";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";

export async function approveAccountAction(formData: FormData): Promise<void> {
  await requireStaff();
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) {
    await setFlash("Conta não identificada", "error");
    return;
  }
  try {
    const supabase = await createClient();
    const { error } = await (supabase as any).rpc("approve_account", { p_client_id: clientId });
    if (error) throw error;
    await logAudit("account_approve", { targetTable: "profiles", targetId: clientId });
    await setFlash("Conta aprovada");
  } catch (e) {
    logError("approveAccountAction", e);
    if (isAccessDenied(e)) {
      await captureAlert("admin_access_denied", { action: "approveAccount", clientId });
      await setFlash("Sem permissão para aprovar.", "error");
    } else {
      await setFlash("Não foi possível aprovar (talvez já tenha sido decidida).", "error");
    }
  }
  revalidatePath("/admin/clientes");
}

export async function rejectAccountAction(formData: FormData): Promise<void> {
  const me = await requireStaff();
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) {
    await setFlash("Conta não identificada", "error");
    return;
  }

  const supabase = await createClient();

  // Só contas PENDENTES podem ser rejeitadas por aqui (limita o "apagar" a
  // contas por aprovar — não é um atalho para remover clientes ativos).
  const { data: target } = await (supabase as any)
    .from("profiles")
    .select("role, approval_status")
    .eq("id", clientId)
    .maybeSingle();
  if (!target || (target as any).role !== "client" || (target as any).approval_status !== "pending") {
    await setFlash("Esta conta não está pendente.", "error");
    return;
  }

  // Anonimização + lockout via service role (mesmo efeito de "apagar conta").
  const admin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Apaga dados pessoais espalhados (paridade com adminDeleteClientAction).
  const PERSONAL_DATA: Array<{ table: string; column: string }> = [
    { table: "session_notes", column: "author_id" },
    { table: "notifications", column: "user_id" },
    { table: "calendar_integrations", column: "user_id" },
    { table: "push_subscriptions", column: "user_id" },
    { table: "notification_preferences", column: "user_id" },
    { table: "engagement_alerts", column: "user_id" },
    { table: "booking_reminders", column: "recipient_id" },
  ];
  for (const { table, column } of PERSONAL_DATA) {
    const { error: delErr } = await (admin as any).from(table).delete().eq(column, clientId);
    if (delErr) {
      logError(`rejectAccountAction:delete:${table}`, delErr);
      await setFlash("Não foi possível remover todos os dados da conta.", "error");
      return;
    }
  }

  // Anonimiza o perfil + marca rejeitada (regista quem/quando).
  const { error: anonErr } = await (admin as any)
    .from("profiles")
    .update({
      full_name: "Cliente removido",
      email: `apagado+${clientId}@removido.invalid`,
      phone: null,
      access_blocked: true,
      approval_status: "rejected",
      approval_decided_at: new Date().toISOString(),
      approval_decided_by: me.id,
    })
    .eq("id", clientId);
  if (anonErr) {
    logError("rejectAccountAction:anonymize", anonErr);
    await setFlash("Não foi possível rejeitar a conta.", "error");
    return;
  }

  // M2 (audit jul/2026): revoga trusted-devices ao rejeitar/bloquear a conta.
  await (admin as any).from("trusted_devices").delete().eq("user_id", clientId);

  // Bloqueia o login (auth) — best-effort.
  try {
    const { error: banErr } = await admin.auth.admin.updateUserById(clientId, {
      email: `apagado+${clientId}@removido.invalid`,
      ban_duration: "876000h",
      user_metadata: {},
    });
    if (banErr) logError("rejectAccountAction:ban", banErr);
  } catch (e) {
    logError("rejectAccountAction:ban", e);
  }

  await logAudit("account_reject", { targetTable: "profiles", targetId: clientId });
  await setFlash("Conta rejeitada e removida");
  revalidatePath("/admin/clientes");
}
