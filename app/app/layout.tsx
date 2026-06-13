import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { TopBar } from "@/components/top-bar";
import { BottomNav } from "@/components/bottom-nav";
import { Toaster } from "@/components/toaster";
import { ReminderSync } from "@/components/reminder-sync";
import { consumeFlash } from "@/lib/flash";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  // PERF: getSessionUser/getCurrentProfile sao cached por request, leem
  // apenas cookie (sem round-trip ao auth server). Middleware ja validou.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  // se esta na pagina de notificacoes, marca tudo como lido ANTES de contar
  const path = headers().get("x-pathname") ?? "";
  if (path.startsWith("/app/notificacoes")) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
  }

  const [profile, { count: unread }] = await Promise.all([
    getCurrentProfile(),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
  ]);

  if (profile?.role && profile.role !== "client") {
    redirect("/admin/dashboard");
  }

  const flash = consumeFlash();

  return (
    <div className="min-h-screen bg-bone-50 pb-20 dark:bg-ink-900 md:pb-0">
      <TopBar unread={unread ?? 0} userId={user.id} homeHref="/app/dashboard" />
      <Toaster initial={flash} />
      <ReminderSync />
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
      <BottomNav variant="client" />
    </div>
  );
}
