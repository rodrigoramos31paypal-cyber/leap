import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getActiveTrainersPublic } from "@/lib/trainer";
import { getRecentSessionsBetween } from "@/lib/notes";
import { createGeneralNoteAction, createBookingNoteAction } from "@/app/api/notes/actions";
import { formatDateTime, BOOKING_STATUS } from "@/lib/utils";
import { ArrowLeft, NotebookPen, Sparkles } from "lucide-react";

export default async function NewClientNotePage({
  searchParams,
}: {
  searchParams: { trainer?: string; booking?: string; general?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  const actives = await getActiveTrainersPublic();

  // se só há 1 trainer activo e nenhuma escolha, salta para escolha de sessão
  const onlyOne = actives.length === 1 ? actives[0] : null;
  const effectiveTrainerId = searchParams.trainer ?? onlyOne?.id;
  const trainer = effectiveTrainerId
    ? actives.find((t) => t.id === effectiveTrainerId)
    : null;

  // Step 3a: editor para sessão escolhida
  if (trainer && searchParams.booking) {
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, starts_at, session_type, status")
      .eq("id", searchParams.booking)
      .eq("client_id", user.id)
      .maybeSingle();
    return (
      <EditorShell title={`Nota · com ${trainer.full_name}`}>
        <p className="text-xs text-ink-500">
          Sessão: {booking ? `${formatDateTime(booking.starts_at)} · ${booking.session_type}` : "—"}
        </p>
        <form action={createBookingNoteAction} className="mt-4 space-y-3">
          <input type="hidden" name="bookingId" value={searchParams.booking} />
          <input type="hidden" name="redirectTo" value="/app/notas" />
          <textarea
            name="body"
            required
            rows={6}
            maxLength={5000}
            className="input"
            placeholder="Como te sentiste? Energia, dores, foco…"
          />
          <p className="text-[10px] text-ink-500">Só tu vês esta nota. O treinador não tem acesso.</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Guardar nota</button>
            <Link href={`/app/notas/nova?trainer=${trainer.id}`} className="btn-outline">Voltar</Link>
          </div>
        </form>
      </EditorShell>
    );
  }

  // Step 3b: editor para nota geral
  if (trainer && searchParams.general) {
    return (
      <EditorShell title={`Nota geral · com ${trainer.full_name}`}>
        <p className="text-xs text-ink-500">Sem sessão associada. Útil para objetivos, lesões antigas, evolução.</p>
        <form action={createGeneralNoteAction} className="mt-4 space-y-3">
          <input type="hidden" name="subjectId" value={trainer.profile_id} />
          <input type="hidden" name="redirectTo" value="/app/notas" />
          <textarea
            name="body"
            required
            rows={6}
            maxLength={5000}
            className="input"
            placeholder="Escreve a tua nota livre…"
          />
          <p className="text-[10px] text-ink-500">Só tu vês esta nota. O treinador não tem acesso.</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Guardar nota</button>
            <Link href={`/app/notas/nova?trainer=${trainer.id}`} className="btn-outline">Voltar</Link>
          </div>
        </form>
      </EditorShell>
    );
  }

  // Step 2: trainer escolhido → escolhe sessão ou geral
  if (trainer) {
    const recent = await getRecentSessionsBetween(user.id, trainer.id, 3);
    return (
      <EditorShell title="Nova nota">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Treinador</div>
          <div className="mt-1 text-sm font-semibold">{trainer.full_name}</div>
          {actives.length > 1 && (
            <Link href="/app/notas/nova" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gold-600">
              <ArrowLeft size={12} /> Mudar treinador
            </Link>
          )}
        </div>

        <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-500">A nota é sobre…</h2>
        <ul className="mt-2 space-y-2">
          <li>
            <Link
              href={`/app/notas/nova?trainer=${trainer.id}&general=1`}
              className="card flex items-start gap-3 p-4 hover:border-gold-400"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-700">
                <Sparkles size={16} />
              </div>
              <div>
                <div className="text-sm font-semibold">Nota geral (sem sessão)</div>
                <div className="text-xs text-ink-500">Objetivos, dores antigas, evolução. Não fica ligada a sessão.</div>
              </div>
            </Link>
          </li>
          {recent.length === 0 ? (
            <li className="card p-4 text-sm text-ink-500">Sem sessões recentes com este treinador.</li>
          ) : (
            recent.map((b: any) => (
              <li key={b.id}>
                <Link
                  href={`/app/notas/nova?trainer=${trainer.id}&booking=${b.id}`}
                  className="card flex items-start gap-3 p-4 hover:border-gold-400"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-700">
                    <NotebookPen size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{formatDateTime(b.starts_at)}</div>
                    <div className="text-xs text-ink-500 capitalize">
                      {b.session_type} · {(BOOKING_STATUS as any)[b.status] ?? b.status}
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

  // Step 1: escolhe trainer
  return (
    <EditorShell title="Escolhe o treinador">
      <p className="text-xs text-ink-500">A nota fica organizada por treinador.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {actives.map((t) => (
          <li key={t.id}>
            <Link
              href={`/app/notas/nova?trainer=${t.id}`}
              className="card flex h-full items-start gap-4 p-5 transition hover:border-gold-400 hover:shadow-glow"
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink-900 text-gold-400 font-display text-xl font-black">
                {t.full_name?.[0]?.toUpperCase() ?? "T"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-base font-bold tracking-tight">{t.full_name || "Treinador"}</div>
                <div className="text-xs text-ink-500">@{t.slug}</div>
                {t.bio && <p className="mt-2 line-clamp-2 text-xs text-ink-600">{t.bio}</p>}
              </div>
            </Link>
          </li>
        ))}
        {actives.length === 0 && (
          <li className="card p-5 text-sm text-ink-500">Sem treinadores activos.</li>
        )}
      </ul>
    </EditorShell>
  );
}

function EditorShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <Link href="/app/notas" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft size={14} /> Notas
      </Link>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
      </div>
      <div>{children}</div>
    </div>
  );
}
