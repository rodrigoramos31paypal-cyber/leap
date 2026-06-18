import { redirect, notFound } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils";
import { getMyRatingForBooking } from "@/lib/ratings";
import { BackLink } from "@/components/back-link";
import { submitRatingAction } from "./actions";
import { StarPicker } from "./star-picker";

export default async function AvaliarSessaoPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, session_type, status, client_id, trainer_id")
    .eq("id", params.id)
    .eq("client_id", user.id)
    .maybeSingle();
  if (!b) notFound();

  // Só dá para avaliar sessões realizadas.
  if (b.status !== "confirmed" || new Date(b.ends_at).getTime() > Date.now()) {
    redirect(`/app/sessao/${b.id}`);
  }

  const existing = await getMyRatingForBooking(b.id);

  return (
    <div className="space-y-5">
      <BackLink />

      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          {existing ? "Editar avaliação" : "Avaliar sessão"}
        </h1>
        <p className="text-sm text-ink-500">
          Sessão de {formatDateTime(b.starts_at)} · {b.session_type}
        </p>
      </div>

      <form action={submitRatingAction} className="card space-y-5 p-5">
        <input type="hidden" name="bookingId" value={b.id} />

        <div>
          <div className="label">Como classificas esta sessão?</div>
          <StarPicker initial={existing?.stars ?? 0} />
        </div>

        <div>
          <label htmlFor="comment" className="label">
            Comentário (opcional)
          </label>
          <textarea
            id="comment"
            name="comment"
            rows={4}
            placeholder="O que correu bem? O que pode melhorar?"
            defaultValue={existing?.comment ?? ""}
            className="input min-h-[110px]"
          />
          <p className="mt-1 text-xs text-ink-500">
            O comentário pode ser mostrado (com primeiro nome + inicial) na página pública do trainer.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          <a href={`/app/sessao/${b.id}`} className="btn-outline">
            Cancelar
          </a>
          <button type="submit" className="btn-gold">
            {existing ? "Actualizar" : "Enviar avaliação"}
          </button>
        </div>
      </form>
    </div>
  );
}
