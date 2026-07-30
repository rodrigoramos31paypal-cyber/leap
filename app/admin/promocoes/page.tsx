import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import {
  createBannerAction,
  updateBannerAction,
  toggleBannerAction,
  deleteBannerAction,
} from "./actions";
import { Images, Plus, Pencil, Upload, Link2, Trash2 } from "lucide-react";

const MAX_SLIDES = 3;

export default async function AdminSlideshowPage() {
  const supabase = await createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const scope = trainerIds.length > 0 ? trainerIds : [""];

  const { data: banners } = await (supabase as any)
    .from("promo_banners")
    .select("id, title, subtitle, image_url, button_label, link_url, active")
    .in("trainer_id", scope)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const list = (banners ?? []) as any[];
  const canAdd = list.length < MAX_SLIDES;

  const newSlideForm = (
    <form action={createBannerAction} className="space-y-4 border-t border-ink-900/10 p-4 dark:border-white/10">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Título (opcional)</label>
          <input name="title" className="input" placeholder="Ex: Receitas Saudáveis" />
        </div>
        <div>
          <label className="label">Etiqueta pequena (opcional)</label>
          <input name="subtitle" className="input" placeholder="Ex: Novo ebook · 30 receitas" />
        </div>
      </div>
      <div>
        <label className="label flex items-center gap-1.5">
          <Upload size={14} /> Imagem do slide (carrega do telemóvel)
        </label>
        <input
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-ink-900/10 file:px-3 file:py-1.5 file:text-sm file:font-semibold dark:file:bg-white/10"
        />
        <p className="mt-1 text-[11px] text-ink-400">JPG, PNG ou WEBP · máx. 5 MB · recomendado 1200×400px (3:1)</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Texto do botão (opcional)</label>
          <input name="button_label" className="input" placeholder="Ex: Comprar agora" />
        </div>
        <div>
          <label className="label">Link do slide (abre ao tocar)</label>
          <input name="link_url" type="url" className="input" placeholder="https://..." />
        </div>
      </div>
      <button className="btn-primary w-full sm:w-auto">Criar slide</button>
    </form>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Slideshow</h1>
          <p className="text-[12.5px] text-ink-500">Carrossel mostrado no dashboard dos clientes</p>
        </div>
        <span className="shrink-0 rounded-full bg-bone-100 px-2.5 py-1 text-[11px] font-medium text-ink-500 dark:bg-white/10 dark:text-bone-100">
          {list.length} / {MAX_SLIDES} slides
        </span>
      </div>

      {canAdd ? (
        <details className="card overflow-hidden p-0" open={list.length === 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2.5 p-4 text-sm font-semibold text-ink-800 dark:text-bone-100">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-900 text-gold-400 dark:bg-white/10">
              <Plus size={15} />
            </span>
            Novo slide
          </summary>
          {newSlideForm}
        </details>
      ) : (
        <div className="card flex items-center gap-2 p-4 text-sm text-ink-500">
          <Images size={16} className="text-ink-400" />
          Atingiste o máximo de {MAX_SLIDES} slides. Remove um para adicionar outro.
        </div>
      )}

      {list.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-8 text-center text-sm text-ink-500">
          <Images size={20} className="text-ink-400" />
          Ainda não há slides. Cria o primeiro acima.
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((b) => (
            <li key={b.id} className="card overflow-hidden p-0">
              <div className="relative h-[120px] w-full bg-bone-100 dark:bg-white/5">
                {b.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={b.image_url} alt={b.title || "slide"} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center text-ink-400">
                    <Images size={22} />
                  </div>
                )}
                {b.image_url && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/65 to-transparent" />
                )}
                <div className={`absolute inset-x-3 bottom-2.5 ${b.image_url ? "text-white" : "text-ink-900 dark:text-bone-50"}`}>
                  <div className="truncate text-[15px] font-semibold [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">{b.title || "Sem título"}</div>
                  {b.subtitle && <div className="truncate text-[12px] opacity-90 [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]">{b.subtitle}</div>}
                </div>
                <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
                  <span className={`h-1.5 w-1.5 rounded-full ${b.active ? "bg-emerald-400" : "bg-white/50"}`} />
                  {b.active ? "Ativa" : "Inativa"}
                </span>
              </div>

              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1 truncate text-[11.5px] text-ink-500">
                  {b.link_url ? (
                    <span className="inline-flex items-center gap-1">
                      <Link2 size={12} className="shrink-0" />
                      <span className="truncate">
                        {b.button_label ? `${b.button_label} → ` : "→ "}
                        {b.link_url}
                      </span>
                    </span>
                  ) : (
                    "Sem link"
                  )}
                </div>
                <form action={toggleBannerAction} className="shrink-0">
                  <input type="hidden" name="id" value={b.id} />
                  <input type="hidden" name="active" value={b.active ? "0" : "1"} />
                  <button
                    aria-label={b.active ? "Desativar slide" : "Ativar slide"}
                    className={`relative block h-[22px] w-[38px] rounded-full transition-colors ${
                      b.active ? "bg-gold-500" : "bg-ink-900/15 dark:bg-white/20"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${
                        b.active ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </form>
                <form action={deleteBannerAction} className="shrink-0">
                  <input type="hidden" name="id" value={b.id} />
                  <button
                    aria-label="Remover slide"
                    className="grid h-8 w-8 place-items-center rounded-lg text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    <Trash2 size={16} />
                  </button>
                </form>
              </div>

              <details className="border-t border-ink-900/10 dark:border-white/10">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs font-semibold text-ink-600 hover:bg-ink-900/[0.02] dark:text-bone-50 dark:hover:bg-white/5">
                  <Pencil size={14} /> Editar texto e imagem
                </summary>
                <form action={updateBannerAction} className="space-y-3 px-4 pb-4">
                  <input type="hidden" name="id" value={b.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">Título (opcional)</label>
                      <input name="title" defaultValue={b.title} className="input" />
                    </div>
                    <div>
                      <label className="label">Etiqueta pequena</label>
                      <input name="subtitle" defaultValue={b.subtitle ?? ""} className="input" />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">Texto do botão</label>
                      <input name="button_label" defaultValue={b.button_label ?? ""} className="input" />
                    </div>
                    <div>
                      <label className="label">Link do slide (abre ao tocar)</label>
                      <input name="link_url" type="url" defaultValue={b.link_url ?? ""} className="input" />
                    </div>
                  </div>
                  <div>
                    <label className="label flex items-center gap-1.5">
                      <Upload size={14} /> Substituir imagem (opcional)
                    </label>
                    <input
                      name="file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="input file:mr-3 file:rounded-md file:border-0 file:bg-ink-900/10 file:px-3 file:py-1.5 file:text-sm file:font-semibold dark:file:bg-white/10"
                    />
                    <p className="mt-1 text-[11px] text-ink-400">Deixa em branco para manter a imagem actual.</p>
                  </div>
                  <button className="btn-primary w-full sm:w-auto">Guardar alterações</button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
