import Link from "next/link";
import { ChevronRight, EyeOff, Eye, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { BOOKING_STATUS } from "@/lib/utils";

// Lista de sessões do estúdio (âmbito do admin), acedida pela bolha
// "Sessões marcadas" do dashboard. Separadores: Marcadas (todas, mais
// recentes primeiro — default), Futuras e Canceladas. Botão para ocultar
// canceladas, igual às outras páginas.
//
// DESIGN PREMIUM (alinhado com o fitnessv2): tabs segmentadas, lista
// agrupada por dia (hora + nome + pill Duo + chip de estado).
export const metadata = { title: "Sessões", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// Data-calendário LOCAL (Europe/Lisbon) para o deep-link ?d= da agenda.
function localIso(startsAt: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(startsAt));
}

function hhmm(startsAt: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startsAt));
}

// Cabeçalho de grupo por dia: "Hoje · Qui, 24 jul" / "Amanhã · …" / "Seg, 20 jul".
function dayLabel(startsAt: string): string {
  const d = localIso(startsAt);
  const now = new Date();
  const today = localIso(now.toISOString());
  const tmr = new Date(now);
  tmr.setDate(tmr.getDate() + 1);
  const tomorrow = localIso(tmr.toISOString());
  const pretty = new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    weekday: "short",
    day: "2-digit",
    month: "short",
  })
    .format(new Date(startsAt))
    .replace(/\./g, "");
  const cap = pretty.charAt(0).toUpperCase() + pretty.slice(1);
  if (d === today) return `Hoje · ${cap}`;
  if (d === tomorrow) return `Amanhã · ${cap}`;
  return cap;
}

function statusClass(status: string): string {
  if (status === "cancelled") return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  if (status === "no_show") return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
}

