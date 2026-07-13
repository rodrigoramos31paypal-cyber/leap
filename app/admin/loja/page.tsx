import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { getAccessibleTrainerIds } from "@/lib/trainer";
import { eur } from "@/lib/utils";
import {
  updateProductAction,
  toggleProductAction,
  deleteProductAction,
} from "./actions";
import { ShoppingBag, Plus, Pencil, Upload } from "lucide-react";
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
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Loja</h1>
        <p className="text-sm text-ink-500">
          Produtos (ebooks, roupa, suplementos) mostrados na Loja dos clientes.
        </p>
      </div>

      {/* Novo produto · fechado por defeito (decisão de produto). O form
          é client-side para podermos limpar os campos após criar com
          sucesso — sem isto, o admin via o produto anterior pré-preenchido
          ao criar o próximo. */}
      <details className="card p-5">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
          <Plus size={16} /> Novo produto
        </summary>
        <NewProductForm categories={CATS} />
      </details>

      {/* Lista por categoria */}
      {CATS.map((cat) => {
        const items = list.filter((p) => p.category === cat.value);
        return (
          <section key={cat.value} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
              {cat.label} <span className="text-ink-400">({items.length})</span>
            </h2>
            {items.length === 0 ? (
              <div className="card p-4 text-sm text-ink-500">Sem produtos nesta categoria.</div>
            ) : (
              <ul className="space-y-3">
                {items.map((p) => (
                  <li key={p.id} className="card overflow-hidden">
                    <div className="flex items-stretch gap-3 p-4">
                      {p.image_url ? (
                        <Image
                          src={p.image_url}
                          alt={p.name}
                          width={64}
                          height={64}
                          className="h-16 w-16 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-400 dark:bg-white/5">
                          <ShoppingBag size={18} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{p.name}</span>
                          <span className={p.active ? "chip-ok" : "chip-mute"}>{p.active ? "Activo" : "Inactivo"}</span>
                        </div>
                        {typeof p.price_cents === "number" && (
                          <div className="text-xs font-semibold text-gold-600">{eur(p.price_cents)}</div>
                        )}
                        {p.description && <div className="truncate text-xs text-ink-500">{p.description}</div>}
                      </div>
                    </div>

                    <details className="border-t border-ink-900/10 dark:border-white/10">
                      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-900/5 dark:text-bone-50 dark:hover:bg-white/5">
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

                    <div className="flex items-center justify-end gap-2 border-t border-ink-900/10 bg-bone-50 px-4 py-2 dark:bg-white/[0.02]">
                      <form action={toggleProductAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                        <button className="rounded-md border border-ink-900/10 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-900/5 dark:border-white/15 dark:text-bone-50 dark:hover:bg-white/5">
                          {p.active ? "Desactivar" : "Activar"}
                        </button>
                      </form>
                      <form action={deleteProductAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                          Remover
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
