"use server";

// ════════════════════════════════════════════════════════════════
// Validação de atividades (aba dentro do Ranking do admin).
// decide_activity (0159) valida is_admin() + _trainer_is_accessible().
// ════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function decideActivityAction(id: string, status: "validated" | "rejected") {
  if (!id || (status !== "validated" && status !== "rejected")) {
    return { error: "Dados inválidos." };
  }
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("decide_activity", { p_id: id, p_status: status });
  if (error) {
    return { error: "Não foi possível atualizar a atividade." };
  }
  revalidatePath("/admin/leaderboard");
  return { ok: true as const };
}
