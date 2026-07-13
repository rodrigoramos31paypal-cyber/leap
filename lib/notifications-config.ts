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

// `pushOnly`: a categoria só tem canal PUSH (sem email). Usado nas vagas de
// última hora — o aviso é só push na app, por isso o toggle de email nem
// aparece nas preferências.
export type NotifCategory = { key: string; label: string; desc: string; pushOnly?: boolean };

export const CLIENT_CATEGORIES: NotifCategory[] = [
  { key: "sessions", label: "Sessões", desc: "Marcação, cancelamento e lembrete de sessões." },
  { key: "packs", label: "Packs e saldo", desc: "Pack ativo, saldo baixo e packs a expirar." },
  { key: "ratings", label: "Avaliações", desc: "Pedido de avaliação após a sessão." },
  {
    key: "vaga",
    label: "Vagas de última hora",
    desc: "Aviso quando abre uma vaga e podes marcar uma sessão de última hora. Só push, sem email.",
    pushOnly: true,
  },
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
  // booking_refunded (0130): reembolso de cancelamento tardio aprovado pelo admin.
  if (type === "booking_created" || type === "booking_cancelled" || type === "booking_refunded") return "sessions";
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
  if (type === "vaga_open") return "vaga";
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

// ────────────────────────────────────────────────────────────────
// In-app (sininho) a espelhar o PUSH
//
// Decisão (jun/2026): o sininho deixa de ser "sempre ON". Passa a
// espelhar o canal PUSH — se uma categoria tem o push DESLIGADO, as
// notificações desse tipo não aparecem no sino nem contam para o badge.
// A linha continua a ser criada em `notifications` (o push usa-a como
// gatilho); o gating é feito na LEITURA, igual ao /api/push/dispatch.
//
// `TYPES_BY_CATEGORY` é o inverso de `categoryForType`. É de propósito
// role-agnóstico: um utilizador só tem um papel, e `session_reminder`
// cai em "reminders" (treinador) OU "sessions" (cliente) — como só uma
// dessas categorias existe nas definições de cada papel, a união nunca
// esconde a categoria errada.
// ────────────────────────────────────────────────────────────────
export const TYPES_BY_CATEGORY: Record<string, string[]> = {
  // treinador / staff
  bookings: ["booking_created_admin", "booking_cancelled_admin"],
  payments: ["payment_pending"],
  notes: ["client_note"],
  signups: ["new_signup_admin"],
  reminders: ["session_reminder"],
  // cliente
  sessions: ["booking_created", "booking_cancelled", "booking_refunded", "session_reminder"],
  packs: ["purchase_confirmed", "low_credits", "no_credits", "credit_alert", "pack_expiring"],
  ratings: ["rating_prompt"],
  vaga: ["vaga_open"],
};

/** Expande um conjunto de categorias para os `type`s que as compõem. */
export function typesForCategories(categories: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const c of categories) {
    for (const t of TYPES_BY_CATEGORY[c] ?? []) out.add(t);
  }
  return [...out];
}

/**
 * `type`s que devem ficar OCULTOS no sininho/in-app para este utilizador,
 * porque a respectiva categoria tem o PUSH desligado. Fail-open: qualquer
 * erro devolve [] (mostra tudo) — nunca esconder por causa de uma falha
 * de leitura de preferências.
 */
export async function hiddenInAppTypesForUser(
  client: SupabaseClient,
  userId: string,
): Promise<string[]> {
  try {
    const { data } = await (client as any)
      .from("notification_preferences")
      .select("kind, push_enabled")
      .eq("user_id", userId)
      .eq("push_enabled", false);
    const disabled = ((data as any[]) ?? []).map((r) => r.kind as string);
    return typesForCategories(disabled);
  } catch {
    return [];
  }
}
