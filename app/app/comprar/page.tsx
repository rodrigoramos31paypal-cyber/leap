import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { PackList } from "./pack-list";
import { SingleSessionCard } from "./single-session-card";
import { BackLink } from "@/components/back-link";
import { getActiveTrainersPublic, getTrainerForClient } from "@/lib/trainer";

export default async function BuyPackPage({ searchParams }: { searchParams: { trainer?: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  const actives = await getActiveTrainersPublic();
  const preselected = searchParams.trainer ?? (await getTrainerForClient(user.id));
  const trainerId = preselected && actives.some((t) => t.id === preselected) ? preselected : null;

  // se há mais que 1 e não há preferência → mostra picker
  if (!trainerId && actives.length > 1) {
    return (
      <div className="space-y-5">
        <BackLink />
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Escolhe o treinador</h1>
          <p className="text-sm text-ink-500">Cada treinador tem os seus packs.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {actives.map((t) => (
            <li key={t.id}>
              <Link
                href={`/app/comprar?trainer=${t.id}`}
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
                    Ver packs deste treinador →
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
        <div className="card p-6 text-sm text-ink-500">
          Ainda não há packs disponíveis. Volta mais tarde.
        </div>
      </div>
    );
  }

  const { data: packs } = await supabase
    .from("packs")
    .select("*")
    .eq("trainer_id", trainerId)
    .eq("active", true)
    .order("session_type")
    .order("sort_order");

  // O pack marcado como sessão avulsa é mostrado em destaque no topo
  // e filtrado da grelha normal para não duplicar.
  const allPacks = (packs ?? []) as any[];
  const singleSession = allPacks.find((p) => p.is_single_session === true) ?? null;
  const regularPacks = allPacks.filter((p) => p.is_single_session !== true);

  const currentTrainer = actives.find((t) => t.id === trainerId);
  const trainerName = currentTrainer?.full_name?.trim();

  return (
    <div className="space-y-5">
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Comprar pack</h1>
        <p className="text-sm text-ink-500">
          {trainerName
            ? `Packs de ${trainerName}.`
            : "Escolhe o pack que melhor se adapta ao teu ritmo."}
          {actives.length > 1 && (
            <>
              {" · "}
              <Link href="/app/comprar" className="font-medium text-gold-600">Mudar treinador</Link>
            </>
          )}
        </p>
      </div>

      {singleSession && <SingleSessionCard pack={singleSession} />}

      <PackList packs={regularPacks} />

      <div className="rounded-xl border border-ink-900/10 bg-bone-100 p-4 text-xs text-ink-600">
        <p className="font-semibold text-ink-900">Como funciona</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Escolhe um pack e o método de pagamento.</li>
          <li>Faz o pagamento (MB Way, Multibanco ou cartão).</li>
          <li>Assim que o pagamento for confirmado, as sessões ficam disponíveis e podes marcar.</li>
        </ol>
      </div>
    </div>
  );
}
