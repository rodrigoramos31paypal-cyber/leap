import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { eur, formatDateTime } from "@/lib/utils";
import { CreditCard, Calendar, Users, TrendingUp, Activity, Package, ChevronLeft, ChevronRight } from "lucide-react";
import { getAccessibleTrainerIds, getClientCountInScope } from "@/lib/trainer";
import { KpiGridSkeleton, CardSkeleton } from "@/components/skeleton";
import { PushSubscribeCard } from "@/components/push-subscribe-card";

const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function parseMonth(param?: string): { year: number; month: number } {
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [y, m] = param.split("-").map(Number);
    return { year: y, month: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function monthParam(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

// ════════════════════════════════════════════════════════════════
// PERF: a pagina e agora um shell sincrono que renderiza header +
// month-switcher imediatamente. Os blocos de dados (KPIs e sessoes
// de hoje) sao streamed em <Suspense>, cada um com fallback proprio
// que cabe na mesma "shape" final - sem layout shift.
// ════════════════════════════════════════════════════════════════
export default function AdminDashboard({ searchParams }: { searchParams: { m?: string } }) {
  const { year, month } = parseMonth(searchParams.m);
  const prev = new Date(year, month - 1, 1);
  const next = new Date(year, month + 1, 1);
  const isCurrentMonth = (() => {
    const now = new Date();
    return now.getFullYear() === year && now.getMonth() === month;
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-ink-500">Vista geral do estúdio.</p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/admin/dashboard?m=${monthParam(prev.getFullYear(), prev.getMonth())}`}
            className="btn-outline px-2"
            aria-label="Mês anterior"
          >
            <ChevronLeft size={16} />
          </Link>
          <div className="px-3 text-sm font-semibold">
            {MONTHS[month]} {year} {isCurrentMonth && <span className="ml-1 text-xs text-ink-500">(actual)</span>}
          </div>
          <Link
            href={`/admin/dashboard?m=${monthParam(next.getFullYear(), next.getMonth())}`}
            className="btn-outline px-2"
            aria-label="Mês seguinte"
          >
            <ChevronRight size={16} />
          </Link>
          {!isCurrentMonth && (
            <Link href="/admin/dashboard" className="btn-outline ml-1">Hoje</Link>
          )}
        </div>
      </div>

      <PushSubscribeCard />

      <Suspense fallback={<KpisSkeleton />}>
        <Kpis year={year} month={month} />
      </Suspense>

      <Suspense fallback={<TodaySkeleton />}>
        <TodaySessions />
      </Suspense>
    </div>
  );
}

function KpisSkeleton() {
  return (
    <div className="space-y-3">
      <KpiGridSkeleton count={4} />
      <KpiGridSkeleton count={4} />
    </div>
  );
}

function TodaySkeleton() {
  return (
    <section>
      <CardSkeleton className="h-48" />
    </section>
  );
}

async function Kpis({ year, month }: { year: number; month: number }) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);

  const supabase = createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  const [
    { count: pendingPaymentsCount },
    { data: monthPurchases },
    { data: monthBookings },
    totalClientsInScope,
  ] = await Promise.all([
    supabase
      .from("purchases")
      .select("id", { count: "exact", head: true })
      .in("status", ["awaiting_confirmation", "pending_payment"])
      .in("trainer_id", trainerScope),
    supabase
      .from("purchases")
      .select("amount_cents, sessions_total, confirmed_at")
      .eq("status", "confirmed")
      .neq("payment_method", "complimentary")
      .in("trainer_id", trainerScope)
      .gte("confirmed_at", monthStart.toISOString())
      .lt("confirmed_at", monthEnd.toISOString()),
    supabase
      .from("bookings")
      .select("status, client_id")
      .in("trainer_id", trainerScope)
      .gte("starts_at", monthStart.toISOString())
      .lt("starts_at", monthEnd.toISOString()),
    getClientCountInScope(trainerIds),
  ]);

  const revenue = ((monthPurchases ?? []) as any[]).reduce((s: number, r: any) => s + r.amount_cents, 0);
  const packsSold = (monthPurchases ?? []).length;
  let sessionsBooked = 0, sessionsConfirmed = 0, sessionsCancelled = 0, sessionsNoShow = 0;
  const activeClientsSet = new Set<string>();
  for (const b of ((monthBookings ?? []) as any[])) {
    if (b.status === "booked" || b.status === "confirmed") {
      sessionsBooked++;
      activeClientsSet.add(b.client_id);
    }
    if (b.status === "confirmed") sessionsConfirmed++;
    else if (b.status === "cancelled") sessionsCancelled++;
    else if (b.status === "no_show") sessionsNoShow++;
  }
  const activeClients = activeClientsSet.size;
  const avgRevenuePerClient = activeClients > 0 ? Math.round(revenue / activeClients) : 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<TrendingUp size={16} />} label="Receita do mês" value={eur(revenue)} href="/admin/pagamentos?tab=confirmados" />
        <Stat icon={<Users size={16} />} label="Clientes ativos no mês" value={String(activeClients)} />
        <Stat icon={<Package size={16} />} label="Packs vendidos" value={String(packsSold)} />
        <Stat
          icon={<CreditCard size={16} />}
          label="Pagamentos pendentes"
          value={String(pendingPaymentsCount ?? 0)}
          accent={pendingPaymentsCount && pendingPaymentsCount > 0 ? "gold" : undefined}
          href="/admin/pagamentos"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Users size={16} />} label="Total de clientes" value={String(totalClientsInScope)} href="/admin/clientes?tab=todos" />
        <Stat icon={<Calendar size={16} />} label="Sessões marcadas no mês" value={String(sessionsBooked)} />
        <Stat icon={<TrendingUp size={16} />} label="Receita média por cliente activo" value={eur(avgRevenuePerClient)} />
        <Stat
          icon={<Activity size={16} />}
          label="Taxa de presenças"
          value={
            sessionsConfirmed + sessionsNoShow > 0
              ? `${Math.round((sessionsConfirmed / (sessionsConfirmed + sessionsNoShow)) * 100)}%`
              : "—"
          }
        />
      </div>
    </>
  );
}

