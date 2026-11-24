import Link from "next/link";
import { redirect } from "next/navigation";
import { Dumbbell, Utensils, ArrowUpRight, Check, CalendarDays } from "lucide-react";
import { getSessionUser } from "@/lib/supabase/server";
import { loadExtraCatalogue, PROJECT_PLATFORM_URL } from "@/lib/leap-extra";
import { eur } from "@/lib/utils";

export default async function LeapExtraPage() {
  if (!(await getSessionUser())) redirect("/login");
  const catalogue = await loadExtraCatalogue();
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
    <section className="space-y-3">
      <div><h2 className="text-base font-bold">Escolhe acesso com continuidade</h2><p className="mt-1 text-xs leading-relaxed text-ink-500">As modalidades de 6 meses e 1 ano incluem o percurso de 21 dias e a continuidade na plataforma, durante o período escolhido.</p></div>
      {catalogue?.offers.length ? <div className="grid gap-3 sm:grid-cols-2">{catalogue.offers.map(offer => <div key={offer.id} className={`card space-y-2 p-4 ${offer.id === "annual" ? "border-gold-400/50 bg-gold-400/5" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{offer.months === 12 ? "1 ano de acesso" : "6 meses de acesso"}</h3>{offer.id === "annual" && <span className="rounded-full bg-gold-400/15 px-2 py-1 text-[10px] font-bold text-gold-700 dark:text-gold-300">Melhor valor</span>}</div>
        <p className="font-display text-2xl font-bold">{eur(offer.amountCents)} <span className="font-sans text-xs font-normal text-ink-500">pagamento único</span></p>
        <p className="text-xs text-ink-500">Equivale a {eur(Math.round(offer.amountCents / offer.months))}/mês · sem renovação automática</p>
        {offer.name.includes(" · ") && <p className="text-xs font-medium text-gold-700 dark:text-gold-300">{offer.name.split(" · ").slice(1).join(" · ")}</p>}
        <p className="text-xs leading-relaxed text-ink-500">{offer.condition}</p>
      </div>)}</div> : <p className="card p-4 text-sm text-ink-500">Consulta as modalidades e os preços atuais na plataforma.</p>}
      {catalogue && !catalogue.open && <p className="text-xs text-ink-500">As novas inscrições não estão disponíveis neste momento. Consulta a plataforma para saber mais.</p>}
      <a href={PROJECT_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex min-h-11 w-full items-center justify-center gap-2">{catalogue?.open ? "Ver modalidades e aderir" : "Conhecer a plataforma"}<ArrowUpRight size={16} aria-hidden="true" /><span className="sr-only"> (abre noutra janela)</span></a>
      <a href={PROJECT_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-gold-700 dark:text-gold-300">Já tenho acesso · Entrar<ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only"> (abre noutra janela)</span></a>
    </section>
    <div className="rounded-xl bg-bone-100 p-4 text-xs leading-relaxed text-ink-500 dark:bg-white/5">
      <p className="flex items-center gap-2 font-semibold text-ink-900 dark:text-bone-50"><CalendarDays size={15} aria-hidden="true" />Como funciona nesta fase</p>
      <p className="mt-2">O acesso, a conta e o pagamento são tratados no Projeto 21 Dias. Se ainda não tens conta lá, precisas de te registar; o login da LEAP não entra automaticamente na outra plataforma. Não pagas novamente na LEAP.</p>
      <p className="mt-2">Os treinos seguem a estrutura e o desbloqueio do programa existente. As modalidades não incluem acompanhamento individual adicional. Confirma o preço e as condições finais na plataforma antes de pagar.</p>
    </div>
  </div>;
}
