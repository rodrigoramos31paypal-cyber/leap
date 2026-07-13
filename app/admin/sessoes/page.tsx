import Link from "next/link";
import { Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { BOOKING_STATUS, formatDateTime } from "@/lib/utils";

// Lista de sessões do estúdio (âmbito do admin), acedida pela bolha
// "Sessões marcadas" do dashboard. Dois separadores: Marcadas (todas,
// mais recentes primeiro — default) e Futuras (só as próximas). Botão para
// ocultar canceladas, igual às outras páginas.
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

  const tabCls = (active: boolean) =>
    active
      ? "rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-semibold text-bone-50 dark:bg-bone-50 dark:text-ink-900"
      : "rounded-lg border border-ink-900/10 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-900/5 dark:border-white/10 dark:text-bone-100 dark:hover:bg-white/5";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Calendar size={18} />
        <h1 className="font-display text-lg font-bold">Sessões</h1>
      </div>

      <div className="flex gap-2">
        <Link href={hrefFor({ f: "marcadas", page: 1 })} className={tabCls(tab === "marcadas")}>
          Marcadas
        </Link>
        <Link href={hrefFor({ f: "futuras", page: 1 })} className={tabCls(tab === "futuras")}>
          Futuras
        </Link>
        <Link href={hrefFor({ f: "canceladas", page: 1 })} className={tabCls(tab === "canceladas")}>
          Canceladas
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-500">
          {total} {total === 1 ? "sessão" : "sessões"}
        </span>
        {tab !== "canceladas" && (
          <Link href={hrefFor({ hc: !hideCancelled, page: 1 })} className="btn-outline text-xs">
            {hideCancelled ? "Mostrar canceladas" : "Ocultar canceladas"}
          </Link>
        )}
      </div>

      {!rows || rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">Sem sessões.</div>
      ) : (
        <ul className="space-y-2">
          {(rows as any[]).map((b) => {
            const name = b.profiles?.full_name ?? "—";
            const partner = b.partner_profiles?.full_name;
            const cancelled = b.status === "cancelled";
            return (
              <li key={b.id}>
                <Link
                  href={`/admin/agenda?view=week&d=${localIso(b.starts_at)}&booking=${b.id}`}
                  className="card flex items-center justify-between gap-3 p-3 transition-colors hover:bg-ink-900/[0.03] dark:hover:bg-white/[0.03]"
                >
                  <div className="min-w-0">
                    <div
                      className={`truncate text-sm font-semibold ${
                        cancelled ? "text-ink-400 line-through" : ""
                      }`}
                    >
                      {name}
                      {partner ? ` & ${partner}` : ""}
                    </div>
                    <div className="text-xs tabular-nums text-ink-500">
                      {formatDateTime(b.starts_at)}
                      {b.session_type === "dupla" ? " · Dupla" : ""}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(
                      b.status,
                    )}`}
                  >
                    {(BOOKING_STATUS as any)[b.status] ?? b.status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          {pageNum > 1 ? (
            <Link href={hrefFor({ page: pageNum - 1 })} className="btn-outline text-xs">
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-ink-500">
            Página {pageNum} / {totalPages}
          </span>
          {pageNum < totalPages ? (
            <Link href={hrefFor({ page: pageNum + 1 })} className="btn-outline text-xs">
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
