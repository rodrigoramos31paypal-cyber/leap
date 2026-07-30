import { notFound } from "next/navigation";
import Link from "next/link";
import { NotebookPen, Plus, EyeOff, Eye, Cake } from "lucide-react";
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
import { LateCancelReview } from "./late-cancel-review";

const SESSIONS_PAGE_SIZE = 10;

// Data de nascimento: "YYYY-MM-DD" → "DD/MM/YYYY" + idade actual.
function formatDob(dob: string): string {
  const [y, m, d] = dob.split("-");
  return `${d}/${m}/${y}`;
}
function ageFromDob(dob: string): number | null {
  const [y, m, d] = dob.split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export default async function ClientDetail(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; hc?: string; f?: string; page?: string; review?: string }>;
}) {
  const params = await props.params;
  const { tab: tabParam, hc, f, page: pageParam, review: reviewParam } = await props.searchParams;
  const tab: "resumo" | "compras" | "sessoes" =
    tabParam === "compras" || tabParam === "sessoes" ? tabParam : "resumo";
  const hideCancelled = hc === "1";
  const pageNum = Math.max(1, Math.floor(Number(pageParam)) || 1);
  const nowIso = new Date().toISOString();
  const supabase = await createClient();

  // Deep-link da notificação de cancelamento tardio (?review=<booking>): sem
  // filtro explícito, escolhemos futuras/passadas conforme a sessão a rever
  // ainda estar no futuro — garante que ela aparece na lista mostrada.
  let reviewFilter: "futuras" | "passadas" | null = null;
  if (reviewParam && !f) {
    const { data: reviewBooking } = await supabase
      .from("bookings")
      .select("starts_at")
      .eq("id", reviewParam)
      .maybeSingle();
    if (reviewBooking?.starts_at) {
      reviewFilter = reviewBooking.starts_at >= nowIso ? "futuras" : "passadas";
    }
  }
  const sessFilter: "todas" | "futuras" | "passadas" =
    f === "futuras" || f === "passadas" ? f : reviewFilter ?? "todas";
  const { data: profile } = await (supabase as any)
    .from("profiles")
    .select("id, full_name, email, phone, banned, date_of_birth")
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
    .select("id, starts_at, session_type, status, late_cancel_review", { count: "exact" })
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
    // Premium: o saldo aparece no cabeçalho em qualquer tab → busca sempre.
    getClientCredits(profileId),
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.6rem] font-bold leading-tight tracking-tight">{profile.full_name}</h1>
          <p className="truncate text-[12.5px] text-ink-500">
            {profile.email}
            {profile.phone ? ` · ${profile.phone}` : ""}
          </p>
          {profile.date_of_birth && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-ink-900/10 bg-white px-3 py-1 text-[13px] text-ink-600 dark:border-white/10 dark:bg-white/5">
              <Cake size={14} className="text-pink-600" />
              Nascimento:{" "}
              <strong className="font-semibold text-ink-900 dark:text-bone-50">
                {formatDob(profile.date_of_birth)}
              </strong>
              {ageFromDob(profile.date_of_birth) != null && (
                <span className="text-ink-400">({ageFromDob(profile.date_of_birth)} anos)</span>
              )}
            </div>
          )}
        </div>
        <BalanceChip total={credits?.total ?? 0} />
      </div>

      <div className="flex gap-1 rounded-xl border border-ink-900/[0.07] bg-bone-100 p-1 dark:border-white/10 dark:bg-ink-900">
        <SegTab href={tabHref("resumo")} active={tab === "resumo"} label="Resumo" />
        <SegTab href={tabHref("compras")} active={tab === "compras"} label="Compras" />
        <SegTab href={tabHref("sessoes")} active={tab === "sessoes"} label="Sessões" />
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

          <div className="rounded-2xl border border-[#EBD98F] bg-[#FBF4DE] p-4 dark:border-gold-400/30 dark:bg-gold-400/10">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8A6D12] dark:text-gold-300">
              Sessões disponíveis
            </div>
            <div className="mt-1 font-display text-[2.2rem] font-bold leading-none tabular-nums text-[#3d3100] dark:text-gold-100">
              {credits?.total ?? 0}
            </div>
            {/* DUO: divisão por tipo. Em par duo o saldo PT Dupla é
                partilhado (migration 0113) — o sufixo "partilhado" deixa
                claro que esse número espelha as duas contas. */}
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[#EBD98F] pt-3 dark:border-gold-400/20">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9a7d22] dark:text-gold-300/70">PT Individual</div>
                <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-[#3d3100] dark:text-gold-100">{credits?.individual ?? 0}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9a7d22] dark:text-gold-300/70">
                  PT Dupla{duoPartner ? " · partilhado" : ""}
                </div>
                <div className="mt-0.5 font-display text-lg font-bold tabular-nums text-[#3d3100] dark:text-gold-100">{credits?.dupla ?? 0}</div>
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

          <div className="pt-1 text-center">
            <Link
              href={`/admin/notas?client=${profileId}`}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-gold-600 hover:text-gold-700 dark:text-gold-400"
            >
              <NotebookPen size={13} /> Ver as minhas notas deste cliente
            </Link>
          </div>
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
                      <div className="flex flex-col items-end gap-1">
                        <span className={
                          b.status === "confirmed" ? "chip-ok" :
                          b.status === "no_show" ? "chip-danger" :
                          b.status === "cancelled" ? "chip-mute" : "chip-gold"
                        }>
                          {(BOOKING_STATUS as any)[b.status] ?? b.status}
                        </span>
                        {b.status === "cancelled" && b.late_cancel_review && (
                          <LateCancelReview
                            bookingId={b.id}
                            clientId={profileId}
                            status={b.late_cancel_review}
                            whenLabel={formatDateTime(b.starts_at)}
                            autoOpen={reviewParam === b.id}
                          />
                        )}
                      </div>
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

function SegTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "flex-1 rounded-lg bg-white px-2 py-1.5 text-center text-[12px] font-semibold text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50"
          : "flex-1 rounded-lg px-2 py-1.5 text-center text-[12px] font-medium text-ink-500 transition hover:text-ink-900 dark:hover:text-bone-50"
      }
    >
      {label}
    </Link>
  );
}

function BalanceChip({ total }: { total: number }) {
  if (total > 0) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {total} {total === 1 ? "sessão" : "sessões"}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-[10.5px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Sem sessões
    </span>
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
