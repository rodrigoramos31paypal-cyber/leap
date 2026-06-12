"use server";

import { createClient } from "@/lib/supabase/server";
import { createPurchase } from "@/lib/credits";
import { ifthenpayEnabled, createIfthenpayPayment } from "@/lib/ifthenpay";
import { dispatchPurchasePending } from "@/lib/email-dispatch";
import type { PaymentMethod } from "@/types/database";

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

  const isGateway = !method.startsWith("manual_");
  if (isGateway && !ifthenpayEnabled()) {
    return {
      error:
        "Os pagamentos automáticos ainda não estão ativos. Escolhe MB Way manual por agora.",
    };
  }

  try {
    const purchaseId = await createPurchase(packId, method);
    await dispatchPurchasePending(purchaseId).catch(() => {});

    if (!isGateway) {
      // manual: redireciona para página de instruções
      return { redirect: `/app/compras/${purchaseId}/manual` };
    }

    // gateway IfthenPay
    const { redirectUrl } = await createIfthenpayPayment({ purchaseId, method });
    return { redirect: redirectUrl };
  } catch (err: any) {
    return { error: err?.message ?? "Erro ao iniciar compra." };
  }
}
