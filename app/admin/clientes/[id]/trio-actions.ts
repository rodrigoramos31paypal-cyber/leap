"use server";

// ════════════════════════════════════════════════════════════════
// Server actions do TRIO (grupos de 3 contas). Espelho de link/unlink
// Duo (em ./actions.ts), num ficheiro à parte para não mexer no actions.ts.
// A gestão é de staff/admin; a RPC link_trio/unlink_trio (0152) revalida
// o papel e a exclusão mútua com o Duo.
// ════════════════════════════════════════════════════════════════

import { revalidateCreditsViews } from "@/lib/revalidate";
import { linkTrio, unlinkTrio, getActiveTrioPartnerIds } from "@/lib/trio";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { captureAlert, isAccessDenied } from "@/lib/alerts";
import { requireStaff } from "@/lib/authz";

// Revalida créditos para os 3 membros do grupo (saldo tripla partilhado).
async function revalidateForTrio(clientId: string) {
  revalidateCreditsViews(clientId);
  if (!clientId) return;
  try {
    const partnerIds = await getActiveTrioPartnerIds(clientId);
    for (const id of partnerIds) revalidateCreditsViews(id);
  } catch (e) {
    logError("revalidateForTrio", e);
  }
}

/**
 * Liga TRÊS contas de cliente num trio: este cliente + dois parceiros
 * escolhidos no typeahead (por id). A partir daí, uma marcação PT Trio de
 * qualquer um desconta 1 sessão do saldo tripla partilhado e aparece no
 * calendário dos três.
 */
export async function linkTrioAction(formData: FormData): Promise<void> {
  await requireStaff();
  const clientId = String(formData.get("clientId") ?? "");
  const partnerId1 = String(formData.get("partnerId1") ?? "").trim();
  const partnerId2 = String(formData.get("partnerId2") ?? "").trim();

  if (!clientId || !partnerId1 || !partnerId2) {
    await setFlash("Escolhe as duas contas a ligar (o trio precisa de 3).", "error");
    return;
  }
  if (partnerId1 === partnerId2 || partnerId1 === clientId || partnerId2 === clientId) {
    await setFlash("As três contas têm de ser diferentes.", "error");
    return;
  }

  try {
    const supabase = await createClient();
    const { data: partners } = await (supabase as any)
      .from("profiles")
      .select("id, role")
      .in("id", [partnerId1, partnerId2]);

    const rows = (partners ?? []) as { id: string; role: string }[];
    if (rows.length !== 2) {
      await setFlash("Não foi possível encontrar as duas contas a ligar.", "error");
      return;
    }
    if (rows.some((r) => r.role !== "client")) {
      await setFlash("Só é possível ligar contas de cliente.", "error");
      return;
    }

    await linkTrio(clientId, partnerId1, partnerId2);
    await logAudit("trio_link", {
      targetTable: "trio_partnerships",
      targetId: clientId,
      payload: { partnerId1, partnerId2 },
    });
    await setFlash("Trio ligado — as sessões PT Trio passam a partilhar o saldo dos três.");
  } catch (e) {
    logError("linkTrioAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "linkTrio", clientId });
    const msg = (e as any)?.message;
    await setFlash(typeof msg === "string" && msg ? msg : "Não foi possível ligar o trio.", "error");
  }
  await revalidateForTrio(clientId);
}

/** Desliga o trio activo de que este cliente faça parte. */
export async function unlinkTrioAction(formData: FormData): Promise<void> {
  await requireStaff();
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) {
    await setFlash("Cliente não identificado", "error");
    return;
  }

  // Revalida os parceiros ANTES de desligar (depois já não os encontramos).
  const partnerIds = await getActiveTrioPartnerIds(clientId).catch(() => [] as string[]);

  try {
    await unlinkTrio(clientId);
    await logAudit("trio_unlink", {
      targetTable: "trio_partnerships",
      targetId: clientId,
      payload: {},
    });
    await setFlash("Trio desligado.");
  } catch (e) {
    logError("unlinkTrioAction", e);
    if (isAccessDenied(e)) await captureAlert("admin_access_denied", { action: "unlinkTrio", clientId });
    await setFlash("Não foi possível desligar o trio.", "error");
  }
  revalidateCreditsViews(clientId);
  for (const id of partnerIds) revalidateCreditsViews(id);
}
