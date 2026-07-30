"use server";

import { createClient } from "@/lib/supabase/server";
import { createPurchase } from "@/lib/credits";
import { dispatchPurchasePending } from "@/lib/email-dispatch";
import { logError, userFacingRpcError } from "@/lib/errors";
import { revalidateCreditsViews } from "@/lib/revalidate";
import { setFlash } from "@/lib/flash";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { pendingApprovalBlock } from "@/lib/authz";
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
  const blocked = await pendingApprovalBlock();
  if (blocked) return { error: blocked };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada." };

  // H-3 (audit jun/2026): cada chamada cria uma `purchase` no estado
  // `awaiting_confirmation`. Sem limite, um cliente pode encher a
  // tabela em segundos (e fazer ping ao admin com notificações). 30
  // por minuto por user é largo para fluxo normal (clicar duas vezes
  // sem querer, mudar de pack) e mata o spam.
  const rl = await rateLimit("generic", `purchase:${user.id}`);
  if (!rl.success) {
    return { error: "Demasiadas tentativas. Espera um pouco e tenta de novo." };
  }

  try {
    const purchaseId = await createPurchase(packId, method);
    // Auditoria: compra iniciada pelo cliente (fica a aguardar confirmação
    // manual do admin). actor = auth.uid() + IP.
    await logAudit("purchase_create_client", {
      targetTable: "purchases",
      targetId: purchaseId,
      payload: { packId, method },
    });
    await dispatchPurchasePending(purchaseId).catch(() => {});
    revalidateCreditsViews();
    await setFlash("Compra criada — segue as instruções de pagamento", "info");
    return { redirect: `/app/compras/${purchaseId}/manual` };
  } catch (err) {
    logError("startPurchaseAction", err);
    const friendly = userFacingRpcError(err);
    return { error: friendly ?? "Não foi possível iniciar a compra. Tenta novamente." };
  }
}
