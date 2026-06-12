"use server";

import { revalidatePath } from "next/cache";
import { confirmPurchase, rejectPurchase } from "@/lib/credits";
import { dispatchPurchaseConfirmed } from "@/lib/email-dispatch";
import { setFlash } from "@/lib/flash";

export async function confirmPurchaseAction(formData: FormData) {
  const id = String(formData.get("purchaseId") ?? "");
  if (!id) return;
  try {
    await confirmPurchase(id);
    await dispatchPurchaseConfirmed(id).catch(() => {});
    setFlash("Pagamento confirmado");
  } catch (e: any) {
    setFlash("Não foi possível confirmar o pagamento", "error", e?.message);
  }
  revalidatePath("/admin/pagamentos");
  revalidatePath("/admin/dashboard");
}

export async function rejectPurchaseAction(formData: FormData) {
  const id = String(formData.get("purchaseId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  if (!id) return;
  try {
    await rejectPurchase(id, reason);
    setFlash("Pagamento rejeitado");
  } catch (e: any) {
    setFlash("Não foi possível rejeitar", "error", e?.message);
  }
  revalidatePath("/admin/pagamentos");
}
