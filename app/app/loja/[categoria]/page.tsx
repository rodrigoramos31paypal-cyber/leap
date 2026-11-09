import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { eur } from "@/lib/utils";
import { BackLink } from "@/components/back-link";
import { ProductInterestButton } from "@/components/product-interest-button";
import { ArrowUpRight, Package } from "lucide-react";

const CATS: Record<string, { title: string; sub: string }> = {
  ebooks: { title: "E-books", sub: "Conteúdos de João Pedro Mendes" },
  roupa: { title: "Roupa", sub: "Vestuário LEAP" },
  suplementos: { title: "Suplementos", sub: "Explora os produtos e declara o teu interesse junto da LEAP." },
};

type Product = { id: string; name: string; description: string | null; price_cents: number | null; image_url: string | null; link_url: string | null };
function safeHref(url: string | null): string | undefined {
  if (!url) return undefined;
  try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : undefined; }
  catch { return undefined; }
}

export default async function LojaCategoriaPage(props: { params: Promise<{ categoria: string }> }) {
  const { categoria } = await props.params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const meta = CATS[categoria];
  if (!meta) notFound();
  // Os links antigos para e-books continuam a funcionar.
  if (categoria === "ebooks") redirect("https://joaopedromendes.com");

  const supplements = categoria === "suplementos";
  const supabase = await createClient();
  const [productsResult, interestsResult] = await Promise.all([
    (supabase as any).from("store_products")
      .select("id, name, description, price_cents, image_url, link_url")
      .eq("category", categoria).eq("active", true)
      .order("sort_order", { ascending: true }).order("created_at", { ascending: false }),
    supplements ? (supabase as any).from("store_product_interests").select("product_id").eq("client_id", user.id) : Promise.resolve({ data: [], error: null }),
  ]);
  const list = (productsResult.data ?? []) as Product[];
  const interested = new Set<string>((interestsResult.data ?? []).map((i: { product_id: string }) => i.product_id));

  return (
    <div className="space-y-4">
      <BackLink />
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">{meta.title}</h1>
        <p className="mt-1 text-sm text-ink-500">{meta.sub}</p>
      </header>
      {supplements && <div className="rounded-2xl bg-bone-100 p-4 dark:bg-white/5">
        <p className="text-sm font-semibold">Gostavas de saber mais sobre um produto?</p>
        <p className="mt-1 text-xs text-ink-500">Consulta o preço no site da Prozis. Se quiseres saber que condições se aplicam através da LEAP, declara interesse e confirma com a equipa antes de comprar. A declaração não cria uma encomenda nem implica pagamento.</p>
        <a href="https://www.prozis.com/pt/pt" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-gold-700 dark:text-gold-300">Explorar o site da Prozis <ArrowUpRight size={16} /><span className="sr-only"> (nova janela)</span></a>
      </div>}
      {interestsResult.error && <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">Não conseguimos carregar os teus interesses anteriores. Podes tentar novamente; os pedidos não serão duplicados.</p>}
      {productsResult.error ? <div role="alert" className="card p-5 text-sm">Não foi possível carregar os produtos. <Link href={`/app/loja/${categoria}`} className="font-semibold underline">Tentar novamente</Link></div> : list.length === 0 ? (
        <div className="card space-y-3 p-6 text-sm text-ink-500"><p>Ainda não há produtos disponíveis nesta secção.</p><Link href="/app/loja" className="inline-block font-semibold text-gold-700 dark:text-gold-300">Voltar à loja →</Link></div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.map((product) => {
            const href = safeHref(product.link_url);
            const prozis = href && new URL(href).hostname.replace(/^www\./, "") === "prozis.com";
            return <li key={product.id} className="card flex flex-col overflow-hidden">
              <div className="relative flex aspect-[3/2] items-center justify-center bg-white">
                {product.image_url ? <Image src={product.image_url} alt={product.name} fill sizes="(min-width: 640px) 50vw, 100vw" className="object-contain p-4" /> : <Package size={40} className="text-ink-300" aria-hidden="true" />}
              </div>
              <div className="flex flex-1 flex-col p-4">
                {prozis && <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-ink-500">Prozis</p>}
                <h2 className="font-display text-lg font-bold">{product.name}</h2>
                {product.description && <p className="mt-1 text-sm text-ink-500">{product.description}</p>}
                <div className="mt-auto pt-3">
                  {typeof product.price_cents === "number" && <p className="font-display font-bold text-gold-700 dark:text-gold-300">{eur(product.price_cents)}</p>}
                  {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-gold-700 dark:text-gold-300">{prozis ? "Ver detalhes na Prozis" : "Ver detalhes"} <ArrowUpRight size={15} /><span className="sr-only"> (nova janela)</span></a>}
                  {supplements && <ProductInterestButton productId={product.id} productName={product.name} interested={interested.has(product.id)} />}
                </div>
              </div>
            </li>;
          })}
        </ul>
      )}
    </div>
  );
}
