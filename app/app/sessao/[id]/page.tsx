import { redirect, notFound } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { formatDateTime, BOOKING_STATUS } from "@/lib/utils";
import { cancelBookingAction, rebookAction } from "@/app/app/historico/actions";
import { CalendarPlus, RefreshCcw, X, NotebookPen, ChevronRight, Star } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { NoteEditor } from "@/components/note-editor";
import { getMyNoteForBooking } from "@/lib/notes";
import { getMyRatingForBooking } from "@/lib/ratings";

// Página de uma sessão específica (cliente). Opções: adicionar ao
// calendário, reagendar, cancelar, avaliar e as minhas notas.
export default async function SessaoPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, session_type, status, client_id, trainer_id, partner_client_id")
    .eq("id", params.id)
    // DUO: o parceiro também pode abrir a sessão partilhada.
    .or(`client_id.eq.${user.id},partner_client_id.eq.${user.id}`)
    .maybeSingle();
  if (!b) notFound();

  const note = await getMyNoteForBooking(b.id);
  const isFuture = new Date(b.starts_at).getTime() > Date.now();
  const canModify = isFuture && (b.status === "booked" || b.status === "confirmed");

  // Sessão "realizada": confirmed + já acabou. Só estas podem ser avaliadas.
  const isPast = new Date(b.ends_at).getTime() < Date.now();
  const canRate = isPast && b.status === "confirmed";
  const existingRating = canRate ? await getMyRatingForBooking(b.id) : null;

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
      ) : canRate ? (
        <a
          href={`/app/sessao/${b.id}/avaliar`}
          className="card flex items-center gap-3 p-4 hover:border-gold-400"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gold-50 text-gold-600">
            <Star size={18} className={existingRating ? "fill-gold-400 text-gold-400" : ""} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {existingRating ? `A tua avaliação: ${existingRating.stars}/5` : "Avaliar sessão"}
            </div>
            <div className="text-xs text-ink-500">
              {existingRating
                ? "Toca para editar a tua avaliação."
                : "Como correu? 1-5⭐ + comentário opcional."}
            </div>
          </div>
          <ChevronRight size={16} className="shrink-0 text-ink-500" />
        </a>
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
          <NoteEditor bookingId={b.id} initialBody={note?.body ?? undefined} compact sharedWithTrainer />
        </div>
      </div>
    </div>
  );
}
