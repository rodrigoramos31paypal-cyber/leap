import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { NotificationsList } from "@/components/notifications-list";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // BUG-FIX (#7): apenas as 10 mais recentes para não carregar centenas.
  // O cliente gere localmente a lista — apagar uma não traz uma antiga
  // a tomar o lugar; o utilizador vê 10 → 9 → 8…
  const { data: notifs } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // PODA: mantém só as 10 mais recentes na BD (apaga as restantes). Sem
  // isto, apagar uma das 10 trazia a 11.ª de volta ao recarregar (o
  // `limit 10` re-preenchia). Assim, apagar dá 10 → 9 → 8 e as antigas
  // não reaparecem.
  const keepIds = (notifs ?? []).map((n) => n.id);
  if (keepIds.length === 10) {
    await supabase
      .from("notifications")
      .delete()
      .eq("user_id", user.id)
      .not("id", "in", `(${keepIds.join(",")})`);
  }

  // marca todas como lidas ao abrir
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  return (
    <div className="space-y-5">
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Notificações</h1>
        <p className="text-xs text-ink-500">
          A mostrar as 10 notificações mais recentes.
        </p>
      </div>

      <NotificationsList initial={(notifs ?? []) as any} scope="app" />
    </div>
  );
}
