import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { createBannerAction, toggleBannerAction, deleteBannerAction } from "./actions";
import { Megaphone, Plus } from "lucide-react";

export default async function AdminPromocoesPage() {
  const supabase = createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const scope = trainerIds.length > 0 ? trainerIds : [""];

  const { data: banners } = await (supabase as any)
    .from("promo_banners")
    .select("id, title, subtitle, image_url, button_label, link_url, active")
    .in("trainer_id", scope)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const list = (banners ?? []) as any[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Promoções</h1>
        <p className="text-sm text-ink-500">
          Banners promocionais (ex: ebooks) mostrados no dashboard dos clientes.
        </p>
      </div>

      {/* Novo banner */}
      <details className="card p-5" open={list.length === 0}>
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
          <Plus size={16} /> Novo banner
        </summary>
        <form action={createBannerAction} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Título</label>
              <input name="title" required className="input" placeholder="Ex: Receitas Saudáveis" />
            </div>
            <div>
              <label className="label">Etiqueta pequena (opcional)</label>
              <input name="subtitle" className="input" placeholder="Ex: Novo ebook · 30 receitas" />
            </div>
          </div>
          <div>
            <label className="label">URL da imagem (opcional)</label>
            <input name="image_url" type="url" className="input" placeholder="https://..." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Texto do botão (opcional)</label>
              <input name="button_label" className="input" placeholder="Ex: Comprar agora" />
            </div>
            <div>
              <label className="label">Link do botão (opcional)</label>
              <input name="link_url" type="url" className="input" placeholder="https://..." />
            </div>
          </div>
          <button className="btn-primary w-full sm:w-auto">Criar banner</button>
        </form>
      </details>

      {/* Lista */}
      {list.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-8 text-center text-sm text-ink-500">
          <Megaphone size={20} className="text-ink-400" />
          Ainda não há banners. Cria o primeiro acima.
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((b) => (
            <li key={b.id} className="card overflow-hidden">
              <div className="flex items-stretch gap-3 p-4">
                {b.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.image_url} alt={b.title} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-400 dark:bg-white/5">
                    <Megaphone size={18} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{b.title}</span>
                    <span className={b.active ? "chip-ok" : "chip-mute"}>{b.active ? "Activo" : "Inactivo"}</span>
                  </div>
                  {b.subtitle && <div className="truncate text-xs text-ink-500">{b.subtitle}</div>}
                  {b.link_url && (
                    <div className="mt-0.5 truncate text-[11px] text-ink-400">
                      {b.button_label ? `${b.button_label} → ` : "→ "}{b.link_url}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-ink-900/10 bg-bone-50 px-4 py-2 dark:bg-white/[0.02]">
                <form action={toggleBannerAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="active" value={b.active ? "0" : "1"} />
                  <button className="rounded-md border border-ink-900/10 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-50 dark:hover:bg-white/5">
                    {b.active ? "Desactivar" : "Activar"}
                  </button>
                </form>
                <form action={deleteBannerAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <button className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                    Remover
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
