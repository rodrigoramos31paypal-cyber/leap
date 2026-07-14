import Link from "next/link";
import { Suspense } from "react";
import { createClient, getCurrentProfile } from "@/lib/supabase/server";
import { getAccessibleTrainerIds, getClientIdsInScope } from "@/lib/trainer";
import { cn } from "@/lib/utils";
import { Pagination } from "@/components/pagination";
import { ClientSearch } from "@/components/client-search";
import { ListSkeleton } from "@/components/skeleton";
import { NewClientButton } from "./new-client-button";
import { RecentToggle } from "./recent-toggle";
import { PendingAccounts } from "./pending-accounts";

// "new" foi removido (decisão de produto). "todos" passou a "Todos clientes"
// no label e a incluir clientes que se registaram com o trainer mas ainda
// não compraram/marcaram (ver lib/trainer.ts getClientIdsInScope).
type Tab = "todos" | "recent" | "upcoming" | "past" | "esgotar" | "pendentes";

type ClientRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

const PAGE_SIZE = 10;

function resolveTab(raw?: string): Tab {
  if (raw === "todos" || raw === "recent" || raw === "past" || raw === "esgotar" || raw === "upcoming" || raw === "pendentes") return raw as Tab;
  // "new" foi removido — qualquer link antigo cai em "todos" (que agora
  // inclui também os recém-registados). Default da página: "todos clientes".
  return "todos";
}

function labelFor(tab: Tab, q: string): string {
  if (q) return "";
  if (tab === "todos") return "Todos os clientes";
  if (tab === "recent") return "Últimos clientes (mais recentes primeiro)";
  if (tab === "upcoming") return "Clientes com próximas sessões";
  if (tab === "past") return "Clientes com sessões passadas";
  if (tab === "pendentes") return "Contas pendentes de aprovação";
  return "Clientes a esgotar sessões (≤ 2)";
}

