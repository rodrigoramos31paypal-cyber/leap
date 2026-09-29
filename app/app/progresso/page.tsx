import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Flame, Dumbbell, Heart, Activity, ChevronRight, Trophy } from "lucide-react";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { levelForStreak, LEVEL_LABEL, LEVEL_CHIP } from "@/lib/streak";

export const metadata = { title: "O meu progresso · LEAP", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Anel de progresso (SVG) — usa a paleta dourada, adapta a dark mode.
function Ring({ pct }: { pct: number | null }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const value = pct ?? 0;
  const offset = circ * (1 - value / 100);
  return (
    <div className="relative grid h-24 w-24 shrink-0 place-items-center">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-ink-900/10 dark:stroke-white/10" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className="stroke-gold-400"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-display text-xl font-bold tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
      </div>
    </div>
  );
}

export default async function ProgressoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const [{ data: summaryRows }, { data: streakRows }, { data: consRows }, { data: packRow }] =
    await Promise.all([
      (supabase as any).rpc("get_client_activity_summary", { p_client: user.id }),
      (supabase as any).rpc("get_client_streak", { p_client: user.id }),
      (supabase as any).rpc("get_client_month_consistency", { p_client: user.id }),
      supabase
        .from("purchases")
        .select("sessions_total, sessions_remaining, created_at, pack_snapshot")
        .eq("client_id", user.id)
        .eq("status", "confirmed")
        .gt("sessions_total", 0)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const summary = (summaryRows as any[] | null)?.[0] ?? null;
  const streak = (streakRows as any[] | null)?.[0] ?? null;
  const cons = (consRows as any[] | null)?.[0] ?? null;

  const packPct = summary?.pack_pct ?? null;
  const ptDone = Number(summary?.pt_done ?? 0);
  const autoDone = Number(summary?.autonomous_validated ?? 0);
  const cardioDone = Number(summary?.cardio_validated ?? 0);
  const total = Number(summary?.activities_total ?? 0);

  const streakWeeks = Number(streak?.current_streak ?? 0);
  const lvl = levelForStreak(streakWeeks);
  const chip = LEVEL_CHIP[lvl];

  const consPct = cons?.pct ?? null;
  const weeksDone = Number(cons?.weeks_done ?? 0);
  const weeksRel = Number(cons?.weeks_relevant ?? 0);

  const packTotal = Number((packRow as any)?.sessions_total ?? 0);
  const packRemaining = Number((packRow as any)?.sessions_remaining ?? 0);
  const packUsed = Math.max(0, packTotal - packRemaining);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/app/dashboard" className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400">
          <ArrowLeft size={14} /> Voltar
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">O meu progresso</h1>
        <p className="text-sm text-ink-500">Resumo do teu mês — pack, consistência e atividade.</p>
      </div>

      {/* Pack atual */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Pack atual</span>
          {packPct !== null && (
            <span className="text-[11px] font-semibold text-gold-700 dark:text-gold-300">{packPct}% do pack</span>
          )}
        </div>
        {packTotal > 0 ? (
          <>
            <div className="mt-1 font-display text-lg font-bold tabular-nums">
              {packUsed}/{packTotal} <span className="text-[11px] font-medium text-ink-500">sessões utilizadas</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-900/10 dark:bg-white/10">
              <div className="h-full rounded-full bg-gold-400" style={{ width: `${packPct ?? 0}%` }} />
            </div>
          </>
        ) : (
          <div className="mt-1 text-sm text-ink-500">Sem pack ativo.</div>
        )}
      </div>

      {/* Consistência no mês */}
      <div className="card flex items-center gap-4 p-4">
        <Ring pct={consPct} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Consistência no mês</div>
          <div className="mt-0.5 font-display text-base font-bold">
            {weeksRel > 0 ? `${weeksDone}/${weeksRel} semanas` : "Sem semanas ainda"}
          </div>
          <p className="mt-0.5 text-[11px] text-ink-500">
            {consPct === null
              ? "Treina ou valida atividade para começar a contar."
              : consPct >= 80
                ? "Bom trabalho! Mantém a consistência."
                : "Cada semana ativa conta. Continua!"}
          </p>
        </div>
      </div>

      {/* Atividade validada */}
      <div className="card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Atividade validada (mês)</span>
          <span className="font-display text-lg font-bold tabular-nums">{total}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-bone-50 p-2.5 text-center dark:bg-white/[0.03]">
            <Activity size={15} className="mx-auto text-ink-500" />
            <div className="mt-1 font-display text-base font-bold tabular-nums">{ptDone}</div>
            <div className="text-[10px] text-ink-500">sessões PT</div>
          </div>
          <div className="rounded-lg bg-bone-50 p-2.5 text-center dark:bg-white/[0.03]">
            <Dumbbell size={15} className="mx-auto text-ink-500" />
            <div className="mt-1 font-display text-base font-bold tabular-nums">{autoDone}</div>
            <div className="text-[10px] text-ink-500">treinos</div>
          </div>
          <div className="rounded-lg bg-bone-50 p-2.5 text-center dark:bg-white/[0.03]">
            <Heart size={15} className="mx-auto text-ink-500" />
            <div className="mt-1 font-display text-base font-bold tabular-nums">{cardioDone}</div>
            <div className="text-[10px] text-ink-500">cardios</div>
          </div>
        </div>
        <Link href="/app/atividades" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400">
          Ver todas as atividades <ChevronRight size={13} />
        </Link>
      </div>

      {/* Sequência + nível */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Sequência LEAP</div>
          <div className="mt-1 inline-flex items-center gap-1.5">
            <Flame size={16} className="text-gold-500" />
            <span className="font-display text-lg font-bold tabular-nums">{streakWeeks}</span>
            <span className="text-[11px] text-ink-500">{streakWeeks === 1 ? "semana" : "semanas"}</span>
          </div>
        </div>
        <div className="card flex flex-col justify-between p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Nível atual</div>
          <div className="mt-1">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.bg} ${chip.text}`}>
              {LEVEL_LABEL[lvl]}
            </span>
          </div>
        </div>
      </div>

      {/* Entrada para o ranking (o card do dashboard abre esta página). */}
      <Link href="/app/leaderboard" className="card flex items-center justify-between p-4 transition hover:border-gold-400">
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Trophy size={16} className="text-gold-500" /> Ranking LEAP
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gold-600 dark:text-gold-400">
          Ver a tua posição <ChevronRight size={13} />
        </span>
      </Link>

      <Link href="/app/leaderboard/como-funciona" className="block pt-1 text-center text-xs font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400">
        Como funciona o Ranking LEAP?
      </Link>
    </div>
  );
}
