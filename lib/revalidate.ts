// ════════════════════════════════════════════════════════════════
// Conjuntos de paths a revalidar por "concern" (créditos, marcações,
// disponibilidade, packs, perfil). Centralizar aqui evita que um
// server action novo se esqueça de revalidar uma vista relacionada
// (ex: confirmar pagamento → chip de sessões em /admin/clientes).
//
// Usar com revalidatePath() do Next.js — só "marca" as páginas como
// obsoletas; o re-render acontece quando o utilizador navega para elas.
// ════════════════════════════════════════════════════════════════
import { revalidatePath } from "next/cache";

/** Vistas que mostram saldo de sessões / créditos / pagamentos. */
export function revalidateCreditsViews(clientId?: string) {
  revalidatePath("/admin/clientes");
  if (clientId) revalidatePath(`/admin/clientes/${clientId}`);
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/pagamentos");
  revalidatePath("/app/dashboard");
  revalidatePath("/app/historico");
  revalidatePath("/app/comprar");
}

/** Vistas que mostram marcações / agenda / próximas sessões. */
export function revalidateBookingViews(clientId?: string) {
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
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/definicoes");
  revalidatePath("/app/agenda");
}

/** Vistas que mostram packs. */
export function revalidatePackViews() {
  revalidatePath("/admin/packs");
  revalidatePath("/app/comprar");
}

/** Vistas que mostram dados de perfil (nome, contactos). */
export function revalidateProfileViews(profileId?: string) {
  revalidatePath("/app/perfil");
  revalidatePath("/admin/clientes");
  if (profileId) revalidatePath(`/admin/clientes/${profileId}`);
  revalidatePath("/admin/agenda");
}

/** Vistas que mostram trainers / equipa. */
export function revalidateTeamViews() {
  revalidatePath("/admin/equipa");
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/packs");
  revalidatePath("/app/agenda");
  revalidatePath("/app/comprar");
}
