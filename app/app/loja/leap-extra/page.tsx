import Link from "next/link";
import { redirect } from "next/navigation";
import { Dumbbell, Utensils, ArrowUpRight, Check, CalendarDays } from "lucide-react";
import { getSessionUser } from "@/lib/supabase/server";
import { PROJECT_PLATFORM_URL } from "@/lib/leap-extra";
import { currentDiscountEligibility } from "@/lib/leap-discount";
import { openLeapAnnualDiscount } from "./actions";

export default async function LeapExtraPage({ searchParams }: { searchParams: Promise<{ desconto?: string }> }) {
  if (!(await getSessionUser())) redirect("/login");
  const eligible = await currentDiscountEligibility();
  const { desconto } = await searchParams;
  return <div className="mx-auto max-w-3xl space-y-5">
    <Link href="/app/loja" className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-700 dark:text-gold-300">← Loja LEAP</Link>
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-widest text-gold-700 dark:text-gold-300">Para complementar o teu PT</p>
      <h1 className="font-display text-2xl font-bold tracking-tight">Treino e alimentação</h1>
      <p className="text-sm leading-relaxed text-ink-500">Mantém a rotina entre sessões, nas férias ou quando treinas por tua conta. Conhece os treinos guiados e as ferramentas de alimentação do Projeto 21 Dias.</p>
    </header>
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="card p-4"><Dumbbell size={22} className="text-gold-700 dark:text-gold-300" aria-hidden="true" /><h2 className="mt-2 text-base font-bold">Treinos com orientação</h2><ul className="mt-3 space-y-2 text-sm text-ink-500">{["Planos de treino e vídeos dos exercícios", "Séries, repetições e registo das cargas", "Percursos para diferentes níveis e contextos"].map(text => <li key={text} className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />{text}</li>)}</ul></section>
      <section className="card p-4"><Utensils size={22} className="text-gold-700 dark:text-gold-300" aria-hidden="true" /><h2 className="mt-2 text-base font-bold">Alimentação mais organizada</h2><ul className="mt-3 space-y-2 text-sm text-ink-500">{["Receitas e vídeos de preparação", "Organização das refeições", "Lista de compras para facilitar a semana"].map(text => <li key={text} className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-gold-600" aria-hidden="true" />{text}</li>)}</ul></section>
    </div>
    <section className="card space-y-3 border-gold-400/40 bg-gold-400/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-300">Vantagem exclusiva LEAP</p>
      <h2 className="text-base font-bold">Tens um código de desconto por seres cliente LEAP</h2>
      <p className="text-sm text-ink-500">Código <strong className="tracking-wider text-ink-900 dark:text-bone-50">LEAP10</strong> · desconto no acesso anual. Consulta os preços e as condições na plataforma.</p>
      {desconto === "indisponivel" && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Não foi possível ativar o desconto. Confirma o email da tua conta e se tens uma compra PT confirmada.</p>}
      {eligible ? <form action={openLeapAnnualDiscount}><button type="submit" className="btn-primary min-h-11 w-full">Ativar LEAP10 e abrir a plataforma <ArrowUpRight size={16} aria-hidden="true" /></button></form>
        : <p className="text-xs text-ink-500">O benefício é reservado a clientes LEAP com email verificado e uma compra PT confirmada. Se já treinas connosco e não consegues ativá-lo, fala com o João Pedro.</p>}
      <a href={PROJECT_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-gold-700 dark:text-gold-300">Conhecer a plataforma<ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only"> (abre noutra janela)</span></a>
      <a href={PROJECT_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-gold-700 dark:text-gold-300">Já tenho acesso · Entrar<ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only"> (abre noutra janela)</span></a>
    </section>
    <div className="rounded-xl bg-bone-100 p-4 text-xs leading-relaxed text-ink-500 dark:bg-white/5">
      <p className="flex items-center gap-2 font-semibold text-ink-900 dark:text-bone-50"><CalendarDays size={15} aria-hidden="true" />Como funciona nesta fase</p>
      <p className="mt-2">O acesso, a conta e o pagamento são tratados no Projeto 21 Dias. Se ainda não tens conta lá, precisas de te registar; o login da LEAP não entra automaticamente na outra plataforma. Não pagas novamente na LEAP. Para usar LEAP10, confirma na plataforma o mesmo email da tua conta LEAP.</p>
      <p className="mt-2">Os treinos seguem a estrutura e o desbloqueio do programa existente. As modalidades não incluem acompanhamento individual adicional. Confirma o preço e as condições finais na plataforma antes de pagar.</p>
    </div>
  </div>;
}
