import Link from "next/link";
import { chatContext, getChatBooking, isChatId, type ChatMessage } from "@/lib/chat";
import { ChatPanel } from "./chat-panel";

export async function ChatThread({ context, bookingId, before }: {
  context: NonNullable<Awaited<ReturnType<typeof chatContext>>>;
  bookingId?: string;
  before?: string;
}) {
  const base = context.staff ? `/admin/mensagens?cliente=${context.clientId}` : "/app/mensagens";
  let query = (context.db as any).from("leap_chat_messages")
    .select("id,sender_id,body,created_at,booking_id,booking_starts_at,read_at")
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
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-bold">{context.name}</h2>
      {bookingId && !booking && <p className="text-sm text-ink-500">Este treino não pode ser associado a esta conversa.</p>}
      <div className="flex flex-wrap gap-3 text-sm font-semibold text-gold-700 dark:text-gold-300">
        {before && <Link href={base}>Voltar às mensagens recentes</Link>}
        {rows.length > 50 && <Link href={`${base}${context.staff ? "&" : "?"}antes=${messages[0].id}`}>Ver mensagens anteriores</Link>}
      </div>
      <ChatPanel key={`${context.clientId}:${context.staffId}:${booking?.id ?? ""}`}
        messages={messages} userId={context.userId} clientId={context.staff ? context.clientId : undefined}
        booking={booking} latest={!before} />
    </div>
  );
}
