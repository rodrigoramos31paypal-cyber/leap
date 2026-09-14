// ════════════════════════════════════════════════════════════════
// Grupos "Trio" · wrappers TS para as RPCs Postgres (migração 0152)
//
// Um trio liga TRÊS perfis de cliente. A partir daí, qualquer marcação
// PT Trio feita por um deles vira uma sessão de grupo partilhada que
// desconta 1 sessão ao pool partilhado (basta uma das 3 contas ter pack
// 'tripla') e aparece no calendário dos três. A gestão da ligação é só do
// admin (link_trio / unlink_trio são SECURITY DEFINER e validam o papel).
//
// Espelho de lib/duo.ts, adaptado a três membros e ao pool 'tripla'.
// ════════════════════════════════════════════════════════════════
import { createClient, createAdminClient } from "@/lib/supabase/server";

export type TrioPartner = {
  id: string;
  full_name: string;
  email: string;
};

/** Liga três perfis de cliente. Devolve o id do trio criado. Admin only. */
export async function linkTrio(
  clientA: string,
  clientB: string,
  clientC: string,
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("link_trio", {
    p_client_a: clientA,
    p_client_b: clientB,
    p_client_c: clientC,
  });
  if (error) throw error;
  return data as unknown as string;
}

/** Desliga o trio activo de que `clientId` faça parte. Admin only. */
export async function unlinkTrio(clientId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("unlink_trio", {
    p_client: clientId,
  });
  if (error) throw error;
}

/**
 * Trio activo de um cliente (os 3 ids ordenados), ou null. Service role
 * porque é chamado em vistas de admin onde precisamos dos dados dos outros
 * perfis independentemente das policies do utilizador actual.
 */
async function activeTrioMembers(clientId: string): Promise<string[] | null> {
  const admin = createAdminClient();
  const { data: trio } = await (admin as any)
    .from("trio_partnerships")
    .select("client_a, client_b, client_c")
    .eq("active", true)
    .or(
      `client_a.eq.${clientId},client_b.eq.${clientId},client_c.eq.${clientId}`,
    )
    .maybeSingle();
  if (!trio) return null;
  return [trio.client_a, trio.client_b, trio.client_c];
}

/**
 * Os DOIS parceiros do trio activo de um cliente (perfis), ou []. Usa
 * service role para ler o nome/email dos outros perfis (as policies do
 * cliente não deixam ler as contas dos outros).
 */
export async function getTrioPartners(clientId: string): Promise<TrioPartner[]> {
  const members = await activeTrioMembers(clientId);
  if (!members) return [];
  const partnerIds = members.filter((id) => id !== clientId);
  if (partnerIds.length === 0) return [];

  const admin = createAdminClient();
  const { data: profs } = await (admin as any)
    .from("profiles")
    .select("id, full_name, email")
    .in("id", partnerIds);
  return ((profs ?? []) as any[]).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
  }));
}

/**
 * Ids dos DOIS parceiros do trio activo (ou []). Versão leve de
 * `getTrioPartners` quando só precisamos dos ids (ex.: somar o saldo
 * 'tripla' partilhado do grupo).
 */
export async function getActiveTrioPartnerIds(clientId: string): Promise<string[]> {
  const members = await activeTrioMembers(clientId);
  if (!members) return [];
  return members.filter((id) => id !== clientId);
}

/**
 * Saldo 'tripla' partilhado do grupo para um treinador = soma dos packs
 * 'tripla' (confirmados, com saldo, não expirados) dos parceiros indicados.
 * Usa service role: na app do CLIENTE precisamos de ver os créditos dos
 * outros membros, e as policies normais não o permitem. Devolve só a
 * contagem (sem detalhe). Espelho de getPartnerDuplaCredits.
 */
export async function getPartnersTriplaCredits(
  partnerIds: string[],
  trainerId: string,
): Promise<number> {
  if (partnerIds.length === 0) return 0;
  const admin = createAdminClient();
  const { data } = await (admin as any)
    .from("purchases")
    .select("sessions_remaining, expires_at")
    .in("client_id", partnerIds)
    .eq("trainer_id", trainerId)
    .eq("session_type", "tripla")
    .eq("status", "confirmed")
    .gt("sessions_remaining", 0);
  const now = Date.now();
  return ((data ?? []) as any[])
    .filter((p) => !p.expires_at || new Date(p.expires_at).getTime() >= now)
    .reduce((sum, p) => sum + Number(p.sessions_remaining ?? 0), 0);
}

/**
 * Packs PT Trio (confirmados, com saldo, não expirados) dos parceiros
 * indicados, por treinador. Usado para SOMAR o saldo tripla dos outros
 * membros ao do próprio (saldo partilhado pelo grupo). Espelho de
 * getPartnerDuplaRows.
 */
export type PartnerTriplaRow = {
  trainer_id: string;
  sessions_remaining: number;
  sessions_total: number;
  trainerName: string | null;
  slug: string | null;
  avatarUrl: string | null;
};

export async function getPartnersTriplaRows(
  partnerIds: string[],
): Promise<PartnerTriplaRow[]> {
  if (partnerIds.length === 0) return [];
  const admin = createAdminClient();
  const { data } = await (admin as any)
    .from("purchases")
    .select(
      "trainer_id, sessions_remaining, sessions_total, expires_at, trainers:trainer_id(slug, avatar_url, profiles:profile_id(full_name))",
    )
    .in("client_id", partnerIds)
    .eq("session_type", "tripla")
    .eq("status", "confirmed")
    .gt("sessions_remaining", 0);
  const now = Date.now();
  return ((data ?? []) as any[])
    .filter((p) => !p.expires_at || new Date(p.expires_at).getTime() >= now)
    .map((p) => ({
      trainer_id: p.trainer_id,
      sessions_remaining: Number(p.sessions_remaining ?? 0),
      sessions_total: Number(p.sessions_total ?? 0),
      trainerName: p.trainers?.profiles?.full_name ?? null,
      slug: p.trainers?.slug ?? null,
      avatarUrl: p.trainers?.avatar_url ?? null,
    }));
}
