// ════════════════════════════════════════════════════════════════
// Helpers para descobrir o trainer associado ao user logado, e
// outras queries comuns ao schema multi-trainer.
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
  avatar_url?: string | null;
};

export const getCurrentTrainer = cache(async (): Promise<TrainerLite | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = createClient();

  const { data } = await supabase
    .from("trainers")
    .select("id, profile_id, slug, active, bio, avatar_url, profiles:profile_id(full_name)")
    .eq("profile_id", user.id)
    .maybeSingle();

  if (data) return toTrainerLite(data);

  const profile = await getCurrentProfile();
  if (profile?.role === "owner") {
    const { data: actives } = await supabase
      .from("trainers")
      .select("id, profile_id, slug, active, bio, avatar_url, profiles:profile_id(full_name)")
      .eq("active", true);
    if (actives && actives.length === 1) return toTrainerLite(actives[0]);
  }
  return null;
});

function toTrainerLite(data: any): TrainerLite {
  return {
    id: data.id,
    profile_id: data.profile_id,
    slug: data.slug,
    active: data.active,
    bio: data.bio,
    avatar_url: data.avatar_url ?? null,
    full_name: data.profiles?.full_name ?? "",
  };
}

export const getCurrentTrainerId = cache(async (): Promise<string | null> => {
  const t = await getCurrentTrainer();
  return t?.id ?? null;
});

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

export const getActiveTrainersPublic = cache(async (): Promise<TrainerLite[]> => {
  const supabase = createClient();
  const { data } = await supabase
    .from("trainers")
    .select("id, profile_id, slug, active, bio, avatar_url, profiles:profile_id(full_name)")
    .eq("active", true)
    .order("slug");

  return (data ?? []).map((t: any) => ({
    id: t.id,
    profile_id: t.profile_id,
    slug: t.slug,
    active: t.active,
    bio: (t as any).bio ?? null,
    avatar_url: (t as any).avatar_url ?? null,
    full_name: (t as any).profiles?.full_name ?? "",
  }));
});

/**
 * IDs de clientes dentro do scope de um trainer. Inclui:
 *  • clientes com compras ou marcações com algum dos trainers do scope;
 *  • clientes que se REGISTARAM associados ao trainer (profiles.trainer_id)
 *    mesmo antes de comprarem/marcarem.
 * Exclui contas anonimizadas (`@removido.invalid`).
 */
export const getClientIdsInScope = cache(async (trainerIds: string[]): Promise<string[]> => {
  if (trainerIds.length === 0) return [];
  const supabase = createClient();
  const [{ data: purs }, { data: books }, { data: profs }] = await Promise.all([
    supabase.from("purchases").select("client_id").in("trainer_id", trainerIds),
    supabase.from("bookings").select("client_id").in("trainer_id", trainerIds),
    (supabase as any)
      .from("profiles")
      .select("id")
      .eq("role", "client")
      .in("trainer_id", trainerIds),
  ]);
  const set = new Set<string>();
  for (const r of (purs ?? []) as any[]) set.add(r.client_id);
  for (const r of (books ?? []) as any[]) set.add(r.client_id);
  for (const r of (profs ?? []) as any[]) set.add(r.id);
  if (set.size === 0) return [];

  const ids = Array.from(set);
  const { data: active } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", ids);
  return (active ?? [])
    .filter((p: any) => !((p.email ?? "") as string).endsWith("@removido.invalid"))
    .map((p: any) => p.id);
});

export const getClientCountInScope = cache(async (trainerIds: string[]): Promise<number> => {
  if (trainerIds.length === 0) return 0;
  const supabase = createClient();
  try {
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
  return null;
});
