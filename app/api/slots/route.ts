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
      // PERF (CB-8 audit jun/2026): o conteúdo deste endpoint depende
      // só de (trainer, date, duration) — não há per-user data. Era
      // `private` o que forçava bypass do Vercel Edge e cada cliente
      // pagava middleware + 4 queries Supabase. Em peak (segunda 9h,
      // 10 clientes a ver o mesmo dia), 10× round trips. Agora o Edge
      // cacheia 30 s e partilha entre clientes — 1 query Supabase /
      // 30 s por (trainer, date, duration). `create_booking` continua
      // a validar atomicamente: se um slot for ocupado na janela de
      // staleness, o servidor rejeita com mensagem clara.
      //
      // SEC (S-12, audit jun/2026): a rota está fora de `isPublic` →
      // middleware redirecciona unauth. Mas `Cache-Control: public`
      // permitia ao Vercel Edge servir o cached body antes do
      // middleware correr → utilizador unauth via slots. Trocamos
      // `Cache-Control` por `private` (browser-only) e mantemos o
      // edge cache via `CDN-Cache-Control` + `s-maxage` no Cache-
      // Control sem `public`. O `s-maxage` instrui apenas shared
      // caches; a directiva `private` impede que proxies/browsers
      // não-Vercel armazenem; e o middleware continua a correr antes
      // de o edge cache responder a um miss.
      headers: {
        "Cache-Control": "private, s-maxage=30, stale-while-revalidate=300",
        "CDN-Cache-Control": "public, s-maxage=30",
      },
    },
  );
}
