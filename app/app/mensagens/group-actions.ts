"use server";

import { groupContext } from "@/lib/group-chat";
import { isChatId } from "@/lib/chat";
import { rateLimit } from "@/lib/rate-limit";

export async function sendGroupChatMessage(group: string, id: string, body: string) {
  if (!isChatId(id) || typeof body !== "string" || !body.trim() || body.trim().length > 2000) {
    return { error: "Escreve uma mensagem até 2000 caracteres." };
  }
  const context = await groupContext(group);
  if (!context) return { error: "Esta conversa não está disponível." };
  if (!(await rateLimit("generic", `chat:${context.viewer.id}`)).success) return { error: "Espera um momento antes de enviar outra mensagem." };
  const { error } = await context.db.rpc("leap_send_group_message", {
    p_group: group, p_sender: context.viewer.id, p_id: id, p_body: body.trim(),
  });
  return error ? { error: "Não foi possível enviar a mensagem." } : { ok: true };
}

export async function markGroupRead(group: string, ids: string[]) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || !ids.every(isChatId)) return;
  const context = await groupContext(group);
  if (!context) return;
  const { data, error } = await context.db.from("leap_group_chat_messages").select("id")
    .eq("group_id", group).neq("sender_id", context.viewer.id).in("id", ids);
  if (error || !data?.length) return;
  await context.db.from("leap_group_chat_reads").upsert(
    data.map((row: {id:string}) => ({ message_id: row.id, reader_id: context.viewer.id })),
    { onConflict: "message_id,reader_id", ignoreDuplicates: true },
  );
}
