import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Dumbbell, Flame, Shield, Trophy } from "lucide-react";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { getActiveTrainersPublic, getTrainerForClient } from "@/lib/trainer";
import { displayName, levelForStreak, LEVEL_CHIP, LEVEL_LABEL } from "@/lib/streak";
import { MedalBadges } from "@/components/medal-badges";

export const metadata = { title: "Perfil de atleta · LEAP", robots: { index: false, follow: false } };

export default async function AthletePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const [{ id }, back, viewer] = await Promise.all([params, searchParams, getCurrentProfile()]);
  if (!viewer) redirect("/login");
  if (viewer.role !== "client" || viewer.access_blocked || viewer.approval_status !== "approved") notFound();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) notFound();

  const trainerId = (await getTrainerForClient(viewer.id)) ?? (await getActiveTrainersPublic())[0]?.id;
  if (!trainerId) notFound();

  const db = createAdminClient() as any;
  const participant = `client_id.eq.${id},partner_client_id.eq.${id},partner2_client_id.eq.${id}`;
  // Require the same trainer membership as the leaderboard and honour opt-out at read time.
  const [{ data: athlete }, { data: membership }] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", id).eq("role", "client")
      .eq("approval_status", "approved").not("email", "ilike", "%@removido.invalid")
      .or("leaderboard_opt_out.is.null,leaderboard_opt_out.eq.false")
      .or("access_blocked.is.null,access_blocked.eq.false").maybeSingle(),
    db.from("bookings").select("id").eq("trainer_id", trainerId).or(participant).limit(1).maybeSingle(),
  ]);
  if (!athlete || !membership) notFound();

  const now = new Date();
  const lisbonDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [sessions, extras, streak, trophies] = await Promise.all([
    db.from("bookings").select("id", { count: "exact", head: true })
      .or(participant).in("status", ["booked", "confirmed"]).lte("ends_at", now.toISOString()),
    db.from("activities").select("id", { count: "exact", head: true })
      .eq("client_id", id).eq("status", "validated").lte("activity_date", lisbonDate),
    db.rpc("get_client_streak", { p_client: id }),
    db.from("ranking_monthly_winners").select("rank").eq("trainer_id", trainerId).eq("client_id", id),
  ]);
  if ([sessions, extras, streak, trophies].some(result => result.error)) {
    return <p role="alert" className="card p-4">Não foi possível carregar o perfil. Atualiza a página para tentar novamente.</p>;
  }
  const current = Number(streak.data?.[0]?.current_streak ?? 0);
  const best = Number(streak.data?.[0]?.best_streak ?? 0);
  const level = levelForStreak(current);
  const medalRows = (trophies.data ?? []) as { rank: number }[];
  const medals = { gold: 0, silver: 0, bronze: 0 };
  for (const { rank } of medalRows) {
    if (rank === 1) medals.gold++;
    if (rank === 2) medals.silver++;
    if (rank === 3) medals.bronze++;
  }
  const total = medals.gold + medals.silver + medals.bronze;
  const name = displayName(athlete.full_name);
  const query = new URLSearchParams();
  if (typeof back.month === "string" && /^\d{4}-\d{2}$/.test(back.month)) query.set("month", back.month);
  if (typeof back.page === "string" && /^\d+$/.test(back.page)) query.set("page", back.page);

  return (
    <div className="space-y-4">
      <Link href={`/app/leaderboard?${query}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold-700 dark:text-gold-300">
        <ArrowLeft size={16} /> Voltar ao ranking
      </Link>
      <header className="relative overflow-hidden rounded-2xl border border-gold-400/30 bg-ink-900 p-6 text-bone-50">
        <div className="absolute inset-0 bg-gradient-to-br from-gold-400/20 via-transparent to-transparent" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-gold-400/50 bg-gold-400/10 text-3xl font-bold text-gold-300" aria-hidden="true">{Array.from(name)[0]}</div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-gold-300">Atleta LEAP</p>
            <h1 className="mt-1 break-words font-display text-3xl font-bold">{name}</h1>
            <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${LEVEL_CHIP[level].bg} ${LEVEL_CHIP[level].text}`}>
              <Shield size={14} aria-hidden="true" /> {LEVEL_LABEL[level]}
            </span>
          </div>
        </div>
      </header>
      <div className="grid grid-cols-3 gap-2">
        <Stat icon={<Dumbbell size={18} />} value={(sessions.count ?? 0) + (extras.count ?? 0)} label="Atividades no total" />
        <Stat icon={<Flame size={18} />} value={best} label="Melhor sequência" detail={best === 1 ? "semana" : "semanas"} />
        <Stat icon={<Trophy size={18} />} value={total} label="Troféus" />
      </div>
      <section className="card space-y-3 p-4">
        <h2 className="font-display text-lg font-bold">Vitrine de troféus</h2>
        {total ? <MedalBadges {...medals} size={17} /> : <p className="text-sm text-ink-500">Ainda sem troféus neste ranking.</p>}
        <p className="text-xs text-ink-500">Sequência atual de {current} {current === 1 ? "semana" : "semanas"}.</p>
      </section>
    </div>
  );
}

function Stat({ icon, value, label, detail }: { icon: React.ReactNode; value: number; label: string; detail?: string }) {
  return (
    <div className="card min-w-0 p-3">
      <span className="text-gold-600 dark:text-gold-300" aria-hidden="true">{icon}</span>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums">{value}</p>
      {detail && <p className="text-xs text-ink-500">{detail}</p>}
      <p className="mt-1 text-xs font-semibold">{label}</p>
    </div>
  );
}
