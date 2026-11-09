import Link from "next/link";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { chatContext } from "@/lib/chat";
import { ChatThread } from "@/components/chat-thread";

export default async function ClientMessages({ searchParams }: {
  searchParams: Promise<{ treino?: string; antes?: string; equipa?: string }>;
}) {
  const params = await searchParams;
  const requested = typeof params.equipa === "string" ? params.equipa : undefined;
  const [context, profile] = await Promise.all([chatContext(undefined, requested), getCurrentProfile()]);
  const chats = profile?.role === "client" && !profile.access_blocked && profile.approval_status === "approved"
    ? await getTeamChats(profile.id) : [];

  return (
    <div className="space-y-4">
      <Link href="/app/dashboard" className="text-sm font-semibold text-gold-700 dark:text-gold-300">← Início</Link>
      <h1 className="font-display text-2xl font-bold">Mensagens</h1>
      {chats.length > 0 && (
        <nav aria-label="Conversas" className="flex flex-wrap gap-2">
          <Link href="/app/mensagens" className="btn-outline min-h-11">O meu PT</Link>
          {chats.filter(chat => chat.id !== context?.staffId || requested).map(chat => (
            <Link key={chat.id} href={`/app/mensagens?equipa=${chat.id}`}
              aria-current={requested === chat.id ? "page" : undefined} className="btn-outline min-h-11">
              {chat.full_name}
            </Link>
          ))}
        </nav>
      )}
      {context ? <ChatThread context={context} bookingId={params.treino} before={params.antes} /> :
        <p className="card p-4 text-sm">A conversa fica disponível assim que tiveres um treinador associado.</p>}
    </div>
  );
}

async function getTeamChats(clientId: string): Promise<{ id: string; full_name: string }[]> {
  const db = createAdminClient();
  const { data, error } = await (db as any).from("leap_chat_messages")
    .select("staff_id,sender_id").eq("client_id", clientId).neq("sender_id", clientId)
    .order("created_at", { ascending: false }).limit(100);
  if (error || !data?.length) return [];
  const ids = [...new Set<string>(data.map((row: { staff_id: string }) => row.staff_id))];
  const { data: team } = await db.from("profiles").select("id,full_name")
    .in("id", ids).in("role", ["owner", "trainer"]).or("access_blocked.is.null,access_blocked.eq.false");
  return (team ?? []).map(row => ({ id: row.id, full_name: row.full_name ?? "Equipa LEAP" }));
}
