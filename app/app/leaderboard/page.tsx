import Link from "next/link";
import { redirect } from "next/navigation";
import { Trophy, ChevronLeft, ChevronRight, Info, Flame } from "lucide-react";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getTrainerForClient, getActiveTrainersPublic } from "@/lib/trainer";
import { displayName } from "@/lib/streak";
import { MedalBadges } from "@/components/medal-badges";
import { MonthSelect } from "./month-select";

export const metadata = { title: "Ranking LEAP", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;
const AWARDS_START = "2026-10"; // 1º mês com prémios

type Row = {
  client_id: string;
  full_name: string | null;
  pack_pct: number | null;
  pt_done_month: number;
  extra_month: number;
  activities_total: number;
  current_streak: number;
  rank: number;
};

type Medals = { gold: number; silver: number; bronze: number };

const PODIUM = ["#F4ECC4", "#E7E7E2", "#FAECE7"]; // ouro, prata, bronze
const PODIUM_TEXT = ["#65540B", "#5F5E5A", "#993C1D"];

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function pctLabel(p: number | null | undefined): string {
  return p == null ? "—" : `${p}%`;
}

function periodLabel(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return `${MONTHS_PT[m - 1]} ${y}`;
}

// Lista de meses do corrente até AWARDS_START (descendente).
function periodsDownTo(current: string): string[] {
  const [sy, sm] = AWARDS_START.split("-").map(Number);
  let [y, m] = current.split("-").map(Number);
  const out: string[] = [];
  while (y > sy || (y === sy && m >= sm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return out;
}

export default async function LeaderboardPage(props: {
  searchParams: Promise<{ page?: string; month?: string }>;
}) {
  const sp = await props.searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const trainerId =
    (await getTrainerForClient(user.id)) ??
    (await getActiveTrainersPublic())[0]?.id ??
    null;

  // Mês corrente (fuso de Lisboa) e lista de meses disponíveis.
  const currentPeriod = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
  }).format(new Date()).slice(0, 7);
  const periods = periodsDownTo(currentPeriod);
  const selectedPeriod = sp.month && periods.includes(sp.month) ? sp.month : currentPeriod;
  const isCurrent = selectedPeriod === currentPeriod;

  let rows: Row[] = [];
  const medalsByClient = new Map<string, Medals>();
  if (trainerId) {
    // Garante que os meses fechados estão gravados (captura lazy, sem cron).
    await (supabase as any).rpc("ensure_months_snapshotted", { p_trainer: trainerId });

    const [{ data: rk }, { data: md }] = await Promise.all([
      (supabase as any).rpc("get_leaderboard_month", { p_trainer: trainerId, p_period: selectedPeriod }),
      (supabase as any).rpc("get_trainer_medals", { p_trainer: trainerId }),
    ]);
    rows = ((rk ?? []) as Row[]).sort((a, b) => a.rank - b.rank);
    for (const m of (md ?? []) as any[]) {
      medalsByClient.set(m.client_id, { gold: m.gold ?? 0, silver: m.silver ?? 0, bronze: m.bronze ?? 0 });
    }
  }

  const me = rows.find((r) => r.client_id === user.id) ?? null;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(sp.page ?? "1", 10) || 1));
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(from, from + PAGE_SIZE);

  const monthQS = isCurrent ? "" : `month=${selectedPeriod}`;
  const href = (p: number) => {
    const parts = [monthQS, p > 1 ? `page=${p}` : ""].filter(Boolean);
    return `/app/leaderboard${parts.length ? `?${parts.join("&")}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Ranking LEAP</h1>
          <p className="text-sm text-ink-500">Baseado em progresso + atividades validadas.</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelect
            selected={selectedPeriod}
            current={currentPeriod}
            options={periods.map((p) => ({ value: p, label: periodLabel(p) }))}
          />
          {isCurrent && (
            <span className="rounded-full border border-gold-400/60 bg-gold-50 px-2.5 py-1 text-xs font-semibold text-gold-700 dark:bg-gold-400/10 dark:text-gold-300">
              Novo mês
            </span>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-ink-900/10 bg-bone-50 px-4 py-3 text-xs text-ink-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-bone-100">
        <Info size={14} className="mt-0.5 shrink-0" />
        O ranking reinicia todos os meses. Os troféus mostram vitórias anteriores.
      </div>

      {me && isCurrent && (
        <div className="flex items-center justify-between rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-sm dark:border-gold-400/40 dark:bg-gold-400/10">
          <span className="font-medium text-ink-800 dark:text-bone-100">
            Estás em <strong>#{me.rank}</strong>
          </span>
          <span className="text-gold-700 dark:text-gold-300">
            {pctLabel(me.pack_pct)} · {me.activities_total} {me.activities_total === 1 ? "atividade" : "atividades"}
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">
          {isCurrent
            ? "Ainda não há ranking este mês. Começa a treinar para construíres a tua consistência."
            : "Não há ranking registado para este mês."}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
            <span className="w-6 shrink-0 text-center">#</span>
            <span className="flex-1">Nome</span>
            <span className="w-16 shrink-0 whitespace-nowrap text-right">Progresso</span>
            <span className="w-9 shrink-0 text-right">Ativ.</span>
            <span className="w-10 shrink-0 text-right">Seq.</span>
          </div>

          {pageRows.map((r) => {
            const isMe = r.client_id === user.id;
            const podium = r.rank <= 3;
            const medals = medalsByClient.get(r.client_id);
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

                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className={`truncate text-sm font-medium ${isMe ? "text-gold-700 dark:text-gold-300" : ""}`}>
                    {isMe ? "Tu · " : ""}
                    {displayName(r.full_name)}
                  </span>
                  {medals && <MedalBadges gold={medals.gold} silver={medals.silver} bronze={medals.bronze} />}
                </div>

                <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {pctLabel(r.pack_pct)}
                </span>
                <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-gold-700 dark:text-gold-300">
                  {r.activities_total ?? 0}
                </span>
                <span className="flex w-10 shrink-0 items-center justify-end gap-0.5 text-sm font-medium tabular-nums text-ink-500 dark:text-bone-100/70">
                  <Flame size={12} className="text-gold-500" />
                  {r.current_streak ?? 0}
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
        Como funciona o Ranking LEAP?
      </Link>
    </div>
  );
}
