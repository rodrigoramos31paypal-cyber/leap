// Streak feature removida do produto. Este endpoint fica desactivado.
// (O ficheiro não pode ser apagado neste ambiente — elimina-o com
//  `git rm lib/streak.ts app/api/cron/streaks/route.ts` na tua máquina.)
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ disabled: true }, { status: 410 });
}
