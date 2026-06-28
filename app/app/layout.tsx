import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { TopBar } from "@/components/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { ViewportKeyboard } from "@/components/viewport-keyboard";
import { SwNavigator } from "@/components/sw-navigator";
import { AppUpdater } from "@/components/app-updater";
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
  if (!user) redirect("/login");

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

  const flash = await consumeFlash();

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bone-50 dark:bg-ink-900">
      <ViewportKeyboard />
      <SwNavigator />
      <AppUpdater />
      <TopBar unread={0} userId={user.id} homeHref="/app/dashboard" />
      <ClientTopNav />
      <Toaster initial={flash} />
      <ReminderSync />
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-6xl px-4 pt-1 pb-6">{children}</div>
      </main>
      <BottomNav variant="client" />
    </div>
  );
}
