import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { TopBar } from "@/components/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { ViewportKeyboard } from "@/components/viewport-keyboard";
import { SwNavigator } from "@/components/sw-navigator";
import { AppUpdater } from "@/components/app-updater";
import { PushAutoHeal } from "@/components/push-auto-heal";
import { Toaster } from "@/components/toaster";
import { ReminderSync } from "@/components/reminder-sync";
import { ClientTopNav } from "@/components/client-top-nav";
import { consumeFlash } from "@/lib/flash";

import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  // PERF: getSessionUser/getCurrentProfile sao cached por request, leem
  // apenas cookie (sem round-trip ao auth server). Middleware ja validou.
  const user = await getSessionUser();
  if (!user) redirect("/");

  const supabase = await createClient();

  // se esta na pagina de notificacoes, marca tudo como lido ANTES de contar
  const path = (await headers()).get("x-pathname") ?? "";
  if (path.startsWith("/app/notificacoes")) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
  }

  // PERF (QW-9, audit jun/2026): a query de notifications saiu daqui.
  // Bloqueava o paint do shell em cada navegação RSC só para mostrar o
  // badge do sino. O NotificationBell popula o contador via realtime +
  // polling + visibilitychange + chamada imediata em mount.
  const profile = await getCurrentProfile();

  // 0120: lockout total (ban / conta apagada). Gate por-request → a
  // sessão aberta cai aqui no próximo request, mesmo que o access token
  // ainda seja válido. /auth/force-logout limpa os cookies → /login.
  if ((profile as any)?.access_blocked) {
    redirect("/auth/force-logout");
  }

  if (profile?.role && profile.role !== "client") {
    redirect("/admin/dashboard");
  }

  // 0138: aprovação de conta. Um cliente que se auto-registou fica pendente
  // até um admin aprovar — bloqueado da app até lá (ecrã de espera). Contas
  // criadas por admin e as já existentes ficam approved (default), por isso
  // não são afectadas.
  if (profile?.role === "client" && (profile as any)?.approval_status === "pending") {
    redirect("/aprovacao-pendente");
  }

  const flash = await consumeFlash();

  return (
    <div className="min-h-dvh bg-bone-50 dark:bg-ink-900">
      <ViewportKeyboard />
      <SwNavigator />
      <AppUpdater />
      <PushAutoHeal />
      <TopBar unread={0} userId={user.id} homeHref="/app/dashboard" />
      <ClientTopNav />
      <Toaster initial={flash} />
      <ReminderSync />
      {/* pb-24 (mobile) liberta espaço para a barra inferior FIXA não tapar
          o conteúdo; md:pb-6 no desktop, onde a barra fixa está escondida. */}
      <main className="mx-auto max-w-6xl px-4 pt-1 pb-24 md:pb-6">{children}</main>
      <BottomNav variant="client" />
    </div>
  );
}
