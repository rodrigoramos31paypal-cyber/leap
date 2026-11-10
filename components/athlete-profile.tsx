import "server-only";
import Link from "next/link";
import { Dumbbell, Flame, Shield, Trophy } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { displayName, levelForStreak, LEVEL_CHIP, LEVEL_LABEL } from "@/lib/streak";
import { periodLabel, RANKING_START_DATE, RANKING_START_LISBON } from "@/lib/ranking-periods";

export async function renderAthleteProfile(id: string, trainerId: string, admin = false) {
  const rankingHref = admin ? "/admin/leaderboard" : "/app/leaderboard";
  const Heading = admin ? "h2" : "h1";
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
  if (!athlete || !membership) return null;

  const now = new Date();
  const lisbonDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [sessions, extras, streak, trophies] = await Promise.all([
    db.from("bookings").select("id", { count: "exact", head: true })
      .or(participant).in("status", ["booked", "confirmed"]).gte("starts_at", RANKING_START_LISBON).lte("ends_at", now.toISOString()),
    db.from("activities").select("id", { count: "exact", head: true })
      .eq("client_id", id).eq("status", "validated").gte("activity_date", RANKING_START_DATE).lte("activity_date", lisbonDate),
    db.rpc("get_client_streak", { p_client: id }),
    db.from("ranking_monthly_winners").select("rank,period,pack_pct_snapshot,activities_total_snapshot,streak_snapshot").eq("trainer_id", trainerId).eq("client_id", id).order("period", { ascending: false }),
  ]);
  if ([sessions, extras, streak, trophies].some(result => result.error)) {
    return <p role="alert" className="card p-4">Não foi possível carregar o perfil. Atualiza a página para tentar novamente.</p>;
  }
  const current = Number(streak.data?.[0]?.current_streak ?? 0);
  const best = Number(streak.data?.[0]?.best_streak ?? 0);
  const level = levelForStreak(current);
  const awards = (trophies.data ?? []) as {
    rank: number;
    period: string;
    pack_pct_snapshot: number | null;
    activities_total_snapshot: number | null;
    streak_snapshot: number | null;
  }[];
  const total = awards.length;
  const awardDetails = await Promise.all(awards.map(async award => {
    if (award.activities_total_snapshot != null) {
      return {
        ...award,
        stats: { pack_pct: award.pack_pct_snapshot, activities_total: award.activities_total_snapshot },
      };
    }
    const { data } = await db.rpc("get_leaderboard_month", {
      p_trainer: trainerId,
      p_period: award.period,
    });
    const stats = (data as { client_id: string; activities_total: number; pack_pct: number | null }[] | null)
      ?.find(row => row.client_id === id);
    return { ...award, stats };
  }));
  const name = displayName(athlete.full_name);
  return (
    <div className="space-y-4">
      <header className="relative overflow-hidden rounded-2xl border border-gold-400/30 bg-ink-900 p-6 text-bone-50">
        <div className="absolute inset-0 bg-gradient-to-br from-gold-400/20 via-transparent to-transparent" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-gold-400/50 bg-gold-400/10 text-3xl font-bold text-gold-300" aria-hidden="true">{Array.from(name)[0]}</div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-gold-300">Atleta LEAP</p>
            <Heading className="mt-1 break-words font-display text-3xl font-bold">{name}</Heading>
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
        {total ? (
          <ul className="divide-y divide-ink-900/10 dark:divide-white/10">
            {awardDetails.map(({ rank, period, stats, streak_snapshot }) => {
              const medal = rank === 1
                ? { label: "Ouro", color: "bg-[#FBF1CE] text-[#89630B]" }
                : rank === 2
                  ? { label: "Prata", color: "bg-[#E9EAEC] text-[#555D69]" }
                  : { label: "Bronze", color: "bg-[#F3E1D1] text-[#875025]" };

              return (
                <li key={period} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${medal.color}`}>
                      <Trophy size={19} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{rank}.º lugar · {medal.label}</p>
                      <Link href={`${rankingHref}?month=${encodeURIComponent(period)}`} className="text-sm font-semibold text-gold-700 hover:underline dark:text-gold-300">
                        {periodLabel(period)}
                      </Link>
                      <table className="mt-2 w-full table-fixed text-right tabular-nums">
                        <thead className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                          <tr>
                            <th scope="col">Pack %</th>
                            <th scope="col"><abbr title="Atividades" className="no-underline">Ativ.</abbr></th>
                            <th scope="col"><abbr title="Sequência" className="no-underline">Seq.</abbr></th>
                          </tr>
                        </thead>
                        <tbody className="text-sm font-semibold">
                          <tr>
                            <td className="pt-1">{stats?.pack_pct != null ? `${stats.pack_pct}%` : "—"}</td>
                            <td className="pt-1 text-gold-700 dark:text-gold-300">{stats?.activities_total ?? "—"}</td>
                            <td className="pt-1" aria-label={streak_snapshot == null ? "Sequência do mês indisponível" : undefined}>
                              {streak_snapshot ?? "—"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-ink-500">Ainda sem troféus neste ranking.</p>}
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
