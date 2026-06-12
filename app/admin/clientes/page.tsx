import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/pagination";
import { ClientSearch } from "@/components/client-search";
import { ListSkeleton } from "@/components/skeleton";

type Tab = "upcoming" | "past" | "new" | "esgotar";

type ClientRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

const PAGE_SIZE = 10;

function resolveTab(raw?: string): Tab {
  return raw === "past" || raw === "new" || raw === "esgotar" ? (raw as Tab) : "upcoming";
}

function labelFor(tab: Tab, q: string): string {
  if (q) return "";
  if (tab === "upcoming") return "Clientes com próximas sessões";
  if (tab === "past") return "Clientes com sessões passadas";
  if (tab === "new") return "Clientes registados recentemente";
  return "Clientes a esgotar sessões (≤ 2)";
}

// ════════════════════════════════════════════════════════════════
// PERF: shell (titulo, search, tabs) renderiza imediatamente.
// A lista - que faz varias queries pesadas (bookings, profiles,
// purchases para chips de sessoes) - e streamed em Suspense.
// ════════════════════════════════════════════════════════════════
export default function ClientesPage({
  searchParams,
}: {
  searchParams: { q?: string; tab?: string; page?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  const tab = resolveTab(searchParams.tab);
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Clientes</h1>
        <p className="text-sm text-ink-500">{labelFor(tab, q) || "A carregar…"}</p>
      </div>

      <ClientSearch
        initialQ={q}
        submitAction="/admin/clientes"
        resultHrefTemplate="/admin/clientes/{id}"
      />

      {!q && (
        <div className="flex flex-wrap gap-1 rounded-lg border border-ink-900/10 bg-white p-1 text-sm dark:border-white/10 dark:bg-ink-800">
          <TabLink current={tab} value="upcoming" label="Próximas sessões" />
          <TabLink current={tab} value="past" label="Sessões passadas" />
          <TabLink current={tab} value="new" label="Novos clientes" />
          <TabLink current={tab} value="esgotar" label="A esgotar sessões" />
        </div>
      )}

      <Suspense key={`${tab}-${q}-${page}`} fallback={<ListSkeleton rows={PAGE_SIZE} />}>
        <ClientList q={q} tab={tab} page={page} />
      </Suspense>
    </div>
  );
}

async function ClientList({ q, tab, page }: { q: string; tab: Tab; page: number }) {
  const supabase = createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let clients: ClientRow[] = [];
  let total = 0;

  if (q) {
    const safe = q.replace(/[%_]/g, (m) => `\\${m}`);
    const { data, count } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone", { count: "exact" })
      .eq("role", "client")
      .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
      .order("full_name")
      .range(from, to);
    clients = (data ?? []) as ClientRow[];
    total = count ?? clients.length;
  } else if (tab === "upcoming" || tab === "past") {
    ({ clients, total } = await loadScopedClientPage(tab, trainerIds, trainerScope, from));
  } else if (tab === "new") {
    const { data, count } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone, created_at", { count: "exact" })
      .eq("role", "client")
      .order("created_at", { ascending: false })
      .range(from, to);
    clients = (data ?? []) as ClientRow[];
    total = count ?? clients.length;
  } else {
    // tab === "esgotar"
    ({ clients, total } = await loadScopedClientPage("esgotar", trainerIds, trainerScope, from));
  }

  const ids = clients.map((c) => c.id);
  const sessionsMap = new Map<string, number>();
  if (ids.length > 0) {
    const { data: creditRows } = await supabase
      .from("purchases")
      .select("client_id, sessions_remaining, expires_at, status")
      .in("client_id", ids)
      .eq("status", "confirmed");
    const now = Date.now();
    for (const row of (creditRows ?? []) as any[]) {
      if (row.expires_at && new Date(row.expires_at).getTime() < now) continue;
      sessionsMap.set(row.client_id, (sessionsMap.get(row.client_id) ?? 0) + row.sessions_remaining);
    }
  }

  const extraParams: Record<string, string> = {};
  if (q) extraParams.q = q;
  else extraParams.tab = tab;

  return (
    <>
      {clients.length === 0 ? (
        <div className="card p-5 text-center text-sm text-ink-500">
          {q ? "Nenhum cliente encontrado." : "Sem clientes nesta vista."}
        </div>
      ) : (
        <ul className="space-y-2">
          {clients.map((c) => {
            const sessions = sessionsMap.get(c.id) ?? 0;
            return (
              <li key={c.id} className="card">
                <Link href={`/admin/clientes/${c.id}`} className="flex items-center justify-between p-4">
                  <div>
                    <div className="text-sm font-semibold">{c.full_name || "(sem nome)"}</div>
                    {c.email && <div className="text-xs text-ink-500">{c.email}</div>}
                    {c.phone && <div className="text-xs text-ink-500">{c.phone}</div>}
                  </div>
                  <div className="text-right">
                    <span
                      className={
                        sessions === 0 ? "chip-danger" : sessions <= 2 ? "chip-warn" : "chip-ok"
                      }
                    >
                      {sessions} {sessions === 1 ? "sessão" : "sessões"}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        baseHref="/admin/clientes"
        extraParams={extraParams}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// PERF: páginas "upcoming/past/esgotar" — agregação + paginação feita
// no Postgres (migration 0024). Devolve a página de client_ids + total;
// o resto (perfis + chip de sessões) mantém-se igual a jusante.
//
// SEGURANÇA/ROBUSTEZ: se a RPC ainda não existir (migration não aplicada)
// ou falhar por qualquer motivo, caímos para a lógica antiga em JS —
// idêntica ao comportamento anterior. Zero breakage no deploy.
// ════════════════════════════════════════════════════════════════
async function loadScopedClientPage(
  tab: "upcoming" | "past" | "esgotar",
  trainerIds: string[],
  trainerScope: string[],
  from: number,
): Promise<{ clients: ClientRow[]; total: number }> {
  const supabase = createClient();
  const { pageIds, total } = await getScopedPageIds(tab, trainerIds, trainerScope, from);

  let clients: ClientRow[] = [];
  if (pageIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .in("id", pageIds);
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    clients = pageIds.map((id) => map.get(id)).filter(Boolean) as ClientRow[];
  }
  return { clients, total };
}

async function getScopedPageIds(
  tab: "upcoming" | "past" | "esgotar",
  trainerIds: string[],
  trainerScope: string[],
  from: number,
): Promise<{ pageIds: string[]; total: number }> {
  const supabase = createClient();
  try {
    // `as any`: estas RPCs ainda não estão nos tipos gerados do Supabase.
    // O runtime é correcto; evitamos só novos erros de `tsc`.
    if (tab === "esgotar") {
      const { data, error } = await (supabase as any).rpc("clients_low_sessions", {
        p_trainer_ids: trainerIds,
        p_offset: from,
        p_limit: PAGE_SIZE,
      });
      if (error) throw error;
      const rows = (data ?? []) as Array<{ client_id: string; total_count: number }>;
      return { pageIds: rows.map((r) => r.client_id), total: Number(rows[0]?.total_count ?? 0) };
    }
    const { data, error } = await (supabase as any).rpc("clients_by_booking", {
      p_trainer_ids: trainerIds,
      p_upcoming: tab === "upcoming",
      p_offset: from,
      p_limit: PAGE_SIZE,
    });
    if (error) throw error;
    const rows = (data ?? []) as Array<{ client_id: string; total_count: number }>;
    return { pageIds: rows.map((r) => r.client_id), total: Number(rows[0]?.total_count ?? 0) };
  } catch {
    // Fallback — lógica original (idêntica ao comportamento anterior).
    return getScopedPageIdsFallback(tab, trainerScope, from);
  }
}

async function getScopedPageIdsFallback(
  tab: "upcoming" | "past" | "esgotar",
  trainerScope: string[],
  from: number,
): Promise<{ pageIds: string[]; total: number }> {
  const supabase = createClient();

  if (tab === "upcoming" || tab === "past") {
    const nowIso = new Date().toISOString();
    let bq = supabase
      .from("bookings")
      .select("client_id, starts_at")
      .in("trainer_id", trainerScope)
      .in("status", ["booked", "confirmed"]);
    if (tab === "upcoming") {
      bq = bq.gte("starts_at", nowIso).order("starts_at", { ascending: true });
    } else {
      bq = bq.lt("starts_at", nowIso).order("starts_at", { ascending: false });
    }
    const { data: bookings } = await bq.limit(1000);

    const orderedIds: string[] = [];
    const seen = new Set<string>();
    for (const b of (bookings ?? []) as any[]) {
      if (seen.has(b.client_id)) continue;
      seen.add(b.client_id);
      orderedIds.push(b.client_id);
    }
    return { pageIds: orderedIds.slice(from, from + PAGE_SIZE), total: orderedIds.length };
  }

  // esgotar
  const { data: rows } = await supabase
    .from("purchases")
    .select("client_id, sessions_remaining, expires_at")
    .in("trainer_id", trainerScope)
    .eq("status", "confirmed");
  const now = Date.now();
  const totalsByClient = new Map<string, number>();
  for (const r of (rows ?? []) as any[]) {
    if (r.expires_at && new Date(r.expires_at).getTime() < now) continue;
    totalsByClient.set(
      r.client_id,
      (totalsByClient.get(r.client_id) ?? 0) + Number(r.sessions_remaining ?? 0),
    );
  }
  const { data: anyPurchases } = await supabase
    .from("purchases")
    .select("client_id")
    .in("trainer_id", trainerScope);
  for (const r of (anyPurchases ?? []) as any[]) {
    if (!totalsByClient.has(r.client_id)) {
      totalsByClient.set(r.client_id, 0);
    }
  }
  const lowList = Array.from(totalsByClient.entries())
    .filter(([_, n]) => n <= 2)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
  return { pageIds: lowList.slice(from, from + PAGE_SIZE), total: lowList.length };
}

function TabLink({ current, value, label }: { current: Tab; value: Tab; label: string }) {
  const active = current === value;
  return (
    <Link
      href={`/admin/clientes?tab=${value}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex-1 rounded-md px-3 py-1.5 text-center font-medium transition",
        active
          ? "bg-ink-900 text-white shadow-sm dark:bg-bone-50 dark:text-ink-900"
          : "text-ink-600 hover:bg-ink-900/5 hover:text-ink-900 dark:text-bone-100 dark:hover:bg-white/10 dark:hover:text-bone-50",
      )}
    >
      {label}
    </Link>
  );
}
