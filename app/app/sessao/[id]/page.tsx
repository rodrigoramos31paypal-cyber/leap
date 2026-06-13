import { redirect, notFound } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { formatDateTime, BOOKING_STATUS } from "@/lib/utils";
import { cancelBookingAction, rebookAction } from "@/app/app/historico/actions";
import { CalendarPlus, RefreshCcw, X, NotebookPen, ChevronRight } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { NoteEditor } from "@/components/note-editor";
import { getMyNoteForBooking } from "@/lib/notes";

// Página de uma sessão específica (cliente). Opções: adicionar ao
// calendário, reagendar, cancelar e as minhas notas. Reaproveita as
// mesmas actions/componentes do histórico ("Ver tudo").
export default async function SessaoPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("id, starts_at, session_type, status, client_id, trainer_id")
    .eq("id", params.id)
    .eq("client_id", user.id)
    .maybeSingle();
  if (!b) notFound();

  const note = await getMyNoteForBooking(b.id);
  const isFuture = new Date(b.starts_at).getTime() > Date.now();
  const canModify = isFuture && (b.status === "booked" || b.status === "confirmed");

  // Janela de cancelamento é por trainer (default 12h). Mostramos o
  // valor real no botão para não desalinhar com a regra do servidor.
  const { data: trainerSettings } = await supabase
    .from("trainer_settings")
    .select("cancellation_window_hours")
    .eq("trainer_id", b.trainer_id)
    .maybeSingle();
  const cancelWindowHours = trainerSettings?.cancellation_window_hours ?? 12;

  const chipCls: Record<string, string> = {
    booked: "chip-gold",
    confirmed: "chip-ok",
    cancelled: "chip-mute",
    no_show: "chip-danger",
  };

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold">{formatDateTime(b.starts_at)}</div>
            <div className="text-xs text-ink-500 capitalize">Sessão {b.session_type}</div>
          </div>
          <span className={chipCls[b.status] ?? "chip-mute"}>
            {(BOOKING_STATUS as any)[b.status] ?? b.status}
          </span>
        </div>
      </div>

      {canModify ? (
        <div className="space-y-2">
          <a
            href={`/api/bookings/${b.id}/ics`}
            className="card flex items-center gap-3 p-4 hover:border-gold-400"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-700">
              <CalendarPlus size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Adicionar ao calendário</div>
              <div className="text-xs text-ink-500">Guarda esta sessão no teu calendário.</div>
            </div>
            <ChevronRight size={16} className="shrink-0 text-ink-500" />
          </a>

          <form action={rebookAction}>
            <input type="hidden" name="bookingId" value={b.id} />
            <button className="card flex w-full items-center gap-3 p-4 text-left hover:border-gold-400">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-700">
                <RefreshCcw size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Reagendar</div>
                <div className="text-xs text-ink-500">
                  Escolhe um novo horário — só confirmas no fim, sem perderes esta sessão.
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-ink-500" />
            </button>
          </form>

          <form action={cancelBookingAction}>
            <input type="hidden" name="bookingId" value={b.id} />
            <button className="card flex w-full items-center gap-3 p-4 text-left hover:border-red-300">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600">
                <X size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-red-700">Cancelar sessão</div>
                <div className="text-xs text-ink-500">
                  Cancela a sessão e recebe-a de volta no teu saldo (se cancelares com mais
                  de {cancelWindowHours} horas de antecedência).
                </div>
              </div>
            </button>
          </form>
        </div>
      ) : (
        <div className="card p-4 text-sm text-ink-500">
          Esta sessão já não pode ser alterada.
        </div>
      )}

      <div>
        <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-ink-500">
          <NotebookPen size={14} /> As minhas notas
        </h2>
        <div className="card p-4">
          <NoteEditor bookingId={b.id} initialBody={note?.body ?? undefined} compact />
        </div>
      </div>
    </div>
  );
}
