import { redirect } from "next/navigation";
// Histórico: sessões (com filtro "ocultar canceladas") + compras.
import Link from "next/link";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { eur, formatDateTime, BOOKING_STATUS, PURCHASE_STATUS } from "@/lib/utils";
import { cancelBookingAction, rebookAction } from "./actions";
import { CalendarPlus, RefreshCcw, NotebookPen, Users, EyeOff, Eye, ChevronDown } from "lucide-react";
import { NoteEditor } from "@/components/note-editor";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { getMyNotesMapForBookings } from "@/lib/notes";
import { signBookingIcs } from "@/lib/calendar-token";

export default async function HistoricoPage(
  props: {
    searchParams: Promise<{ tab?: string; ok?: string; f?: string; c?: string; hc?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const tab = searchParams.tab === "compras" ? "compras" : "sessoes";
  const sessFilter: "todas" | "futuras" | "passadas" =
    searchParams.f === "futuras" || searchParams.f === "passadas" ? searchParams.f : "todas";
  const hideCancelled = searchParams.hc === "1";

  // Constrói hrefs preservando o estado dos filtros de sessões (f + hc).
  const sessHref = (f: "todas" | "futuras" | "passadas") => {
    const p = new URLSearchParams();
    if (f !== "todas") p.set("f", f);
    if (hideCancelled) p.set("hc", "1");
    const qs = p.toString();
    return `/app/historico${qs ? `?${qs}` : ""}`;
  };
  const toggleHideCancelledHref = (() => {
    const p = new URLSearchParams();
    if (sessFilter !== "todas") p.set("f", sessFilter);
    if (!hideCancelled) p.set("hc", "1");
    const qs = p.toString();
    return `/app/historico${qs ? `?${qs}` : ""}`;
  })();

  const compFilter: "todas" | "confirmadas" | "rejeitadas" =
    searchParams.c === "confirmadas" || searchParams.c === "rejeitadas" ? searchParams.c : "todas";
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Histórico</h1>
        <p className="text-sm text-ink-500">Sessões e compras.</p>
      </div>

      {searchParams.ok === "pending" ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A tua marcação está pendente — o trainer vai aceitá-la em breve.
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

      <div className="flex gap-1 rounded-xl border border-ink-900/[0.07] bg-bone-100 p-1 dark:border-white/10 dark:bg-ink-900">
        <Link
          href="/app/historico"
          className={
            tab === "sessoes"
              ? "flex-1 rounded-lg bg-white px-2 py-1.5 text-center text-[12.5px] font-semibold text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50"
              : "flex-1 rounded-lg px-2 py-1.5 text-center text-[12.5px] font-medium text-ink-500 transition hover:text-ink-900 dark:hover:text-bone-50"
          }
        >
          Sessões
        </Link>
        <Link
          href="/app/historico?tab=compras"
          className={
            tab === "compras"
              ? "flex-1 rounded-lg bg-white px-2 py-1.5 text-center text-[12.5px] font-semibold text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50"
              : "flex-1 rounded-lg px-2 py-1.5 text-center text-[12.5px] font-medium text-ink-500 transition hover:text-ink-900 dark:hover:text-bone-50"
          }
        >
          Compras
        </Link>
      </div>

      {tab === "sessoes" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip label="Todas" href={sessHref("todas")} active={sessFilter === "todas"} />
          <FilterChip label="Futuras" href={sessHref("futuras")} active={sessFilter === "futuras"} />
          <FilterChip label="Passadas" href={sessHref("passadas")} active={sessFilter === "passadas"} />
          <Link
            href={toggleHideCancelledHref}
            className={`ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
              hideCancelled
                ? "border-ink-900 bg-ink-900 text-white dark:border-bone-50 dark:bg-bone-50 dark:text-ink-900"
                : "border-ink-900/15 text-ink-600 hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-100"
            }`}
          >
            {hideCancelled ? <Eye size={12} /> : <EyeOff size={12} />}
            {hideCancelled ? "Mostrar canceladas" : "Ocultar canceladas"}
          </Link>
        </div>
      )}

      {tab === "compras" && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="Todas" href="/app/historico?tab=compras" active={compFilter === "todas"} />
          <FilterChip label="Confirmadas" href="/app/historico?tab=compras&c=confirmadas" active={compFilter === "confirmadas"} />
          <FilterChip label="Rejeitadas" href="/app/historico?tab=compras&c=rejeitadas" active={compFilter === "rejeitadas"} />
        </div>
      )}

      {tab === "sessoes" ? <SessoesTab userId={user.id} filter={sessFilter} hideCancelled={hideCancelled} /> : <ComprasTab userId={user.id} filter={compFilter} />}
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

async function SessoesTab({ userId, filter, hideCancelled }: { userId: string; filter: "todas" | "futuras" | "passadas"; hideCancelled: boolean }) {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  let query = supabase
    .from("bookings")
    .select("id, starts_at, ends_at, session_type, status, partner_client_id")
    // DUO: inclui as sessões partilhadas em que sou o parceiro.
    .or(`client_id.eq.${userId},partner_client_id.eq.${userId}`);
  if (hideCancelled) query = query.neq("status", "cancelled");
  if (filter === "futuras") {
    query = query.gte("starts_at", nowIso).order("starts_at", { ascending: true });
  } else if (filter === "passadas") {
    query = query.lt("starts_at", nowIso).order("starts_at", { ascending: false });
  } else {
    query = query.order("starts_at", { ascending: false });
  }
  const { data: bookings } = await query.limit(50);

  if (!bookings || bookings.length === 0) {
    return (
      <div className="card p-5 text-center text-sm text-ink-500">
        {hideCancelled ? "Sem sessões para mostrar." : "Sem sessões ainda."}
      </div>
    );
  }

  const notesMap = await getMyNotesMapForBookings(bookings.map((b) => b.id));

  return (
    <ul className="space-y-2">
      {bookings.map((b) => {
        const isFuture = new Date(b.starts_at).getTime() > Date.now();
        const canModify = isFuture && (b.status === "booked" || b.status === "confirmed");

        const badge = (
          <div
            className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl ${
              b.status === "cancelled"
                ? "bg-ink-900/[0.06] text-ink-400 dark:bg-white/10 dark:text-white/40"
                : b.status === "no_show"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            }`}
          >
            <span className="text-[15px] font-bold leading-none">
              {new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit" }).format(new Date(b.starts_at))}
            </span>
            <span className="text-[8px] font-semibold uppercase">
              {new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", month: "short" }).format(new Date(b.starts_at)).replace(/\./g, "")}
            </span>
          </div>
        );

        const info = (
          <div className="min-w-0">
            <div className={`text-sm font-semibold ${b.status === "cancelled" ? "text-ink-400 line-through" : ""}`}>
              {formatDateTime(b.starts_at)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs capitalize text-ink-500">{b.session_type}</span>
              {b.partner_client_id && (
                <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-semibold text-gold-700 dark:bg-gold-400/15">
                  <Users size={10} /> Duo
                </span>
              )}
            </div>
          </div>
        );

        const actionButtons = canModify ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <a
              href={`/api/bookings/${b.id}/ics?t=${signBookingIcs(b.id)}`}
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
              <PendingSubmitButton
                className="btn-outline w-full text-xs text-red-700 hover:bg-red-50 border-red-200"
                pendingLabel="A cancelar…"
              >
                Cancelar
              </PendingSubmitButton>
            </form>
          </div>
        ) : null;

        const notesBlock = (
          <details className="border-t border-ink-900/5 pt-3">
            <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-600 hover:text-ink-900">
              <NotebookPen size={12} /> As minhas notas
            </summary>
            <div className="mt-2">
              <NoteEditor bookingId={b.id} initialBody={notesMap.get(b.id)?.body} compact sharedWithTrainer />
            </div>
          </details>
        );

        return (
          <li key={b.id}>
            <details className="card group overflow-hidden p-0">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  {badge}
                  {info}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusChip status={b.status} />
                  <ChevronDown size={16} className="text-ink-400 transition-transform group-open:rotate-180" />
                </div>
              </summary>
              <div className="space-y-3 border-t border-ink-900/[0.06] p-3 dark:border-white/[0.07]">
                {actionButtons}
                {notesBlock}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

async function ComprasTab({ userId, filter }: { userId: string; filter: "todas" | "confirmadas" | "rejeitadas" }) {
  const supabase = await createClient();
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
              <div className="font-display font-bold text-gold-600 dark:text-gold-400">{eur(p.amount_cents)}</div>
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
