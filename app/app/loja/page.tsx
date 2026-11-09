import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { Package, BookOpen, Shirt, Pill, ArrowUpRight, ChevronRight } from "lucide-react";

export default async function LojaPage() {
  if (!(await getSessionUser())) redirect("/login");
  const supabase = await createClient();
  const { count } = await (supabase as any).from("store_products")
    .select("id", { count: "exact", head: true }).eq("category", "roupa").eq("active", true);
  const categories = [
    { title: "Packs", detail: "Escolhe as tuas sessões", href: "/app/comprar", icon: Package },
    { title: "Suplementos", detail: "Proteína, creatina e mais", href: "/app/loja/suplementos", icon: Pill },
    { title: "E-books", detail: "João Pedro Mendes", href: "https://joaopedromendes.com", icon: BookOpen, external: true },
  ];
  if ((count ?? 0) > 0) categories.push({ title: "Roupa LEAP", detail: "Vestuário do estúdio", href: "/app/loja/roupa", icon: Shirt });

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-gold-700 dark:text-gold-300">Mais para o teu treino</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Loja LEAP</h1>
      </header>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map(({ title, detail, href, icon: Icon, external }) => (
          <li key={href}>
            <Link href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}
              className="card flex h-full min-h-32 flex-col gap-2 p-3 transition hover:border-gold-400 sm:p-4">
              <span className="flex items-center justify-between text-gold-700 dark:text-gold-300">
                <Icon size={22} aria-hidden="true" />
                {external ? <ArrowUpRight size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              </span>
              <h2 className="font-display text-base font-bold">{title}</h2>
              <p className="text-xs text-ink-500">{detail}{external && <span className="sr-only"> (nova janela)</span>}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
