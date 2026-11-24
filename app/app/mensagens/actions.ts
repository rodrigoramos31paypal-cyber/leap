"use server";

import { getReactivationAlert } from "@/lib/reactivation";
import { requireStaff } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/server";
import { chatStaffId, chatContext, getChatBooking, isChatId } from "@/lib/chat";
import { rateLimit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { dispatchProspectEmails } from "@/lib/prospect-email";
import { emailEnabled } from "@/lib/email";

export async function sendChatMessage(form: FormData) {
  const target = form.get("clientId");
  const recipient = form.get("recipientId");
  if (recipient !== null && !isChatId(recipient)) return { error: "Conversa inválida." };
  const bookingId = form.get("bookingId");
  const reactivationId = form.get("reactivationId");
  const prospectEmail = form.get("prospectEmail");
  const body = form.get("body");
  const requestId = form.get("requestId");
  if ((target !== null && !isChatId(target)) || !isChatId(requestId) ||
      typeof body !== "string" || !body.trim() || body.trim().length > 2000) {
    return { error: "Escreve uma mensagem até 2000 caracteres." };
  }
  const context = await chatContext(typeof target === "string" ? target : undefined, typeof recipient === "string" ? recipient : undefined);
  if (!context) return { error: "Esta conversa não está disponível." };
  if (!(await rateLimit("generic", `chat:${context.userId}`)).success) {
    return { error: "Espera um momento antes de enviar outra mensagem." };
  }
  const booking = typeof bookingId === "string" && bookingId ? await getChatBooking(context, bookingId) : null;
  if (bookingId && !booking) return { error: "Não foi possível associar este treino." };
  if (prospectEmail !== null) {
    if (prospectEmail !== "1" || !context.staff || bookingId || reactivationId) return { error: "Convite inválido." };
    if (!emailEnabled()) return { error: "O envio de emails está indisponível. O convite ainda não foi enviado." };
    const actor = await requireStaff();
    const { data, error } = await (context.db as any).rpc("leap_prospect_send", {
      p_actor: actor.id, p_client: context.clientId, p_staff: context.staffId, p_id: requestId, p_body: body.trim(),
    });
    if (error || !["ok", "email_disabled"].includes(data)) return { error: data === "invalid_email" ? "Esta conta não tem um email válido." : "Este convite já não está disponível. Atualiza a lista de novos clientes." };
    const emailStatus = data === "email_disabled" ? "disabled" : await dispatchProspectEmails(requestId).catch(() => "queued" as const);
    revalidatePath("/admin/novos-clientes");
    revalidatePath("/admin/mensagens");
    revalidatePath("/app/mensagens");
    revalidatePath("/aprovacao-pendente");
    return { ok: true, emailStatus };
  }
  if (reactivationId !== null) {
    if (!context.staff || !isChatId(reactivationId) || !await getReactivationAlert(reactivationId, context.clientId)) {
      return { error: "Este alerta de reativação não está disponível." };
    }
    const { data, error } = await (context.db as any).rpc("leap_reactivation_send", {
      p_alert: reactivationId, p_client: context.clientId, p_staff: context.staffId, p_id: requestId, p_body: body.trim(),
    });
    if (error || data) return { error: data || "Não foi possível enviar a mensagem de reativação." };
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/mensagens");
    return { ok: true };
  }
  const { error } = await (context.db as any).rpc("leap_send_chat_message", {
    p_id: requestId, p_client: context.clientId, p_staff: context.staffId,
    p_sender: context.userId, p_body: body.trim(), p_booking: booking?.id ?? null,
    p_booking_starts: booking?.starts_at ?? null,
  });
  if (error) return { error: "Não foi possível enviar. Tenta novamente." };
  revalidatePath("/admin/novos-clientes");
  revalidatePath("/aprovacao-pendente");
  revalidatePath("/app/mensagens");
  revalidatePath("/admin/mensagens");
  return { ok: true };
}

export async function markChatRead(clientId: string | undefined, messageIds: string[], recipientId?: string) {
  if (!Array.isArray(messageIds) || messageIds.length > 50 || !messageIds.every(isChatId)) return;
  if (!messageIds.length) return;
  const context = await chatContext(clientId, recipientId);
  if (!context) return;
  const { error } = await (context.db as any).from("leap_chat_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("client_id", context.clientId).eq("staff_id", context.staffId)
    .neq("sender_id", context.userId).is("read_at", null).in("id", messageIds);
  if (error) return;
  await context.db.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("user_id", context.userId).eq("type", "chat_message")
    .in("id", messageIds).is("read_at", null);
}

export async function countUnreadStaffMessages() {
  const staff = await requireStaff();
  const { count, error } = await (createAdminClient() as any).from("leap_chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", chatStaffId(staff.id)).is("read_at", null)
    .neq("sender_id", chatStaffId(staff.id));
  return error ? null : count ?? 0;
}
