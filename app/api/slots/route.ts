import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots } from "@/lib/availability";

// ════════════════════════════════════════════════════════════════
// Slots disponíveis para marcação · GET /api/slots?trainer&date&duration
//
// PERF (C3): substitui a Server Action `getSlotsAction`. Server Actions
// são serializadas pelo Next (uma de cada vez por cliente) e nunca são
// cacheadas — trocar de dia rapidamente metia POSTs em fila. Como Route
// Handler GET:
//   • pedidos podem correr em paralelo (o seletor de dia fica fluido);
//   • cacheável no browser (Cache-Control) → re-tocar num dia já visto é
//     instantâneo, sem ir ao servidor.
//
// AUTH: rota não-pública → o middleware exige sessão (getClaims). A query
// corre sob a RLS do utilizador, tal como a Server Action anterior.
//
// CONSISTÊNCIA: o cache privado de 30s pode mostrar um slot já ocupado
// por <=30s, mas create_booking valida atomicamente no servidor e recusa
// duplos — a UI mostra erro claro. Trade aceitável pela fluidez.
// ════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trainerId = searchParams.get("trainer");
  const dateIso = searchParams.get("date");
  const durationMin = Number(searchParams.get("duration"));

  if (!trainerId || !dateIso || !durationMin || Number.isNaN(durationMin)) {
    return NextResponse.json({ slots: [] }, { status: 400 });
  }

  const slots = await getAvailableSlots({
    trainerId,
    date: new Date(dateIso),
    durationMin,
  });

  return NextResponse.json(
    {
      slots: slots.map((s) => ({
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
      })),
    },
    {
      // CORRECÇÃO (jun/2026): NÃO cachear este endpoint.
      //
      // O conteúdo NÃO depende só de (trainer, date, duration) — muda
      // sempre que o estado de ocupação muda: uma marcação nova, um
      // cancelamento, um bloqueio e, em particular, um REAGENDAMENTO
      // (drag-and-drop do admin na Agenda). O cache anterior
      // (`s-maxage=30` + `stale-while-revalidate=300`) era partilhado no
      // Vercel Edge e servia slots desactualizados até ~30 s (fresh) e
      // até 5 min (stale-while-revalidate). Como `revalidatePath`/
      // `revalidateTag` NÃO purgam o cache HTTP de um Route Handler, as
      // acções do admin nunca invalidavam isto → os clientes viam
      // horários antigos (ex.: arrastar 19:15→19:00 não libertava o
      // 19:45 no lado do cliente). A consistência tem prioridade sobre
      // o ganho de cache aqui; cada pedido volta a ler a verdade.
      //
      // SEC (S-12): mantemos `private` + `no-store` — nenhum shared
      // cache (Vercel Edge incluído) guarda o corpo, por isso também
      // não há risco de servir slots a um utilizador unauth antes de o
      // middleware correr.
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}
