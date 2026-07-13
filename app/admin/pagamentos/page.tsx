import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { eur, formatDateTime, PURCHASE_STATUS } from "@/lib/utils";
import { confirmPurchaseAction, rejectPurchaseAction, cancelConfirmedPurchaseAction } from "./actions";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { Pagination } from "@/components/pagination";
import { ClientSearch } from "@/components/client-search";
import { DeletePurchaseButton } from "./delete-purchase-button";
import { ArrowLeft } from "lucide-react";

const PAGE_SIZE = 10;

type Tab = "confirmados" | "rejeitados" | "pendentes";

export default async function AdminPaymentsPage(
  props: {
    searchParams: Promise<{ tab?: string; page?: string; q?: string; client?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const q = (searchParams.q ?? "").trim();
  const clientId = (searchParams.client ?? "").trim();
  // Default landing tab é "confirmados" (vista mais útil ao admin no
  // dia-a-dia — pendentes ficam acessíveis via tab quando há trabalho).
  const rawTab = searchParams.tab ?? "confirmados";
  const tab: Tab =
    rawTab === "pendentes" || rawTab === "rejeitados" ? rawTab : "confirmados";
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const trainerScope = trainerIds.length > 0 ? trainerIds : [""];

  // ──────────────────────────────────────────────────────────────
  // MODO 1 · Cliente específico (?client=...): pagamentos desse cliente
  // ──────────────────────────────────────────────────────────────
  if (clientId) {
    const [{ data, count }, { data: profile }] = await Promise.all([
      supabase
        .from("purchases")
        .select("*, profiles:client_id(full_name, email, phone)", { count: "exact" })
        .in("trainer_id", trainerScope)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .range(from, to),
      supabase
        .from("profiles")
        .select("full_name, email, phone")
        .eq("id", clientId)
        .single(),
    ]);
    const purchases = (data ?? []) as any[];
    const total = count ?? purchases.length;
    const name = (profile as any)?.full_name ?? "Cliente";

    return (
      <div className="space-y-5">
        <Link
          href="/admin/pagamentos"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 dark:hover:text-bone-50"
        >
          <ArrowLeft size={14} /> Todos os pagamentos
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{name}</h1>
          <p className="text-sm text-ink-500">
            {(profile as any)?.email}
            {(profile as any)?.phone ? ` · ${(profile as any).phone}` : ""}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {total} pagamento{total === 1 ? "" : "s"} registado{total === 1 ? "" : "s"}
          </p>
        </div>

        {purchases.length === 0 ? (
          <div className="card p-5 text-center text-sm text-ink-500">
            Este cliente ainda não tem pagamentos.
          </div>
        ) : (
          <ul className="space-y-2">
            {purchases.map(renderPurchase)}
          </ul>
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          baseHref="/admin/pagamentos"
          extraParams={{ client: clientId }}
        />
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────
  // MODO 2 · Lista de clientes que fizeram match (?q=...)
  // ──────────────────────────────────────────────────────────────
  if (q) {
    const safe = q.replace(/[%_,()]/g, (m) => `\\${m}`);
    const { data: matches, count } = await supabase
      .from("profiles")
      .select("id, full_name, email, phone", { count: "exact" })
      .eq("role", "client")
      .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
      .order("full_name")
      .range(from, to);
    const total = count ?? matches?.length ?? 0;

    return (
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Pagamentos</h1>
          <p className="text-sm text-ink-500">
            {total} resultado{total === 1 ? "" : "s"} para &quot;{q}&quot; — escolhe um
            cliente para ver os pagamentos dele.
          </p>
        </div>

        <ClientSearch
          initialQ={q}
          submitAction="/admin/pagamentos"
          resultHrefTemplate="/admin/pagamentos?client={id}"
        />

        {(!matches || matches.length === 0) ? (
          <div className="card p-5 text-center text-sm text-ink-500">
            Nenhum cliente encontrado.
          </div>
        ) : (
          <ul className="space-y-2">
            {(matches as any[]).map((c) => (
              <li key={c.id} className="card">
                <Link
                  href={`/admin/pagamentos?client=${c.id}`}
                  className="block p-4"
                >
                  <div className="text-sm font-semibold">
                    {c.full_name || "(sem nome)"}
                  </div>
                  {c.email && <div className="text-xs text-ink-500">{c.email}</div>}
                  {c.phone && <div className="text-xs text-ink-500">{c.phone}</div>}
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-gold-600">
                    Ver pagamentos →
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          baseHref="/admin/pagamentos"
          extraParams={{ q }}
        />
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────
  // MODO 3 · Vista por tabs (sem pesquisa)
  // ──────────────────────────────────────────────────────────────
  let query = supabase
    .from("purchases")
    .select("*, profiles:client_id(full_name, email, phone)", { count: "exact" })
    .in("trainer_id", trainerScope)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (tab === "confirmados") {
    query = query.eq("status", "confirmed");
  } else if (tab === "rejeitados") {
    query = query.in("status", ["rejected", "cancelled"]);
  } else {
    query = query.in("status", ["awaiting_confirmation", "pending_payment"]);
  }

  const { data: purchases, count } = await query;
  const total = count ?? (purchases?.length ?? 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Pagamentos</h1>
        <p className="text-sm text-ink-500">
          Confirma manualmente os pagamentos recebidos.
        </p>
      </div>

      <ClientSearch
        submitAction="/admin/pagamentos"
        resultHrefTemplate="/admin/pagamentos?client={id}"
      />

      <div className="flex gap-2 border-b border-ink-900/10 dark:border-white/10">
        <Tab href="/admin/pagamentos?tab=confirmados" active={tab === "confirmados"} label="Confirmados" />
        <Tab href="/admin/pagamentos?tab=rejeitados" active={tab === "rejeitados"} label="Rejeitados" />
        <Tab href="/admin/pagamentos?tab=pendentes" active={tab === "pendentes"} label="Pendentes" />
      </div>

      {(!purchases || purchases.length === 0) ? (
        <div className="card p-5 text-center text-sm text-ink-500">Sem registos.</div>
      ) : (
        <ul className="space-y-2">{(purchases as any[]).map(renderPurchase)}</ul>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        baseHref="/admin/pagamentos"
        extraParams={{ tab }}
      />
    </div>
  );
}

function renderPurchase(p: any) {
  const pending =
    p.status === "awaiting_confirmation" || p.status === "pending_payment";
  const terminal = p.status === "rejected" || p.status === "cancelled";
  const ref = `LEAP-${p.id.slice(0, 6).toUpperCase()}`;
  const confirmCls =
    "rounded-md bg-ink-900 px-2.5 py-1.5 text-xs font-semibold text-bone-50 hover:bg-ink-700 dark:bg-bone-50 dark:text-ink-900 dark:hover:bg-bone-100";
  const dangerCls =
    "rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-400/30 dark:text-red-300";

  return (
    <li key={p.id} className="card">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/admin/pagamentos?client=${p.client_id}`}
            className={`block truncate text-sm font-semibold hover:underline ${
              terminal ? "text-ink-400" : ""
            }`}
          >
            {p.profiles?.full_name ?? "—"}
          </Link>
          <div className="mt-0.5 space-y-0.5 text-xs text-ink-500">
            <div className="tabular-nums">{formatDateTime(p.created_at)}</div>
            <div className="truncate">
              {p.pack_snapshot?.name ?? "—"} · {paymentMethodLabel(p.payment_method)} ·{" "}
              {eur(p.amount_cents)}
            </div>
            <div className="truncate">
              Ref{" "}
              <code className="rounded bg-bone-100 px-1 dark:bg-white/10">{ref}</code>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {pending && (
            <>
              <form action={confirmPurchaseAction}>
                <input type="hidden" name="purchaseId" value={p.id} />
                <button className={confirmCls}>Confirmar</button>
              </form>
              <form action={rejectPurchaseAction}>
                <input type="hidden" name="purchaseId" value={p.id} />
                <button className={dangerCls}>Rejeitar</button>
              </form>
            </>
          )}
          {p.status === "confirmed" && (
            <form action={cancelConfirmedPurchaseAction}>
              <input type="hidden" name="purchaseId" value={p.id} />
              <button className={dangerCls}>Cancelar</button>
            </form>
          )}
          {terminal && (
            <>
              <span className={`chip-${statusColor(p.status)} text-[10px]`}>
                {(PURCHASE_STATUS as any)[p.status]}
              </span>
              <DeletePurchaseButton purchaseId={p.id} />
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active
          ? "border-ink-900 text-ink-900 dark:border-bone-50 dark:text-bone-50"
          : "border-transparent text-ink-500"
      }`}
    >
      {label}
    </Link>
  );
}

function paymentMethodLabel(m: string) {
  return {
    manual_mbway: "MB Way",
    manual_cash: "Dinheiro",
    manual_transfer: "Transferência",
    manual_revolut: "Revolut",
    complimentary: "Cortesia",
    mbway: "MB Way",
    multibanco: "Multibanco",
    card: "Cartão",
  }[m] ?? m;
}

function statusColor(s: string) {
  if (s === "confirmed") return "ok";
  if (s === "rejected" || s === "cancelled") return "danger";
  return "warn";
}