// ════════════════════════════════════════════════════════════════
// PERF: shell (titulo, search, tabs) renderiza imediatamente.
// A lista - que faz varias queries pesadas (bookings, profiles,
// purchases para chips de sessoes) - e streamed em Suspense.
// ════════════════════════════════════════════════════════════════
export default async function ClientesPage(
  props: {
    searchParams: Promise<{ q?: string; tab?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const q = (searchParams.q ?? "").trim();
  const tab = resolveTab(searchParams.tab);
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-sm text-ink-500">{labelFor(tab, q) || "A carregar…"}</p>
        </div>
        <NewClientButton />
      </div>

      {tab !== "pendentes" && (
        <ClientSearch
          initialQ={q}
          submitAction="/admin/clientes"
          resultHrefTemplate="/admin/clientes/{id}"
        />
      )}

      {!q && (
        <div className="flex flex-wrap gap-1 rounded-lg border border-ink-900/10 bg-white p-1 text-sm dark:border-white/10 dark:bg-ink-800">
          {/* "recent" é um sub-modo de "todos" → realça o separador "Todos". */}
          <TabLink current={tab === "recent" ? "todos" : tab} value="todos" label="Todos clientes" />
          <TabLink current={tab === "recent" ? "todos" : tab} value="upcoming" label="Próximas sessões" />
          <TabLink current={tab === "recent" ? "todos" : tab} value="pendentes" label="Contas pendentes" />
          <TabLink current={tab === "recent" ? "todos" : tab} value="esgotar" label="Esgotar sessões" />
        </div>
      )}

      {!q && (tab === "todos" || tab === "recent") && <RecentToggle tab={tab} />}

      {tab === "pendentes" && !q ? (
        <Suspense key={`pendentes-${page}`} fallback={<ListSkeleton rows={PAGE_SIZE} />}>
          <PendingAccounts page={page} />
        </Suspense>
      ) : (
        <Suspense key={`${tab}-${q}-${page}`} fallback={<ListSkeleton rows={PAGE_SIZE} />}>
          <ClientList q={q} tab={tab} page={page} />
        </Suspense>
      )}
    </div>
  );
}

async function ClientList({ q, tab, page }: { q: string; tab: Tab; page: number }) {
  const supabase = await createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let clients: ClientRow[] = [];
  let total = 0;

  if (q) {
    // SEC (S-01, audit jun/2026): defesa em profundidade contra
    // (a) PII leakage cross-trainer e (b) PostgREST filter injection
    // na expressao .or(). A pesquisa antes nao filtrava por scope --
    // RLS profiles (id = auth.uid() OR is_admin()) deixa qualquer staff
    // ver qualquer cliente do estudio, e num studio multi-trainer o
    // trainer A enumerava clientes do trainer B (nome+email+telefone)
    // iterando ?q=<letra>. Fix igual ao C-A em search-action.ts:
    // restringir aos clientes do scope via getClientIdsInScope.
    // Tambem o escape de wildcards (%_) deixava de fora os separadores
    // ,() da gramatica or() do PostgREST -- search-action.ts ja escapa
    // [%_,()] e e replicado aqui.
    const safe = q.replace(/[%_,()]/g, (m) => `\\${m}`);
    const scopeIds = await getClientIdsInScope(trainerIds);
    if (scopeIds.length === 0) {
      clients = [];
      total = 0;
    } else {
      const { data, count } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone", { count: "exact" })
        .eq("role", "client")
        .in("id", scopeIds)
        .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order("full_name")
        .range(from, to);
      clients = (data ?? []) as ClientRow[];
      total = count ?? clients.length;
    }
  } else if (tab === "todos" || tab === "recent") {
    ({ clients, total } = await loadAllClientsPage(trainerIds, from, tab === "recent"));
  } else if (tab === "upcoming" || tab === "past") {
    ({ clients, total } = await loadScopedClientPage(tab, trainerIds, trainerScope, from));
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
// ════════════════════════════════════════════════════════════════
// Tab "todos" — TODOS os clientes no âmbito do trainer (mesmo conjunto
// que alimenta o KPI "Total de clientes" do dashboard). Ordena por nome
// e pagina 10/página. `total` = nº de clientes no âmbito (bate com o KPI).
// ════════════════════════════════════════════════════════════════
async function loadAllClientsPage(
  trainerIds: string[],
  from: number,
  // recent=true → ordena por data de criação (mais recentes primeiro),
  // em vez de por nome. Usado pela vista "Últimos clientes".
  recent = false,
): Promise<{ clients: ClientRow[]; total: number }> {
  const supabase = await createClient();
  const applyOrder = (query: any) =>
    recent ? query.order("created_at", { ascending: false }) : query.order("full_name");

  // OWNER: vê TODOS os clientes do estúdio, incluindo "órfãos" — contas que
  // se registaram fora de um link de trainer (profiles.trainer_id NULL) e
  // ainda não compraram/marcaram. O scope por trainer (getClientIdsInScope)
  // só apanha clientes ligados a um trainer ou com compras/bookings, por
  // isso uma conta recém-criada sem trainer ficava invisível aqui. Para o
  // owner isso é indesejado — ele gere o estúdio todo. Exclui anonimizados.
  const profile = await getCurrentProfile();
  if (profile?.role === "owner") {
    const { data, count } = await applyOrder(
      (supabase as any)
        .from("profiles")
        .select("id, full_name, email, phone", { count: "exact" })
        .eq("role", "client")
        .not("email", "ilike", "%@removido.invalid"),
    ).range(from, from + PAGE_SIZE - 1);
    return { clients: (data ?? []) as ClientRow[], total: count ?? 0 };
  }

  // TRAINER: mantém-se scoped — só os seus clientes.
  const ids = await getClientIdsInScope(trainerIds);
  if (ids.length === 0) return { clients: [], total: 0 };
  const { data, count } = await applyOrder(
    supabase
      .from("profiles")
      .select("id, full_name, email, phone", { count: "exact" })
      .eq("role", "client")
      .in("id", ids),
  ).range(from, from + PAGE_SIZE - 1);
  return { clients: (data ?? []) as ClientRow[], total: count ?? 0 };
}

async function loadScopedClientPage(
  tab: "upcoming" | "past" | "esgotar",
  trainerIds: string[],
  trainerScope: string[],
  from: number,
): Promise<{ clients: ClientRow[]; total: number }> {
  const supabase = await createClient();
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
  const supabase = await createClient();

  // OWNER + esgotar: enumera TODOS os clientes (incl. órfãos e quem nunca
  // comprou → 0 sessões), não só os que têm compras no scope. A RPC scoped
  // deixava de fora exactamente os clientes com 0 sessões sem histórico.
  if (tab === "esgotar") {
    const profile = await getCurrentProfile();
    if (profile?.role === "owner") {
      return getOwnerLowSessionsPageIds(from);
    }
  }

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

// Mantém só os IDs que correspondem a um cliente ACTIVO: role='client' e
// não anonimizado (@removido.invalid). Preserva a ordem de entrada. Usado
// pelos fallbacks JS de upcoming/past/esgotar para tirar staff e removidos.
async function filterToActiveClients(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data } = await (supabase as any)
    .from("profiles")
    .select("id, email")
    .eq("role", "client")
    .in("id", ids);
  const valid = new Set<string>(
    ((data ?? []) as any[])
      .filter((p) => !((p.email ?? "") as string).endsWith("@removido.invalid"))
      .map((p) => p.id as string),
  );
  return ids.filter((id) => valid.has(id));
}

// OWNER · "Esgotar sessões" sobre TODOS os clientes do estúdio (incluindo
// quem nunca comprou → 0 sessões, e órfãos sem trainer). Soma as sessões
// activas (confirmed, não expiradas) por cliente; quem não tem compras fica
// a 0. Filtra <= 2, ordena (menos sessões primeiro) e pagina.
async function getOwnerLowSessionsPageIds(
  from: number,
): Promise<{ pageIds: string[]; total: number }> {
  const supabase = await createClient();

  const { data: profs } = await (supabase as any)
    .from("profiles")
    .select("id")
    .eq("role", "client")
    .not("email", "ilike", "%@removido.invalid");
  const allIds = ((profs ?? []) as any[]).map((p) => p.id as string);
  if (allIds.length === 0) return { pageIds: [], total: 0 };

  const totals = new Map<string, number>();
  for (const id of allIds) totals.set(id, 0);

  const { data: rows } = await supabase
    .from("purchases")
    .select("client_id, sessions_remaining, expires_at")
    .in("client_id", allIds)
    .eq("status", "confirmed");
  const now = Date.now();
  for (const r of (rows ?? []) as any[]) {
    if (r.expires_at && new Date(r.expires_at).getTime() < now) continue;
    if (!totals.has(r.client_id)) continue; // ignora compras de não-clientes
    totals.set(r.client_id, (totals.get(r.client_id) ?? 0) + Number(r.sessions_remaining ?? 0));
  }

  const lowList = Array.from(totals.entries())
    .filter(([, n]) => n <= 2)
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);

  return { pageIds: lowList.slice(from, from + PAGE_SIZE), total: lowList.length };
}

async function getScopedPageIdsFallback(
  tab: "upcoming" | "past" | "esgotar",
  trainerScope: string[],
  from: number,
): Promise<{ pageIds: string[]; total: number }> {
  const supabase = await createClient();

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

    // Exclui staff (owners/trainers/admins) e contas anonimizadas/removidas
    // — mesmo guard que a RPC clients_by_booking. Sem isto, uma conta de
    // staff que apareça como client_id de um booking (ex.: sessões de teste)
    // surgia nas tabs Próximas/Sessões passadas.
    const filteredIds = await filterToActiveClients(orderedIds);
    return { pageIds: filteredIds.slice(from, from + PAGE_SIZE), total: filteredIds.length };
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
  const lowCandidates = Array.from(totalsByClient.entries())
    .filter(([_, n]) => n <= 2)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);

  // Exclui staff (trainers/owners) e contas anonimizadas/removidas
  // (@removido.invalid) — mesmo guard que clients_low_sessions (RPC) e
  // count_clients_in_scope. Sem isto, qualquer conta não-cliente com
  // compras no scope, ou um cliente já removido, aparecia na vista.
  const lowList = await filterToActiveClients(lowCandidates);
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
