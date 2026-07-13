import { Suspense } from "react";
import Link from "next/link";
import {
  Euro,
  ShoppingBag,
  Users,
  CheckCircle2,
  XCircle,
  CalendarX,
  CalendarDays,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { eur, SESSION_TYPE } from "@/lib/utils";
import { ExportButton } from "./export-button";

// ════════════════════════════════════════════════════════════════
// Relatórios · Faturação
// Shell síncrono (header + selector de período) renderiza de imediato;
// os KPIs e as "Últimas vendas" (queries à BD) são streamed em <Suspense>.
// ════════════════════════════════════════════════════════════════

function parseRange(searchParams: { from?: string; to?: string }) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  // `to` é INCLUSIVO até ao fim do dia escolhido — sem isto, escolher
  // "28/06" cortava todas as vendas desse próprio dia (filtro <= meia-noite).
  const from = searchParams.from ? new Date(`${searchParams.from}T00:00:00`) : defaultFrom;
  const to = searchParams.to ? new Date(`${searchParams.to}T23:59:59.999`) : now;
  return { from, to };
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function prettyDate(d: Date) {
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function prettyDateTime(d: Date) {
  return d.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "–";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function paymentMethodLabel(m: string) {
  return (
    {
      manual_mbway: "MB Way",
      manual_cash: "Dinheiro",
      manual_transfer: "Transferência",
      manual_revolut: "Revolut",
      complimentary: "Cortesia",
      mbway: "MB Way",
      multibanco: "Multibanco",
      card: "Cartão",
    } as Record<string, string>
  )[String(m)] ?? String(m ?? "");
}

// Presets de período rápidos (links — sem JS no cliente).
function buildPresets(now: Date) {
  const y = now.getFullYear();
  const mo = now.getMonth();
  const thisMonthFrom = new Date(y, mo, 1);
  const prevMonthFrom = new Date(y, mo - 1, 1);
  const prevMonthTo = new Date(y, mo, 0); // dia 0 do mês actual = último dia do anterior
  const last30 = new Date(now);
  last30.setDate(last30.getDate() - 29);
  const yearFrom = new Date(y, 0, 1);
  return [
    { label: "Este mês", from: thisMonthFrom, to: now },
    { label: "Mês passado", from: prevMonthFrom, to: prevMonthTo },
    { label: "Últimos 30 dias", from: last30, to: now },
    { label: "Este ano", from: yearFrom, to: now },
  ];
}

export default async function RelatoriosPage(props: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const searchParams = await props.searchParams;
  const { from, to } = parseRange(searchParams);
  const now = new Date();
  const presets = buildPresets(now);
  const activeFrom = ymd(from);
  const activeTo = ymd(to);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-sm text-ink-500">Faturação</p>
        </div>
        <ExportButton
          href={`/api/relatorios/export?type=purchases&from=${from.toISOString()}&to=${to.toISOString()}`}
          filename={`leap-compras-${activeFrom}_${activeTo}.csv`}
          className="btn-outline inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
        >
          Exportar
        </ExportButton>
      </div>

      {/* Selector de período — colapsável (native <details>, zero JS) */}
      <details className="card group p-0">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold-500/15 text-gold-400">
            <CalendarDays size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-ink-500">Período selecionado</span>
            <span className="block truncate font-semibold tabular-nums">
              {prettyDate(from)} a {prettyDate(to)}
            </span>
          </span>
          <ChevronDown size={18} className="shrink-0 text-ink-500 transition-transform group-open:rotate-180" />
        </summary>

        <div className="space-y-3 border-t border-ink-900/10 p-4 dark:border-white/10">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const active = ymd(p.from) === activeFrom && ymd(p.to) === activeTo;
              return (
                <Link
                  key={p.label}
                  href={`/admin/relatorios?from=${ymd(p.from)}&to=${ymd(p.to)}`}
                  className={
                    active
                      ? "rounded-full bg-gold-500 px-3 py-1.5 text-xs font-semibold text-ink-900"
                      : "rounded-full border border-ink-900/15 px-3 py-1.5 text-xs font-medium hover:bg-ink-900/5 dark:border-white/15 dark:hover:bg-white/5"
                  }
                >
                  {p.label}
                </Link>
              );
            })}
          </div>

          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label className="label">De</label>
              <input name="from" type="date" defaultValue={activeFrom} className="input" />
            </div>
            <div>
              <label className="label">Até</label>
              <input name="to" type="date" defaultValue={activeTo} className="input" />
            </div>
            <button className="btn-primary">Aplicar</button>
          </form>
        </div>
      </details>

      <p className="-mt-1 text-xs text-ink-500">Relatório gerado em {prettyDateTime(now)}</p>

      <Suspense key={`${activeFrom}-${activeTo}`} fallback={<ReportSkeleton />}>
        <ReportBody from={from} to={to} />
      </Suspense>
    </div>
  );
}

