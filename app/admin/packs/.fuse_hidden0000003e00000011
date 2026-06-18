"use server";

// ════════════════════════════════════════════════════════════════
// SEC (C-C audit jun/2026): defesa em profundidade.
//
// Antes: estas actions confiavam EXCLUSIVAMENTE na policy RLS
// "packs: admin write" (de 0051), que exige
// `is_admin() AND _trainer_is_accessible(trainer_id)`. Funciona,
// mas (a) sem guard de aplicação o erro RLS aparece como falha
// genérica em vez de mensagem amigável, (b) não há audit/alert, e
// (c) basta um drop/edit acidental da policy em migração futura
// para abrir IDOR de packs (alterar preços/desactivar packs de
// outro trainer).
//
// Padrão idêntico ao H-4 fix de `definicoes/actions.ts`:
//   • requireStaff() ao topo (throw → caller fica fail-closed).
//   • savePackAction: ownership check do trainerId vindo do form.
//   • update/toggle/delete: fetch trainer_id da linha (variante
//     por id) + ownership check.
// ════════════════════════════════════════════════════════════════

import { revalidatePackViews } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";
import { requireStaff } from "@/lib/authz";
import { getCurrentTrainerId } from "@/lib/trainer";

export async function savePackAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  // C-C: owner pode criar para qualquer trainer; trainer só no próprio.
  if (profile.role !== "owner" && trainerId !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  const name = String(formData.get("name") ?? "").trim();
  const session_type = String(formData.get("session_type") ?? "individual") as "individual" | "dupla";
  const sessions = Number(formData.get("sessions") ?? 0);
  const price_euros = Number(formData.get("price_euros") ?? 0);
  const validity_days = formData.get("validity_days") ? Number(formData.get("validity_days")) : null;
  const is_single_session = formData.get("is_single_session") === "on";

  const { error } = await (supabase as any).from("packs").insert({
    trainer_id: trainerId,
    name,
    session_type,
    sessions,
    price_cents: Math.round(price_euros * 100),
    validity_days,
    active: true,
    sort_order: is_single_session ? 0 : sessions * 10,
    is_single_session,
  });
  if (error) {
    logError("savePackAction", error);
    // O índice parcial unique rebenta com código 23505 se já houver um
    // pack avulsa activo para o mesmo trainer. Damos uma mensagem clara.
    const msg = (error as any).code === "23505"
      ? "Já existe um pack 'sessão avulsa' activo. Desactiva o existente antes de criar outro."
      : "Não foi possível criar o pack";
    setFlash(msg, "error");
  } else {
    setFlash("Pack criado");
  }
  revalidatePackViews();
}

export async function updatePackAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // C-C: variante por id — fetch trainer_id da linha antes do update.
  const { data: row } = await supabase
    .from("packs")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) { setFlash("Pack não encontrado", "error"); return; }
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  const name = String(formData.get("name") ?? "").trim();
  const sessions = Number(formData.get("sessions") ?? 0);
  const price_euros = Number(formData.get("price_euros") ?? 0);
  const validity_days = formData.get("validity_days") ? Number(formData.get("validity_days")) : null;
  const is_single_session = formData.get("is_single_session") === "on";

  const { error } = await (supabase as any)
    .from("packs")
    .update({
      name,
      sessions,
      price_cents: Math.round(price_euros * 100),
      validity_days,
      is_single_session,
    })
    .eq("id", id);
  if (error) {
    logError("updatePackAction", error);
    const msg = (error as any).code === "23505"
      ? "Já existe um pack 'sessão avulsa' activo. Desactiva o existente primeiro."
      : "Não foi possível guardar";
    setFlash(msg, "error");
  } else {
    setFlash("Pack actualizado");
  }
  revalidatePackViews();
}

export async function togglePackAction(formData: FormData) {
  const profile = await requireStaff();
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // C-C: variante por id.
  const { data: row } = await supabase
    .from("packs")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) { setFlash("Pack não encontrado", "error"); return; }
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  const active = formData.get("active") === "true";
  const { error } = await supabase.from("packs").update({ active }).eq("id", id);
  if (error) {
    logError("togglePackAction", error);
    setFlash("Não foi possível alterar o estado", "error");
  } else {
    setFlash(active ? "Pack activado" : "Pack desactivado");
  }
  revalidatePackViews();
}

export async function deletePackAction(formData: FormData) {
  const profile = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = createClient();
  // C-C: variante por id — fetch trainer_id da linha antes do delete.
  const { data: row } = await supabase
    .from("packs")
    .select("trainer_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) { setFlash("Pack não encontrado", "error"); return; }
  if (profile.role !== "owner" && row.trainer_id !== (await getCurrentTrainerId())) {
    setFlash("Sem permissão.", "error");
    return;
  }
  const { error } = await supabase.from("packs").delete().eq("id", id);
  if (error) {
    logError("deletePackAction", error);
    setFlash("Não foi possível eliminar", "error");
  } else {
    setFlash("Pack eliminado");
  }
  revalidatePackViews();
}
