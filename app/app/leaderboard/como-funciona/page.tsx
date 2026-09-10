import Link from "next/link";
import { ArrowLeft, Flame, Check, X, Minus } from "lucide-react";

export const metadata = { title: "Como funciona · Ranking LEAP", robots: { index: false, follow: false } };

const LEVELS: { label: string; range: string; bg: string; text: string }[] = [
  { label: "Bronze", range: "0–3 semanas", bg: "bg-[#FAECE7] dark:bg-[#F0997B]/10", text: "text-[#993C1D] dark:text-[#F0997B]" },
  { label: "Silver", range: "4–11 semanas", bg: "bg-ink-900/[0.06] dark:bg-white/10", text: "text-ink-600 dark:text-bone-100" },
  { label: "Gold", range: "12–23 semanas", bg: "bg-gold-100 dark:bg-gold-400/15", text: "text-gold-700 dark:text-gold-300" },
  { label: "Elite", range: "24+ semanas", bg: "bg-[#EEEDFE] dark:bg-[#7F77DD]/15", text: "text-[#3C3489] dark:text-[#AFA9EC]" },
];

export default function ComoFuncionaPage() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/app/leaderboard" className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400">
          <ArrowLeft size={14} /> Voltar ao ranking
        </Link>
        <h1 className="mt-2 flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <Flame size={22} className="shrink-0 text-gold-500" /> Sequência LEAP
        </h1>
        <p className="text-sm text-ink-500">O número de semanas seguidas em que treinas sem faltas.</p>
      </div>

      <div className="card space-y-3 p-4 text-sm">
        <div className="flex items-start gap-2.5">
          <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <p><span className="font-medium">Sobe</span> quando fazes todas as sessões marcadas dessa semana.</p>
        </div>
        <div className="flex items-start gap-2.5">
          <Minus size={16} className="mt-0.5 shrink-0 text-ink-400" />
          <p><span className="font-medium">Mantém-se</span> se não tiveres sessões nessa semana (ex.: férias, avisaste que não vinhas).</p>
        </div>
        <div className="flex items-start gap-2.5">
          <X size={16} className="mt-0.5 shrink-0 text-red-500" />
          <p><span className="font-medium">Reinicia a 0</span> se tiveres uma falta: não comparecer (no-show) ou cancelar em cima da hora.</p>
        </div>
        <p className="border-t border-ink-900/[0.06] pt-3 text-[12px] text-ink-500 dark:border-white/[0.07]">
          As semanas contam de segunda a domingo. A sequência da semana só entra quando a semana fecha (domingo à noite) — durante a semana vês se está no bom caminho.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Níveis</h2>
        <div className="grid grid-cols-2 gap-2">
          {LEVELS.map((l) => (
            <div key={l.label} className="card flex items-center justify-between gap-2 p-3">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${l.bg} ${l.text}`}>{l.label}</span>
              <span className="text-[11px] text-ink-500">{l.range}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[12px] text-ink-500">
        Apareces no ranking com o nome próprio e a inicial do apelido. Podes sair do ranking em Perfil → Definições.
      </p>
    </div>
  );
}
