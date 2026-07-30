import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { eur } from "@/lib/utils";
import {
  updateProductAction,
  toggleProductAction,
  deleteProductAction,
} from "./actions";
import { ShoppingBag, Plus, Pencil, Upload, Trash2 } from "lucide-react";
import { NewProductForm } from "./new-product-form";

const CATS: { value: string; label: string }[] = [
  { value: "ebooks", label: "Ebooks" },
  { value: "roupa", label: "Roupa" },
  { value: "suplementos", label: "Suplementos" },
];

function priceToInput(cents: number | null): string {
  return typeof cents === "number" ? (cents / 100).toFixed(2) : "";
}

export default async function AdminLojaPage() {
  const supabase = await createClient();
  const trainerIds = await getAccessibleTrainerIds();
  const scope = trainerIds.length > 0 ? trainerIds : [""];

  const { data: products } = await (supabase as any)
    .from("store_products")
    .select("id, category, name, description, price_cents, image_url, link_url, active")
    .in("trainer_id", scope)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  const list = (products ?? []) as any[];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Loja</h1>
          <p className="text-[12.5px] text-ink-500">Ebooks, roupa e suplementos na Loja dos clientes</p>
        </div>
        <span className="shrink-0 rounded-full bg-bone-100 px-2.5 py-1 text-[11px] font-medium text-ink-500 dark:bg-white/10 dark:text-bone-100">
          {list.length} {list.length === 1 ? "produto" : "produtos"}
        </span>
      </div>

      <details className="card overflow-hidden p-0">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 p-4 text-sm font-semibold text-ink-800 dark:text-bone-100">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ink-900 text-gold-400 dark:bg-white/10">
            <Plus size={15} />
          </span>
          Novo produto
        </summary>
        <div className="border-t border-ink-900/10 p-4 dark:border-white/10">
          <NewProductForm categories={CATS} />
        </div>
      </details>

      {CATS.map((cat) => {
        const items = list.filter((p) => p.category === cat.value);
        return (
          <section key={cat.value} className="space-y-2">
            <div className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
              {cat.label} · {items.length}
            </div>
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-900/15 p-4 text-center text-xs text-ink-400 dark:border-white/15">
                Sem produtos nesta categoria
              </div>
            ) : (
              <ul className="space-y-2">
                {items.map((p) => (
                  <li key={p.id} className="card overflow-hidden p-0">
                    <div className="flex items-center gap-3 p-3">
                      {p.image_url ? (
                        <Image
                          src={p.image_url}
                          alt={p.name}
                          width={52}
                          height={52}
                          className="h-[52px] w-[52px] shrink-0 rounded-xl object-cover"
                        />
                      ) : (
                        <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-xl bg-bone-100 text-ink-400 dark:bg-white/5">
                          <ShoppingBag size={20} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium text-ink-900 dark:text-bone-50">{p.name}</div>
                        {p.description && <div className="truncate text-[11.5px] text-ink-500">{p.description}</div>}
                        {typeof p.price_cents === "number" && (
                          <div className="text-[13px] font-semibold text-gold-600 dark:text-gold-400">{eur(p.price_cents)}</div>
                        )}
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.active
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                            : "bg-ink-900/10 text-ink-500 dark:bg-white/10 dark:text-bone-100/60"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${p.active ? "bg-emerald-500" : "bg-ink-400"}`} />
                        {p.active ? "Ativo" : "Inativo"}
                      </span>
                    </div>

                    <details className="border-t border-ink-900/10 dark:border-white/10">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs font-semibold text-ink-600 hover:bg-ink-900/[0.02] dark:text-bone-50 dark:hover:bg-white/5">
                        <Pencil size={14} /> Editar
                      </summary>
                      <form action={updateProductAction} className="space-y-3 px-4 pb-4">
                        <input type="hidden" name="id" value={p.id} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="label">Categoria</label>
                            <select name="category" className="input" defaultValue={p.category}>
                              {CATS.map((c) => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="label">Nome</label>
                            <input name="name" required defaultValue={p.name} className="input" />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="label">Preço €</label>
                            <input name="price" inputMode="decimal" defaultValue={priceToInput(p.price_cents)} className="input" />
                          </div>
                          <div>
                            <label className="label">Link de compra</label>
                            <input name="link_url" type="url" defaultValue={p.link_url ?? ""} className="input" />
                          </div>
                        </div>
                        <div>
                          <label className="label">Descrição</label>
                          <input name="description" defaultValue={p.description ?? ""} className="input" />
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

                    <div className="flex items-center gap-2 border-t border-ink-900/10 px-3 py-2.5 dark:border-white/10">
                      <form action={toggleProductAction} className="shrink-0">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                        <button
                          aria-label={p.active ? "Desativar produto" : "Ativar produto"}
                          className={`relative block h-[22px] w-[38px] rounded-full transition-colors ${
                            p.active ? "bg-gold-500" : "bg-ink-900/15 dark:bg-white/20"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${
                              p.active ? "left-[18px]" : "left-0.5"
                            }`}
                          />
                        </button>
                      </form>
                      <span className="text-[11.5px] text-ink-500">{p.active ? "Visível na loja" : "Escondido"}</span>
                      <form action={deleteProductAction} className="ml-auto shrink-0">
                        <input type="hidden" name="id" value={p.id} />
                        <button
                          aria-label="Remover produto"
                          className="grid h-8 w-8 place-items-center rounded-lg text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                        >
                          <Trash2 size={16} />
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
