"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Users, User } from "lucide-react";
import { cn, eur } from "@/lib/utils";
import { startPurchaseAction } from "./actions";
import type { Pack, PaymentMethod } from "@/types/database";

const METHODS: { id: PaymentMethod; label: string; helper: string }[] = [
  { id: "manual_mbway", label: "MB WAY", helper: "Pagas por MB WAY — confirmação manual em minutos" },
  { id: "manual_revolut", label: "Revolut", helper: "Pagas por Revolut — confirmação manual em minutos" },
];

type Tab = "individual" | "dupla";

export function PackList({ packs }: { packs: Pack[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Pack | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("manual_mbway");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Separador activo — por defeito mostra sempre PT Individual.
  const [tab, setTab] = useState<Tab>("individual");

  const individuals = packs.filter((p) => p.session_type === "individual");
  const duplas = packs.filter((p) => p.session_type === "dupla");
  const shown = tab === "individual" ? individuals : duplas;

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
      <div className="inline-flex w-full items-center gap-1 rounded-xl border border-ink-900/10 bg-bone-100 p-1 text-sm sm:w-auto">
        <button
          type="button"
          onClick={() => setTab("individual")}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 font-semibold transition sm:flex-none",
            tab === "individual" ? "bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50" : "text-ink-500 hover:text-ink-900",
          )}
        >
          <User size={16} /> PT Individual
        </button>
        <button
          type="button"
          onClick={() => setTab("dupla")}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 font-semibold transition sm:flex-none",
            tab === "dupla" ? "bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50" : "text-ink-500 hover:text-ink-900",
          )}
        >
          <Users size={16} /> PT Dupla
        </button>
      </div>

      {tab === "dupla" && (
        <p className="rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2 text-xs text-ink-600">
          Sessões para treinar a dois. Cada pessoa compra o seu pack — quando marcam juntos,
          gasta 1 sessão a cada um.
        </p>
      )}

      {shown.length === 0 ? (
        <div className="card p-5 text-center text-sm text-ink-500">
          {tab === "dupla"
            ? "Este treinador ainda não tem packs PT Dupla."
            : "Sem packs nesta categoria."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((p) => (
            <PackCard key={p.id} pack={p} active={picked?.id === p.id} onPick={setPicked} />
          ))}
        </div>
      )}

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

function PackCard({
  pack: p,
  active,
  onPick,
}: {
  pack: Pack;
  active: boolean;
  onPick: (p: Pack) => void;
}) {
  const perSession = p.price_cents / p.sessions / 100;
  return (
    <button
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
}
