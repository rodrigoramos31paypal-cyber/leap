import Link from "next/link";
import { redirect } from "next/navigation";
import { Flame, Trophy, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getTrainerForClient, getActiveTrainersPublic } from "@/lib/trainer";
import { displayName, levelForStreak, LEVEL_LABEL, LEVEL_CHIP } from "@/lib/streak";

export const metadata = { title: "Ranking LEAP", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

type Row = {
  client_id: string;
  full_name: string | null;
  current_streak: number;
  best_streak: number;
  attended: number;
  faltas: number;
  rank: number;
};

// Cor do círculo de posição para o pódio (1/2/3).
const PODIUM = ["#F4ECC4", "#E7E7E2", "#FAECE7"]; // ouro, prata, bronze
const PODIUM_TEXT = ["#65540B", "#5F5E5A", "#993C1D"];

export default async function LeaderboardPage(props: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await props.searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const trainerId =
    (await getTrainerForClient(user.id)) ??
    (await getActiveTrainersPublic())[0]?.id ??
    null;

  let rows: Row[] = [];
  if (trainerId) {
    const { data } = await (supabase as any).rpc("get_leaderboard", { p_trainer: trainerId });
    rows = ((data ?? []) as Row[]).sort((a, b) => a.rank - b.rank);
  }

  const me = rows.find((r) => r.client_id === user.id) ?? null;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(sp.page ?? "1", 10) || 1));
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(from, from + PAGE_SIZE);

  const href = (p: number) => `/app/leaderboard${p > 1 ? `?page=${p}` : ""}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Ranking LEAP</h1>
        <p className="text-sm text-ink-500">Semanas de treinos consecutivos, sem faltas.</p>
      </div>

      {me ? (
        <div className="flex items-center justify-between rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-sm dark:border-gold-400/40 dark:bg-gold-400/10">
          <span className="font-medium text-ink-800 dark:text-bone-100">
            Estás em <strong>#{me.rank}</strong>
          </span>
          <span className="inline-flex items-center gap-1.5 text-gold-700 dark:text-gold-300">
            <Flame size={15} /> {me.current_streak} {me.current_streak === 1 ? "semana" : "semanas"}
            {me.best_streak > me.current_streak && (
              <span className="text-ink-500 dark:text-bone-100/60"> · recorde {me.best_streak}</span>
            )}
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-ink-900/10 bg-bone-50 px-4 py-3 text-xs text-ink-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-bone-100">
          <Info size={14} className="mt-0.5 shrink-0" />
          Estás fora do ranking. Podes entrar em Perfil → Definições.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">
          Ainda não há ranking. Começa a treinar para construíres a tua sequência.
        </div>
      ) : (
        <div className="space-y-1.5">
          {pageRows.map((r) => {
            const lvl = levelForStreak(r.current_streak);
            const chip = LEVEL_CHIP[lvl];
            const isMe = r.client_id === user.id;
            const podium = r.rank <= 3;
            return (
              <div
                key={r.client_id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  isMe
                    ? "border-gold-400 bg-gold-50 dark:border-gold-400/50 dark:bg-gold-400/10"
                    : "border-ink-900/10 bg-white dark:border-white/10 dark:bg-ink-800"
                }`}
              >
                {podium ? (
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                    style={{ background: PODIUM[r.rank - 1], color: PODIUM_TEXT[r.rank - 1] }}
                  >
                    {r.rank === 1 ? <Trophy size={13} /> : r.rank}
                  </span>
                ) : (
                  <span className="grid h-6 w-6 shrink-0 place-items-center text-[13px] font-medium text-ink-400">
                    {r.rank}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm font-medium ${isMe ? "text-gold-700 dark:text-gold-300" : ""}`}>
                    {isMe ? "Tu · " : ""}
                    {displayName(r.full_name)}
                  </div>
                </div>

                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.bg} ${chip.text}`}>
                  {LEVEL_LABEL[lvl]}
                </span>

                <span className="flex w-[42px] shrink-0 items-center justify-end gap-1 text-gold-600 dark:text-gold-400">
                  <Flame size={14} />
                  <span className="text-sm font-semibold tabular-nums text-ink-900 dark:text-bone-50">
                    {r.current_streak}
                  </span>
                </span>
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-3">
              {page > 1 ? (
                <Link
                  href={href(page - 1)}
                  aria-label="Página anterior"
                  className="grid h-9 w-9 place-items-center rounded-full border border-ink-900/15 text-ink-700 hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-100"
                >
                  <ChevronLeft size={18} />
                </Link>
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded-full border border-ink-900/10 text-ink-300 dark:border-white/10">
                  <ChevronLeft size={18} />
                </span>
              )}
              <span className="text-xs text-ink-500">Página {page} de {totalPages}</span>
              {page < totalPages ? (
                <Link
                  href={href(page + 1)}
                  aria-label="Página seguinte"
                  className="grid h-9 w-9 place-items-center rounded-full border border-ink-900 text-ink-900 hover:bg-ink-900/5 dark:border-bone-50 dark:text-bone-50"
                >
                  <ChevronRight size={18} />
                </Link>
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded-full border border-ink-900/10 text-ink-300 dark:border-white/10">
                  <ChevronRight size={18} />
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <Link href="/app/leaderboard/como-funciona" className="block pt-1 text-center text-xs font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400">
        Como funciona a sequência LEAP?
      </Link>
    </div>
  );
}
