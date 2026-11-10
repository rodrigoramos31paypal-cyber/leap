import Link from "next/link";
import { groupContext, groupNames } from "@/lib/group-chat";
import type { ChatMessage } from "@/lib/chat";
import { ChatPanel } from "./chat-panel";

export async function GroupChatThread({ id, base }: { id: string; base: string }) {
  const context = await groupContext(id);
  if (!context) return <p className="card p-4">Esta conversa de grupo não está disponível.</p>;
  const { db, group, viewer } = context;
  const [names, result] = await Promise.all([
    groupNames(db,group),
    db.from("leap_group_chat_messages").select("id,sender_id,body,created_at,booking_id,booking_starts_at,rescheduled_from,kind")
      .eq("group_id", id).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(50),
  ]);
  if (result.error) return <p role="alert">Não foi possível carregar esta conversa.</p>;
  const messages = (result.data ?? []) as ChatMessage[];
  const { data: reads } = messages.length ? await db.from("leap_group_chat_reads").select("message_id")
    .eq("reader_id", viewer.id).in("message_id", messages.map(message => message.id)) : { data: [] };
  const read = new Set((reads ?? []).map((row: { message_id:string }) => row.message_id));
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pb-1 md:h-[calc(100dvh-11rem)] md:min-h-[28rem]">
      <Link href={base} className="shrink-0 text-sm font-semibold text-gold-700 dark:text-gold-300">← Conversas</Link>
      <div className="shrink-0">
        <h1 className="font-display text-xl font-bold">{group.members.length === 2 ? "Conversa Duo" : "Conversa Trio"}</h1>
        <p className="text-xs text-ink-500">{[...group.members,group.staff_id].map(member => names[member] ?? "LEAP").join(" · ")}</p>
      </div>
      <ChatPanel key={id} messages={messages.reverse().map(message => ({
        ...message, read_at: read.has(message.id) ? message.created_at : null,
      }))} groupId={id} senderNames={names} userId={viewer.id} reviewLinks={{}} latest fill />
    </div>
  );
}
