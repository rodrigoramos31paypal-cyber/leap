"use client";

import { useState, useTransition } from "react";
import { Check, Heart } from "lucide-react";
import { declareInterestAction } from "@/app/app/loja/actions";

export function ProductInterestButton({ productId, productName, interested }: { productId: string; productName: string; interested: boolean }) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const done = interested || saved;
  return (
    <div className="mt-3">
      <button type="button" disabled={done || pending} aria-label={`${done ? "Interesse declarado" : "Declarar interesse"}: ${productName}`} className="btn-primary min-h-11 w-full gap-2 disabled:opacity-70"
        onClick={() => startTransition(async () => {
          setError(undefined);
          try {
            const result = await declareInterestAction(productId);
            if (result.error) setError(result.error);
            else if (result.ok) setSaved(true);
          } catch { setError("Não foi possível guardar o interesse. Verifica a ligação e tenta novamente."); }
        })}>
        {done ? <Check size={16} aria-hidden="true" /> : <Heart size={16} aria-hidden="true" />}
        {done ? "Interesse declarado" : pending ? "A guardar…" : "Declarar interesse"}
      </button>
      <p role="status" className="mt-1 text-xs text-ink-500">{done ? "A equipa LEAP já pode consultar o teu interesse." : "Sem compra ou pagamento."}</p>
      {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
