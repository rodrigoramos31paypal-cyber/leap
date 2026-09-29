"use server";

// ════════════════════════════════════════════════════════════════
// Ações do dashboard do cliente.
//
// logActivityAction · regista uma atividade extra (treino autónomo /
// cardio) do próprio dia, via RPC log_activity (0159). Fica PENDENTE
// de validação. NÃO toca em saldo/sessões do pack.
// ════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function logActivityAction(type: "autonomous" | "cardio") {
  if (type !== "autonomous" && type !== "cardio") {
    return { error: "Tipo de atividade inválido." };
  }
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("log_activity", { p_type: type });
  if (error) {
    return { error: "Não foi possível registar. Tenta novamente." };
  }
  // Atualiza o resumo de atividade mostrado na Home / perfil.
  revalidatePath("/app/dashboard");
  revalidatePath("/app/perfil");
  revalidatePath("/app/historico");
  return { ok: true as const };
}
