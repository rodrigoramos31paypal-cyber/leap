"use server";

import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { revalidateCreditsViews } from "@/lib/revalidate";
import {
  adjustCredits,
  createPurchase,
  createCustomPurchase,
  confirmPurchase,
  removeClientSessions,
} from "@/lib/credits";
import { getCurrentTrainerId, getAccessibleTrainerIds } from "@/lib/trainer";
import { linkDuo, unlinkDuo, getActiveDuoPartnerId } from "@/lib/duo";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";
import { requireStaff, requireOwner } from "@/lib/authz";

export async function adjustCreditsAction(formData: FormData) {
  await requireStaff();
  const purchaseId = String(formData.get("purchaseId") ?? "");
  const delta = Number(formData.get("delta") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "");
  if (!purchaseId || !delta || !reason) {
    await setFlash("Faltam dados para ajustar sessões", "error");
    return;
  }

  try {
    await adjustCredits(purchaseId, delta, reason);
    await logAudit("credits_adjust", {
      targetTable: "purchases",
      targetId: purchaseId,
      payload: { delta, reason },
    });
    await setFlash(
      delta > 0 ? `Adicionadas ${delta} sessão(ões)` : `Removidas ${Math.abs(delta)} sessão(ões)`,
    );
  } catch (e) {
    logError("adjustCreditsAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "adjustCredits", targetId: purchaseId });
    await setFlash("Não foi possível ajustar sessões", "error");
  }
  await revalidateForClientAndPartner(clientId);
}

// DUO: revalida créditos para um cliente e, se existir, para o parceiro
// duo activo. Necessário porque packs dupla são partilhados pelo par
// (migration 0113) — sem isto, o perfil do parceiro mostraria dados
// desactualizados até ao próximo TTL.
async function revalidateForClientAndPartner(clientId: string) {
  revalidateCreditsViews(clientId);
  if (!clientId) return;
  try {
    const partnerId = await getActiveDuoPartnerId(clientId);
    if (partnerId) revalidateCreditsViews(partnerId);
  } catch (e) {
    logError("revalidateForClientAndPartner", e);
  }
}

export async function grantPackAction(formData: FormData): Promise<void> {
  await requireStaff();
  const mode = String(formData.get("mode") ?? "pack");
  const clientId = String(formData.get("clientId") ?? "");
  const method = String(formData.get("method") ?? "manual_cash") as
    | "manual_cash"
    | "manual_mbway"
    | "manual_revolut"
    | "complimentary";

  if (!clientId) {
    await setFlash("Cliente não identificado", "error");
    return;
  }

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", clientId)
    .maybeSingle();
  if (((target?.email as string | null) ?? "").endsWith("@removido.invalid")) {
    await setFlash("Conta removida — não é possível atribuir sessões.", "error");
    return;
  }

  if (mode === "remove") {
    const count = Number(formData.get("remove_sessions") ?? 0);
    if (!Number.isFinite(count) || count <= 0) {
      await setFlash("Indica um número de sessões válido", "error");
      return;
    }
    // Filtro opcional por tipo (any | individual | dupla). "any" consome
    // qualquer pack — útil para o caso geral; "individual"/"dupla" para
    // ajustar especificamente um dos pools (típico em pares duo, onde o
    // admin quer mexer só no saldo dupla partilhado).
    const removeTypeRaw = String(formData.get("remove_session_type") ?? "any");
    const removeType: "individual" | "dupla" | undefined =
      removeTypeRaw === "individual" || removeTypeRaw === "dupla"
        ? removeTypeRaw
        : undefined;
    const trainerId = (await getCurrentTrainerId()) ?? (await getAccessibleTrainerIds())[0];
    if (!trainerId) {
      await setFlash("Sem trainer associado", "error");
      return;
    }
    try {
      const removed = await removeClientSessions(clientId, trainerId, count, removeType);
      await logAudit("credits_adjust", {
        targetTable: "purchases",
        targetId: clientId,
        payload: { action: "remove_sessions", requested: count, removed, type: removeType ?? "any" },
      });
      if (removed === 0) {
        await setFlash("O cliente não tinha sessões disponíveis para remover", "info");
      } else if (removed < count) {
        await setFlash(`Removidas ${removed} sessão(ões) — era o saldo disponível`);
      } else {
        await setFlash(`Removidas ${removed} sessão(ões) do cliente`);
      }
    } catch (e) {
      logError("grantPackAction:remove", e);
      if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "removeClientSessions", clientId });
      await setFlash("Não foi possível remover as sessões", "error");
    }
    await revalidateForClientAndPartner(clientId);
    return;
  }

  let sessionsGranted = 0;
  try {
    let purchaseId: string;
    if (mode === "custom") {
      const sessions = Number(formData.get("custom_sessions") ?? 0);
      const priceEuros = Number(formData.get("custom_price_euros") ?? 0);
      const name = String(formData.get("custom_name") ?? "").trim();
      // Tipo escolhido no form (individual vs dupla). Quando "dupla" entra
      // no saldo PARTILHADO pelo par (ver migration 0113), por isso uma
      // atribuição reflecte automaticamente nas duas contas ligadas.
      const sessionTypeRaw = String(formData.get("custom_session_type") ?? "individual");
      const sessionType: "individual" | "dupla" =
        sessionTypeRaw === "dupla" ? "dupla" : "individual";
      if (sessions <= 0) {
        await setFlash("Indica um número de sessões válido", "error");
        return;
      }
      sessionsGranted = sessions;

      const trainerId = (await getCurrentTrainerId()) ?? (await getAccessibleTrainerIds())[0];
      if (!trainerId) {
        await setFlash("Sem trainer associado", "error");
        return;
      }

      purchaseId = await createCustomPurchase({
        clientId,
        trainerId,
        sessions,
        priceCents: Math.round(priceEuros * 100),
        sessionType,
        paymentMethod: method,
        name: name || undefined,
      });
    } else {
      const packId = String(formData.get("packId") ?? "");
      if (!packId) {
        await setFlash("Escolhe um pack", "error");
        return;
      }
      purchaseId = await createPurchase(packId, method, clientId);
    }

    await confirmPurchase(purchaseId);
    await setFlash(
      sessionsGranted > 0
        ? `Atribuídas ${sessionsGranted} sessão(ões) ao cliente`
        : "Pack atribuído e confirmado",
    );

    await logAudit("pack_grant", {
      targetTable: "purchases",
      targetId: purchaseId,
      payload: {
        clientId,
        mode,
        method,
        sessionsGranted: sessionsGranted || undefined,
      },
    });
  } catch (e) {
    logError("grantPackAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "grantPack", clientId });
    await setFlash("Não foi possível atribuir as sessões", "error");
  }
  await revalidateForClientAndPartner(clientId);
}