async function ReportBody({ from, to }: { from: Date; to: Date }) {
  const supabase = await createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  const [{ data: purchases, count: salesCount }, { data: bookings }] = await Promise.all([
    supabase
      .from("purchases")
      .select(
        "id, client_id, created_at, amount_cents, payment_method, session_type, sessions_total, profiles:client_id(full_name)",
        { count: "exact" },
      )
      .in("trainer_id", trainerScope)
      .eq("status", "confirmed")
      .neq("payment_method", "complimentary")
      .gte("confirmed_at", from.toISOString())
      .lte("confirmed_at", to.toISOString())
      .order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("status")
      .in("trainer_id", trainerScope)
      .gte("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString()),
  ]);

  const rows = (purchases ?? []) as any[];
  const revenue = rows.reduce((s, p) => s + p.amount_cents, 0);
  const packsSold = salesCount ?? rows.length;
  const creditsBought = rows.reduce((s, p) => s + p.sessions_total, 0);
  const confirmed = ((bookings ?? []) as any[]).filter((b) => b.status === "confirmed").length;
  const noShows = ((bookings ?? []) as any[]).filter((b) => b.status === "no_show").length;
  const cancellations = ((bookings ?? []) as any[]).filter((b) => b.status === "cancelled").length;
  const recent = rows.slice(0, 5);

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi icon={<Euro size={18} />} tone="gold" label="Receita total" value={eur(revenue)} sub="Valor bruto faturado" />
        <Kpi icon={<ShoppingBag size={18} />} tone="gold" label="Packs vendidos" value={String(packsSold)} sub="Total de packs" />
        <Kpi icon={<Users size={18} />} tone="gold" label="Sessões compradas" value={String(creditsBought)} sub="Total de sessões" />
        <Kpi icon={<CheckCircle2 size={18} />} tone="green" label="Sessões confirmadas" value={String(confirmed)} sub="Sessões realizadas" />
        <Kpi icon={<XCircle size={18} />} tone="red" label="Faltas" value={String(noShows)} sub="Faltas registadas" />
        <Kpi icon={<CalendarX size={18} />} tone="orange" label="Cancelamentos" value={String(cancellations)} sub="Cancelamentos" />
      </div>

      {/* Últimas vendas */}
      <div className="card p-0">
        <div className="flex items-center justify-between border-b border-ink-900/10 p-4 dark:border-white/10">
          <h2 className="font-display text-base font-bold">Últimas vendas</h2>
          <Link href="/admin/pagamentos" className="inline-flex items-center gap-0.5 text-sm font-medium text-gold-500 hover:text-gold-400">
            Ver todas ({packsSold}) <ChevronRight size={16} />
          </Link>
        </div>

        {recent.length === 0 ? (
          <p className="p-4 text-sm text-ink-500">Sem vendas neste período.</p>
        ) : (
          <ul className="divide-y divide-ink-900/10 dark:divide-white/10">
            {recent.map((p) => {
              const name = p.profiles?.full_name ?? "Cliente";
              return (
                <li key={p.id}>
                  <Link
                    href={`/admin/pagamentos?client=${p.client_id}`}
                    className="flex items-center gap-3 p-4 hover:bg-ink-900/5 dark:hover:bg-white/5"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold-500/15 text-sm font-semibold text-gold-400">
                      {initials(name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        PT {SESSION_TYPE[p.session_type as keyof typeof SESSION_TYPE] ?? p.session_type} · {p.sessions_total}{" "}
                        {p.sessions_total === 1 ? "Sessão" : "Sessões"}
                      </span>
                      <span className="block text-xs text-ink-500">{prettyDateTime(new Date(p.created_at))}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums">{eur(p.amount_cents)}</span>
                      <span className="block text-xs text-ink-500">{paymentMethodLabel(p.payment_method)}</span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-ink-500" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  tone: "gold" | "green" | "red" | "orange";
  label: string;
  value: string;
  sub: string;
}) {
  const toneClass = {
    gold: "bg-gold-500/15 text-gold-400",
    green: "bg-green-500/15 text-green-500",
    red: "bg-red-500/15 text-red-500",
    orange: "bg-orange-500/15 text-orange-500",
  }[tone];

  return (
    <div className="card flex flex-col gap-2 p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-full ${toneClass}`}>{icon}</span>
      <span className="text-xs text-ink-500">{label}</span>
      <span className="font-display text-2xl font-bold leading-none tabular-nums">{value}</span>
      <span className="text-[11px] text-ink-500">{sub}</span>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card p-4">
            <div className="h-9 w-9 animate-pulse rounded-full bg-ink-900/10" />
            <div className="mt-3 h-3 w-20 animate-pulse rounded bg-ink-900/10" />
            <div className="mt-2 h-7 w-16 animate-pulse rounded bg-ink-900/10" />
          </div>
        ))}
      </div>
      <div className="card p-4">
        <div className="h-4 w-32 animate-pulse rounded bg-ink-900/10" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="mt-4 flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-full bg-ink-900/10" />
            <div className="flex-1">
              <div className="h-3 w-28 animate-pulse rounded bg-ink-900/10" />
              <div className="mt-2 h-3 w-20 animate-pulse rounded bg-ink-900/10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
