import Link from "next/link";
import { requireStaff } from "@/lib/authz";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { chatContext } from "@/lib/chat";
import { ChatThread } from "@/components/chat-thread";
import { formatDateTime } from "@/lib/utils";

export default async function StaffMessages({ searchParams }: {
  searchParams: Promise<{ cliente?: string; antes?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile || !["owner", "trainer"].includes(profile.role)) {
    return <p className="card p-4">A caixa de entrada está disponível para os treinadores.</p>;
  }
  const staff = await requireStaff();
  const { cliente, antes } = await searchParams;
  const context = cliente ? await chatContext(cliente) : null;
  if (cliente) return (
    <div className="space-y-4">
      <Link href="/admin/mensagens" className="text-sm font-semibold text-gold-700 dark:text-gold-300">← Caixa de entrada</Link>
      {context ? <ChatThread context={context} before={antes} /> : <p>Esta conversa não está disponível.</p>}
    </div>
  );
  const { data, error } = await (createAdminClient() as any).rpc("leap_chat_inbox", { p_staff: staff.id });
  const rows = (data ?? []) as { client_id: string; full_name: string; unread: number; last_message: string }[];
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Mensagens</h1>
      {error ? <p role="alert">Não foi possível carregar a caixa de entrada.</p> :
        !rows.length ? <p className="card p-4 text-sm">As conversas dos teus clientes aparecem aqui.</p> :
        <ul className="space-y-2">
          {rows.map(row => <li key={row.client_id}>
            <Link href={`/admin/mensagens?cliente=${row.client_id}`} className="card flex items-center justify-between gap-3 p-4">
              <span><strong className="block">{row.full_name}</strong><time className="text-xs text-ink-500" dateTime={row.last_message}>{formatDateTime(row.last_message)}</time></span>
              {row.unread > 0 && <span className="chip-gold">{row.unread} por ler</span>}
            </Link>
          </li>)}
        </ul>}
    </div>
  );
}
