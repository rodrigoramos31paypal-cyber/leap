import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { NoteEditor } from "@/components/note-editor";
import { GeneralNoteEditor } from "@/components/general-note-editor";
import { listMyNotes } from "@/lib/notes";
import { formatDateTime } from "@/lib/utils";

export default async function ClientNotasPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  const notes = await listMyNotes({ clientId: user.id, limit: 100 });

  return (
    <div className="space-y-4">
      <BackLink />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">As minhas notas</h1>
          <p className="text-sm text-ink-500">Diário das tuas sessões. Só tu lês.</p>
        </div>
        <Link
          href="/app/notas/nova"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink-900 px-3.5 py-2 text-[12.5px] font-medium text-bone-50 dark:bg-bone-50 dark:text-ink-900"
        >
          <Plus size={15} className="text-gold-400 dark:text-gold-600" /> Nova nota
        </Link>
      </div>

      {notes.length === 0 ? (
        <div className="card p-5 text-center text-sm text-ink-500">
          Ainda não tens notas. Carrega em{" "}
          <Link href="/app/notas/nova" className="font-semibold text-gold-600">
            Adicionar nota
          </Link>{" "}
          para começar.
        </div>
      ) : (
        <ul className="space-y-3">
          {notes.map((n: any) => (
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
                      <div className="text-xs text-ink-500">
                        {n.subject?.full_name ? `Sobre ${n.subject.full_name}` : "Sem destinatário"} ·{" "}
                        {formatDateTime(n.created_at)}
                      </div>
                    </>
                  )}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-ink-400">
                  editada {formatDateTime(n.updated_at).split(",")[0]}
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
