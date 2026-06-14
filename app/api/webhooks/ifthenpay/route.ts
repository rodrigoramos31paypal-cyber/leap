import { NextRequest, NextResponse } from "next/server";
import { handleIfthenpayCallback, ifthenpayCallbackIpAllowed } from "@/lib/ifthenpay";

/**
 * Callback IfthenPay (GET ou POST com params).
 * Configura este URL no backoffice IfthenPay (chave anti-phishing incluída).
 *
 * SEC (H3): allow-list de IP opt-in (IFTHENPAY_CALLBACK_ALLOWED_IPS) como
 * defesa em profundidade sobre a anti-phishing key. Sem a env, não bloqueia.
 */
function ipGate(req: NextRequest): NextResponse | null {
  const gate = ifthenpayCallbackIpAllowed(req.headers);
  if (!gate.allowed) {
    // Não revelamos detalhe ao caller; logamos para alerting.
    console.warn("[ifthenpay] callback bloqueado por IP:", gate.reason, gate.ip);
    return new NextResponse("Forbidden", { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const blocked = ipGate(req);
  if (blocked) return blocked;
  const result = await handleIfthenpayCallback(req.nextUrl.searchParams);
  if (!result.ok) {
    return new NextResponse(result.message ?? "Erro", { status: 400 });
  }
  return new NextResponse("OK", { status: 200 });
}

// Aceita também POST (IfthenPay tem ambos os modos)
export async function POST(req: NextRequest) {
  const blocked = ipGate(req);
  if (blocked) return blocked;
  const params = new URLSearchParams(await req.text());
  const result = await handleIfthenpayCallback(params);
  if (!result.ok) {
    return new NextResponse(result.message ?? "Erro", { status: 400 });
  }
  return new NextResponse("OK", { status: 200 });
}
