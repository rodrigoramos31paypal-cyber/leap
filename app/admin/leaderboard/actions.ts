"use server";

// ════════════════════════════════════════════════════════════════
// Validação de atividades (aba dentro do Ranking do admin).
// decide_activity (0159) valida is_admin() + _trainer_is_accessible().
// ════════════════════════════════════════════════════════════════
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/authz";
import { getAccessibleTrainerIds } from "@/lib/trainer";

export async function decideActivityAction(id: string, status: "validated" | "rejected") {
  if (!id || (status !== "validated" && status !== "rejected")) {
    return { error: "Dados inválidos." };
  }
  await requireStaff();
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("decide_activity", { p_id: id, p_status: status });
  if (error) {
    return { error: "Não foi possível atualizar a atividade." };
  }
  revalidatePath("/admin/leaderboard");
  return { ok: true as const };
}

export async function loadActivityProofAction(id: string) {
  const staff = await requireStaff();
  const db = createAdminClient() as unknown as import("@supabase/supabase-js").SupabaseClient;
  const { data: activity, error } = await db.from("activities")
    .select("trainer_id").eq("id", id).eq("status", "pending").maybeSingle();
  if (error) return { error: "Não foi possível carregar o comprovativo." };
  if (!activity || (staff.role !== "owner" && !(await getAccessibleTrainerIds()).includes(activity.trainer_id))) {
    return { error: "Comprovativo indisponível." };
  }
  const { data, error: proofError } = await db.from("activity_proofs")
    .select("jpeg, comment").eq("activity_id", id).maybeSingle();
  if (proofError) return { error: "Não foi possível carregar o comprovativo." };
  return { photo: data ? `data:image/jpeg;base64,${data.jpeg}` : null, comment: data?.comment ?? null };
}
