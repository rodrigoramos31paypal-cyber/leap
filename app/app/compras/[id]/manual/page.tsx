import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { eur, formatDateTime } from "@/lib/utils";
import { Clock, Smartphone, CheckCircle2 } from "lucide-react";
import { CopyButton } from "./copy-button";
import { BackLink } from "@/components/back-link";

export default async function ManualPaymentPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: purchase } = await supabase
    .from("purchases")
    .select("*")
    .eq("id", params.id)
    .eq("client_id", user.id)
    .single();

  if (!purchase) redirect("/app/dashboard");

  // contacto do PT (config futura — por agora hard-coded apenas como exemplo)
  const ptPhone = process.env.NEXT_PUBLIC_PT_MBWAY_PHONE ?? "9XX XXX XXX";

  const isConfirmed = purchase.status === "confirmed";
  const isPending = purchase.status === "awaiting_confirmation";
  const isRejected = purchase.status === "rejected";

  return (
    <div className="space-y-5">
      <BackLink href="/app/historico?tab=compras" />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Concluir pagamento</h1>
        <p className="text-sm text-ink-500">Pagamento manual por MB Way.</p>
      </div>

      <div className="card p-5">
        <div className="text-xs uppercase tracking-wide text-ink-500">Pack</div>
        <div className="mt-1 flex items-center justify-between">
          <div className="font-semibold">{(purchase.pack_snapshot as any).name}</div>
          <div className="font-display text-lg font-bold">{eur(purchase.amount_cents)}</div>
        </div>
        <div className="mt-2 text-xs text-ink-500">Criado em {formatDateTime(purchase.created_at)}</div>
      </div>

      {isPending && (
        <>
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Smartphone size={16} className="text-gold-600" />
              Passos
            </div>
            <ol className="space-y-2 text-sm">
              <li>
                <span className="font-semibold">1.</span> Abre a app MB Way.
              </li>
              <li>
                <span className="font-semibold">2.</span> Envia <strong>{eur(purchase.amount_cents)}</strong> para o número:
                <div className="mt-1.5 flex items-center justify-between rounded-lg bg-bone-100 px-3 py-2">
                  <span className="font-mono text-base font-bold">{ptPhone}</span>
                  <CopyButton text={ptPhone.replace(/\s/g, "")} />
                </div>
              </li>
              <li>
                <span className="font-semibold">3.</span> Coloca a referência <strong>LEAP-{purchase.id.slice(0, 6).toUpperCase()}</strong> na mensagem.
              </li>
              <li>
                <span className="font-semibold">4.</span> Assim que o João confirmar o pagamento, recebes uma notificação e as sessões somam automaticamente.
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-semibold">
              <Clock size={16} /> A aguardar confirmação
            </div>
            <p className="mt-1">Esta página atualiza automaticamente quando o pagamento for confirmado.</p>
          </div>
        </>
      )}

      {isConfirmed && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-2 font-semibold text-emerald-800">
            <CheckCircle2 size={18} /> Pagamento confirmado!
          </div>
          <p className="mt-1 text-sm text-emerald-700">
            As {purchase.sessions_total} sessões foram adicionadas. Já podes marcar.
          </p>
          <Link href="/app/agenda" className="btn-gold mt-4">
            Marcar sessão
          </Link>
        </div>
      )}

      {isRejected && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p className="font-semibold">Compra rejeitada</p>
          {purchase.rejection_reason && <p className="mt-1">{purchase.rejection_reason}</p>}
          <Link href="/app/comprar" className="btn-outline mt-4 inline-flex">
            Voltar aos packs
          </Link>
        </div>
      )}

      <Link href="/app/dashboard" className="block text-center text-sm text-ink-500 hover:text-ink-900">
        Voltar ao início
      </Link>
    </div>
  );
}

