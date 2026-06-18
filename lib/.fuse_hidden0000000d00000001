// ════════════════════════════════════════════════════════════════
// Conjuntos de paths/tags a revalidar por "concern" (créditos,
// marcações, disponibilidade, packs, perfil, trainers).
//
// PERF (CB-6 audit jun/2026): a versão antiga rebentava 4-7 paths em
// cada action — em pico (admin a confirmar pagamentos), gerava 70+
// invalidações de cache por minuto e o ISR andava em thrash.
//
// Estratégia actual:
//  • `revalidateTag(...)` para queries embrulhadas em `unstable_cache`
//    com tags estáveis (active-trainers via QW-7, futuros candidatos).
//  • `revalidatePath(...)` SÓ nas rotas que mostram esses dados como
//    parte do RSC do route segment — e em listas mais curtas. As rotas
//    que apenas re-derivam dados a cada request (user-scoped, sem
//    cache) não precisam de invalidação explícita.
//  • Cada path foi auditado: removidos os que NÃO mostram o dado em
//    causa (ex.: `/app/comprar` saiu de revalidateCreditsViews — não
//    mostra créditos, só packs).
// ════════════════════════════════════════════════════════════════
import { revalidatePath, revalidateTag } from "next/cache";

/** Vistas/queries que mostram saldo de sessões/créditos/pagamentos. */
export function revalidateCreditsViews(clientId?: string) {
  // Tags (queries em unstable_cache).
  revalidateTag("client-credits");
  if (clientId) revalidateTag(`client-credits:${clientId}`);

  // Paths que renderizam o estado actual no RSC.
  revalidatePath("/admin/clientes");
  if (clientId) revalidatePath(`/admin/clientes/${clientId}`);
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/pagamentos");
  revalidatePath("/app/dashboard");
  revalidatePath("/app/historico");
  // CB-6: /app/comprar saiu — só mostra packs (catálogo), não créditos.
}

/** Vistas que mostram marcações / agenda / próximas sessões. */
export function revalidateBookingViews(clientId?: string) {
  revalidateTag("bookings");
  if (clientId) revalidateTag(`bookings:${clientId}`);

  revalidatePath("/admin/agenda");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/clientes");
  if (clientId) revalidatePath(`/admin/clientes/${clientId}`);
  revalidatePath("/app/agenda");
  revalidatePath("/app/dashboard");
  revalidatePath("/app/historico");
}

/** Vistas que mostram horários disponíveis / bloqueios. */
export function revalidateAvailabilityViews() {
  revalidateTag("availability");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/definicoes");
  revalidatePath("/app/agenda");
}

/** Vistas que mostram packs. */
export function revalidatePackViews() {
  revalidateTag("packs");
  revalidatePath("/admin/packs");
  revalidatePath("/app/comprar");
}

/** Vistas que mostram dados de perfil (nome, contactos). */
export function revalidateProfileViews(profileId?: string) {
  revalidateTag("profile");
  if (profileId) revalidateTag(`profile:${profileId}`);

  revalidatePath("/app/perfil");
  revalidatePath("/admin/clientes");
  if (profileId) revalidatePath(`/admin/clientes/${profileId}`);
  revalidatePath("/admin/agenda");
}

/** Vistas que mostram trainers / equipa. Combina com unstable_cache
 *  em lib/trainer.ts (QW-7). */
export function revalidateTeamViews() {
  // QW-7: getActiveTrainersPublic em unstable_cache com este tag.
  revalidateTag("active-trainers");
  revalidatePath("/admin/equipa");
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/packs");
  revalidatePath("/app/agenda");
  revalidatePath("/app/comprar");
}
