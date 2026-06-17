import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NotificationsList } from "@/components/notifications-list";

export default async function AdminNotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // BUG-FIX (#7): apenas as 10 mais recentes para não carregar centenas.
  const { data: notifs } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // marca todas como lidas ao abrir
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Notificações</h1>
        <p className="text-xs text-ink-500">
          A mostrar as 10 notificações mais recentes.
        </p>
      </div>

      <NotificationsList initial={(notifs ?? []) as any} scope="admin" />
    </div>
  );
}
