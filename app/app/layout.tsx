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
    <div className="flex h-[100lvh] flex-col overflow-hidden bg-bone-50 dark:bg-ink-900 md:block md:h-auto md:min-h-[100lvh] md:overflow-visible">
      <ViewportKeyboard />
      <SwNavigator />
      <AppUpdater />
      <PushAutoHeal />
      <TopBar unread={0} userId={user.id} homeHref="/app/dashboard" />
      <ClientTopNav />
      <Toaster initial={flash} />
      <ReminderSync />
      {/* Mobile: main é o contentor de SCROLL (flex-1 + min-h-0) numa coluna
          de altura = viewport (100lvh). A barra fica em fluxo no fundo → não
          pode flutuar. Desktop (md): scroll normal do documento. */}
      <main className="mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto overflow-x-hidden px-4 pt-1 pb-6 md:flex-none md:overflow-visible">{children}</main>
      <BottomNav variant="client" />
    </div>
  );
}
