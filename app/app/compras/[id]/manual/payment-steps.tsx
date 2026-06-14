"use client";

import { useState } from "react";
import { Smartphone, ExternalLink } from "lucide-react";
import { cn, eur } from "@/lib/utils";
import { CopyButton } from "./copy-button";

type ManualMethod = "mbway" | "revolut";

const REVOLUT_URL = "https://revolut.me/joaopedromendes";

export function PaymentSteps({
  amountCents,
  reference,
  ptPhone,
  trainerName,
}: {
  amountCents: number;
  reference: string;
  ptPhone: string;
  trainerName: string;
}) {
  const [method, setMethod] = useState<ManualMethod>("mbway");

  return (
    <div className="space-y-4">
      <div>
        <div className="label">Escolhe como queres pagar</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMethod("mbway")}
            className={cn(
              "rounded-lg border p-3 text-sm font-medium transition-colors",
              method === "mbway"
                ? "border-gold-400 bg-gold-50 text-ink-900"
                : "border-ink-900/10 bg-bone-50 text-ink-700 hover:border-ink-900/20",
            )}
          >
            MB Way (manual)
          </button>
          <button
            type="button"
            onClick={() => setMethod("revolut")}
            className={cn(
              "rounded-lg border p-3 text-sm font-medium transition-colors",
              method === "revolut"
                ? "border-gold-400 bg-gold-50 text-ink-900"
                : "border-ink-900/10 bg-bone-50 text-ink-700 hover:border-ink-900/20",
            )}
          >
            Revolut
          </button>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Smartphone size={16} className="text-gold-600" />
          Passos
        </div>

        {method === "mbway" ? (
          <ol className="space-y-2 text-sm">
            <li>
              <span className="font-semibold">1.</span> Abre a app MB Way.
            </li>
            <li>
              <span className="font-semibold">2.</span> Envia <strong>{eur(amountCents)}</strong> para o número:
              <div className="mt-1.5 flex items-center justify-between rounded-lg bg-bone-100 px-3 py-2">
                <span className="font-mono text-base font-bold">{ptPhone}</span>
                <CopyButton text={ptPhone.replace(/\s/g, "")} />
              </div>
            </li>
            <li>
              <span className="font-semibold">3.</span> Coloca a referência <strong>{reference}</strong> na mensagem.
            </li>
            <li>
              <span className="font-semibold">4.</span> Assim que o {trainerName} confirmar o pagamento, recebes uma notificação e as sessões somam automaticamente.
            </li>
          </ol>
        ) : (
          <ol className="space-y-2 text-sm">
            <li>
              <span className="font-semibold">1.</span> Abre o perfil de Revolut do {trainerName} carregando no botão abaixo.
            </li>
            <li>
              <span className="font-semibold">2.</span> Envia <strong>{eur(amountCents)}</strong>.
            </li>
            <li>
              <span className="font-semibold">3.</span> Coloca a referência <strong>{reference}</strong> na nota do pagamento.
              <div className="mt-1.5 flex items-center justify-between rounded-lg bg-bone-100 px-3 py-2">
                <span className="font-mono text-base font-bold">{reference}</span>
                <CopyButton text={reference} />
              </div>
            </li>
            <li>
              <span className="font-semibold">4.</span> Assim que o {trainerName} confirmar o pagamento, recebes uma notificação e as sessões somam automaticamente.
            </li>
            <li className="pt-2">
              <a
                href={REVOLUT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-gold inline-flex w-full items-center justify-center gap-2"
              >
                Abrir Revolut <ExternalLink size={14} />
              </a>
            </li>
          </ol>
        )}
      </div>
    </div>
  );
}
