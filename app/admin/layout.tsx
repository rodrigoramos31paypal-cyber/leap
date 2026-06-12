import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { TopBar } from "@/components/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { AdminNavItem } from "@/components/admin-nav-item";
import { Toaster } from "@/components/toaster";
import { consumeFlash } from "@/lib/flash";
import { LayoutDashboard, Calendar, Users, CreditCard, BarChart3, Settings, Package, UserCog, NotebookPen } from "lucide-react";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // PERF: getSessionUser/getCurrentProfile sao cached por request, leem
  // apenas cookie (sem round-trip ao auth server). Middleware ja validou.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  // se esta na pagina de notificacoes, marca tudo como lido ANTES de contar
  const path = headers().get("x-pathname") ?? "";
  if (path.startsWith("/admin/notificacoes")) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
  }

  const [profile, { count: unread }] = await Promise.all([
    getCurrentProfile(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);

  if (profile?.role !== "trainer" && profile?.role !== "owner") {
    redirect("/app/dashboard");
  }

  const isOwner = profile?.role === "owner";
  const flash = consumeFlash();

  return (
    <div className="min-h-screen bg-bone-50 pb-20 dark:bg-ink-900 md:pb-0">
      <TopBar
        title="Admin"
        unread={unread ?? 0}
        notifLink="/admin/notificacoes"
        userId={user.id}
        homeHref="/admin/dashboard"
      />
      <Toaster initial={flash} />
      <div className="mx-auto max-w-7xl md:flex md:gap-6 md:px-4 md:py-6">
        <aside className="hidden md:block md:w-56 md:shrink-0">
          <nav className="space-y-1">
            <AdminNavItem href="/admin/dashboard" icon={<LayoutDashboard size={16} />} label="Dashboard" />
            <AdminNavItem href="/admin/agenda" icon={<Calendar size={16} />} label="Agenda" />
            <AdminNavItem href="/admin/clientes" icon={<Users size={16} />} label="Clientes" />
            <AdminNavItem href="/admin/pagamentos" icon={<CreditCard size={16} />} label="Pagamentos" />
            <AdminNavItem href="/admin/packs" icon={<Package size={16} />} label="Packs" />
            <AdminNavItem href="/admin/notas" icon={<NotebookPen size={16} />} label="Notas" />
            <AdminNavItem href="/admin/relatorios" icon={<BarChart3 size={16} />} label="Relatórios" />
            {isOwner && (
              <AdminNavItem href="/admin/equipa" icon={<UserCog size={16} />} label="Equipa" />
            )}
            <AdminNavItem href="/admin/definicoes" icon={<Settings size={16} />} label="Definições" />
          </nav>
        </aside>
        <main className="flex-1 px-4 py-5 md:px-0 md:py-0">{children}</main>
      </div>
      <BottomNav variant="admin" />
    </div>
  );
}
