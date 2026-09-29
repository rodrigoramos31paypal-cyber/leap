import Link from "next/link";
import { Trophy, ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds, getActiveTrainersPublic } from "@/lib/trainer";
import { ActivitiesAdmin } from "./activities-admin";

export const metadata = { title: "Ranking LEAP", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

type Tab = "ranking" | "atividades";

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

const PODIUM = ["#F4ECC4", "#E7E7E2", "#FAECE7"];
const PODIUM_TEXT = ["#65540B", "#5F5E5A", "#993C1D"];

export default async function AdminLeaderboardPage(props: {
  searchParams: Promise<{ page?: string; tab?: string; atab?: string }>;
}) {
  const sp = await props.searchParams;
  const tab: Tab = sp.tab === "atividades" ? "atividades" : "ranking";
  const sub = sp.atab === "historico" ? "historico" : "pendentes";
  const supabase = await createClient();
  // Mesma resolução do leaderboard do cliente: o trainer ATIVO do estúdio
  // (o que tem as marcações), com fallback ao scope acessível do admin.
  const [actives, accessible] = await Promise.all([
    getActiveTrainersPublic(),
    getAccessibleTrainerIds(),
  ]);
  const trainerId = actives[0]?.id ?? accessible[0] ?? null;
  const trainerIds = accessible.length > 0 ? accessible : trainerId ? [trainerId] : [];

  // Contador de pendentes para o badge da aba "Atividades".
  let pendingCount = 0;
  if (trainerIds.length > 0) {
    const { count } = await (supabase as any)
      .from("activities")
      .select("id", { count: "exact", head: true })
      .in("trainer_id", trainerIds)
      .eq("status", "pending");
    pendingCount = count ?? 0;
  }

  let rows: Row[] = [];
  if (tab === "ranking" && trainerId) {
    const { data } = await (supabase as any).rpc("get_leaderboard", { p_trainer: trainerId });
    rows = ((data ?? []) as Row[]).sort((a, b) => a.rank - b.rank);
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(sp.page ?? "1", 10) || 1));
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(from, from + PAGE_SIZE);

  const href = (p: number) => `/admin/leaderboard${p > 1 ? `?page=${p}` : ""}`;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Ranking LEAP</h1>
        <p className="text-sm text-ink-500">
          {tab === "ranking"
            ? `${rows.length} ${rows.length === 1 ? "cliente" : "clientes"} · sequência de treinos consecutivos, sem faltas`
            : "Validação de treinos autónomos e cardio submetidos pelos clientes"}
        </p>
      </div>

      {/* Abas: Ranking · Atividades (com contador de pendentes) */}
      <div className="v2-segment flex gap-1 text-sm">
        <Link
          href="/admin/leaderboard"
          data-active={tab === "ranking"}
          className={`v2-seg-item flex flex-1 items-center justify-center px-3 py-2 text-center font-semibold ${
            tab === "ranking" ? "text-ink-900 dark:text-bone-50" : "text-ink-500 dark:text-bone-100"
          }`}
        >
          Ranking
        </Link>
        <Link
          href="/admin/leaderboard?tab=atividades"
          data-active={tab === "atividades"}
          className={`v2-seg-item flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-center font-semibold ${
            tab === "atividades" ? "text-ink-900 dark:text-bone-50" : "text-ink-500 dark:text-bone-100"
          }`}
        >
          Atividades
          {pendingCount > 0 && (
            <span className="grid min-w-[18px] place-items-center rounded-full bg-gold-400 px-1 text-[10px] font-bold text-ink-900">
              {pendingCount}
            </span>
          )}
        </Link>
      </div>

      {tab === "atividades" ? (
        <ActivitiesAdmin trainerIds={trainerIds} sub={sub} />
      ) : rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">Ainda não há clientes no ranking.</div>
      ) : (
        <div className="space-y-1.5">
          {/* Cabeçalho das colunas */}
          <div className="flex items-center gap-3 px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
            <span className="w-6 shrink-0 text-center">#</span>
            <span className="flex-1">Nome</span>
            <span className="w-12 shrink-0 text-right">% Pack</span>
            <span className="w-12 shrink-0 text-right">Ativid.</span>
          </div>
          {pageRows.map((r) => {
            const podium = r.rank <= 3;
            return (
              <Link
                key={r.client_id}
                href={`/admin/clientes/${r.client_id}`}
                className="flex items-center gap-3 rounded-xl border border-ink-900/10 bg-white px-3 py-2.5 transition hover:border-gold-400 dark:border-white/10 dark:bg-ink-800"
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
                  <div className="truncate text-sm font-medium">{r.full_name || "—"}</div>
                </div>

                <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {r.pack_pct == null ? "—" : `${r.pack_pct}%`}
                </span>
                <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-gold-700 dark:text-gold-300">
                  {r.activities_total ?? 0}
                </span>
              </Link>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-3">
              {page > 1 ? (
                <Link href={href(page - 1)} aria-label="Página anterior" className="grid h-9 w-9 place-items-center rounded-full border border-ink-900/15 text-ink-700 hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-100">
                  <ChevronLeft size={18} />
                </Link>
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded-full border border-ink-900/10 text-ink-300 dark:border-white/10">
                  <ChevronLeft size={18} />
                </span>
              )}
              <span className="text-xs text-ink-500">Página {page} de {totalPages}</span>
              {page < totalPages ? (
                <Link href={href(page + 1)} aria-label="Página seguinte" className="grid h-9 w-9 place-items-center rounded-full border border-ink-900 text-ink-900 hover:bg-ink-900/5 dark:border-bone-50 dark:text-bone-50">
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
    </div>
  );
}
