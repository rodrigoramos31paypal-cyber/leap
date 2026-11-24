"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/authz";
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
