// ════════════════════════════════════════════════════════════════
// Helpers para descobrir o trainer associado ao user logado, e
// outras queries comuns ao schema multi-trainer.
//
// PERF: usamos React `cache()` para deduplicar chamadas dentro do
// mesmo request — várias páginas (layout + page) e helpers chamam
// estes métodos várias vezes; sem cache fazíamos N round-trips.
// ════════════════════════════════════════════════════════════════
import { cache } from "react";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";

export type TrainerLite = {
  id: string;
  profile_id: string;
  slug: string;
  active: boolean;
  full_name: string;
  bio?: string | null;
};

/** Devolve o trainer do user logado (admin). null se o user não for trainer/owner. */
export const getCurrentTrainer = cache(async (): Promise<TrainerLite | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = createClient();

  const { data } = await supabase
    .from("trainers")
    .select("id, profile_id, slug, active, bio, profiles:profile_id(full_name)")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    profile_id: data.profile_id,
    slug: data.slug,
    active: data.active,
    bio: data.bio,
    full_name: (data as any).profiles?.full_name ?? "",
  };
});

export const getCurrentTrainerId = cache(async (): Promise<string | null> => {
  const t = await getCurrentTrainer();
  return t?.id ?? null;
});

/** Para owner: devolve todos os trainers; para trainer: só ele próprio. */
export const getAccessibleTrainerIds = cache(async (): Promise<string[]> => {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  if (profile.role === "owner") {
    const supabase = createClient();
    const { data: all } = await supabase.from("trainers").select("id");
    return (all ?? []).map((t: any) => t.id);
  }
  const t = await getCurrentTrainer();
  return t ? [t.id] : [];
});

/** Para clientes: lista de trainers activos para escolher quando há mais que 1. */
export const getActiveTrainersPublic = cache(async (): Promise<TrainerLite[]> => {
  const supabase = createClient();
  const { data } = await supabase
    .from("trainers")
    .select("id, profile_id, slug, active, bio, profiles:profile_id(full_name)")
    .eq("active", true)
    .order("slug");

  return (data ?? []).map((t: any) => ({
    id: t.id,
    profile_id: t.profile_id,
    slug: t.slug,
    active: t.active,
    bio: (t as any).bio ?? null,
    full_name: (t as any).profiles?.full_name ?? "",
  }));
});

/** IDs de clientes que têm compras ou marcações dentro de um scope de trainers. */
export const getClientIdsInScope = cache(async (trainerIds: string[]): Promise<string[]> => {
  if (trainerIds.length === 0) return [];
  const supabase = createClient();
  const [{ data: purs }, { data: books }] = await Promise.all([
    supabase.from("purchases").select("client_id").in("trainer_id", trainerIds),
    supabase.from("bookings").select("client_id").in("trainer_id", trainerIds),
  ]);
  const set = new Set<string>();
  for (const r of (purs ?? []) as any[]) set.add(r.client_id);
  for (const r of (books ?? []) as any[]) set.add(r.client_id);
  return Array.from(set);
});

/** Nº de clientes distintos no scope — só a contagem, sem trazer linhas.
 *
 *  PERF: usa a RPC `count_clients_in_scope` (COUNT(DISTINCT) no Postgres)
 *  em vez de puxar todas as linhas de purchases+bookings para o Node e
 *  deduplicar em JS, como faz getClientIdsInScope(). Usar isto quando só
 *  precisamos do número (ex: KPI do dashboard) — não da lista de IDs.
 *
 *  ROBUSTEZ: se a RPC ainda não existir (migration 0033 não aplicada) ou
 *  falhar, cai para getClientIdsInScope().length — comportamento idêntico
 *  ao anterior. Zero breakage no deploy. */
export const getClientCountInScope = cache(async (trainerIds: string[]): Promise<number> => {
  if (trainerIds.length === 0) return 0;
  const supabase = createClient();
  try {
    // `as any`: a RPC ainda não está nos tipos gerados do Supabase.
    const { data, error } = await (supabase as any).rpc("count_clients_in_scope", {
      p_trainer_ids: trainerIds,
    });
    if (error) throw error;
    return Number(data ?? 0);
  } catch {
    const ids = await getClientIdsInScope(trainerIds);
    return ids.length;
  }
});

/** Para clientes: trainer a usar — preferred = profile.trainer_id, fallback = único activo. */
export const getTrainerForClient = cache(async (clientUserId: string): Promise<string | null> => {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("trainer_id")
    .eq("id", clientUserId)
    .maybeSingle();
  if ((profile as any)?.trainer_id) return (profile as any).trainer_id;

  const { data: actives } = await supabase
    .from("trainers")
    .select("id")
    .eq("active", true)
    .limit(2);
  if (actives && actives.length === 1) return (actives[0] as any).id;
  return null; // ambíguo → UI tem de pedir escolha
});
