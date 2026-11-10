import { groupForBooking, loadGroupInbox } from "@/lib/group-chat";
import { GroupChatThread } from "@/components/group-chat-thread";
import Link from "next/link";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { chatContext } from "@/lib/chat";
import { ChatThread, chatContactLabel } from "@/components/chat-thread";
import { ConversationList, type Conversation } from "@/components/conversation-list";

export default async function ClientMessages({ searchParams }: {
  searchParams: Promise<{ treino?: string; antes?: string; equipa?: string; grupo?: string; privado?: string }>;
}) {
  const params = await searchParams;
  const group = params.grupo || (params.treino && params.privado !== "1" ? await groupForBooking(params.treino) : null);
  if (group) return <GroupChatThread id={group} base="/app/mensagens" />;
  const requested = typeof params.equipa === "string" ? params.equipa : undefined;
  const context = await chatContext(undefined, requested);

  if (requested || params.treino || params.antes) return (
    <div className="flex h-full min-h-0 flex-col gap-3 pb-1 md:h-[calc(100dvh-11rem)] md:min-h-[28rem]">
      <Link href="/app/mensagens" className="shrink-0 text-sm font-semibold text-gold-700 dark:text-gold-300">← Conversas</Link>
      {context ? <ChatThread context={context} bookingId={params.treino} before={params.antes} fill /> :
        <p className="card p-4 text-sm">Esta conversa não está disponível.</p>}
    </div>
  );

  const profile = await getCurrentProfile();
  if (profile?.role !== "client" || profile.access_blocked || profile.approval_status !== "approved") {
    return <p className="card p-4 text-sm">As conversas ficam disponíveis após a aprovação da conta.</p>;
  }
  const [{ data, error }, groups] = await Promise.all([
    (createAdminClient() as any).rpc("leap_conversation_list", { p_account: profile.id, p_is_staff: false }),
    loadGroupInbox(profile.id, false),
  ]);
  const rows = ((data ?? []) as Conversation[]).map(row => ({
    ...row, full_name: chatContactLabel(row.full_name ?? "Equipa LEAP"),
  }));
  if (context && !rows.some(row => row.id === context.staffId)) {
    rows.push({ id: context.staffId, full_name: chatContactLabel(context.name ?? "Equipa LEAP"),
      unread: 0, last_message: null, preview: null, mine: false });
  }

  return (
    <div className="space-y-3">
      <Link href="/app/dashboard" className="text-sm font-semibold text-gold-700 dark:text-gold-300">← Início</Link>
      <h1 className="font-display text-3xl font-bold">Conversas</h1>
      {error || groups.error ? <p role="alert">Não foi possível carregar as conversas.</p> : <ConversationList rows={[...rows,...groups.rows].sort((a,b) => (b.last_message ?? "").localeCompare(a.last_message ?? ""))} />}
    </div>
  );
}
