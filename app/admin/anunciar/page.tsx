import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { AnunciarForm } from "./anunciar-form";

export const metadata: Metadata = {
  title: "Anunciar vaga",
  robots: { index: false, follow: false },
};

export default async function AnunciarPage() {
  // LEAP = 1 trainer. Resolvemos o trainer ativo + a sua duração-padrão para
  // o formulário só oferecer dias/horários REAIS da disponibilidade dele
  // (mesma fonte que o cliente vê em /app/agenda), alinhados com a duração
  // que o cliente usa por defeito ao marcar.
  const supabase = await createClient();
  const { data: tr } = await supabase
    .from("trainers")
    .select("id")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1);
  const trainerId = (tr as any)?.[0]?.id as string | undefined;

  let defaultDuration = 45;
  if (trainerId) {
    const { data: st } = await supabase
      .from("trainer_settings")
      .select("default_slot_duration_min")
      .eq("trainer_id", trainerId)
      .maybeSingle();
    defaultDuration = (st as any)?.default_slot_duration_min ?? 45;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Anunciar vaga</h1>
        <p className="text-sm text-ink-500">Avisa todos os clientes de uma vaga de última hora</p>
      </div>
      <AnunciarForm trainerId={trainerId} defaultDuration={defaultDuration} />
    </div>
  );
}
