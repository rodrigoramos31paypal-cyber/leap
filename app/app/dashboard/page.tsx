import { chatContext } from "@/lib/chat";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { CardSkeleton } from "@/components/skeleton";
import { getClientCredits, getClientCreditsByTrainer } from "@/lib/credits";
import { formatDateTime, pluralize } from "@/lib/utils";
import { Calendar, ShoppingBag, AlertCircle, ChevronRight, Trophy, MessageCircle } from "lucide-react";
import { levelForStreak, LEVEL_LABEL } from "@/lib/streak";
import { getTrainerForClient, getActiveTrainersPublic } from "@/lib/trainer";
import { PushSubscribeCard } from "@/components/push-subscribe-card";
import { PromoSlot } from "@/components/promo-slot";
import { ActivityButtons } from "@/components/activity-buttons";

export default async function ClientDashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  // Saldo e próxima sessão primeiro; progresso carregado em paralelo abaixo.
  const [
    profile,
    credits,
    creditsByTrainer,
    { data: upcoming },
    { data: latestPackRows },
    { data: banners },
  ] = await Promise.all([
    getCurrentProfile(),
    getClientCredits(user.id),
    getClientCreditsByTrainer(user.id),
    supabase
      .from("bookings")
      .select("id, starts_at, session_type, status")
      // DUO: inclui as sessões partilhadas em que sou o parceiro.
      .or(`client_id.eq.${user.id},partner_client_id.eq.${user.id}`)
      .in("status", ["booked", "confirmed"])
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(1),
    supabase
      .from("purchases")
      .select("id, pack_snapshot, sessions_total, sessions_remaining, created_at, expires_at")
      .eq("client_id", user.id)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(5),
    (supabase as any)
      .from("promo_banners")
      .select("id, title, subtitle, image_url, button_label, link_url")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .limit(10),
  ]);

  const multiTrainer = creditsByTrainer.length > 1;
  const lowCredits = credits.total > 0 && credits.total <= 2;
  const noCredits = credits.total === 0;

  const nextSession = (upcoming ?? [])[0] as any | undefined;
  const nextBadge = nextSession
    ? {
        day: new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit" }).format(new Date(nextSession.starts_at)),
        mon: new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", month: "short" }).format(new Date(nextSession.starts_at)).replace(/\./g, ""),
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Olá, {profile?.full_name?.split(" ")[0] ?? "atleta"}.
          </h1>
          <p className="text-sm text-ink-500">Pronto para mais uma sessão?</p>
        </div>
        <Suspense fallback={<MessagesLink unread={0} />}>
          <ClientMessagesLink />
        </Suspense>
      </div>

      {/* Sessões disponíveis */}
      <div className="rounded-[18px] border border-[#EBD98F] bg-[#FBF4DE] p-3.5 dark:border-gold-400/30 dark:bg-gold-400/10">
        <div className="flex items-baseline gap-2 text-[#3d3100] dark:text-gold-100">
          <strong className="font-display text-3xl tabular-nums">{credits.total}</strong>
          <span className="text-sm font-medium">{pluralize(credits.total, "sessão disponível", "sessões disponíveis")}</span>
        </div>
        <div className="mt-2.5 flex gap-2.5">
          <Link
            href="/app/agenda"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gold-400 px-3 py-3 text-sm font-semibold text-ink-900 transition hover:bg-gold-300 dark:text-bone-50"
          >
            <Calendar size={16} /> Marcar sessão
          </Link>
          <Link
            href="/app/comprar"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#EBD98F] bg-white px-3 py-3 text-sm font-medium text-[#3d3100] transition hover:bg-[#FBF4DE] dark:border-gold-400/30 dark:bg-transparent dark:text-gold-200 dark:hover:bg-white/5"
          >
            <ShoppingBag size={16} /> Comprar pack
          </Link>
        </div>
      </div>

      {/* Avisos de saldo */}
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
          <p className="mt-1">Considera renovar o teu pack para não interromperes o teu progresso.</p>
        </div>
      )}

      {/* Próxima sessão */}
      {nextSession && (
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-500">
              <Calendar size={12} /> Próxima sessão
            </h2>
            <Link href="/app/historico?f=futuras" className="text-xs font-medium text-gold-600 hover:text-gold-700">Ver mais</Link>
          </div>
          <Link
            href={`/app/sessao/${nextSession.id}`}
            className="card flex items-center gap-3 p-3.5 transition hover:border-gold-400"
          >
            <div className="flex h-[46px] w-[46px] shrink-0 flex-col items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <span className="text-base font-bold leading-none">{nextBadge?.day}</span>
              <span className="text-[8px] font-semibold uppercase tracking-wide">{nextBadge?.mon}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[15px] font-bold text-ink-900 dark:text-bone-50">{formatDateTime(nextSession.starts_at)}</div>
              <div className="text-xs capitalize text-ink-500">{nextSession.session_type}</div>
            </div>
            <span className="chip-ok shrink-0">Confirmada</span>
            <ChevronRight size={16} className="shrink-0 text-ink-300 dark:text-white/25" />
          </Link>
        </section>
      )}

      {/* Atividade extra (treino autónomo / cardio) — pendente de validação.
          NÃO mexe em saldo/sessões do pack; conta para o Ranking após validar. */}
      <ActivityButtons />

      {/* Bolsas por trainer (multi-trainer) */}
      {multiTrainer && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Sessões por trainer</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {creditsByTrainer.map((t) => (
              <li key={t.trainerId} className="card p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-ink-900/10 bg-bone-100 dark:border-white/10 dark:bg-white/[0.06]">
                    {t.avatarUrl ? (
                      <Image
                        src={t.avatarUrl}
                        alt={t.trainerName}
                        width={40}
                        height={40}
                        sizes="40px"
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-display text-sm font-bold text-ink-500">
                        {(t.trainerName.trim()[0] ?? "T").toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{t.trainerName}</div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      <span className="rounded-full bg-bone-100 px-2 py-0.5 dark:bg-white/5"><strong>{t.individual + t.dupla}</strong> sessões</span>
                    </div>
                  </div>
                </div>
                <Link href={`/app/agenda?trainer=${t.trainerId}`} className="mt-2 inline-block text-xs font-medium text-gold-600">
                  Marcar com {t.trainerName.split(" ")[0]} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* PERF (audit #3): secções abaixo da dobra streamed — não bloqueiam
          o 1º paint do cartão de saldo + CTAs. */}
      <Suspense
        fallback={
          <>
            <CardSkeleton className="h-32" />
          </>
        }
      >
        <BelowFold
          userId={user.id}
          nowIso={nowIso}
          latestPackRows={(latestPackRows ?? []) as any[]}
          packRemaining={credits.total}
          packTotal={credits.totalAttributed}
        />
      </Suspense>
      <PromoSlot banners={banners ?? []} />
      <PushSubscribeCard />
    </div>
  );
}

async function BelowFold({
  userId,
  nowIso,
  latestPackRows,
  packRemaining,
  packTotal,
}: {
  userId: string;
  nowIso: string;
  latestPackRows: any[];
  // Agregados de TODOS os packs activos (não-expirados, com saldo > 0),
  // alinhados com "Sessões disponíveis". packRemaining === credits.total.
  packRemaining: number;
  packTotal: number;
}) {
  const supabase = await createClient();
  const nowMs = Date.now();

  // Pack activo mais recente — usado apenas para a janela da taxa de presença.
  const latestPack = (latestPackRows as any[]).find(
    (p) =>
      p.sessions_remaining > 0 &&
      (!p.expires_at || new Date(p.expires_at).getTime() >= nowMs),
  ) as any | undefined;

  // Só o progresso precisa destas consultas; o histórico tem página própria.
  const [presencaRes, streakRes, lbRows] = await Promise.all([
    latestPack
      ? supabase
          .from("bookings")
          .select("status")
          // DUO: a sessão dupla também desconta ao par — conta para a presença.
          .or(`client_id.eq.${userId},partner_client_id.eq.${userId}`)
          .gte("starts_at", latestPack.created_at)
          .lt("starts_at", nowIso)
          .in("status", ["confirmed", "no_show"])
      : Promise.resolve({ data: null }),
    // Sequência LEAP (0149): sequência atual + estado da semana em curso.
    (supabase as any).rpc("get_client_streak", { p_client: userId }),
    // Posição no Ranking LEAP (card): resolve o trainer e busca o rank.
    (async () => {
      const tId =
        (await getTrainerForClient(userId)) ??
        (await getActiveTrainersPublic())[0]?.id ??
        null;
      if (!tId) return null;
      const { data } = await (supabase as any).rpc("get_leaderboard", { p_trainer: tId });
      return (data as any[] | null) ?? null;
    })(),
  ]);

  const streakRow = ((streakRes as any)?.data as any[] | null)?.[0];
  const streakWeeks = Number(streakRow?.current_streak ?? 0);
  const myRank = ((lbRows as any[] | null) ?? []).find((r) => r.client_id === userId)?.rank ?? null;

  // Taxa de presença (apenas do pack activo mais recente).
  let presenca: number | null = null;
  let faltas = 0;
  if (latestPack) {
    const rows = (presencaRes.data ?? []) as any[];
    const attended = rows.filter((r) => r.status === "confirmed").length;
    faltas = rows.filter((r) => r.status === "no_show").length;
    const tot = attended + faltas;
    presenca = tot > 0 ? Math.round((attended / tot) * 100) : null;
  }

  // Barra agregada: proporção de sessões já usadas (marcadas/decrementadas)
  // sobre o total atribuído nos packs activos. Consistente com "X/Y".
  const packPct =
    packTotal > 0
      ? Math.min(100, Math.round(((packTotal - packRemaining) / packTotal) * 100))
      : 0;

  return (
    <>
      {/* O teu progresso */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">O teu progresso</h2>
          <Link href="/app/progresso" className="text-xs font-medium text-gold-700 dark:text-gold-300">Ver detalhes →</Link>
        </div>
        <div className="card p-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-bone-50 p-2.5 dark:bg-white/[0.03]">
              <div className="text-[11px] font-semibold text-ink-600 dark:text-bone-100">O teu pack</div>
              <div className="mt-1 font-display text-lg font-bold tabular-nums">
                {packTotal > 0 ? `${packRemaining}/${packTotal}` : "0/0"}
              </div>
              <div className="text-[11px] text-ink-500">sessões restantes</div>
            </div>
            <div className="rounded-lg bg-bone-50 p-2.5 dark:bg-white/[0.03]">
              <div className="text-[11px] font-semibold text-ink-600 dark:text-bone-100">Taxa de presença</div>
              <div className="mt-1 font-display text-lg font-bold tabular-nums">
                {presenca !== null ? `${presenca}%` : "—"}
              </div>
              <div className="text-[11px] text-ink-500">
                {presenca === null ? "Sem dados" : faltas === 0 ? "Excelente" : `${faltas} ${pluralize(faltas, "falta", "faltas")}`}
              </div>
            </div>
            <Link
              href="/app/leaderboard"
              className="block rounded-lg bg-bone-50 p-2.5 transition hover:bg-bone-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
            >
              <div className="text-[11px] font-semibold text-ink-600 dark:text-bone-100">Ranking</div>
              <div className="mt-1 flex items-center gap-1">
                <Trophy size={15} className="shrink-0 text-gold-500" />
                <span className="font-display text-lg font-bold tabular-nums">{myRank ? `${myRank}º` : "—"}</span>
              </div>
              <div className="truncate text-[11px] font-medium text-gold-700 dark:text-gold-300">
                {LEVEL_LABEL[levelForStreak(streakWeeks)]} · ver ›
              </div>
            </Link>
          </div>
          {packTotal > 0 && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-900/10 dark:bg-white/10">
              <div className="h-full rounded-full bg-gold-400 transition-all" style={{ width: `${packPct}%` }} />
            </div>
          )}
        </div>
      </section>

    </>
  );
}

async function ClientMessagesLink() {
  const context = await chatContext();
  if (!context) return <MessagesLink unread={0} />;
  const { count } = await (context.db as any).from("leap_chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("client_id", context.clientId).eq("staff_id", context.staffId)
    .eq("sender_id", context.staffId).is("read_at", null);
  return <MessagesLink unread={count ?? 0} />;
}

function MessagesLink({ unread }: { unread: number }) {
  return (
    <Link href="/app/mensagens" className="btn-outline min-h-11 gap-2">
      <MessageCircle size={16} aria-hidden="true" /> Mensagens
      {unread > 0 && <span className="chip-gold" aria-label={`${unread} por ler`}>{unread}</span>}
    </Link>
  );
}
