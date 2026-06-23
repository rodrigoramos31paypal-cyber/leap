// ════════════════════════════════════════════════════════════════
// Configuração de notificações · categorias + mapeamento + gating
//
// Modelo: cada utilizador tem, por CATEGORIA, dois canais comutáveis
// (email, push). O in-app (sininho) é sempre ON. "Sem linha" = tudo ON.
//
// As categorias diferem por papel (cliente vs treinador). O sininho e o
// push partilham a mesma origem (INSERT em `notifications` → webhook),
// por isso o push é filtrado no /api/push/dispatch; o email é filtrado
// em cada sítio que chama sendEmail.
// ════════════════════════════════════════════════════════════════
import type { SupabaseClient } from "@supabase/supabase-js";

export type Channel = "email" | "push";

export type NotifCategory = { key: string; label: string; desc: string };

export const CLIENT_CATEGORIES: NotifCategory[] = [
  { key: "sessions", label: "Sessões", desc: "Marcação, cancelamento e lembrete de sessões." },
  { key: "packs", label: "Packs e saldo", desc: "Pack ativo, saldo baixo e packs a expirar." },
  { key: "ratings", label: "Avaliações", desc: "Pedido de avaliação após a sessão." },
];

export const TRAINER_CATEGORIES: NotifCategory[] = [
  { key: "bookings", label: "Marcações", desc: "Cliente marcou ou cancelou uma sessão." },
  { key: "payments", label: "Pagamentos", desc: "Compras de packs a aguardar confirmação." },
  { key: "notes", label: "Notas de clientes", desc: "Cliente deixou uma nota numa sessão." },
  { key: "signups", label: "Novos registos", desc: "Um cliente criou uma conta. Só in-app/push (sem email)." },
  { key: "reminders", label: "Lembretes", desc: "Lembrete das sessões do dia." },
];

export const ALL_CATEGORY_KEYS = [
  ...CLIENT_CATEGORIES.map((c) => c.key),
  ...TRAINER_CATEGORIES.map((c) => c.key),
];

type Role = "client" | "trainer" | "owner";

/**
 * Mapeia o `type` de uma notificação para a sua categoria. O
 * `session_reminder` serve cliente E treinador, por isso depende do papel
 * do destinatário. `null` = sem categoria conhecida → nunca bloqueia.
 */
export function categoryForType(type: string, role: Role): string | null {
  // ORDEM (jun/2026): tipos staff específicos ANTES do catch-all `_admin`.
  // `new_signup_admin` cai na própria categoria `signups`, não em
  // `bookings`, senão o toggle de Marcações silenciava também os registos.
  if (type === "new_signup_admin") return "signups";
  if (type.endsWith("_admin")) return "bookings"; // booking_created_admin / booking_cancelled_admin
  if (type === "payment_pending") return "payments";
  if (type === "client_note") return "notes";
  if (type === "session_reminder") return role === "client" ? "sessions" : "reminders";
  if (type === "booking_created" || type === "booking_cancelled") return "sessions";
  if (
    type === "purchase_confirmed" ||
    type === "low_credits" ||
    type === "no_credits" ||
    type === "credit_alert" ||
    type === "pack_expiring"
  ) {
    return "packs";
  }
  if (type === "rating_prompt") return "ratings";
  return null;
}

/**
 * Preferência de canais para uma categoria. Falha em ABERTO (devolve ON)
 * se a categoria for null, se não houver linha, ou se a query falhar (ex.
 * migração ainda não aplicada) — nunca queremos perder notificações por
 * causa de um erro de leitura de preferências.
 */
export async function getChannelPref(
  admin: SupabaseClient,
  userId: string,
  category: string | null,
): Promise<{ email: boolean; push: boolean }> {
  if (!category) return { email: true, push: true };
  try {
    const { data } = await (admin as any)
      .from("notification_preferences")
      .select("email_enabled, push_enabled")
      .eq("user_id", userId)
      .eq("kind", category)
      .maybeSingle();
    return {
      email: (data as any)?.email_enabled ?? true,
      push: (data as any)?.push_enabled ?? true,
    };
  } catch {
    return { email: true, push: true };
  }
}

/** Email permitido para (utilizador, categoria)? Fail-open. */
export async function emailAllowed(
  admin: SupabaseClient,
  userId: string,
  category: string | null,
): Promise<boolean> {
  return (await getChannelPref(admin, userId, category)).email;
}
