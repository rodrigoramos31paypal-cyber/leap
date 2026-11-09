import Link from "next/link";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/authz";
import { formatDateTime } from "@/lib/utils";

type Interest = {
  id: string;
  created_at: string;
  client_id: string;
  product: { name: string } | null;
  client: { full_name: string } | null;
};

const PAGE_SIZE = 30;
const LIST_PATH = "/admin/produtos-de-interesse";

// A RLS limita os pedidos aos produtos dos treinadores acessíveis ao staff.
export async function StoreInterestList({ page }: { page?: number } = {}) {
  const profile = await getCurrentProfile();
  if (!profile || !["trainer", "owner"].includes(profile.role)) return null;
  await requireStaff();
  const supabase = await createClient();
  const query = (supabase as any).from("store_product_interests")
    .select("id, created_at, client_id, product:store_products(name), client:profiles(full_name)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const offset = ((page ?? 1) - 1) * PAGE_SIZE;
  const { data, error } = await (page ? query.range(offset, offset + PAGE_SIZE) : query.limit(100));
  const interests = (data ?? []) as Interest[];
  const visible = page ? interests.slice(0, PAGE_SIZE) : interests;

  return (
    <section className="card p-4">
      {!page && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Interesses em suplementos</h2>
          <Link href={LIST_PATH} className="text-sm font-semibold text-gold-700 dark:text-gold-300">Ver todos →</Link>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">Não foi possível carregar os interesses. Atualiza a página.</p>
      ) : visible.length === 0 ? (
        <p className="mt-3 text-sm text-ink-500">{page && page > 1 ? "Sem registos nesta página." : "Ainda não foram declarados interesses."}</p>
      ) : (
        <ul className="divide-y divide-ink-900/10 dark:divide-white/10">
          {visible.map(interest => (
            <li key={interest.id} className="grid items-baseline gap-1 py-3 sm:grid-cols-[1fr_1.5fr_auto] sm:gap-4">
              <Link href={`/admin/clientes/${interest.client_id}`} className="break-words text-sm font-semibold text-gold-700 underline dark:text-gold-300">
                {interest.client?.full_name ?? "Ver cliente"}
              </Link>
              <p className="break-words text-sm">{interest.product?.name ?? "Produto"}</p>
              <time dateTime={interest.created_at} className="text-xs text-ink-500">{formatDateTime(interest.created_at)}</time>
            </li>
          ))}
        </ul>
      )}
      {page && (page > 1 || interests.length > PAGE_SIZE) ? (
        <nav aria-label="Páginas de produtos de interesse" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          {page > 1 && <Link href={`${LIST_PATH}?pagina=${page - 1}`} className="btn-outline">← Anterior</Link>}
          <span className="text-ink-500">Página {page}</span>
          {!error && interests.length > PAGE_SIZE && <Link href={`${LIST_PATH}?pagina=${page + 1}`} className="btn-outline">Seguinte →</Link>}
        </nav>
      ) : null}
    </section>
  );
}
