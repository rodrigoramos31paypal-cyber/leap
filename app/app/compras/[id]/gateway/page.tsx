import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { eur, formatDateTime } from "@/lib/utils";
import { CheckCircle2, Clock, Smartphone, FileText, CreditCard } from "lucide-react";

export default async function GatewayPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { method?: string; status?: string };
}) {
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

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("purchase_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const method = searchParams.method ?? purchase.payment_method;
  const isConfirmed = purchase.status === "confirmed";
  const gw = payment?.gateway_payload as any;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Pagamento</h1>
        <p className="text-sm text-ink-500">{(purchase.pack_snapshot as any).name}</p>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-ink-500">Total a pagar</div>
          <div className="font-display text-2xl font-bold">{eur(purchase.amount_cents)}</div>
        </div>
        <div className="mt-2 text-xs text-ink-500">Criado em {formatDateTime(purchase.created_at)}</div>
      </div>

      {isConfirmed ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-2 font-semibold text-emerald-800">
            <CheckCircle2 size={18} /> Pagamento confirmado
          </div>
          <p className="mt-1 text-sm text-emerald-700">
            As sessões foram adicionadas à tua conta.
          </p>
          <Link href="/app/agenda" className="btn-gold mt-4">Marcar sessão</Link>
        </div>
      ) : method === "mbway" ? (
        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Smartphone size={16} className="text-gold-600" /> MB Way
          </div>
          <p className="text-sm">Aprovação enviada para o teu telemóvel. Abre a app MB Way e confirma o pagamento.</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-ink-500">
            <Clock size={14} /> A aguardar confirmação automática…
          </div>
        </div>
      ) : method === "multibanco" ? (
        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-2 font-semibold">
            <FileText size={16} className="text-gold-600" /> Referência Multibanco
          </div>
          {gw?.Entity || gw?.entity ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-bone-100 p-3">
                <div className="text-[10px] uppercase tracking-wide text-ink-500">Entidade</div>
                <div className="font-mono text-lg font-bold">{gw?.Entity ?? gw?.entity}</div>
              </div>
              <div className="rounded-lg bg-bone-100 p-3">
                <div className="text-[10px] uppercase tracking-wide text-ink-500">Referência</div>
                <div className="font-mono text-lg font-bold">{gw?.Reference ?? gw?.reference}</div>
              </div>
              <div className="rounded-lg bg-bone-100 p-3">
                <div className="text-[10px] uppercase tracking-wide text-ink-500">Valor</div>
                <div className="font-mono text-lg font-bold">{eur(purchase.amount_cents)}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-500">A gerar referência…</p>
          )}
          <p className="text-xs text-ink-500">Paga em qualquer caixa Multibanco ou homebanking. A confirmação é automática.</p>
        </div>
      ) : method === "card" ? (
        <div className="card p-5">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <CreditCard size={16} className="text-gold-600" /> Cartão Bancário
          </div>
          {searchParams.status === "err" ? (
            <p className="text-sm text-red-700">Pagamento não concluído. Tenta novamente ou escolhe outro método.</p>
          ) : (
            <p className="text-sm">A processar pagamento…</p>
          )}
        </div>
      ) : null}

      <Link href="/app/dashboard" className="block text-center text-sm text-ink-500">
        Voltar ao início
      </Link>
    </div>
  );
}
