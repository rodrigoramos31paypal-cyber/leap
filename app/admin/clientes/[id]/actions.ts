"use server";

import { revalidateCreditsViews } from "@/lib/revalidate";
import {
  adjustCredits,
  createPurchase,
  createCustomPurchase,
  confirmPurchase,
} from "@/lib/credits";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";

export async function adjustCreditsAction(formData: FormData) {
  const purchaseId = String(formData.get("purchaseId") ?? "");
  const delta = Number(formData.get("delta") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "");
  if (!purchaseId || !delta || !reason) {
    setFlash("Faltam dados para ajustar sessões", "error");
    return;
  }

  try {
    await adjustCredits(purchaseId, delta, reason);
    await logAudit("credits_adjust", {
      targetTable: "purchases",
      targetId: purchaseId,
      payload: { delta, reason },
    });
    setFlash(
      delta > 0 ? `Adicionadas ${delta} sessão(ões)` : `Removidas ${Math.abs(delta)} sessão(ões)`,
    );
  } catch (e) {
    logError("adjustCreditsAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "adjustCredits", targetId: purchaseId });
    setFlash("Não foi possível ajustar sessões", "error");
  }
  revalidateCreditsViews(clientId);
}

/**
 * Atribuir pack manualmente ao cliente — sem o cliente passar pelo site.
 * Suporta dois modos:
 *  - mode="pack": usa um pack predefinido (packId obrigatório)
 *  - mode="custom": passa N sessões + preço directamente (sem pack)
 */
export async function grantPackAction(formData: FormData): Promise<void> {
  const mode = String(formData.get("mode") ?? "pack");
  const clientId = String(formData.get("clientId") ?? "");
  const method = String(formData.get("method") ?? "manual_cash") as
    | "manual_cash"
    | "manual_transfer"
    | "manual_mbway"
    | "complimentary";
  const confirmNow = formData.get("confirmNow") === "on";

  if (!clientId) {
    setFlash("Cliente não identificado", "error");
    return;
  }

  // Defesa server-side: não atribuir sessões a contas removidas (RGPD).
  const supabase = createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", clientId)
    .maybeSingle();
  if (((target?.email as string | null) ?? "").endsWith("@removido.invalid")) {
    setFlash("Conta removida — não é possível atribuir sessões.", "error");
    return;
  }

  let sessionsGranted = 0;
  try {
    let purchaseId: string;
    if (mode === "custom") {
      const sessions = Number(formData.get("custom_sessions") ?? 0);
      const priceEuros = Number(formData.get("custom_price_euros") ?? 0);
      const name = String(formData.get("custom_name") ?? "").trim();
      if (sessions <= 0) {
        setFlash("Indica um número de sessões válido", "error");
        return;
      }
      sessionsGranted = sessions;

      const trainerId = (await getCurrentTrainerId()) ?? (await getAccessibleTrainerIds())[0];
      if (!trainerId) {
        setFlash("Sem trainer associado", "error");
        return;
      }

      purchaseId = await createCustomPurchase({
        clientId,
        trainerId,
        sessions,
        priceCents: Math.round(priceEuros * 100),
        sessionType: "individual",
        paymentMethod: method,
        name: name || undefined,
      });
    } else {
      const packId = String(formData.get("packId") ?? "");
      if (!packId) {
        setFlash("Escolhe um pack", "error");
        return;
      }
      purchaseId = await createPurchase(packId, method, clientId);
    }

    if (confirmNow) {
      await confirmPurchase(purchaseId);
      setFlash(
        sessionsGranted > 0
          ? `Atribuídas ${sessionsGranted} sessão(ões) ao cliente`
          : "Pack atribuído e confirmado",
      );
    } else {
      setFlash("Pack atribuído — a aguardar confirmação de pagamento", "info");
    }

    await logAudit("pack_grant", {
      targetTable: "purchases",
      targetId: purchaseId,
      payload: {
        clientId,
        mode,
        method,
        confirmNow,
        sessionsGranted: sessionsGranted || undefined,
      },
    });
  } catch (e) {
    logError("grantPackAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "grantPack", clientId });
    setFlash("Não foi possível atribuir as sessões", "error");
  }
  revalidateCreditsViews(clientId);
}
