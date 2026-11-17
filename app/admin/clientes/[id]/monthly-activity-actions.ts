"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/server";

export async function saveMonthlyActivityTotal(input: {
  clientId: string;
  month: string;
  expected: number;
  total: number;
}): Promise<{ ok: true } | { error: string }> {
  const actor = await requireStaff();
  const { clientId, month, expected, total } = input;
  if (!Number.isSafeInteger(total) || total < 0 || total > 100000 || !Number.isSafeInteger(expected)) {
    return { error: "Indica um total inteiro válido." };
  }
  const db = createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  const { data, error } = await db.rpc("set_admin_client_month_activities", {
    p_client: clientId, p_actor: actor.id, p_month: month, p_expected: expected, p_total: total,
  });
  if (data === "stale") return { error: "O mês ou o total mudou. Fecha e abre novamente o indicador." };
  if (error || data !== "ok") return { error: "Não foi possível atualizar as atividades." };
  revalidatePath(`/admin/clientes/${clientId}`);
  revalidatePath("/admin/leaderboard");
  revalidatePath("/app/leaderboard");
  revalidatePath("/app/perfil");
  return { ok: true };
}
