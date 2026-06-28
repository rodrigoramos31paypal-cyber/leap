import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { TopBar } from "@/components/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { AdminNavItem } from "@/components/admin-nav-item";
import { Toaster } from "@/components/toaster";
import { AppUpdater } from "@/components/app-updater";
import { consumeFlash } from "@/lib/flash";
import { getAalInfo, isDeviceTrusted } from "@/lib/mfa";
import { LayoutDashboard, Calendar, Users, CreditCard, BarChart3, Settings, Package, NotebookPen, Images, Store } from "lucide-react";

import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // PERF: getSessionUser/getCurrentProfile sao cached por request, leem
  // apenas cookie (sem round-trip ao auth server). Middleware ja validou.
  const user = await getSessionUser();
  if (!user) redirect("/");

  const supabase = await createClient();

  // se esta na pagina de notificacoes, marca tudo como lido ANTES de contar
  const path = (await headers()).get("x-pathname") ?? "";
  if (path.startsWith("/admin/notificacoes")) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
  }

  // PERF (QW-9 audit jun/2026): query de notificações removida — ver
  // app/app/layout.tsx para o racional. NotificationBell auto-popula.
  const profile = await getCurrentProfile();

  // 0120: lockout total (ban / conta apagada). Gate por-request → uma
  // sessão de staff bloqueada cai aqui no próximo request. Corre ANTES
  // do gate de 2FA — uma conta bloqueada nem chega ao desafio.
  if ((profile as any)?.access_blocked) {
    redirect("/auth/force-logout");
  }

  if (profile?.role !== "trainer" && profile?.role !== "owner") {
    redirect("/app/dashboard");
  }

  // 2FA gate para o admin: se tem factor verificado e o device ainda
  // não está confiado nem a sessão em AAL2, manda para o desafio.
  // Mantém o path actual em ?next para retornar depois da verificação.
  //
  // PERF (audit #1): este gate corre em CADA navegação e CADA prefetch RSC
  // dos links do admin. Antes chamava listVerifiedFactors() ->
  // mfa.listFactors() -> getUser(), um round-trip ao GoTrue por request.
  // Agora lemos o estado MFA do JWT/cookie localmente (getAalInfo) e só
  // tocamos na BD (isDeviceTrusted) quando é mesmo preciso: o user TEM 2FA
  // mas a sessão ainda não está em AAL2. Sessões já em AAL2 e users sem 2FA
  // não pagam qualquer query.
  const { currentLevel, hasMfa } = await getAalInfo();
  if (hasMfa && currentLevel !== "aal2" && !(await isDeviceTrusted(user.id))) {
    const target = path || "/admin/dashboard";
    redirect(`/login/2fa?next=${encodeURIComponent(target)}`);
  }

  const flash = await consumeFlash();

  return (
    <div className="min-h-dvh bg-bone-50 dark:bg-ink-900">
      <TopBar
        title="Admin"
        unread={0}
        notifLink="/admin/notificacoes"
        userId={user.id}
        homeHref="/admin/dashboard"
        wide
      />
      <Toaster initial={flash} />
      <AppUpdater />
      <div className="mx-auto flex w-full max-w-7xl md:gap-6 md:px-4 md:py-6">
        <aside className="hidden md:block md:w-56 md:shrink-0 md:sticky md:top-20 md:self-start md:max-h-[calc(100dvh-6rem)] md:overflow-y-auto">
          <nav className="space-y-1">
            <AdminNavItem href="/admin/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" />
            <AdminNavItem href="/admin/agenda" icon={<Calendar size={16} />} label="Agenda" />
            <AdminNavItem href="/admin/clientes" icon={<Users size={16} />} label="Clientes" />
            <AdminNavItem href="/admin/pagamentos" icon={<CreditCard size={16} />} label="Pagamentos" />
            <AdminNavItem href="/admin/packs" icon={<Package size={16} />} label="Packs" />
            <AdminNavItem href="/admin/notas" icon={<NotebookPen size={16} />} label="Notas" />
            <AdminNavItem href="/admin/relatorios" icon={<BarChart3 size={16} />} label="Relatórios" />
            <AdminNavItem href="/admin/promocoes" icon={<Images size={16} />} label="Slideshow" />
            <AdminNavItem href="/admin/loja" icon={<Store size={16} />} label="Loja" />
            <AdminNavItem href="/admin/definicoes" icon={<Settings size={16} />} label="Definições" />
          </nav>
        </aside>
        {/* pb-24 (mobile) liberta espaço para a barra inferior FIXA. */}
        <main className="min-w-0 flex-1 px-4 py-5 pb-24 md:px-0 md:py-0 md:pb-6">{children}</main>
      </div>
      <BottomNav variant="admin" />
    </div>
  );
}
