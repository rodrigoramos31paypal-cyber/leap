import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds, getClientIdsInScope } from "@/lib/trainer";
import { getRecentSessionsForClient } from "@/lib/notes";
import { createGeneralNoteAction, createBookingNoteAction } from "@/app/api/notes/actions";
import { formatDateTime, BOOKING_STATUS } from "@/lib/utils";
import { ArrowLeft, Search, NotebookPen, Sparkles } from "lucide-react";

export default async function NewAdminNotePage(
  props: {
    searchParams: Promise<{ q?: string; client?: string; booking?: string; general?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // PERF: clientIdsInScope precisa de trainerIds, mas auth.getUser
  // já está cached em @/lib/trainer — as queries internas correm
  // só uma vez por request. Mantemos o await sequencial porque há
  // dependência real entre os dois.
  const trainerIds = await getAccessibleTrainerIds();
  const clientIdsInScope = await getClientIdsInScope(trainerIds);

  // Step 3a: editor para sessão escolhida
  if (searchParams.client && searchParams.booking) {
    // PERF: profile + booking em paralelo
    const [{ data: profile }, { data: booking }] = await Promise.all([
      supabase.from("profiles").select("full_name, email").eq("id", searchParams.client).single(),
      supabase.from("bookings").select("id, starts_at, session_type, status").eq("id", searchParams.booking).single(),
    ]);
    return (
      <EditorShell title={`Nota · ${profile?.full_name ?? "Cliente"}`}>
        <p className="text-xs text-ink-500">
          Sessão: {booking ? `${formatDateTime(booking.starts_at)} · ${booking.session_type}` : "—"}
        </p>
        {/* H4: cast — action retorna { error? } | void, form tipa Promise<void>. */}
        <form action={createBookingNoteAction as (fd: FormData) => Promise<void>} className="mt-4 space-y-3">
          <input type="hidden" name="bookingId" value={searchParams.booking} />
          <input type="hidden" name="redirectTo" value="/admin/notas" />
          <textarea
            name="body"
            required
            rows={6}
            maxLength={5000}
            className="input"
            placeholder="Escreve aqui a nota desta sessão…"
          />
          <p className="text-[10px] text-ink-500">Só tu vês esta nota.</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Guardar nota</button>
            <Link href={`/admin/notas/nova?client=${searchParams.client}`} className="btn-outline">Voltar</Link>
          </div>
        </form>
      </EditorShell>
    );
  }

  // Step 3b: editor para nota geral
  if (searchParams.client && searchParams.general) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", searchParams.client)
      .single();
    return (
      <EditorShell title={`Nota geral · ${profile?.full_name ?? "Cliente"}`}>
        <p className="text-xs text-ink-500">Sem sessão associada. Vai aparecer no diário do cliente.</p>
        {/* H4: cast — action retorna { error? } | void, form tipa Promise<void>. */}
        <form action={createGeneralNoteAction as (fd: FormData) => Promise<void>} className="mt-4 space-y-3">
          <input type="hidden" name="subjectId" value={searchParams.client} />
          <input type="hidden" name="redirectTo" value="/admin/notas" />
          <textarea
            name="body"
            required
            rows={6}
            maxLength={5000}
            className="input"
            placeholder="Escreve a nota geral sobre este cliente…"
          />
          <p className="text-[10px] text-ink-500">Só tu vês esta nota.</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Guardar nota</button>
            <Link href={`/admin/notas/nova?client=${searchParams.client}`} className="btn-outline">Voltar</Link>
          </div>
        </form>
      </EditorShell>
    );
  }

  // Step 2: cliente escolhido → escolhe sessão ou nota geral
  if (searchParams.client) {
    // PERF: profile + recentes em paralelo
    const [{ data: profile }, recent] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, phone").eq("id", searchParams.client).single(),
      getRecentSessionsForClient(searchParams.client, trainerIds, 3),
    ]);
    return (
      <EditorShell title="Nova nota">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Cliente</div>
          <div className="mt-1 text-sm font-semibold">{profile?.full_name}</div>
          <div className="text-xs text-ink-500">{profile?.email}{profile?.phone ? ` · ${profile.phone}` : ""}</div>
          <Link href="/admin/notas/nova" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gold-600">
            <ArrowLeft size={12} /> Mudar cliente
          </Link>
        </div>

        <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-500">A nota é sobre…</h2>
        <ul className="mt-2 space-y-2">
          <li>
            <Link
              href={`/admin/notas/nova?client=${profile?.id}&general=1`}
              className="card flex items-start gap-3 p-4 hover:border-gold-400"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-700">
                <Sparkles size={16} />
              </div>
              <div>
                <div className="text-sm font-semibold">Nota geral (sem sessão)</div>
                <div className="text-xs text-ink-500">Não fica atribuída a nenhuma sessão. Útil para anamnese, objetivos, alertas.</div>
              </div>
            </Link>
          </li>
          {recent.length === 0 ? (
            <li className="card p-4 text-sm text-ink-500">Sem sessões recentes deste cliente.</li>
          ) : (
            recent.map((b: any) => (
              <li key={b.id}>
                <Link
                  href={`/admin/notas/nova?client=${profile?.id}&booking=${b.id}`}
                  className="card flex items-start gap-3 p-4 hover:border-gold-400"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-700">
                    <NotebookPen size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{formatDateTime(b.starts_at)}</div>
                    <div className="text-xs text-ink-500 capitalize">
                      {b.session_type} ·{" "}
                      <span>{(BOOKING_STATUS as any)[b.status] ?? b.status}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))
          )}
        </ul>
      </EditorShell>
    );
  }

  // Step 1: procura cliente
  const q = (searchParams.q ?? "").trim();
  let clientsList: any[] = [];
  if (clientIdsInScope.length > 0) {
    let query = supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .eq("role", "client")
      .in("id", clientIdsInScope)
      .order("full_name")
      .limit(15);
    if (q) {
      query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
    }
    const { data } = await query;
    clientsList = data ?? [];
  }

  return (
    <EditorShell title="Nova nota">
      <p className="text-xs text-ink-500">Procura o cliente sobre quem queres anotar.</p>
      <form method="get" className="mt-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Nome, email ou telefone…"
            className="input pl-9"
          />
        </div>
      </form>

      {clientsList.length === 0 ? (
        <div className="mt-4 card p-5 text-center text-sm text-ink-500">
          {q ? "Nenhum cliente encontrado." : "Começa a escrever para procurar."}
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {clientsList.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/notas/nova?client=${c.id}`}
                className="card flex items-center justify-between p-4 hover:border-gold-400"
              >
                <div>
                  <div className="text-sm font-semibold">{c.full_name}</div>
                  <div className="text-xs text-ink-500">{c.email}{c.phone ? ` · ${c.phone}` : ""}</div>
                </div>
                <span className="text-xs font-medium text-gold-600">Escolher →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </EditorShell>
  );
}

function EditorShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <Link href="/admin/notas" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={14} /> Notas
      </Link>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
      </div>
      <div>{children}</div>
    </div>
  );
}
