"use server";

import { revalidatePath } from "next/cache";
import {
  adjustCredits,
  createPurchase,
  createCustomPurchase,
  confirmPurchase,
} from "@/lib/credits";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { setFlash } from "@/lib/flash";

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
    setFlash(
      delta > 0 ? `Adicionadas ${delta} sessão(ões)` : `Removidas ${Math.abs(delta)} sessão(ões)`,
    );
  } catch (e: any) {
    setFlash("Não foi possível ajustar sessões", "error", e?.message);
  }
  revalidatePath(`/admin/clientes/${clientId}`);
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
  } catch (e: any) {
    console.error("grantPackAction failed", e);
    setFlash("Não foi possível atribuir as sessões", "error", e?.message);
  }
  revalidatePath(`/admin/clientes/${clientId}`);
}
