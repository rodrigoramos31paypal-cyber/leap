import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { NotificationsList } from "@/components/notifications-list";
import { hiddenInAppTypesForUser } from "@/lib/notifications-config";

export default async function NotificationsPage() {
  // PERF (P-13): getSessionUser le so o cookie (sem round-trip ao GoTrue);
  // o middleware ja validou o JWT. Antes era supabase.auth.getUser().
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // BUG-FIX (#7): apenas as 10 mais recentes para nao carregar centenas.
  // O cliente gere localmente a lista — apagar uma nao traz uma antiga
  // a tomar o lugar; o utilizador ve 10 -> 9 -> 8...
  //
  // PERF (P-27): a PODA (manter so 10 na BD) saiu daqui — corria um DELETE
  // em cada render. Passou para o trigger AFTER INSERT
  // `prune_notifications_keep_recent` (migration 0111). KEEP=10 tem de bater
  // certo com o `.limit(10)` abaixo.
  //
  // PERF (P-14): o UPDATE "marcar como lido" tambem saiu — o layout
  // (`app/app/layout.tsx`) ja o faz quando o path e /app/notificacoes, e
  // corria duplicado aqui. Esta pagina e agora so leitura.
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
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Notificações</h1>
        <p className="text-xs text-ink-500">
          A mostrar as 10 notificações mais recentes.
        </p>
      </div>

      <NotificationsList initial={visible as any} scope="app" />
    </div>
  );
}