async function TodaySessions() {
  const supabase = createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(24, 0, 0, 0);

  const { data: todayBookings } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, session_type, status, client_id, profiles:client_id(full_name)")
    .in("status", ["booked", "confirmed"])
    .in("trainer_id", trainerScope)
    .gte("starts_at", todayStart.toISOString())
    .lt("starts_at", todayEnd.toISOString())
    .order("starts_at");

  return (
    <section>
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Sessões de hoje</h2>
          <Link href="/admin/agenda" className="text-xs text-gold-600">Ver agenda</Link>
        </div>
        {(!todayBookings || todayBookings.length === 0) ? (
          <p className="text-sm text-ink-500">Sem sessões hoje.</p>
        ) : (
          <ul className="space-y-2">
            {todayBookings.slice(0, 6).map((b: any) => (
              <li key={b.id} className="flex items-center justify-between border-b border-ink-900/5 pb-2 last:border-0">
                <div>
                  <div className="text-sm font-medium">{b.profiles?.full_name ?? "—"}</div>
                  <div className="text-xs text-ink-500 capitalize">{b.session_type} · {formatDateTime(b.starts_at).split(" ")[1]}</div>
                </div>
                <span className="chip-ok">Confirmada</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({
  icon, label, value, accent, href,
}: {
  icon: React.ReactNode; label: string; value: string; accent?: "gold"; href?: string;
}) {
  // Mobile: 2 cards por linha → reduz padding, encolhe label e número
  // para caber confortavelmente em ecrãs 360-390px. Em sm+ volta ao
  // tamanho original (4 cards por linha em lg).
  const inner = (
    <div className={`card p-3 sm:p-4 ${accent === "gold" ? "border-gold-400 bg-gold-50" : ""}`}>
      <div className="flex items-start justify-between gap-2 text-ink-500">
        <span className="text-[10px] uppercase tracking-wide leading-tight sm:text-xs">{label}</span>
        {icon}
      </div>
      <div className="mt-1.5 font-display text-xl font-bold sm:mt-2 sm:text-2xl">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
