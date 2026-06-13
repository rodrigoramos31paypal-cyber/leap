import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getPublicTrainerBySlug } from "@/lib/public-trainer";
import { ReviewsPopup } from "./reviews-popup";

// Página pública do treinador. Indexável (SEO) — sem auth obrigatória.
// URL: /t/<slug>
//
// PERF: ISR-friendly (revalidate 1h). O conteúdo (rating, bio) muda
// pouco; novas reviews aparecem no máximo 1h depois.
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const t = await getPublicTrainerBySlug(params.slug);
  if (!t) {
    return { title: "Treinador não encontrado" };
  }
  const title = `${t.fullName} · Personal Trainer`;
  const description =
    t.bio?.slice(0, 160) ??
    `Marca sessões com ${t.fullName} — disponibilidade actualizada e marcação online.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "profile" },
    twitter: { card: "summary", title, description },
    alternates: { canonical: `/t/${t.slug}` },
  };
}

export default async function PublicTrainerPage({
  params,
}: {
  params: { slug: string };
}) {
  const t = await getPublicTrainerBySlug(params.slug);
  if (!t) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-5 sm:p-8">
      {/* Header com identidade visual */}
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-600">
        <span className="font-display font-black tracking-tight">LEAP</span>
        <span className="text-ink-500">·</span>
        <span className="text-ink-500">Fitness</span>
      </Link>

      <header className="card flex items-start gap-4 p-5">
        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-ink-900 font-display text-3xl font-black text-gold-400">
          {t.fullName?.[0]?.toUpperCase() ?? "T"}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight">{t.fullName}</h1>
          <div className="mt-1 text-xs uppercase tracking-wider text-ink-500">
            Personal Trainer
          </div>
          <div className="mt-3">
            <ReviewsPopup
              avgStars={t.stats.avgStars}
              reviewCount={t.stats.reviewCount}
              reviews={t.reviews}
            />
          </div>
        </div>
      </header>

      {/* Bio */}
      {t.bio && (
        <section className="card p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Sobre
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">{t.bio}</p>
        </section>
      )}

      {/* CTA — marcar / criar conta */}
      <section className="card space-y-3 p-5">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">Pronto para treinar?</h2>
          <p className="mt-1 text-sm text-ink-500">
            Cria a tua conta em segundos e marca a primeira sessão com {t.fullName.split(" ")[0]}.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href={`/registar?trainer=${t.id}`} className="btn-gold flex-1 text-center">
            Marcar agora
          </Link>
          <Link href={`/login?trainer=${t.id}`} className="btn-outline flex-1 text-center">
            Já tenho conta
          </Link>
        </div>
      </section>

      <footer className="pt-4 text-center text-xs text-ink-500">
        Página pública de {t.fullName} · <Link href="/" className="underline">LEAP-FITNESS</Link>
      </footer>
    </div>
  );
}
