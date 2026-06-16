import { createClient, createAdminClient } from "@/lib/supabase/server";

// ════════════════════════════════════════════════════════════════
// Ratings · helpers para ler/escrever avaliações de sessão.
//
// As views públicas (trainer_rating_stats, trainer_recent_reviews)
// estão GRANT a anon/authenticated, por isso são lidas com o cliente
// "normal" mesmo em páginas públicas sem sessão.
// ════════════════════════════════════════════════════════════════

export type TrainerRatingStats = { avgStars: number | null; reviewCount: number };
export type TrainerReview = {
  stars: number;
  comment: string | null;
  createdAt: string;
  reviewerName: string;
};

/** Média + nº total de avaliações para um trainer. */
export async function getTrainerRatingStats(trainerId: string, client?: any): Promise<TrainerRatingStats> {
  const supabase = client ?? createClient();
  const { data } = await (supabase as any)
    .from("trainer_rating_stats")
    .select("avg_stars, review_count")
    .eq("trainer_id", trainerId)
    .maybeSingle();
  return {
    avgStars: data?.avg_stars != null ? Number(data.avg_stars) : null,
    reviewCount: data?.review_count ?? 0,
  };
}

/** Reviews recentes anonimizadas (primeiro nome + inicial) para o pop-up público. */
export async function getTrainerReviews(
  trainerId: string,
  opts: { limit?: number; offset?: number } = {},
  client?: any,
): Promise<TrainerReview[]> {
  const { limit = 20, offset = 0 } = opts;
  const supabase = client ?? createClient();
  const { data } = await (supabase as any)
    .from("trainer_recent_reviews")
    .select("stars, comment, created_at, reviewer_name")
    .eq("trainer_id", trainerId)
    .range(offset, offset + limit - 1);
  return ((data as any[]) ?? []).map((r) => ({
    stars: r.stars,
    comment: r.comment,
    createdAt: r.created_at,
    reviewerName: r.reviewer_name,
  }));
}

/** Avaliação existente do próprio cliente para esta marcação. */
export async function getMyRatingForBooking(bookingId: string) {
  const supabase = createClient();
  const { data } = await (supabase as any)
    .from("session_ratings")
    .select("stars, comment")
    .eq("booking_id", bookingId)
    .maybeSingle();
  return data as { stars: number; comment: string | null } | null;
}

/** Lista de booking_ids (entre os passados) que já têm avaliação do cliente actual. */
export async function getRatedBookingIds(bookingIds: string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();
  const supabase = createClient();
  const { data } = await (supabase as any)
    .from("session_ratings")
    .select("booking_id")
    .in("booking_id", bookingIds);
  return new Set(((data as any[]) ?? []).map((r) => r.booking_id));
}
