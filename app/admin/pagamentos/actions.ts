"use server";

import { revalidateCreditsViews } from "@/lib/revalidate";
import { confirmPurchase, rejectPurchase, cancelConfirmedPurchase, deletePurchase } from "@/lib/credits";
import { dispatchPurchaseConfirmed } from "@/lib/email-dispatch";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";
import { requireStaff, requireOwner } from "@/lib/authz";

export async function confirmPurchaseAction(formData: FormData) {
  await requireStaff();
  const id = String(formData.get("purchaseId") ?? "");
  if (!id) return;
  try {
    await confirmPurchase(id);
    await logAudit("purchase_confirm", { targetTable: "purchases", targetId: id });
    await dispatchPurchaseConfirmed(id).catch(() => {});
    await setFlash("Pagamento confirmado");
  } catch (e) {
    logError("confirmPurchaseAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "confirmPurchase", targetId: id });
    await setFlash("Não foi possível confirmar o pagamento", "error");
  }
  revalidateCreditsViews();
}

export async function rejectPurchaseAction(formData: FormData) {
  await requireStaff();
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
    await setFlash("Pagamento rejeitado");
  } catch (e) {
    logError("rejectPurchaseAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "rejectPurchase", targetId: id });
    await setFlash("Não foi possível rejeitar", "error");
  }
  revalidateCreditsViews();
}

// Cancelar uma compra JÁ confirmada (admin aceitou por engano). A compra
// passa a 'cancelled', perde as sessões restantes e o pagamento é
// marcado como reembolsado. Aparece no separador "Rejeitados".
export async function cancelConfirmedPurchaseAction(formData: FormData) {
  await requireOwner(); // C-D / H-2 parity: destrutivo (zera saldo + reembolso), owner-only.
  const id = String(formData.get("purchaseId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || undefined;
  if (!id) return;
  try {
    await cancelConfirmedPurchase(id, reason);
    await logAudit("purchase_cancel_confirmed", {
      targetTable: "purchases",
      targetId: id,
      payload: reason ? { reason } : undefined,
    });
    await setFlash("Pagamento cancelado");
  } catch (e) {
    logError("cancelConfirmedPurchaseAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "cancelConfirmedPurchase", targetId: id });
    await setFlash("Não foi possível cancelar o pagamento", "error");
  }
  revalidateCreditsViews();
}

// Eliminar DEFINITIVAMENTE um registo de pagamento (hard delete). Ao
// contrário de cancelar, não fica em "Rejeitados" — desaparece. Usado
// para limpar registos de teste/duplicados/erros. Devolve {ok,error}
// para o componente cliente mostrar a mensagem (ex.: recusa por ter
// sessões marcadas associadas) em vez de falhar em silêncio.
export async function deletePurchaseAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const id = String(formData.get("purchaseId") ?? "");
  if (!id) return { ok: false, error: "Pagamento não identificado." };
  try {
    await deletePurchase(id);
    await logAudit("purchase_delete", { targetTable: "purchases", targetId: id });
  } catch (e) {
    logError("deletePurchaseAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "deletePurchase", targetId: id });
    // Os erros do Supabase sao objectos simples ({message, code}), nao
    // instancias de Error, por isso lemos .message directamente.
    const err = e as { message?: string; code?: string };
    const raw = String(err.message || "");
    const rawLower = raw.toLowerCase();
    const code = String(err.code || "");
    const isRefusal = rawLower.indexOf("associad") >= 0 || rawLower.indexOf("ativa") >= 0;
    let friendly = "Nao foi possivel eliminar o pagamento.";
    if (isRefusal) {
      friendly = raw;
    } else if (code === "23503") {
      friendly = "Este pagamento tem sessoes marcadas associadas. Usa Cancelar pagamento em vez de eliminar.";
    }
    return { ok: false, error: friendly };
  }
  revalidateCreditsViews();
  return { ok: true };
}
