import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { eur } from "@/lib/utils";
import Link from "next/link";

function parseRange(searchParams: { from?: string; to?: string }) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = searchParams.from ? new Date(searchParams.from) : defaultFrom;
  const to = searchParams.to ? new Date(searchParams.to) : now;
  return { from, to };
}

// ════════════════════════════════════════════════════════════════
// PERF: a página é agora um shell síncrono — header, filtro de datas
// e links de export renderizam imediatamente. As KPIs (que fazem 2
// queries pesadas sobre purchases/bookings) são streamed em <Suspense>.
// Antes, o TTFB da rota inteira esperava por ambas as queries.
// ════════════════════════════════════════════════════════════════
export default function RelatoriosPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const { from, to } = parseRange(searchParams);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
        <p className="text-sm text-ink-500">Vista geral por período.</p>
      </div>

      <form className="card grid gap-3 p-5 sm:grid-cols-4">
        <div className="sm:col-span-1">
          <label className="label">De</label>
          <input name="from" type="date" defaultValue={from.toISOString().slice(0, 10)} className="input" />
        </div>
        <div className="sm:col-span-1">
          <label className="label">Até</label>
          <input name="to" type="date" defaultValue={to.toISOString().slice(0, 10)} className="input" />
        </div>
        <div className="flex items-end sm:col-span-2">
          <button className="btn-primary w-full sm:w-auto">Filtrar</button>
        </div>
      </form>

      <Suspense key={`${from.toISOString()}-${to.toISOString()}`} fallback={<StatsSkeleton />}>
        <ReportStats from={from} to={to} />
      </Suspense>

      <div className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Exportar</h2>
        <p className="mt-2 text-sm text-ink-500">CSV pronto para Excel/Google Sheets.</p>
        <div className="mt-4 flex gap-2">
          <Link
            href={`/api/relatorios/export?type=purchases&from=${from.toISOString()}&to=${to.toISOString()}`}
            className="btn-primary"
          >
            Compras (.csv)
          </Link>
          <Link
            href={`/api/relatorios/export?type=bookings&from=${from.toISOString()}&to=${to.toISOString()}`}
            className="btn-outline"
          >
            Sessões (.csv)
          </Link>
        </div>
      </div>
    </div>
  );
}

async function ReportStats({ from, to }: { from: Date; to: Date }) {
  const supabase = createClient();
  // PERF: pedimos só as colunas consumidas pelos reduces/filtros (antes `*`).
  // purchases → amount_cents + sessions_total; bookings → status. As colunas
  // de filtro (confirmed_at/starts_at/status) não precisam de vir no payload.
  const [{ data: purchases }, { data: bookings }] = await Promise.all([
    supabase
      .from("purchases")
      .select("amount_cents, sessions_total")
      .eq("status", "confirmed")
      .gte("confirmed_at", from.toISOString())
      .lte("confirmed_at", to.toISOString()),
    supabase
      .from("bookings")
      .select("status")
      .gte("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString()),
  ]);

  const revenue = ((purchases ?? []) as any[]).reduce((s, p) => s + p.amount_cents, 0);
  const packsSold = purchases?.length ?? 0;
  const creditsBought = ((purchases ?? []) as any[]).reduce((s, p) => s + p.sessions_total, 0);
  const confirmed = ((bookings ?? []) as any[]).filter((b) => b.status === "confirmed").length;
  const noShows = ((bookings ?? []) as any[]).filter((b) => b.status === "no_show").length;
  const cancellations = ((bookings ?? []) as any[]).filter((b) => b.status === "cancelled").length;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Stat label="Receita" value={eur(revenue)} />
      <Stat label="Packs vendidos" value={String(packsSold)} />
      <Stat label="Sessões compradas" value={String(creditsBought)} />
      <Stat label="Sessões confirmadas" value={String(confirmed)} />
      <Stat label="Faltas" value={String(noShows)} />
      <Stat label="Cancelamentos" value={String(cancellations)} />
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="card p-4">
          <div className="h-3 w-20 animate-pulse rounded bg-ink-900/10" />
          <div className="mt-3 h-7 w-16 animate-pulse rounded bg-ink-900/10" />
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </div>
  );
}
