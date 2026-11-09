import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { changePasswordAction, updateProfileAction } from "./actions";
import { NotificationCategoryPrefs, type CategoryPrefs } from "@/components/notification-category-prefs";
import { LeaderboardToggle } from "@/components/leaderboard-toggle";
import { CLIENT_CATEGORIES } from "@/lib/notifications-config";
import { DeleteAccountSection } from "@/components/delete-account-section";
import { ShieldCheck, User, Bell, MessageCircle, Dumbbell, Trophy, KeyRound, CalendarDays, Flame } from "lucide-react";
import { displayName, levelForStreak, LEVEL_LABEL, LEVEL_CHIP } from "@/lib/streak";
import { CalendarSubscribeCard } from "@/components/calendar-subscribe-card";
import { chatContext } from "@/lib/chat";
import { ChatThread } from "@/components/chat-thread";
import { currentPeriodLisbon } from "@/lib/ranking-periods";
import { MedalBadges } from "@/components/medal-badges";
import { getActiveTrainersPublic, getTrainerForClient } from "@/lib/trainer";
import { listVerifiedFactors } from "@/lib/mfa";
import { EnrollCard } from "./seguranca/enroll-card";
import { unenrollAction } from "./seguranca/actions";

// "seguranca" foi absorvida pela tab "Perfil" — 2FA + mudança de
// palavra-passe + apagar conta estão agora no mesmo ecrã.
type TabId = "perfil" | "calendario" | "chat" | "notificacoes";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "perfil",       label: "Perfil",       icon: <User size={14} /> },
  { id: "calendario",   label: "Calendário",   icon: <CalendarDays size={14} /> },
  { id: "chat", label: "Chat com o PT", icon: <MessageCircle size={14} /> },
  { id: "notificacoes", label: "Notificações", icon: <Bell size={14} /> },
];

export default async function PerfilPage(
  props: {
    searchParams: Promise<{ ok?: string; tab?: string; antes?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const activeTab: TabId = ((): TabId => {
    const t = searchParams.tab;
    if (t === "notas") redirect("/app/notas");
    if (t === "calendario" || t === "chat" || t === "notificacoes") return t;
    return "perfil";
  })();

  const [tabData, chat] = await Promise.all([
    loadTabData(activeTab, supabase, user.id),
    activeTab === "chat" ? chatContext() : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Perfil</h1>
        <p className="text-sm text-ink-500">Os teus dados, notificações e segurança.</p>
      </div>

      {searchParams.ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Perfil atualizado.</div>
      )}

      <TabNav active={activeTab} />

      {activeTab === "perfil" && (
        <PerfilTab
          profile={tabData.profile}
          factors={tabData.factors ?? []}
          activity={tabData.activity ?? null}
          streak={tabData.streak ?? null}
          athlete={tabData.athlete}
        />
      )}
      {activeTab === "calendario" && (
        <CalendarioTab
          feedHttpUrl={tabData.feedHttpUrl ?? null}
          feedWebcalUrl={tabData.feedWebcalUrl ?? null}
          feedLastFetchedAt={tabData.feedLastFetchedAt ?? null}
        />
      )}
      {activeTab === "chat" && (chat
        ? <ChatThread context={chat} before={searchParams.antes} inProfile />
        : <p className="card p-4 text-sm">A conversa fica disponível assim que tiveres um treinador associado.</p>
      )}
      {activeTab === "notificacoes" && (
        <NotificacoesTab prefs={tabData.notifPrefs ?? {}} />
      )}
    </div>
  );
}

function TabNav({ active }: { active: TabId }) {
  // Barra segmentada em pílulas (design fitnessv2): largura igual, ativa =
  // pílula branca com sombra. Substitui os separadores com sublinhado.
  const short: Record<TabId, string> = {
    perfil: "Perfil",
    calendario: "Calendário",
    chat: "Chat com o PT",
    notificacoes: "Notificações",
  };
  return (
    <div className="flex gap-1 rounded-xl border border-ink-900/[0.07] bg-bone-100 p-1 dark:border-white/10 dark:bg-ink-900">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={`/app/perfil?tab=${t.id}`}
            className={
              isActive
                ? "flex min-h-10 flex-1 items-center justify-center rounded-lg bg-white px-0.5 py-1.5 text-center text-[10.5px] font-semibold text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50"
                : "flex min-h-10 flex-1 items-center justify-center rounded-lg px-0.5 py-1.5 text-center text-[10.5px] font-medium text-ink-500 transition hover:text-ink-900 dark:hover:text-bone-50"
            }
          >
            {short[t.id] ?? t.label}
          </Link>
        );
      })}
    </div>
  );
}

