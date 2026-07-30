import { createClient } from "@/lib/supabase/server";
import { Pagination } from "@/components/pagination";
import { PendingActions } from "./pending-actions";

const HISTORY_PAGE_SIZE = 10;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-PT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/Lisbon",
    });
  } catch {
    return iso;
  }
}

type PendingRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  approval_requested_at: string | null;
};

type HistoryRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  approval_status: string;
  approval_decided_at: string | null;
  approval_decided_by: string | null;
};

// ════════════════════════════════════════════════════════════════
// Aba "Contas pendentes": no topo, as contas por aprovar (mais antigas
// primeiro — fila). Por baixo, o histórico de decisões (aprovadas /
// rejeitadas), mais recentes primeiro, paginado.
// ════════════════════════════════════════════════════════════════
export async function PendingAccounts({ page }: { page: number }) {
  const supabase = await createClient();

  // Pendentes — mais antigas primeiro (quem espera há mais tempo no topo).
  const { data: pendingData } = await (supabase as any)
    .from("profiles")
    .select("id, full_name, email, phone, approval_requested_at")
    .eq("role", "client")
    .eq("approval_status", "pending")
    .order("approval_requested_at", { ascending: true });
  const pending = (pendingData ?? []) as PendingRow[];

  // Histórico — só contas que passaram pelo fluxo de aprovação (têm
  // approval_requested_at). Decisão mais recente primeiro. Paginado.
  const from = (page - 1) * HISTORY_PAGE_SIZE;
  const to = from + HISTORY_PAGE_SIZE - 1;
  const { data: historyData, count } = await (supabase as any)
    .from("profiles")
    .select(
      "id, full_name, email, phone, approval_status, approval_decided_at, approval_decided_by",
      { count: "exact" },
    )
    .eq("role", "client")
    .in("approval_status", ["approved", "rejected"])
    .not("approval_requested_at", "is", null)
    .order("approval_decided_at", { ascending: false })
    .range(from, to);
  const history = (historyData ?? []) as HistoryRow[];

  // Resolve o nome de quem decidiu.
  const deciderIds = Array.from(
    new Set(history.map((h) => h.approval_decided_by).filter(Boolean) as string[]),
  );
  const deciderName = new Map<string, string>();
  if (deciderIds.length > 0) {
    const { data: deciders } = await (supabase as any)
      .from("profiles")
      .select("id, full_name")
      .in("id", deciderIds);
    for (const d of (deciders ?? []) as any[]) deciderName.set(d.id, d.full_name);
  }

  return (
    <div className="space-y-6">
      {/* ── A aguardar aprovação ─────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          A aguardar aprovação {pending.length > 0 ? `(${pending.length})` : ""}
        </h2>
        {pending.length === 0 ? (
          <div className="card p-5 text-center text-sm text-ink-500">
            Sem contas pendentes.
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map((c) => (
              <li key={c.id} className="card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{c.full_name || "(sem nome)"}</div>
                    {c.email && <div className="text-xs text-ink-500">{c.email}</div>}
                    <div className="text-xs text-ink-500">
                      {c.phone || "sem telefone"} · registou-se {fmtDate(c.approval_requested_at)}
                    </div>
                  </div>
                  <PendingActions clientId={c.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Histórico de decisões ────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Histórico
        </h2>
        {history.length === 0 ? (
          <div className="card p-5 text-center text-sm text-ink-500">
            Ainda não há decisões registadas.
          </div>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => {
              const approved = h.approval_status === "approved";
              return (
                <li key={h.id} className="card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{h.full_name || "(sem nome)"}</div>
                      {h.email && <div className="text-xs text-ink-500">{h.email}</div>}
                      <div className="text-xs text-ink-500">
                        {fmtDate(h.approval_decided_at)}
                        {h.approval_decided_by
                          ? ` · por ${deciderName.get(h.approval_decided_by) ?? "—"}`
                          : ""}
                      </div>
                    </div>
                    <span className={approved ? "chip-ok" : "chip-danger"}>
                      {approved ? "Aprovada" : "Rejeitada"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Pagination
          page={page}
          pageSize={HISTORY_PAGE_SIZE}
          total={count ?? 0}
          baseHref="/admin/clientes"
          extraParams={{ tab: "pendentes" }}
        />
      </div>
    </div>
  );
}
