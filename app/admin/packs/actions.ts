"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setFlash } from "@/lib/flash";

export async function savePackAction(formData: FormData) {
  const supabase = createClient();
  const trainerId = String(formData.get("trainerId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const session_type = String(formData.get("session_type") ?? "individual") as "individual" | "dupla";
  const sessions = Number(formData.get("sessions") ?? 0);
  const price_euros = Number(formData.get("price_euros") ?? 0);
  const validity_days = formData.get("validity_days") ? Number(formData.get("validity_days")) : null;

  const { error } = await supabase.from("packs").insert({
    trainer_id: trainerId,
    name,
    session_type,
    sessions,
    price_cents: Math.round(price_euros * 100),
    validity_days,
    active: true,
    sort_order: sessions * 10,
  });
  if (error) {
    setFlash("Não foi possível criar o pack", "error", error.message);
  } else {
    setFlash("Pack criado");
  }
  revalidatePath("/admin/packs");
}

export async function updatePackAction(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const sessions = Number(formData.get("sessions") ?? 0);
  const price_euros = Number(formData.get("price_euros") ?? 0);
  const validity_days = formData.get("validity_days") ? Number(formData.get("validity_days")) : null;

  const { error } = await supabase
    .from("packs")
    .update({
      name,
      sessions,
      price_cents: Math.round(price_euros * 100),
      validity_days,
    })
    .eq("id", id);
  if (error) {
    setFlash("Não foi possível guardar", "error", error.message);
  } else {
    setFlash("Pack actualizado");
  }
  revalidatePath("/admin/packs");
}

export async function togglePackAction(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "true";
  const { error } = await supabase.from("packs").update({ active }).eq("id", id);
  if (error) {
    setFlash("Não foi possível alterar o estado", "error", error.message);
  } else {
    setFlash(active ? "Pack activado" : "Pack desactivado");
  }
  revalidatePath("/admin/packs");
}

export async function deletePackAction(formData: FormData) {
  const supabase = createClient();
  const id = String(formData.get("id") ?? "");
  const { error } = await supabase.from("packs").delete().eq("id", id);
  if (error) {
    setFlash("Não foi possível eliminar", "error", error.message);
  } else {
    setFlash("Pack eliminado");
  }
  revalidatePath("/admin/packs");
}
