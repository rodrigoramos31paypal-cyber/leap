import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { NotificationsList } from "@/components/notifications-list";
import { hiddenInAppTypesForUser } from "@/lib/notifications-config";

export default async function AdminNotificationsPage() {
  // PERF (P-13): getSessionUser lê só o cookie (sem round-trip ao GoTrue);
  // o middleware já validou o JWT. Antes era supabase.auth.getUser().
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // BUG-FIX (#7): apenas as 10 mais recentes para não carregar centenas.
  // PERF (P-14): o UPDATE "marcar como lido" saiu daqui — o admin layout
  // (`app/admin/layout.tsx`) já o faz quando o path é /admin/notificacoes.
  // Esta página é agora só leitura.
  const { data: notifs } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // O sininho espelha o push: esconde categorias com push desligado.
  // Tipos `null` (sem categoria) ficam sempre visíveis.
  const hidden = new Set(await hiddenInAppTypesForUser(supabase, user.id));
  const visible = ((notifs ?? []) as any[]).filter(
    (n) => !n.type || !hidden.has(n.type),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Notificações</h1>
        <p className="text-xs text-ink-500">
          A mostrar as 10 notificações mais recentes.
        </p>
      </div>

      <NotificationsList initial={visible as any} scope="admin" />
    </div>
  );
}
