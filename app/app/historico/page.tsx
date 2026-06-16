import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { eur, formatDateTime, BOOKING_STATUS, PURCHASE_STATUS } from "@/lib/utils";
import { cancelBookingAction, rebookAction } from "./actions";
import { CalendarPlus, RefreshCcw, NotebookPen } from "lucide-react";
import { NoteEditor } from "@/components/note-editor";
import { getMyNotesMapForBookings } from "@/lib/notes";

export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: { tab?: string; ok?: string; f?: string; c?: string };
}) {
  const tab = searchParams.tab === "compras" ? "compras" : "sessoes";
  const sessFilter: "todas" | "futuras" | "passadas" =
    searchParams.f === "futuras" || searchParams.f === "passadas" ? searchParams.f : "todas";
  const compFilter: "todas" | "confirmadas" | "rejeitadas" =
    searchParams.c === "confirmadas" || searchParams.c === "rejeitadas" ? searchParams.c : "todas";
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Histórico</h1>
        <p className="text-sm text-ink-500">Sessões e compras.</p>
      </div>

      {searchParams.ok === "pending" ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A tua marcação está pendente — o treinador vai aceitá-la em breve.
        </div>
      ) : searchParams.ok === "recurring" ? (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Marcações recorrentes criadas com sucesso.
        </div>
      ) : searchParams.ok === "reschedule" ? (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Sessão reagendada com sucesso.
        </div>
      ) : searchParams.ok ? (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Marcação confirmada com sucesso.
        </div>
      ) : null}

      <div className="flex gap-2 border-b border-ink-900/10">
        <TabLink href="/app/historico" active={tab === "sessoes"} label="Sessões" />
        <TabLink href="/app/historico?tab=compras" active={tab === "compras"} label="Compras" />
      </div>

      {tab === "sessoes" && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="Todas" href="/app/historico" active={sessFilter === "todas"} />
          <FilterChip label="Futuras" href="/app/historico?f=futuras" active={sessFilter === "futuras"} />
          <FilterChip label="Passadas" href="/app/historico?f=passadas" active={sessFilter === "passadas"} />
        </div>
      )}

      {tab === "compras" && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="Todas" href="/app/historico?tab=compras" active={compFilter === "todas"} />
          <FilterChip label="Confirmadas" href="/app/historico?tab=compras&c=confirmadas" active={compFilter === "confirmadas"} />
          <FilterChip label="Rejeitadas" href="/app/historico?tab=compras&c=rejeitadas" active={compFilter === "rejeitadas"} />
        </div>
      )}

      {tab === "sessoes" ? <SessoesTab userId={user.id} filter={sessFilter} /> : <ComprasTab userId={user.id} filter={compFilter} />}
    </div>
  );
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active ? "border-ink-900 text-ink-900" : "border-transparent text-ink-500"
      }`}
    >
      {label}
    </Link>
  );
}

function FilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
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

async function SessoesTab({ userId, filter }: { userId: string; filter: "todas" | "futuras" | "passadas" }) {
  const supabase = createClient();
  const nowIso = new Date().toISOString();
  // PERF (CB-5 audit jun/2026): antes era select("*") — trazia 15+
  // colunas (cancellation_reason, confirmed_by/at, cancelled_by/at,
  // purchase_id, series_id, credit_charged, …) que a UI nunca lê. 50
  // rows × ~600 B → ~30 KB; com as colunas certas ~9 KB e JSON.parse
  // 3x mais rápido em mobile.
  let query = supabase
    .from("bookings")
    .select("id, starts_at, ends_at, session_type, status")
    .eq("client_id", userId);
  if (filter === "futuras") {
    query = query.gte("starts_at", nowIso).order("starts_at", { ascending: true });
  } else if (filter === "passadas") {
    query = query.lt("starts_at", nowIso).order("starts_at", { ascending: false });
  } else {
    query = query.order("starts_at", { ascending: false });
  }
  const { data: bookings } = await query.limit(50);

  if (!bookings || bookings.length === 0) {
    return <div className="card p-5 text-center text-sm text-ink-500">Sem sessões ainda.</div>;
  }

  const notesMap = await getMyNotesMapForBookings(bookings.map((b) => b.id));

  return (
    <ul className="space-y-2">
      {bookings.map((b) => {
        const isFuture = new Date(b.starts_at).getTime() > Date.now();
        const canModify = isFuture && (b.status === "booked" || b.status === "confirmed");
        return (
          <li key={b.id} className="card p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{formatDateTime(b.starts_at)}</div>
                <div className="text-xs text-ink-500 capitalize">{b.session_type}</div>
              </div>
              <StatusChip status={b.status} />
            </div>
            {canModify && (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <a
                  href={`/api/bookings/${b.id}/ics`}
                  className="btn-outline inline-flex items-center justify-center gap-1.5 text-xs"
                >
                  <CalendarPlus size={14} /> Adicionar ao calendário
                </a>
                <form action={rebookAction}>
                  <input type="hidden" name="bookingId" value={b.id} />
                  <button className="btn-outline inline-flex w-full items-center justify-center gap-1.5 text-xs">
                    <RefreshCcw size={14} /> Reagendar
                  </button>
                </form>
                <form action={cancelBookingAction}>
                  <input type="hidden" name="bookingId" value={b.id} />
                  <button className="btn-outline w-full text-xs text-red-700 hover:bg-red-50 border-red-200">
                    Cancelar
                  </button>
                </form>
              </div>
            )}

            <details className="mt-3 border-t border-ink-900/5 pt-3">
              <summary className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600 hover:text-ink-900">
                <NotebookPen size={12} /> As minhas notas
              </summary>
              <div className="mt-2">
                <NoteEditor bookingId={b.id} initialBody={notesMap.get(b.id)?.body} compact sharedWithTrainer />
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

async function ComprasTab({ userId, filter }: { userId: string; filter: "todas" | "confirmadas" | "rejeitadas" }) {
  const supabase = createClient();
  // PERF: limita explicitamente — antes era sem limite e podia trazer
  // o histórico todo do cliente. Os campos pedidos também foram
  // restringidos aos que a UI usa.
  let query = supabase
    .from("purchases")
    .select("id, status, amount_cents, sessions_remaining, sessions_total, pack_snapshot, created_at")
    .eq("client_id", userId);
  if (filter === "confirmadas") query = query.eq("status", "confirmed");
  else if (filter === "rejeitadas") query = query.eq("status", "rejected");
  const { data: purchases } = await query
    .order("created_at", { ascending: false })
    .limit(50);

  if (!purchases || purchases.length === 0) {
    return <div className="card p-5 text-center text-sm text-ink-500">Sem compras ainda.</div>;
  }

  return (
    <ul className="space-y-2">
      {purchases.map((p) => (
        <li key={p.id} className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{(p.pack_snapshot as any).name}</div>
              <div className="text-xs text-ink-500">{formatDateTime(p.created_at)}</div>
            </div>
            <div className="text-right">
              <div className="font-display font-bold">{eur(p.amount_cents)}</div>
              <div className="text-xs text-ink-500">{p.sessions_remaining}/{p.sessions_total} restantes</div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <PurchaseChip status={p.status} />
            {p.status === "awaiting_confirmation" && (
              <Link href={`/app/compras/${p.id}/manual`} className="text-xs font-medium text-gold-600">
                Ver instruções →
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    booked: "chip-gold",
    confirmed: "chip-ok",
    cancelled: "chip-mute",
    no_show: "chip-danger",
  };
  const cls = map[status] ?? "chip-mute";
  return <span className={cls}>{(BOOKING_STATUS as any)[status] ?? status}</span>;
}

function PurchaseChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending_payment: "chip-warn",
    awaiting_confirmation: "chip-warn",
    confirmed: "chip-ok",
    rejected: "chip-danger",
    cancelled: "chip-mute",
  };
  const cls = map[status] ?? "chip-mute";
  return <span className={cls}>{(PURCHASE_STATUS as any)[status] ?? status}</span>;
}
