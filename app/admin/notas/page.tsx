import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Sparkles, ArrowLeft, Search, ChevronRight } from "lucide-react";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { NoteEditor } from "@/components/note-editor";
import { GeneralNoteEditor } from "@/components/general-note-editor";
import { listMyNotes } from "@/lib/notes";
import { formatDateTime } from "@/lib/utils";

export default async function AdminNotasPage(
  props: {
    searchParams: Promise<{ client?: string; q?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // ── Vista de cliente específico ──────────────────────────────
  // PERF: aqui fazemos a query focada no cliente (com body completo).
  if (searchParams.client) {
    const cid = searchParams.client;
    const [clientItems, { data: profile }] = await Promise.all([
      listMyNotes({ clientId: cid, limit: 200, include: "full" }),
      supabase.from("profiles").select("full_name, email").eq("id", cid).single(),
    ]);
    const displayName = (profile as any)?.full_name ?? "Cliente";
    const displayEmail = (profile as any)?.email;

    return (
      <div className="space-y-5">
        <Link
          href="/admin/notas"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Todos os clientes
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{displayName}</h1>
            <p className="text-sm text-ink-500">
              {clientItems.length} {clientItems.length === 1 ? "nota" : "notas"}
              {displayEmail && ` · ${displayEmail}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/admin/notas/nova?client=${cid}`}
              className="btn-primary inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> Nova nota
            </Link>
            <Link
              href={`/admin/clientes/${cid}`}
              className="btn-outline inline-flex items-center gap-1.5"
            >
              Abrir ficha
            </Link>
          </div>
        </div>

        {clientItems.length === 0 ? (
          <div className="card p-5 text-center text-sm text-ink-500">
            Ainda sem notas para este cliente.
          </div>
        ) : (
          <ul className="space-y-2">
            {clientItems.map((n: any) => (
              <li key={n.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {n.booking_id ? (
                      <>
                        <div className="text-sm font-semibold">
                          {n.bookings?.starts_at ? formatDateTime(n.bookings.starts_at) : "—"}
                        </div>
                        <div className="text-xs text-ink-500 capitalize">
                          {n.bookings?.session_type ?? "sessão"}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="inline-flex items-center gap-1.5 text-sm font-semibold">
                          <Sparkles size={12} className="text-gold-600" /> Nota geral
                        </div>
                        <div className="text-xs text-ink-500">{formatDateTime(n.created_at)}</div>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-3 border-t border-ink-900/5 pt-3">
                  {n.booking_id ? (
                    <NoteEditor bookingId={n.booking_id} initialBody={n.body} compact />
                  ) : (
                    <GeneralNoteEditor noteId={n.id} initialBody={n.body} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Index: bolhas por cliente ────────────────────────────────
  // PERF: pedimos só metadados (sem `body`) — antes vinham até ~2.5 MB
  // de texto só para construir as bolhas.
  const notesMeta = await listMyNotes({ limit: 500, include: "meta" });
  const grouped = new Map<
    string,
    { name: string; email?: string; phone?: string; count: number; lastAt: string }
  >();
  for (const n of notesMeta as any[]) {
    const cid = n.bookings?.client_id ?? n.subject?.id ?? null;
    const name = n.bookings?.profiles?.full_name ?? n.subject?.full_name ?? "—";
    const email = n.subject?.email ?? n.bookings?.profiles?.email;
    const phone = n.subject?.phone ?? n.bookings?.profiles?.phone;
    if (!cid) continue;
    const at = n.updated_at ?? n.created_at;
    const existing = grouped.get(cid);
    if (!existing) {
      grouped.set(cid, { name, email, phone, count: 1, lastAt: at });
    } else {
      existing.count++;
      if (at > existing.lastAt) existing.lastAt = at;
    }
  }

  const q = (searchParams.q ?? "").trim().toLowerCase();
  // Procura agora por nome, email OU telefone — coerente com clientes
  // e pagamentos. Mostra no máximo 10 resultados.
  const entries = Array.from(grouped.entries())
    .filter(([_, g]) =>
      !q
        ? true
        : g.name.toLowerCase().includes(q) ||
          (g.email?.toLowerCase().includes(q) ?? false) ||
          (g.phone?.toLowerCase().includes(q) ?? false),
    )
    .sort((a, b) => (b[1].lastAt > a[1].lastAt ? 1 : -1))
    .slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Notas</h1>
          <p className="text-[12.5px] text-ink-500">As tuas notas privadas, por cliente</p>
        </div>
        <Link
          href="/admin/notas/nova"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink-900 px-3.5 py-2 text-[12.5px] font-medium text-bone-50 dark:bg-bone-50 dark:text-ink-900"
        >
          <Plus size={15} className="text-gold-400 dark:text-gold-600" /> Nova nota
        </Link>
      </div>

      <form method="get" className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Procurar cliente por nome, email…"
          className="input pl-9"
        />
      </form>

      {entries.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500">
          {q ? "Nenhum cliente encontrado." : "Sem notas ainda. Carrega em Nova nota para começar."}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <ul className="divide-y divide-ink-900/[0.06] dark:divide-white/[0.07]">
            {entries.map(([cid, g]) => (
              <li key={cid}>
                <Link
                  href={`/admin/notas?client=${cid}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-ink-900/[0.02] dark:hover:bg-white/[0.03]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink-900 dark:text-bone-50">{g.name}</div>
                    <div className="truncate text-[11.5px] text-ink-500">
                      {g.email ?? g.phone ?? ""}
                      {(g.email || g.phone) && " · "}
                      última {formatDateTime(g.lastAt).split(",")[0]}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#EBD98F] bg-[#FBF4DE] px-2 py-0.5 text-[11px] font-semibold text-[#8A6D12] dark:border-gold-400/30 dark:bg-gold-400/10 dark:text-gold-300">
                    {g.count}
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-ink-300 dark:text-white/25" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
