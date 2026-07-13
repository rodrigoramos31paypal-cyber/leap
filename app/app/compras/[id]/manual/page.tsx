import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { eur, formatDateTime } from "@/lib/utils";
import { Clock, CheckCircle2 } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { PaymentSteps } from "./payment-steps";

export default async function ManualPaymentPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: purchase } = await supabase
    .from("purchases")
    .select("*")
    .eq("id", params.id)
    .eq("client_id", user.id)
    .single();

  if (!purchase) redirect("/app/dashboard");

  // Nome do trainer (dinâmico): purchases.trainer_id → trainers.profile_id → profiles.full_name
  let trainerName = "trainer";
  if ((purchase as any).trainer_id) {
    const { data: trainerRow } = await (supabase as any)
      .from("trainers")
      .select("profile_id")
      .eq("id", (purchase as any).trainer_id)
      .maybeSingle();
    if (trainerRow?.profile_id) {
      const { data: prof } = await (supabase as any)
        .from("profiles")
        .select("full_name")
        .eq("id", trainerRow.profile_id)
        .maybeSingle();
      if (prof?.full_name) {
        // Primeiro nome para soar natural na frase ("Assim que o João confirmar…").
        trainerName = String(prof.full_name).split(" ")[0];
      }
    }
  }

  // Numero MB WAY do estúdio. Configurável via NEXT_PUBLIC_PT_MBWAY_PHONE
  // (Vercel → Environment Variables); o default é o número real para que
  // funcione mesmo sem a env definida.
  const ptPhone = process.env.NEXT_PUBLIC_PT_MBWAY_PHONE ?? "912 478 768";

  const isConfirmed = purchase.status === "confirmed";
  const isPending = purchase.status === "awaiting_confirmation";
  const isRejected = purchase.status === "rejected";

  const reference = `LEAP-${purchase.id.slice(0, 6).toUpperCase()}`;
  const method: "mbway" | "revolut" =
    (purchase as any).payment_method === "manual_revolut" ? "revolut" : "mbway";

  return (
    <div className="space-y-5">
      <BackLink href="/app/historico?tab=compras" />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Concluir pagamento</h1>
        <p className="text-sm text-ink-500">Pagamento manual por {method === "revolut" ? "Revolut" : "MB WAY"}.</p>
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
          <PaymentSteps
            amountCents={purchase.amount_cents}
            reference={reference}
            ptPhone={ptPhone}
            trainerName={trainerName}
            method={method}
          />

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
