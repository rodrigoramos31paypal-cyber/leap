"use server";

import { createClient } from "@/lib/supabase/server";
import { pendingApprovalBlock } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";

export async function declareInterestAction(productId: string): Promise<{ error?: string; ok?: true }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) return { error: "Produto inválido." };
  const blocked = await pendingApprovalBlock();
  if (blocked) return { error: blocked };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "A tua sessão expirou. Volta a entrar." };
  const limit = await rateLimit("generic", `store-interest:${user.id}`);
  if (!limit.success) return { error: "Espera um momento e tenta novamente." };

  // A chave única impede duplicados, incluindo cliques concorrentes.
  // A RLS verifica cliente aprovado, produto ativo e identidade do autor.
  const { error } = await (supabase as any).from("store_product_interests")
    .insert({ client_id: user.id, product_id: productId });
  if (error && error.code !== "23505") return { error: "Não foi possível guardar o interesse. Tenta novamente." };
  revalidatePath("/app/loja/suplementos");
  revalidatePath("/admin/loja");
  return { ok: true };
}
