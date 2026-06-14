import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getClientCredits } from "@/lib/credits";
import { BookingFlow } from "./booking-flow";
import { BackLink } from "@/components/back-link";
import { getActiveTrainersPublic, getTrainerForClient } from "@/lib/trainer";
import { formatDateTime } from "@/lib/utils";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: { rebook?: string; trainer?: string; reschedule?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  // Modo reagendamento: a marcação antiga só é cancelada ao confirmar o novo
  // horário. Força o trainer e a duração da sessão original.
  let reschedule:
    | { id: string; trainerId: string; durationMin: number; startsAt: string }
    | null = null;
  if (searchParams.reschedule) {
    const { data: ob } = await supabase
      .from("bookings")
      .select("id, starts_at, ends_at, trainer_id, status, client_id")
      .eq("id", searchParams.reschedule)
      .eq("client_id", user.id)
      .maybeSingle();
    if (
      ob &&
      (ob.status === "booked" || ob.status === "confirmed") &&
      new Date(ob.starts_at).getTime() > Date.now()
    ) {
      reschedule = {
        id: ob.id,
        trainerId: ob.trainer_id,
        durationMin: Math.max(
          1,
          Math.round(
            (new Date(ob.ends_at).getTime() - new Date(ob.starts_at).getTime()) / 60000,
          ),
        ),
        startsAt: ob.starts_at,
      };
    }
  }

  // PERF (Q6): getActiveTrainersPublic + o fallback getTrainerForClient são
  // independentes — corremo-los em paralelo. Só pedimos o fallback quando
  // não há preferência explícita (reschedule/searchParams), para não gastar
  // uma query quando o trainer já vem no URL.
  const explicitTrainer = reschedule?.trainerId ?? searchParams.trainer;
  const [actives, fallbackTrainer] = await Promise.all([
    getActiveTrainersPublic(),
    explicitTrainer ? Promise.resolve(null) : getTrainerForClient(user.id),
  ]);
  const preferred = explicitTrainer ?? fallbackTrainer;
  const trainerId = preferred && actives.some((t) => t.id === preferred) ? preferred : null;

  // mais que 1 trainer e sem escolha → mostra picker
  if (!trainerId && actives.length > 1) {
    return (
      <div className="space-y-5">
        <BackLink />
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Escolhe o treinador</h1>
          <p className="text-sm text-ink-500">Cada treinador tem o seu calendário.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {actives.map((t) => (
            <li key={t.id}>
              <Link
                href={`/app/agenda?trainer=${t.id}`}
                className="card group flex h-full items-start gap-4 p-5 transition hover:border-gold-400 hover:shadow-glow"
              >
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-ink-900 text-gold-400 font-display text-2xl font-black">
                  {t.full_name?.[0]?.toUpperCase() ?? "T"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-base font-bold tracking-tight">{t.full_name || "Treinador"}</div>
                  <div className="text-xs text-ink-500">@{t.slug}</div>
                  {t.bio && (
                    <p className="mt-2 line-clamp-3 text-xs text-ink-600">{t.bio}</p>
                  )}
                  <div className="mt-3 text-xs font-medium text-gold-600 group-hover:text-gold-700">
                    Marcar com este treinador →
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!trainerId) {
    return (
      <div className="space-y-5">
        <BackLink />
        <div className="card p-5 text-sm text-ink-500">Sem trainers disponíveis.</div>
      </div>
    );
  }

  const [{ data: settings }, credits] = await Promise.all([
    supabase
      .from("trainer_settings")
      .select("slot_durations_min, default_slot_duration_min")
      .eq("trainer_id", trainerId)
      .single(),
    getClientCredits(user.id, trainerId),
  ]);

  const currentTrainer = actives.find((t) => t.id === trainerId);
  const trainerName = currentTrainer?.full_name?.trim();

  return (
    <div className="space-y-5">
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Marcar sessão</h1>
        <p className="text-sm text-ink-500">
          {trainerName ? `Com ${trainerName}.` : "Escolhe o dia, hora e tipo de sessão."}
          {actives.length > 1 && (
            <>
              {" · "}
              <Link href="/app/agenda" className="font-medium text-gold-600">Mudar treinador</Link>
            </>
          )}
        </p>
      </div>

      {searchParams.rebook && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Sessão anterior cancelada e devolvida ao teu saldo. Escolhe agora o novo horário.
        </div>
      )}

      {reschedule && (
        <div className="rounded-xl border border-gold-300 bg-gold-50 p-4 text-sm text-ink-800">
          Estás a reagendar a tua sessão de <strong>{formatDateTime(reschedule.startsAt)}</strong>.
          Escolhe um novo horário — a sessão atual só é cancelada quando confirmares.
        </div>
      )}

      {credits.total === 0 && !reschedule ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          Sem sessões disponíveis {currentTrainer ? `com ${currentTrainer.full_name}` : ""}.{" "}
          <a
            href={`/app/comprar${currentTrainer ? `?trainer=${currentTrainer.id}` : ""}`}
            className="font-semibold underline"
          >
            Compra um pack
          </a>{" "}
          para marcares sessões.
        </div>
      ) : (
        <BookingFlow
          trainerId={trainerId}
          slotDurations={settings?.slot_durations_min ?? [45, 60, 90]}
          defaultDuration={reschedule?.durationMin ?? settings?.default_slot_duration_min ?? 45}
          credits={credits}
          rescheduleBookingId={reschedule?.id}
        />
      )}
    </div>
  );}
