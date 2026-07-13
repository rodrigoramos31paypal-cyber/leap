"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { cn, eur } from "@/lib/utils";
import { startPurchaseAction } from "./actions";
import type { Pack, PaymentMethod } from "@/types/database";

// Card destacado para a Sessão Avulsa. Atalho de compra sem pack —
// reaproveita o mesmo startPurchaseAction (qualquer packId funciona).
const METHODS: { id: PaymentMethod; label: string; helper: string }[] = [
  { id: "manual_mbway", label: "MB WAY", helper: "Pagas por MB WAY — confirmação manual em minutos" },
  { id: "manual_revolut", label: "Revolut", helper: "Pagas por Revolut — confirmação manual em minutos" },
];

export function SingleSessionCard({ pack }: { pack: Pack }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("manual_mbway");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function handleBuy() {
    setError(null);
    start(async () => {
      const res = await startPurchaseAction({ packId: pack.id, method });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(res.redirect!);
    });
  }

  return (
    <section className="card overflow-hidden border-gold-300 bg-gradient-to-br from-gold-50 to-bone-50 p-5">
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink-900 text-gold-400">
          <Zap size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-gold-700">
            Sessão avulsa
          </div>
          <div className="mt-0.5 font-display text-lg font-bold tracking-tight">{pack.name}</div>
          <div className="mt-1 text-xs text-ink-600">
            Sem compromisso de pack. {pack.sessions === 1 ? "1 sessão" : `${pack.sessions} sessões`}{" "}
            {pack.validity_days ? `· válido ${pack.validity_days} dias` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold">{eur(pack.price_cents)}</div>
        </div>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-gold mt-4 w-full"
        >
          Comprar agora
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="label">Método de pagamento</div>
          <div className="space-y-2">
            {METHODS.map((m) => (
              <label
                key={m.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 bg-bone-50",
                  method === m.id ? "border-gold-400" : "border-ink-900/10",
                )}
              >
                <input
                  type="radio"
                  name="single-method"
                  value={m.id}
                  checked={method === m.id}
                  onChange={() => setMethod(m.id)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-xs text-ink-500">{m.helper}</div>
                </div>
              </label>
            ))}
          </div>

          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn-outline flex-1"
              disabled={pending}
            >
              Cancelar
            </button>
            <button onClick={handleBuy} disabled={pending} className="btn-gold flex-1">
              {pending ? "A processar…" : "Confirmar compra"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
