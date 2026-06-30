"use server";

// ════════════════════════════════════════════════════════════════
// "Anunciar vaga" — web push a TODOS os clientes (com push activo).
// Útil quando abre uma vaga de última hora (cancelamento). O cliente
// recebe a notificação mesmo com a app fechada e pode marcar logo.
//
// Diferença vs. notificações normais: este envio NÃO passa pela tabela
// `notifications` (nem pelo webhook /api/push/dispatch). Vai directo às
// subscrições, por isso o gating por preferência é feito AQUI: clientes
// que desligaram o assunto "Vagas de última hora" (notification_preferences
// kind='vaga', push_enabled=false) são excluídos. Fail-open: clientes sem
// linha recebem na mesma.
//
// Requer chaves VAPID no servidor (ver lib/push.ts). Sem elas, devolve
// erro claro.
// ════════════════════════════════════════════════════════════════
import { requireStaff } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPush, pushConfigured } from "@/lib/push";
import { logError } from "@/lib/errors";

export type AnunciarState = { ok?: true; sent?: number; total?: number; error?: string };

function formatWhen(when: string): string {
  const m = when.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return "";
  return `${m[3]}/${m[2]} às ${m[4]}:${m[5]}`;
}

export async function anunciarVagaAction(
  _prev: AnunciarState,
  formData: FormData,
): Promise<AnunciarState> {
  try {
    await requireStaff();
  } catch {
    return { error: "Sem permissão para esta acção." };
  }

  if (!pushConfigured()) {
    return { error: "Push não configurado: faltam as chaves VAPID no servidor (.env)." };
  }

  const when = String(formData.get("when") ?? "").trim();
  const custom = String(formData.get("message") ?? "").trim().slice(0, 300);

  const whenLabel = formatWhen(when);
  let body: string;
  if (custom) {
    body = custom;
  } else {
    body = whenLabel
      ? `Abriu uma vaga ${whenLabel}. Marca já antes que saia!`
      : `Abriu uma vaga de última hora. Marca já!`;
  }

  const admin = createAdminClient();

  // Apenas clientes (não a equipa).
  const { data: clients, error: cErr } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "client");
  if (cErr) {
    logError("anunciarVaga:clients", cErr);
    return { error: "Não foi possível obter a lista de clientes." };
  }
  let clientIds = (clients ?? []).map((c: any) => c.id);
  if (clientIds.length === 0) return { ok: true, sent: 0, total: 0 };

  // Excluir quem desligou o assunto "Vagas de última hora" (push off).
  // Fail-open: se a query falhar, não excluímos ninguém.
  const { data: optOuts, error: oErr } = await (admin as any)
    .from("notification_preferences")
    .select("user_id")
    .eq("kind", "vaga")
    .eq("push_enabled", false);
  if (oErr) {
    logError("anunciarVaga:optOuts", oErr);
  } else if (optOuts && optOuts.length > 0) {
    const off = new Set<string>(optOuts.map((r: any) => r.user_id));
    clientIds = clientIds.filter((id: string) => !off.has(id));
  }
  if (clientIds.length === 0) return { ok: true, sent: 0, total: 0 };

  const { data: subs, error: sErr } = await (admin as any)
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, user_id")
    .in("user_id", clientIds);
  if (sErr) {
    logError("anunciarVaga:subs", sErr);
    return { error: "Não foi possível obter as subscrições." };
  }
  const list = (subs ?? []) as any[];
  if (list.length === 0) return { ok: true, sent: 0, total: 0 };

  const payload = { title: "Vaga disponível! 💪", body, url: "/app/agenda" };

  const results = await Promise.allSettled(
    list.map((s) => sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload)),
  );

  let sent = 0;
  const goneIds: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (r.value.ok) sent++;
      else if (r.value.gone) goneIds.push(list[i].id);
    }
  });

  // Limpa subscrições expiradas.
  if (goneIds.length > 0) {
    await (admin as any).from("push_subscriptions").delete().in("id", goneIds);
  }

  return { ok: true, sent, total: list.length };
}
