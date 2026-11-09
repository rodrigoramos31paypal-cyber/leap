import Link from "next/link";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { chatContext, chatStaffId } from "@/lib/chat";
import { ChatThread, chatContactLabel } from "@/components/chat-thread";

export default async function ClientMessages({ searchParams }: {
  searchParams: Promise<{ treino?: string; antes?: string; equipa?: string }>;
}) {
  const params = await searchParams;
  const requested = typeof params.equipa === "string" ? chatStaffId(params.equipa) : undefined;
  const [context, defaultContext, profile] = await Promise.all([chatContext(undefined, requested), requested ? chatContext() : Promise.resolve(null), getCurrentProfile()]);
  const chats = profile?.role === "client" && !profile.access_blocked && profile.approval_status === "approved"
    ? await getTeamChats(profile.id) : [];

  const primary = requested ? defaultContext : context;
  const otherChats = chats.filter(chat => chat.id !== primary?.staffId);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pb-1 md:h-[calc(100dvh-11rem)] md:min-h-[28rem]">
      <Link href="/app/dashboard" className="text-sm font-semibold text-gold-700 dark:text-gold-300">← Início</Link>
      <h1 className="font-display text-2xl font-bold">Mensagens</h1>
      {otherChats.length > 0 && (
        <nav aria-label="Conversas" className="flex flex-wrap gap-2">
          <Link href="/app/mensagens" className="btn-outline min-h-11">O meu PT</Link>
          {otherChats.map(chat => (
            <Link key={chat.id} href={`/app/mensagens?equipa=${chat.id}`}
              aria-current={requested === chat.id ? "page" : undefined} className="btn-outline min-h-11">
              {chatContactLabel(chat.full_name)}
            </Link>
          ))}
        </nav>
      )}
      {context ? <ChatThread context={context} bookingId={params.treino} before={params.antes} fill /> :
        <p className="card p-4 text-sm">A conversa fica disponível assim que tiveres um treinador associado.</p>}
    </div>
  );
}

async function getTeamChats(clientId: string): Promise<{ id: string; full_name: string }[]> {
  const db = createAdminClient();
  const { data, error } = await (db as any).from("leap_chat_messages")
    .select("staff_id").eq("client_id", clientId)
    .order("created_at", { ascending: false }).limit(100);
  if (error || !data?.length) return [];
  const ids = [...new Set<string>(data.map((row: { staff_id: string }) => row.staff_id))];
  const { data: team } = await db.from("profiles").select("id,full_name")
    .in("id", ids).in("role", ["owner", "trainer"]).or("access_blocked.is.null,access_blocked.eq.false");
  return (team ?? []).map(row => ({ id: row.id, full_name: row.full_name ?? "Equipa LEAP" }));
}
