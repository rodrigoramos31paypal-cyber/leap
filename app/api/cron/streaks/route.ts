import { NextRequest, NextResponse } from "next/server";

// ════════════════════════════════════════════════════════════════
// Cron · parabéns semanal por streak — DESATIVADO (0067).
//
// A notificação de "parabéns por streak" foi removida a pedido. O
// endpoint mantém-se (para não partir o agendamento do cron) mas já
// não envia nada. Para reativar, repor a versão anterior em git.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, disabled: true, sent: 0 });
}
