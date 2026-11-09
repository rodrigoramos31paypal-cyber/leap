import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import { StoreInterestList } from "@/components/store-interest-list";

export default async function ProductInterestsPage({ searchParams }: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const [profile, { pagina }] = await Promise.all([getCurrentProfile(), searchParams]);
  if (!profile || !["owner", "trainer"].includes(profile.role)) {
    return <p className="card p-4">Esta lista está disponível para a equipa de gestão.</p>;
  }
  const parsed = Number(pagina);
  const page = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100000 ? parsed : 1;
  return (
    <div className="space-y-4">
      <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold-700 dark:text-gold-300">
        <ArrowLeft size={16} /> Dashboard
      </Link>
      <header>
        <h1 className="font-display text-2xl font-bold">Produtos de interesse</h1>
        <p className="text-sm text-ink-500">Consulta quem declarou interesse em cada produto da loja.</p>
      </header>
      <StoreInterestList page={page} />
    </div>
  );
}
