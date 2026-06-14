import { createClient } from "@/lib/supabase/server";
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

/** Carrega tudo o que a página pública precisa numa única passagem. */
export async function getPublicTrainerBySlug(slug: string): Promise<PublicTrainer | null> {
  const supabase = createClient();

  const { data } = await (supabase as any)
    .from("trainers")
    .select("id, slug, bio, avatar_url, active, profiles:profile_id(full_name)")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (!data) return null;

  const trainerId = data.id as string;
  const fullName = (data.profiles?.full_name ?? "").trim() || "Treinador";

  // Stats + primeiras reviews em paralelo.
  const [stats, reviews] = await Promise.all([
    getTrainerRatingStats(trainerId),
    getTrainerReviews(trainerId, { limit: 20 }),
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
