import Link from "next/link";
import { requireStaff } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { formatDateTime } from "@/lib/utils";
import { Star, ChevronDown } from "lucide-react";

export const dynamic = "force-dynamic";

// ════════════════════════════════════════════════════════════════
// /admin/feedback — avaliações que os clientes deixaram às sessões.
//
// Cada linha é uma avaliação (cliente · estrelas · data). Clicar abre o
// comentário que o cliente escreveu.
//
// LEITURA: as avaliações têm RLS "trainer read own" (cada treinador só vê as
// suas). Para o dono ver as de TODA a equipa, lemos com o service-role
// client, mas SEMPRE com escopo aos treinadores acessíveis
// (getAccessibleTrainerIds: owner → toda a equipa, trainer → só o próprio).
// ════════════════════════════════════════════════════════════════

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${n} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={14}
          className={i <= n ? "fill-gold-400 text-gold-500" : "text-ink-900/15 dark:text-white/20"}
        />
      ))}
    </span>
  );
}

export default async function AdminFeedbackPage() {
  await requireStaff();

  const trainerIds = await getAccessibleTrainerIds();
  // `session_ratings` ainda não está nos tipos gerados → cliente destipado
  // para esta leitura (resultados são convertidos manualmente abaixo).
  const db: any = createAdminClient();

  const { data: ratingsRaw } = await db
    .from("session_ratings")
    .select("id, stars, comment, created_at, client_id, trainer_id, booking_id")
    .in("trainer_id", trainerIds.length > 0 ? trainerIds : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: false })
    .limit(300);
  const ratings = (ratingsRaw ?? []) as {
    id: string; stars: number; comment: string | null; created_at: string;
    client_id: string; trainer_id: string; booking_id: string;
  }[];

  const clientIds = Array.from(new Set(ratings.map((r) => r.client_id)));
  const bookingIds = Array.from(new Set(ratings.map((r) => r.booking_id)));

  const [{ data: profs }, { data: trs }, { data: bks }] = await Promise.all([
    clientIds.length > 0
      ? db.from("profiles").select("id, full_name").in("id", clientIds)
      : Promise.resolve({ data: [] as any[] }),
    trainerIds.length > 0
      ? db.from("trainers").select("id, profiles:profile_id(full_name)").in("id", trainerIds)
      : Promise.resolve({ data: [] as any[] }),
    bookingIds.length > 0
      ? db.from("bookings").select("id, starts_at").in("id", bookingIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const nameOf = new Map<string, string>();
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) {
    nameOf.set(p.id, p.full_name?.trim() || "Cliente");
  }
  const trainerName = new Map<string, string>();
  for (const t of (trs ?? []) as { id: string; profiles: { full_name: string | null } | null }[]) {
    trainerName.set(t.id, t.profiles?.full_name?.trim() || "Treinador");
  }
  const bookingWhen = new Map<string, string>();
  for (const b of (bks ?? []) as { id: string; starts_at: string }[]) {
    bookingWhen.set(b.id, b.starts_at);
  }
  const showTrainer = trainerIds.length > 1;

  const total = ratings.length;
  const withComment = ratings.filter((r) => r.comment && r.comment.trim().length > 0).length;
  const avg = total > 0 ? ratings.reduce((s, r) => s + r.stars, 0) / total : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/admin/definicoes" className="text-sm text-ink-500 hover:text-ink-900">
        ← Definições
      </Link>

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Feedback</h1>
        <p className="text-sm text-ink-500">Avaliações que os clientes deixaram às sessões.</p>
      </div>

      {total > 0 && (
        <div className="flex items-center gap-4 rounded-2xl border border-[#EBD98F] bg-[#FBF4DE] p-4 dark:border-gold-400/30 dark:bg-gold-400/10">
          <div>
            <div className="font-display text-[2rem] font-bold leading-none text-[#3d3100] dark:text-gold-100">
              {avg.toFixed(1)}
            </div>
            <div className="mt-1"><Stars n={Math.round(avg)} /></div>
          </div>
          <div className="text-sm text-[#8A6D12] dark:text-gold-200/80">
            {total} {total === 1 ? "avaliação" : "avaliações"}
            {withComment > 0 && <> · {withComment} com comentário</>}
          </div>
        </div>
      )}

      {total === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">
          Ainda não há avaliações. Assim que os clientes avaliarem as sessões, aparecem aqui.
        </div>
      ) : (
        <div className="space-y-2">
          {ratings.map((r) => {
            const hasComment = !!r.comment && r.comment.trim().length > 0;
            const when = bookingWhen.get(r.booking_id);
            const summary = (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{nameOf.get(r.client_id) ?? "Cliente"}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                    <Stars n={r.stars} />
                    {when && <span>· {formatDateTime(when)}</span>}
                    {showTrainer && <span>· {trainerName.get(r.trainer_id) ?? ""}</span>}
                  </div>
                </div>
                {hasComment ? (
                  <ChevronDown size={17} className="shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
                ) : (
                  <span className="shrink-0 text-[11px] italic text-ink-400">sem comentário</span>
                )}
              </div>
            );

            if (!hasComment) {
              return (
                <div key={r.id} className="card p-3.5">
                  {summary}
                </div>
              );
            }
            return (
              <details key={r.id} className="card group overflow-hidden p-0">
                <summary className="flex cursor-pointer list-none items-center p-3.5">
                  <div className="w-full">{summary}</div>
                </summary>
                <div className="border-t border-ink-900/[0.06] px-3.5 py-3 text-sm text-ink-700 dark:border-white/[0.07] dark:text-bone-100/80">
                  {r.comment}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
