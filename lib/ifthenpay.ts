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
 *
 * SEC (C2 hardening — migration 0026):
 *   1. A anti-phishing `key` é REMOVIDA do payload antes de persistir.
 *      Antes ficava em `payments.gateway_payload` e a RLS de payments
 *      deixava o próprio cliente lê-la → leak da credencial partilhada.
 *   2. O `amount` é validado contra `payments.amount_cents` dentro da
 *      RPC `confirm_ifthenpay_callback` (atómica, com FOR UPDATE).
 *   3. Idempotência: callbacks repetidos no mesmo payment já pago
 *      devolvem ok = true sem disparar `confirm_purchase` outra vez.
 *   4. Anti-replay forte: o `FOR UPDATE` na RPC serializa pedidos
 *      concorrentes para o mesmo orderId.
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

  // SEC: amount é OBRIGATÓRIO. IfthenPay envia em euros (string com `.`).
  // Sem amount válido, a RPC recusa — não tem fallback inseguro.
  const amountRaw = params.get("amount") ?? params.get("Amount") ?? "";
  const amountEuros = Number(amountRaw);
  if (!amountRaw || !Number.isFinite(amountEuros) || amountEuros <= 0) {
    return { ok: false, message: "amount inválido" };
  }
  const amountCents = Math.round(amountEuros * 100);

  // SEC: filtra a anti-phishing key (e variantes de case) ANTES de
  // construir o payload que vai para a BD. Defesa em camadas: a RPC
  // também não precisa do `key`, mas filtrar aqui garante que mesmo
  // que um devolver futuro guarde o payload directamente, a key não
  // viaja.
  const safePayload: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    if (/^key$/i.test(k)) continue;
    safePayload[k] = v;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("confirm_ifthenpay_callback", {
    p_order_id: orderId,
    p_amount_cents: amountCents,
    p_payload: safePayload as any,
  });

  if (error) {
    // Log server-side para alerting (Sentry/Vercel). Nunca expomos a
    // razão exacta no body de resposta — atacante não precisa de saber
    // se foi mismatch de amount, payment inexistente, etc.
    console.error("[ifthenpay] callback rpc error:", error.message, { orderId });
    return { ok: false, message: "Erro ao processar callback" };
  }

  const result = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!result.ok) {
    console.warn("[ifthenpay] callback rejeitado:", result.reason ?? "unknown", { orderId });
    return { ok: false, message: "Callback rejeitado" };
  }
  return { ok: true };
}
