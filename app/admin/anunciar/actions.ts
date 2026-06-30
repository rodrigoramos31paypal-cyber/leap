"use server";

// ════════════════════════════════════════════════════════════════
// "Anunciar vaga" — avisa TODOS os clientes de uma vaga de última hora
// (cancelamento). Útil para preencher o slot rapidamente.
//
// Modelo (igual ao resto do LEAP): inserimos uma linha em `notifications`
// por cliente. Isso faz duas coisas de uma vez:
//   1) aparece no sininho (in-app) do cliente;
//   2) o Supabase Database Webhook em INSERT dispara o /api/push/dispatch,
//      que envia o push (filtrado pela preferência da categoria).
//
// Gating: o assunto "Vagas de última hora" (categoria `vaga`, só push) é
// respeitado nos DOIS canais — o push é filtrado no dispatch e o sininho
// esconde os tipos cuja categoria está desligada (hiddenInAppTypesForUser).
// Por isso só inserimos para clientes que NÃO desligaram o assunto: assim
// não poluímos o sininho de quem optou por não receber.
// ════════════════════════════════════════════════════════════════
import { requireStaff } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/server";
import { logError } from "@/lib/errors";

export type AnunciarState = { ok?: true; count?: number; error?: string };

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
  if (clientIds.length === 0) return { ok: true, count: 0 };

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
  if (clientIds.length === 0) return { ok: true, count: 0 };

  // Uma linha por cliente. O webhook de INSERT trata do push; o sininho
  // lê directamente desta tabela.
  const rows = clientIds.map((id: string) => ({
    user_id: id,
    type: "vaga_open",
    title: "Vaga disponível! 💪",
    body,
    link: "/app/agenda",
  }));

  const { error: insErr } = await (admin as any).from("notifications").insert(rows);
  if (insErr) {
    logError("anunciarVaga:insert", insErr);
    return { error: "Não foi possível criar as notificações." };
  }

  return { ok: true, count: clientIds.length };
}
