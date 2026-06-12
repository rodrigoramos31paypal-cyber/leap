import { NextRequest, NextResponse } from "next/server";
import { handleIfthenpayCallback } from "@/lib/ifthenpay";

/**
 * Callback IfthenPay (GET com query params).
 * Configura este URL no backoffice IfthenPay (chave anti-phishing incluída).
 */
export async function GET(req: NextRequest) {
  const result = await handleIfthenpayCallback(req.nextUrl.searchParams);
  if (!result.ok) {
    return new NextResponse(result.message ?? "Erro", { status: 400 });
  }
  return new NextResponse("OK", { status: 200 });
}

// Aceita também POST (IfthenPay tem ambos os modos)
export async function POST(req: NextRequest) {
  const params = new URLSearchParams(await req.text());
  const result = await handleIfthenpayCallback(params);
  if (!result.ok) {
    return new NextResponse(result.message ?? "Erro", { status: 400 });
  }
  return new NextResponse("OK", { status: 200 });
}
