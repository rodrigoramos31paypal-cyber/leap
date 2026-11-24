import { NextRequest, NextResponse } from "next/server";
import { verifyLeapDiscount, validDiscountToken, discountHash } from "@/lib/leap-discount";
import { rateLimit } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const body = await request.json();
    if (!validDiscountToken(body?.token)) return NextResponse.json({ valid: false }, { status: 400, headers });
    // Each private proof has its own budget; all Projeto users may share one server IP.
    if (!(await rateLimit("generic", `leap-discount:${discountHash(body.token)}`)).success)
      return NextResponse.json({ valid: false }, { status: 429, headers });
    const proof = await verifyLeapDiscount(body?.token, body?.email_hash);
    return NextResponse.json(proof ? { valid: true, ...proof } : { valid: false }, { headers });
  } catch { return NextResponse.json({ valid: false }, { status: 400, headers }); }
}
