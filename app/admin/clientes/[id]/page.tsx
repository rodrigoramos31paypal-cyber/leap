import { notFound } from "next/navigation";
import Link from "next/link";
import { NotebookPen, Plus, EyeOff, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getClientCredits } from "@/lib/credits";
import { getDuoPartner } from "@/lib/duo";
import { eur, formatDateTime, BOOKING_STATUS, PURCHASE_STATUS } from "@/lib/utils";
import { NoteEditor } from "@/components/note-editor";
import { getMyNotesMapForBookings, getClientNotesMapForBookings } from "@/lib/notes";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { Pagination } from "@/components/pagination";
import { GrantPackForm } from "./grant-pack-form";
import { DuoLinkSection } from "./duo-link-section";
import { setClientBannedAction } from "./actions";
import { BlockPurchasesButton } from "./block-purchases-button";
import { DeleteClientSection } from "./delete-client-section";

const SESSIONS_PAGE_SIZE = 10;

export default async function ClientDetail(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; hc?: string; f?: string; page?: string }>;
}) {
  const params = await props.params;
  const { tab: tabParam, hc, f, page: pageParam } = await props.searchParams;
  const tab: "resumo" | "compras" | "sessoes" =
    tabParam === "compras" || tabParam === "sessoes" ? tabParam : "resumo";
  const hideCancelled = hc === "1";
  const sessFilter: "todas" | "futuras" | "passadas" =
    f === "futuras" || f === "passadas" ? f : "todas";
  const pageNum = Math.max(1, Math.floor(Number(pageParam)) || 1);
  const nowIso = new Date().toISOString();
  const supabase = await createClient();
  const { data: profile } = await (supabase as any)
    .from("profiles")
    .select("id, full_name, email, phone, banned")
    .eq("id", params.id)
    .single();
  if (!profile) {
    notFound();
  }
  const profileId = profile.id;
  const isDeleted = (profile.email ?? "").endsWith("@removido.invalid");

  // Hrefs das tabs.
  const tabHref = (t: "resumo" | "compras" | "sessoes") =>
    t === "resumo" ? `/admin/clientes/${profileId}` : `/admin/clientes/${profileId}?tab=${t}`;

  // Hrefs dos filtros de sessões (preservam tab=sessoes + f + hc). Mudar de
  // filtro/toggle volta sempre à página 1 (page é omitido).
  const sessHref = (target: "todas" | "futuras" | "passadas") => {
    const p = new URLSearchParams({ tab: "sessoes" });
    if (target !== "todas") p.set("f", target);
    if (hideCancelled) p.set("hc", "1");
    return `/admin/clientes/${profileId}?${p.toString()}`;
  };
  const toggleHideCancelledHref = (() => {
    const p = new URLSearchParams({ tab: "sessoes" });
    if (sessFilter !== "todas") p.set("f", sessFilter);
    if (!hideCancelled) p.set("hc", "1");
    return `/admin/clientes/${profileId}?${p.toString()}`;
  })();
  const sessExtraParams: Record<string, string> = { tab: "sessoes" };
  if (sessFilter !== "todas") sessExtraParams.f = sessFilter;
  if (hideCancelled) sessExtraParams.hc = "1";

  // Query das sessões — filtro futuras/passadas + ocultar canceladas +
  // paginação (10 por página, com contagem total para as setas).
  // DUO: inclui sessões partilhadas em que este cliente é o parceiro
  // (partner_client_id) — sem isto a sessão duo só aparecia no perfil
  // de quem fez a marcação, mesmo descontando sessão a ambos.
  let bookingsQuery = supabase
    .from("bookings")
    .select("id, starts_at, session_type, status", { count: "exact" })
    .or(`client_id.eq.${profileId},partner_client_id.eq.${profileId}`);
  if (hideCancelled) bookingsQuery = bookingsQuery.neq("status", "cancelled");
  if (sessFilter === "futuras") {
    bookingsQuery = bookingsQuery.gte("starts_at", nowIso).order("starts_at", { ascending: true });
  } else if (sessFilter === "passadas") {
    bookingsQuery = bookingsQuery.lt("starts_at", nowIso).order("starts_at", { ascending: false });
  } else {
    bookingsQuery = bookingsQuery.order("starts_at", { ascending: false });
  }
  const fromRow = (pageNum - 1) * SESSIONS_PAGE_SIZE;
  bookingsQuery = bookingsQuery.range(fromRow, fromRow + SESSIONS_PAGE_SIZE - 1);

  // PERF: cada tab só busca o que renderiza. Resumo = credits + packs + duo;
  // Compras = purchases; Sessões = bookings + notas.
  const [
    credits,
    { data: purchasesRaw },
    { data: bookingsRaw, count: bookingsCount },
  ] = await Promise.all([
    tab === "resumo" ? getClientCredits(profileId) : Promise.resolve(null),
    tab === "compras"
      ? supabase
          .from("purchases")
          .select("id, pack_snapshot, created_at, amount_cents, sessions_remaining, sessions_total, status")
          .eq("client_id", profileId)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null }),
    tab === "sessoes" ? bookingsQuery : Promise.resolve({ data: null, count: 0 }),
  ]);
  const purchases = (purchasesRaw ?? []) as any[];
  const bookings = (bookingsRaw ?? []) as any[];
  const bookingIds = bookings.map((b: any) => b.id);

  // Dados extra do Resumo (packs/duo) e das notas das sessões — só quando a
  // respectiva tab está activa.
  const [trainerIds, duoPartner] = await Promise.all([
    tab === "resumo" ? getAccessibleTrainerIds() : Promise.resolve([] as string[]),
    tab === "resumo" && !isDeleted ? getDuoPartner(profileId) : Promise.resolve(null),
  ]);
  const [{ data: packsRaw }, clientNotesMap, notesMap] = await Promise.all([
    tab === "resumo"
      ? supabase
          .from("packs")
          .select("id, name, session_type, sessions, price_cents, validity_days, trainer_id")
          .in("trainer_id", trainerIds.length > 0 ? trainerIds : [""])
          .eq("active", true)
          .order("session_type")
          .order("sort_order")
      : Promise.resolve({ data: null }),
    tab === "sessoes"
      ? getClientNotesMapForBookings(bookingIds, params.id)
      : Promise.resolve(new Map<string, any>()),
    tab === "sessoes"
      ? getMyNotesMapForBookings(bookingIds)
      : Promise.resolve(new Map<string, any>()),
  ]);
  const packs = (packsRaw ?? []) as any[];

  return (
    <div className="space-y-5">
      <Link href="/admin/clientes" className="text-sm text-ink-500 hover:text-ink-900">← Clientes</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{profile.full_name}</h1>
          <p className="text-sm text-ink-500">{profile.email}{profile.phone ? ` · ${profile.phone}` : ""}</p>
        </div>
        <Link
          href={`/admin/notas?client=${profileId}`}
          className="btn-outline inline-flex items-center gap-1.5 text-xs"
        >
          <NotebookPen size={12} /> Ver minhas notas deste cliente
        </Link>
      </div>

      <div className="flex gap-2 border-b border-ink-900/10">
        <TabLink href={tabHref("resumo")} active={tab === "resumo"} label="Resumo" />
        <TabLink href={tabHref("compras")} active={tab === "compras"} label="Compras" />
        <TabLink href={tabHref("sessoes")} active={tab === "sessoes"} label="Sessões" />
      </div>

      {tab === "resumo" && (
        <>
          {profile.banned && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              Compras bloqueadas — este cliente não consegue comprar packs.
            </div>
          )}
          {!isDeleted && (
            // flex-nowrap + min-w-0 nos filhos mantém os dois botões na
            // MESMA linha mesmo em mobile estreito. Labels encurtados
            // ("Bloquear compras" / "Apagar conta") para caberem sem quebrar.
            <div className="flex flex-nowrap items-start gap-2">
              <form action={setClientBannedAction} className="min-w-0 flex-1">
                <input type="hidden" name="clientId" value={profileId} />
                <input type="hidden" name="banned" value={profile.banned ? "false" : "true"} />
                <BlockPurchasesButton banned={!!profile.banned} />
              </form>
              <div className="min-w-0 flex-1">
                <DeleteClientSection clientId={profileId} />
              </div>
            </div>
          )}

          <div className="card p-4">
            <div className="text-xs uppercase tracking-wide text-ink-500">Total sessões disponíveis</div>
            <div className="mt-1 font-display text-2xl font-bold">{credits?.total ?? 0}</div>
            {/* DUO: divisão por tipo. Em par duo o saldo PT Dupla é
                partilhado (migration 0113) — o sufixo "partilhado" deixa
                claro que esse número espelha as duas contas. */}
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-ink-900/5 pt-3 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-ink-500">PT Individual</div>
                <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{credits?.individual ?? 0}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-ink-500">
                  PT Dupla{duoPartner ? " · partilhado" : ""}
                </div>
                <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{credits?.dupla ?? 0}</div>
              </div>
            </div>
          </div>

          {isDeleted ? (
            <div className="card p-4 text-sm text-ink-500">
              Esta conta foi removida (RGPD). Não é possível atribuir sessões.
            </div>
          ) : (
            <details className="card p-5">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
                <Plus size={16} /> Gerir sessões
              </summary>
              <GrantPackForm
                clientId={profileId}
                packs={packs.map((p) => ({ id: p.id, name: p.name, price_cents: p.price_cents }))}
                hasPartner={!!duoPartner}
              />
            </details>
          )}

          {!isDeleted && <DuoLinkSection clientId={profileId} partner={duoPartner} />}
        </>
      )}

      {tab === "compras" && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Compras recentes</h2>
          {purchases.length === 0 ? (
            <div className="card p-4 text-sm text-ink-500">Sem compras.</div>
          ) : (
            <ul className="space-y-2">
              {purchases.map((p) => (
                <li key={p.id} className="card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{(p.pack_snapshot as any).name}</span>
                        <span className={`chip-${purchaseStatusColor(p.status)}`}>
                          {(PURCHASE_STATUS as any)[p.status] ?? p.status}
                        </span>
                      </div>
                      <div className="text-xs text-ink-500">{formatDateTime(p.created_at)}</div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-bold">{eur(p.amount_cents)}</div>
                      {p.status === "confirmed" && (
                        <div className="text-xs text-ink-500">{p.sessions_remaining}/{p.sessions_total}</div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "sessoes" && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Sessões recentes</h2>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <SessFilterChip label="Todas" href={sessHref("todas")} active={sessFilter === "todas"} />
            <SessFilterChip label="Futuras" href={sessHref("futuras")} active={sessFilter === "futuras"} />
            <SessFilterChip label="Passadas" href={sessHref("passadas")} active={sessFilter === "passadas"} />
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
          {bookings.length === 0 ? (
            <div className="card p-4 text-sm text-ink-500">
              {hideCancelled || sessFilter !== "todas" ? "Sem sessões para mostrar." : "Sem sessões."}
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {bookings.map((b) => (
                  <li key={b.id} className="card p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold">{formatDateTime(b.starts_at)}</div>
                        <div className="text-xs text-ink-500 capitalize">{b.session_type}</div>
                      </div>
                      <span className={
                        b.status === "confirmed" ? "chip-ok" :
                        b.status === "no_show" ? "chip-danger" :
                        b.status === "cancelled" ? "chip-mute" : "chip-gold"
                      }>
                        {(BOOKING_STATUS as any)[b.status] ?? b.status}
                      </span>
                    </div>
                    {clientNotesMap.get(b.id)?.body && (
                      <div className="mt-3 rounded-lg border border-gold-200 bg-gold-50 p-3 dark:border-gold-400/30 dark:bg-gold-400/10">
                        <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-gold-700">
                          <NotebookPen size={12} /> Nota do cliente
                        </div>
                        <p className="whitespace-pre-wrap text-xs text-ink-700">{clientNotesMap.get(b.id)?.body}</p>
                      </div>
                    )}
                    <details className="mt-3 border-t border-ink-900/5 pt-3">
                      <summary className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-semibold text-ink-600 hover:text-ink-900">
                        <NotebookPen size={12} /> Minhas notas{notesMap.get(b.id) ? " · ✓" : ""}
                      </summary>
                      <div className="mt-2">
                        <NoteEditor bookingId={b.id} initialBody={notesMap.get(b.id)?.body} compact />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
              <Pagination
                page={pageNum}
                pageSize={SESSIONS_PAGE_SIZE}
                total={bookingsCount ?? 0}
                baseHref={`/admin/clientes/${profileId}`}
                extraParams={sessExtraParams}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}

function purchaseStatusColor(s: string): "ok" | "danger" | "warn" {
  if (s === "confirmed") return "ok";
  if (s === "rejected" || s === "cancelled") return "danger";
  return "warn";
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active ? "border-ink-900 text-ink-900 dark:border-bone-50 dark:text-bone-50" : "border-transparent text-ink-500"
      }`}
    >
      {label}
    </Link>
  );
}

function SessFilterChip({ label, href, active }: { label: string; href: string; active: boolean }) {
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