/**
 * Apagar (anonimizar) a conta de um cliente como ADMIN. Mesmo
 * comportamento RGPD do auto-delete: anonimiza profile + apaga PII
 * sem retenção (compras/marcações ficam por razões contabilísticas).
 * Type-to-confirm ("APAGAR") para evitar cliques acidentais.
 */
export async function adminDeleteClientAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  // H-2 (audit jun/2026): apagar a conta é irreversível e destrói PII.
  // Restringido a owner — least privilege. (Trainer regular continua
  // a poder ajustar sessões / atribuir packs.)
  await requireOwner();
  const clientId = String(formData.get("clientId") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!clientId) return { ok: false, error: "Cliente não identificado." };
  if (confirm !== "APAGAR") {
    return { ok: false, error: "Escreve APAGAR para confirmar." };
  }

  // Anonimização feita DIRECTAMENTE com a service-role key, sem depender da
  // RPC `anonymize_client_account`. A RPC exposta via PostgREST ficava à mercê
  // da cache de schema do PostgREST (erros PGRST202 "function not found" mesmo
  // com a função criada), o que tornava o apagar pouco fiável. Endpoints de
  // tabela (delete/update) não têm esse problema. Mesma lógica/efeito que a
  // migration 0081: apaga dados pessoais sem retenção e anonimiza o perfil;
  // compras/marcações ficam para obrigação contabilística.
  const admin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Guarda (igual à da RPC): só contas de cliente podem ser apagadas por aqui.
  const { data: target, error: lookupErr } = await (admin as any)
    .from("profiles")
    .select("id, role")
    .eq("id", clientId)
    .maybeSingle();
  if (lookupErr) {
    logError("adminDeleteClientAction:lookup", lookupErr);
    return { ok: false, error: "Não foi possível apagar a conta. Tenta novamente." };
  }
  if (!target) {
    return { ok: false, error: "Cliente não encontrado." };
  }
  if ((target as any).role !== "client") {
    return { ok: false, error: "Só contas de cliente podem ser apagadas por aqui." };
  }

  // Apaga dados pessoais espalhados por outras tabelas.
  const PERSONAL_DATA: Array<{ table: string; column: string }> = [
    { table: "session_notes", column: "author_id" },
    { table: "notifications", column: "user_id" },
    { table: "calendar_integrations", column: "user_id" },
    { table: "push_subscriptions", column: "user_id" },
    { table: "notification_preferences", column: "user_id" },
    { table: "engagement_alerts", column: "user_id" },
    { table: "booking_reminders", column: "recipient_id" },
  ];
  for (const { table, column } of PERSONAL_DATA) {
    const { error: delErr } = await (admin as any).from(table).delete().eq(column, clientId);
    if (delErr) {
      logError(`adminDeleteClientAction:delete:${table}`, delErr);
      return {
        ok: false,
        error: "Não foi possível apagar todos os dados do cliente. Tenta novamente.",
      };
    }
  }

  // Anonimiza o perfil (nome/email/telefone) e roda o token do feed.
  const { error: anonErr } = await (admin as any)
    .from("profiles")
    .update({
      full_name: "Cliente removido",
      email: `apagado+${clientId}@removido.invalid`,
      phone: null,
      calendar_feed_token: randomUUID(),
      // 0120: lockout total — a sessão aberta do cliente cai no próximo
      // request (gate nos layouts) em vez de durar até o token expirar.
      access_blocked: true,
    })
    .eq("id", clientId);
  if (anonErr) {
    logError("adminDeleteClientAction:anonymize", anonErr);
    return { ok: false, error: "Não foi possível anonimizar o perfil do cliente." };
  }

  // Bloqueia o login (auth) — best-effort, não falha o apagar se correr mal.
  try {
    const { error: banErr } = await admin.auth.admin.updateUserById(clientId, {
      email: `apagado+${clientId}@removido.invalid`,
      ban_duration: "876000h",
      user_metadata: {},
    });
    if (banErr) logError("adminDeleteClientAction:ban", banErr);
  } catch (e) {
    logError("adminDeleteClientAction:ban", e);
  }

  await logAudit("client_delete_admin", {
    targetTable: "profiles",
    targetId: clientId,
  });

  revalidateCreditsViews(clientId);
  return { ok: true };
}

