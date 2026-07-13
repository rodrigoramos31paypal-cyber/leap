import { createClient } from "@/lib/supabase/server";
import { savePackAction } from "./actions";
import { Plus } from "lucide-react";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { PacksDisplay, type PackRow } from "./packs-grid";

export default async function AdminPacksPage() {
  const supabase = await createClient();
  // PERF: paralelizar — getCurrentTrainerId e getAccessibleTrainerIds partilham auth.getUser via cache
  const [trainerId, trainerIds] = await Promise.all([
    getCurrentTrainerId(),
    getAccessibleTrainerIds(),
  ]);

  const { data: packs } = await supabase
    .from("packs")
    .select("*")
    .in("trainer_id", trainerIds.length > 0 ? trainerIds : [""])
    .order("session_type")
    .order("sort_order");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Packs</h1>
        <p className="text-sm text-ink-500">Define os packs e preços oferecidos.</p>
      </div>

      <details className="card p-5">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <Plus size={16} /> Criar novo pack
        </summary>
        <form action={savePackAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="trainerId" value={trainerId ?? ""} />
          {/* session_type fixo a "individual" — a opção dupla está desactivada
              na UI até o cliente decidir reactivá-la. */}
          <input type="hidden" name="session_type" value="individual" />
          <div className="sm:col-span-2">
            <label className="label">Nome</label>
            <input name="name" required className="input" placeholder="Ex: PT · 6 Sessões" />
          </div>
          <div>
            <label className="label">Nº sessões</label>
            <input name="sessions" type="number" min={1} required className="input" />
          </div>
          <div>
            <label className="label">Preço (€)</label>
            <input name="price_euros" type="number" min={0} step="0.01" required className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Validade (dias, opcional)</label>
            <input name="validity_days" type="number" min={1} className="input" placeholder="Vazio = sem validade" />
          </div>
          <label className="sm:col-span-2 flex items-start gap-2 rounded-md border border-ink-900/10 bg-bone-50 px-3 py-2 text-xs">
            <input type="checkbox" name="is_single_session" className="mt-0.5 h-4 w-4 rounded border-ink-900/30" />
            <span>
              <span className="block font-semibold">Marcar como sessão avulsa</span>
              <span className="text-ink-500">
                Aparece em destaque no topo de /comprar como &quot;Sessão avulsa&quot;. Só 1 pack activo
                de cada vez pode ter esta marcação.
              </span>
            </span>
          </label>
          <button className="btn-primary sm:col-span-2">Criar pack</button>
        </form>
      </details>

      <PacksDisplay packs={(packs ?? []) as PackRow[]} />
    </div>
  );
}
