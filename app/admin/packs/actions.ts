"use server";

import { revalidatePackViews } from "@/lib/revalidate";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";
import { logError } from "@/lib/errors";

export async function savePackAction(formData: FormData) {
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
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
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
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
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
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
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
  const { error } = await supabase.from("packs").delete().eq("id", id);
  if (error) {
    logError("deletePackAction", error);
    setFlash("Não foi possível eliminar", "error");
  } else {
    setFlash("Pack eliminado");
  }
  revalidatePackViews();
}