export async function setClientBannedAction(formData: FormData): Promise<void> {
  // H-2 (audit jun/2026): suspender/reactivar conta é destrutivo
  // (bloqueia o cliente de comprar packs) e owner-grade. Restringido
  // a owner para evitar abuso por trainers.
  await requireOwner();
  const clientId = String(formData.get("clientId") ?? "");
  const banned = formData.get("banned") === "true";
  if (!clientId) {
    await setFlash("Cliente não identificado", "error");
    return;
  }

  try {
    const supabase = await createClient();
    const { error } = await (supabase as any).rpc("set_client_banned", {
      p_client_id: clientId,
      p_banned: banned,
    });
    if (error) throw error;
    await logAudit(banned ? "client_ban" : "client_unban", {
      targetTable: "profiles",
      targetId: clientId,
      payload: { banned },
    });
    await setFlash(
      banned
        ? "Conta suspensa — o cliente não consegue comprar packs."
        : "Conta reativada.",
    );
  } catch (e) {
    logError("setClientBannedAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "setClientBanned", clientId });
    await setFlash("Não foi possível atualizar o estado da conta", "error");
  }
  revalidateCreditsViews(clientId);
}

// ════════════════════════════════════════════════════════════════
// Pares "Duo" — ligar / desligar duas contas de cliente
// ════════════════════════════════════════════════════════════════

/**
 * Liga este cliente a outro (identificado pelo email). A partir daí, as
 * marcações de qualquer um deles passam a ser sessões duplas partilhadas
 * que descontam 1 sessão a cada conta. Lança/regista erros via flash.
 */
export async function linkDuoAction(formData: FormData): Promise<void> {
  await requireStaff();
  const clientId = String(formData.get("clientId") ?? "");
  // Aceita EMAIL ou TELEFONE. `partnerIdentifier` é o campo novo; mantém-se
  // compatibilidade com o campo antigo `partnerEmail`.
  const ident = String(
    formData.get("partnerIdentifier") ?? formData.get("partnerEmail") ?? "",
  ).trim();
  if (!clientId || !ident) {
    await setFlash("Indica o email ou telefone da conta a ligar.", "error");
    return;
  }

  try {
    const supabase = await createClient();
    let partner: { id: string; role: string; email: string | null; phone: string | null } | null =
      null;

    if (ident.includes("@")) {
      // ── Por email ──────────────────────────────────────────────
      const { data } = await (supabase as any)
        .from("profiles")
        .select("id, role, email, phone")
        .ilike("email", ident.toLowerCase())
        .maybeSingle();
      partner = (data as any) ?? null;
    } else {
      // ── Por telefone ───────────────────────────────────────────
      // O telefone pode estar guardado com espaços/formatação diferente,
      // por isso comparamos só os dígitos. PostgREST não normaliza no filtro,
      // logo trazemos os clientes com telefone e comparamos em JS.
      const digits = ident.replace(/\D/g, "");
      if (digits.length < 6) {
        await setFlash("Número de telefone inválido.", "error");
        return;
      }
      const { data: candidates } = await (supabase as any)
        .from("profiles")
        .select("id, role, email, phone")
        .eq("role", "client")
        .not("phone", "is", null)
        .limit(2000);
      const matches = ((candidates ?? []) as any[]).filter(
        (c) => String(c.phone ?? "").replace(/\D/g, "") === digits,
      );
      if (matches.length > 1) {
        await setFlash(
          "Há mais do que um cliente com esse telefone. Liga pelo email para evitar ambiguidade.",
          "error",
        );
        return;
      }
      partner = (matches[0] as any) ?? null;
    }

    if (!partner) {
      await setFlash("Não foi encontrado nenhum cliente com esse email ou telefone.", "error");
      return;
    }
    if (partner.id === clientId) {
      await setFlash("Não é possível ligar um cliente a si próprio.", "error");
      return;
    }
    if (partner.role !== "client") {
      await setFlash("Só é possível ligar contas de cliente.", "error");
      return;
    }

    await linkDuo(clientId, partner.id);
    await logAudit("duo_link", {
      targetTable: "duo_partnerships",
      targetId: clientId,
      payload: { partnerId: partner.id },
    });
    await setFlash("Contas ligadas — as sessões passam a descontar a ambas.");
  } catch (e) {
    logError("linkDuoAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "linkDuo", clientId });
    const msg = (e as any)?.message;
    await setFlash(typeof msg === "string" && msg ? msg : "Não foi possível ligar as contas.", "error");
  }
  revalidateCreditsViews(clientId);
}

/** Desliga o par activo de que este cliente faça parte. */
export async function unlinkDuoAction(formData: FormData): Promise<void> {
  await requireStaff();
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) {
    await setFlash("Cliente não identificado", "error");
    return;
  }

  try {
    await unlinkDuo(clientId);
    await logAudit("duo_unlink", {
      targetTable: "duo_partnerships",
      targetId: clientId,
      payload: {},
    });
    await setFlash("Contas desligadas.");
  } catch (e) {
    logError("unlinkDuoAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "unlinkDuo", clientId });
    await setFlash("Não foi possível desligar as contas.", "error");
  }
  revalidateCreditsViews(clientId);
}
