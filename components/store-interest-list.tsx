import Link from "next/link";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/authz";
import { formatDateTime } from "@/lib/utils";

// A RLS limita os pedidos aos produtos dos trainers acessíveis ao staff.
export async function StoreInterestList() {
  const profile = await getCurrentProfile();
  if (!profile || !["trainer", "owner"].includes(profile.role)) return null;
  await requireStaff();
  const supabase = await createClient();
  const { data, error } = await (supabase as any).from("store_product_interests")
    .select("id, created_at, client_id, product:store_products(name), client:profiles(full_name)")
    .order("created_at", { ascending: false }).limit(100);
  const interests = (data ?? []) as { id: string; created_at: string; client_id: string; product: { name: string } | null; client: { full_name: string } | null }[];
  return <section className="card p-4">
    <h2 className="font-display text-lg font-bold">Interesses em suplementos</h2>
    <p className="mt-1 text-xs text-ink-500">Pedidos mais recentes dos clientes · até 100 registos</p>
    {error ? <p role="alert" className="mt-3 text-sm text-red-700">Não foi possível carregar os interesses. Atualiza a página para tentar novamente.</p> : interests.length === 0 ? <p className="mt-3 text-sm text-ink-500">Ainda não foram declarados interesses.</p> : <ul className="mt-3 divide-y divide-ink-900/10 dark:divide-white/10">
      {interests.map((interest) => <li key={interest.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div><p className="text-sm font-semibold">{interest.product?.name ?? "Produto"}</p><Link href={`/admin/clientes/${interest.client_id}`} className="text-sm text-gold-700 underline dark:text-gold-300">{interest.client?.full_name ?? "Ver cliente"}</Link></div>
        <time dateTime={interest.created_at} className="text-xs text-ink-500">{formatDateTime(interest.created_at)}</time>
      </li>)}
    </ul>}
  </section>;
}
