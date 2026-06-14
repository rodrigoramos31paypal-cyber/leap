"use server";

import { revalidateCreditsViews } from "@/lib/revalidate";
import { confirmPurchase, rejectPurchase } from "@/lib/credits";
import { dispatchPurchaseConfirmed } from "@/lib/email-dispatch";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";

export async function confirmPurchaseAction(formData: FormData) {
  const id = String(formData.get("purchaseId") ?? "");
  if (!id) return;
  try {
    await confirmPurchase(id);
    await logAudit("purchase_confirm", { targetTable: "purchases", targetId: id });
    await dispatchPurchaseConfirmed(id).catch(() => {});
    setFlash("Pagamento confirmado");
  } catch (e) {
    logError("confirmPurchaseAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "confirmPurchase", targetId: id });
    setFlash("Não foi possível confirmar o pagamento", "error");
  }
  revalidateCreditsViews();
}

export async function rejectPurchaseAction(formData: FormData) {
  const id = String(formData.get("purchaseId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  if (!id) return;
  try {
    await rejectPurchase(id, reason);
    await logAudit("purchase_reject", {
      targetTable: "purchases",
      targetId: id,
      payload: reason ? { reason } : undefined,
    });
    setFlash("Pagamento rejeitado");
  } catch (e) {
    logError("rejectPurchaseAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "rejectPurchase", targetId: id });
    setFlash("Não foi possível rejeitar", "error");
  }
  revalidateCreditsViews();
}
