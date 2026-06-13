"use server";

// ════════════════════════════════════════════════════════════════
// Server actions de notificações (partilhadas por cliente e admin).
//   • setSessionReminderEnabled — toggle opt-in/out do lembrete de
//     sessão, gravado em notification_preferences (RLS: o próprio).
//   • syncSessionReminders — chamada quando o cliente abre a app;
//     cria a notificação in-app das sessões nas próximas 24h (uma vez).
// ════════════════════════════════════════════════════════════════
import { createClient } from "@/lib/supabase/server";

export async function setNotificationPref(
  kind: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // `as any`: tabela ainda não está nos tipos gerados do Supabase.
  const { error } = await (supabase as any)
    .from("notification_preferences")
    .upsert(
      { user_id: user.id, kind, enabled, updated_at: new Date().toISOString() },
      { onConflict: "user_id,kind" },
    );

  return { ok: !error };
}

export async function syncSessionReminders(): Promise<number> {
  const supabase = createClient();
  // RPC SECURITY DEFINER, limitada a auth.uid(); idempotente via dedup.
  const { data, error } = await (supabase as any).rpc("claim_due_session_reminders");
  if (error) return 0;
  return (data as number) ?? 0;
}
