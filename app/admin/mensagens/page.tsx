import Link from "next/link";
import { MessageCircle, Search } from "lucide-react";
import { requireStaff } from "@/lib/authz";
import { createAdminClient, getCurrentProfile } from "@/lib/supabase/server";
import { chatContext, chatStaffId } from "@/lib/chat";
import { ChatThread } from "@/components/chat-thread";
import { formatDateTime } from "@/lib/utils";

export default async function StaffMessages({ searchParams }: {
  searchParams: Promise<{ cliente?: string; antes?: string; nome?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile || !["owner", "trainer"].includes(profile.role)) {
    return <p className="card p-4">A caixa de entrada está disponível para os treinadores.</p>;
  }
  const staff = await requireStaff();
  const { cliente, antes, nome } = await searchParams;
  const context = cliente ? await chatContext(cliente) : null;
  if (cliente) return (
    <div className="flex h-full min-h-0 flex-col gap-3 md:h-[calc(100dvh-11rem)] md:min-h-[28rem]">
      <Link href="/admin/mensagens" className="shrink-0 text-sm font-semibold text-gold-700 dark:text-gold-300">← Caixa de entrada</Link>
      {context ? <ChatThread context={context} before={antes} fill /> : <p>Esta conversa não está disponível.</p>}
    </div>
  );
  const term = typeof nome === "string" ? nome.trim().slice(0, 80) : "";
  const search = term ? await searchClients(staff.id, staff.role === "owner", term) : null;
  const { data, error } = await (createAdminClient() as any).rpc("leap_chat_inbox", { p_staff: chatStaffId(staff.id) });
  const rows = (data ?? []) as { client_id: string; full_name: string; unread: number; last_message: string }[];
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Mensagens</h1>
      <form action="/admin/mensagens" className="flex gap-2" role="search">
        <label htmlFor="chat-client-name" className="sr-only">Pesquisar cliente por nome</label>
        <input id="chat-client-name" name="nome" type="search" maxLength={80} defaultValue={term}
          className="input min-w-0 flex-1" placeholder="Pesquisar cliente por nome" />
        <button type="submit" className="btn-primary min-h-11 shrink-0 gap-1.5">
          <Search size={16} aria-hidden="true" /> Pesquisar
        </button>
      </form>
      {search && (
        <section className="space-y-2" aria-label="Resultados da pesquisa">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Clientes encontrados</h2>
            <Link href="/admin/mensagens" className="text-xs font-semibold text-gold-700 dark:text-gold-300">Limpar pesquisa</Link>
          </div>
          {search.error ? <p role="alert" className="card p-4 text-sm">Não foi possível pesquisar. Tenta novamente.</p> :
            !search.clients.length ? <p className="card p-4 text-sm text-ink-500">Nenhum cliente encontrado.</p> :
            <ul className="space-y-2">
              {search.clients.map(client => (
                <li key={client.id}>
                  <Link href={`/admin/mensagens?cliente=${client.id}`} className="card flex min-h-12 items-center justify-between gap-2 p-3 hover:border-gold-400">
                    <span className="text-sm font-semibold">{client.full_name}</span>
                    <MessageCircle size={17} className="text-gold-700 dark:text-gold-300" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>}
        </section>
      )}
      {!search && (error ? <p role="alert">Não foi possível carregar a caixa de entrada.</p> :
        !rows.length ? <p className="card p-4 text-sm">As conversas dos teus clientes aparecem aqui.</p> :
        <ul className="space-y-2">
          {rows.map(row => <li key={row.client_id}>
            <Link href={`/admin/mensagens?cliente=${row.client_id}`} className="card flex items-center justify-between gap-3 p-4">
              <span><strong className="block">{row.full_name}</strong><time className="text-xs text-ink-500" dateTime={row.last_message}>{formatDateTime(row.last_message)}</time></span>
              {row.unread > 0 && <span className="chip-gold">{row.unread} por ler</span>}
            </Link>
          </li>)}
        </ul>)}
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
