import { Suspense } from "react";
import Link from "next/link";
import {
  ShoppingBag,
  CheckCircle2,
  CalendarX,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Ticket,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { eur, SESSION_TYPE } from "@/lib/utils";
import { ExportButton } from "./export-button";

// ════════════════════════════════════════════════════════════════
// Relatórios · Faturação — DESIGN PREMIUM (alinhado com o fitnessv2).
// Shell síncrono (header + selector de período) renderiza de imediato;
// os KPIs e as "Últimas vendas" (queries à BD) são streamed em <Suspense>.
// Hero de receita com sparkline + tendência, tabs de período segmentadas,
// tiles e lista agrupada.
// ════════════════════════════════════════════════════════════════

const GOLD = "#CFB325";

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

// Presets de período rápidos (links — sem JS no cliente). `short` é o rótulo
// compacto usado nas tabs segmentadas do design premium.
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
    { label: "Este mês", short: "Este mês", from: thisMonthFrom, to: now },
    { label: "Mês passado", short: "Mês passado", from: prevMonthFrom, to: prevMonthTo },
    { label: "Últimos 30 dias", short: "30 dias", from: last30, to: now },
    { label: "Este ano", short: "Ano", from: yearFrom, to: now },
  ];
}

// ── Sparkline: receita ACUMULADA por dia dentro do intervalo ─────────
// Devolve os paths SVG (linha + área) sobre um viewBox 340×64.
function buildSparkline(rows: any[], from: Date, to: Date) {
  const dayMs = 86400000;
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  const nDays = Math.max(2, Math.min(120, Math.round((end.getTime() - start.getTime()) / dayMs) + 1));
  const perDay = new Array(nDays).fill(0);
  for (const p of rows) {
    const raw = p.confirmed_at ?? p.created_at;
    if (!raw) continue;
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    const idx = Math.round((d.getTime() - start.getTime()) / dayMs);
    if (idx >= 0 && idx < nDays) perDay[idx] += Number(p.amount_cents) || 0;
  }
  const cum: number[] = [];
  let acc = 0;
  for (const v of perDay) {
    acc += v;
    cum.push(acc);
  }
  const w = 340;
  const h = 64;
  const pad = 5;
  const max = Math.max(1, ...cum);
  const pts = cum.map((v, i) => {
    const x = nDays === 1 ? w : (i / (nDays - 1)) * w;
    const y = h - pad - (v / max) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  return { line, area, lastX: last[0], lastY: last[1], hasData: acc > 0 };
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

  const exportHref = `/api/relatorios/export?type=purchases&from=${from.toISOString()}&to=${to.toISOString()}`;
  const exportName = `leap-compras-${activeFrom}_${activeTo}.csv`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Relatórios</h1>
          <p className="text-sm text-ink-500">
            Faturação · {prettyDate(from)} – {prettyDate(to)}
          </p>
        </div>
        <ExportButton
          href={exportHref}
          filename={exportName}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-ink-900/10 bg-white px-3.5 py-2 text-[12.5px] font-medium text-ink-600 shadow-[0_1px_2px_rgba(10,10,10,0.04)] transition hover:border-gold-300 hover:text-ink-900 disabled:opacity-50 dark:border-white/10 dark:bg-ink-800 dark:text-bone-100"
        >
          Exportar
        </ExportButton>
      </div>

      {/* Tabs de período segmentadas */}
      <div className="flex gap-1 rounded-xl border border-ink-900/[0.07] bg-bone-100 p-1 dark:border-white/10 dark:bg-ink-900">
        {presets.map((p) => {
          const active = ymd(p.from) === activeFrom && ymd(p.to) === activeTo;
          return (
            <Link
              key={p.label}
              href={`/admin/relatorios?from=${ymd(p.from)}&to=${ymd(p.to)}`}
              className={
                active
                  ? "flex-1 rounded-lg bg-white px-2 py-1.5 text-center text-[11.5px] font-semibold text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50"
                  : "flex-1 rounded-lg px-2 py-1.5 text-center text-[11.5px] font-medium text-ink-500 transition hover:text-ink-900 dark:hover:text-bone-50"
              }
            >
              {p.short}
            </Link>
          );
        })}
      </div>

      {/* Datas personalizadas — colapsável */}
      <details className="card group p-0">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold-500/15 text-gold-400">
            <CalendarDays size={16} />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium text-ink-700 dark:text-bone-100">
            Datas personalizadas
          </span>
          <ChevronDown size={18} className="shrink-0 text-ink-500 transition-transform group-open:rotate-180" />
        </summary>
        <form className="grid gap-3 border-t border-ink-900/10 p-3.5 sm:grid-cols-[1fr_1fr_auto] sm:items-end dark:border-white/10">
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
      </details>

      <Suspense key={`${activeFrom}-${activeTo}`} fallback={<PremiumSkeleton />}>
        <ReportBody from={from} to={to} />
      </Suspense>
    </div>
  );
}

async function ReportBody({ from, to }: { from: Date; to: Date }) {
  const supabase = await createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  // Período homólogo anterior (mesma duração, imediatamente antes) — para a
  // tendência do hero.
  const periodMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - periodMs - 1);

  const [purchRes, bookingsRes, prevRes] = await Promise.all([
    supabase
      .from("purchases")
      .select(
        "id, client_id, created_at, confirmed_at, amount_cents, payment_method, session_type, sessions_total, profiles:client_id(full_name)",
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
    supabase
      .from("purchases")
      .select("amount_cents")
      .in("trainer_id", trainerScope)
      .eq("status", "confirmed")
      .neq("payment_method", "complimentary")
      .gte("confirmed_at", prevFrom.toISOString())
      .lte("confirmed_at", prevTo.toISOString()),
  ]);

  const { data: purchases, count: salesCount } = purchRes;
  const { data: bookings } = bookingsRes;

  const rows = (purchases ?? []) as any[];
  const revenue = rows.reduce((s, p) => s + p.amount_cents, 0);
  const packsSold = salesCount ?? rows.length;
  const creditsBought = rows.reduce((s, p) => s + p.sessions_total, 0);
  const confirmed = ((bookings ?? []) as any[]).filter((b) => b.status === "confirmed").length;
  const noShows = ((bookings ?? []) as any[]).filter((b) => b.status === "no_show").length;
  const cancellations = ((bookings ?? []) as any[]).filter((b) => b.status === "cancelled").length;
  const recent = rows.slice(0, 5);

  const prevRevenue = ((prevRes.data ?? []) as any[]).reduce((s, p) => s + (Number(p.amount_cents) || 0), 0);
  const trend = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null;
  const spark = buildSparkline(rows, from, to);

  return (
    <div className="space-y-4">
      {/* Hero de receita */}
      <div className="overflow-hidden rounded-2xl bg-ink-900 p-5 pb-0 text-bone-50">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gold-400">Receita total</div>
        <div className="flex items-end justify-between gap-2">
          <div className="font-display text-[2.35rem] font-bold leading-none tracking-tight tabular-nums">
            {eur(revenue)}
          </div>
          {trend !== null && (
            <span
              className={`mb-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
                trend >= 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
              }`}
            >
              <TrendingUp size={12} className={trend < 0 ? "rotate-180" : ""} />
              {trend >= 0 ? "+" : ""}
              {trend}%
            </span>
          )}
        </div>
        <div className="mt-1 text-[11.5px] text-bone-50/50">
          {trend !== null ? "vs período anterior · " : ""}valor bruto faturado
        </div>
        <svg
          viewBox="0 0 340 64"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="mt-3 -mx-5 block h-14 w-[calc(100%+2.5rem)]"
        >
          <defs>
            <linearGradient id="rev-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity="0.28" />
              <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
            </linearGradient>
          </defs>
          {spark.hasData && <path d={spark.area} fill="url(#rev-spark)" />}
          <path
            d={spark.line}
            fill="none"
            stroke={GOLD}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={spark.hasData ? 1 : 0.35}
          />
          {spark.hasData && <circle cx={spark.lastX} cy={spark.lastY} r="3.5" fill={GOLD} />}
        </svg>
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-2 gap-3">
        <PremTile icon={<ShoppingBag size={15} />} color="text-gold-600 dark:text-gold-400" label="Packs vendidos" value={String(packsSold)} />
        <PremTile icon={<Ticket size={15} />} color="text-gold-600 dark:text-gold-400" label="Sessões compradas" value={String(creditsBought)} />
        <PremTile icon={<CheckCircle2 size={15} />} color="text-emerald-600 dark:text-emerald-400" label="Confirmadas" value={String(confirmed)} />
        <PremTile
          icon={<CalendarX size={15} />}
          color="text-red-600 dark:text-red-400"
          label="Faltas · Cancel."
          value={
            <>
              {noShows} <span className="font-normal text-ink-300 dark:text-white/30">·</span>{" "}
              <span className="text-amber-700 dark:text-amber-500">{cancellations}</span>
            </>
          }
        />
      </div>

      {/* Últimas vendas */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-base font-bold">Últimas vendas</h2>
          <Link href="/admin/pagamentos" className="inline-flex items-center gap-0.5 text-xs font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400">
            Ver todas ({packsSold}) <ChevronRight size={14} />
          </Link>
        </div>

        {recent.length === 0 ? (
          <div className="card p-5 text-center text-sm text-ink-500">Sem vendas neste período.</div>
        ) : (
          <div className="card overflow-hidden p-0">
            <ul className="divide-y divide-ink-900/[0.06] dark:divide-white/[0.07]">
              {recent.map((p) => {
                const name = p.profiles?.full_name ?? "Cliente";
                return (
                  <li key={p.id}>
                    <Link
                      href={`/admin/pagamentos?client=${p.client_id}`}
                      className="flex items-center gap-3 px-4 py-3 transition hover:bg-ink-900/[0.02] dark:hover:bg-white/[0.03]"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-gold-400 dark:bg-white/10">
                        {initials(name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink-900 dark:text-bone-50">{name}</span>
                        <span className="block truncate text-[11.5px] text-ink-500">
                          PT {SESSION_TYPE[p.session_type as keyof typeof SESSION_TYPE] ?? p.session_type} · {p.sessions_total}{" "}
                          {p.sessions_total === 1 ? "sessão" : "sessões"} · {paymentMethodLabel(p.payment_method)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13.5px] font-semibold tabular-nums text-ink-900 dark:text-bone-50">{eur(p.amount_cents)}</span>
                        <span className="block text-[10.5px] text-ink-500">
                          {new Date(p.created_at).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" })}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function PremTile({
  icon,
  color,
  label,
  value,
}: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-1.5 p-3.5">
      <div className={`flex items-center gap-1.5 ${color}`}>
        {icon}
        <span className="text-[11.5px] text-ink-500">{label}</span>
      </div>
      <div className="font-display text-[1.6rem] font-bold leading-none tabular-nums text-ink-900 dark:text-bone-50">
        {value}
      </div>
    </div>
  );
}

function PremiumSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-32 animate-pulse rounded-2xl bg-ink-900/10" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card p-3.5">
            <div className="h-3 w-24 animate-pulse rounded bg-ink-900/10" />
            <div className="mt-3 h-6 w-14 animate-pulse rounded bg-ink-900/10" />
          </div>
        ))}
      </div>
      <div className="card p-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="mt-4 flex items-center gap-3 first:mt-0">
            <div className="h-9 w-9 animate-pulse rounded-full bg-ink-900/10" />
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
