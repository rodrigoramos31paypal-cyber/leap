"use client";

import { Smartphone, ExternalLink } from "lucide-react";
import { eur } from "@/lib/utils";
import { CopyButton } from "./copy-button";

type ManualMethod = "mbway" | "revolut";

const REVOLUT_URL = "https://revolut.me/joaopedromendes";

// Mostra os passos do método escolhido pelo cliente (MB WAY ou Revolut).
// A escolha é feita no momento da compra, por isso aqui não há toggle.
export function PaymentSteps({
  amountCents,
  reference,
  ptPhone,
  trainerName,
  method,
}: {
  amountCents: number;
  reference: string;
  ptPhone: string;
  trainerName: string;
  method: ManualMethod;
}) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Smartphone size={16} className="text-gold-600" />
        {method === "mbway" ? "Pagar por MB WAY" : "Pagar por Revolut"}
      </div>

      {method === "mbway" ? (
        <ol className="space-y-2 text-sm">
          <li>
            <span className="font-semibold">1.</span> Abre a app MB WAY.
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
  );
}