export default async function SessoesPage(props: {
  searchParams: Promise<{ f?: string; hc?: string; page?: string }>;
}) {
  const sp = await props.searchParams;
  const tab: "marcadas" | "futuras" | "canceladas" =
    sp.f === "futuras" ? "futuras" : sp.f === "canceladas" ? "canceladas" : "marcadas";
  const hideCancelled = sp.hc === "1";
  const pageNum = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const nowIso = new Date().toISOString();

  const supabase = await createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const scope = trainerIds.length > 0 ? trainerIds : [""];

  let q = (supabase as any)
    .from("bookings")
    .select(
      "id, starts_at, ends_at, session_type, status, client_id, profiles:client_id(full_name), partner_profiles:partner_client_id(full_name)",
      { count: "exact" },
    )
    .in("trainer_id", scope);
  if (tab === "canceladas") {
    q = q.eq("status", "cancelled").order("starts_at", { ascending: false });
  } else {
    if (hideCancelled) q = q.neq("status", "cancelled");
    if (tab === "futuras") {
      q = q.gte("starts_at", nowIso).order("starts_at", { ascending: true });
    } else {
      q = q.order("starts_at", { ascending: false });
    }
  }
  const fromRow = (pageNum - 1) * PAGE_SIZE;
  q = q.range(fromRow, fromRow + PAGE_SIZE - 1);
  const { data: rows, count } = await q;

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hrefFor = (opts: { f?: string; hc?: boolean; page?: number }) => {
    const p = new URLSearchParams();
    const f = opts.f ?? tab;
    if (f === "futuras") p.set("f", "futuras");
    else if (f === "canceladas") p.set("f", "canceladas");
    const hc = opts.hc ?? hideCancelled;
    if (hc && f !== "canceladas") p.set("hc", "1");
    const pg = opts.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const qs = p.toString();
    return `/admin/sessoes${qs ? `?${qs}` : ""}`;
  };

  // Agrupar por dia preservando a ordem já vinda da query.
  const groups: { key: string; label: string; items: any[] }[] = [];
  for (const b of (rows ?? []) as any[]) {
    const key = localIso(b.starts_at);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(b.starts_at), items: [] };
      groups.push(g);
    }
    g.items.push(b);
  }

  const segCls = (active: boolean) =>
    active
      ? "flex-1 rounded-lg bg-white px-2 py-1.5 text-center text-[12px] font-semibold text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50"
      : "flex-1 rounded-lg px-2 py-1.5 text-center text-[12px] font-medium text-ink-500 transition hover:text-ink-900 dark:hover:text-bone-50";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Sessões</h1>
        <p className="text-sm text-ink-500">
          {total} {total === 1 ? "sessão" : "sessões"} · todas as marcações do estúdio
        </p>
      </div>

      <div className="flex gap-1 rounded-xl border border-ink-900/[0.07] bg-bone-100 p-1 dark:border-white/10 dark:bg-ink-900">
        <Link href={hrefFor({ f: "marcadas", page: 1 })} className={segCls(tab === "marcadas")}>
          Marcadas
        </Link>
        <Link href={hrefFor({ f: "futuras", page: 1 })} className={segCls(tab === "futuras")}>
          Futuras
        </Link>
        <Link href={hrefFor({ f: "canceladas", page: 1 })} className={segCls(tab === "canceladas")}>
          Canceladas
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11.5px] text-ink-500">
          A mostrar {(rows ?? []).length} de {total}
        </span>
        {tab !== "canceladas" && (
          <Link
            href={hrefFor({ hc: !hideCancelled, page: 1 })}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-900/10 bg-white px-3 py-1 text-[11px] font-medium text-ink-600 transition hover:border-gold-300 dark:border-white/10 dark:bg-ink-800 dark:text-bone-100"
          >
            {hideCancelled ? <Eye size={13} /> : <EyeOff size={13} />}
            {hideCancelled ? "Mostrar canceladas" : "Ocultar canceladas"}
          </Link>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">Sem sessões.</div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
                {g.label}
              </div>
              <div className="card overflow-hidden p-0">
                <ul className="divide-y divide-ink-900/[0.06] dark:divide-white/[0.07]">
                  {g.items.map((b) => {
                    const name = b.profiles?.full_name ?? "—";
                    const partner = b.partner_profiles?.full_name;
                    const cancelled = b.status === "cancelled";
                    const label = (BOOKING_STATUS as any)[b.status] ?? b.status;
                    return (
                      <li key={b.id}>
                        <Link
                          href={`/admin/agenda?view=week&d=${localIso(b.starts_at)}&booking=${b.id}`}
                          className="flex items-center gap-3 px-3 py-3 transition hover:bg-ink-900/[0.02] dark:hover:bg-white/[0.03]"
                        >
                          <div className={`w-[46px] shrink-0 text-[13px] font-semibold tabular-nums ${cancelled ? "text-ink-400" : "text-ink-900 dark:text-bone-50"}`}>
                            {hhmm(b.starts_at)}
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className={`truncate text-[13.5px] font-medium ${cancelled ? "text-ink-400 line-through" : "text-ink-900 dark:text-bone-50"}`}>
                                {name}
                                {partner ? ` & ${partner}` : ""}
                              </span>
                              {b.session_type === "dupla" && (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#CECBF6] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[#26215C] dark:bg-[#534AB7] dark:text-[#EEEDFE]">
                                  <Users size={9} /> Duo
                                </span>
                              )}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(b.status)}`}>
                            {label}
                          </span>
                          <ChevronRight size={15} className="shrink-0 text-ink-300 dark:text-white/25" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          {pageNum > 1 ? (
            <Link href={hrefFor({ page: pageNum - 1 })} className="rounded-full border border-ink-900/10 bg-white px-3.5 py-1.5 text-[11.5px] font-medium text-ink-600 dark:border-white/10 dark:bg-ink-800 dark:text-bone-100">
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[11px] text-ink-500">
            Página {pageNum} / {totalPages}
          </span>
          {pageNum < totalPages ? (
            <Link href={hrefFor({ page: pageNum + 1 })} className="rounded-full border border-ink-900/10 bg-white px-3.5 py-1.5 text-[11.5px] font-semibold text-ink-900 dark:border-white/10 dark:bg-ink-800 dark:text-bone-50">
              Seguinte →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
