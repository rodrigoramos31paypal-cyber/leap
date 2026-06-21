// ════════════════════════════════════════════════════════════════
// Pares "Duo" · wrappers TS para as RPCs Postgres (migração 0096)
//
// Um par liga DOIS perfis de cliente. A partir daí, qualquer marcação
// feita por um deles vira uma sessão dupla partilhada que desconta 1
// sessão a cada conta e aparece no calendário de ambos. A gestão da
// ligação é só do admin (link_duo / unlink_duo são SECURITY DEFINER e
// validam o papel).
// ════════════════════════════════════════════════════════════════
import { createClient, createAdminClient } from "@/lib/supabase/server";

export type DuoPartner = {
  id: string;
  full_name: string;
  email: string;
};

/** Liga dois perfis de cliente. Devolve o id do par criado. Admin only. */
export async function linkDuo(clientA: string, clientB: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("link_duo", {
    p_client_a: clientA,
    p_client_b: clientB,
  });
  if (error) throw error;
  return data as unknown as string;
}

/** Desliga o par activo de que `clientId` faça parte. Admin only. */
export async function unlinkDuo(clientId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("unlink_duo", {
    p_client: clientId,
  });
  if (error) throw error;
}

/**
 * Devolve o parceiro duo activo de um cliente (ou null). Usa service role
 * porque é chamado em vistas de admin onde precisamos do nome/email do
 * outro perfil independentemente das policies do utilizador actual.
 */
export async function getDuoPartner(clientId: string): Promise<DuoPartner | null> {
  const admin = createAdminClient();
  const { data: pair } = await (admin as any)
    .from("duo_partnerships")
    .select("client_a, client_b")
    .eq("active", true)
    .or(`client_a.eq.${clientId},client_b.eq.${clientId}`)
    .maybeSingle();
  if (!pair) return null;

  const partnerId = pair.client_a === clientId ? pair.client_b : pair.client_a;
  const { data: prof } = await (admin as any)
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", partnerId)
    .maybeSingle();
  if (!prof) return null;
  return { id: prof.id, full_name: prof.full_name, email: prof.email };
}

/**
 * Saldo de sessões PT Dupla (confirmadas e não expiradas) de um cliente
 * para um treinador. Usa service role porque é chamado na app do CLIENTE
 * para saber se o PAR tem créditos — as policies normais não deixam um
 * cliente ler as compras do outro. Devolve só uma contagem (sem detalhe).
 */
export async function getPartnerDuplaCredits(
  partnerId: string,
  trainerId: string,
): Promise<number> {
  const admin = createAdminClient();
  const { data } = await (admin as any)
    .from("purchases")
    .select("sessions_remaining, expires_at")
    .eq("client_id", partnerId)
    .eq("trainer_id", trainerId)
    .eq("session_type", "dupla")
    .eq("status", "confirmed")
    .gt("sessions_remaining", 0);
  const now = Date.now();
  return ((data ?? []) as any[])
    .filter((p) => !p.expires_at || new Date(p.expires_at).getTime() >= now)
    .reduce((sum, p) => sum + Number(p.sessions_remaining ?? 0), 0);
}