async function loadTabData(
  tab: TabId,
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const data: any = {};

  if (tab === "perfil") {
    const [{ data: profile }, { data: summaryRows }, { data: streakRows }, athlete, factors] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).single(),
      (supabase as any).rpc("get_client_activity_summary", { p_client: userId }),
      (supabase as any).rpc("get_client_streak", { p_client: userId }),
      loadAthleteStats(supabase, userId),
      listVerifiedFactors().catch(() => []),
    ]);
    data.profile = profile;
    data.factors = factors;
    data.athlete = athlete;
    data.activity = (summaryRows as any[] | null)?.[0] ?? null;
    data.streak = (streakRows as any[] | null)?.[0] ?? null;
  }

  if (tab === "calendario") {
    // Feed iCal pessoal (subscrição única do calendário). Cada profile
    // tem um calendar_feed_token; construímos a URL http + a variante
    // webcal:// (que o iOS abre direto no app Calendário). O
    // calendar_feed_last_fetched_at dá-nos o estado da subscrição.
    const { data: profile } = await supabase
      .from("profiles")
      .select("calendar_feed_token, calendar_feed_last_fetched_at")
      .eq("id", userId)
      .single();
    const feedToken = (profile as any)?.calendar_feed_token as string | undefined;
    const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    data.feedHttpUrl = feedToken && appBase
      ? `${appBase}/api/calendar/feed/${feedToken}.ics`
      : null;
    data.feedWebcalUrl = data.feedHttpUrl
      ? (data.feedHttpUrl as string).replace(/^https?:\/\//, "webcal://")
      : null;
    data.feedLastFetchedAt = (profile as any)?.calendar_feed_last_fetched_at ?? null;
  }

  if (tab === "notificacoes") {
    const { data: prefsRows } = await (supabase as any)
      .from("notification_preferences")
      .select("kind, email_enabled, push_enabled")
      .eq("user_id", userId);
    const map: CategoryPrefs = {};
    for (const r of (prefsRows ?? []) as any[]) {
      map[String(r.kind)] = {
        email: r.email_enabled !== false,
        push: r.push_enabled !== false,
      };
    }
    data.notifPrefs = map;
  }

  return data;
}

type AthleteStats = {
  activities: number | null;
  rank: number | null;
  medals: { gold: number; silver: number; bronze: number } | null;
};

