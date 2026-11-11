import Link from "next/link";
import { chatContext, getChatBooking, isChatId, type ChatMessage } from "@/lib/chat";
import { ChatPanel } from "./chat-panel";

export function chatContactLabel(name: string) {
  return name.trim().toLowerCase() === "admin" ? "PT - João Pedro" : name;
}

export async function ChatThread({ context, bookingId, before, inProfile, fill, draft, reactivationId }: {
  context: NonNullable<Awaited<ReturnType<typeof chatContext>>>;
  bookingId?: string;
  before?: string;
  inProfile?: boolean;
  fill?: boolean;
  draft?: string;
  reactivationId?: string;
}) {
  const base = context.staff
    ? `/admin/mensagens?cliente=${context.clientId}`
    : inProfile ? "/app/perfil?tab=chat" : `/app/mensagens?equipa=${context.staffId}`;
  let query = (context.db as any).from("leap_chat_messages")
    .select("id,sender_id,body,created_at,booking_id,booking_starts_at,rescheduled_from,read_at,kind")
    .eq("client_id", context.clientId).eq("staff_id", context.staffId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(51);
  if (isChatId(before)) {
    const { data: cursor } = await (context.db as any).from("leap_chat_messages")
      .select("created_at,id").eq("id", before)
      .eq("client_id", context.clientId).eq("staff_id", context.staffId).maybeSingle();
    if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    else before = undefined;
  } else before = undefined;
  const [{ data, error }, booking] = await Promise.all([
    query, bookingId ? getChatBooking(context, bookingId) : Promise.resolve(null),
  ]);
  if (error) return <p role="alert" className="card p-4">Não foi possível carregar a conversa. Atualiza a página.</p>;
  const rows = (data ?? []) as ChatMessage[];
  const messages = rows.slice(0, 50).reverse();
  const cancellationIds = messages.flatMap((message) =>
    message.kind === "cancellation" && message.booking_id ? [message.booking_id] : []);
  const { data: pending } = context.staff && cancellationIds.length
    ? await context.db.from("bookings").select("id,client_id")
      .in("id", cancellationIds).eq("late_cancel_review", "pending")
    : { data: null };
  const reviewLinks = Object.fromEntries((pending ?? []).map((row) =>
    [row.id, `/admin/clientes/${row.client_id}?tab=sessoes&review=${row.id}`]));
  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-4"}>
      <h2 className="shrink-0 font-display text-xl font-bold">
        {context.staff ? (
          <Link href={`/admin/clientes/${context.clientId}`} className="underline decoration-gold-500/60 underline-offset-4 hover:decoration-gold-500">
            {context.name ?? "Cliente"}
          </Link>
        ) : chatContactLabel(context.name ?? "Equipa LEAP")}
      </h2>
      {bookingId && !booking && <p className="text-sm text-ink-500">Este treino não pode ser associado a esta conversa.</p>}
      {(before || rows.length > 50) && <div className="flex shrink-0 flex-wrap gap-3 text-sm font-semibold text-gold-700 dark:text-gold-300">
        {before && <Link href={base}>Voltar às mensagens recentes</Link>}
        {rows.length > 50 && <Link href={`${base}${base.includes("?") ? "&" : "?"}antes=${messages[0].id}`}>Ver mensagens anteriores</Link>}
      </div>}
      <ChatPanel key={`${context.clientId}:${context.staffId}:${booking?.id ?? ""}:${reactivationId ?? ""}`}
        messages={messages} reviewLinks={reviewLinks} userId={context.userId} clientId={context.staff ? context.clientId : undefined}
        recipientId={context.staff ? undefined : context.staffId}
        booking={booking} draft={draft} reactivationId={reactivationId} latest={!before} fill={fill} />
    </div>
  );
}

