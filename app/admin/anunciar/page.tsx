import type { Metadata } from "next";
import { AnunciarForm } from "./anunciar-form";

export const metadata: Metadata = {
  title: "Anunciar vaga",
  robots: { index: false, follow: false },
};

export default function AnunciarPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Anunciar vaga</h1>
        <p className="text-sm text-ink-500">Avisa todos os clientes de uma vaga de última hora</p>
      </div>
      <AnunciarForm />
    </div>
  );
}
