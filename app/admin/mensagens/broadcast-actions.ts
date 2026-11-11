"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/authz";
import { chatStaffId, isChatId } from "@/lib/chat";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/server";

export async function loadBroadcastRecipients() {
  await requireOwner();
  const db = createAdminClient();
  const clients: { id: string; full_name: string }[] = [];

  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("profiles").select("id,full_name")
      .eq("role", "client").eq("approval_status", "approved")
      .eq("access_blocked", false).not("email", "ilike", "%@removido.invalid")
      .order("full_name").order("id").range(offset, offset + 499);
    if (error) throw error;
    clients.push(...(data ?? []).map(client => ({
      id: client.id,
      full_name: client.full_name ?? "Cliente",
    })));
    if ((data?.length ?? 0) < 500) return clients;
  }
}

export async function sendBroadcast(input: { recipients: string[]; body: string; requestId: string }) {
  const owner = await requireOwner();
  const staffId = chatStaffId(owner.id)!;
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  if (!body || body.length > 2000 || !isChatId(input?.requestId) ||
      !Array.isArray(input.recipients) || !input.recipients.length || !input.recipients.every(isChatId)) {
    return { error: "Escreve uma mensagem até 2000 caracteres e seleciona os destinatários." };
  }
  const recipients = [...new Set(input.recipients)];
  const eligible = new Set((await loadBroadcastRecipients()).map(client => client.id));
  if (recipients.some(id => !eligible.has(id))) {
    return { error: "A lista de clientes mudou. Atualiza a página antes de enviar." };
  }
  if (!(await rateLimit("generic", `chat:broadcast:${staffId}`)).success) {
    return { error: "Espera um momento antes de tentares novamente." };
  }

  const db = createAdminClient();
  const failed: string[] = [];
  for (let offset = 0; offset < recipients.length; offset += 8) {
    const batch = recipients.slice(offset, offset + 8);
    const results = await Promise.allSettled(batch.map(async clientId => {
      const hash = createHash("sha256").update(`${staffId}:${input.requestId}:${clientId}`).digest("hex");
      const id = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
      const { error } = await (db as any).rpc("leap_send_chat_message", {
        p_id: id, p_client: clientId, p_staff: staffId,
        p_sender: staffId, p_body: body, p_booking: null, p_booking_starts: null,
      });
      if (error) throw error;
    }));
    results.forEach((result, index) => {
      if (result.status === "rejected") failed.push(batch[index]);
    });
  }

  revalidatePath("/app/mensagens");
  revalidatePath("/admin/mensagens");
  return { sent: recipients.length - failed.length, failed };
}