async function loadAthleteStats(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<AthleteStats> {
  const now = new Date();
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [sessions, extras, ranking] = await Promise.all([
    (supabase as any).from("bookings").select("id", { count: "exact", head: true })
      .or(`client_id.eq.${userId},partner_client_id.eq.${userId},partner2_client_id.eq.${userId}`)
      .in("status", ["booked", "confirmed"]).lte("ends_at", now.toISOString()),
    (supabase as any).from("activities").select("id", { count: "exact", head: true })
      .eq("client_id", userId).eq("status", "validated").lte("activity_date", day),
    (async () => {
      const trainerId = (await getTrainerForClient(userId)) ?? (await getActiveTrainersPublic())[0]?.id;
      if (!trainerId) return { medals: null, rank: null };
      const [{ data: awards, error: awardsError }, { data: rows }] = await Promise.all([
        (supabase as any).rpc("get_trainer_medals", { p_trainer: trainerId }),
        (supabase as any).rpc("get_leaderboard_month", {
          p_trainer: trainerId,
          p_period: currentPeriodLisbon(),
        }),
      ]);
      return {
        medals: awardsError ? null : awards?.find((row: { client_id: string }) => row.client_id === userId)
          ?? { gold: 0, silver: 0, bronze: 0 },
        rank: rows?.find((row: { client_id: string }) => row.client_id === userId)?.rank ?? null,
      };
    })(),
  ]);
  return {
    activities: sessions.error || extras.error ? null : (sessions.count ?? 0) + (extras.count ?? 0),
    ...ranking,
  };
}

function PerfilTab({
  profile,
  factors,
  activity,
  streak,
  athlete,
}: {
  profile: any;
  factors: any[];
  activity: any;
  streak: any;
  athlete: AthleteStats;
}) {
  const hasFactor = factors.length > 0;
  const today = new Date().toISOString().slice(0, 10);

  const streakWeeks = Number(streak?.current_streak ?? 0);
  const lvl = levelForStreak(streakWeeks);
  const chip = LEVEL_CHIP[lvl];
  const name = displayName(profile?.full_name);
  const medals = athlete.medals;
  const trophyCount = medals ? medals.gold + medals.silver + medals.bronze : null;
  const packPct = activity?.pack_pct ?? null;
  const total = Number(activity?.activities_total ?? 0);
  const ptDone = Number(activity?.pt_done ?? 0);
  const autoDone = Number(activity?.autonomous_validated ?? 0);
  const cardioDone = Number(activity?.cardio_validated ?? 0);

  return (
    <div className="space-y-4">
      <section aria-label="Perfil de atleta LEAP" className="space-y-3">
        <div className="relative overflow-hidden rounded-2xl border border-gold-400/30 bg-ink-900 p-5 text-bone-50">
          <div className="absolute inset-0 bg-gradient-to-br from-gold-400/20 via-transparent to-transparent" aria-hidden="true" />
          <div className="relative flex items-center gap-4">
            <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-gold-400/50 bg-gold-400/10 text-3xl font-bold text-gold-300" aria-hidden="true">{Array.from(name)[0]}</div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-gold-300">Atleta LEAP</p>
              <h2 className="break-words font-display text-2xl font-bold">{name}</h2>
              <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${chip.bg} ${chip.text}`}>
                <ShieldCheck size={14} aria-hidden="true" /> {LEVEL_LABEL[lvl]}
              </span>
            </div>
            <Link href="/app/leaderboard" className="ml-auto shrink-0 rounded-xl border border-gold-400/30 bg-gold-400/10 px-2.5 py-2 text-right hover:border-gold-400">
              <span className="block text-[10px] font-semibold text-gold-300">Ranking do mês</span>
              <span className="block font-display text-lg font-bold tabular-nums">
                {athlete.rank == null ? <span className="text-xs">Sem posição</span> : `${athlete.rank}.º`}
              </span>
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <AthleteStat icon={<Dumbbell size={18} />} value={athlete.activities} label="Atividades no total" />
          <AthleteStat icon={<Flame size={18} />} value={streak ? Number(streak.best_streak ?? 0) : null} label="Melhor sequência" unit={streak?.best_streak === 1 ? "semana" : "semanas"} />
          <AthleteStat icon={<Trophy size={18} />} value={trophyCount} label="Troféus" />
        </div>
        {medals && trophyCount ? (
          <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="text-sm font-semibold">Vitrine de troféus</span>
            <MedalBadges {...medals} size={15} />
          </div>
        ) : null}
      </section>

      {/* Resumo de consistência (mês corrente) */}
      <div className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">A tua consistência</h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-bone-50 p-3 dark:bg-white/[0.03]">
            <div className="text-[11px] font-semibold text-ink-600 dark:text-bone-100">Consistência do pack</div>
            <div className="mt-1 font-display text-lg font-bold tabular-nums">
              {packPct === null ? "—" : `${packPct}%`}
            </div>
          </div>
          <div className="rounded-lg bg-bone-50 p-3 dark:bg-white/[0.03]">
            <div className="text-[11px] font-semibold text-ink-600 dark:text-bone-100">Sequência LEAP</div>
            <div className="mt-1 inline-flex items-baseline gap-1.5">
              <span className="font-display text-lg font-bold tabular-nums">{streakWeeks}</span>
              <span className="text-[11px] text-ink-500">{streakWeeks === 1 ? "semana" : "semanas"}</span>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-bone-50 p-3 dark:bg-white/[0.03]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Atividade (este mês)</span>
            <span className="font-display text-lg font-bold tabular-nums">
              {total} {total === 1 ? "atividade" : "atividades"}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-ink-500">
            {ptDone} {ptDone === 1 ? "sessão PT" : "sessões PT"} · {autoDone} {autoDone === 1 ? "treino autónomo" : "treinos autónomos"} · {cardioDone} {cardioDone === 1 ? "cardio" : "cardios"}
          </div>
        </div>

      </div>

      <form action={updateProfileAction} className="card space-y-4 p-5">
        <div>
          <label className="label">Nome completo</label>
          <input name="full_name" defaultValue={profile?.full_name ?? ""} required className="input" />
        </div>
        <div>
          <label className="label">Email</label>
          <input value={profile?.email ?? ""} disabled className="input bg-bone-100 text-ink-500" />
        </div>
        <div>
          <label className="label">Telemóvel</label>
          <input name="phone" defaultValue={profile?.phone ?? ""} className="input" />
        </div>
        <div>
          <label className="label">Data de nascimento (opcional)</label>
          <input
            name="date_of_birth"
            type="date"
            defaultValue={profile?.date_of_birth ?? ""}
            max={today}
            className="input"
          />
        </div>
        <button type="submit" className="btn-primary w-full">Guardar</button>
      </form>

      <LeaderboardToggle initialVisible={!profile?.leaderboard_opt_out} />

      <section>
        <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-500">
          <ShieldCheck size={14} /> Verificação em dois passos
        </h2>
        {hasFactor ? (
          <div className="card space-y-3 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                <ShieldCheck size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">2FA está activa</div>
                <div className="text-xs text-ink-500">
                  Vais ter de meter um código do teu app de autenticação ao entrares
                  em dispositivos novos.
                </div>
              </div>
            </div>
            {factors.map((f: any) => (
              <form
                key={f.id}
                action={unenrollAction}
                className="space-y-2 rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2"
              >
                <input type="hidden" name="factorId" value={f.id} />
                <input type="hidden" name="returnTo" value="/app/perfil?tab=perfil" />
                <div className="text-xs">
                  <div className="font-semibold">{f.friendly_name || "Authenticator app"}</div>
                  <div className="text-ink-500">
                    Configurado em {new Date(f.created_at).toLocaleDateString("pt-PT")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoComplete="one-time-code"
                    className="input flex-1 text-center font-mono tracking-[0.3em]"
                    placeholder="Código 2FA"
                    aria-label="Código 2FA actual"
                  />
                  <button className="btn-outline shrink-0 text-xs text-red-700 hover:bg-red-50 border-red-200">
                    Desactivar
                  </button>
                </div>
              </form>
            ))}
          </div>
        ) : (
          <EnrollCard returnTo="/app/perfil?tab=perfil" />
        )}
      </section>

      <section>
        <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-500">
          <KeyRound size={14} /> Mudar palavra-passe
        </h2>
        <form action={changePasswordAction} className="card space-y-4 p-5">
          <div>
            <label className="label">Palavra-passe atual</label>
            <input
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
              placeholder="A tua palavra-passe atual"
            />
          </div>
          <div>
            <label className="label">Nova palavra-passe</label>
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              className="input"
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div>
            <label className="label">Confirmar nova palavra-passe</label>
            <input
              name="confirm"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              className="input"
            />
          </div>
          <button type="submit" className="btn-primary w-full">Atualizar palavra-passe</button>
        </form>
      </section>

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">Apagar conta</h2>
        <DeleteAccountSection />
      </div>
    </div>
  );
}

function CalendarioTab({
  feedHttpUrl,
  feedWebcalUrl,
  feedLastFetchedAt,
}: {
  feedHttpUrl: string | null;
  feedWebcalUrl: string | null;
  feedLastFetchedAt: string | null;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Sincroniza as tuas sessões com o calendário do telemóvel. Subscreves uma vez e
        ficam sempre atualizadas.
      </p>
      <CalendarSubscribeCard
        httpUrl={feedHttpUrl}
        webcalUrl={feedWebcalUrl}
        lastFetchedAt={feedLastFetchedAt}
      />
    </div>
  );
}

function AthleteStat({ icon, value, label, unit }: { icon: React.ReactNode; value: number | null; label: string; unit?: string }) {
  return (
    <div className="card min-w-0 p-3">
      <span className="text-gold-600 dark:text-gold-300" aria-hidden="true">{icon}</span>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums">{value ?? "—"}</p>
      {unit && value != null && <p className="text-xs text-ink-500">{unit}</p>}
      <p className="mt-1 text-xs font-semibold">{label}</p>
    </div>
  );
}

function NotificacoesTab({ prefs }: { prefs: CategoryPrefs }) {
  return (
    <div className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Notificações</h2>
      <p className="text-xs text-ink-500">
        Escolhe como queres ser avisado em cada tipo. Os emails de confirmar conta e
        recuperar password são sempre enviados.
      </p>
      <NotificationCategoryPrefs categories={CLIENT_CATEGORIES} initial={prefs} />
    </div>
  );
}
