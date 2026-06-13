import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { getClientCredits, getClientCreditsByTrainer } from "@/lib/credits";
import { formatDateTime, pluralize } from "@/lib/utils";
import { Calendar, ShoppingBag, Sparkles, AlertCircle, NotebookPen, ChevronRight, MousePointerClick, Flame } from "lucide-react";
import { PushSubscribeCard } from "@/components/push-subscribe-card";
import { getCurrentStreak } from "@/lib/streak";

export default async function ClientDashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  // PERF: tudo em paralelo. Antes eram 4 round-trips sequenciais.
  // getClientCredits e getClientCreditsByTrainer partilham agora a mesma
  // query (em lib/credits.ts via cache()). getCurrentProfile() ja foi
  // executado pelo layout — aqui devolve do React.cache() sem nova query.
  const [
    profile,
    credits,
    creditsByTrainer,
    { data: upcoming },
    streak,
  ] = await Promise.all([
    getCurrentProfile(),
    getClientCredits(user.id),
    getClientCreditsByTrainer(user.id),
    supabase
      .from("bookings")
      .select("id, starts_at, ends_at, session_type, status")
      .eq("client_id", user.id)
      .in("status", ["booked", "confirmed"])
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(3),
    getCurrentStreak(user.id),
  ]);
  const multiTrainer = creditsByTrainer.length > 1;

  const lowCredits = credits.total > 0 && credits.total <= 2;
  const noCredits = credits.total === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Olá, {profile?.full_name?.split(" ")[0] ?? "atleta"}.
        </h1>
        <p className="text-sm text-ink-500">Pronto para mais uma sessão?</p>
      </div>

      <PushSubscribeCard />

      {streak.weeks >= 1 && (
        <div className="card flex items-center gap-3 border-gold-300 bg-gradient-to-br from-gold-50 to-bone-50 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-ink-900 text-gold-400">
            <Flame size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {streak.weeks} {streak.weeks === 1 ? "semana" : "semanas"} consecutivas
            </div>
            <div className="text-xs text-ink-600">
              {streak.weeks === 1
                ? "Boa! Continua para começar uma série."
                : "Mantém o ritmo — não quebres a série."}
            </div>
          </div>
        </div>
      )}

      {/* Cartão sessões — adapta-se ao tema. */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-bone-100/60">Sessões disponíveis</span>
          <Sparkles size={16} className="text-gold-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-display text-5xl font-black text-gold-500 dark:text-gold-400">{credits.total}</span>
          <span className="text-sm text-ink-500 dark:text-bone-100/60">{pluralize(credits.total, "sessão", "sessões")}</span>
        </div>
        {/* Dupla escondida — apenas mostramos a contagem total. Reactiva
            quando a Dupla voltar à UI. */}
        <div className="mt-5 flex gap-2">
          <Link href="/app/agenda" className="btn-gold flex-1">
            <Calendar size={16} /> Marcar sessão
          </Link>
          <Link href="/app/comprar" className="btn-outline flex-1">
            <ShoppingBag size={16} /> Comprar pack
          </Link>
        </div>
      </div>

      {/* Bolsas por trainer */}
      {multiTrainer && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Sessões por treinador
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {creditsByTrainer.map((t) => (
              <li key={t.trainerId} className="card p-4">
                <div className="text-sm font-semibold">{t.trainerName}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-ink-500">
                  <span className="rounded-full bg-bone-100 px-2 py-0.5"><strong>{t.individual + t.dupla}</strong> sessões</span>
                </div>
                <Link
                  href={`/app/agenda?trainer=${t.trainerId}`}
                  className="mt-2 inline-block text-xs font-medium text-gold-600"
                >
                  Marcar com {t.trainerName.split(" ")[0]} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Avisos */}
      {noCredits && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle size={16} /> Sem sessões disponíveis
          </div>
          <p className="mt-1">Compra um pack para voltares a marcar sessões.</p>
          <Link href="/app/comprar" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-red-900 underline">
            Ver packs →
          </Link>
        </div>
      )}
      {!noCredits && lowCredits && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle size={16} /> Restam {credits.total} {pluralize(credits.total, "sessão", "sessões")}
          </div>
          <p className="mt-1">Considera renovar o teu pack para não interromperes o treino.</p>
        </div>
      )}

      {/* Atalho notas */}
      <Link
        href="/app/notas"
        className="card flex items-center justify-between p-4 hover:border-gold-400"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-bone-100 text-ink-700">
            <NotebookPen size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold">As minhas notas</div>
            <div className="text-xs text-ink-500">Diário das tuas sessões. Privado.</div>
          </div>
        </div>
        <span className="text-xs font-medium text-gold-600">Abrir →</span>
      </Link>

      {/* Próximas sessões */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Próximas sessões</h2>
          <Link href="/app/historico" className="text-xs text-gold-600 hover:text-gold-700">
            Ver tudo
          </Link>
        </div>
        {(!upcoming || upcoming.length === 0) ? (
          <div className="card p-5 text-center text-sm text-ink-500">
            Sem sessões marcadas.{" "}
            <Link href="/app/agenda" className="font-medium text-gold-600">
              Marcar agora →
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/app/sessao/${b.id}`}
                  className="card flex items-center justify-between gap-3 p-4 hover:border-gold-400"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{formatDateTime(b.starts_at)}</div>
                    <div className="text-xs text-ink-500 capitalize">{b.session_type}</div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-gold-600">
                      <MousePointerClick size={12} /> Toca para mais opções
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={b.status === "confirmed" ? "chip-ok" : "chip-gold"}>
                      {b.status === "confirmed" ? "Confirmada" : "Marcada"}
                    </span>
                    <ChevronRight size={16} className="text-ink-500" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
