import { EnrollmentSummary } from "@/components/enrollment/summary";
import { enrollmentDraft } from "@/lib/enrollment-options";
import { getProspect, prospectDraft } from "@/lib/prospects";
import { loadBroadcastRecipients } from "./broadcast-actions";
import { BroadcastForm } from "./broadcast-form";
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
  searchParams: Promise<{ cliente?: string; antes?: string; nome?: string; reativacao?: string; grupo?: string; treino?: string; envio?: string; inscricao?: string; novo?: string; pack?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile || !["owner", "trainer"].includes(profile.role)) {
    return <p className="card p-4">A caixa de entrada está disponível para os treinadores.</p>;
  }
  const staff = await requireStaff();
  const { cliente, antes, nome, reativacao, grupo, treino, envio, inscricao, novo, pack } = await searchParams;
  if (envio === "1" && staff.role === "owner") {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link href="/admin/mensagens" className="text-sm font-semibold text-gold-700 dark:text-gold-300">← Conversas</Link>
        <h1 className="font-display text-2xl font-bold">Mensagem a clientes</h1>
        <BroadcastForm clients={await loadBroadcastRecipients()} />
      </div>
    );
  }
  const group = grupo || (treino ? await groupForBooking(treino) : null);
  if (group) return <GroupChatThread id={group} base="/admin/mensagens" />;
  const context = cliente ? await chatContext(cliente) : null;
  const alert = context && reativacao ? await getReactivationAlert(reativacao, context.clientId) : null;
  const { data: enrollment } = context?.pending ? await (createAdminClient() as any).from("leap_enrollment_requests").select("interest,goal,availability").eq("client_id",context.clientId).maybeSingle() : {data:null};
  const prospect = context && novo === "1" ? await getProspect(context.clientId) : null;
  const { data: offeredPacks } = prospect?.trainer_id && prospect.completed_sessions > 0
    ? await createAdminClient().from("packs").select("id,name,price_cents,sessions")
      .eq("trainer_id", prospect.trainer_id).eq("active", true).gt("sessions", 1).gt("price_cents", 0)
      .order("sessions")
    : { data: null };
  const chosenPack = offeredPacks?.find(row => row.id === pack);
  let prospectMessage = prospect ? prospectDraft(prospect) : undefined;
  if (prospect && chosenPack) {
    const price = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(chosenPack.price_cents / 100);
    prospectMessage = `Olá, ${prospect.full_name?.trim().split(/\s+/)[0] || "atleta"}! Como te sentiste depois do treino? 💪 Para continuarmos, tens o ${chosenPack.name}, com ${chosenPack.sessions} sessões por ${price}. Queres que te ajude a escolher os horários? Podes ver e comprar os packs na app: https://leapfitnesstudio.com/app/comprar?trainer=${prospect.trainer_id}`;
  }
  const draft = prospectMessage ?? (alert && context ? await reactivationDraft(alert, context.name) : context?.pending && inscricao === "1" ? enrollmentDraft(context.name ?? "") : undefined);
  if (cliente) return (
    <div className="flex h-full min-h-0 flex-col gap-3 md:h-[calc(100dvh-11rem)] md:min-h-[28rem]">
      <Link href="/admin/mensagens" className="shrink-0 text-sm font-semibold text-gold-700 dark:text-gold-300">← Caixa de entrada</Link>
      {context?.pending && <details className="shrink-0 text-sm"><summary className="cursor-pointer font-semibold">Pré-inscrição · ver respostas</summary><div className="mt-2"><EnrollmentSummary request={enrollment} /></div></details>}
      {context?.pending && inscricao === "1" && <p className="shrink-0 text-xs text-ink-500">Mensagem preparada · podes editar. Só é enviada ao tocar em enviar.</p>}
      {prospect && <div className="shrink-0 space-y-2 rounded-xl border border-gold-400/30 p-3">
        <Link href="/admin/novos-clientes" className="text-xs font-semibold text-gold-700 dark:text-gold-300">← Novos clientes</Link>
        <p className="text-xs text-ink-500">Rascunho preparado · revê e edita antes de enviar. Não atribui sessões nem aprova a conta.</p>
        {!!offeredPacks?.length && <form action="/admin/mensagens" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="cliente" value={prospect.client_id} /><input type="hidden" name="novo" value="1" />
          <label className="min-w-0 flex-1 text-xs font-medium">Pack a apresentar
            <select name="pack" defaultValue={chosenPack?.id ?? ""} className="input mt-1 w-full"><option value="">Sem pack específico</option>{offeredPacks.map(row => <option key={row.id} value={row.id}>{row.name} · {new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(row.price_cents / 100)}</option>)}</select>
          </label><button type="submit" className="btn-outline min-h-11 text-xs">Preparar rascunho</button>
          <p className="w-full text-[11px] text-ink-500">Preparar outro rascunho substitui o texto ainda não enviado.</p>
        </form>}
      </div>}
      {context ? <ChatThread context={context} before={alert || prospect ? undefined : antes} draft={draft} draftKey={prospect ? `prospect:${chosenPack?.id ?? "intro"}` : undefined} reactivationId={alert?.id} fill /> : <p>Esta conversa não está disponível.</p>}
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-3xl font-bold">Conversas</h1>
        {staff.role === "owner" && <Link href="/admin/mensagens?envio=1" className="btn-outline">Mensagem a clientes</Link>}
      </div>
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
