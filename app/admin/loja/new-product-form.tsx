"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { createProductAction } from "./actions";

type Cat = { value: string; label: string };

// Form de "Novo produto" — versão client-side wrapper. Existe (em vez de
// usar <form action={createProductAction}>) porque, em caso de sucesso,
// queremos LIMPAR todos os campos para que o admin/trainer possa criar
// um produto seguinte sem ter de apagar manualmente nome, preço, link e
// imagem do produto anterior. Submete via useTransition, e ao receber
// `ok: true` faz `formRef.current.reset()` e refresca a lista.
export function NewProductForm({ categories }: { categories: Cat[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await createProductAction(fd);
      if (res?.ok) {
        form.reset();
        router.refresh();
      } else {
        setError(res?.error ?? "Não foi possível criar o produto");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Categoria</label>
          <select name="category" className="input" defaultValue="ebooks">
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Nome</label>
          <input name="name" required className="input" placeholder="Ex: Guia de receitas" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Preço € (opcional)</label>
          <input name="price" inputMode="decimal" className="input" placeholder="Ex: 19.99" />
        </div>
        <div>
          <label className="label">Link de compra (opcional)</label>
          <input name="link_url" type="url" className="input" placeholder="https://..." />
        </div>
      </div>
      <div>
        <label className="label">Descrição (opcional)</label>
        <input name="description" className="input" placeholder="Breve descrição do produto" />
      </div>
      <div>
        <label className="label flex items-center gap-1.5">
          <Upload size={14} /> Imagem (carrega do telemóvel)
        </label>
        <input
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-ink-900/10 file:px-3 file:py-1.5 file:text-sm file:font-semibold dark:file:bg-white/10"
        />
        <p className="mt-1 text-[11px] text-ink-400">JPG, PNG ou WEBP · máx. 5 MB</p>
      </div>
      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full sm:w-auto disabled:opacity-50">
        {pending ? "A criar…" : "Criar produto"}
      </button>
    </form>
  );
}
