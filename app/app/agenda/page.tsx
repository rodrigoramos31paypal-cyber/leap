import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getClientCredits } from "@/lib/credits";
import { BookingFlow } from "./booking-flow";
import { getActiveTrainersPublic, getTrainerForClient } from "@/lib/trainer";
import { formatDateTime } from "@/lib/utils";
import {
  UserPlus,
  Dumbbell,
  Calendar as CalendarIcon,
  BarChart3,
  ShoppingBag,
  Package,
  ChevronRight,
} from "lucide-react";

export default async function AgendaPage(
  props: {
    searchParams: Promise<{ rebook?: string; trainer?: string; reschedule?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

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

  // PERF (Q6): getActiveTrainersPublic + getTrainerForClient são
  // independentes — corremo-los em paralelo. Só pedimos o fallback quando
  // não há preferência explícita (reschedule/searchParams).
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
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Escolhe o trainer</h1>
          <p className="text-sm text-ink-500">Cada trainer tem o seu calendário.</p>
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
                  <div className="font-display text-base font-bold tracking-tight">{t.full_name || "Trainer"}</div>
                  <div className="text-xs text-ink-500">@{t.slug}</div>
                  {t.bio && (
                    <p className="mt-2 line-clamp-3 text-xs text-ink-600">{t.bio}</p>
                  )}
                  <div className="mt-3 text-xs font-medium text-gold-600 group-hover:text-gold-700">
                    Marcar com este trainer →
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
        <div className="card p-5 text-sm text-ink-500">Sem trainers disponíveis.</div>
      </div>
    );
  }

  // PERF: hasAnyPurchase corre em paralelo com settings+credits. count:
  // 'exact', head: true devolve só a contagem (0 bytes de body).
  const [{ data: settings }, credits, { count: purchaseCount }] = await Promise.all([
    supabase
      .from("trainer_settings")
      .select("slot_durations_min, default_slot_duration_min")
      .eq("trainer_id", trainerId)
      .single(),
    getClientCredits(user.id, trainerId),
    supabase
      .from("purchases")
      .select("id", { count: "exact", head: true })
      .eq("client_id", user.id),
  ]);
  // "Cliente novo" = nunca comprou pack nenhum (qualquer status, qualquer
  // trainer). Esses vêem o ecrã de boas-vindas em vez da mensagem
  // genérica "sem sessões". Clientes que já compraram mas ficaram a zero
  // continuam a ver a mensagem original.
  const isNewClient = (purchaseCount ?? 0) === 0;

  const currentTrainer = actives.find((t) => t.id === trainerId);
  const trainerName = currentTrainer?.full_name?.trim();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Marcar sessão</h1>
        <p className="text-sm text-ink-500">
          {trainerName ? `com ${trainerName}` : "Escolhe o dia, hora e tipo de sessão."}
          {actives.length > 1 && (
            <>
              {" · "}
              <Link href="/app/agenda" className="font-medium text-gold-600">Mudar trainer</Link>
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
        isNewClient ? (
          <NewClientWelcome trainerName={trainerName} trainerId={currentTrainer?.id} />
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            Sem sessões disponíveis {currentTrainer ? `com ${currentTrainer.full_name}` : ""}.{" "}
            <a
              href={`/app/comprar${currentTrainer ? `?trainer=${currentTrainer.id}` : ""}`}
              className="font-semibold underline"
            >
              Compra um pack
            </a>{" "}
            para marcares sessões.
          </div>
        )
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
  );
}

// ════════════════════════════════════════════════════════════════
// Ecrã de boas-vindas — só para clientes que nunca compraram nada.
// Funciona em light e dark (usa cores do design system: gold, ink, bone).
// ════════════════════════════════════════════════════════════════
function NewClientWelcome({
  trainerName,
  trainerId,
}: {
  trainerName?: string | null;
  trainerId?: string;
}) {
  const buyHref = `/app/comprar${trainerId ? `?trainer=${trainerId}` : ""}`;
  const name = trainerName?.trim() || "o teu trainer";
  return (
    <div className="card p-6 text-center sm:p-8">
      {/* Ícone decorativo: avatar dourado + "raios" à volta. */}
      <div className="relative mx-auto h-24 w-24">
        <div className="absolute inset-0 grid place-items-center rounded-full border-2 border-gold-400/50">
          <UserPlus className="h-10 w-10 text-gold-500" strokeWidth={1.75} />
        </div>
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-4 text-gold-500">✦</span>
        <span aria-hidden className="pointer-events-none absolute right-0 top-2 translate-x-2 text-gold-500/80">✧</span>
        <span aria-hidden className="pointer-events-none absolute left-0 top-2 -translate-x-2 text-gold-500/80">✧</span>
        <span aria-hidden className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-4 text-gold-500/80">✦</span>
      </div>

      <h2 className="mt-5 font-display text-2xl font-bold tracking-tight sm:text-3xl">
        <span className="text-gold-500">Começa</span> a tua jornada
      </h2>
      <div aria-hidden className="mx-auto mt-2 h-0.5 w-16 rounded-full bg-gold-400" />
      <p className="mx-auto mt-3 max-w-xs text-sm text-ink-600 dark:text-bone-100/80">
        Para marcares sessões com {name}, precisas de um pack.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-4">
        <Feature
          icon={<Dumbbell size={20} className="text-gold-500" strokeWidth={1.75} />}
          title="Treinos personalizados"
          desc="Feitos à tua medida."
        />
        <Feature
          icon={<CalendarIcon size={20} className="text-gold-500" strokeWidth={1.75} />}
          title="Acompanhamento contínuo"
          desc={trainerName ? `Evolui com ${trainerName.split(" ")[0]}.` : "Evolui com o trainer."}
        />
        <Feature
          icon={<BarChart3 size={20} className="text-gold-500" strokeWidth={1.75} />}
          title="Resultados reais"
          desc="Mais foco, mais consistência."
        />
      </div>

      <div className="mt-6 border-t border-ink-900/10 pt-5 dark:border-white/10">
        <Link
          href={buyHref}
          className="btn-gold inline-flex w-full items-center justify-center gap-2 uppercase tracking-wide"
        >
          <ShoppingBag size={16} /> Escolher pack
        </Link>
        <Link
          href={buyHref}
          className="mt-3 inline-flex items-center justify-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900 dark:text-bone-100/80 dark:hover:text-bone-50"
        >
          <Package size={14} className="text-gold-500" /> Ver packs disponíveis
          <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="grid h-11 w-11 place-items-center rounded-full border border-gold-400/50">
        {icon}
      </div>
      <div className="text-[11px] font-semibold leading-tight sm:text-xs">{title}</div>
      <div className="text-[10px] leading-tight text-ink-500 dark:text-bone-100/70 sm:text-[11px]">{desc}</div>
    </div>
  );
}
