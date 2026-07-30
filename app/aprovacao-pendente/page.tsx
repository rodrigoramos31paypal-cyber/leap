import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { getSessionUser, getCurrentProfile } from "@/lib/supabase/server";

import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Conta em aprovação",
  robots: { index: false, follow: false },
};

// ════════════════════════════════════════════════════════════════
// Ecrã de espera para contas por aprovar. Fica FORA do layout de /app
// (que redireciona clientes pendentes para aqui), para não haver loop.
// ════════════════════════════════════════════════════════════════
export default async function AprovacaoPendentePage() {
  const user = await getSessionUser();
  if (!user) redirect("/");

  const profile = await getCurrentProfile();
  // Já aprovado → segue para a app. Conta bloqueada → força logout.
  if ((profile as any)?.access_blocked) redirect("/auth/force-logout");
  if (profile?.role && profile.role !== "client") redirect("/admin/dashboard");
  if ((profile as any)?.approval_status !== "pending") redirect("/app/dashboard");

  return (
    <div className="grid min-h-dvh place-items-center bg-bone-50 px-4 dark:bg-ink-900">
      <div className="card w-full max-w-md space-y-4 p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold-50 text-gold-600 dark:bg-gold-400/10">
          <Clock size={26} />
        </div>
        <h1 className="font-display text-xl font-bold tracking-tight">
          Conta em aprovação
        </h1>
        <p className="text-sm text-ink-500">
          Obrigado por confirmares o teu email. A tua conta está a aguardar
          aprovação da equipa. Assim que for aprovada, poderás entrar e marcar
          sessões. Se tiveres dúvidas, fala diretamente com o teu treinador.
        </p>
        <a href="/auth/logout" className="btn-outline inline-block w-full">
          Terminar sessão
        </a>
      </div>
    </div>
  );
}
