"use server";

import { createClient } from "@/lib/supabase/server";
import { createPurchase } from "@/lib/credits";
import { dispatchPurchasePending } from "@/lib/email-dispatch";
import { logError, userFacingRpcError } from "@/lib/errors";
import { revalidateCreditsViews } from "@/lib/revalidate";
import type { PaymentMethod } from "@/types/database";

// Apenas pagamentos manuais (MB WAY / Revolut). Ambos exigem confirmação
// manual do admin — o cliente é levado à página de instruções do método
// escolhido (/app/compras/<id>/manual).
export async function startPurchaseAction({
  packId,
  method,
}: {
  packId: string;
  method: PaymentMethod;
}): Promise<{ error?: string; redirect?: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  try {
    const purchaseId = await createPurchase(packId, method);
    await dispatchPurchasePending(purchaseId).catch(() => {});
    revalidateCreditsViews();
    return { redirect: `/app/compras/${purchaseId}/manual` };
  } catch (err) {
    logError("startPurchaseAction", err);
    const friendly = userFacingRpcError(err);
    return { error: friendly ?? "Não foi possível iniciar a compra. Tenta novamente." };
  }
}
