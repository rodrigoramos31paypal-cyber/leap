import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/server";
import { getTrainerRatingStats, getTrainerReviews } from "@/lib/ratings";
import type { TrainerRatingStats, TrainerReview } from "@/lib/ratings";

// ════════════════════════════════════════════════════════════════
// Helpers para a PÁGINA PÚBLICA do trainer (/t/<slug>).
//
// Estes helpers correm sem sessão (cliente Supabase anon). As tabelas/
// views acedidas dependem das policies criadas em 0045:
//   • trainers          (active=true)
//   • profiles          (role in 'trainer','owner')  → full_name
//   • trainer_rating_stats, trainer_recent_reviews   (views)
// ════════════════════════════════════════════════════════════════

export type PublicTrainer = {
  id: string;
  slug: string;
  fullName: string;
  bio: string | null;
  avatarUrl: string | null;
  stats: TrainerRatingStats;
  reviews: TrainerReview[];
};

/** Carrega tudo o que a página pública precisa numa única passagem. Usa o
 *  cliente anon SEM cookies para poder ser cacheado (ver getPublicTrainerBySlug). */
async function loadPublicTrainerBySlug(slug: string): Promise<PublicTrainer | null> {
  const supabase = createPublicClient();

  const { data } = await (supabase as any)
    .from("trainers")
    .select("id, slug, bio, avatar_url, active, profiles:profile_id(full_name)")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (!data) return null;

  const trainerId = data.id as string;
  const fullName = (data.profiles?.full_name ?? "").trim() || "Trainer";

  // Stats + primeiras reviews em paralelo (mesmo cliente anon).
  const [stats, reviews] = await Promise.all([
    getTrainerRatingStats(trainerId, supabase),
    getTrainerReviews(trainerId, { limit: 20 }, supabase),
  ]);

  return {
    id: trainerId,
    slug: data.slug,
    fullName,
    bio: data.bio ?? null,
    avatarUrl: (data as any).avatar_url ?? null,
    stats,
    reviews,
  };
}

// PERF (audit): /t/<slug> é pública e partilhável, mas o root layout
// (headers()/cookies) força render dinâmico em toda a app — não dá para a
// tornar estática/ISR sem um refactor global. Em vez disso cacheamos os
// DADOS (Data Cache do Next, revalidate 300s): as leituras à BD deixam de
// correr a cada request e as 2 chamadas por request (generateMetadata +
// página) deduplicam. Invalidar com revalidateTag(`public-trainer:<slug>`)
// quando o trainer edita o perfil (bio/avatar).
export function getPublicTrainerBySlug(slug: string): Promise<PublicTrainer | null> {
  return unstable_cache(
    () => loadPublicTrainerBySlug(slug),
    ["public-trainer", slug],
    { revalidate: 300, tags: [`public-trainer:${slug}`] },
  )();
}
