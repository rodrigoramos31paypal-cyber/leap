import { notFound } from "next/navigation";
import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getClientCredits } from "@/lib/credits";
import { eur, formatDateTime, BOOKING_STATUS } from "@/lib/utils";
import { NoteEditor } from "@/components/note-editor";
import { getMyNotesMapForBookings } from "@/lib/notes";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { GrantPackForm } from "./grant-pack-form";
import { setClientBannedAction } from "./actions";

export default async function ClientDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: profile } = await (supabase as any)
    .from("profiles")
    .select("id, full_name, email, phone, banned")
    .eq("id", params.id)
    .single();
  if (!profile) {
    notFound();
  }
  const profileId = profile.id;
  // Conta removida (RGPD): email anonimizado → bloqueia atribuições.
  const isDeleted = (profile.email ?? "").endsWith("@removido.invalid");

  // PERF: estas 4 chamadas sao independentes — antes corriam em serie
  // (4 round-trips sequenciais). Agora em paralelo (1 vaga).
  const [trainerIds, credits, { data: purchasesRaw }, { data: bookingsRaw }] =
    await Promise.all([
      getAccessibleTrainerIds(),
      getClientCredits(profileId),
      supabase
        .from("purchases")
        .select("*")
        .eq("client_id", profileId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("bookings")
        .select("*")
        .eq("client_id", profileId)
        .order("starts_at", { ascending: false })
        .limit(20),
    ]);
  const purchases = (purchasesRaw ?? []) as any[];
  const bookings = (bookingsRaw ?? []) as any[];

  // 2a vaga: packs depende de trainerIds; notesMap depende de bookings.
  // Independentes entre si — corremos em paralelo.
  const [{ data: packsRaw }, notesMap] = await Promise.all([
    supabase
      .from("packs")
      .select("id, name, session_type, sessions, price_cents, validity_days, trainer_id")
      .in("trainer_id", trainerIds.length > 0 ? trainerIds : [""])
      .eq("active", true)
      .order("session_type")
      .order("sort_order"),
    getMyNotesMapForBookings(bookings.map((b) => b.id)),
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

      {/* Suspensão de conta — bloqueia a compra de packs (qualquer método). */}
      {profile.banned && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          Conta suspensa — este cliente não consegue comprar packs.
        </div>
      )}
      {!isDeleted && (
        <form action={setClientBannedAction}>
          <input type="hidden" name="clientId" value={profileId} />
          <input type="hidden" name="banned" value={profile.banned ? "false" : "true"} />
          <button
            className={
              profile.banned
                ? "btn-primary text-xs"
                : "btn-outline border-red-200 text-xs text-red-700 hover:bg-red-50"
            }
          >
            {profile.banned ? "Reativar conta" : "Suspender conta (bloquear compras)"}
          </button>
        </form>
      )}

      {/* Dupla escondida — mostramos apenas o total. */}
      <div className="grid gap-3 sm:grid-cols-1">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Total sessões disponíveis</div>
          <div className="mt-1 font-display text-2xl font-bold">{credits.total}</div>
        </div>
      </div>

      {/* Atribuir sessões manualmente — sem o cliente passar pelo site */}
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
          />
        </details>
      )}

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
                    <div className="text-sm font-semibold">{(p.pack_snapshot as any).name}</div>
                    <div className="text-xs text-ink-500">{formatDateTime(p.created_at)}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-bold">{eur(p.amount_cents)}</div>
                    <div className="text-xs text-ink-500">{p.sessions_remaining}/{p.sessions_total}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Sessões recentes</h2>
        {bookings.length === 0 ? (
          <div className="card p-4 text-sm text-ink-500">Sem sessões.</div>
        ) : (
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
        )}
      </section>
    </div>
  );
}
