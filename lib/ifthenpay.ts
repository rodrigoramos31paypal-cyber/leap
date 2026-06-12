// ════════════════════════════════════════════════════════════════
// IfthenPay · MB Way + Multibanco + Cartão
// Docs: https://ifthenpay.com/docs/en/integrations/api/
// ════════════════════════════════════════════════════════════════
import { timingSafeEqual } from "crypto";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { PaymentMethod } from "@/types/database";

/** Comparação em tempo constante para segredos partilhados (anti timing-attack). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const BASE_MBWAY = "https://ifthenpay.com/api/spg/payment/mbway";
const BASE_MULTIBANCO = "https://ifthenpay.com/api/multibanco/reference/init";
const BASE_CCARD = "https://ifthenpay.com/api/creditcard/init";

export function ifthenpayEnabled(): boolean {
  return process.env.IFTHENPAY_ENABLED === "true";
}

function requireKeys() {
  return {
    mbway: process.env.IFTHENPAY_MBWAY_KEY,
    multibanco: process.env.IFTHENPAY_MULTIBANCO_KEY,
    ccard: process.env.IFTHENPAY_CCARD_KEY,
    anti: process.env.IFTHENPAY_ANTI_PHISHING_KEY,
    callback: process.env.IFTHENPAY_CALLBACK_URL,
  };
}

type StartArgs = { purchaseId: string; method: PaymentMethod };

/**
 * Inicia um pagamento via IfthenPay. Retorna URL para redirecionar o cliente
 * (página interna que mostra status / referência / botão de cartão).
 */
export async function createIfthenpayPayment({ purchaseId, method }: StartArgs): Promise<{ redirectUrl: string }> {
  if (!ifthenpayEnabled()) {
    throw new Error("IfthenPay desativado. Define IFTHENPAY_ENABLED=true e configura as chaves.");
  }
  const keys = requireKeys();
  const supabase = createAdminClient();

  // carrega purchase + cliente
  const { data: purchase } = await supabase
    .from("purchases")
    .select("*, profiles:client_id(full_name, email, phone)")
    .eq("id", purchaseId)
    .single();
  if (!purchase) throw new Error("Compra não encontrada");

  const orderId = `LEAP-${purchaseId.slice(0, 8).toUpperCase()}`;
  const amount = (purchase.amount_cents / 100).toFixed(2);
  const description = `LEAP · ${(purchase.pack_snapshot as any).name}`;

  if (method === "mbway") {
    if (!keys.mbway) throw new Error("IFTHENPAY_MBWAY_KEY em falta");
    const phone = (purchase as any).profiles?.phone ?? "";
    if (!phone) throw new Error("Adiciona o teu nº de telemóvel ao perfil para usar MB Way.");

    const res = await fetch(BASE_MBWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mbWayKey: keys.mbway,
        orderId,
        amount,
        mobileNumber: phone.replace(/\D/g, "").slice(-9),
        email: (purchase as any).profiles?.email ?? "",
        description,
      }),
    });
    const payload = await res.json();
    await supabase.from("payments").update({
      gateway_request_id: payload?.RequestId ?? payload?.requestId ?? null,
      gateway_payload: payload,
      gateway_ref: orderId,
    }).eq("purchase_id", purchaseId).eq("status", "pending");

    return { redirectUrl: `/app/compras/${purchaseId}/gateway?method=mbway` };
  }

  if (method === "multibanco") {
    if (!keys.multibanco) throw new Error("IFTHENPAY_MULTIBANCO_KEY em falta");
    const res = await fetch(BASE_MULTIBANCO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mbKey: keys.multibanco,
        orderId,
        amount,
        description,
        expiryDays: 3,
      }),
    });
    const payload = await res.json();
    await supabase.from("payments").update({
      gateway_request_id: payload?.RequestId ?? null,
      gateway_payload: payload,
      gateway_ref: payload?.Reference ?? payload?.reference ?? orderId,
    }).eq("purchase_id", purchaseId).eq("status", "pending");
    return { redirectUrl: `/app/compras/${purchaseId}/gateway?method=multibanco` };
  }

  if (method === "card") {
    if (!keys.ccard) throw new Error("IFTHENPAY_CCARD_KEY em falta");
    const successUrl = `${process.env.NEXT_PUBLIC_APP_URL}/app/compras/${purchaseId}/gateway?method=card&status=ok`;
    const errorUrl = `${process.env.NEXT_PUBLIC_APP_URL}/app/compras/${purchaseId}/gateway?method=card&status=err`;
    const res = await fetch(`${BASE_CCARD}/${keys.ccard}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        amount,
        successUrl,
        errorUrl,
        cancelUrl: errorUrl,
        description,
        language: "PT",
      }),
    });
    const payload = await res.json();
    await supabase.from("payments").update({
      gateway_request_id: payload?.RequestId ?? null,
      gateway_payload: payload,
      gateway_ref: orderId,
    }).eq("purchase_id", purchaseId).eq("status", "pending");
    return { redirectUrl: payload?.PaymentUrl ?? payload?.paymentUrl ?? `/app/compras/${purchaseId}/gateway?method=card` };
  }

  throw new Error(`Método ${method} não suportado por gateway`);
}

/**
 * Verifica callback IfthenPay (anti-phishing) e marca purchase como confirmada.
 * IfthenPay envia parâmetros via query string. O `key` recebido tem de bater
 * com o nosso IFTHENPAY_ANTI_PHISHING_KEY.
 */
export async function handleIfthenpayCallback(params: URLSearchParams): Promise<{ ok: boolean; message?: string }> {
  const keys = requireKeys();
  const incomingKey = params.get("key") ?? params.get("Key") ?? "";
  // SEC: comparação em tempo constante para evitar timing-attacks sobre a key.
  if (!keys.anti || !safeEqual(incomingKey, keys.anti)) {
    return { ok: false, message: "Anti-phishing key inválida" };
  }

  const orderId = params.get("orderId") ?? params.get("OrderId") ?? "";
  if (!orderId) return { ok: false, message: "orderId em falta" };

  const supabase = createAdminClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("*, purchases:purchase_id(*)")
    .eq("gateway_ref", orderId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!payment) return { ok: false, message: "Pagamento não encontrado" };

  await supabase
    .from("payments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      gateway_payload: Object.fromEntries(params.entries()),
    })
    .eq("id", payment.id);

  // confirma compra
  await supabase.rpc("confirm_purchase", { p_purchase_id: payment.purchase_id });

  return { ok: true };
}
