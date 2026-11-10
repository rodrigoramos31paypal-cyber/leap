import { groupForBooking, loadGroupInbox } from "@/lib/group-chat";
import { GroupChatThread } from "@/components/group-chat-thread";
import { getReactivationAlert, reactivationDraft } from "@/lib/reactivation";
import Link from "next/link";
import { Search } from "lucide-react";
import { requireStaff } from "@/lib/authz";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { chatContext, chatStaffId } from "@/lib/chat";
import { ChatThread } from "@/components/chat-thread";
import { ConversationList, type Conversation } from "@/components/conversation-list";

export default async function StaffMessages({ searchParams }: {
  searchParams: Promise<{ cliente?: string; antes?: string; nome?: string; reativacao?: string; grupo?: string; treino?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile || !["owner", "trainer"].includes(profile.role)) {
    return <p className="card p-4">A caixa de entrada está disponível para os treinadores.</p>;
  }
  const staff = await requireStaff();
  const { cliente, antes, nome, reativacao, grupo, treino } = await searchParams;
  const group = grupo || (treino ? await groupForBooking(treino) : null);
  if (group) return <GroupChatThread id={group} base="/admin/mensagens" />;
  const context = cliente ? await chatContext(cliente) : null;
  const alert = context && reativacao ? await getReactivationAlert(reativacao, context.clientId) : null;
  const draft = alert && context ? await reactivationDraft(alert, context.name) : undefined;
  if (cliente) return (
    <div className="flex h-full min-h-0 flex-col gap-3 md:h-[calc(100dvh-11rem)] md:min-h-[28rem]">
      <Link href="/admin/mensagens" className="shrink-0 text-sm font-semibold text-gold-700 dark:text-gold-300">← Caixa de entrada</Link>
      {context ? <ChatThread context={context} before={alert ? undefined : antes} draft={draft} reactivationId={alert?.id} fill /> : <p>Esta conversa não está disponível.</p>}
    </div>
  );
  const term = typeof nome === "string" ? nome.trim().slice(0, 80) : "";
  const [search, inbox, groups] = await Promise.all([
    term ? searchClients(staff.id, staff.role === "owner", term) : null,
    (createAdminClient() as any).rpc("leap_conversation_list", { p_account: chatStaffId(staff.id), p_is_staff: true }),
    loadGroupInbox(chatStaffId(staff.id)!, true),
  ]);
  const rows = (inbox.data ?? []) as Conversation[];
  const matched = new Set(search?.clients.map(client => client.id));
  const existing = new Set(rows.map(row => row.id));
  const visible = search ? [
    ...rows.filter(row => matched.has(row.id)),
    ...search.clients.filter(client => !existing.has(client.id)).map(client => ({
      ...client, unread: 0, last_message: null, preview: null, mine: false,
    })),
  ] : [...rows, ...groups.rows].sort((a,b) => (b.last_message ?? "").localeCompare(a.last_message ?? ""));

  return (
    <div className="space-y-3">
      <h1 className="font-display text-3xl font-bold">Conversas</h1>
      <form action="/admin/mensagens" className="relative" role="search">
        <input name="nome" type="search" maxLength={80} defaultValue={term}
          aria-label="Pesquisar cliente por nome" placeholder="Pesquisar cliente por nome"
          className="input min-h-11 rounded-full pl-4 pr-12" />
        <button type="submit" className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-full text-ink-500" aria-label="Pesquisar">
          <Search size={18} aria-hidden="true" />
        </button>
      </form>
      {term && <Link href="/admin/mensagens" className="inline-block text-xs font-semibold text-gold-700 dark:text-gold-300">Limpar pesquisa</Link>}
      {inbox.error || groups.error || search?.error ? <p role="alert">Não foi possível carregar a caixa de entrada.</p> :
        <ConversationList key={term} rows={visible} staff searched={!!term} />}
    </div>
  );
}

async function searchClients(staffId: string, isOwner: boolean, term: string) {
  const db = createAdminClient();
  const escaped = term.replace(/[\\%_]/g, "\\$&");
  let query = db.from("profiles").select("id,full_name").eq("role", "client")
    .eq("approval_status", "approved").or("access_blocked.is.null,access_blocked.eq.false")
    .not("email", "ilike", "%@removido.invalid").ilike("full_name", `%${escaped}%`);
  if (!isOwner) {
    const { data: trainers, error } = await db.from("trainers")
      .select("id,profile_id").eq("active", true);
    if (error) return { clients: [], error };
    const own = (trainers ?? []).filter(row => row.profile_id === staffId).map(row => row.id);
    if (!own.length) return { clients: [], error: null };
    query = trainers?.length === 1
      ? query.or(`trainer_id.eq.${own[0]},trainer_id.is.null`)
      : query.in("trainer_id", own);
  }
  const { data, error } = await query.order("full_name").order("id").limit(25);
  return { clients: data ?? [], error };
}
