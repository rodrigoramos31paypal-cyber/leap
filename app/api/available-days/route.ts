import { NextRequest, NextResponse } from "next/server";
import { getAvailableDays } from "@/lib/availability";

// ════════════════════════════════════════════════════════════════
// Dias com disponibilidade · GET /api/available-days?trainer&from&to&duration
//
// Devolve as datas ("YYYY-MM-DD") do intervalo [from, to] que têm pelo
// menos 1 horário livre para o trainer e duração dados. O fluxo de
// marcação do cliente usa isto para ESCONDER dias cheios/sem horário.
//
// AUTH: rota não-pública → o middleware exige sessão; a query corre sob a
// RLS do utilizador (mesmas vistas públicas que /api/slots).
//
// CONSISTÊNCIA: reutiliza o MESMO algoritmo de /api/slots (generateSlots),
// por isso um dia só é "disponível" aqui se tiver horários lá. Sem cache
// (no-store) — reflecte marcações/cancelamentos/bloqueios em tempo real a
// cada carregamento.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cap de segurança: o cliente vê 90 dias; 100 dá folga sem permitir
// varrimentos abusivos.
const MAX_RANGE_DAYS = 100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trainerId = searchParams.get("trainer");
  const fromIso = searchParams.get("from");
  const toIso = searchParams.get("to");
  const durationMin = Number(searchParams.get("duration"));

  if (!trainerId || !fromIso || !toIso || !durationMin || Number.isNaN(durationMin)) {
    return NextResponse.json({ days: [] }, { status: 400 });
  }

  // from/to como "YYYY-MM-DD" → meia-noite UTC do dia-calendário.
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return NextResponse.json({ days: [] }, { status: 400 });
  }

  // Limita o intervalo (defesa contra varrimentos enormes).
  const spanDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ days: [] }, { status: 400 });
  }

  const days = await getAvailableDays({ trainerId, from, to, durationMin });

  return NextResponse.json(
    { days },
    { headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } },
  );
}
