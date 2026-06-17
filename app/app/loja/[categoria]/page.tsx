import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { eur } from "@/lib/utils";
import { BackLink } from "@/components/back-link";

const CATS: Record<string, { title: string; sub: string }> = {
  ebooks: { title: "Ebooks", sub: "Guias e receitas" },
  roupa: { title: "Roupa", sub: "Merch & vestuário" },
  suplementos: { title: "Suplementos", sub: "Nutrição e performance" },
};

// SEC (S-04, audit jun/2026): defesa em profundidade contra
// javascript:/data: em link_url. O server action valida ANTES de gravar
// (safeHttpUrl), mas dados antigos podem existir e React nao bloqueia
// esquemas perigosos em <a href>. So renderizamos <a> quando a string
// comeca por http(s):.
function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export default async function LojaCategoriaPage(props: { params: Promise<{ categoria: string }> }) {
  const params = await props.params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const meta = CATS[params.categoria];
  if (!meta) notFound();

  const supabase = await createClient();
  const { data: products } = await (supabase as any)
    .from("store_products")
    .select("id, name, description, price_cents, image_url, link_url")
    .eq("category", params.categoria)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const list = (products ?? []) as any[];

  return (
    <div className="space-y-4">
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{meta.title}</h1>
        <p className="text-sm text-ink-500">{meta.sub}</p>
      </div>

      {list.length === 0 ? (
        <div className="card flex flex-col items-center gap-1 p-10 text-center text-sm text-ink-500">
          <span className="text-base font-semibold text-ink-700">Em breve</span>
          Ainda não há produtos nesta secção.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((p) => {
            const href = safeHref(p.link_url);
            const card = (
              <div className="card flex h-full flex-col overflow-hidden transition hover:border-gold-400">
                {p.image_url ? (
                  <div className="relative aspect-[4/3] w-full">
                    <Image
                      src={p.image_url}
                      alt={p.name}
                      fill
                      sizes="(min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="aspect-[4/3] w-full bg-bone-100 dark:bg-white/5" />
                )}
                <div className="flex flex-1 flex-col p-3">
                  <div className="font-display text-sm font-bold">{p.name}</div>
                  {p.description && (
                    <div className="mt-0.5 line-clamp-2 text-xs text-ink-500">{p.description}</div>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-display text-sm font-bold text-gold-600">
                      {typeof p.price_cents === "number" ? eur(p.price_cents) : ""}
                    </span>
                    {href && <span className="text-xs font-medium text-gold-600">Ver →</span>}
                  </div>
                </div>
              </div>
            );
            return (
              <li key={p.id}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
                    {card}
                  </a>
                ) : (
                  card
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
