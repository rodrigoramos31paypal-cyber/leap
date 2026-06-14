"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Users, User } from "lucide-react";
import { cn, eur } from "@/lib/utils";
import { startPurchaseAction } from "./actions";
import type { Pack, PaymentMethod } from "@/types/database";

const METHODS: { id: PaymentMethod; label: string; helper: string; gateway: "manual" | "ifthenpay" }[] = [
  { id: "mbway", label: "MB Way (automático)", helper: "Aprovação imediata via IfthenPay", gateway: "ifthenpay" },
  { id: "multibanco", label: "Multibanco", helper: "Referência multibanco automática", gateway: "ifthenpay" },
  { id: "card", label: "Cartão Bancário", helper: "Visa / Mastercard via IfthenPay", gateway: "ifthenpay" },
  { id: "manual_mbway", label: "MB Way (manual) ou Revolut", helper: "Pagas diretamente ao João — confirmação em minutos", gateway: "manual" },
];

export function PackList({ packs }: { packs: Pack[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Pack | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("manual_mbway");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const individuals = packs.filter((p) => p.session_type === "individual");
  const duplas = packs.filter((p) => p.session_type === "dupla");

  function handleBuy() {
    if (!picked) return;
    setError(null);
    start(async () => {
      const res = await startPurchaseAction({ packId: picked.id, method });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(res.redirect!);
    });
  }

  return (
    <div className="space-y-6">
      <PackSection
        title="PT Individual"
        icon={<User size={16} />}
        packs={individuals}
        pickedId={picked?.id}
        onPick={setPicked}
      />
      <PackSection
        title="PT Dupla"
        icon={<Users size={16} />}
        packs={duplas}
        pickedId={picked?.id}
        onPick={setPicked}
      />

      {picked && (
        <div className="card sticky bottom-24 z-20 p-4 md:bottom-4">
          <div className="text-xs uppercase tracking-wide text-ink-500">Pack selecionado</div>
          <div className="mt-1 flex items-center justify-between">
            <div className="font-semibold">{picked.name}</div>
            <div className="font-display text-lg font-bold">{eur(picked.price_cents)}</div>
          </div>

          <div className="mt-4">
            <label className="label">Método de pagamento</label>
            <div className="space-y-2">
              {METHODS.map((m) => (
                <label
                  key={m.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                    method === m.id ? "border-gold-400 bg-gold-50" : "border-ink-900/10",
                  )}
                >
                  <input
                    type="radio"
                    name="method"
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
          </div>

          {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <button className="btn-gold mt-4 w-full" disabled={pending} onClick={handleBuy}>
            {pending ? "A processar…" : "Confirmar compra"}
          </button>
        </div>
      )}
    </div>
  );
}

function PackSection({
  title,
  icon,
  packs,
  pickedId,
  onPick,
}: {
  title: string;
  icon: React.ReactNode;
  packs: Pack[];
  pickedId?: string;
  onPick: (p: Pack) => void;
}) {
  if (packs.length === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
        {icon} {title}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {packs.map((p) => {
          const active = pickedId === p.id;
          const perSession = p.price_cents / p.sessions / 100;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className={cn(
                "card relative p-4 text-left transition-all",
                active && "border-gold-400 shadow-glow",
              )}
            >
              {active && (
                <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-gold-400 text-ink-900">
                  <Check size={14} />
                </span>
              )}
              <div className="text-sm font-semibold">{p.name}</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-display text-2xl font-bold">{eur(p.price_cents)}</span>
              </div>
              <div className="mt-1 text-xs text-ink-500">
                {p.sessions} {p.sessions === 1 ? "sessão" : "sessões"} ·{" "}
                {perSession.toFixed(2).replace(".", ",")}€ por sessão
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
