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

// Cada pack EXPANDE para baixo ao ser clicado (mostra método de pagamento +
// Cancelar + Comprar), em vez de uma barra fixa no fundo (que "saltava" no
// scroll do iOS). Só um pack expandido de cada vez.
export function PackList({ packs }: { packs: Pack[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("manual_mbway");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<Tab>("individual");

  const individuals = packs.filter((p) => p.session_type === "individual");
  const duplas = packs.filter((p) => p.session_type === "dupla");
  const hasDupla = duplas.length > 0;
  const effectiveTab: Tab = hasDupla ? tab : "individual";
  const shown = effectiveTab === "individual" ? individuals : duplas;

  function toggle(id: string) {
    setError(null);
    setOpenId((cur) => (cur === id ? null : id));
  }

  function handleBuy(packId: string) {
    setError(null);
    start(async () => {
      const res = await startPurchaseAction({ packId, method });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(res.redirect!);
    });
  }

  function switchTab(t: Tab) {
    setTab(t);
    setOpenId(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      {hasDupla && (
        <div className="inline-flex w-full items-center gap-1 rounded-xl border border-ink-900/10 bg-bone-100 p-1 text-sm sm:w-auto dark:border-white/10 dark:bg-ink-900">
          <button
            type="button"
            onClick={() => switchTab("individual")}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 font-semibold transition sm:flex-none",
              effectiveTab === "individual" ? "bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50" : "text-ink-500 hover:text-ink-900 dark:hover:text-bone-50",
            )}
          >
            <User size={16} /> PT Individual
          </button>
          <button
            type="button"
            onClick={() => switchTab("dupla")}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 font-semibold transition sm:flex-none",
              effectiveTab === "dupla" ? "bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-bone-50" : "text-ink-500 hover:text-ink-900 dark:hover:text-bone-50",
            )}
          >
            <Users size={16} /> PT Dupla
          </button>
        </div>
      )}

      {effectiveTab === "dupla" && (
        <p className="rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2 text-xs text-ink-600 dark:border-white/10 dark:bg-white/5 dark:text-bone-100/70">
          Sessões para treinar a dois. Cada pessoa compra o seu pack — quando marcam juntos,
          gasta 1 sessão a cada um.
        </p>
      )}

      {shown.length === 0 ? (
        <div className="card p-5 text-center text-sm text-ink-500">
          {effectiveTab === "dupla"
            ? "Este treinador ainda não tem packs PT Dupla."
            : "Sem packs nesta categoria."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              expanded={openId === p.id}
              onToggle={() => toggle(p.id)}
              method={method}
              setMethod={setMethod}
              error={openId === p.id ? error : null}
              pending={pending}
              onBuy={() => handleBuy(p.id)}
              onCancel={() => setOpenId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PackCard({
  pack: p,
  expanded,
  onToggle,
  method,
  setMethod,
  error,
  pending,
  onBuy,
  onCancel,
}: {
  pack: Pack;
  expanded: boolean;
  onToggle: () => void;
  method: PaymentMethod;
  setMethod: (m: PaymentMethod) => void;
  error: string | null;
  pending: boolean;
  onBuy: () => void;
  onCancel: () => void;
}) {
  const perSession = p.price_cents / p.sessions / 100;
  return (
    <div className={cn("card relative overflow-hidden p-4 transition-all", expanded && "border-gold-400 shadow-glow")}>
      <button type="button" onClick={onToggle} className="w-full text-left">
        {expanded && (
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

      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="label">Método de pagamento</div>
          <div className="space-y-2">
            {METHODS.map((m) => (
              <label
                key={m.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-2.5",
                  method === m.id ? "border-gold-400 bg-gold-50 dark:bg-gold-400/10" : "border-ink-900/10 dark:border-white/10",
                )}
              >
                <input
                  type="radio"
                  name={`method-${p.id}`}
                  value={m.id}
                  checked={method === m.id}
                  onChange={() => setMethod(m.id)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium">{m.label}</div>
                  <div className="text-xs text-ink-500 dark:text-bone-100/60">{m.helper}</div>
                </div>
              </label>
            ))}
          </div>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={onCancel} disabled={pending} className="btn-outline flex-1">
              Cancelar
            </button>
            <button onClick={onBuy} disabled={pending} className="btn-gold flex-1">
              {pending ? "A processar…" : "Comprar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
