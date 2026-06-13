"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

export async function markReadAction(notifId: string) {
  const supabase = createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notifId);
  revalidatePath("/app");
}

export async function deleteNotificationAction(formData: FormData) {
  const id = String(formData.get("notifId") ?? "");
  const scope = String(formData.get("scope") ?? "app");
  if (!id) return;
  const supabase = createClient();
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) {
    logError("deleteNotificationAction", error);
    setFlash("Não foi possível eliminar", "error");
  } else {
    setFlash("Notificação eliminada");
  }
  // Revalida a página correcta consoante o lado (cliente vs admin).
  revalidatePath(scope === "admin" ? "/admin/notificacoes" : "/app/notificacoes");
}

export async function deleteAllNotificationsAction(formData: FormData) {
  const scope = String(formData.get("scope") ?? "app");
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from("notifications").delete().eq("user_id", user.id);
  if (error) {
    logError("deleteAllNotificationsAction", error);
    setFlash("Não foi possível limpar as notificações", "error");
  } else {
    setFlash("Notificações eliminadas");
  }
  revalidatePath(scope === "admin" ? "/admin/notificacoes" : "/app/notificacoes");
}
