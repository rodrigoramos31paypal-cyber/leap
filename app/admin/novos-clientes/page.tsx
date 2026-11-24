import Link from "next/link";
import { MessageCircle, CalendarClock } from "lucide-react";
import { loadProspects } from "@/lib/prospects";
import { ProspectActions } from "./prospect-actions";
import { DeleteProspect } from "./delete-prospect";
import { getCurrentProfile } from "@/lib/supabase/server";

const date = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "short" });
const dateTime = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", dateStyle: "short", timeStyle: "short" });

export default async function NewClients({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  let rows;
  try { rows = await loadProspects(); } catch {
    return <div className="space-y-4"><Link href="/admin/dashboard" className="text-sm text-gold-700 dark:text-gold-300">← Dashboard</Link><h1 className="font-display text-2xl font-bold">Novos clientes</h1><p role="alert" className="card p-4">Não foi possível carregar a lista. Atualiza a página.</p></div>;
  }
  const archived = tab === "adiados";
  const canDelete = (await getCurrentProfile())?.role === "owner";
  const active = rows.filter(row => row.disposition === "active");
  const archive = rows.filter(row => row.disposition !== "active");
  const visible = archived ? archive : active;
  const sections = [
    { title: "Ainda não experimentaram", description: "Combina uma primeira sessão e conhece o objetivo de cada pessoa.", rows: visible.filter(row => row.completed_sessions === 0) },
    { title: "Já experimentaram", description: "Uma sessão realizada · ajuda a escolher o primeiro pack.", rows: visible.filter(row => row.completed_sessions === 1) },
  ];
  return <div className="mx-auto max-w-3xl space-y-5">
    <Link href="/admin/dashboard" className="inline-block text-sm font-semibold text-gold-700 dark:text-gold-300">← Dashboard</Link>
    <div><h1 className="font-display text-2xl font-bold">Novos clientes</h1><p className="mt-1 text-sm text-ink-500">Do primeiro contacto ao primeiro pack.</p></div>
    <div className="flex flex-wrap gap-2" aria-label="Filtrar novos clientes">
      <Link aria-current={!archived ? "page" : undefined} href="/admin/novos-clientes" className={!archived ? "btn-primary" : "btn-outline"}>Por acompanhar · {active.length}</Link>
      <Link aria-current={archived ? "page" : undefined} href="/admin/novos-clientes?tab=adiados" className={archived ? "btn-primary" : "btn-outline"}>Adiados / sem interesse · {archive.length}</Link>
    </div>
    <p className="text-xs leading-relaxed text-ink-500">Registos sem compra confirmada de um pack pago, com até uma sessão realizada. Inclui pessoas que se registaram e nunca voltaram, mesmo sem confirmar o email, e registos de meses anteriores. Compras em processamento ficam fora desta lista.</p>
    {sections.map(section => <section key={section.title} className="space-y-3">
      <header><h2 className="text-base font-bold">{section.title} <span className="text-ink-500">· {section.rows.length}</span></h2><p className="text-xs text-ink-500">{section.description}</p></header>
      {!section.rows.length ? <p className="card p-4 text-sm text-ink-500">Sem clientes nesta lista.</p> : <ul className="space-y-3">{section.rows.map(row => <li key={row.client_id} className="card space-y-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><Link href={row.approval_status === "pending" ? `/admin/clientes?tab=pendentes#pedido-${row.client_id}` : `/admin/clientes/${row.client_id}`} className="break-words text-sm font-semibold underline decoration-gold-500/50 underline-offset-4">{row.full_name || "Cliente"}</Link>
            <p className="mt-1 text-xs text-ink-500">Registo · {date.format(new Date(row.registered_at))}</p>
          </div>
          {row.approval_status === "pending" && <span className="rounded-full bg-gold-400/10 px-2 py-1 text-[10px] font-semibold text-gold-700 dark:text-gold-300">Por aprovar</span>}
        </div>
        {row.last_session_at && <p className="text-xs text-ink-500">Sessão realizada · {dateTime.format(new Date(row.last_session_at))}</p>}
        {row.next_session_at && <p className="flex items-center gap-1 text-xs font-medium text-gold-700 dark:text-gold-300"><CalendarClock size={13} aria-hidden="true" />Sessão marcada · {dateTime.format(new Date(row.next_session_at))}</p>}
        <p className="text-xs text-ink-500">{row.last_contact_at ? `Última mensagem enviada · ${dateTime.format(new Date(row.last_contact_at))}` : "Ainda sem mensagens enviadas no chat"}</p>
        {archived && <p className="text-xs font-medium">{row.disposition === "declined" ? "Sem interesse" : `Adiado até ${date.format(new Date(row.snooze_until!))}`}</p>}
        {!archived && <Link href={`/admin/mensagens?cliente=${row.client_id}&novo=1`} className="btn-outline inline-flex min-h-11 items-center gap-2 text-sm"><MessageCircle size={15} aria-hidden="true" />{row.completed_sessions ? "Apresentar packs" : row.next_session_at ? "Preparar a experiência" : "Convidar para experimentar"}</Link>}
        <ProspectActions clientId={row.client_id} archived={archived} />
        {canDelete && !row.next_session_at && <DeleteProspect clientId={row.client_id} name={row.full_name || "Cliente"} />}
      </li>)}</ul>}
    </section>)}
    <p className="text-xs text-ink-500">Os atalhos abrem um rascunho editável. Ao enviares, o convite segue no chat e por email. Eliminar uma conta exige confirmação e envia um aviso por email depois de concluído. Nenhuma sessão é oferecida automaticamente.</p>
  </div>;
}
