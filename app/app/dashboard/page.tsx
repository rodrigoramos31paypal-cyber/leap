import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { getClientCredits, getClientCreditsByTrainer } from "@/lib/credits";
import { formatDateTime, pluralize, BOOKING_STATUS } from "@/lib/utils";
import { Calendar, ShoppingBag, Sparkles, AlertCircle, ChevronRight } from "lucide-react";
import { PushSubscribeCard } from "@/components/push-subscribe-card";
import { PromoCarousel } from "@/components/promo-carousel";

// Fillers temporários até o cliente fornecer os banners reais.
const FILLER_BANNERS = [
  { id: "f1", title: "O teu ebook em destaque", subtitle: "Espaço promocional", button_label: "Saber mais", image_url: null, link_url: null },
  { id: "f2", title: "Plano de nutrição", subtitle: "Em breve", button_label: "Ver", image_url: null, link_url: null },
  { id: "f3", title: "Promoção especial", subtitle: "Brevemente", button_label: "Descobrir", image_url: null, link_url: null },
];

export default async function ClientDashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();
  const nowIso = new Date().toISOString();

  const [
    profile,
    credits,
    creditsByTrainer,
    { data: upcoming },
    { data: recentPast },
    { data: latestPackRows },
    { data: banners },
  ] = await Promise.all([
    getCurrentProfile(),
    getClientCredits(user.id),
    getClientCreditsByTrainer(user.id),
    supabase
      .from("bookings")
      .select("id, starts_at, session_type, status")
      .eq("client_id", user.id)
      .in("status", ["booked", "confirmed"])
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(1),
    supabase
      .from("bookings")
      .select("id, starts_at, session_type, status")
      .eq("client_id", user.id)
      .lt("starts_at", nowIso)
      .order("starts_at", { ascending: false })
      .limit(4),
    supabase
      .from("purchases")
      .select("pack_snapshot, sessions_total, sessions_remaining, created_at, expires_at")
      .eq("client_id", user.id)
      .eq("status", "confirmed")
      .gt("sessions_remaining", 0)
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
  const nowMs = Date.now();
  const latestPack = ((latestPackRows ?? []) as any[]).find(
    (p) => !p.expires_at || new Date(p.expires_at).getTime() >= nowMs,
  ) as any | undefined;
  const packName = latestPack ? (latestPack.pack_snapshot as any)?.name ?? "Pack" : null;

  // Taxa de presença (apenas do pack atual): sessões passadas desde a
  // compra do pack, presentes (confirmed) vs faltas (no_show).
  let presenca: number | null = null;
  let faltas = 0;
  if (latestPack) {
    const { data: since } = await supabase
      .from("bookings")
      .select("status")
      .eq("client_id", user.id)
      .gte("starts_at", latestPack.created_at)
      .lt("starts_at", nowIso)
      .in("status", ["confirmed", "no_show"]);
    const rows = (since ?? []) as any[];
    const attended = rows.filter((r) => r.status === "confirmed").length;
    faltas = rows.filter((r) => r.status === "no_show").length;
    const tot = attended + faltas;
    presenca = tot > 0 ? Math.round((attended / tot) * 100) : null;
  }

  const packPct =
    latestPack && latestPack.sessions_total > 0
      ? Math.round((latestPack.sessions_remaining / latestPack.sessions_total) * 100)
      : 0;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Olá, {profile?.full_name?.split(" ")[0] ?? "atleta"}.
        </h1>
        <p className="text-sm text-ink-500">Pronto para mais uma sessão?</p>
      </div>

      <PushSubscribeCard />

      {/* Sessões disponíveis */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-bone-100/60">Sessões disponíveis</span>
          <Sparkles size={16} className="text-gold-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-display text-4xl font-black text-gold-500 dark:text-gold-400">{credits.total}</span>
          <span className="text-sm text-ink-500 dark:text-bone-100/60">{pluralize(credits.total, "sessão", "sessões")}</span>
        </div>
        <div className="mt-4 flex gap-2">
          <Link href="/app/agenda" className="btn-gold flex-1">
            <Calendar size={16} /> Marcar sessão
          </Link>
          <Link href="/app/comprar" className="btn-outline flex-1">
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
          <p className="mt-1">Considera renovar o teu pack para não interromperes o treino.</p>
        </div>
      )}

      {/* Banners promocionais (ex: ebooks) */}
      <PromoCarousel banners={(((banners as any[]) ?? []).length ? banners : FILLER_BANNERS) as any} />

      {/* Próxima sessão */}
      {nextSession && (
        <Link
          href={`/app/sessao/${nextSession.id}`}
          className="card flex items-center justify-between gap-3 p-4 hover:border-gold-400"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-500">
              <Calendar size={13} /> Próxima sessão
            </div>
            <div className="mt-1 font-display text-lg font-bold">{formatDateTime(nextSession.starts_at)}</div>
            <div className="text-sm text-ink-500 capitalize">{nextSession.session_type}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={nextSession.status === "confirmed" ? "chip-ok" : "chip-gold"}>
              {nextSession.status === "confirmed" ? "Confirmada" : "Marcada"}
            </span>
            <ChevronRight size={16} className="text-ink-500" />
          </div>
        </Link>
      )}

      {/* Bolsas por trainer (multi-trainer) */}
      {multiTrainer && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Sessões por treinador</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {creditsByTrainer.map((t) => (
              <li key={t.trainerId} className="card p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-ink-900/10 bg-bone-100 dark:border-white/10 dark:bg-white/[0.06]">
                    {t.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.avatarUrl} alt={t.trainerName} className="h-full w-full object-cover" />
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

      {/* O teu progresso */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">O teu progresso</h2>
          <Link href="/app/historico" className="text-xs font-medium text-gold-600 hover:text-gold-700">Ver mais</Link>
        </div>
        <div className="card p-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-bone-50 p-2.5 dark:bg-white/[0.03]">
              <div className="text-[11px] font-semibold text-ink-600 dark:text-bone-100">O teu pack</div>
              <div className="mt-1 font-display text-lg font-bold tabular-nums">
                {latestPack ? `${latestPack.sessions_remaining}/${latestPack.sessions_total}` : "0/0"}
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
            <div className="rounded-lg bg-bone-50 p-2.5 dark:bg-white/[0.03]">
              <div className="text-[11px] font-semibold text-ink-600 dark:text-bone-100">Pack atual</div>
              <div className="mt-1 truncate text-sm font-bold">{packName ?? "Sem pack"}</div>
              <div className="text-[11px] text-ink-500">
                {latestPack ? `${latestPack.sessions_total} Sessões` : "Sem pack"}
              </div>
            </div>
          </div>
          {latestPack && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-900/10 dark:bg-white/10">
              <div className="h-full rounded-full bg-gold-400" style={{ width: `${packPct}%` }} />
            </div>
          )}
        </div>
      </section>

      {/* Histórico recente */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Histórico recente</h2>
          <Link href="/app/historico" className="text-xs font-medium text-gold-600 hover:text-gold-700">Ver tudo</Link>
        </div>
        {(!recentPast || recentPast.length === 0) ? (
          <div className="card p-5 text-center text-sm text-ink-500">Ainda sem sessões passadas.</div>
        ) : (
          <ul className="space-y-2">
            {(recentPast as any[]).map((b) => (
              <li key={b.id}>
                <Link href={`/app/sessao/${b.id}`} className="card flex items-center justify-between gap-3 p-4 hover:border-gold-400">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{formatDateTime(b.starts_at)}</div>
                    <div className="text-xs text-ink-500 capitalize">{b.session_type}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusChip status={b.status} />
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

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    booked: "chip-gold",
    confirmed: "chip-ok",
    cancelled: "chip-mute",
    no_show: "chip-danger",
  };
  return <span className={map[status] ?? "chip-mute"}>{(BOOKING_STATUS as any)[status] ?? status}</span>;
}
