import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import {
  ACTIVITY_TYPE_LABEL,
  ACTIVITY_TYPE_ICON,
  ACTIVITY_STATUS_LABEL,
  ACTIVITY_STATUS_CHIP,
  type ActivityType,
  type ActivityStatus,
} from "@/lib/activities";
import { Dumbbell } from "lucide-react";

export const metadata = { title: "As tuas atividades · LEAP", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Filter = "mes" | "todas" | "pendentes";

const YM_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit" });
const DAY_FMT = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit" });
const MON_FMT = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", month: "short" });

type Item =
  | { kind: "session"; id: string; ts: number; sessionType: string; status: string }
  | { kind: "activity"; id: string; ts: number; actType: ActivityType; actStatus: ActivityStatus };

function sessionState(status: string, ts: number): { label: string; bg: string; text: string } {
  const past = ts < Date.now();
  if (status === "no_show") return { label: "Falta", bg: "bg-red-100 dark:bg-red-400/15", text: "text-red-800 dark:text-red-300" };
  if (status === "cancelled") return { label: "Cancelada", bg: "bg-ink-900/[0.06] dark:bg-white/10", text: "text-ink-500 dark:text-bone-100/70" };
  if (past) return { label: "Realizada", bg: "bg-emerald-100 dark:bg-emerald-400/15", text: "text-emerald-800 dark:text-emerald-300" };
  return { label: "Agendada", bg: "bg-gold-100 dark:bg-gold-400/15", text: "text-gold-700 dark:text-gold-300" };
}

function TabChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-ink-900 bg-ink-900 text-white dark:border-bone-50 dark:bg-bone-50 dark:text-ink-900"
          : "border-ink-900/15 text-ink-600 hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-100"
      }`}
    >
      {label}
    </Link>
  );
}

export default async function AtividadesPage(props: { searchParams: Promise<{ f?: string }> }) {
  const sp = await props.searchParams;
  const filter: Filter = sp.f === "todas" ? "todas" : sp.f === "pendentes" ? "pendentes" : "mes";
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const [{ data: bookings }, { data: acts }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, session_type, status")
      .or(`client_id.eq.${user.id},partner_client_id.eq.${user.id}`)
      .order("starts_at", { ascending: false })
      .limit(80),
    (supabase as any)
      .from("activities")
      .select("id, type, activity_date, status")
      .eq("client_id", user.id)
      .order("activity_date", { ascending: false })
      .limit(80),
  ]);

  const items: Item[] = [];
  for (const b of (bookings ?? []) as any[]) {
    items.push({ kind: "session", id: b.id, ts: new Date(b.starts_at).getTime(), sessionType: b.session_type, status: b.status });
  }
  for (const a of (acts ?? []) as any[]) {
    items.push({ kind: "activity", id: a.id, ts: new Date(a.activity_date + "T12:00:00").getTime(), actType: a.type, actStatus: a.status });
  }

  const currentYM = YM_FMT.format(new Date());
  let filtered = items;
  if (filter === "mes") {
    filtered = items.filter((it) => YM_FMT.format(new Date(it.ts)) === currentYM);
  } else if (filter === "pendentes") {
    filtered = items.filter((it) => it.kind === "activity" && it.actStatus === "pending");
  }
  filtered.sort((a, b) => b.ts - a.ts);
  filtered = filtered.slice(0, 80);

  const href = (f: Filter) => `/app/atividades${f !== "mes" ? `?f=${f}` : ""}`;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/app/progresso" className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400">
          <ArrowLeft size={14} /> Voltar
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">As tuas atividades</h1>
        <p className="text-sm text-ink-500">Sessões e atividades extra, num só sítio.</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <TabChip label="Mês atual" href={href("mes")} active={filter === "mes"} />
        <TabChip label="Todas" href={href("todas")} active={filter === "todas"} />
        <TabChip label="Pendentes" href={href("pendentes")} active={filter === "pendentes"} />
      </div>

      {filtered.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">
          {filter === "pendentes" ? "Sem atividades pendentes." : "Sem atividades para mostrar."}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((it) => {
            const Icon = it.kind === "activity" ? ACTIVITY_TYPE_ICON[it.actType] : Dumbbell;
            const title = it.kind === "activity" ? ACTIVITY_TYPE_LABEL[it.actType] : "Sessão PT";
            const sub = it.kind === "session" ? it.sessionType : "Atividade extra";
            const chip =
              it.kind === "activity"
                ? { label: ACTIVITY_STATUS_LABEL[it.actStatus], ...ACTIVITY_STATUS_CHIP[it.actStatus] }
                : sessionState(it.status, it.ts);
            const d = new Date(it.ts);
            return (
              <li key={`${it.kind}-${it.id}`} className="card flex items-center gap-3 p-3">
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-ink-900/[0.05] dark:bg-white/5">
                  <span className="text-[15px] font-bold leading-none">{DAY_FMT.format(d)}</span>
                  <span className="text-[8px] font-semibold uppercase text-ink-500">{MON_FMT.format(d).replace(/\./g, "")}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <Icon size={13} className="shrink-0 text-ink-500" /> {title}
                  </div>
                  <div className="text-xs capitalize text-ink-500">{sub}</div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.bg} ${chip.text}`}>
                  {chip.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-ink-900/10 bg-bone-50 px-4 py-3 text-[11px] text-ink-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-bone-100">
        <Info size={13} className="mt-0.5 shrink-0" />
        As atividades extra contam para o Ranking LEAP, mas não gastam sessões do teu pack.
      </div>
    </div>
  );
}
