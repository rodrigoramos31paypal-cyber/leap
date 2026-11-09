import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { Package, BookOpen, Shirt, Pill, ArrowUpRight, ChevronRight } from "lucide-react";

export default async function LojaPage() {
  if (!(await getSessionUser())) redirect("/login");
  const supabase = await createClient();
  const { count } = await (supabase as any).from("store_products")
    .select("id", { count: "exact", head: true }).eq("category", "roupa").eq("active", true);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-gold-700 dark:text-gold-300">Mais para o teu treino</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Loja LEAP</h1>
        <p className="mt-1 text-sm text-ink-500">O próximo passo começa aqui.</p>
      </header>
      <Link href="/app/comprar" className="flex items-center gap-4 rounded-2xl bg-ink-900 p-5 text-bone-50 dark:bg-white/10">
        <Package size={28} className="shrink-0 text-gold-400" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="font-display text-xl font-bold">O teu próximo pack</h2>
          <p className="mt-1 text-sm text-bone-200">Mantém o ritmo. Escolhe as tuas sessões.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-gold-400">Ver packs <ChevronRight size={16} /></span>
        </div>
      </Link>
      <Link href="/app/loja/suplementos" className="card flex items-start gap-4 p-5 transition hover:border-gold-400">
        <span className="rounded-xl bg-amber-100 p-3 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"><Pill size={24} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold">Suplementos</h2>
          <p className="mt-1 text-sm text-ink-500">Explora proteína, creatina e outros produtos. Diz-nos o que te interessa.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-gold-700 dark:text-gold-300">Explorar produtos <ChevronRight size={16} /></span>
        </div>
      </Link>
      <a href="https://joaopedromendes.com" target="_blank" rel="noopener noreferrer" className="card flex items-start gap-4 p-5 transition hover:border-gold-400">
        <span className="rounded-xl bg-emerald-100 p-3 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"><BookOpen size={24} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold">E-books de João Pedro Mendes</h2>
          <p className="mt-1 text-sm text-ink-500">Descobre os e-books e conteúdos no meu site.</p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-gold-700 dark:text-gold-300">Ver e-books <ArrowUpRight size={16} /></span>
          <span className="mt-1 block text-xs text-ink-500">Abre numa nova janela</span>
        </div>
      </a>
      {(count ?? 0) > 0 && <Link href="/app/loja/roupa" className="card flex items-center gap-3 p-4 hover:border-gold-400"><Shirt size={22} aria-hidden="true" /><span className="flex-1 font-semibold">Roupa LEAP</span><ChevronRight size={18} /></Link>}
    </div>
  );
}
