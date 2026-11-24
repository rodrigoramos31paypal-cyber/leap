"use server";

import { revalidatePath } from "next/cache";
import { requireStaff, requireOwner } from "@/lib/authz";
import { randomUUID } from "node:crypto";
import { adminDeleteClientAction } from "@/app/admin/clientes/[id]/actions";
import { dispatchProspectEmails } from "@/lib/prospect-email";
import { isChatId } from "@/lib/chat";
import { createAdminClient } from "@/lib/supabase/server";

export async function setProspectPreference(clientId: string, disposition: "active" | "snoozed" | "declined") {
  const actor = await requireStaff();
  if (!isChatId(clientId) || !["active", "snoozed", "declined"].includes(disposition)) {
    return { error: "Opção inválida." };
  }
  const { data, error } = await (createAdminClient() as any).rpc("leap_prospect_set_preference", {
    p_actor: actor.id, p_client: clientId, p_disposition: disposition,
  });
  if (error || data !== "ok") return { error: "Não foi possível guardar. Atualiza a lista e tenta novamente." };
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/novos-clientes");
  return { ok: true };
}

export async function deleteProspectAccount(clientId: string, confirm: string) {
  const owner = await requireOwner();
  if (!isChatId(clientId) || confirm.trim() !== "APAGAR") return { error: "Escreve APAGAR para confirmar." };
  const db = createAdminClient() as any;
  const { data: id, error } = await db.rpc("leap_prospect_prepare_deletion", {
    p_actor: owner.id, p_client: clientId, p_id: randomUUID(),
  });
  if (error || !id) return { error: "Não é possível eliminar esta conta por aqui. Confirma se tem um email válido, uma sessão marcada ou uma compra de pack." };
  const form = new FormData();
  form.set("clientId", clientId);
  form.set("confirm", "APAGAR");
  const result = await adminDeleteClientAction(form);
  if (!result.ok) return { error: result.error ?? "Não foi possível eliminar a conta." };
  const emailStatus = await dispatchProspectEmails(id).catch(() => "queued" as const);
  revalidatePath("/admin/novos-clientes");
  revalidatePath("/admin/dashboard");
  return { ok: true, emailStatus };
}
